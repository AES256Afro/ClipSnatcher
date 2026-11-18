// Picks which version of a video to save, according to the quality setting.
// Pure apart from the `sizeOf` callback, so it can be tested without a browser.

export const QUALITIES = ['best', 'smaller', 'fit'];
const SMALLER_MAX_HEIGHT = 720;
const MAX_SIZE_CHECKS = 6;          // at most this many size lookups per video

export const fmtMB = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10 * 1048576 ? 1 : 0)} MB`;

/**
 * @param item      a resolved item; `item.variants` (best first) may list other qualities
 * @param settings  { quality: 'best'|'smaller'|'fit', maxMB }
 * @param sizeOf    async (variant) => size in bytes, or 0 when unknown
 * @returns {{ item, note: string, over: boolean }}  the item to save (keeps index and other
 *   fields of the original), a short description of the choice, and whether it is
 *   still larger than the limit
 */
export async function chooseVariant(item, settings, sizeOf = async () => 0) {
  const variants = item.variants?.length ? item.variants : [item];
  const quality = QUALITIES.includes(settings.quality) ? settings.quality : 'best';
  const keep = (v, note = '', over = false) => {
    const { variants: _all, ...rest } = item;
    const { estBytes, bitrate, height, ...fields } = v;
    return { item: { ...rest, ...fields, height: height || 0 }, note, over };
  };
  const label = (v) => (v.height ? `${v.height}p` : '');

  if (quality === 'best' || (variants.length === 1 && quality !== 'fit')) return keep(variants[0]);
  if (variants.length === 1) {
    // Only one version offered: nothing to choose. Say so only if it is known to be too big.
    const size = (await sizeOf(variants[0]).catch(() => 0)) || variants[0].estBytes || 0;
    const limit = Math.max(1, Number(settings.maxMB) || 10) * 1048576;
    return size > limit ? keep(variants[0], `Only one version is offered, and it is ${fmtMB(size)}, over your ${fmtMB(limit)} limit`, true) : keep(variants[0]);
  }

  if (quality === 'smaller') {
    const best = variants[0];
    const pick = best.height
      ? variants.find((v, i) => i > 0 && v.height && v.height <= SMALLER_MAX_HEIGHT && v.height < best.height)
        || variants.find((v, i) => i > 0 && v.height && v.height < best.height)
      : variants[1];
    return pick ? keep(pick, label(pick) ? `${label(pick)} version` : 'smaller version') : keep(best, 'only one size is offered');
  }

  // fit: the best version at or under the limit
  const limit = Math.max(1, Number(settings.maxMB) || 10) * 1048576;
  let smallest = null;
  for (const [i, v] of variants.entries()) {
    const size = (i < MAX_SIZE_CHECKS ? await sizeOf(v).catch(() => 0) : 0) || v.estBytes || 0;
    const sizeText = size ? `about ${fmtMB(size)}` : 'size unknown';
    if (size && size <= limit) return keep(v, [label(v), sizeText].filter(Boolean).join(', '));
    if (size && (!smallest || size < smallest.size)) smallest = { v, size };
  }
  if (smallest) {
    return keep(smallest.v, `The smallest version offered is ${fmtMB(smallest.size)}, over your ${fmtMB(limit)} limit`, true);
  }
  return keep(variants[variants.length - 1], 'the size isn’t known, so the smallest version was chosen');
}
