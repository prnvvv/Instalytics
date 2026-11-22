import type { Account } from './instagram/types'

// Cells starting with these are treated as formulas by spreadsheet apps (CSV injection).
const FORMULA_START = /^[=+\-@\t\r]/

const escapeCell = (value: string) => {
  const safe = FORMULA_START.test(value) ? `'${value}` : value

  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe
}

export type CsvColumn<T> = { header: string; value: (row: T) => string }

export const toCsv = <T>(rows: readonly T[], columns: readonly CsvColumn<T>[]) =>
  [columns.map(c => escapeCell(c.header)).join(','), ...rows.map(row => columns.map(c => escapeCell(c.value(row))).join(','))].join('\r\n') +
  '\r\n'

export const accountColumns = (relationship: string): CsvColumn<Account>[] => [
  { header: 'username', value: a => a.username },
  { header: 'profile_url', value: a => a.profileUrl },
  { header: 'followed_at', value: a => (a.followedAt === null ? '' : new Date(a.followedAt * 1000).toISOString()) },
  { header: 'relationship', value: () => relationship }
]

export const accountsToCsv = (accounts: readonly Account[], relationship: string) =>
  toCsv(accounts, accountColumns(relationship))

/** Triggers a browser download of generated text. Revokes the object URL straight away. */
export const downloadText = (filename: string, text: string, type = 'text/csv;charset=utf-8') => {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }))
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
