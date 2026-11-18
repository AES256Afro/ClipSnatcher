#!/usr/bin/osascript -l JavaScript
// ClipStash copy helper (macOS). Chrome starts this when you press "Copy" in ClipStash.
// It reads one message from Chrome and can only do three things:
//   ping                -> reply with version
//   copyFile {path}     -> put that file on the clipboard (like Cmd+C in Finder)
//   reveal   {path}     -> show that file in Finder
// It only accepts video files that exist. No network access, nothing is logged.
ObjC.import('Foundation');
ObjC.import('AppKit');

const VERSION = '1.0.0';
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv)$/i;

function b64ToBytes(b64) {
  const s = $.NSData.alloc.initWithBase64EncodedStringOptions(b64, 0);
  return s;
}

function readMessage() {
  const stdin = $.NSFileHandle.fileHandleWithStandardInput;
  const head = stdin.readDataOfLength(4);
  if (head.length < 4) return null;
  // Decode the 4-byte little-endian length via base64 (JXA has no direct byte access).
  const raw = atobBytes(head.base64EncodedStringWithOptions(0).js);
  const len = raw[0] | (raw[1] << 8) | (raw[2] << 16) | (raw[3] << 24);
  if (len <= 0 || len > 1024 * 1024) return null;
  const body = stdin.readDataOfLength(len);
  return JSON.parse($.NSString.alloc.initWithDataEncoding(body, $.NSUTF8StringEncoding).js);
}

function writeMessage(obj) {
  const json = $.NSString.alloc.initWithUTF8String(JSON.stringify(obj));
  const data = json.dataUsingEncoding($.NSUTF8StringEncoding);
  const n = data.length;
  const head = btoaBytes([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255]);
  const out = $.NSMutableData.dataWithData(b64ToBytes(head));
  out.appendData(data);
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(out);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function atobBytes(s) {
  const out = []; let buf = 0, bits = 0;
  for (const c of s.replace(/=+$/, '')) {
    buf = (buf << 6) | B64.indexOf(c); bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return out;
}
function btoaBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = bytes.slice(i, i + 3);
    const n = (a << 16) | (b << 8) | c;
    s += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return s;
}

function checkPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return 'Bad path.';
  if (!VIDEO_EXT.test(p)) return 'Only video files can be copied.';
  const isDir = Ref();
  if (!$.NSFileManager.defaultManager.fileExistsAtPathIsDirectory(p, isDir) || isDir[0]) return 'File not found. It may have been moved or deleted.';
  return null;
}

function handle(msg) {
  if (!msg || typeof msg !== 'object') return { ok: false, error: 'Bad message.' };
  if (msg.action === 'ping') return { ok: true, version: VERSION };
  const err = checkPath(msg.path);
  if (err) return { ok: false, error: err };
  const url = $.NSURL.fileURLWithPath(msg.path);
  if (msg.action === 'copyFile') {
    const pb = $.NSPasteboard.generalPasteboard;
    pb.clearContents;
    const ok = pb.writeObjects($.NSArray.arrayWithObject(url));
    return ok ? { ok: true } : { ok: false, error: 'macOS refused the clipboard write.' };
  }
  if (msg.action === 'reveal') {
    $.NSWorkspace.sharedWorkspace.activateFileViewerSelectingURLs($.NSArray.arrayWithObject(url));
    return { ok: true };
  }
  return { ok: false, error: 'Unknown action.' };
}

function run() {
  let reply;
  try { reply = handle(readMessage()); } catch (e) { reply = { ok: false, error: String(e) }; }
  writeMessage(reply);
}
