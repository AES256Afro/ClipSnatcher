// Several links pasted into the popup at once. The background worker saves them one after
// another, so closing the popup doesn't stop them. Questions (another host, already saved)
// aren't asked in a batch: those links are listed so they can be pasted on their own.

export const MAX_BATCH = 20;

// The separate links in what was pasted. A one-line box drops line breaks, so links pasted
// one per line arrive glued together ("https://a.com/1https://b.com/2"): each "http" starts
// a new link. An address inside a link's query ("?u=https://…") is part of that link.
export function splitLinks(text) {
  const found = String(text || '').match(/https?:\/\/.+?(?=(?<![=&?%:])https?:\/\/|[\s<>"']|$)/gi) || [];
  return [...new Set(found.map((u) => u.replace(/[)\].,;!?'"]+$/, '')))];
}

export const shortLink = (u) => u.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40) + (u.length > 48 ? '…' : '');

/**
 * What happened to one link of the batch, from the save's result.
 * @returns {{ url: string, kind: 'started'|'skipped'|'failed', why?: string }}
 */
export function outcome(url, r) {
  if (r?.ok) return { url, kind: 'started' };
  if (r?.duplicate) return { url, kind: 'skipped' };
  if (r?.needsConfirm) return { url, kind: 'failed', why: `hosted on ${r.host}; paste it on its own to confirm` };
  return { url, kind: 'failed', why: String(r?.error || 'failed').slice(0, 200) };
}

/**
 * The summary line once a batch is over (or so far).
 * @param {{ url: string, kind: string, why?: string }[]} results
 * @param {number} total
 */
export function summary(results, total) {
  const started = results.filter((o) => o.kind === 'started').length;
  const skipped = results.filter((o) => o.kind === 'skipped').length;
  const failed = results.filter((o) => o.kind === 'failed');
  const parts = [`Started ${started} of ${total}.`];
  if (skipped) parts.push(`${skipped} already saved.`);
  if (failed.length) parts.push(`Not saved: ${failed.map((o) => `${shortLink(o.url)}: ${o.why}`).join(' • ')}`);
  return { text: parts.join(' '), ok: failed.length === 0 };
}

// Keeps only what a batch may contain: up to MAX_BATCH distinct web links of sane length.
export function cleanBatch(urls) {
  if (!Array.isArray(urls)) return [];
  return [...new Set(urls.filter((u) => typeof u === 'string' && u.length <= 4096 && /^https?:\/\//i.test(u)))].slice(0, MAX_BATCH);
}
