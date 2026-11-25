# Chrome Web Store submission: what to paste where

Field names are from memory of the Developer Dashboard and may be worded slightly differently on screen.

## Before you upload

1. Build the zip (the store rejects the `key` line in the manifest, and this removes it):
   ```bash
   bash scripts/build-store-zip.sh
   ```
   Upload `dist/clipsnatcher-<version>.zip`.
2. After the first upload, the dashboard shows the extension's store ID (32 letters). The helper only answers the IDs it is installed for, so install it for that copy (the store copy's Settings page shows this exact command):
   ```bash
   bash native-helper/install.sh <store-extension-id>
   ```
   On Windows, in PowerShell:
   ```powershell
   powershell -ExecutionPolicy Bypass -File native-helper\windows\install.ps1 <store-extension-id>
   ```
   To keep using the unpacked copy as well, pass both IDs.
3. Images are in this folder: `screenshot-1-history.jpg`, `screenshot-2-filter.jpg`, `screenshot-3-popup.jpg` (1280×800) and `promo-small-440x280.jpg`. The sample entries in them are made up.

The title and summary are read from the manifest, so there is nothing to paste for those.

## Store listing tab

**Description**

```
ClipSnatcher saves videos from X (Twitter), Reddit and Facebook posts to your computer and keeps a searchable history of what you saved.

THREE WAYS TO SAVE
• Hover over a video and click the Save button that appears
• Right-click a video or a post link
• Open the extension and paste a post link

SEARCHABLE HISTORY
Every saved video is listed with its post title, author, site and date. Search by title, author, site or link. Click a thumbnail to play the video, or show it in its folder, open the original post, copy the link, download it again, or remove it with Undo. Rows show live download progress and say plainly when something failed.

SIZE THAT FITS
Choose the best quality, a smaller version, or the best version under a size you pick, so a clip fits your chat app's upload limit. Already saved a post? ClipSnatcher tells you instead of saving it twice.

ORGANIZED DOWNLOADS
Videos are saved to a ClipSnatcher folder inside your Downloads folder, sorted by site, and named after the post.

REDDIT VIDEOS WITH SOUND
Reddit stores video and audio separately. ClipSnatcher joins them on your computer without re-encoding, so quality is unchanged.

PRIVATE BY DESIGN
• No accounts, no analytics, no tracking
• No servers: the extension talks only to the site hosting the post you chose
• Your history is stored only in your browser and can be exported or cleared at any time

OPTIONAL: COPY A VIDEO TO THE CLIPBOARD (macOS and Windows)
An optional helper, installed separately from the project's GitHub page, lets you copy a saved video file and paste it into chat apps.

Only save videos you have the right to download. ClipSnatcher does not work with YouTube.
```

| Field | Value |
|---|---|
| Category | Tools |
| Language | English |
| Store icon | `extension/icons/128.png` |
| Screenshots | the three `screenshot-*.jpg` files |
| Small promo tile | `promo-small-440x280.jpg` |
| Homepage URL | `https://github.com/AES256Afro/ClipSnatcher` |
| Support URL | `https://github.com/AES256Afro/ClipSnatcher/issues` |
| Mature content | No |

## Privacy practices tab

**Single purpose**

```
Save videos from social media posts (X, Reddit, Facebook) to the user's computer and keep a local, searchable history of those downloads.
```

**Permission justifications** (one box each)

| Permission | Paste this |
|---|---|
| downloads | `Saves the video the user chose into their Downloads folder and tracks whether the download finished.` |
| downloads.open | `Lets the user play a saved video from the history list by clicking Play.` |
| storage | `Stores the user's settings and their download history locally in the browser.` |
| unlimitedStorage | `The local history includes a small thumbnail per saved video, which can exceed the default storage limit over time.` |
| contextMenus | `Adds "Save video" items to the right-click menu on videos and post links.` |
| offscreen | `Reddit serves video and audio as separate files. An offscreen page joins them locally into one MP4 and hands it to the downloads system.` |
| scripting | `When the extension is installed or updated, adds its Save-button script again to X, Reddit and Facebook tabs that were already open, so Save keeps working without the user refreshing the page. It only runs the extension's own packaged content script, only on those sites, and never runs remote or page-supplied code.` |
| activeTab | `When the user picks "Save video" from the right-click menu on another website, reads that page's title so the saved file gets a useful name.` |
| notifications (optional) | `Shows a system notification when a save the user started fails out of sight (for example a Reddit merge that fails after the tab was closed). It is an optional permission, requested only when the user switches notifications on in Settings.` |
| nativeMessaging (optional) | `Talks to an optional helper the user installs themselves, which copies a saved video file to the clipboard. It is an optional permission, requested only when the user switches the helper on in Settings.` |

**Host permission justification**

```
The extension needs access to x.com, twitter.com, reddit.com, facebook.com and their media hosts (twimg.com, redd.it, fbcdn.net) to show a Save button on videos, look up the video file for the post the user chose, and download it. When the user opens the popup on one of these sites, it reads that tab's address to pre-fill the link field. If a post's video is hosted somewhere else, the extension asks the user before downloading from that host.
```

| Field | Value |
|---|---|
| Remote code | No, I am not using remote code |
| Data usage | Leave every box unchecked (history stays in the browser and is never transmitted) |
| Certifications | Tick all three |
| Privacy policy URL | `https://github.com/AES256Afro/ClipSnatcher/blob/main/PRIVACY.md` |

## Distribution tab

| Field | Value |
|---|---|
| Payments | Free of charge |
| Visibility | Public (or Unlisted to share by link only) |
| Regions | All regions |

## Test instructions tab

```
No login is needed for the basic test.
1. Click the ClipSnatcher toolbar icon.
2. Paste this link and click Save: https://x.com/elonmusk/status/1585341984679469056
3. The video downloads to Downloads/ClipSnatcher/X/.
4. Click the clock icon in the popup to open the history page and search for "sink".
The native messaging helper is optional and not required for any of the above.
```

## Account tab (once per developer account)

| Field | Value |
|---|---|
| Contact email | Your email, then click the verification link Google sends (publishing is blocked until it is verified) |
| Trader / non-trader declaration | Non-trader (free, no ads, no payments) |

## Things to know

- Approval is not guaranteed. The store explicitly bans YouTube downloaders, which this is not, but reviewers can still reject video downloaders, and broad site access slows review.
- The developer account has a one-time $5 fee.
