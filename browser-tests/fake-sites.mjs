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
  if (host === 'evil.example') {
    const mb = Number(new URL(q.url, 'https://x').searchParams.get('mb')) || 0;   // ?mb=4.2 pads the file to that size (for screenshots)
    return send(200, 'video/mp4', mb ? Buffer.concat([media('vf.mp4'), Buffer.alloc(Math.round(mb * 1048576))]) : media('vf.mp4'));
  }
  send(404, 'text/plain', 'no');
}).listen(port, '127.0.0.1');
}
