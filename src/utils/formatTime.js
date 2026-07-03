// Render an instant in Ontario's prevailing Eastern time with its zone label.
//
// All "as of" timestamps in the app are real instants (ISO 8601): the snapshot
// carries the server response time (UTC); the nodal report carries IESO's
// CREATED AT, which the API tags -05:00 (IESO stamps EST year-round). Formatting
// both through America/Toronto shows the correct wall-clock time to any viewer
// and appends the right abbreviation automatically (EDT in summer, EST in
// winter) -- so a summer report reads e.g. "10:33 PM EDT", matching a local
// clock, instead of an hour behind.

export function formatEasternTime(value, { seconds = false } = {}) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(d)

  const get = (type) => parts.find((p) => p.type === type)?.value ?? ''
  const hms = seconds
    ? `${get('hour')}:${get('minute')}:${get('second')}`
    : `${get('hour')}:${get('minute')}`
  return `${hms} ${get('dayPeriod')} ${get('timeZoneName')}` // e.g. "10:33 PM EDT"
}
