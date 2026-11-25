// File and folder naming. Shared by the background worker (which saves files) and the
// Settings page (which previews the name), so the preview is always what you get.

export const FOLDER_NAMES = { x: 'X', reddit: 'Reddit', facebook: 'Facebook', web: 'Web' };

// Makes text safe to use as one path segment, at most `max` characters long.
export function sanitize(s, max = 90) {
  let out = String(s || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\/:*?"<>|~%]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Count whole characters so an emoji is never cut in half.
  const chars = Array.from(out);
  if (chars.length > max) {
    const cut = chars.slice(0, max).join('');
    const atWord = cut.replace(/\s+\S*$/, '');
    out = atWord.length >= max * 0.6 ? atWord : cut;
  }
  return out.replace(/^[.\s]+|[.\s]+$/g, '');
}

// A folder setting may contain slashes for nested folders; each part is cleaned on its own.
export function sanitizeFolder(f) {
  return String(f || '').split(/[\\/]+/).map((p) => sanitize(p, 60)).filter(Boolean).join('/');
}

export function extensionFor(item) {
  if (item.kind !== 'direct') return 'mp4';
  let path = '';
  try { path = new URL(item.url).pathname; } catch { /* default below */ }
  return (path.match(/\.(mp4|webm|mov|m4v)$/i)?.[1] || 'mp4').toLowerCase();
}

// The words a file-name template may use, each replaced by part of the post.
export const NAME_TOKENS = ['author', 'title', 'id', 'site', 'date'];

// The date a video is saved, as 2026-11-25 in the computer's own time zone.
const isoDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// A file name from a template like "{date} {author} - {title}". Each part is cleaned on its
// own, then the whole name again (the template's own text may hold characters files can't
// have). Separators left hanging by an empty part ("{author} - " with no author) and empty
// brackets are dropped. Unknown {words} are kept as written.
export function applyTemplate(template, parts) {
  const filled = String(template).replace(/\{(\w+)\}/g, (m, k) => (NAME_TOKENS.includes(k) ? parts[k] || '' : m));
  return sanitize(filled.replace(/\[\s*\]|\(\s*\)/g, ' ').replace(/^[\s\-_–—,.;]+|[\s\-_–—,.;]+$/g, '').replace(/\s+([\-–—])\s+(?=[\-–—])/g, ' '), 150);
}

/**
 * The path, relative to Chrome's Downloads folder, a video is saved to.
 * @param {{ folder: string, perSite: boolean, authorInName: boolean, nameTemplate?: string }} settings
 *   nameTemplate: the file name with {author} {title} {id} {site} {date}; empty for the usual name
 * @param {{ site: string, title: string, author: string, id: string }} post
 * @param {{ kind: string, url?: string, index: number }} item
 * @param {number} total  how many videos the post has
 * @param {number} [now]  when it is saved (for {date})
 */
export function buildFilename(settings, post, item, total, now = Date.now()) {
  const folder = sanitizeFolder(settings.folder);
  const sub = settings.perSite ? FOLDER_NAMES[post.site] || 'Web' : '';
  const authorText = post.author ? sanitize(post.author.replace(/^@/, '').replace(/\//g, '-'), 30) : '';
  const name = sanitize(post.title) || 'video';
  const id = sanitize(post.id, 24) || 'video';
  const suffix = total > 1 ? ` (${item.index})` : '';
  const template = String(settings.nameTemplate || '').trim();
  const stem = template
    ? applyTemplate(template, { author: authorText, title: name, id, site: FOLDER_NAMES[post.site] || 'Web', date: isoDay(now) }) || name
    : `${settings.authorInName && authorText ? authorText + ' - ' : ''}${name} [${id}]`;
  return [folder, sub, `${stem}${suffix}.${extensionFor(item)}`].filter(Boolean).join('/');
}
