// The copy helper as a Chrome Web Store user gets it: the release zip, unzipped where
// Settings says, installed with the exact command Settings shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { helperSetup, helperZipName, DEV_ID, REPO } from '../extension/lib/helper-setup.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';
const has = (cmd) => spawnSync(cmd, ['-v'], { stdio: 'ignore' }).error === undefined;
const canBuild = process.platform !== 'win32' && has('zip') && has('unzip');

test('helperSetup: the unpacked copy installs from the project folder, with no ID', () => {
  const mac = helperSetup('mac', DEV_ID);
  assert.equal(mac.fromProject, true);
  assert.equal(mac.download, '');
  assert.equal(mac.command, 'bash ~/Projects/ClipSnatcher/native-helper/install.sh');
  assert.match(helperSetup('win', DEV_ID).command, /native-helper\\windows\\install\.ps1"$/);
});

test('helperSetup: any other copy downloads the release zip and passes its own ID', () => {
  const mac = helperSetup('mac', STORE_ID);
  assert.equal(mac.fromProject, false);
  assert.equal(mac.download, `${REPO}/releases/latest/download/clipsnatcher-helper-macos.zip`);
  assert.equal(mac.command, `bash ~/Downloads/clipsnatcher-helper-macos/install.sh ${STORE_ID}`);
  const win = helperSetup('win', STORE_ID);
  assert.equal(win.download, `${REPO}/releases/latest/download/clipsnatcher-helper-windows.zip`);
  assert.equal(win.command, `powershell -ExecutionPolicy Bypass -File "$HOME\\Downloads\\clipsnatcher-helper-windows\\install.ps1" ${STORE_ID}`);
  assert.equal(helperZipName('win'), 'clipsnatcher-helper-windows.zip');
});

test('helperSetup: an ID that isn’t a Chrome extension ID never reaches the command', () => {
  assert.equal(helperSetup('mac', 'x; rm -rf ~').command, 'bash ~/Downloads/clipsnatcher-helper-macos/install.sh');
  assert.equal(helperSetup('win', '"; evil').command.includes('evil'), false);
});

test('release zips: built with the files the install steps need, at the top level', { skip: !canBuild && 'needs bash, zip and unzip (not on Windows)' }, () => {
  execFileSync('bash', [path.join(root, 'scripts/build-helper-zips.sh')], { stdio: 'pipe' });
  const list = (name) => execFileSync('unzip', ['-Z1', path.join(root, 'dist', name)], { encoding: 'utf8' }).trim().split('\n').sort();
  assert.deepEqual(list(helperZipName('mac')), ['README.txt', 'clipsnatcher-helper.js', 'install.sh', 'uninstall.sh']);
  assert.deepEqual(list(helperZipName('win')), ['README.txt', 'clipsnatcher-helper.cmd', 'clipsnatcher-helper.ps1', 'install.cmd', 'install.ps1', 'uninstall.cmd', 'uninstall.ps1']);
  const cmd = execFileSync('unzip', ['-p', path.join(root, 'dist', helperZipName('win')), 'install.cmd']);
  assert.ok(cmd.includes('\r\n'), 'Windows scripts keep Windows line endings');
});

test('macOS: the command from Settings installs the downloaded helper for that ID, and uninstall removes it', { skip: !canBuild && 'needs bash, zip and unzip (not on Windows)' }, () => {
  execFileSync('bash', [path.join(root, 'scripts/build-helper-zips.sh')], { stdio: 'pipe' });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cs-home-'));
  try {
    const { command } = helperSetup('mac', STORE_ID);
    const folder = path.join(home, 'Downloads', 'clipsnatcher-helper-macos');
    fs.mkdirSync(folder, { recursive: true });
    execFileSync('unzip', ['-q', path.join(root, 'dist', helperZipName('mac')), '-d', folder]);
    execFileSync('bash', ['-c', command], { env: { ...process.env, HOME: home }, stdio: 'pipe' });

    const support = path.join(home, 'Library', 'Application Support');
    const manifestPath = path.join(support, 'Google/Chrome/NativeMessagingHosts/com.clipsnatcher.helper.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.deepEqual(manifest.allowed_origins, [`chrome-extension://${STORE_ID}/`], 'only the copy that ran the command');
    assert.equal(manifest.path, path.join(support, 'ClipSnatcher', 'clipsnatcher-helper.js'));
    assert.ok(fs.statSync(manifest.path).mode & 0o100, 'the installed helper can be run');

    if (process.platform === 'darwin' && has('osascript')) {
      // Ask it what Chrome asks first: a 4-byte length, then the JSON message.
      const body = Buffer.from(JSON.stringify({ action: 'ping' }));
      const len = Buffer.alloc(4); len.writeUInt32LE(body.length);
      const out = spawnSync(manifest.path, [], { input: Buffer.concat([len, body]), timeout: 20000 });
      assert.equal(out.status, 0, String(out.stderr));
      const reply = JSON.parse(out.stdout.subarray(4, 4 + out.stdout.readUInt32LE(0)).toString());
      assert.equal(reply.ok, true);
      assert.match(reply.version, /^\d+\.\d+\.\d+$/);
    }

    execFileSync('bash', [path.join(folder, 'uninstall.sh')], { env: { ...process.env, HOME: home }, stdio: 'pipe' });
    assert.equal(fs.existsSync(manifestPath), false);
    assert.equal(fs.existsSync(manifest.path), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
