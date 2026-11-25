// Ordering and totals for the history page's list. Pure, so they can be tested alone.

const SORTS = {
  newest: (a, b) => b.createdAt - a.createdAt,
  oldest: (a, b) => a.createdAt - b.createdAt,
  largest: (a, b) => (b.bytes || 0) - (a.bytes || 0) || b.createdAt - a.createdAt,
  title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base', numeric: true }) || b.createdAt - a.createdAt,
};

// A sorted copy. Unknown orders fall back to newest first.
export const sortEntries = (entries, order) => [...entries].sort(SORTS[order] || SORTS.newest);

// Disk space the saved files take, as recorded when each finished. Files saved again or
// deleted since aren't known here, so this is an estimate.
export const totalBytes = (entries) => entries.reduce((n, e) => n + (e.state === 'complete' && Number.isFinite(e.bytes) && e.bytes > 0 ? e.bytes : 0), 0);
