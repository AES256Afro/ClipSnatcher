# Changelog

All notable changes to ClipSnatcher. Versions match `extension/manifest.json`.

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
