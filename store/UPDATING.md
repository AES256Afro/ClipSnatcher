# Updating ClipSnatcher on the Chrome Web Store

The steps for each new version, from merged work to the update reaching users. What to
paste into each dashboard field is in [listing.md](listing.md); this page is the order to
do things in. Dashboard labels are from memory and may be worded slightly differently on
screen.

## Where things stand (25 November 2026)

- **GitHub:** the latest release is [1.6.0](https://github.com/AES256Afro/ClipSnatcher/releases/tag/v1.6.0).
- **Waiting for the next version:** Milestone 9 (faster saves with a long history) is
  merged into `main`. Milestone 10 (save small once, sorting, Retry failed, file-name
  templates and more) is pull request #16, not yet merged. Together they add features, so
  the next version is **1.7.0**.
- **Chrome Web Store:** check the dashboard for the version it has. Every version you
  upload must be higher than that one.

## 1. Get `main` ready

1. Merge the pull requests that should be in this version (for 1.7.0: #16).
2. In `CHANGELOG.md`, check the **Unreleased** section says, in plain words, what users
   will notice.

## 2. Make the release

Ask Claude to "make the 1.7.0 release", or do it by hand:

1. On a new branch, set the version in `extension/manifest.json`, `package.json`, and both
   `"version"` lines near the top of `package-lock.json`.
2. Rename `## Unreleased` in `CHANGELOG.md` to `## 1.7.0 (date)`.
3. Run the checks. All must pass:
   ```bash
   npm ci
   ```
   ```bash
   npm run check && npm run typecheck && npm test
   ```
   ```bash
   npm run test:browser
   ```
4. Open a pull request, let CI pass, and merge it.
5. Tag the merge commit and push the tag:
   ```bash
   git tag -a v1.7.0 -m "ClipSnatcher 1.7.0"
   ```
   ```bash
   git push origin v1.7.0
   ```
6. Pushing the tag runs the **Release** workflow (Actions tab on GitHub). It tests the tag,
   then publishes a GitHub release with three files:
   - `clipsnatcher-1.7.0.zip`, the package for the store;
   - `clipsnatcher-helper-macos.zip` and `clipsnatcher-helper-windows.zip`, which the
     store copy's Settings page links to.

   Check that the release page shows all three. Don't skip the tag: without the release,
   Settings' **Download the helper** link breaks for store users.

## 3. Check by hand before uploading

Load the new version unpacked (`chrome://extensions` → reload ClipSnatcher) and try what
the automated checks can't reach:

- [ ] Save a video from X, Reddit and Facebook; a Reddit one plays with sound.
- [ ] Settings → **When something goes wrong** → switch on notifications. Chrome asks
      for permission. Make a save fail and see the notification.
- [ ] Open the popup after a failure: the red count on the icon goes away and the
      problem is described.
- [ ] Right-click a video on a site other than X, Reddit or Facebook: the message says
      the site streams its video.
- [ ] Delete your newest saved video, then press the copy-last shortcut (`Alt+Shift+C`
      on macOS, `Alt+Shift+D` on Windows): it copies the next one.
- [ ] New in 1.7.0: the popup's **Under N MB** button, sorting and **Retry failed** in
      history, and a file-name template in Settings.

## 4. Upload to the Chrome Web Store

1. Download `clipsnatcher-1.7.0.zip` from the GitHub release. It is built from the tag,
   so it matches the code exactly. `dist/clipsnatcher-1.7.0.zip` from `npm run build` is
   the same thing locally. Never zip `extension/` yourself: the store rejects the `key`
   line, and the build removes it.
2. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and pick
   ClipSnatcher.
3. **Package** → **Upload new package** → choose the zip. The dashboard reads the
   version from it.
4. **Store listing:** update the description if this version adds something worth
   mentioning (the text is in [listing.md](listing.md); edit it there first, so the two
   stay the same). Replace screenshots if the pages changed visibly.
5. **Privacy practices:** every permission needs a justification. Only new permissions
   need new text; it is in the **Permission justifications** table in
   [listing.md](listing.md). `npm run check` fails if a permission is missing from that
   table or from `PRIVACY.md`, so the text is always there. For reference:
   - 1.5.1 added `scripting`;
   - 1.6.0 added the optional `notifications`;
   - 1.7.0 adds none.
6. **Submit for review.** Choose whether it publishes as soon as it is approved, or
   waits for you to publish it.

## 5. After submitting

- **Review** usually takes from a few hours to a few days. A new permission, or a change
  to the description, can make it slower.
- **If it's rejected,** the email names the policy. The usual causes are a permission
  justification that doesn't match what the code does, or a description that promises
  something it doesn't do. Fix that, raise the version (1.7.1), and resubmit.
- **Once it's published,** Chrome updates installed copies on its own within about a day.
  To get it sooner on your own computer, open `chrome://extensions`, turn on
  **Developer mode** and click **Update**.
- **Permission prompts:** adding an optional permission (like `notifications`) prompts no
  one when they update. Adding a required permission or a new website makes Chrome turn
  the extension off for everyone until they accept. Avoid that where you can, and say why
  in the changelog when you can't.

## Going back

The store won't accept a lower version number. To undo a bad release, publish the
previous code under a higher version: check out the last good tag on a branch, set the
next version number (for example 1.7.1), and release it as above.

## The rules in one place

| | |
|---|---|
| Version | Higher than the one in the store, the same in the manifest, `package.json`, `package-lock.json` and `CHANGELOG.md` (`npm run check` enforces this) |
| Package | The release's `clipsnatcher-<version>.zip`, never a hand-made zip |
| Tag | `v<version>` on the release's merge commit, pushed, so the GitHub release (and the helper downloads) exist |
| Permissions | Each one in `PRIVACY.md` and in listing.md's table (`npm run check` enforces this) |
| Privacy policy URL | `https://github.com/AES256Afro/ClipSnatcher/blob/main/PRIVACY.md` |
