/* 页面层冒烟测试：最小 DOM 桩下跑渲染与事件委托。node test/render.smoke.js */
'use strict';
const assert = require('node:assert');

const mem = {};
global.localStorage = {
  getItem: (k) => (k in mem ? mem[k] : null),
  setItem: (k, v) => { mem[k] = String(v); },
  removeItem: (k) => { delete mem[k]; },
};
global.prompt = () => '测试取消';
global.confirm = () => true;
global.alert = () => {};

const Scheduler = require('../js/scheduler.js');
global.Scheduler = Scheduler;
const Store = require('../js/store.js');
global.Store = Store;

/* 最小 DOM 桩 */
const listeners = {};
const elements = {};
const makeEl = () => ({
  innerHTML: '', value: '', dataset: {},
  addEventListener() {}, closest: () => null, matches: () => false,
  querySelector: () => makeEl(), querySelectorAll: () => [],
});
global.document = {
  getElementById: (id) => (elements[id] ??= makeEl()),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); },
};

require('../js/app.js'); // 加载即执行首次 renderAll

const fireClick = (action, id, extra = {}) => {
  const target = { closest: () => ({ dataset: { action, id, ...extra } }) };
  listeners.click.forEach((fn) => fn({ target }));
};

let passed = 0;
const ok = (name, fn) => { fn(); passed += 1; console.log('  ✓', name); };

ok('首次渲染：待派区/任务台/人员/变更均有内容', () => {
  assert.ok(elements['pending-list'].innerHTML.includes('C01'));
  assert.ok(elements['pending-list'].innerHTML.includes('留派原因')); // C05 种子带原因
  assert.ok(elements['task-list'].innerHTML.includes('变更轨迹'));
  assert.ok(elements['task-list'].innerHTML.includes('高风险案件复核确认前不能继续预付')); // C09 待复核
  assert.ok(elements['staff-list'].innerHTML.includes('陈国强'));
  assert.ok(elements['audit-list'].innerHTML.includes('派工'));
  assert.ok(elements['summary'].innerHTML.includes('待派'));
});

ok('待派区按事件→区域→损失排序（海鸥次生洪涝在前）', () => {
  const html = elements['pending-list'].innerHTML;
  assert.ok(html.indexOf('C11') < html.indexOf('C01'), 'C11 应排在 C01 前');
  assert.ok(html.indexOf('C01') < html.indexOf('C03'), '东涌镇应排在南屿镇前');
});

ok('点击展开复核表单', () => {
  fireClick('toggle-review', 'T2');
  assert.ok(elements['task-list'].innerHTML.includes('确认复核'));
  assert.ok(elements['task-list'].innerHTML.includes('林秀英')); // 可选复核人（非承办人陈国强）
  assert.ok(!elements['task-list'].innerHTML.includes('value="S1"'), '复核人不含承办人');
});

ok('点击取消任务：案件回待派区并写明原因', () => {
  fireClick('cancel-task', 'T3'); // C02 已派待到场
  assert.ok(elements['pending-list'].innerHTML.includes('C02'));
  assert.ok(elements['pending-list'].innerHTML.includes('班次已释放'));
  assert.ok(elements['audit-list'].innerHTML.includes('取消'));
});

ok('取消后班次立即可再派（通过保存层直接验证联动）', () => {
  const r = Store.createTask({ caseId: 'C02', staffId: 'S4', shiftId: 'H8', start: '09:30', end: '11:00' });
  assert.ok(r.ok, (r.reasons || []).join('；'));
});

console.log(`\n${passed} 项冒烟测试全部通过`);
