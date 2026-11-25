// Quick consistency checks run by CI and before a release:
// every script parses, the manifest is valid, and the version is the same everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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

// The Windows helper's scripts. Windows PowerShell 5.1 reads a script without a byte-order
// mark as ANSI, and cmd.exe uses the console code page, so they must stay plain ASCII.
const ps1 = walk(path.join(root, 'native-helper'), '.ps1');
for (const file of [...ps1, ...walk(path.join(root, 'native-helper'), '.cmd')]) {
  if (/[^\x00-\x7f]/.test(fs.readFileSync(file, 'utf8'))) problems.push(`${rel(file)} has non-ASCII characters, which Windows would misread`);
}
// Parsed with whichever PowerShell is installed: Windows has powershell, GitHub's Linux runners have pwsh.
const pwsh = ['pwsh', 'powershell'].find((s) => { try { execFileSync(s, ['-NoProfile', '-Command', 'exit 0'], { stdio: 'pipe' }); return true; } catch { return false; } });
if (!pwsh && ps1.length) console.warn('! PowerShell not found, so the .ps1 files were not parsed');
for (const file of pwsh ? ps1 : []) {
  const parse = `$e = $null; [void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}', [ref]$null, [ref]$e); $e | ForEach-Object { $_.ToString() }`;
  const errors = execFileSync(pwsh, ['-NoProfile', '-Command', parse], { encoding: 'utf8' }).trim();
  if (errors) problems.push(`${rel(file)} does not parse:\n${errors}`);
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

  // Every permission is explained to users (privacy policy) and to store reviewers (the
  // listing's justification table). A new permission without both fails here.
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const privacy = read('PRIVACY.md');
  const listing = read('store/listing.md');
  for (const perm of [...(manifest.permissions || []), ...(manifest.optional_permissions || [])]) {
    if (!privacy.includes('`' + perm + '`')) problems.push(`PRIVACY.md doesn't explain the "${perm}" permission (write it as \`${perm}\`)`);
    if (!new RegExp(`^\\| ${perm.replace('.', '\\.')}( \\(optional\\))? \\|`, 'm').test(listing)) problems.push(`store/listing.md has no justification row for the "${perm}" permission`);
  }

  // The development extension ID follows from the manifest's "key". The copy helper's
  // installers and the Settings page name it, so a new key must be carried to all of them.
  if (manifest.key) {
    const hash = createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest('hex');
    const devId = [...hash.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    for (const f of ['extension/options.js', 'native-helper/install.sh', 'native-helper/windows/install.ps1']) {
      const ids = read(f).match(/\b[a-p]{32}\b/g) || [];
      if (!ids.includes(devId)) problems.push(`${f} doesn't name the development extension ID ${devId} (from the manifest key)`);
      for (const other of new Set(ids.filter((x) => x !== devId))) problems.push(`${f} names ${other}, but the manifest key gives ${devId}`);
    }
  }
}

if (problems.length) {
  console.error(problems.map((p) => '✖ ' + p).join('\n'));
  process.exit(1);
}
console.log(`✔ all checks passed (version ${manifest.version})`);
