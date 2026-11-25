// Problems that happened out of sight (a merge that failed after the tab closed, a
// download that broke half-way) wait on the toolbar badge until the popup or history page
// is opened. These are the rules for that list; the background worker keeps it in session
// storage, so it lasts until Chrome closes.

export const MAX_PROBLEMS = 10;

/**
 * The list with one more problem, newest first, at most MAX_PROBLEMS long.
 * @param {{ text: string, at: number }[]} list
 * @param {string} text
 * @param {number} at
 */
export function addProblem(list, text, at) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300) || 'Something went wrong.';
  return [{ text: clean, at }, ...(Array.isArray(list) ? list : [])].slice(0, MAX_PROBLEMS);
}

// What the badge shows for that many problems: the count, or nothing.
export const badgeText = (count) => (count > 0 ? (count > 9 ? '9+' : String(count)) : '');

// One line for the popup.
export function problemsSummary(list) {
  if (!list?.length) return '';
  if (list.length === 1) return list[0].text;
  return `${list.length} things went wrong while ClipSnatcher was out of sight. Newest first: ${list.map((p) => p.text).join(' • ')}`;
}
