# Performance with a full history

ClipSnatcher keeps at most 5,000 videos in history. This page records how it behaves at
that size, and the decision it led to about where history is stored.

## How it was measured

`node browser-tests/run.mjs perf` loads the extension into a throwaway Chrome profile, fills
history with entries shaped like real ones (long titles, addresses and file paths, notes on
some, favourites on some), each with a 160 px JPEG thumbnail of a noisy picture (about
12 KB, which is at the large end of real thumbnails), and measures:

- **open:** from opening the popup or history page until its list shows rows (median of 5);
- **search:** from typing in history's search box until the result shows, including the
  80 ms pause the page waits for typing to stop (median of 4 searches);
- **save:** saving a direct video file (from a local stand-in host, so the network adds
  almost nothing): time to the reply, and how many times history is written until the
  download has finished;
- **one write:** reading and writing the history list once, in the background worker
  (median of 5).

Measured on 25 November 2026: Apple M5 Pro, 48 GB, macOS 27.2.1, Chrome 158, headless.
Slower computers will take longer; the comparison between 50 and 5,000 entries is the point.

## Results

| | 50 videos | 5,000 videos before | 5,000 videos after |
|---|---:|---:|---:|
| History list in storage | 39 KB | 3.9 MB | 3.9 MB |
| Storage with thumbnails | 0.6 MB | 60 MB | 60 MB |
| Popup: open until rows show | 21 ms | 70 ms | 62 ms |
| History page: open until rows show | 26 ms | 69 ms | 61 ms |
| History search: typing to result | 97 ms | 100 ms | 100 ms |
| One history write | 1 ms | 94 ms | 95 ms |
| History writes for one save | 2 | **3** | **2** |
| Save: until the reply | 21 ms | **691 ms** | **449 ms** |

"Before" is version 1.6.0; "after" is with the changes in this milestone:

- an update that changes nothing is no longer written (each write rewrites the whole list);
- a download's file path is recorded once, when it finishes, instead of as soon as Chrome
  names the file. A save now writes history twice: when it starts and when it ends. A
  Reddit merge writes it three times (merging, downloading, done).

The popup, history page and search barely notice a full history: thumbnails are stored
apart from the list (since 1.3.0), the history page asks Chrome about only the rows on
screen, and search runs over text built once per entry.

The cost that grows is writing: about 95 ms per write at 5,000 entries, against 1 ms at 50,
because `chrome.storage.local` stores the list as one value. A save's reply waits for one
write (adding the row) and two reads, which is most of the 449 ms.

## Decision: history stays in `chrome.storage.local`

The first audit (item 27) proposed moving history to IndexedDB, one record per video, so a
write costs the same at any size. Measured, that isn't worth it yet:

- What people see stays well under a second at the limit: opening is about 60 ms and a
  search 100 ms. A save already shows "Finding the video…", and real saves spend longer
  on the network (looking up the post, checking sizes) than on this write.
- Moving would mean rewriting the storage layer, the move of existing histories, backup
  and restore, and their tests, for a gain of a few hundred milliseconds on the largest
  histories only.

**Revisit if** the history limit is raised above 5,000, a feature needs to write history
often (for example per-second progress), or measurements on a slow computer show a save's
reply over about two seconds at 5,000 entries. Re-run `node browser-tests/run.mjs perf` to
check; it also fails if a save writes history more than twice.
