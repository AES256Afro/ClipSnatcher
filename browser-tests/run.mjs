// Runs the real-Chrome checks: loads the extension into a throwaway Chrome profile and
// drives it over the DevTools protocol. Works on macOS, Windows and Linux.
//
//   node browser-tests/run.mjs                 all three suites
//   node browser-tests/run.mjs page upgrade    only some of them
//
// Needs: Chrome (set CHROME_PATH if it isn't found), OpenSSL (Git for Windows includes one;
// set OPENSSL if it isn't found), and an internet connection (one suite saves a real public
// X post). Reddit, Facebook and an "outside" host are local stand-ins (fake-sites.mjs).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { regularMp4, sample } from '../test/helpers/mp4.js';
import { startFakeSites } from './fake-sites.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(here, '../extension');
const CDP_PORT = Number(process.env.CS_CDP_PORT) || 9333;
const FAKE_PORT = Number(process.env.CS_FAKE_PORT) || 8443;
const SUITES = ['downloads', 'page', 'upgrade'];
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : SUITES;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    path.join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found. Set CHROME_PATH to chrome.exe (or the Chrome binary).');
  return found;
}

function findOpenssl() {
  const candidates = [process.env.OPENSSL, 'openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'].filter(Boolean);
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'pipe' }); return c; } catch { /* next */ }
  }
  throw new Error('OpenSSL not found. Install Git for Windows (it includes one) or set OPENSSL to openssl.exe.');
}

async function waitForChrome() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`); if (r.ok) return; } catch { /* not yet */ }
    await sleep(250);
  }
  throw new Error(`Chrome didn't open its debugging port ${CDP_PORT}.`);
}

function runNode(file, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; process.stdout.write(d); });
    child.stderr.on('data', (d) => process.stderr.write(d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

const chrome = findChrome();
const openssl = findOpenssl();
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'clipsnatcher-browser-'));
console.log(`Chrome:  ${chrome}\nWork in: ${work}\n`);

// A throwaway certificate for the stand-in sites (Chrome is told to ignore certificate errors).
const keyFile = path.join(work, 'key.pem'), certFile = path.join(work, 'cert.pem');
execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyFile, '-out', certFile, '-days', '2', '-subj', '/CN=x.com'], { stdio: 'pipe' });

// Synthetic video-only and audio-only files for the stand-in Reddit.
const media = {
  'vf.mp4': regularMp4({ handler: 'vide', samples: Array.from({ length: 30 }, (_, i) => sample(i, 2000)) }),
  'af.mp4': regularMp4({ handler: 'soun', samples: Array.from({ length: 20 }, (_, i) => sample(100 + i, 300)) }),
};
const server = startFakeSites({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile), media, port: FAKE_PORT });

const MAP = ['x.com', 'www.reddit.com', 'v.redd.it', 'evil.example'].map((h) => `MAP ${h} 127.0.0.1:${FAKE_PORT}`).join(', ');
const results = [];
for (const suite of wanted) {
  if (!SUITES.includes(suite)) { console.error(`Unknown suite "${suite}". Choose from: ${SUITES.join(', ')}`); process.exitCode = 2; continue; }
  console.log(`\n=== ${suite} ===`);
  const profile = path.join(work, `profile-${suite}`), downloads = path.join(work, `downloads-${suite}`);
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.mkdirSync(downloads, { recursive: true });
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true } }));
  const browser = spawn(chrome, [
    '--headless=new', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-extension-debugging', `--remote-debugging-port=${CDP_PORT}`,
    `--host-resolver-rules=${MAP}`, '--ignore-certificate-errors', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    await waitForChrome();
    const { code, out } = await runNode(path.join(here, `${suite}.mjs`), { CS_EXT_DIR: EXT_DIR, CS_CDP_PORT: String(CDP_PORT), CS_DOWNLOADS: downloads });
    const m = out.match(/(\d+) passed, (\d+) failed/);
    results.push({ suite, passed: m ? Number(m[1]) : 0, failed: m ? Number(m[2]) : 1, code });
  } catch (e) {
    console.error(String(e?.message || e));
    results.push({ suite, passed: 0, failed: 1, code: 1 });
  } finally {
    browser.kill();
    await sleep(1500);   // let Chrome release the profile and the debugging port
  }
}
server.close();
fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

console.log('\n=== summary ===');
for (const r of results) console.log(`${r.failed || r.code ? '✖' : '✔'} ${r.suite}: ${r.passed} passed, ${r.failed} failed`);
if (results.some((r) => r.failed || r.code)) process.exitCode = 1;
