# ClipSnatcher

A Chrome extension for saving videos from X/Twitter, Reddit and Facebook posts, with a searchable download history kept on your computer. It has no servers and no analytics, and it collects nothing.

## Install (about 1 minute)

1. Get the code:
   ```bash
   git clone https://github.com/AES256Afro/ClipSnatcher.git ~/Projects/ClipSnatcher
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the `ClipSnatcher/extension` folder.
5. Pin ClipSnatcher from the puzzle-piece menu so its icon stays in the toolbar.

To update later, run `git pull` in the folder, then click the reload arrow on ClipSnatcher in `chrome://extensions`.

**Optional (macOS): copy a video and paste it into Discord.** Run this once in Terminal:

```bash
bash ~/Projects/ClipSnatcher/native-helper/install.sh
```

Then open ClipSnatcher settings and click **Switch on the copy helper**. Chrome asks once for permission to talk to it. To remove the helper, run `native-helper/uninstall.sh`.

## What's in this repo

| Path | What it is |
|---|---|
| `extension/` | The Chrome extension (Manifest V3, plain JavaScript, no build step) |
| `extension/lib/resolve.js` | Finds the video file for X, Reddit and Facebook links |
| `extension/lib/mux.js` | Joins Reddit's separate video and audio into one MP4 without re-encoding |
| `extension/lib/store.js` | Settings and history, kept in `chrome.storage.local` |
| `native-helper/` | Optional macOS clipboard helper and its install/uninstall scripts |

## Three ways to save a video

- **Hover:** point at a video on X, Reddit or Facebook and click the **Save** button that appears in its top-right corner.
- **Right-click:** right-click a video or a post link and choose the **Save video** item marked ClipSnatcher.
- **Paste:** click the toolbar icon (or press `Alt+Shift+V`), paste a post link, and press **Save**. If the current tab is already a post, its link is filled in for you.

## Where files go

Files are saved to `Downloads/ClipSnatcher/<Site>/<author> - <post title> [id].mp4`. You can change the folder name and turn the per-site subfolders off in Settings.

Chrome extensions can only save inside Chrome's download location. To put everything somewhere else, change **Location** under Chrome Settings → Downloads. Also turn off "Ask where to save each file" there, or Chrome will ask you every time.

## History

Click the clock icon in the popup. You can search by post title, author or link, and filter by site. Each entry has these buttons:

- **Copy:** puts the video file on your clipboard, so ⌘V in Discord attaches the video. This needs the helper. Without it, the file is shown in Finder, where ⌘C and then ⌘V does the same thing.
- **Play**
- **Show in folder**
- **Open original post**
- **Copy post link**
- **Download again**
- **Remove from history:** removes the entry only. The file stays where it is.

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
- The copy helper is a small macOS script in `native-helper/clipsnatcher-helper.js`. It accepts three commands: ping, copy a video file, and show a file in Finder. Chrome only lets the extension IDs it was installed for call it, and it only accepts video files that exist on your computer. It makes no network connections.

## What ClipSnatcher will not do

- **Guess.** If a link or a video can't be tied to one post, it asks you to open the post instead of saving whatever video it finds first.
- **Download from an unexpected host without asking.** A site's videos come from that site's own video host. If a post points somewhere else, you are told which host and asked first. The question is asked in the popup, where a web page can't answer it for you. "Download again" reuses a host you already agreed to. If a site's video address redirects to another host, the download is stopped and the file removed.
- **Run in incognito windows.**

Only save videos you have the right to download.
