# ClipSnatcher Privacy Policy

Last updated: November 25, 2026

ClipSnatcher is a browser extension that saves videos from social media posts to your computer. It does not collect, transmit, sell or share any personal data. There are no accounts, no analytics and no servers operated by this project.

## What is stored, and where

Everything ClipSnatcher stores stays in your browser profile on your own computer (`chrome.storage.local`):

- **Your settings:** the download folder name and a few on/off options.
- **Your download history:** for each video you save, the post title, author name, site, link to the original post, the address the video file was downloaded from, the location of the saved file, the time you saved it, and a small thumbnail image. History keeps the most recent 5,000 entries.

This information is never sent to the developer or to any third party. You can export or clear your history at any time from the extension's Settings page. Removing the extension deletes all of it.

## Network requests

ClipSnatcher makes network requests only when you ask it to save a video. They go to the site that hosts that post, and to the host of the video file:

- **X / Twitter:** `cdn.syndication.twimg.com`, `video.twimg.com`, `pbs.twimg.com`
- **Reddit:** `reddit.com`, `redd.it`
- **Facebook:** `facebook.com`, `fb.watch`, `fbcdn.net`
- **Direct video links:** if you save a direct link to a video file (for example by right-clicking a video on another site), your browser downloads the file from that host.
- **Videos hosted elsewhere:** if a Reddit post points at a video file on another host such as `i.imgur.com`, ClipSnatcher tells you which host it is and downloads from it only after you confirm. "Download again" on a video you saved this way uses the same host without asking a second time.
- **Redirects:** if a site's video address redirects to a different host, ClipSnatcher stops the download and removes the file. Chrome will already have contacted that host by then.

For Reddit and Facebook, these requests are made by your browser in the same way as when you visit the site, which means they include your existing login for that site if you have one. This is what allows the extension to see posts that you can see. The download itself is an ordinary Chrome download, so Chrome sends the video host whatever cookies it already holds for that host, as it would for any download. ClipSnatcher does not read, store or transmit your passwords or login cookies.

Thumbnails are fetched only from the same site's own media host. When the quality setting asks for a size limit, ClipSnatcher also asks that same media host how large each version of the video is (a request for the size only, not the video) before choosing one.

For Reddit, the post's page is requested at the same time as the post's data, to save time; the page request is cancelled as soon as it turns out not to be needed.

No request is ever made to a server belonging to this project, because there isn't one.

## Backups

**Back up history** writes a file to your Downloads folder with your history, notes, favourites and thumbnails. It stays wherever you put it; ClipSnatcher never sends it anywhere. Restoring reads a file you choose and adds its entries to history.

## Permissions

- **Downloads, and opening downloads** (`downloads`, `downloads.open`): to save the video you chose and to play or show it later.
- **Storage, including unlimited storage** (`storage`, `unlimitedStorage`): to keep your settings and history on your computer. History includes small thumbnails, which can grow past the default limit.
- **Context menus** (`contextMenus`): to add "Save video" to the right-click menu.
- **Active tab** (`activeTab`): when you use that right-click menu on another website, to read the page's title so the saved file gets a useful name.
- **Offscreen document** (`offscreen`): to join Reddit's separate video and audio files on your computer.
- **Scripting** (`scripting`): when ClipSnatcher is installed or updated, to add its own Save-button script again to X, Reddit and Facebook tabs that were already open, so Save keeps working without refreshing them. It only runs the script that ships inside the extension, only on those sites.
- **Site access (X, Reddit, Facebook):** to show the Save button on videos, to look up the video file for the post you chose, and to pre-fill the popup with the address of the post you are on.
- **Native messaging (optional)** (`nativeMessaging`): not granted at install. Chrome asks you for it only if you switch on the optional copy helper in Settings.

ClipSnatcher does not run in incognito windows.

## Optional copy helper (macOS and Windows)

The optional helper is a small script you install yourself from this repository. It can do three things: confirm it is installed, copy a video file you saved to the clipboard, and show that file in Finder or File Explorer. It makes no network connections. Chrome only lets the extension IDs it was installed for call it, and it only accepts video files that exist on your computer. It doesn't limit itself to your Downloads folder, because Chrome's download location can be changed to any folder; ClipSnatcher only ever asks it about files it saved itself.

## Changes

If this policy changes, the updated version will be published at this address with a new date.

## Contact

Questions or concerns: open an issue at https://github.com/AES256Afro/ClipSnatcher/issues
