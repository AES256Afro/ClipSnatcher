// Local stand-ins for x.com (a page with one video), www.reddit.com (a few posts), v.redd.it
// (their video and audio tracks, one deliberately slow, one redirecting away) and evil.example
// (an "outside" host). Chrome is pointed here with --host-resolver-rules.
import https from 'node:https';

// media: { 'vf.mp4': Uint8Array, 'af.mp4': Uint8Array } (video-only and audio-only files)
export function startFakeSites({ key, cert, media: files, port }) {
const media = (name) => Buffer.from(files[name]);
const xPage = `<!doctype html><meta charset="utf-8"><title>Fake X page</title><body style="margin:0;background:#000;color:#fff;font:14px sans-serif">
<article style="margin:60px;width:520px"><a href="/elonmusk/status/1585341984679469056"><time>10:00</time></a>
<div data-testid="videoPlayer" style="width:480px;height:270px;background:#234"><video style="width:480px;height:270px" muted></video></div></article>
<div id="elsewhere" style="margin:60px;width:300px;height:100px;background:#222">no video here</div></body>`;
const fbFeed = `<!doctype html><meta charset="utf-8"><title>Facebook</title><body style="margin:0;background:#f0f2f5;font:14px sans-serif">
<div role="article" style="position:absolute;left:40px;top:20px"><div data-video-id="5471242699683085"><div><div><video style="width:400px;height:200px;background:#345" muted></video></div></div></div></div>
<div role="article" data-ad-video style="position:absolute;left:40px;top:250px"><div><video style="width:400px;height:200px;background:#543" muted></video></div></div>
<div role="article" style="position:absolute;left:40px;top:480px"><div data-video-id="9999999999"><video style="width:190px;height:150px;background:#354" muted></video><video style="width:190px;height:150px;background:#354;margin-left:20px" muted></video></div></div>
</body>`;
const fbProgressive = (id, name) => `{"id":"${id}","videoDeliveryLegacyFields":null,"videoDeliveryResponseFragment":{"videoDeliveryResponseResult":{"dash_manifests":[],"progressive_urls":[`
  + `{"progressive_url":"https:\\/\\/video-hou1-1.xx.fbcdn.net\\/${name}-sd.mp4","failure_reason":null,"metadata":{"quality":"SD"}},`
  + `{"progressive_url":"https:\\/\\/video-hou1-1.xx.fbcdn.net\\/${name}-hd.mp4","failure_reason":null,"metadata":{"quality":"HD"}}]}}}`;
const fbReelPage = (id) => `<!doctype html><head><meta property="og:title" content="Fake Facebook clip ${id} | Facebook"></head><body><script type="application/json">`
  + fbProgressive(id, 'clip-' + id) + 'x'.repeat(12000) + fbProgressive('1212121212', 'next-reel') + '</script></body>';
const rv = (dir, audio = true) => ({ secure_media: { reddit_video: { fallback_url: `https://v.redd.it/${dir}/vf.mp4`, dash_url: `https://v.redd.it/${dir}/DASHPlaylist.mpd`, has_audio: audio } } });
const posts = {
  red001: rv('testvid'), red002: rv('testvid'), bad999: rv('broken'), slow01: rv('slowvid'),
  redir1: rv('redir', false),
  ext111: { domain: 'evil.example', url_overridden_by_dest: 'https://evil.example/vf.mp4' },
};
const listing = (id) => JSON.stringify([{ data: { children: [{ data: { title: 'Fake clip ' + id, subreddit_name_prefixed: 'r/test', permalink: `/r/test/comments/${id}/fake/`, domain: 'v.redd.it', ...posts[id] } }] } }]);
const mpd = '<AdaptationSet contentType="video"><Representation bandwidth="1" height="270"><BaseURL>vf.mp4</BaseURL></Representation></AdaptationSet><AdaptationSet contentType="audio"><Representation bandwidth="64000"><BaseURL>af.mp4</BaseURL></Representation></AdaptationSet>';
return https.createServer({ key, cert }, (q, s) => {
  const host = (q.headers.host || '').split(':')[0]; const path = q.url.split('?')[0];
  const send = (code, type, body, extra = {}) => { s.writeHead(code, { 'content-type': type, ...extra }); s.end(body); };
  if (host === 'x.com') return send(200, 'text/html', xPage);
  if (host === 'www.reddit.com') {
    const m = path.match(/^\/comments\/([a-z0-9]+)(\.json|\/)$/);
    if (m && posts[m[1]]) return m[2] === '.json' ? send(200, 'application/json', listing(m[1])) : send(200, 'text/html', '<html></html>');
    return send(404, 'text/plain', 'no');
  }
  if (host === 'v.redd.it') {
    if (path.endsWith('DASHPlaylist.mpd')) return send(200, 'application/dash+xml', mpd);
    if (path === '/broken/af.mp4') return send(403, 'text/plain', 'no');
    if (path.startsWith('/redir/')) return send(302, 'text/plain', '', { location: 'https://evil.example/vf.mp4' });
    if (/^\/(testvid|broken)\/(vf|af)\.mp4$/.test(path)) return send(200, 'video/mp4', media(path.split('/').pop()));
    if (/^\/slowvid\/(vf|af)\.mp4$/.test(path)) return void setTimeout(() => send(200, 'video/mp4', media(path.split('/').pop())), 5000);
    return send(404, 'text/plain', 'no');
  }
  // A Facebook home feed with three kinds of video unit, and the pages behind them. Like the
  // real site, a reel page holds the video's addresses only when the request asks for HTML,
  // uses the logged-in "progressive_urls" format, and preloads the next reel's video.
  if (host === 'www.facebook.com') {
    if (path === '/') return send(200, 'text/html', fbFeed);
    if (/^\/watch\/?$/.test(path)) {
      const v = new URL(q.url, 'https://x').searchParams.get('v') || '';
      return /^\d+$/.test(v) ? send(302, 'text/plain', '', { location: `https://www.facebook.com/reel/${v}/` }) : send(404, 'text/plain', 'no');
    }
    const reel = path.match(/^\/reel\/(\d+)\/?$/)?.[1];
    if (reel) return send(200, 'text/html', /text\/html/.test(q.headers.accept || '') ? fbReelPage(reel) : '<html><body>No video data for this request.</body></html>');
    return send(404, 'text/plain', 'no');
  }
  if (host === 'video-hou1-1.xx.fbcdn.net') return send(200, 'video/mp4', media('vf.mp4'));
  if (host === 'evil.example') {
    const mb = Number(new URL(q.url, 'https://x').searchParams.get('mb')) || 0;   // ?mb=4.2 pads the file to that size (for screenshots)
    return send(200, 'video/mp4', mb ? Buffer.concat([media('vf.mp4'), Buffer.alloc(Math.round(mb * 1048576))]) : media('vf.mp4'));
  }
  send(404, 'text/plain', 'no');
}).listen(port, '127.0.0.1');
}
