import { Fragment } from 'react'

import { IssueAlert } from '@/app/common'
import Dialog from '@/components/ui/Dialog'
import type { Session } from '@/data/context'
import { formatBytes, formatCount, formatDate } from '@/lib/format'

import { ISSUE_TITLE } from '../upload/issueTitles'

type PropsImportDetails = {
  open: boolean
  onClose: () => void
  session: Session
}

/** What the parser found in the export: the archive, what each list was built from, and every file it looked at. */
const ImportDetails = ({ open, onClose, session }: PropsImportDetails) => {
  const { diagnostics } = session

  return (
    <Dialog open={open} onClose={onClose} title='Import details' description='What INYX found in your export, all worked out in this browser.' wide>
      <div className='ix-stack' style={{ gap: 14 }}>
        {session.issues.length > 0 && (
          <div className='ix-stack' style={{ gap: 8 }}>
            {session.issues.map((issue, index) => (
              <IssueAlert key={`${issue.code}-${index}`} issue={issue} title={ISSUE_TITLE[issue.code] ?? 'Notice'} />
            ))}
          </div>
        )}

        {diagnostics ? (
          <>
            <dl className='ix-kv'>
              <div>
                <dt>Archive</dt>
                <dd>
                  {session.fileName} · {formatBytes(session.fileSize)}
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
                const name = kind === 'followers' ? 'Followers' : 'Following'

                return (
                  <Fragment key={kind}>
                    <div>
                      <dt>{name}: records read</dt>
                      <dd>
                        {formatCount(t.recordsSeen)} in {t.sourceFiles} {t.sourceFiles === 1 ? 'file' : 'files'}
                      </dd>
                    </div>
                    <div>
                      <dt>{name}: duplicates merged, skipped</dt>
                      <dd>
                        {formatCount(t.duplicatesRemoved)}, {formatCount(t.rejectedRecords)}
                      </dd>
                    </div>
                    <div>
                      <dt>{name}: dates in the export</dt>
                      <dd>{t.earliest === null || t.latest === null ? 'none' : `${formatDate(t.earliest)} to ${formatDate(t.latest)}`}</dd>
                    </div>
                  </Fragment>
                )
              })}
            </dl>

            <div>
              <h3 className='ix-tile-title'>Files found</h3>
              <ul style={{ marginTop: 4 }}>
                {diagnostics.files.map(file => (
                  <li key={file.path} className='ix-snapshot'>
                    <div style={{ minWidth: 0 }}>
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
          </>
        ) : (
          <p className='ix-note'>
            This analysis was opened from a saved snapshot, which keeps only your follower and following lists, so the file-by-file details of the
            original import are no longer available.
          </p>
        )}
      </div>
    </Dialog>
  )
}

export default ImportDetails
