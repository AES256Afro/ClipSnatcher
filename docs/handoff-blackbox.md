# Handoff: ClipSnatcher on BlackBox (Windows 11)

This is for whoever picks the project up on BlackBox, a Windows 11 PC: a Claude Code session started there, a session on the Mac working over SSH, or a person. It assumes no memory of earlier work. Read it top to bottom before changing anything.

## Where things stand

- **Repo:** https://github.com/AES256Afro/ClipSnatcher, branch `main`.
- **Version:** 1.4.0. All four milestones in [audit-plan.md](audit-plan.md) are done, except the two items below.
- **What it is:** a Chrome extension (Manifest V3, plain JavaScript, no build step) that saves videos from X, Reddit and Facebook posts and keeps a local, searchable history. Read the [README](../README.md) for what it does and the [CHANGELOG](../CHANGELOG.md) for how it got here.
- **Tests:** 134 automated tests (`npm test`) and 81 checks in real Chrome (`npm run test:browser`). All passed on macOS at the commit this file was added in. GitHub runs the automated tests on every push.

What is still missing, and why BlackBox:

1. **A Windows copy helper.** On macOS, an optional helper puts a saved video file on the clipboard so it pastes straight into Discord. There is no Windows version, because there was no Windows machine to build or test it on. **This is the main job.**
2. **Nothing has been tested on Windows yet.** The extension should work as it is, but nobody has run it there.
3. **Live Reddit and Facebook have never been tested.** Reddit refuses requests from the Mac's test setup, and all Reddit and Facebook tests so far used local stand-ins.

## Rules that must not be broken

These came out of several rounds of security review. Read [audit-plan.md](audit-plan.md) for the reasoning.

- **No servers, no tracking.** The extension only contacts the site hosting the post and that site's own video host. The copy helper makes no network connections at all.
- **Web pages are untrusted.** `extension/content.js` runs inside X, Reddit and Facebook. The background worker (`extension/background.js`) accepts only two messages from it (save a video, read one on/off setting). Everything else is accepted only from the extension's own pages. Don't add anything a page can reach.
- **Never download from a host the user didn't agree to.** A site's videos come from its own media host. Any other host needs a yes in the popup or history page, never on a web page.
- **The copy helper only touches video files that exist,** after following shortcuts and links. It accepts exactly three actions: `ping`, `copyFile`, `reveal`. Only the extension IDs it was installed for may call it.
- **Nothing in a backup file is trusted.** See `cleanImportedEntry` in `extension/lib/store.js`.

## Getting set up on BlackBox

1. Install, if not already there:
   - **Git for Windows**, which also provides `openssl`, needed by the browser tests.
   - **Node.js 22 LTS**.
   - **Google Chrome**.
2. Get the code and check it:
   ```powershell
   git clone https://github.com/AES256Afro/ClipSnatcher.git
   cd ClipSnatcher
   npm test
   npm run check
   npm run test:browser
   ```
   - `npm run test:browser` starts a throwaway, invisible Chrome, loads the extension and runs the 81 checks. It needs internet access, because one suite saves a real public X post.
   - If Chrome or OpenSSL isn't found, set `CHROME_PATH` or `OPENSSL` to the full path of `chrome.exe` or `openssl.exe`.
   - It uses ports 9333 and 8443 on 127.0.0.1. Set `CS_CDP_PORT` or `CS_FAKE_PORT` if either is taken.
3. **Report the results of step 2 before changing anything.** If anything fails on Windows, that is the first thing to fix. Path separators (`\` instead of `/`) are the most likely cause.

To load the extension into the real Chrome on BlackBox (for the manual checks at the end):
1. Open `chrome://extensions` and turn on Developer mode.
2. Click **Load unpacked** and choose the `extension` folder.

Its ID will be `phdbcmaifcaagmfkmbdhokgmkldllajj`, the same as on the Mac, because the ID is fixed by the `key` in `extension/manifest.json`.

## Task 1: the Windows copy helper

Work on a branch (for example `windows-helper`) and open a pull request rather than pushing to `main`. That's the owner's call to merge.

### What it must do

Do exactly what the macOS helper does. Read `native-helper/clipsnatcher-helper.js` (macOS, JavaScript for Automation) and `native-helper/install.sh` first.

**Chrome native messaging:** Chrome starts the helper for each message. The helper:
1. Reads a 4-byte little-endian length, then that many bytes of UTF-8 JSON.
2. Writes one reply in the same framing on standard output.
3. Exits.

It must reject lengths of 0 or over 1 MB. **Nothing else may reach standard output**, or Chrome sees a corrupt reply. In PowerShell, watch for stray pipeline output and progress records.

**Actions:**

| Action | Request | Reply |
|---|---|---|
| `ping` | `{ "action": "ping" }` | `{ "ok": true, "version": "1.1.0" }` |
| `copyFile` | `{ "action": "copyFile", "path": "C:\\Users\\…\\clip.mp4" }` | `{ "ok": true }`. The file is now on the clipboard as a file, like Ctrl+C in File Explorer, so Ctrl+V in Discord attaches it. |
| `reveal` | `{ "action": "reveal", "path": "…" }` | `{ "ok": true }`. File Explorer opens with the file selected (`explorer.exe /select,"<path>"`). |
| anything else | | `{ "ok": false, "error": "Unknown action." }` |

**Path checks**, before `copyFile` or `reveal`. Reply `{ ok: false, error }` with these messages, matching the macOS helper:
- Must be a string, absolute (`C:\…` or `\\server\…`), at most 4096 characters, with no control characters. Otherwise: `Bad path.`
- Follow symbolic links and junctions to the real file first. The check below applies to the real path.
- The real path must end in `.mp4`, `.m4v`, `.mov`, `.webm` or `.mkv` (any case). Otherwise: `Only video files can be copied.`
- It must exist and be a file, not a folder. Otherwise: `File not found. It may have been moved or deleted.`

**Clipboard:** `System.Windows.Forms.Clipboard.SetFileDropList` with one path. It needs a single-threaded apartment, so start PowerShell with `-STA`. Windows PowerShell 5.1 is always present on Windows 11, so target it rather than PowerShell 7.

### Suggested files

All under `native-helper/windows/`:
- `clipsnatcher-helper.ps1`: the helper.
- `clipsnatcher-helper.cmd`: what Chrome runs, for example `@powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -STA -File "%~dp0clipsnatcher-helper.ps1"`. Check that Chrome on Windows runs a `.cmd` host. If it doesn't, a tiny `.exe` is the fallback, but it needs a compiler and is best avoided.
- `install.ps1`:
  1. Copies the helper to `%LOCALAPPDATA%\ClipSnatcher\`.
  2. Writes the host manifest there. Its `name` is `com.clipsnatcher.helper` and its `path` is the full path of the `.cmd`.
  3. Registers the manifest by setting the default value of `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.clipsnatcher.helper` to the manifest's full path. Do the same for Edge (`HKCU\Software\Microsoft\Edge\NativeMessagingHosts\…`) and Brave (`HKCU\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\…`) when they're installed.
  4. Applies the same extension-ID rules as `install.sh`: with no arguments, allow only `phdbcmaifcaagmfkmbdhokgmkldllajj`; with arguments, allow only those IDs, each matching `^[a-p]{32}$`.
  5. Needs no administrator rights.
- `uninstall.ps1`: removes only what `install.ps1` created.

### Changes in the extension

Today the Copy feature is switched off for anything that isn't a Mac. Switch it on for Windows:
- `extension/lib/ui.js`:
  - `platform.mac` decides whether Copy and Show in folder appear. Replace it with something like `platform.helper` (Mac or Windows).
  - `fileManager()` and `copyKeys()` should say "File Explorer" and "Ctrl+C" on Windows.
- `extension/options.js`, `setUpHelper()`, and `extension/options.html`:
  - The helper section is only shown on a Mac. Show it on Windows too.
  - Use Windows wording.
  - Show the Windows install command: `powershell -ExecutionPolicy Bypass -File <repo>\native-helper\windows\install.ps1`, plus the extension ID when it isn't the development ID, as the Mac command already does.
- `extension/background.js` needs no change: it sends the same messages on every system.
- Update the README, `PRIVACY.md` and `CHANGELOG.md` (as version 1.5.0), and bump the version in `extension/manifest.json` and `package.json`. `npm run check` fails if they don't match.

### Tests

- Add `test/windows-helper.test.js`, which runs only on Windows (`test.skip` elsewhere). It starts the `.cmd` with framed messages and checks:
  - `ping`.
  - A relative path.
  - A non-video file.
  - A missing file.
  - A shortcut (symbolic link) named `x.mp4` that points at a `.txt` file.
  - A zero length and an oversized length.
  - That nothing but the framed reply reaches standard output.
- **Over SSH, the clipboard can't be checked:** an SSH session can't reach the logged-in user's clipboard. The `copyFile` check therefore needs someone at BlackBox's desktop. Run the helper there and check with `Get-Clipboard -Format FileDropList`, then paste into Discord once.

### Done means

- [ ] `npm test`, `npm run check` and `npm run test:browser` pass on BlackBox and on the Mac.
- [ ] The new Windows helper tests pass on BlackBox.
- [ ] In real Chrome on BlackBox:
  - Settings shows the helper as installed.
  - **Copy** on a saved video, then Ctrl+V in Discord, attaches the video.
  - **Show in folder** opens File Explorer with the file selected.
- [ ] With the helper uninstalled, Copy shows the file in File Explorer and says to press Ctrl+C there.
- [ ] A pull request describing what was tested and what wasn't.

## Task 2: live Reddit (and Facebook, if logged in)

The real Chrome on BlackBox is a good place to try the live sites.

1. **Quick diagnostic.** In PowerShell, check whether Reddit blocks this network:
   ```powershell
   curl.exe -s -o NUL -w "%{http_code}" -A "Mozilla/5.0" https://www.reddit.com/r/videos/top.json?limit=1
   ```
   `200` means it works; `403` means Reddit blocks it.
2. **In Chrome, with the extension loaded:**
   - Save a Reddit video post with sound from its own page, from the Save button in the feed, and by pasting a short link (`redd.it/…` or `reddit.com/r/…/s/…`).
   - Confirm the saved file plays with sound.
3. **Facebook:** only if the owner wants to log in on BlackBox. Try a reel, a `/videos/` link and a `/watch/?v=` link.

Report what worked and what didn't, with the exact message ClipSnatcher showed.

## Things to know

- **Keep changes small and reviewed.** Every batch so far went through an independent review before it was committed, and every review found real problems.
- **Commit messages** in this project end with a `Co-Authored-By:` line when an AI assistant wrote the change.
- **Not on Windows:** the macOS helper's own tests (`native-helper/clipsnatcher-helper.js`) and its permission prompt. Leave them alone.
- **Open item from earlier:** in one of several runs, "Tidy up" in the history page reported one more missing file than expected. It never happened again, and the cause is unknown. If it shows up on Windows, note exactly what was in the history at the time.
