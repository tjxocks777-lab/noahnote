// index.html 안의 "합치기" 순수 함수들을 떼어내 테스트에서 쓸 수 있게 한다.
//
// 왜 이렇게 하나: 합치기 로직은 index.html 안에 있고, 앱을 쪼개는 건 별개의 큰 작업이다.
// 그때까지는 소스를 고치지 않고 이 추출기로 테스트를 붙인다.
// 함수를 옮기거나 아래 표시(marker)를 바꾸면 테스트가 "못 찾았다"고 바로 실패하니,
// 조용히 낡은 코드를 검사하는 일은 생기지 않는다.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 떼어낼 구간: 이 두 줄 사이 (index.html 안의 주석)
const START = '/* ── 합치기 (순수 함수';
const END = '/* ── 서버 통신 ── */';

// 합치기 구간 밖에 있지만 필요한 함수
const EXTRA = ['function noteHasVisual('];

function sliceBetween(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`index.html 에서 "${start}" 를 찾지 못했어요. 합치기 코드가 옮겨졌는지 확인하세요.`);
  const b = src.indexOf(end, a);
  if (b < 0) throw new Error(`index.html 에서 "${end}" 를 찾지 못했어요. 합치기 코드가 옮겨졌는지 확인하세요.`);
  return src.slice(a, b);
}

// 'function foo(' 로 시작하는 한 함수를 중괄호 짝을 세어 통째로 가져온다 (문자열·주석 안의 괄호는 무시)
function grabFunction(src, head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error(`index.html 에서 "${head}" 를 찾지 못했어요.`);
  let j = src.indexOf('{', i);
  if (j < 0) throw new Error(`"${head}" 의 본문을 찾지 못했어요.`);
  let depth = 0, inStr = null, esc = false, inLine = false, inBlock = false;
  for (let k = j; k < src.length; k++) {
    const c = src[k], n = src[k + 1];
    if (inLine) { if (c === '\n') inLine = false; continue; }
    if (inBlock) { if (c === '*' && n === '/') { inBlock = false; k++; } continue; }
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === '/' && n === '/') { inLine = true; k++; continue; }
    if (c === '/' && n === '*') { inBlock = true; k++; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(i, k + 1); }
  }
  throw new Error(`"${head}" 의 끝을 찾지 못했어요.`);
}

const EXPORTS = [
  'syncMergeAll', 'syncMergeSubject', 'syncMergeArr', 'syncMergeItem',
  'syncMergeHist', 'syncMergeToday', 'syncMergeJournal', 'syncProgWinner', 'SYNC_PROG',
];

// 떼어낸 코드를 모듈로 읽어들인다.
// data: URL 로 import 하는 이유 — node:vm 샌드박스는 realm 이 달라서 거기서 만든 배열·객체가
// 호스트의 Array.prototype 과 달라지고, deepStrictEqual 이 "구조는 같지만 다른 realm" 이라며 거부한다.
// data: 모듈은 같은 realm 이라 그 문제가 없고, 임시 파일도 남기지 않는다.
export async function loadMergeFns() {
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const code = [...EXTRA.map(h => grabFunction(src, h)), sliceBetween(src, START, END)].join('\n');

  // 떼어낸 코드가 DOM·저장소를 건드리면 import 시점에 바로 터진다 (순수 함수라는 전제를 지키게 하는 장치)
  const mod = code + `\nexport { ${EXPORTS.join(', ')} };\n`;
  const fns = await import('data:text/javascript;charset=utf-8,' + encodeURIComponent(mod));

  for (const name of EXPORTS) {
    if (fns[name] === undefined) throw new Error(`${name} 을 떼어내지 못했어요.`);
  }
  return fns;
}

export { ROOT };
