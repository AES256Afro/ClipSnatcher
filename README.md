# ClipSnatcher

A Chrome extension for saving videos from X/Twitter, Reddit and Facebook posts, with a searchable download history kept on your computer. It has no servers and no analytics, and it collects nothing.

## Install (about 1 minute)

1. Get the code:
   ```bash
   git clone https://github.com/AES256Afro/ClipSnatcher.git ~/Projects/ClipSnatcher
   ```
   On Windows, in PowerShell:
   ```powershell
   git clone https://github.com/AES256Afro/ClipSnatcher.git "$HOME\Projects\ClipSnatcher"
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `ClipSnatcher/extension` folder.
5. Pin ClipSnatcher from the puzzle-piece menu so its icon stays in the toolbar.

To update later, run `git pull` in the folder, then click the reload arrow on ClipSnatcher in `chrome://extensions`.

**Optional: copy a video and paste it into Discord.** Install the small copy helper once. No admin rights are needed.

- **macOS**, in Terminal:
  ```bash
  bash ~/Projects/ClipSnatcher/native-helper/install.sh
  ```
  To remove it, run `native-helper/uninstall.sh`.
- **Windows**: double-click `install.cmd` in the `native-helper\windows` folder, or run this in PowerShell:
  ```powershell
  powershell -ExecutionPolicy Bypass -File "$HOME\Projects\ClipSnatcher\native-helper\windows\install.ps1"
  ```
  It works for Chrome, Edge and Brave. To remove it, double-click `uninstall.cmd` in the same folder.

Then open ClipSnatcher settings and click **Switch on the copy helper**. Chrome asks once for permission to talk to it.

## What's in this repo

| Path | What it is |
|---|---|
| `extension/` | The Chrome extension (Manifest V3, plain JavaScript, no build step) |
| `extension/lib/resolve.js` | Finds the video file for X, Reddit and Facebook links |
| `extension/lib/mux.js` | Joins Reddit's separate video and audio into one MP4 without re-encoding |
| `extension/lib/store.js` | Settings and history, kept in `chrome.storage.local` |
| `extension/lib/names.js` | File and folder naming, shared by saving and the Settings preview |
| `extension/lib/ui.js` | History rows, the More menu and row actions, shared by the popup and history page |
| `native-helper/` | Optional macOS clipboard helper and its install/uninstall scripts |
| `native-helper/windows/` | The same helper for Windows (a PowerShell script) and its install/uninstall scripts |
| `test/` | Automated tests (`npm test`) |
| `browser-tests/` | Checks in real Chrome, with local stand-ins for Reddit and an outside host (`npm run test:browser`) |
| `docs/` | The audit plan |

## Three ways to save a video

- **Hover:** point at a video on X, Reddit or Facebook and click the **Save** button that appears in its top-right corner.
- **Right-click:** right-click a video or a post link and choose the **Save video** item marked ClipSnatcher.
- **Paste:** click the toolbar icon (or press `Alt+Shift+V`), paste a post link, and press **Save**. If the current tab is already a post, its link is filled in for you. You can paste up to 20 links at once; they keep saving even if you close the popup, and it shows a summary when you next open it.
- **Keyboard:** `Alt+Shift+S` saves the video in the current tab. `Alt+Shift+C` (`Alt+Shift+D` on Windows, where Chrome doesn't allow Alt+Shift+C) copies the last saved video to the clipboard (macOS and Windows, needs the helper). Change the keys at `chrome://extensions/shortcuts`.

If you save a post you already have, ClipSnatcher says so and offers **Show in folder** or **Save again**.

## When something goes wrong

If a save fails while you're looking elsewhere (a Reddit merge that fails after you closed the tab, a download that breaks half-way), the toolbar icon shows a red count until you open ClipSnatcher or its history, which say what went wrong. In Settings you can also switch on a system notification for these; Chrome asks for permission to show notifications when you do.

## Quality and size

In Settings, choose **Best available**, **Smaller** (720p or the next size down), or **the best version under N MB**. The last one is for chat apps with an upload limit: ClipSnatcher checks each version's size with the site and saves the best one that fits, or the smallest if none does, and tells you its size.

## Favourites, notes and backups

Star a video and add a short note from its **More** menu; notes are searchable, and **Favourites** in history shows only starred videos. **Back up history** in Settings saves everything (entries, notes, favourites, thumbnails, not the videos) to one file, and **Restore from a backup** adds it back on this or another computer. **Clear history** can be undone from Settings until you close Chrome.

## Where files go

Files are saved to `Downloads/ClipSnatcher/<Site>/<author> - <post title> [id].mp4`. You can change the folder name and turn the per-site subfolders off in Settings.

Chrome extensions can only save inside Chrome's download location. To put everything somewhere else, change **Location** under Chrome Settings → Downloads. Also turn off "Ask where to save each file" there, or Chrome will ask you every time.

## History

Click the clock icon in the popup. You can search by post title, author, site or link, and filter by site.

Each row shows what you can do with that video right now:

- **Finished:** click the thumbnail (or **Play**) to play it, **Show in folder** to find the file, and **Copy** to put the video file on your clipboard so ⌘V (Ctrl+V on Windows) in Discord attaches it. Copy needs the helper; without it, the file is shown in Finder or File Explorer, where copying it and pasting into Discord does the same thing.
- **Still downloading, or a Reddit video being merged:** the row shows the percentage.
- **Failed, or the file was moved or deleted:** **Download again**, with the reason shown.
- **Finished, but Chrome's own download list was cleared:** **Copy path**, since Chrome can no longer open the file itself.

The **More** menu (the three dots) has the rest: open the original post, copy the post link, copy the file path, download again, remove the entry (with **Undo**), and delete the file.

**Tidy up** at the top of the page finds entries whose file has been moved or deleted and offers to remove them. Chrome only re-checks files every 10 seconds, so this takes about that long.

## How each site works

| Site | Method | Reliability |
|---|---|---|
| X / Twitter | The public embed API that X uses for embedded posts. Picks the highest-quality MP4. | Solid. Protected and age-restricted posts won't work. |
| Reddit | Uses Reddit's own MP4 that already includes sound. If that isn't available, it downloads the separate video and audio tracks and joins them in your browser. Nothing is re-encoded, so quality is unchanged. | Good |
| Facebook | Reads the video address from the post's page, using your login. | Best effort. Facebook changes its pages often, and private videos need you to be logged in. |
| Any site | Right-clicking a video whose file address is visible saves it directly. | Depends on the site |

## Privacy

- Network requests go to the site hosting the post you chose, to fetch that video and a small thumbnail. If the video file sits on a different host, you are asked before anything is downloaded from it.
- Your history (titles, links, the video's address, file locations and small thumbnails) is stored in `chrome.storage.local` in this Chrome profile. You can export it or clear it in Settings.
- The copy helper is a small script: `native-helper/clipsnatcher-helper.js` on macOS, `native-helper/windows/clipsnatcher-helper.ps1` on Windows. It accepts three commands: ping, copy a video file, and show a file in Finder or File Explorer. Chrome only lets the extension IDs it was installed for call it, and it only accepts video files that exist on your computer (on Windows, on one of its drives, not a network share). It makes no network connections.

## What ClipSnatcher will not do

- **Guess.** If a link or a video can't be tied to one post, it asks you to open the post instead of saving whatever video it finds first.
- **Download from an unexpected host without asking.** A site's videos come from that site's own video host. If a post points somewhere else, you are told which host and asked first. The question is asked in the popup, where a web page can't answer it for you. "Download again" reuses a host you already agreed to. If a site's video address redirects to another host, the download is stopped and the file removed.
- **Run in incognito windows.**

Only save videos you have the right to download.

## Development

The extension has no build step: `extension/` is loaded into Chrome as it is. Node 20.3 or later is only needed to run the checks. `npm ci` installs the two tools the type check uses (TypeScript and Chrome's type definitions); nothing from them ends up in the extension.

```bash
npm test              # the automated tests
npm run check         # every file parses, the manifest is valid, versions match, every permission is explained
npm run typecheck     # checks the extension's JavaScript against its JSDoc types and Chrome's APIs
npm run build         # makes dist/clipsnatcher-<version>.zip for the Chrome Web Store
npm run test:browser  # checks in a throwaway, invisible Chrome (needs Chrome, OpenSSL and internet)
```

GitHub runs the first four on every push, and runs the tests again on Windows, where the Windows copy helper's tests run too. One of those tests checks the real clipboard, so it is off unless you ask for it (in PowerShell: `$env:CLIPSNATCHER_CLIPBOARD_TEST = 1; npm test`); it replaces whatever you had copied. The browser checks run locally; see `browser-tests/run.mjs`.

### Releasing a new version

1. Set the new version in `extension/manifest.json` and `package.json`.
2. Add a section for it at the top of `CHANGELOG.md`.
3. Run `npm run check && npm run typecheck && npm test && npm run build`, and `npm run test:browser`.
4. Commit, then tag it: `git tag v<version>` and push the tag with the commit.
5. Upload `dist/clipsnatcher-<version>.zip` to the Chrome Web Store.

## Licence

MIT. See [LICENSE](LICENSE).
