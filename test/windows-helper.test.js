// The Windows copy helper, spoken to the way Chrome does: through cmd.exe, with a 4-byte
// length before each JSON message. Runs only on Windows.
// The clipboard test replaces what's on your clipboard, so it only runs when asked for:
//   set CLIPSNATCHER_CLIPBOARD_TEST=1   (PowerShell: $env:CLIPSNATCHER_CLIPBOARD_TEST = 1)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const onWindows = process.platform === 'win32';
const skip = onWindows ? false : 'the Windows helper only runs on Windows';
const HELPER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native-helper/windows/clipsnatcher-helper.cmd');
const ORIGIN = 'chrome-extension://phdbcmaifcaagmfkmbdhokgmkldllajj/';

// Sends raw bytes and returns the parsed reply. Checks the reply is exactly one framed message.
function talkRaw(bytes) {
  return new Promise((resolve, reject) => {
    // The same command line Chrome uses to start a helper on Windows.
    const child = spawn('cmd.exe', ['/d', '/s', '/c', `""${HELPER}" ${ORIGIN} --parent-window=0"`], { windowsVerbatimArguments: true, windowsHide: true });
    const out = [];
    let err = '';
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', () => {
      const buf = Buffer.concat(out);
      if (buf.length < 4) return reject(new Error(`no reply (stderr: ${err.trim()})`));
      const len = buf.readUInt32LE(0);
      if (buf.length !== 4 + len) return reject(new Error(`reply is ${buf.length} bytes, header says ${len} + 4`));
      resolve(JSON.parse(buf.subarray(4).toString('utf8')));
    });
    child.stdin.end(bytes);
  });
}

function frame(json) {
  const body = Buffer.from(json, 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  return Buffer.concat([head, body]);
}
const talk = (msg) => talkRaw(frame(JSON.stringify(msg)));

let dir;
function tempDir() {
  if (!dir) {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsnatcher-helper-'));
    fs.writeFileSync(path.join(dir, 'clip one.mp4'), 'not really a video');
    fs.writeFileSync(path.join(dir, 'clip é.webm'), 'not really a video');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'text');
    fs.mkdirSync(path.join(dir, 'folder.mp4'));
    process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
  }
  return dir;
}

test('Windows helper: ping answers with its version', { skip }, async () => {
  const r = await talk({ action: 'ping' });
  assert.equal(r.ok, true);
  assert.match(r.version, /^\d+\.\d+\.\d+$/);
});

test('Windows helper: messages that are not objects, or not JSON, are refused', { skip }, async () => {
  assert.deepEqual(await talk('just a string'), { ok: false, error: 'Bad message.' });
  assert.deepEqual(await talk([1, 2]), { ok: false, error: 'Bad message.' });
  const r = await talkRaw(frame('not json'));
  assert.equal(r.ok, false);
});

test('Windows helper: an empty or oversized message gets an error reply, not a hang', { skip }, async () => {
  assert.equal((await talkRaw(Buffer.alloc(0))).ok, false);
  const head = Buffer.alloc(4);
  head.writeUInt32LE(2 * 1024 * 1024);
  assert.equal((await talkRaw(head)).ok, false);
});

test('Windows helper: only full paths on a drive are accepted', { skip }, async () => {
  for (const p of [
    'clip.mp4',                       // relative
    '\\Users\\x\\clip.mp4',           // no drive
    '\\\\server\\share\\clip.mp4',    // network
    '\\\\?\\C:\\x\\clip.mp4',         // device path
    'C:/x/clip.mp4',                  // forward slashes
    'C:\\x\\clip.mp4:hidden',         // alternate stream
    'C:\\x\\cl"ip.mp4',               // quote
    'C:\\x\\cl*p.mp4',                // wildcard
    'C:\\x\\clip\n.mp4',              // control character
    'C:\\' + 'a'.repeat(4100) + '.mp4',
    42,
    null,
  ]) {
    assert.deepEqual(await talk({ action: 'copyFile', path: p }), { ok: false, error: 'Bad path.' }, `path ${JSON.stringify(p)?.slice(0, 40)}`);
  }
});

test('Windows helper: only video files that exist are accepted', { skip }, async () => {
  const d = tempDir();
  assert.deepEqual(await talk({ action: 'copyFile', path: path.join(d, 'notes.txt') }), { ok: false, error: 'Only video files can be copied.' });
  assert.deepEqual(await talk({ action: 'reveal', path: path.join(d, 'notes.txt') }), { ok: false, error: 'Only video files can be copied.' });
  const notFound = { ok: false, error: 'File not found. It may have been moved or deleted.' };
  assert.deepEqual(await talk({ action: 'copyFile', path: path.join(d, 'missing.mp4') }), notFound);
  assert.deepEqual(await talk({ action: 'copyFile', path: path.join(d, 'folder.mp4') }), notFound);
  assert.deepEqual(await talk({ action: 'copyFile', path: path.join(d, 'no-such-folder', 'clip.mp4') }), notFound);
  // ".." is settled before the checks: this names notes.txt\..\missing.mp4 = missing.mp4.
  assert.deepEqual(await talk({ action: 'copyFile', path: path.join(d, 'notes.txt') + '\\..\\missing.mp4' }), notFound);
  // A video named through "..": still the same file, so it's fine.
  assert.deepEqual(await talk({ action: 'nonsense', path: path.join(d, 'folder.mp4') + '\\..\\clip one.mp4' }), { ok: false, error: 'Unknown action.' });
});

test('Windows helper: actions are case-sensitive', { skip }, async () => {
  assert.equal((await talk({ action: 'PING' })).ok, false);
  assert.deepEqual(await talk({ action: 'COPYFILE', path: path.join(tempDir(), 'clip one.mp4') }), { ok: false, error: 'Unknown action.' });
});

test('Windows helper: copyFile puts the video on the clipboard as a file, marked as a copy', { skip: skip || (process.env.CLIPSNATCHER_CLIPBOARD_TEST ? false : 'replaces your clipboard; set CLIPSNATCHER_CLIPBOARD_TEST=1 to run') }, async () => {
  for (const name of ['clip one.mp4', 'clip é.webm']) {
    const file = path.join(tempDir(), name);
    assert.deepEqual(await talk({ action: 'copyFile', path: file }), { ok: true });
    // Read it back in a new process: the helper has exited, so this also shows the copy outlives it.
    const read = execFileSync('powershell.exe', ['-NoProfile', '-Sta', '-Command',
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; ' +
      '$d = [Windows.Forms.Clipboard]::GetDataObject(); ' +
      '@{ files = @([Windows.Forms.Clipboard]::GetFileDropList()); effect = @($d.GetData("Preferred DropEffect").ToArray()) } | ConvertTo-Json -Compress'], { encoding: 'utf8' });
    const got = JSON.parse(read);
    assert.deepEqual(got.files, [file]);
    assert.deepEqual(got.effect, [5, 0, 0, 0]);
  }
});
