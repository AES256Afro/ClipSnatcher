// Quick consistency checks run by CI and before a release:
// every script parses, the manifest is valid, and the version is the same everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const rel = (p) => path.relative(root, p);

function walk(dir, ext) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (d.name.startsWith('.')) return [];
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p, ext) : p.endsWith(ext) ? [p] : [];
  });
}

for (const file of walk(path.join(root, 'extension'), '.js')) {
  try { execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' }); } catch (e) { problems.push(`${rel(file)} does not parse:\n${e.stderr}`); }
}
for (const file of [...walk(path.join(root, 'scripts'), '.sh'), ...walk(path.join(root, 'native-helper'), '.sh')]) {
  try { execFileSync('bash', ['-n', file], { stdio: 'pipe' }); } catch (e) { problems.push(`${rel(file)} does not parse:\n${e.stderr}`); }
}

let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8')); } catch (e) { problems.push(`extension/manifest.json is not valid JSON: ${e.message}`); }
if (manifest) {
  for (const f of [manifest.background?.service_worker, ...(manifest.content_scripts || []).flatMap((c) => c.js || []), manifest.action?.default_popup, manifest.options_page, ...Object.values(manifest.icons || {})]) {
    if (f && !fs.existsSync(path.join(root, 'extension', f))) problems.push(`manifest.json names ${f}, which does not exist`);
  }
  const version = manifest.version;
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== version) problems.push(`package.json says ${pkg.version}, manifest.json says ${version}`);
  const changelog = fs.existsSync(path.join(root, 'CHANGELOG.md')) ? fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8') : '';
  if (!changelog.includes(`## ${version}`)) problems.push(`CHANGELOG.md has no "## ${version}" section`);
}

if (problems.length) {
  console.error(problems.map((p) => '✖ ' + p).join('\n'));
  process.exit(1);
}
console.log(`✔ all checks passed (version ${manifest.version})`);
