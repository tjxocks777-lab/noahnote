// 기기 간 동기화 "합치기" 회귀 테스트
//
// 지키려는 것: 두 기기에서 따로 공부한 내용이 합쳐질 때 어느 쪽도 사라지지 않는 것.
// (2026-11-05 이전에는 한쪽이 통째로 덮어써서 "업데이트한 내용이 전으로 돌아가는" 사고가 있었다.)
//
// 돌리기: node --test test/

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMergeFns } from './extract.mjs';

const M = await loadMergeFns();
const clone = o => JSON.parse(JSON.stringify(o));

// 문제 한 개 만들기
function q(id, over = {}) {
  return Object.assign({
    id, type: 'quiz', part: 'RC5', question: '문제 ' + id, answer: 'A',
    box: 0, correctCount: 0, wrongCount: 0, mastered: false,
    nextReviewDate: '2026-11-12', createdAt: '2026-11-01',
  }, over);
}
// 과목 한 개 만들기
const subject = (questions = [], over = {}) => Object.assign({
  questions, drafts: [], notes: [],
  settings: { wrongDays: 1, correctDays: 3, dailyLimit: 15 },
}, over);

const ids = arr => arr.map(x => x.id).sort();
const byId = (arr, id) => arr.find(x => x.id === id);

/* ───────────── 사라지지 않기 ───────────── */

test('양쪽에서 서로 다른 문제를 더하면 둘 다 남는다', () => {
  const base = [q('a')];
  const L = { T: subject([q('a'), q('b')]) };          // 폰에서 b 추가
  const R = { T: subject([q('a'), q('c')]) };          // PC에서 c 추가
  const B = { T: subject(clone(base)) };
  const out = M.syncMergeAll(L, R, B);
  assert.deepEqual(ids(out.T.questions), ['a', 'b', 'c']);
});

test('기준본이 없으면 (업데이트 직후 첫 합치기) 삭제를 반영하지 않고 모두 살린다', () => {
  const L = { T: subject([q('a')]) };                  // 폰에는 a 만
  const R = { T: subject([q('a'), q('b')]) };          // 서버에는 a, b
  const out = M.syncMergeAll(L, R, null);
  assert.deepEqual(ids(out.T.questions), ['a', 'b'], '기준본 없이 지우면 안 된다');
});

test('양쪽에서 같은 문제를 각각 고치면 칸별로 합친다', () => {
  const B = { T: subject([q('a', { question: '원래', explanation: '' })]) };
  const L = { T: subject([q('a', { question: '폰에서 고친 지문', explanation: '' })]) };
  const R = { T: subject([q('a', { question: '원래', explanation: 'PC에서 쓴 해설' })]) };
  const out = M.syncMergeAll(L, R, B);
  const a = byId(out.T.questions, 'a');
  assert.equal(a.question, '폰에서 고친 지문');
  assert.equal(a.explanation, 'PC에서 쓴 해설');
});

/* ───────────── 삭제 ───────────── */

test('이 기기에서 지운 문제는 서버가 그대로였으면 지워진 채로 남는다', () => {
  const B = { T: subject([q('a'), q('b')]) };
  const L = { T: subject([q('a')]) };                  // 폰에서 b 삭제
  const R = { T: subject([q('a'), q('b')]) };          // 서버는 그대로
  const out = M.syncMergeAll(L, R, B);
  assert.deepEqual(ids(out.T.questions), ['a'], '삭제가 전파돼야 한다');
});

test('서버에서 지운 문제도 이 기기가 그대로였으면 지워진다', () => {
  const B = { T: subject([q('a'), q('b')]) };
  const L = { T: subject([q('a'), q('b')]) };
  const R = { T: subject([q('a')]) };
  const out = M.syncMergeAll(L, R, B);
  assert.deepEqual(ids(out.T.questions), ['a']);
});

test('한쪽이 지우고 다른 쪽이 고쳤으면 고친 쪽을 살린다 (지우기보다 살리기 우선)', () => {
  const B = { T: subject([q('a'), q('b', { explanation: '' })]) };
  const L = { T: subject([q('a')]) };                                  // 폰에서 b 삭제
  const R = { T: subject([q('a'), q('b', { explanation: '해설 추가' })]) };  // PC에서 b 수정
  const out = M.syncMergeAll(L, R, B);
  assert.deepEqual(ids(out.T.questions), ['a', 'b']);
  assert.equal(byId(out.T.questions, 'b').explanation, '해설 추가');
});

/* ───────────── 복습 기록 ───────────── */

test('같은 문제를 양쪽에서 풀면 나중에 푼 쪽의 기록을 쓴다', () => {
  const B = { T: subject([q('a', { correctCount: 0, lastReviewed: 0 })]) };
  const L = { T: subject([q('a', { correctCount: 1, box: 1, lastReviewed: 1000, nextReviewDate: '2026-11-13' })]) };
  const R = { T: subject([q('a', { correctCount: 2, box: 2, lastReviewed: 2000, nextReviewDate: '2026-11-19' })]) };
  const a = byId(M.syncMergeAll(L, R, B).T.questions, 'a');
  assert.equal(a.correctCount, 2);
  assert.equal(a.nextReviewDate, '2026-11-19');
});

test('복습 기록은 한 묶음으로 같은 쪽 것을 쓴다 (섞이면 안 됨)', () => {
  const B = { T: subject([q('a', { correctCount: 0, box: 0, mastered: false, lastReviewed: 0 })]) };
  const L = { T: subject([q('a', { correctCount: 3, box: 2, mastered: true, lastReviewed: 5000, nextReviewDate: '2026-12-12' })]) };
  const R = { T: subject([q('a', { correctCount: 1, box: 1, mastered: false, lastReviewed: 100, nextReviewDate: '2026-11-13' })]) };
  const a = byId(M.syncMergeAll(L, R, B).T.questions, 'a');
  // 이긴 쪽(L)의 기록이 통째로 와야 한다 — mastered 는 true 인데 box 는 1 같은 섞임이 없어야 함
  assert.equal(a.correctCount, 3);
  assert.equal(a.box, 2);
  assert.equal(a.mastered, true);
  assert.equal(a.nextReviewDate, '2026-12-12');
});

test('틀린 횟수는 큰 쪽을 쓴다', () => {
  const B = { T: subject([q('a', { wrongCount: 1, lastReviewed: 0 })]) };
  const L = { T: subject([q('a', { wrongCount: 5, lastReviewed: 100 })]) };
  const R = { T: subject([q('a', { wrongCount: 9, lastReviewed: 200 })]) };
  assert.equal(byId(M.syncMergeAll(L, R, B).T.questions, 'a').wrongCount, 9);
});

test('날짜별 복습 기록은 양쪽에서 푼 만큼을 더한다', () => {
  const B = { T: subject([], { history: { '2026-11-11': { RC5: { done: 2, correct: 1 } } } }) };
  const L = { T: subject([], { history: { '2026-11-11': { RC5: { done: 5, correct: 3 } } } }) };  // 폰에서 3개 더
  const R = { T: subject([], { history: { '2026-11-11': { RC5: { done: 6, correct: 5 } } } }) };  // PC에서 4개 더
  const h = M.syncMergeAll(L, R, B).T.history['2026-11-11'].RC5;
  assert.equal(h.done, 9, '2 + 3 + 4');
  assert.equal(h.correct, 7, '1 + 2 + 4');
});

test('오늘 진행도도 양쪽에서 푼 만큼 더한다', () => {
  const b = { date: '2026-11-12', done: 2, correct: 2 };
  const l = { date: '2026-11-12', done: 5, correct: 4 };
  const r = { date: '2026-11-12', done: 4, correct: 3 };
  const out = M.syncMergeToday(l, r, b);
  assert.equal(out.done, 7);
  assert.equal(out.correct, 5);
});

test('날짜가 다른 오늘 진행도는 최신 날짜를 쓴다', () => {
  const out = M.syncMergeToday({ date: '2026-11-11', done: 9, correct: 9 }, { date: '2026-11-12', done: 1, correct: 1 }, null);
  assert.equal(out.date, '2026-11-12');
});

/* ───────────── 학습일지 ───────────── */

test('같은 날 일지를 양쪽에서 쓰면 두 글을 모두 남긴다', () => {
  const B = { T: subject([], { journal: { '2026-11-12': { text: '처음', at: 100 } } }) };
  const L = { T: subject([], { journal: { '2026-11-12': { text: '폰에서 쓴 글', at: 200 } } }) };
  const R = { T: subject([], { journal: { '2026-11-12': { text: 'PC에서 쓴 글', at: 300 } } }) };
  const t = M.syncMergeAll(L, R, B).T.journal['2026-11-12'].text;
  assert.ok(t.includes('폰에서 쓴 글'), '폰 글이 사라지면 안 된다');
  assert.ok(t.includes('PC에서 쓴 글'), 'PC 글이 사라지면 안 된다');
});

test('일지의 필기·사진은 가진 쪽을 살린다', () => {
  const B = { T: subject([], { journal: { '2026-11-12': { text: 'x', at: 100 } } }) };
  const L = { T: subject([], { journal: { '2026-11-12': { text: 'x', at: 200, strokes: [[1, 2]] } } }) };
  const R = { T: subject([], { journal: { '2026-11-12': { text: 'y', at: 300 } } }) };
  const d = M.syncMergeAll(L, R, B).T.journal['2026-11-12'];
  assert.deepEqual(d.strokes, [[1, 2]], '필기가 있는 쪽이 살아야 한다');
});

test('한쪽만 일지를 고쳤으면 고친 쪽을 쓴다 (이어붙이지 않음)', () => {
  const B = { T: subject([], { journal: { '2026-11-12': { text: '처음', at: 100 } } }) };
  const L = { T: subject([], { journal: { '2026-11-12': { text: '처음', at: 100 } } }) };
  const R = { T: subject([], { journal: { '2026-11-12': { text: '고친 글', at: 300 } } }) };
  assert.equal(M.syncMergeAll(L, R, B).T.journal['2026-11-12'].text, '고친 글');
});

/* ───────────── 과목 ───────────── */

test('한쪽에만 있는 새 과목은 합쳐진다', () => {
  const out = M.syncMergeAll({ T: subject([q('a')]), 방사선: subject([q('r')]) }, { T: subject([q('a')]) }, { T: subject([q('a')]) });
  assert.deepEqual(Object.keys(out).sort(), ['T', '방사선']);
});

test('지운 과목은 기준본이 있으면 지워진 채로 남는다', () => {
  const B = { T: subject([q('a')]), 옛과목: subject([q('x')]) };
  const L = { T: subject([q('a')]) };
  const R = clone(B);
  assert.deepEqual(Object.keys(M.syncMergeAll(L, R, B)), ['T']);
});

/* ───────────── 안전장치 ───────────── */

test('넘겨받은 객체를 고치지 않는다 (순수 함수)', () => {
  const L = { T: subject([q('a', { correctCount: 1, lastReviewed: 100 })]) };
  const R = { T: subject([q('a', { correctCount: 2, lastReviewed: 200 }), q('b')]) };
  const B = { T: subject([q('a')]) };
  const sL = JSON.stringify(L), sR = JSON.stringify(R), sB = JSON.stringify(B);
  M.syncMergeAll(L, R, B);
  assert.equal(JSON.stringify(L), sL, 'L 이 바뀌면 안 된다');
  assert.equal(JSON.stringify(R), sR, 'R 이 바뀌면 안 된다');
  assert.equal(JSON.stringify(B), sB, 'B 가 바뀌면 안 된다');
});

test('같은 합치기를 두 번 해도 결과가 같다 (멱등)', () => {
  const B = { T: subject([q('a')]) };
  const L = { T: subject([q('a', { correctCount: 1, lastReviewed: 100 }), q('b')]) };
  const R = { T: subject([q('a', { correctCount: 2, lastReviewed: 200 }), q('c')]) };
  const once = M.syncMergeAll(L, R, B);
  const twice = M.syncMergeAll(once, clone(once), B);
  assert.deepEqual(twice, once);
});

test('빈 쪽과 합쳐도 내용이 사라지지 않는다', () => {
  const L = { T: subject([q('a'), q('b')]) };
  assert.deepEqual(ids(M.syncMergeAll(L, {}, null).T.questions), ['a', 'b']);
  assert.deepEqual(ids(M.syncMergeAll({}, L, null).T.questions), ['a', 'b']);
});

test('문제 1,700개를 합치는 데 2초를 넘지 않는다', () => {
  const big = n => Array.from({ length: n }, (_, i) => q('q' + i, { correctCount: i % 3, lastReviewed: i }));
  const B = { T: subject(big(1700)) };
  const L = { T: subject(big(1700).map(x => ({ ...x, correctCount: 1, lastReviewed: 9000 }))) };
  const R = { T: subject(big(1700).map(x => ({ ...x, correctCount: 2, lastReviewed: 8000 }))) };
  const t0 = Date.now();
  const out = M.syncMergeAll(L, R, B);
  const ms = Date.now() - t0;
  assert.equal(out.T.questions.length, 1700);
  assert.ok(ms < 2000, `합치기가 ${ms}ms 걸렸어요 (2000ms 넘음)`);
});

/* ───────────── 해설(글 + 손글씨) ───────────── */

const exp = (t, n = 1) => ({
  text: t, strokes: Array(n).fill({ t: 'p', c: '#16233F', w: 0.01, p: [0, 0, 1] }),
  att: [], freeH: 0.4, drawing: '', drawingW: 0, drawingH: 0,
});

test('한쪽에서만 쓴 해설은 합친 뒤에도 남는다', () => {
  const B = { T: subject([q('a')]) };
  const L = { T: subject([q('a', { exp: exp('폰에서 쓴 해설', 2) })]) };
  const R = { T: subject([q('a')]) };
  const a = byId(M.syncMergeAll(L, R, B).T.questions, 'a');
  assert.equal(a.exp.text, '폰에서 쓴 해설');
  assert.equal(a.exp.strokes.length, 2, '손글씨가 사라지면 안 된다');
});

test('오답노트(초안)에 쓴 해설도 남는다', () => {
  const B = { T: subject([], { drafts: [{ id: 'd1', question: 'q' }] }) };
  const L = { T: subject([], { drafts: [{ id: 'd1', question: 'q', exp: exp('초안 해설') }] }) };
  const R = { T: subject([], { drafts: [{ id: 'd1', question: 'q' }] }) };
  assert.equal(M.syncMergeAll(L, R, B).T.drafts[0].exp.text, '초안 해설');
});

test('양쪽에서 해설을 고치면 한쪽이 통째로 이긴다 (섞이지 않는다)', () => {
  const B = { T: subject([q('a', { exp: exp('원래', 1) })]) };
  const L = { T: subject([q('a', { exp: exp('폰에서 고침', 3) })]) };
  const R = { T: subject([q('a', { exp: exp('PC 에서 고침', 5) })]) };
  const e = byId(M.syncMergeAll(L, R, B).T.questions, 'a').exp;
  // 글과 손글씨가 서로 다른 쪽에서 와서 어긋나면 안 된다
  const fromL = e.text === '폰에서 고침' && e.strokes.length === 3;
  const fromR = e.text === 'PC 에서 고침' && e.strokes.length === 5;
  assert.ok(fromL || fromR, `글과 손글씨가 섞였다: ${e.text} / 획 ${e.strokes.length}`);
});
