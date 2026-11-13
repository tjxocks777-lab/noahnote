// Cloudflare KV 를 흉내 낸 가짜 저장소.
// functions/_lib/kv.js 가 실제로 쓰는 것만 구현한다: get(type) · put(metadata) · getWithMetadata · delete · list

export function makeKV() {
  const map = new Map();   // key → { value: string, metadata: object|null }

  const toStream = (s) => new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(s)); c.close(); },
  });

  return {
    _map: map,
    async get(key, type = 'text') {
      const e = map.get(key);
      if (!e) return null;
      if (type === 'json') return JSON.parse(e.value);
      if (type === 'stream') return toStream(e.value);
      return e.value;
    },
    async put(key, value, opts) {
      map.set(key, { value: String(value), metadata: (opts && opts.metadata) || null });
    },
    async getWithMetadata(key, type = 'text') {
      const e = map.get(key);
      if (!e) return { value: null, metadata: null };
      return { value: type === 'stream' ? toStream(e.value) : e.value, metadata: e.metadata };
    },
    async delete(key) { map.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...map.keys()].filter(k => k.startsWith(prefix))
        .map(name => ({ name, metadata: map.get(name).metadata }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

export const envWith = (kv) => ({ NOAH_KV: kv });

// 앱이 서버로 올리는 본문 모양 (sync.js 는 앞 400자만 검사한다)
export const body = (savedAt, subjects = { T: { questions: [] } }, extra = {}) =>
  JSON.stringify(Object.assign({ app: 'noah-note', savedAt, subjects }, extra));

export const url = (qs) => 'https://example.workers.dev/api/sync?' + qs;
export const KEY = 'a'.repeat(64);
