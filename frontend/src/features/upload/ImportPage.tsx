import { FileArchive } from 'lucide-react'
import { useId, useState, type CSSProperties, type DragEvent } from 'react'
import { useNavigate } from 'react-router'

import { IssueAlert, PageHead } from '@/app/common'
import { useAppData } from '@/data/context'
import { importExportFile, ImportError, type ImportResult, type ImportStage } from '@/lib/instagram/importExport'

import { ISSUE_TITLE } from './issueTitles'

type Phase =
  | { name: 'idle' }
  | { name: 'working'; stage: ImportStage; fileName: string }
  | { name: 'rejected'; result: ImportResult }
  | { name: 'error'; message: string; fileName: string }

const STAGES: { stage: ImportStage; label: string }[] = [
  { stage: 'reading', label: 'Reading the file in this browser' },
  { stage: 'validating', label: 'Checking the archive is safe' },
  { stage: 'parsing', label: 'Finding followers and following' }
]

const MAX_SHOWN_ISSUES = 2

const Progress = ({ stage, fileName }: { stage: ImportStage; fileName: string }) => {
  const current = STAGES.findIndex(s => s.stage === stage)

  return (
    <div role='status' aria-live='polite' style={{ display: 'grid', alignContent: 'center', flex: 1 }}>
      <p className='ix-label'>Working on {fileName}</p>
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

const ImportPage = () => {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [over, setOver] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { loadSample, startSession, storeAvailable, settings } = useAppData()
  const [agreed, setAgreed] = useState(false)
  const [save, setSave] = useState(storeAvailable && settings.saveByDefault)
  const navigate = useNavigate()
  const inputId = useId()

  const handleFile = async (file: File) => {
    setPhase({ name: 'working', stage: 'reading', fileName: file.name })

    try {
      const result = await importExportFile(file, stage => setPhase({ name: 'working', stage, fileName: file.name }))
      const { followers, following } = result.parsed

      // Without both lists there is nothing to compare, so say why and let the user pick another file.
      if (followers.length === 0 || following.length === 0) {
        setPhase({ name: 'rejected', result })

        return
      }

      const outcome = await startSession(result, { save: save && storeAvailable, label: '' })

      navigate('/app/dashboard', {
        state: {
          notice: outcome.saved
            ? 'Snapshot saved on this device.'
            : save && outcome.duplicateOf
              ? 'This export matches a snapshot you already saved, so it was not saved again.'
              : null
        }
      })
    } catch (error) {
      setPhase({
        name: 'error',
        fileName: file.name,
        message: error instanceof ImportError ? error.message : 'Something went wrong while reading this file.'
      })
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0 || !agreed) return

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

  const working = phase.name === 'working'
  const issues = phase.name === 'rejected' ? phase.result.parsed.issues : []

  return (
    <div className='ix-page'>
      <PageHead
        label='Import'
        title={
          <>
            Bring in your <span className='ix-px'>export</span>
          </>
        }
        sub='Upload the ZIP Instagram prepared for you. You never log in to anything.'
      />

      <div className='ix-body ix-body-2'>
        <section className='ix-tile' style={{ '--tile-c': 'var(--ix-h1)', gap: 12 } as CSSProperties} aria-label='Upload'>
          {working ? (
            <Progress stage={phase.stage} fileName={phase.fileName} />
          ) : (
            <>
              <label
                htmlFor={inputId}
                className='ix-drop'
                data-over={over}
                aria-disabled={!agreed}
                onDragOver={event => {
                  event.preventDefault()
                  if (agreed) setOver(true)
                }}
                onDragLeave={() => setOver(false)}
                onDrop={handleDrop}
              >
                <span className='ix-drop-icon' aria-hidden>
                  <FileArchive size={22} strokeWidth={1.5} />
                </span>
                <span>
                  <strong style={{ display: 'block', fontSize: '1.05rem' }}>Drop your Instagram export ZIP here</strong>
                  <span className='ix-note'>
                    {agreed ? 'or choose it from your computer. One .zip file, up to 250 MB.' : 'Tick the privacy box below first, then drop your ZIP.'}
                  </span>
                </span>
                <span className='ix-btn ix-btn-dark' aria-hidden>
                  Choose ZIP file
                </span>
                <input
                  id={inputId}
                  type='file'
                  accept='.zip,application/zip,application/x-zip-compressed'
                  className='sr-only'
                  disabled={!agreed}
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

              {phase.name === 'rejected' && (
                <div className='ix-stack' style={{ gap: 8 }}>
                  <div className='ix-alert ix-alert-error' role='alert'>
                    <div>
                      <strong>This export has nothing to compare yet</strong>
                      INYX needs both a followers file and a following file with accounts in them. Nothing was analysed.
                    </div>
                  </div>
                  {issues.slice(0, MAX_SHOWN_ISSUES).map((issue, index) => (
                    <IssueAlert key={`${issue.code}-${index}`} issue={issue} title={ISSUE_TITLE[issue.code] ?? 'Notice'} />
                  ))}
                  {issues.length > MAX_SHOWN_ISSUES && <p className='ix-note'>And {issues.length - MAX_SHOWN_ISSUES} more notices.</p>}
                </div>
              )}

              <div className='ix-stack' style={{ gap: 10, flex: 'none' }}>
                <label className='ix-check'>
                  <input type='checkbox' checked={agreed} onChange={event => setAgreed(event.target.checked)} />
                  <span>
                    I understand my export is read only in this browser tab
                    <span className='ix-note' style={{ display: 'block' }}>
                      It is never uploaded, and INYX never asks for your Instagram login.
                    </span>
                  </span>
                </label>

                <label className='ix-check'>
                  <input type='checkbox' checked={save} disabled={!storeAvailable} onChange={event => setSave(event.target.checked)} />
                  <span>
                    Also save a snapshot on this device (optional)
                    <span className='ix-note' style={{ display: 'block' }}>
                      {storeAvailable
                        ? 'Keeps only your follower and following lists, never the ZIP, so you can compare exports later. Delete it any time in Settings.'
                        : 'Saving is unavailable because this browser blocks local storage.'}
                    </span>
                  </span>
                </label>
              </div>
            </>
          )}
        </section>

        <aside className='ix-stack' aria-label='About importing'>
          <section className='ix-tile' style={{ '--tile-c': 'var(--ix-h3)' } as CSSProperties}>
            <p className='ix-label'>Step by step</p>
            <h2 className='ix-h2' style={{ marginTop: 8 }}>
              Get your export
            </h2>
            <ol className='ix-steps' style={{ marginTop: 10 }}>
              <li>In Instagram, open Accounts Center, then Your information and permissions, then Export your information.</li>
              <li>Choose "Followers and following" and the JSON format.</li>
              <li>Download the ZIP when it is ready, then drop it here.</li>
            </ol>
            <p className='ix-note' style={{ marginTop: 8 }}>
              Menu names change now and then. HTML exports are not supported yet.
            </p>
          </section>

          <section className='ix-tile' style={{ '--tile-c': 'var(--ix-h2)' } as CSSProperties}>
            <p className='ix-label'>Not ready yet</p>
            <h2 className='ix-h2' style={{ marginTop: 8 }}>
              Just looking?
            </h2>
            <p className='ix-note' style={{ marginTop: 6 }}>
              Preview the app with synthetic sample data. It is clearly labelled and is not your account.
            </p>
            <button type='button' className='ix-btn' style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={handleSample}>
              Try with sample data
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}

export default ImportPage
