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

/**
 * The path, relative to Chrome's Downloads folder, a video is saved to.
 * @param {{ folder: string, perSite: boolean, authorInName: boolean }} settings
 * @param {{ site: string, title: string, author: string, id: string }} post
 * @param {{ kind: string, url?: string, index: number }} item
 * @param {number} total  how many videos the post has
 */
export function buildFilename(settings, post, item, total) {
  const folder = sanitizeFolder(settings.folder);
  const sub = settings.perSite ? FOLDER_NAMES[post.site] || 'Web' : '';
  const author = settings.authorInName && post.author ? sanitize(post.author.replace(/^@/, '').replace(/\//g, '-'), 30) + ' - ' : '';
  const name = sanitize(post.title) || 'video';
  const suffix = total > 1 ? ` (${item.index})` : '';
  const file = `${author}${name} [${sanitize(post.id, 24) || 'video'}]${suffix}.${extensionFor(item)}`;
  return [folder, sub, file].filter(Boolean).join('/');
}
