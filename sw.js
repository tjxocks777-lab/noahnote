/* NOAH NOTE 서비스워커 — 앱 껍데기를 저장해 두어 오프라인에서도 열리게 함 */
const VER = 'noah-note-v3';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-180.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).catch(()=>{}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
/* 다른 앱의 '공유' 메뉴로 보낸 사진·PDF·글을 받아 잠깐 보관했다가 앱으로 넘김 (안드로이드 설치 앱) */
async function handleShare(req){
  try{
    const fd = await req.formData();
    const cache = await caches.open('noah-share');
    for(const k of await cache.keys()) await cache.delete(k);
    const files = fd.getAll('media').filter(f => f && typeof f !== 'string');
    let i = 0;
    for(const f of files){ await cache.put('/shared-file/' + (i++), new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-name': encodeURIComponent(f.name || 'file') } })); }
    const text = [fd.get('title'), fd.get('text'), fd.get('url')].filter(Boolean).join('\n');
    await cache.put('/shared-text', new Response(text, { headers: { 'content-type': 'text/plain;charset=utf-8' } }));
  }catch(_){}
  return Response.redirect(new URL('./?share=1', self.registration.scope).href, 303);
}
/* 복습 알림 */
self.addEventListener('push', e => {
  let d = {}; try{ d = e.data ? e.data.json() : {}; }catch(_){}
  e.waitUntil(self.registration.showNotification(d.title || 'NOAH NOTE', { body: d.body || '오늘 복습할 시간이에요', icon: 'icon-192.png', badge: 'icon-192.png', tag: 'noah-review', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for(const c of cs){ if('focus' in c) return c.focus(); }
    return self.clients.openWindow('./');
  }));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if(req.method === 'POST' && url.pathname.endsWith('/share-target')){ e.respondWith(handleShare(req)); return; }
  if(req.method !== 'GET') return;
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
