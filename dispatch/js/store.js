/* 保存层：状态、localStorage 持久化、变更记录。排程规则一律走 Scheduler，页面不直接改数据。 */
const Store = (() => {
  'use strict';

  const KEY = 'typhoon-dispatch-v1';

  /* ---------- 示例数据：台风「海鸥」过境后的第一个查勘日 ---------- */
  function seedState() {
    const now = Date.now();
    const H = 3600000;
    return {
      seq: { C: 12, S: 5, H: 11, T: 5 },
      cases: [
        { id: 'C01', event: '台风海鸥', region: '东涌镇', title: '化工厂房受损', loss: 1200000, riskLevel: 'high', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C02', event: '台风海鸥', region: '东涌镇', title: '农房倒塌', loss: 80000, riskLevel: 'normal', status: 'assigned', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C03', event: '台风海鸥', region: '南屿镇', title: '加油站顶棚坍塌', loss: 650000, riskLevel: 'high', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C04', event: '台风海鸥', region: '南屿镇', title: '渔船搁浅损毁', loss: 320000, riskLevel: 'normal', status: 'done', pendingReason: '', prepayPaid: true, prepayAt: now - 2 * H, createdAt: now - 20 * H },
        { id: 'C05', event: '台风海鸥', region: '西港镇', title: '冷链仓库进水', loss: 450000, riskLevel: 'normal', status: 'pending', pendingReason: '原任务已取消，班次已释放，待重新派工', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C06', event: '台风海鸥', region: '西港镇', title: '老旧危房墙体开裂', loss: 150000, riskLevel: 'high', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C07', event: '台风海鸥', region: '北岙镇', title: '果园绝收', loss: 900000, riskLevel: 'normal', status: 'assigned', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C08', event: '台风海鸥', region: '北岙镇', title: '养殖场围网损毁', loss: 260000, riskLevel: 'normal', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C09', event: '台风海鸥', region: '中洲镇', title: '校舍屋顶掀翻', loss: 780000, riskLevel: 'high', status: 'review', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C10', event: '台风海鸥', region: '中洲镇', title: '沿街商铺进水', loss: 120000, riskLevel: 'normal', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 20 * H },
        { id: 'C11', event: '海鸥次生洪涝', region: '东涌镇', title: '光伏电站受淹', loss: 2100000, riskLevel: 'high', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 19 * H },
        { id: 'C12', event: '海鸥次生洪涝', region: '南屿镇', title: '码头栈桥损毁', loss: 540000, riskLevel: 'normal', status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: now - 19 * H },
      ],
      staff: [
        { id: 'S1', name: '陈国强', highRiskQualified: true, shifts: [
          { id: 'H1', date: '2026-09-25', start: '08:00', end: '12:00' },
          { id: 'H2', date: '2026-09-25', start: '13:00', end: '17:00' },
          { id: 'H3', date: '2026-09-26', start: '08:00', end: '12:00' } ] },
        { id: 'S2', name: '林秀英', highRiskQualified: true, shifts: [
          { id: 'H4', date: '2026-09-25', start: '08:00', end: '12:00' },
          { id: 'H5', date: '2026-09-25', start: '13:00', end: '17:00' } ] },
        { id: 'S3', name: '张伟', highRiskQualified: false, shifts: [
          { id: 'H6', date: '2026-09-25', start: '08:00', end: '12:00' },
          { id: 'H7', date: '2026-09-25', start: '13:00', end: '17:00' } ] },
        { id: 'S4', name: '王芳', highRiskQualified: false, shifts: [
          { id: 'H8', date: '2026-09-25', start: '09:00', end: '12:00' },
          { id: 'H9', date: '2026-09-25', start: '13:00', end: '16:00' } ] },
        { id: 'S5', name: '刘志明', highRiskQualified: true, shifts: [
          { id: 'H10', date: '2026-09-26', start: '08:00', end: '12:00' },
          { id: 'H11', date: '2026-09-26', start: '13:00', end: '17:00' } ] },
      ],
      tasks: [
        { id: 'T1', caseId: 'C04', staffId: 'S3', shiftId: 'H6', date: '2026-09-25', start: '08:30', end: '10:00', region: '南屿镇',
          status: 'done', reviewRequired: false, reviewConfirmed: false, reviewBy: '', reviewedAt: null,
          onsiteAt: now - 3 * H, damageNote: '渔船搁浅，船体开裂，机舱进水', riskNote: '无次生风险', createdAt: now - 6 * H,
          history: [
            { ts: now - 6 * H, action: '派工', detail: '派给 张伟（2026-09-25 08:30–10:00）' },
            { ts: now - 3 * H, action: '到场', detail: '记录灾损与风险，查勘完成' } ] },
        { id: 'T2', caseId: 'C09', staffId: 'S1', shiftId: 'H1', date: '2026-09-25', start: '09:00', end: '10:30', region: '中洲镇',
          status: 'onsite', reviewRequired: true, reviewConfirmed: false, reviewBy: '', reviewedAt: null,
          onsiteAt: now - 2 * H, damageNote: '校舍屋顶整体掀翻，墙体渗水', riskNote: '残存屋架有坠落风险，现场已围挡', createdAt: now - 6 * H,
          history: [
            { ts: now - 6 * H, action: '派工', detail: '派给 陈国强（2026-09-25 09:00–10:30）' },
            { ts: now - 2 * H, action: '到场', detail: '记录灾损与风险（高风险，待复核）' } ] },
        { id: 'T3', caseId: 'C02', staffId: 'S4', shiftId: 'H8', date: '2026-09-25', start: '09:30', end: '11:00', region: '东涌镇',
          status: 'scheduled', reviewRequired: false, reviewConfirmed: false, reviewBy: '', reviewedAt: null,
          onsiteAt: null, damageNote: '', riskNote: '', createdAt: now - 5 * H,
          history: [ { ts: now - 5 * H, action: '派工', detail: '派给 王芳（2026-09-25 09:30–11:00）' } ] },
        { id: 'T4', caseId: 'C07', staffId: 'S3', shiftId: 'H7', date: '2026-09-25', start: '14:00', end: '15:30', region: '北岙镇',
          status: 'scheduled', reviewRequired: false, reviewConfirmed: false, reviewBy: '', reviewedAt: null,
          onsiteAt: null, damageNote: '', riskNote: '', createdAt: now - 5 * H,
          history: [ { ts: now - 5 * H, action: '派工', detail: '派给 张伟（2026-09-25 14:00–15:30）' } ] },
        { id: 'T5', caseId: 'C05', staffId: 'S4', shiftId: 'H9', date: '2026-09-25', start: '13:00', end: '14:30', region: '西港镇',
          status: 'cancelled', cancelledAt: now - 4 * H, reviewRequired: false, reviewConfirmed: false, reviewBy: '', reviewedAt: null,
          onsiteAt: null, damageNote: '', riskNote: '', createdAt: now - 7 * H,
          history: [
            { ts: now - 7 * H, action: '派工', detail: '派给 王芳（2026-09-25 13:00–14:30）' },
            { ts: now - 4 * H, action: '取消', detail: '报案人要求改期，班次已释放' } ] },
      ],
      audit: [
        { ts: now - 2 * H, type: '到场', detail: 'C09 已到场（高风险，待复核）' },
        { ts: now - 2 * H - 60000, type: '预付', detail: 'C04 办理预付' },
        { ts: now - 3 * H, type: '到场', detail: 'C04 已到场，查勘完成' },
        { ts: now - 4 * H, type: '取消', detail: 'C05 任务取消，班次已释放：报案人要求改期' },
        { ts: now - 5 * H, type: '派工', detail: 'C02 → 王芳（2026-09-25 09:30–11:00）' },
        { ts: now - 5 * H - 60000, type: '派工', detail: 'C07 → 张伟（2026-09-25 14:00–15:30）' },
        { ts: now - 6 * H, type: '派工', detail: 'C04 → 张伟（2026-09-25 08:30–10:00）' },
        { ts: now - 6 * H - 60000, type: '派工', detail: 'C09 → 陈国强（2026-09-25 09:00–10:30）' },
        { ts: now - 7 * H, type: '派工', detail: 'C05 → 王芳（2026-09-25 13:00–14:30）' },
        { ts: now - 20 * H, type: '登记案件', detail: '台风海鸥灾后报案集中导入 12 件' },
      ],
    };
  }

  /* ---------- 持久化 ---------- */
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s && Array.isArray(s.cases) && Array.isArray(s.tasks)) return s;
      }
    } catch (e) { /* 损坏则重建 */ }
    const s = seedState();
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 隐私模式等 */ }
    return s;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* 忽略 */ }
  }

  function nextId(prefix) {
    state.seq[prefix] = (state.seq[prefix] || 0) + 1;
    return prefix + String(state.seq[prefix]).padStart(2, '0');
  }

  function log(type, detail) {
    state.audit.unshift({ ts: Date.now(), type, detail });
    save();
  }

  const findCase = (id) => state.cases.find((c) => c.id === id);
  const findTask = (id) => state.tasks.find((t) => t.id === id);
  const findStaff = (id) => state.staff.find((p) => p.id === id);

  /* ---------- 登记 ---------- */
  function addCase({ event, region, title, loss, riskLevel }) {
    const id = nextId('C');
    state.cases.push({
      id, event, region, title,
      loss: Math.max(0, Number(loss) || 0),
      riskLevel: riskLevel === 'high' ? 'high' : 'normal',
      status: 'pending', pendingReason: '', prepayPaid: false, prepayAt: null, createdAt: Date.now(),
    });
    log('登记案件', `${id} ${event}·${region}·${title}，损失 ${loss} 元，${riskLevel === 'high' ? '高风险' : '一般'}`);
    return id;
  }

  function addStaff({ name, highRiskQualified }) {
    const id = nextId('S');
    state.staff.push({ id, name, highRiskQualified: !!highRiskQualified, shifts: [] });
    log('登记人员', `${name}（${highRiskQualified ? '高风险资质' : '一般资质'}）`);
    return id;
  }

  function addShift(staffId, { date, start, end }) {
    const p = findStaff(staffId);
    if (!p) return { ok: false, reason: '查勘员不存在' };
    if (!date || !start || !end) return { ok: false, reason: '请完整填写班次' };
    if (Scheduler.toMin(start) >= Scheduler.toMin(end)) return { ok: false, reason: '班次结束时间须晚于开始时间' };
    const clash = p.shifts.some((h) => h.date === date &&
      Scheduler.toMin(start) < Scheduler.toMin(h.end) && Scheduler.toMin(h.start) < Scheduler.toMin(end));
    if (clash) return { ok: false, reason: '班次与已有班次重叠' };
    const id = nextId('H');
    p.shifts.push({ id, date, start, end });
    p.shifts.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    log('登记班次', `${p.name} 增加班次 ${date} ${start}–${end}`);
    return { ok: true };
  }

  function removeShift(staffId, shiftId) {
    const p = findStaff(staffId);
    if (!p) return { ok: false, reason: '查勘员不存在' };
    const used = state.tasks.some((t) => t.shiftId === shiftId && Scheduler.ACTIVE.includes(t.status));
    if (used) return { ok: false, reason: '该班次存在进行中的任务，不能删除' };
    const i = p.shifts.findIndex((h) => h.id === shiftId);
    if (i === -1) return { ok: false, reason: '班次不存在' };
    const [h] = p.shifts.splice(i, 1);
    log('删除班次', `${p.name} 删除班次 ${h.date} ${h.start}–${h.end}`);
    return { ok: true };
  }

  /* ---------- 派工 / 改派 / 取消 ---------- */
  function setPendingReason(caseId, reason) {
    const kase = findCase(caseId);
    if (!kase) return;
    kase.status = 'pending';
    kase.pendingReason = reason;
    save();
  }

  function createTask({ caseId, staffId, shiftId, start, end }) {
    const kase = findCase(caseId);
    const staff = findStaff(staffId);
    const shift = staff && staff.shifts.find((h) => h.id === shiftId);
    const res = Scheduler.validateAssignment(state, { caseId, staffId, shiftId, start, end });
    if (!res.ok) {
      if (kase) { kase.status = 'pending'; kase.pendingReason = res.reasons.join('；'); }
      log('派工被拒', `${caseId} → ${staff ? staff.name : '?'}：${res.reasons.join('；')}`);
      return { ok: false, reasons: res.reasons };
    }
    const id = nextId('T');
    state.tasks.push({
      id, caseId, staffId, shiftId, date: shift.date, start, end, region: kase.region,
      status: 'scheduled', reviewRequired: kase.riskLevel === 'high',
      reviewConfirmed: false, reviewBy: '', reviewedAt: null,
      onsiteAt: null, damageNote: '', riskNote: '', createdAt: Date.now(),
      history: [{ ts: Date.now(), action: '派工', detail: `派给 ${staff.name}（${shift.date} ${start}–${end}）` }],
    });
    kase.status = 'assigned';
    kase.pendingReason = '';
    log('派工', `${caseId} → ${staff.name}（${shift.date} ${start}–${end}）`);
    return { ok: true, id };
  }

  function reassignTask(taskId, { staffId, shiftId, start, end }) {
    const t = findTask(taskId);
    if (!t || t.status !== 'scheduled') return { ok: false, reasons: ['仅"已派待到场"的任务可改派'] };
    const staff = findStaff(staffId);
    const shift = staff && staff.shifts.find((h) => h.id === shiftId);
    const res = Scheduler.validateAssignment(state, { caseId: t.caseId, staffId, shiftId, start, end, excludeTaskId: taskId });
    if (!res.ok) {
      log('改派被拒', `${t.caseId}：${res.reasons.join('；')}`);
      return { ok: false, reasons: res.reasons };
    }
    const oldStaff = findStaff(t.staffId);
    const from = `${oldStaff ? oldStaff.name : '?'}（${t.date} ${t.start}–${t.end}）`;
    const to = `${staff.name}（${shift.date} ${start}–${end}）`;
    t.history.push({ ts: Date.now(), action: '改派', detail: `${from} → ${to}，原班次已释放` });
    t.staffId = staffId;
    t.shiftId = shiftId;
    t.date = shift.date;
    t.start = start;
    t.end = end;
    log('改派', `${t.caseId}：${from} → ${to}`);
    return { ok: true };
  }

  function cancelTask(taskId, why) {
    const t = findTask(taskId);
    if (!t || !Scheduler.ACTIVE.includes(t.status)) return;
    const kase = findCase(t.caseId);
    t.status = 'cancelled';
    t.cancelledAt = Date.now();
    t.history.push({ ts: Date.now(), action: '取消', detail: `${why || '取消任务'}，班次已释放` });
    if (kase) {
      kase.status = 'pending';
      kase.pendingReason = '原任务已取消，班次已释放，待重新派工';
    }
    log('取消', `${t.caseId} 任务取消，班次已释放${why ? `：${why}` : ''}`);
  }

  /* ---------- 到场 / 复核 / 预付 ---------- */
  function onsiteTask(taskId, { damageNote, riskNote }) {
    const t = findTask(taskId);
    if (!t || t.status !== 'scheduled') return;
    const kase = findCase(t.caseId);
    t.onsiteAt = Date.now();
    t.damageNote = damageNote;
    t.riskNote = riskNote;
    if (t.reviewRequired) {
      t.status = 'onsite';
      if (kase) kase.status = 'review';
      t.history.push({ ts: Date.now(), action: '到场', detail: '记录灾损与风险（高风险，待复核）' });
      log('到场', `${t.caseId} 已到场（高风险，待复核）`);
    } else {
      t.status = 'done';
      if (kase) kase.status = 'done';
      t.history.push({ ts: Date.now(), action: '到场', detail: '记录灾损与风险，查勘完成' });
      log('到场', `${t.caseId} 已到场，查勘完成`);
    }
  }

  function reviewTask(taskId, reviewerId) {
    const t = findTask(taskId);
    const rv = findStaff(reviewerId);
    if (!t || !rv) return { ok: false, reason: '任务或复核人不存在' };
    if (!(t.reviewRequired && !t.reviewConfirmed && t.status === 'onsite')) return { ok: false, reason: '该任务不在待复核状态' };
    if (!rv.highRiskQualified) return { ok: false, reason: '复核人须具备高风险资质' };
    if (rv.id === t.staffId) return { ok: false, reason: '复核人不能是承办人本人' };
    t.reviewConfirmed = true;
    t.reviewBy = rv.name;
    t.reviewedAt = Date.now();
    t.status = 'done';
    const kase = findCase(t.caseId);
    if (kase) kase.status = 'done';
    t.history.push({ ts: Date.now(), action: '复核确认', detail: `复核人 ${rv.name}，预付恢复` });
    log('复核确认', `${t.caseId} 由 ${rv.name} 复核确认，预付恢复`);
    return { ok: true };
  }

  function prepay(caseId) {
    const kase = findCase(caseId);
    if (!kase || kase.prepayPaid) return { ok: false, reason: '案件不存在或已预付' };
    const t = state.tasks.find((x) => x.caseId === caseId && Scheduler.OCCUPIED.includes(x.status));
    if (!t || !t.onsiteAt) return { ok: false, reason: '到场登记后才能办理预付' };
    if (kase.riskLevel === 'high' && !t.reviewConfirmed) return { ok: false, reason: '高风险案件复核确认前不能继续预付' };
    kase.prepayPaid = true;
    kase.prepayAt = Date.now();
    log('预付', `${caseId} 办理预付`);
    return { ok: true };
  }

  function reset() {
    state = seedState();
    save();
  }

  return {
    get: () => state,
    log, save, reset,
    addCase, addStaff, addShift, removeShift,
    setPendingReason, createTask, reassignTask, cancelTask,
    onsiteTask, reviewTask, prepay,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Store;
