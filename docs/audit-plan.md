# ClipSnatcher audit: findings, plan and milestones

Audit date: November 17, 2026. Code audited: commit `85ebd97` plus the uncommitted store files.

## How the audit was run

Ninety sweeps in total. A sweep is one full pass over the code or the rendered pages with a single lens.

| Category | Sweeps | New findings per sweep | Result |
|---|---|---|---|
| Design | 10 | 1, 1, 1, 4, 1, 1, 1, 2, 1, 1 | 14 findings |
| Quality of life | 10 | 2, 3, 1, 1, 1, 2, 2, 1, 1, 3 | 17 findings |
| Function | 10 | 3, 2, 2, 1, 1, 2, 2, 2, 1, 4 | 20 findings |
| Usability | 10 | 1, 2, 2, 2, 1, 0, 2, 1, 1, 3 | 15 findings |
| Bugs | 14 | 4, 3, 6, 3, 1, 3, 2, 2, 2, 2, 1, 0, 1, 1 | 24 confirmed, 6 uncertain |
| Security | 14 | 2, 2, 1, 0, 2, 1, 1, 1, 1, 0, 0, 1, 0, 0 | 11 confirmed, 7 uncertain |
| Readability | 5 | 3, 2, 2, 4, 1 | 12 findings |
| Optimization | 6 | 2, 1, 2, 1, 3, 0 | 9 findings |
| Features | 4 | 4, 4, 7, 0 | 8 shortlisted, 12 rejected |
| Visual (rendered pages) | 7 | 2, 1, 1, 2, 1, 0, 1 | 8 findings |

The bug, security, design-and-usability, and readability/speed/feature sweeps were done by four independent reviewers who had not seen the code before. The visual sweeps were done on the real pages rendered in Chrome (dark, light, narrow, long titles, failed download, keyboard focus, error state).

**The three-clean-sweeps rule was not met for bugs or security.** Both stopped at a 14-sweep cap. Security finished with two clean sweeps in a row. Bugs had one clean sweep (number 12) and was still finding one new issue per sweep at the end. Sweeping unfixed code further mostly re-finds neighbours of known issues, so the rule is carried into Milestone 1 as its exit test: after the fixes, both categories are re-swept until three passes in a row find nothing.

Many findings overlap between reviewers. They are consolidated below into 42 changes.

## Headline results

- **Security:** no critical or high issues. One medium (downloads can come from a host the poster chose), ten low. No script injection, no path traversal, no remote code, no secrets in the repo, and web pages and other extensions cannot message the extension.
- **Bugs:** one medium-high, six medium or medium-low, seventeen low. The MP4 merging maths, the helper's message framing and the HTML escaping were all checked and found correct.
- **Speed:** one real risk to the "never slows browsing" promise. Every history write is delivered, thumbnails included, to every open X, Reddit and Facebook tab. Negligible under about 100 saved videos; estimated at several megabytes per save at 500. Unmeasured.
- **Not yet verified anywhere:** Reddit and Facebook have still only been tested against mock pages. Several findings (wrong video picked from a feed, Facebook link search, merged-file duration on real Reddit files) can only be settled on the live sites.

## Already fixed during the audit

- The helper installer and uninstaller no longer delete the whole old `ClipStash` support folder, which could have belonged to another app. They remove only the old helper file.
- The privacy policy now says that saving a direct video link, or a Reddit post that points at a file on another host, contacts that host.

## Milestone 1: correct and safe (before any store submission)

**Status: all 16 implemented in version 1.1.0.**

Two rounds of re-sweeps followed, each by two fresh reviewers:

| Round | Sweeps | Found | Three clean sweeps in a row? |
|---|---|---|---|
| 1 | 12 bugs, 12 security | 1 medium, about 27 low | No |
| 2 | 11 bugs, 12 security | 3 medium, 9 low, plus uncertain items | Yes, both (the last three sweeps of each) |

Everything confirmed in both rounds is fixed. Those last fixes then got one independent review of the changes (9 sweeps), which found no security defects but 8 functional problems in them (1 medium, 7 low). Those are fixed and tested too, but that final small batch has not itself been reviewed.

Tests on the final code: 89 link-lookup checks against mock pages, and 42 checks in real Chrome with Reddit, Reddit's video host, an outside host and x.com stood in for by a local server (real fetches, merges, downloads and a real redirect). X itself was tested live.

Still open: Reddit and Facebook on the live sites, and the helper's permission prompt.

Changed from the plan as written: the tab permission (`activeTab`) stays, because without it right-click saves on other websites lose the page title. The "download from another host?" question is asked only in the popup and history page, never on a web page, because a page could have answered it for the user. Live download progress (planned for Milestone 2) was brought forward.

1. **Never guess the post.** Refuse Reddit listing pages and Facebook feed pages instead of saving the first video found. Stop the Facebook link search at the post's own container. On X, only fall back to the page address for the focused post.
2. **Check every address that comes from the page.** Require http(s) and a same-site or known video host for the post link, video source and Reddit's packaged file. Reject stream playlists (`.m3u8`, `.mpd`). For "Save video from this link", ignore details taken from the video under the cursor. Check the stored post link again before opening it.
3. **Limit automatic downloads to the sites' own video hosts**, over https. Ask before downloading from any other host.
4. **Check who sent each message.** Accept only "save this" from web pages; everything else only from the extension's own pages. Mark storage as extension-only and send the one setting the page script needs by message. This also removes the speed risk above.
5. **Tie each history entry to its own download.** Ignore downloads the extension did not start, verify the file path before trusting Chrome's download record, and skip the write when nothing matched.
6. **Fix the hidden merge page's life cycle.** Count jobs in flight so finishing one merge cannot close the page under another. Revoke leftover data on failure, close the page after a failed merge, and survive a background restart.
7. **Make Copy honest.** Only say "helper not installed" when Chrome could not reach it. Refuse Copy and Show until the download has finished. In the helper, resolve shortcuts, accept only files inside the Downloads folder, and reject odd characters.
8. **Report what actually happened.** Say "Download started", not "Saved". Show a failure notice if the download later fails. Warn when a Reddit video was saved without sound. Give a reason for failures, and a plain "you appear to be offline" message.
9. **Accept links without `https://`** and links pasted with other text around them.
10. **Fix "Download again".** Re-download only the one video from a multi-video post, re-download direct files from their stored address, and keep the original entry unless it was failed or missing.
11. **Handle failures in the pages.** Re-enable the Save button after an error, show a message when an action fails, and route "Clear history" through the background so a download finishing at the same moment cannot undo it.
12. **Small correctness fixes.** Keep the real file extension (`.webm`, `.mov`), cut long titles without breaking emoji, decode numbered HTML entities in titles, and normalise `facebook.com` without `www`.
13. **Turn off incognito use** so private-window saves cannot land in the normal profile's history.
14. **Ask for fewer permissions.** Drop `activeTab` and the unused hosts, make the helper permission optional, and bring the privacy policy in line.
15. **Move the on-page notice inside the protected button area** so the site cannot read post titles from it.
16. **Set thumbnails from code after checking their format**, not through page markup.

**Exit test:** bug and security sweeps repeated until three in a row are clean, and a manual check on live X, Reddit and Facebook (see the checklist below).

## Milestone 2: feels right

**Status: all 9 implemented in version 1.2.0.**

An independent review of the changes (10 sweeps, the last three clean) found no high-severity issues, confirmed that web pages cannot reach the new handlers and that all site text is escaped, and found 11 problems (3 medium, 8 low). All 11 are fixed, along with five of its uncertain items. Those fixes are tested but have not themselves been reviewed.

Tests on the final code: 89 link-lookup checks against mock pages and 63 checks in real Chrome (44 for downloads, rows, menu, focus, undo, tidy-up, delete and cancelling a merge; 19 page-side), plus a look at every page in light and dark and at phone width.

Not verified: Reddit and Facebook on the live sites; the copy helper's permission prompt; starting a second save while one is running on a real page with several videos; whether a feed video hidden under a site's own overlay still offers a right-click item (the Save button is the way to save those).

Changed from the plan as written:
- The Save button is not added to tabs that were already open at install. That would need another permission; the welcome page asks you to reload those tabs instead.
- "Save this post's video" in the right-click menu is now offered only on a post's own page, not everywhere on the three sites.
- A Reddit save now replies at once and merges in the background, with the row showing "Merging". If the merge fails or the sound can't be added, that is reported by a notice and on the row.
- "Tidy up" takes about 10 seconds, because Chrome re-checks files on disk at most that often.

17. **Live progress.** Update the percentage every second while a row is downloading, and show merge progress for Reddit.
18. **Simpler rows.** Clicking the thumbnail plays the video. Show Play and Show in folder as the main buttons with a labelled More menu. Offer Download again when a file failed or is missing, and disable actions while downloading. Apply the same to the popup.
19. **A better Save button.** Keep the spinner on its own video, let a second save start meanwhile, keep error messages visible long enough to read, show the saved title, and give instant feedback after a right-click save.
20. **Accessibility pass.** Announce status messages, name row buttons after their video, restore keyboard focus after the list refreshes, add visible focus rings, fix low-contrast badges and the dark error notice, respect reduced motion, and label the inputs.
21. **First-run welcome** covering the three ways to save, with the Save button added to tabs that were already open.
22. **Helper setup that works for everyone.** Show the helper section only on macOS, use neutral wording elsewhere, and build the install command from the real extension ID with a link to the download.
23. **Cope with a cleared download list.** Show where the file is and offer Copy path instead of a dead end.
24. **Undo and clean-up.** Undo for Remove, "Remove missing", and an optional "delete the file too".
25. **Polish.** One-line popup rows with long author names cut short, better empty states with a Clear filters button, inline "Saved" feedback in Settings, one set of terms throughout, search that matches site names, an Other filter, an accurate folder preview, and fewer right-click menu items.

## Milestone 3: stays fast and maintainable

26. **Tests and CI.** Node's built-in test runner for the merger, the link parsing and the file naming, run on every push.
27. **Move history to IndexedDB**, one record per video with thumbnails stored as files. This removes the full rewrite on every change and may let `unlimitedStorage` go.
28. **Start the download before fetching the thumbnail**, use the smallest suitable preview image, and time out.
29. **Timeouts on every network request** so a stalled connection cannot leave the button spinning.
30. **Cheaper rendering.** Cache download state, update single rows, and stop overlapping refreshes.
31. **Faster Reddit lookups.** Fetch in parallel and stop fetching the same page twice.
32. **Lower memory use while merging** large videos.
33. **Tidy the code.** One shared list of supported sites, remove dead code and duplicates, comment the MP4 offset maths, document the data shapes, and one error convention.
34. **Project basics.** Add a licence, a changelog and a release routine.

## Milestone 4: worth sharing

35. **Size-aware quality:** Best, Smaller, or "fit under N MB" for chat upload limits. The data is already fetched and thrown away.
36. **Save and copy:** optionally copy the file as soon as it finishes.
37. **Duplicate detection:** "Already saved" with Show in folder and Save again.
38. **Favourites and one searchable note per video.**
39. **Import and full backup**, since removing the extension erases history.
40. **Keyboard commands:** save the post in this tab, copy the last video, and keys for the history list.
41. **Windows copy helper**, only if this goes beyond your Mac.
42. **Later:** file name templates, pasting several links at once, multi-select.

**Considered and rejected:** GIF export, trimming, audio-only export, YouTube (banned by the store), Instagram, TikTok, Threads, stream-only sources, a Save button on every site, batch scraping of profiles, drag-out of files, a Linux helper, cloud sync, and scheduled backups. Each either breaks the "no servers, stays fast" promise, raises store or legal risk, or costs far more than it returns.

## What may be missing

- **A real-site test.** Nothing replaces saving ten real posts on each site. Checklist: a Reddit video with sound from a feed and from its post page; a Reddit short link; a Reddit post linking to an outside video; a Facebook reel, a feed video and a `/watch` video; an X post with three videos, a quoted post's video and a GIF; then play each merged Reddit file in QuickTime and Discord and confirm the length and seeking work.
- **A plan for when a site changes.** This is the main long-term risk. A "Copy diagnostic details" button would let you file a useful issue without any tracking.
- **A licence.** A public repo without one gives nobody permission to reuse the code.
- **A fallback if the store says no.** GitHub releases with a zip and the load-unpacked steps.
- **The legal side.** Downloading other people's posts can breach the sites' terms. The listing already says to save only what you have the right to; the README should too.
- **Name check.** Search the store and trademarks for "ClipSnatcher" before publishing.
