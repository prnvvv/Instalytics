export const formatCount = (value: number) => value.toLocaleString('en-US')

export const formatPercent = (value: number | null) => (value === null ? 'n/a' : `${value.toFixed(value >= 10 ? 0 : 1)}%`)

export const formatRatio = (value: number | null) => (value === null ? 'n/a' : value.toFixed(2))

export const formatDate = (unixSeconds: number | null) =>
  unixSeconds === null
    ? 'Not in export'
    : new Date(unixSeconds * 1000).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC'
      })

export const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
