# Changelog

All notable changes to ClipSnatcher. Versions match `extension/manifest.json`.

## 1.5.1 (2026-11-19)

- **No more "Refresh this page" after an update.** When ClipSnatcher is updated or reloaded, tabs that were already open on X, Reddit or Facebook kept an old copy of the page script that could no longer reach the extension, so Save failed until the page was refreshed. ClipSnatcher now adds a fresh copy to those tabs, and the old one removes its button and steps aside. This needs Chrome's `scripting` permission, which adds no new warning: the sites it can touch are unchanged.
- If a save can't be started for any other reason, the button now shows that reason instead of always blaming an update.

## 1.5.0 (2026-11-18)

- **Copy on Windows:** the copy helper now has a Windows version, so **Copy**, "copy when saved" and the copy-last-video shortcut work there too. It puts the saved video on the clipboard the same way Ctrl+C in File Explorer does, ready to paste into Discord. Install it by double-clicking `native-helper\windows\install.cmd` (no admin rights needed); it works for Chrome, Edge and Brave. Settings shows the Windows instructions and the exact command on Windows.
- **Copy shortcut on Windows is Alt+Shift+D.** Chrome on Windows doesn't allow Alt+Shift+C, so until now the copy shortcut had no key there. macOS keeps Alt+Shift+C.
- The Windows helper only accepts video files that exist on one of the computer's drives (not network shares). Like the macOS helper, it follows links to the real file and checks that, so a link named `x.mp4` that points at a text file is refused. It also finds the file's real name before checking it. Its tests run on Windows on every push.

## 1.4.1 (2026-11-18)

Facebook fixes, from testing on the live site.

- **Feed videos:** Save now works on regular video posts in the Facebook home feed, which have no link around the player. ClipSnatcher uses the video's ID on the player instead. Ads still can't be saved: they carry neither.
- **Logged-in pages:** reads the video format Facebook serves to logged-in visitors, and asks for the page as a browser would; without that, Facebook left the video out.
- **Right video:** no longer picks up the next reel that Facebook preloads further down the same page.

## 1.4.0 (2026-11-18)

- **Video quality:** a new setting picks Best available, Smaller (720p or the next size down), or the best version under a size you choose, for chat apps with an upload limit. Sizes are checked with the site's own video host before saving; if nothing fits, the smallest is saved and you're told its size.
- **Already saved:** saving a post you already have says so, with Show in folder and Save again, instead of making a second copy. If the file was deleted, it is saved again without asking.
- **Copy when saved (macOS):** an optional setting copies each video to the clipboard as soon as it finishes, ready to paste into Discord. Needs the copy helper.
- **Keyboard shortcuts:** Alt+Shift+S saves the video in the current tab; Alt+Shift+C copies the last saved video. In history, "/" jumps to search and Escape clears it.
- **Favourites and notes:** star a video and add a short note; notes are searchable, and history has a Favourites filter.
- **Back up and restore:** one file with your whole history, notes, favourites and thumbnails. Restoring adds what's missing and never pushes out existing entries. Nothing in a backup file is trusted: it pre-approves no download host, is tied to no download on this computer, never counts as "already saved", and its file paths are not handed to the copy helper.
- **Paste several links** into the popup at once; they are saved one after another with a summary.

## 1.3.0 (2026-11-18)

Faster and easier to maintain. Nothing changes in how you use it.

- Thumbnails are stored apart from the history list, so saving or changing one video no longer rewrites every thumbnail. Existing thumbnails are moved over automatically.
- The history page asks Chrome about each download once and remembers the answer until Chrome reports a change, so searching and paging stay quick with long histories.
- Reddit: the post's data and page are fetched at the same time, saving a round trip. This means the post's page is now requested for every Reddit link, not only video posts; it is cancelled as soon as the data shows it isn't needed. No other sites are contacted.
- X thumbnails are downloaded at a small size instead of full size.
- Merging a Reddit video holds the file in memory once instead of twice when its size is known.
- Automated tests (114 tests covering link lookup, video merging, file naming and history storage) run on every push to GitHub, along with a consistency check and a test build of the store zip.

## 1.2.0 (2026-11-18)

- History rows: the thumbnail plays the video; main buttons depend on the file's state (Play, Show in folder and Copy when finished; Download again when failed or missing; Copy path when Chrome no longer lists the file); everything else is in a More menu.
- Remove offers Undo. Tidy up finds entries whose file is gone. Delete file removes the file itself.
- Live download progress. A Reddit save replies at once and shows "Merging" while it works; removing that row cancels the save.
- The Save button keeps one state per video, so a second save can start while the first runs. Right-click saves show an immediate notice.
- Welcome page on first install. Settings show the exact file name a video will get.
- Accessibility: buttons named after their video, keyboard focus kept across refreshes, visible focus rings, stronger contrast, reduced motion.

## 1.1.0 (2026-11-17)

Correctness and security fixes from a full audit.

- Never guesses which post a video belongs to; feeds and listing pages are refused with "open the post itself".
- Every address is parsed once, strictly, and checked and used in that same form.
- A site's video downloads automatically only from that site's own media host; any other host needs a yes in the popup. Downloads redirected to another host are stopped.
- Web pages can no longer read history or settings, and may only ask the extension to save a video.
- Each history entry is tied to its own Chrome download; failures are reported with a reason.
- Fewer permissions: the copy helper's permission is optional and incognito is off.

## 1.0.0 (2026-11-17)

First version: save videos from X, Reddit and Facebook posts by hover button, right-click or pasted link; Reddit video and sound merged locally; searchable local history; optional macOS helper that copies a saved video to the clipboard.
