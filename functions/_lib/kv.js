// Cloudflare KV 를 얇게 감싼 도우미. 바인딩 이름: NOAH_KV (Pages 설정 → Functions → KV namespace bindings)
// 저장소 이름(sync, share, group, push)을 키 앞에 붙여 한 개의 KV 안에서 섞이지 않게 한다.
export const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
export const j = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: H });

export function store(env, name) {
  const kv = env && env.NOAH_KV;
  if (!kv) throw new Error('NOAH_KV 바인딩이 없어요');
  const p = name + ':';
  return {
    get: (key, type = 'text') => kv.get(p + key, type),                 // 'text' | 'json' | 'stream'
    set: (key, value, metadata) => kv.put(p + key, value, metadata ? { metadata } : undefined),
    setJSON: (key, obj, metadata) => kv.put(p + key, JSON.stringify(obj), metadata ? { metadata } : undefined),
    delete: (key) => kv.delete(p + key),
    // 본문을 읽지 않고 메타데이터만 확인 (없으면 null)
    async meta(key) {
      const r = await kv.getWithMetadata(p + key, 'stream');
      if (!r || !r.value) return null;
      try { await r.value.cancel(); } catch (_) {}
      return r.metadata || {};
    },
    // prefix 로 시작하는 모든 키(이름 + 메타데이터)
    async list(prefix) {
      const out = []; let cursor;
      for (let i = 0; i < 20; i++) {
        const r = await kv.list({ prefix: p + prefix, cursor });
        for (const k of r.keys) out.push({ key: k.name.slice(p.length), metadata: k.metadata || null });
        if (r.list_complete) break;
        cursor = r.cursor;
      }
      return out;
    },
  };
}

// 요청 안에서 한꺼번에 너무 많이 부르지 않도록 n개씩 끊어 실행
export async function mapLimit(items, n, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(...await Promise.all(items.slice(i, i + n).map(fn)));
  return out;
}
