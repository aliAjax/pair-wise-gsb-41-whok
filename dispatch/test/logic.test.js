/* 排程层 + 保存层逻辑测试：node test/logic.test.js */
'use strict';
const assert = require('node:assert');

/* localStorage 桩，供保存层在 node 下运行 */
const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};

const Scheduler = require('../js/scheduler.js');
global.Scheduler = Scheduler;
let Store = require('../js/store.js');

const reloadStore = () => {
  delete require.cache[require.resolve('../js/store.js')];
  Store = require('../js/store.js');
  return Store;
};

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

/* ---------- 排序：事件 → 区域 → 损失 ---------- */
ok('案件按事件→区域→损失排序', () => {
  const sorted = Scheduler.sortCases([
    { id: 'A', event: '台风海鸥', region: '中洲镇', loss: 100 },
    { id: 'B', event: '台风海鸥', region: '东涌镇', loss: 50 },
    { id: 'C', event: '台风海鸥', region: '东涌镇', loss: 900 },
    { id: 'D', event: '海鸥次生洪涝', region: '东涌镇', loss: 1 },
  ]);
  assert.deepStrictEqual(sorted.map((c) => c.id), ['D', 'C', 'B', 'A']);
});

/* ---------- 派工校验 ---------- */
const state = () => Store.get();

ok('资质不符：高风险案件不能派给无资质查勘员', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C01', staffId: 'S3', shiftId: 'H6', start: '10:00', end: '11:00',
  });
  assert.ok(!r.ok);
  assert.ok(r.reasons.some((x) => x.includes('资质不符')));
});

ok('任务撞车：与已有任务时间重叠被拒', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C06', staffId: 'S1', shiftId: 'H1', start: '10:00', end: '11:00', // 与 T2 09:00-10:30 重叠
  });
  assert.ok(!r.ok);
  assert.ok(r.reasons.some((x) => x.includes('任务撞车')));
});

ok('跨区赶场不足90分钟被拒', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C01', staffId: 'S1', shiftId: 'H1', start: '11:00', end: '12:00', // 中洲镇10:30结束→东涌镇仅30分钟
  });
  assert.ok(!r.ok);
  assert.ok(r.reasons.some((x) => x.includes('跨区赶场不足90分钟') && x.includes('30 分钟')));
});

ok('跨区间隔≥90分钟放行', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C01', staffId: 'S1', shiftId: 'H2', start: '13:00', end: '14:30', // 距 T2 结束 150 分钟
  });
  assert.ok(r.ok, r.reasons.join('；'));
});

ok('同区域紧邻任务不算跨区、不重叠即放行', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C10', staffId: 'S1', shiftId: 'H1', start: '10:30', end: '11:30', // 同在中洲镇，紧接 T2
  });
  assert.ok(r.ok, r.reasons.join('；'));
});

ok('超出班次时段被拒', () => {
  const r = Scheduler.validateAssignment(state(), {
    caseId: 'C08', staffId: 'S4', shiftId: 'H8', start: '08:00', end: '09:30', // H8 09:00 才开始
  });
  assert.ok(!r.ok);
  assert.ok(r.reasons.some((x) => x.includes('超出班次时段')));
});

/* ---------- 保存层：派工留原因、取消释放、改派 ---------- */
ok('派工被拒：案件留在待派区并写明原因、记入变更', () => {
  const r = Store.createTask({ caseId: 'C03', staffId: 'S3', shiftId: 'H6', start: '10:30', end: '11:30' });
  assert.ok(!r.ok);
  const c = state().cases.find((x) => x.id === 'C03');
  assert.strictEqual(c.status, 'pending');
  assert.ok(c.pendingReason.includes('资质不符'));
  assert.ok(state().audit[0].type === '派工被拒');
});

ok('派工成功：生成任务、案件转已派', () => {
  const r = Store.createTask({ caseId: 'C01', staffId: 'S1', shiftId: 'H2', start: '13:00', end: '14:30' });
  assert.ok(r.ok, (r.reasons || []).join('；'));
  assert.strictEqual(state().cases.find((x) => x.id === 'C01').status, 'assigned');
});

ok('取消立即释放班次：同时段可再派', () => {
  const task = state().tasks.find((t) => t.caseId === 'C01' && t.status === 'scheduled');
  Store.cancelTask(task.id, '测试取消');
  assert.strictEqual(state().cases.find((x) => x.id === 'C01').status, 'pending');
  const r = Store.createTask({ caseId: 'C01', staffId: 'S1', shiftId: 'H2', start: '13:00', end: '14:30' });
  assert.ok(r.ok, (r.reasons || []).join('；')); // 班次已释放，重派成功
});

ok('改派撞车被拒并写明原因', () => {
  const task = state().tasks.find((t) => t.caseId === 'C01' && t.status === 'scheduled');
  const r = Store.reassignTask(task.id, { staffId: 'S1', shiftId: 'H1', start: '09:30', end: '10:30' }); // 撞 T2
  assert.ok(!r.ok);
  assert.ok(r.reasons.some((x) => x.includes('任务撞车')));
});

ok('改派成功：原班次释放、轨迹留痕', () => {
  const task = state().tasks.find((t) => t.caseId === 'C01' && t.status === 'scheduled');
  const r = Store.reassignTask(task.id, { staffId: 'S2', shiftId: 'H5', start: '14:00', end: '15:30' });
  assert.ok(r.ok, (r.reasons || []).join('；'));
  const t2 = state().tasks.find((x) => x.id === task.id);
  assert.strictEqual(t2.staffId, 'S2');
  assert.ok(t2.history.some((h) => h.action === '改派' && h.detail.includes('原班次已释放')));
});

/* ---------- 到场 / 复核 / 预付 ---------- */
ok('高风险到场后待复核，复核确认前不能预付', () => {
  const t = state().tasks.find((x) => x.caseId === 'C09'); // 种子：高风险已到场
  assert.strictEqual(t.status, 'onsite');
  const r = Store.prepay('C09');
  assert.ok(!r.ok);
  assert.ok(r.reason.includes('复核确认前不能继续预付'));
});

ok('复核人须为高风险资质且非承办人', () => {
  const t = state().tasks.find((x) => x.caseId === 'C09');
  assert.ok(!Store.reviewTask(t.id, 'S3').ok); // 无资质
  assert.ok(!Store.reviewTask(t.id, 'S1').ok); // 承办人本人
});

ok('复核确认后预付放行', () => {
  const t = state().tasks.find((x) => x.caseId === 'C09');
  assert.ok(Store.reviewTask(t.id, 'S2').ok);
  assert.ok(Store.prepay('C09').ok);
  assert.ok(state().cases.find((x) => x.id === 'C09').prepayPaid);
});

ok('一般案件到场即完成并可预付', () => {
  const t = state().tasks.find((x) => x.caseId === 'C02');
  Store.onsiteTask(t.id, { damageNote: '墙体倒塌', riskNote: '无' });
  assert.strictEqual(state().tasks.find((x) => x.id === t.id).status, 'done');
  assert.ok(Store.prepay('C02').ok);
});

/* ---------- 持久化：重开仍能追溯 ---------- */
ok('重开后任务、人员、变更记录仍在', () => {
  const before = state();
  const s2 = reloadStore().get();
  assert.strictEqual(s2.tasks.length, before.tasks.length);
  assert.strictEqual(s2.staff.length, before.staff.length);
  assert.ok(s2.audit.length >= before.audit.length);
  const t = s2.tasks.find((x) => x.caseId === 'C01' && x.status !== 'cancelled');
  assert.ok(t.history.some((h) => h.action === '改派'));
  assert.ok(s2.audit.some((a) => a.type === '复核确认'));
});

console.log(`\n${passed} 项逻辑测试全部通过`);
