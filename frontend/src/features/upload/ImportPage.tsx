import { FileArchive, ShieldCheck } from 'lucide-react'
import { Fragment, useId, useMemo, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router'

import { IssueAlert, PageHead } from '@/app/common'
import DotText from '@/components/dots/DotText'
import { useAppData } from '@/data/context'
import { formatBytes, formatCount, formatDate } from '@/lib/format'
import { importExportFile, ImportError, type ImportResult, type ImportStage } from '@/lib/instagram/importExport'
import { findDuplicate } from '@/lib/storage/snapshots'

type Phase =
  | { name: 'idle' }
  | { name: 'working'; stage: ImportStage; fileName: string }
  | { name: 'preview'; result: ImportResult }
  | { name: 'error'; message: string; fileName: string }

const STAGES: { stage: ImportStage; label: string }[] = [
  { stage: 'reading', label: 'Reading the file in this browser' },
  { stage: 'validating', label: 'Checking the archive is safe' },
  { stage: 'parsing', label: 'Finding followers and following' }
]

const ISSUE_TITLE: Record<string, string> = {
  invalid_json: 'A file could not be read',
  unexpected_structure: 'A file has an unexpected layout',
  file_too_large: 'A file was too large to read',
  html_export: 'This is an HTML export',
  no_connection_files: 'No followers or following files found',
  missing_followers_file: 'No followers file',
  missing_following_file: 'No following file',
  missing_part: 'Part of the followers or following list is missing',
  rejected_records: 'Some records could not be read',
  possible_date_range_limit: 'This export may be limited to a date range',
  empty_list: 'An empty list',
  conflicting_usernames: 'Records with conflicting usernames',
  duplicate_source_files: 'The same file appears more than once'
}

const Progress = ({ stage, fileName }: { stage: ImportStage; fileName: string }) => {
  const current = STAGES.findIndex(s => s.stage === stage)

  return (
    <div className='ix-panel' role='status' aria-live='polite'>
      <p className='ix-mono ix-muted'>Working on {fileName}</p>
      <ol className='ix-progress' style={{ marginTop: 10 }}>
        {STAGES.map((item, index) => (
          <li key={item.stage} data-state={index < current ? 'done' : index === current ? 'active' : 'todo'}>
            <i className='ix-sq' aria-hidden />
            {item.label}
          </li>
        ))}
      </ol>
    </div>
  )
}

const Preview = ({ result, onReset }: { result: ImportResult; onReset: () => void }) => {
  const navigate = useNavigate()
  const { startSession, snapshots, storeAvailable, settings } = useAppData()
  const [save, setSave] = useState(storeAvailable && settings.saveByDefault)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)
  const labelId = useId()

  const { parsed } = result
  const { diagnostics } = parsed
  const followers = parsed.followers.length
  const following = parsed.following.length
  const ready = followers > 0 && following > 0
  // An export that looks partial can still be analysed, but only once the user has said they understand.
  const needsAck = diagnostics.status !== 'complete'
  const duplicateOf = useMemo(() => findDuplicate(snapshots, parsed.followers, parsed.following), [snapshots, parsed])

  const handleConfirm = async () => {
    setBusy(true)

    const outcome = await startSession(result, { save, label })

    navigate('/app/dashboard', {
      state: {
        notice: outcome.saved
          ? 'Snapshot saved on this device.'
          : save && outcome.duplicateOf
            ? 'This export matches a snapshot you already saved, so it was not saved again.'
            : null
      }
    })
  }

  return (
    <div className='ix-stack'>
      <div className='ix-grid' style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <article className='ix-card' aria-label={`${followers} followers found`}>
          <p className='ix-card-title'>Followers found</p>
          <div className='ix-metric'>
            <DotText text={formatCount(followers)} dot={5} color='#a98ae6' label={`${formatCount(followers)} followers`} />
          </div>
        </article>
        <article className='ix-card' aria-label={`${following} following found`}>
          <p className='ix-card-title'>Following found</p>
          <div className='ix-metric'>
            <DotText text={formatCount(following)} dot={5} color='#8593ea' label={`${formatCount(following)} following`} />
          </div>
        </article>
      </div>

      {parsed.issues.map((issue, index) => (
        <IssueAlert key={`${issue.code}-${index}`} issue={issue} title={ISSUE_TITLE[issue.code] ?? 'Notice'} />
      ))}

      <div className='ix-panel'>
        <h2 className='ix-h2'>What was detected</h2>
        <dl className='ix-kv' style={{ marginTop: 12 }}>
          <div>
            <dt>Archive</dt>
            <dd>
              {result.fileName} · {formatBytes(result.fileSize)}
            </dd>
          </div>
          {diagnostics.exportDate && (
            <div>
              <dt>Export date</dt>
              <dd>{formatDate(Date.parse(`${diagnostics.exportDate}T00:00:00Z`) / 1000)}</dd>
            </div>
          )}
          {(['followers', 'following'] as const).map(kind => {
            const t = diagnostics[kind]

            return (
              <Fragment key={kind}>
                <div>
                  <dt>{kind === 'followers' ? 'Followers' : 'Following'}: records read</dt>
                  <dd>
                    {formatCount(t.recordsSeen)} in {t.sourceFiles} {t.sourceFiles === 1 ? 'file' : 'files'}
                  </dd>
                </div>
                <div>
                  <dt>{kind === 'followers' ? 'Followers' : 'Following'}: duplicates merged, skipped</dt>
                  <dd>
                    {formatCount(t.duplicatesRemoved)}, {formatCount(t.rejectedRecords)}
                  </dd>
                </div>
                <div>
                  <dt>{kind === 'followers' ? 'Followers' : 'Following'}: dates in the export</dt>
                  <dd>
                    {t.earliest === null || t.latest === null
                      ? 'none'
                      : `${formatDate(t.earliest)} to ${formatDate(t.latest)}`}
                  </dd>
                </div>
              </Fragment>
            )
          })}
        </dl>
      </div>

      <div className='ix-panel'>
        <h2 className='ix-h2'>Files found</h2>
        <ul style={{ marginTop: 8 }}>
          {diagnostics.files.map(file => (
            <li key={file.path} className='ix-snapshot ix-light' style={{ gridTemplateColumns: 'minmax(0, 1fr) auto' }}>
              <div>
                <p style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{file.path.split('/').pop()}</p>
                <p className='ix-note'>{file.note}</p>
              </div>
              <span className='ix-pill-status' data-status={file.status}>
                {file.status === 'ignored' ? 'ignored' : file.status === 'failed' ? 'failed' : file.role}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className='ix-panel'>
        <h2 className='ix-h2'>Confirm</h2>
        <p className='ix-note' style={{ marginTop: 8 }}>
          Nothing has been saved or sent anywhere. Analysing opens the dashboard for this import.
        </p>

        <div className='ix-stack' style={{ marginTop: 14 }}>
          <label className='ix-check'>
            <input type='checkbox' checked={save} disabled={!storeAvailable} onChange={event => setSave(event.target.checked)} />
            <span>
              Save a snapshot on this device
              <span className='ix-note' style={{ display: 'block' }}>
                {storeAvailable
                  ? 'Optional. Stores only your follower and following lists (never the ZIP), so you can compare exports later. Delete it any time in Settings.'
                  : 'Saving is unavailable because this browser blocks local storage.'}
              </span>
            </span>
          </label>

          {save && (
            <div>
              <label htmlFor={labelId} className='ix-mono ix-muted'>
                Label (optional)
              </label>
              <input
                id={labelId}
                className='ix-field'
                style={{ display: 'block', width: '100%', maxWidth: 360, marginTop: 6 }}
                maxLength={60}
                placeholder='For example: June export'
                value={label}
                onChange={event => setLabel(event.target.value)}
              />
            </div>
          )}

          {needsAck && ready && (
            <label className='ix-check'>
              <input type='checkbox' checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />
              <span>
                I understand these results may not include everyone
                <span className='ix-note' style={{ display: 'block' }}>
                  The warnings above say what may be missing. The figures stay exact for the files that were read.
                </span>
              </span>
            </label>
          )}

          {duplicateOf && (
            <div className='ix-alert ix-alert-ok'>
              <div>
                <strong>Identical to a saved snapshot</strong>
                These lists match a snapshot you already saved
                {duplicateOf.label ? ` ("${duplicateOf.label}")` : ''}, so saving again would add nothing.
              </div>
            </div>
          )}
        </div>

        <div className='flex flex-wrap gap-2' style={{ marginTop: 18 }}>
          <button
            type='button'
            className='ix-btn ix-btn-dark'
            disabled={!ready || busy || (needsAck && !acknowledged)}
            onClick={handleConfirm}
          >
            Analyse this export
          </button>
          <button type='button' className='ix-btn' onClick={onReset} disabled={busy}>
            Choose another file
          </button>
        </div>
      </div>
    </div>
  )
}

const ImportPage = () => {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [over, setOver] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { loadSample } = useAppData()
  const navigate = useNavigate()
  const inputId = useId()

  const handleFile = async (file: File) => {
    setPhase({ name: 'working', stage: 'reading', fileName: file.name })

    try {
      const result = await importExportFile(file, stage => setPhase({ name: 'working', stage, fileName: file.name }))

      setPhase({ name: 'preview', result })
    } catch (error) {
      setPhase({
        name: 'error',
        fileName: file.name,
        message: error instanceof ImportError ? error.message : 'Something went wrong while reading this file.'
      })
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return

    setNote(files.length > 1 ? 'Only one archive can be imported at a time, so the first file was used.' : null)
    void handleFile(files[0])
  }

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setOver(false)
    handleFiles(event.dataTransfer.files)
  }

  const handleSample = () => {
    loadSample()
    navigate('/app/dashboard')
  }

  const showDrop = phase.name === 'idle' || phase.name === 'error'

  return (
    <>
      <PageHead
        label='Import'
        title={
          <>
            Bring in your <span className='ix-px'>export</span>
          </>
        }
        sub='Upload the ZIP Instagram prepared for you. It is read in this browser tab and never uploaded, and you never log in to anything.'
      />

      <div className='ix-split'>
        <div className='ix-stack'>
          {showDrop && (
            <>
              <label
                htmlFor={inputId}
                className='ix-drop'
                data-over={over}
                onDragOver={event => {
                  event.preventDefault()
                  setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={handleDrop}
              >
                <span className='ix-drop-icon' aria-hidden>
                  <FileArchive size={24} strokeWidth={1.5} />
                </span>
                <span>
                  <strong style={{ display: 'block', fontSize: '1.05rem' }}>Drop your Instagram export ZIP here</strong>
                  <span className='ix-note'>or choose it from your computer. One .zip file, up to 250 MB.</span>
                </span>
                <span className='ix-btn ix-btn-dark'>Choose ZIP file</span>
                <input
                  id={inputId}
                  type='file'
                  accept='.zip,application/zip,application/x-zip-compressed'
                  className='sr-only'
                  onChange={event => {
                    handleFiles(event.target.files)
                    // Allows choosing the same file again after an error.
                    event.target.value = ''
                  }}
                />
              </label>

              {note && (
                <p className='ix-note' role='status'>
                  {note}
                </p>
              )}

              {phase.name === 'error' && (
                <div className='ix-alert ix-alert-error' role='alert'>
                  <div>
                    <strong>This file could not be imported</strong>
                    {phase.message}
                    <span className='ix-note' style={{ display: 'block' }}>
                      File: {phase.fileName}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {phase.name === 'working' && <Progress stage={phase.stage} fileName={phase.fileName} />}
          {phase.name === 'preview' && <Preview result={phase.result} onReset={() => setPhase({ name: 'idle' })} />}
        </div>

        <aside className='ix-stack' aria-label='About importing'>
          <section className='ix-panel'>
            <h2 className='ix-h2'>
              <ShieldCheck aria-hidden size={18} style={{ display: 'inline', marginRight: 8, verticalAlign: '-2px' }} />
              Your privacy
            </h2>
            <ul className='ix-steps' style={{ marginTop: 12 }}>
              <li>Your file is read inside this browser tab. It is never uploaded.</li>
              <li>No Instagram login, password or cookies. INYX never connects to your account.</li>
              <li>Saving is optional and off unless you tick it. Saved snapshots stay on this device.</li>
            </ul>
          </section>

          <section className='ix-panel'>
            <h2 className='ix-h2'>Get your export</h2>
            <ol className='ix-steps' style={{ marginTop: 12 }}>
              <li>In Instagram, open Accounts Center, then Your information and permissions, then Export your information.</li>
              <li>Choose "Followers and following" and the JSON format.</li>
              <li>Download the ZIP when Instagram says it is ready, then drop it here.</li>
            </ol>
            <p className='ix-note' style={{ marginTop: 12 }}>
              Menu names change from time to time. HTML exports are not supported yet.
            </p>
          </section>

          <section className='ix-panel'>
            <h2 className='ix-h2'>Just looking?</h2>
            <p className='ix-note' style={{ marginTop: 8 }}>
              Preview the app with synthetic sample data. It is clearly labelled and is not your account.
            </p>
            <button type='button' className='ix-btn' style={{ marginTop: 12 }} onClick={handleSample}>
              Try with sample data
            </button>
          </section>
        </aside>
      </div>
    </>
  )
}

export default ImportPage
