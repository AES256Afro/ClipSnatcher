// ClipSnatcher page helper. Does nothing until your pointer is over a video: then it shows
// one small "Save" button. No observers on the feed, no network requests, no tracking.
(() => {
  if (window.__clipsnatcherLoaded) return;
  window.__clipsnatcherLoaded = true;

  const host = location.hostname;
  const SITE = /(^|\.)(x|twitter)\.com$/.test(host) ? 'x'
    : /(^|\.)reddit\.com$/.test(host) ? 'reddit'
    : /(^|\.)facebook\.com$/.test(host) ? 'facebook' : 'web';
  const CONTAINER = {
    x: '[data-testid="videoComponent"], [data-testid="videoPlayer"]',
    reddit: 'shreddit-player-2, shreddit-player, .reddit-video-player-root, [data-hook="video-player"]',
  }[SITE] || null;

  let enabled = true;
  chrome.storage.local.get('settings').then(({ settings }) => { enabled = settings?.hoverButton !== false; });
  chrome.storage.onChanged.addListener((c) => {
    if (c.settings) { enabled = c.settings.newValue?.hoverButton !== false; if (!enabled) hide(); }
  });

  /* ------------------------------------------------------------ the button */
  let hostEl, btn, tip, current = null, hideTimer = 0, busy = false;

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
        button.ok { background: #1a7f37; } button.err { background: #cf222e; }
        svg { width: 15px; height: 15px; flex: none; }
        .spin { animation: s 0.8s linear infinite; } @keyframes s { to { transform: rotate(360deg); } }
        .tip { position: absolute; top: 36px; right: 0; width: max-content; max-width: 260px; padding: 7px 9px;
          border-radius: 8px; background: #111; color: #fff; font: 12px/1.35 -apple-system, BlinkMacSystemFont, sans-serif;
          box-shadow: 0 4px 14px rgba(0,0,0,.35); display: none; }
      </style>
      <button type="button" title="Save this video (ClipSnatcher)"></button>
      <div class="tip"></div>`;
    btn = root.querySelector('button');
    tip = root.querySelector('.tip');
    setLabel('idle');
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
  function setLabel(state, text) {
    btn.className = state === 'ok' ? 'ok' : state === 'err' ? 'err' : '';
    btn.innerHTML = ICONS[state] + `<span>${{ idle: 'Save', busy: 'Saving…', ok: 'Saved', err: 'Failed' }[state]}</span>`;
    tip.textContent = text || '';
    tip.style.display = text ? 'block' : 'none';
  }

  function place() {
    if (!current || !current.isConnected) return hide();
    const r = current.getBoundingClientRect();
    if (r.width < 120 || r.height < 80 || r.bottom < 0 || r.top > innerHeight) return hide();
    const top = Math.max(8, r.top + 10);
    const right = Math.min(innerWidth - 8, r.right - 10);
    hostEl.style.transform = `translate(${Math.round(right)}px, ${Math.round(top)}px) translateX(-100%)`;
    hostEl.style.display = 'block';
  }

  function show(container) {
    if (!enabled) return;
    if (!hostEl) build();
    clearTimeout(hideTimer);
    if (container !== current && !busy) setLabel('idle');
    current = container;
    place();
  }
  function hide() {
    if (busy) return;
    current = null;
    if (hostEl) hostEl.style.display = 'none';
  }
  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 450);
  }

  /* ------------------------------------------------------ finding the video */
  function videoAt(x, y) {
    const els = document.elementsFromPoint(x, y);
    for (const el of els) {
      if (el === hostEl) return 'button';
      if (CONTAINER) { const c = el.closest?.(CONTAINER); if (c) return c; }
      if (el.tagName === 'VIDEO') return el;
    }
    return null;
  }

  let lastCheck = 0, pending = 0;
  document.addEventListener('mouseover', (e) => {
    if (!enabled) return;
    const now = performance.now();
    const run = () => {
      lastCheck = performance.now();
      const found = videoAt(e.clientX, e.clientY);
      if (found === 'button') return;
      if (found) show(found); else if (current) scheduleHide();
    };
    clearTimeout(pending);
    if (now - lastCheck > 90) run(); else pending = setTimeout(run, 90);
  }, { passive: true, capture: true });

  let raf = 0;
  addEventListener('scroll', () => {
    if (!current || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; place(); });
  }, { passive: true, capture: true });

  /* ------------------------------------------- context about the hovered video */
  function gather(container) {
    const info = { site: SITE, pageUrl: location.href, postUrl: null, titleHint: document.title, index: 0, quoted: false, videoSrc: null, packaged: null };
    const video = container?.tagName === 'VIDEO' ? container : container?.querySelector?.('video');
    const src = video?.currentSrc || video?.src || video?.querySelector?.('source')?.src || '';
    if (src && !src.startsWith('blob:')) info.videoSrc = src;

    if (SITE === 'x') {
      const article = container?.closest('article');
      if (article) {
        const quote = container.closest('div[role="link"]');
        info.quoted = !!(quote && article.contains(quote));
        const timeLink = article.querySelector('a[href*="/status/"] time')?.closest('a');
        if (timeLink) info.postUrl = timeLink.href;
        const scope = info.quoted ? quote : article;
        const vids = [...scope.querySelectorAll('video')];
        const i = video ? vids.indexOf(video) : -1;
        if (i >= 0 && vids.length > 1) info.index = i + 1;
      }
      if (!info.postUrl && /\/status\/\d+/.test(location.pathname)) info.postUrl = location.href;
    } else if (SITE === 'reddit') {
      info.packaged = container?.getAttribute?.('packaged-media-json') || null;
      const post = container?.closest?.('shreddit-post');
      const perm = post?.getAttribute('permalink') || container?.closest?.('.thing')?.getAttribute('data-permalink');
      if (perm) info.postUrl = new URL(perm, location.origin).href;
      if (post?.getAttribute('post-title')) info.titleHint = post.getAttribute('post-title');
      if (!info.postUrl && /\/comments\//.test(location.pathname)) info.postUrl = location.href;
    } else if (SITE === 'facebook') {
      const sel = 'a[href*="/videos/"], a[href*="/reel/"], a[href*="/watch/?v="], a[href*="/watch?v="]';
      let el = container;
      for (let i = 0; i < 25 && el && !info.postUrl; i++, el = el.parentElement) {
        const a = el.matches?.(sel) ? el : el.querySelector?.(sel);
        if (a) info.postUrl = a.href;
      }
      if (/\/(videos|reel|watch)\b/.test(location.pathname + location.search)) info.postUrl = info.postUrl || location.href;
    }
    return info;
  }

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !current) return;
    busy = true;
    setLabel('busy');
    const hint = gather(current);
    let res;
    try {
      res = await chrome.runtime.sendMessage({ type: 'clipsnatcher:download', url: hint.postUrl || hint.videoSrc || location.href, hint });
    } catch (err) {
      res = { ok: false, error: 'ClipSnatcher was updated or reloaded. Refresh this page and try again.' };
    }
    busy = false;
    showResult(res);
  }

  function showResult(res) {
    if (!hostEl) build();
    if (res?.ok) setLabel('ok', res.warning || '');
    else setLabel('err', res?.error || 'Something went wrong.');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { setLabel('idle'); hide(); }, res?.ok ? 2200 : 6000);
  }

  /* -------------------------------------------- right-click menu support */
  let lastRightClick = null;
  document.addEventListener('contextmenu', (e) => { lastRightClick = { x: e.clientX, y: e.clientY, t: Date.now() }; }, { passive: true, capture: true });

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (msg?.type === 'clipsnatcher:context') {
      let c = null;
      if (lastRightClick && Date.now() - lastRightClick.t < 60000) {
        const f = videoAt(lastRightClick.x, lastRightClick.y);
        if (f && f !== 'button') c = f;
      }
      sendResponse(c ? gather(c) : { ...gather(null), postUrl: null });
      return;
    }
    if (msg?.type === 'clipsnatcher:toast') {
      const r = msg.result;
      toast(r?.ok ? `Saved: ${r.title || 'video'}` : (r?.error || 'Download failed.'), r?.ok);
    }
  });

  function toast(text, ok) {
    const t = document.createElement('clipsnatcher-toast');
    t.style.cssText = `all:initial;position:fixed;z-index:2147483647;right:16px;bottom:16px;max-width:340px;padding:10px 14px;border-radius:10px;
      font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#fff;background:${ok ? '#1a7f37' : '#cf222e'};
      box-shadow:0 6px 20px rgba(0,0,0,.3);`;
    t.textContent = text;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), ok ? 3000 : 6000);
  }
})();
