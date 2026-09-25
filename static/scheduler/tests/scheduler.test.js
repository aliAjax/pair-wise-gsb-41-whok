/* ============================================================
 * scheduler.test.js —— 排程层纯规则测试（零依赖，node tests/scheduler.test.js）
 * 通过最小 window/localStorage 垫片加载 storage.js 与 scheduler.js。
 * ============================================================ */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sandbox = {};
sandbox.window = sandbox;
sandbox.localStorage = (function () {
  let m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k)
  };
})();
sandbox.console = console;
vm.createContext(sandbox);

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
}
load('storage.js');
load('scheduler.js');

const S = sandbox.Scheduler;
const Store = sandbox.Store;
let state = Store.reset();
let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ✓ ' + name);
}
function reasonsOf(draft) {
  return S.validateAssignment(state, draft).reasons;
}

console.log('案件排序');
test('事件新→旧 → 区域固定顺序 → 损失高→低', () => {
  // TY15 内先按区域码：BEILING(105) → LINHAI(101 185万 > 103 132万) → NANTANG(102 > 106)；TY14 的 104 在最后
  const nos = Array.from(S.sortedCases(state), c => c.no);
  assert.deepStrictEqual(nos, ['260925-105', '260925-101', '260925-103', '260925-102', '260925-106', '260925-104']);
});

console.log('派工校验');
test('高风险案件派给无资质人员：拦截并说明资质不符', () => {
  const r = reasonsOf({ caseId: 'C260925-101', staffId: 'S03', start: '2026-09-25 11:00', end: '2026-09-25 11:40' });
  assert.ok(r.some(x => x.includes('资质不符')), r.join('|'));
});

test('不在登记班次内：拦截', () => {
  const r = reasonsOf({ caseId: 'C260925-102', staffId: 'S03', start: '2026-09-25 07:00', end: '2026-09-25 07:40' });
  assert.ok(r.some(x => x.includes('登记班次')), r.join('|'));
});

test('任务撞车（与在办任务时间重叠）：拦截', () => {
  // T-001：S05 14:00–15:15 北岭
  const r = reasonsOf({ caseId: 'C260925-104', staffId: 'S05', start: '2026-09-25 14:30', end: '2026-09-25 15:00' });
  assert.ok(r.some(x => x.includes('任务撞车')), r.join('|'));
});

test('跨区赶场不足90分钟：拦截并给出实际间隔', () => {
  // S05 14:00–15:15 北岭；新任务 16:00 东岐（跨区），间隔仅45分钟
  const r = reasonsOf({ caseId: 'C260925-104', staffId: 'S05', start: '2026-09-25 16:00', end: '2026-09-25 16:40' });
  assert.ok(r.some(x => x.includes('跨区赶场仅 45 分钟')), r.join('|'));
});

test('跨区但间隔≥90分钟：同单成功', () => {
  const r = S.validateAssignment(state,
    { caseId: 'C260925-104', staffId: 'S05', start: '2026-09-25 16:45', end: '2026-09-25 17:00' });
  // 15:15 → 16:45 = 90 分钟，恰好满足；且在班次 08:00–17:00 内
  assert.ok(r.ok, r.reasons.join('|'));
});

test('同区背靠背不要求90分钟', () => {
  // S02 班次 09:00–19:00；取消任务 T20260925-000（09:00–10:00）已释放，
  // 在同区紧邻排两个任务之间不需要90分钟
  const r = S.validateAssignment(state,
    { caseId: 'C260925-102', staffId: 'S02', start: '2026-09-25 09:00', end: '2026-09-25 10:00' });
  assert.ok(r.ok, r.reasons.join('|'));
  // 同区紧邻（间隔5分钟）也允许
  state.tasks.push({ id: 'T-TEST-1', caseId: 'C260925-106', staffId: 'S02',
    start: '2026-09-25 11:00', end: '2026-09-25 12:00', status: 'scheduled',
    survey: null, review: null, payment: null });
  const r2 = S.validateAssignment(state,
    { caseId: 'C260925-102', staffId: 'S02', start: '2026-09-25 12:05', end: '2026-09-25 12:50' });
  assert.ok(r2.ok, r2.reasons.join('|'));
});

test('已取消/已改派任务释放班次，不再参与撞车', () => {
  const t = state.tasks.find(x => x.id === 'T20260925-000'); // S02 09:00–10:00 cancelled
  assert.strictEqual(S.activeTasksForStaff(state, 'S02').some(x => x.id === t.id), false);
  // T-TEST-1 在 11:00–12:00；09:30–10:20 仅与已取消任务“重叠”，应通过
  const r = S.validateAssignment(state,
    { caseId: 'C260925-102', staffId: 'S02', start: '2026-09-25 09:30', end: '2026-09-25 10:20' });
  assert.ok(r.ok, r.reasons.join('|'));
});

test('同时触发多条原因时全部返回', () => {
  // 高风险派给无资质 + 无班次（S04 在10:00后才有班，且无高风险资质）
  const r = reasonsOf({ caseId: 'C260925-101', staffId: 'S04', start: '2026-09-25 08:30', end: '2026-09-25 09:00' });
  assert.ok(r.length >= 2, r.join('|'));
});

console.log('复核与预付门槛');
const reviewedTask = {
  id: 'T20260925-001', caseId: 'C260925-105', staffId: 'S05',
  start: '2026-09-25 14:00', end: '2026-09-25 15:15', status: 'surveyed',
  survey: { lossEstimate: 980000 }, review: null, payment: null
};

test('复核人无高风险资质：拦截', () => {
  const r = S.validateReviewer(state, reviewedTask, 'S03');
  assert.ok(!r.ok && r.reasons[0].includes('高风险资质'));
});

test('复核人与查勘员同一人：岗位回避拦截', () => {
  const r = S.validateReviewer(state, reviewedTask, 'S05');
  assert.ok(!r.ok && r.reasons[0].includes('同一人'));
});

test('高风险案件复核确认前不能预付', () => {
  const g = S.canPrepay(state, reviewedTask);
  assert.ok(!g.ok && g.reason.includes('复核确认'));
});

test('高风险案件经合格复核人确认后可以预付', () => {
  const r = S.validateReviewer(state, reviewedTask, 'S01');
  assert.ok(r.ok, r.reasons && r.reasons.join('|'));
  const confirmed = Object.assign({}, reviewedTask, {
    status: 'reviewed', review: { reviewerId: 'S01', confirmed: true }
  });
  assert.ok(S.canPrepay(state, confirmed).ok);
});

console.log('\n全部 ' + passed + ' 项通过 ✔');
