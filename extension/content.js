// ClipSnatcher page helper. It keeps no observers on the feed, makes no network requests
// and does no tracking. On pointer movement it does one cheap check for a video under
// the pointer (at most about 11 times a second) and shows one small "Save" button.
//
// This script runs inside web pages, so it is treated as untrusted by the rest of the
// extension: it cannot read history or settings, and everything it sends is re-checked
// by the background worker.
(() => {
  const host = location.hostname;
  const SITE = /(^|\.)(x|twitter)\.com$/.test(host) ? 'x'
    : /(^|\.)reddit\.com$/.test(host) ? 'reddit'
    : /(^|\.)facebook\.com$/.test(host) ? 'facebook' : null;
  if (!SITE) return;
  // Tried in order, so one player always maps to the same element whatever part of it is hovered.
  const CONTAINERS = {
    x: ['[data-testid="videoPlayer"]', '[data-testid="videoComponent"]'],
    reddit: ['shreddit-player-2', 'shreddit-player', '.reddit-video-player-root', '[data-hook="video-player"]'],
  }[SITE] || [];
  const containerOf = (el) => { for (const sel of CONTAINERS) { const c = el.closest?.(sel); if (c) return c; } return null; };

  const MIN_W = 120, MIN_H = 80;      // smaller players are thumbnails, not worth a button
  const HIDE_DELAY_MS = 450;          // grace period to move from the video onto the button
  const HOVER_CHECK_MS = 90;
  const RESULT_OK_MS = 2500, RESULT_ERR_MS = 7000;
  const CONTEXT_TTL_MS = 60000;       // how long a right-click position stays valid

  /* --------------------------------------------- the one setting we need */
  // Asked for by message (this script has no access to extension storage), only once a
  // video is actually hovered, and again after the tab has been in the background.
  let enabled = null;   // null = not asked yet
  let asking = null;
  function askEnabled() {
    asking ||= chrome.runtime.sendMessage({ type: 'clipsnatcher:settings' })
      .then((s) => { enabled = s?.hoverButton !== false; }, () => { enabled = true; })
      .finally(() => { asking = null; });
    return asking;
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && enabled !== null) askEnabled().then(() => { if (!enabled) hide(); });
  });

  /* ------------------------------------------------------------ the button */
  let hostEl, btn, tip, current = null, hideTimer = 0, resultTimer = 0;
  // What each video's button is showing. Every video keeps its own state, so one save
  // can be running while you start another.
  const jobs = new WeakMap();   // video container -> { state: 'busy' | 'ok' | 'err', text, until }
  // Some pages reuse one <video> element for the next clip. A job belongs to the clip
  // that was playing when Save was pressed, so it is dropped once the element shows another.
  const clipOf = (container) => (container?.tagName === 'VIDEO' ? container : container?.querySelector?.('video'))?.currentSrc || '';
  function jobOf(container) {
    const job = container && jobs.get(container);
    if (!job) return null;
    if ((job.until && job.until < Date.now()) || (job.state !== 'busy' && job.clip !== clipOf(container))) { jobs.delete(container); return null; }
    return job;
  }

  function build() {
    hostEl = document.createElement('clipsnatcher-ui');
    hostEl.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const root = hostEl.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px;
          height: 30px; padding: 0 11px 0 9px; border-radius: 15px; cursor: pointer;
          font: 600 12.5px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #fff; background: rgba(17,17,20,.82); backdrop-filter: blur(6px);
          box-shadow: 0 1px 2px rgba(0,0,0,.35), inset 0 0 0 1px rgba(255,255,255,.14);
          transition: background .12s; }
        button:hover { background: rgba(17,17,20,.95); }
        button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
        button.ok { background: #1a7f37; } button.err { background: #cf222e; } button.dup { background: #5b4bf5; }
        svg { width: 15px; height: 15px; flex: none; }
        .spin { animation: s 0.8s linear infinite; } @keyframes s { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
        .tip { position: absolute; top: 36px; right: 0; width: max-content; max-width: 260px; padding: 7px 9px;
          border-radius: 8px; background: #111; color: #fff; font: 12px/1.35 -apple-system, BlinkMacSystemFont, sans-serif;
          box-shadow: 0 4px 14px rgba(0,0,0,.35); display: none; }
      </style>
      <button type="button" title="Save this video (ClipSnatcher)"></button>
      <div class="tip" role="status"></div>`;
    btn = root.querySelector('button');
    tip = root.querySelector('.tip');
    draw('idle');
    btn.addEventListener('click', onClick, true);
    for (const ev of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) btn.addEventListener(ev, (e) => e.stopPropagation(), true);
    hostEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    hostEl.addEventListener('mouseleave', scheduleHide);
    document.documentElement.appendChild(hostEl);
  }

  const ICONS = {
    idle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
    busy: '<svg class="spin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M8 2a6 6 0 1 1-6 6"/></svg>',
    ok: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 8.5 3 3 6-7"/></svg>',
    err: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M8 4v5M8 12h0"/></svg>',
  };
  ICONS.dup = ICONS.ok;
  const LABELS = { idle: 'Save', busy: 'Finding…', ok: 'Downloading', err: 'Failed', dup: 'Saved before' };

  let drawn = '';
  function draw(state, text) {
    // Called on every pointer check; only touch the button when something changed, so
    // the spinner isn't restarted and the tip isn't announced again.
    const key = state + '|' + (text || '');
    if (key === drawn) return;
    drawn = key;
    btn.className = state === 'ok' || state === 'err' || state === 'dup' ? state : '';
    btn.innerHTML = ICONS[state];
    const span = document.createElement('span');
    span.textContent = LABELS[state];
    btn.appendChild(span);
    tip.textContent = text || '';
    tip.style.display = text ? 'block' : 'none';
  }

  // Shows the state of the video the button is on, and clears a result when its time is up.
  function paint() {
    const job = jobOf(current);
    draw(job ? job.state : 'idle', job && job.state !== 'busy' ? job.text : '');
    clearTimeout(resultTimer);
    if (job?.until) resultTimer = setTimeout(() => { if (!jobOf(current)) hide(); else paint(); }, Math.max(0, job.until - Date.now()) + 30);
  }
  const showingResult = () => { const job = jobOf(current); return !!job && job.state !== 'busy'; };

  function place() {
    if (!current || !current.isConnected) return hide();
    const r = current.getBoundingClientRect();
    if (r.width < MIN_W || r.height < MIN_H || r.bottom < 0 || r.top > innerHeight) return hide();
    const top = Math.max(8, r.top + 10);
    const right = Math.min(innerWidth - 8, r.right - 10);
    hostEl.style.transform = `translate(${Math.round(right)}px, ${Math.round(top)}px) translateX(-100%)`;
    hostEl.style.display = 'block';
  }

  function show(container) {
    if (enabled === false) return;
    if (enabled === null) { askEnabled().then(() => { if (enabled && container?.isConnected) show(container); }); return; }
    if (!hostEl) build();
    clearTimeout(hideTimer);
    current = container;
    paint();
    place();
  }

  // Hiding the button never cancels a save: its result arrives as a notice instead.
  function hide() {
    current = null;
    clearTimeout(resultTimer);
    if (hostEl) hostEl.style.display = 'none';
  }
  function scheduleHide() {
    if (showingResult()) return;     // a result stays up for its own timer so it can be read
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  /* ------------------------------------------------------ finding the video */
  function videoAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el === hostEl) return 'button';
      const c = containerOf(el); if (c) return c;
      if (el.tagName === 'VIDEO') return el;
    }
    return null;
  }

  let lastCheck = 0, pending = 0;
  document.addEventListener('mouseover', (e) => {
    if (enabled === false) return;
    const run = () => {
      lastCheck = performance.now();
      const found = videoAt(e.clientX, e.clientY);
      if (found === 'button') return;
      if (found) show(found); else if (current) scheduleHide();
    };
    clearTimeout(pending);
    if (performance.now() - lastCheck > HOVER_CHECK_MS) run(); else pending = setTimeout(run, HOVER_CHECK_MS);
  }, { passive: true, capture: true });

  let raf = 0;
  addEventListener('scroll', () => {
    if (!current || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  }, { passive: true, capture: true });

  /* ------------------------------------------- context about the hovered video */
  // Only ever names the post the video visibly belongs to. If that can't be told,
  // postUrl stays empty and the user is asked to open the post, rather than guessing.
  function gather(container) {
    const info = { postUrl: null, titleHint: document.title, index: 0, quoted: false, videoSrc: null, packaged: null };
    if (!container) return info;
    const video = container.tagName === 'VIDEO' ? container : container.querySelector?.('video');
    const src = video?.currentSrc || video?.src || video?.querySelector?.('source')?.src || '';
    if (/^https:/.test(src)) info.videoSrc = src;
    const path = location.pathname + location.search;

    if (SITE === 'x') {
      const article = container.closest('article');
      if (article) {
        const quote = container.closest('div[role="link"]');
        info.quoted = !!(quote && article.contains(quote));
        const timeLink = article.querySelector('a[href*="/status/"] time')?.closest('a');
        if (timeLink) info.postUrl = timeLink.href;
        const vids = [...(info.quoted ? quote : article).querySelectorAll('video')];
        const i = video ? vids.indexOf(video) : -1;
        if (i >= 0 && vids.length > 1) info.index = i + 1;
      } else if (/\/status\/\d+/.test(path)) {
        info.postUrl = location.href;      // full-screen viewer of one post
      }
    } else if (SITE === 'reddit') {
      const post = container.closest?.('shreddit-post');
      const oldPost = container.closest?.('.thing[data-permalink]');
      if (post || oldPost) {
        const perm = post?.getAttribute('permalink') || oldPost?.getAttribute('data-permalink');
        if (perm) info.postUrl = new URL(perm, location.origin).href;
        info.packaged = container.getAttribute?.('packaged-media-json') || null;
        if (post?.getAttribute('post-title')) info.titleHint = post.getAttribute('post-title');
      } else if (!document.querySelector('shreddit-post') && /\/comments\/[a-z0-9]+/i.test(path)) {
        info.postUrl = location.href;      // a layout without post elements: the page is the post
      }
      // A player outside every post (an ad, a recommendation) gets no post: we don't guess.
    } else if (SITE === 'facebook') {
      const p = location.pathname;
      const onOneVideo = /\/videos\/(?:[^/]+\/)?\d{6,}\/?$/.test(p) || /^\/reel\/\d{6,}\/?$/.test(p)
        || (/^\/watch\/?$/.test(p) && /^\d{6,}$/.test(new URLSearchParams(location.search).get('v') || ''));
      const onOnePost = /\/posts\/[A-Za-z0-9]+\/?$/.test(p) || /\/permalink\/\d+\/?$/.test(p) || p === '/permalink.php' || p === '/story.php'
        || /^\/share\/(?:[vrp]\/)?[A-Za-z0-9]+\/?$/.test(p);
      if (onOneVideo || onOnePost) {
        info.postUrl = location.href;      // the page itself is this one video or post
      } else {
        // Only a link that wraps the player itself counts. Links elsewhere in the post
        // (its text, comments) can point at other videos.
        const link = container.closest('a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch"]');
        if (link) info.postUrl = link.href;
      }
    }
    return info;
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (!e.isTrusted) return;            // only a real click by the user counts
    const video = current;
    const job = jobOf(video);
    if (!video || job?.state === 'busy' || job?.state === 'ok') return;
    const force = job?.state === 'dup';     // told it was saved before, and clicked again
    const clip = clipOf(video);
    jobs.set(video, { state: 'busy', clip });
    paint();
    const hint = { ...gather(video), force };
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'clipsnatcher:download', hint });
    } catch {
      res = { ok: false, error: 'ClipSnatcher was updated or reloaded. Refresh this page and try again.' };
    }
    const ok = !!res?.ok;
    if (res?.duplicate) {
      // Being saved right now: nothing to offer. Saved earlier: a second click saves another copy.
      const job = res.busy
        ? { state: 'err', text: 'This video is already being saved.', clip, until: Date.now() + RESULT_ERR_MS }
        : { state: 'dup', text: 'Saved before. Click again to save another copy.', clip, until: Date.now() + RESULT_ERR_MS };
      jobs.set(video, job);
      if (current === video && hostEl.style.display !== 'none') { clearTimeout(hideTimer); paint(); } else toast(res.error, 'info');
      return;
    }
    const text = ok ? `Download started: ${res.title || 'video'}${res.detail ? ` (${res.detail})` : ''}${res.warning ? `. ${res.warning}` : ''}` : (res?.error || 'Something went wrong.');
    jobs.set(video, { state: ok ? 'ok' : 'err', text, clip, until: Date.now() + (ok ? RESULT_OK_MS : RESULT_ERR_MS) });
    // If the pointer has moved on (or the video scrolled away), say it in a notice instead.
    if (current === video && hostEl.style.display !== 'none') { clearTimeout(hideTimer); paint(); } else toast(text, ok ? 'ok' : 'err');
  }

  /* -------------------------------------------- right-click menu support */
  let lastRightClick = null;
  document.addEventListener('contextmenu', (e) => { lastRightClick = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { passive: true, capture: true });

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender?.id !== chrome.runtime.id) return;
    if (msg?.type === 'clipsnatcher:context') {
      let c = null;
      if (lastRightClick && Date.now() - lastRightClick.t < CONTEXT_TTL_MS) {
        const f = videoAt(lastRightClick.x, lastRightClick.y);
        if (f && f !== 'button') c = f;
      }
      sendResponse({ ...gather(c), overVideo: !!c });
      return;
    }
    if (msg?.type === 'clipsnatcher:toast') {
      const r = msg.result;
      pendingNotice?.remove();
      pendingNotice = null;
      if (r?.pending) { pendingNotice = toast('Finding the video\u2026', 'info'); return; }
      toast(r?.message || (r?.ok ? `Download started: ${r.title || 'video'}${r.detail ? ` (${r.detail})` : ''}${r.warning ? `. ${r.warning}` : ''}` : (r?.error || 'Download failed.')), r?.ok ? 'ok' : 'err');
    }
  });

  // Notices live in a closed shadow root so the page's own scripts can't read them
  // (they can contain the title of a post from a different site).
  let toastStack = null, pendingNotice = null;
  const NOTICE_MS = { ok: 3500, info: 15000, err: 8000 };
  function toast(text, kind) {
    if (!toastStack) {
      const el = document.createElement('clipsnatcher-notice');
      el.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;';
      const root = el.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>
        .stack { display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
        .t { max-width: 340px; padding: 10px 14px; border-radius: 10px; color: #fff;
          font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.3); }
        .ok { background: #1a7f37; } .err { background: #b3202c; } .info { background: #2b2b33; }
      </style><div class="stack"></div>`;
      toastStack = root.querySelector('.stack');
      document.documentElement.appendChild(el);
    }
    const t = document.createElement('div');
    t.className = 't ' + kind;
    t.setAttribute('role', 'status');
    t.textContent = text;
    toastStack.appendChild(t);
    setTimeout(() => t.remove(), NOTICE_MS[kind] || 5000);
    return t;
  }
})();
