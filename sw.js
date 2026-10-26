/* NOAH NOTE 서비스워커 — 앱 껍데기를 저장해 두어 오프라인에서도 열리게 함 */
const VER = 'noah-note-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).catch(()=>{}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);
  if(url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if(url.pathname.startsWith('/api/')) return;
  if(url.hostname === 'api.anthropic.com') return;           // 스캔(AI) 요청은 항상 인터넷으로
  if(req.mode === 'navigate'){                                // 화면: 인터넷이 되면 최신, 안 되면 저장본
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VER).then(c => c.put('index.html', cp)); return r; })
      .catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {                // 나머지(아이콘·글꼴 등): 저장본 먼저, 뒤에서 갱신
    const net = fetch(req).then(r => { if(r && (r.ok || r.type === 'opaque')){ const cp = r.clone(); caches.open(VER).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
