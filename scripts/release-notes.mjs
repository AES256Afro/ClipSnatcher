// Prints one version's section of CHANGELOG.md, for the GitHub release's notes.
//   node scripts/release-notes.mjs 1.6.0
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The lines under "## <version>" up to the next "## " heading, without that heading.
export function notesFor(changelog, version) {
  const lines = String(changelog).split(/\r?\n/);
  const start = lines.findIndex((l) => l === `## ${version}` || l.startsWith(`## ${version} `));
  if (start < 0) return null;
  const end = lines.findIndex((l, i) => i > start && l.startsWith('## '));
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const notes = notesFor(fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) { console.error(`CHANGELOG.md has no "## ${version}" section`); process.exit(1); }
  console.log(notes + '\n\n**Copy helper:** to paste saved videos into Discord, download `clipsnatcher-helper-macos.zip` or `clipsnatcher-helper-windows.zip` below and follow "Copy helper" in ClipSnatcher\'s Settings.');
}
