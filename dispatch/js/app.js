/* 页面层：渲染与交互。排程规则在 scheduler.js，数据与持久化在 store.js，本层不直接改数据。 */
(() => {
  'use strict';

  /* 瞬态界面状态（不持久化）：展开中的表单、待派区派工表单的暂存值、改派错误 */
  const ui = { onsiteFor: null, reassignFor: null, reviewFor: null, assignSel: {}, errors: {} };

  /* ---------- 小工具 ---------- */
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTs = (ts) => {
    const d = new Date(ts);
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  const fmtLoss = (n) => (n >= 10000 ? `${+(n / 10000).toFixed(2)}万` : `${n}元`);

  const RISK = { high: '高风险', normal: '一般' };
  const CASE_STATUS = { pending: '待派', assigned: '已派', review: '待复核', done: '已完成' };
  const TASK_STATUS = { scheduled: '已派待到场', onsite: '已到场·待复核', done: '已完成', cancelled: '已取消' };
  const AUDIT_CLASS = { '派工被拒': 'bad', '改派被拒': 'bad', '取消': 'muted', '改派': 'warn', '删除班次': 'warn' };

  const S = () => Store.get();
  const findCase = (id) => S().cases.find((c) => c.id === id);
  const findStaff = (id) => S().staff.find((p) => p.id === id);

  /* ---------- 汇总条 ---------- */
  function renderSummary() {
    const s = S();
    const n = (f) => s.cases.filter(f).length;
    const chips = [
      ['待派', n((c) => c.status === 'pending')],
      ['已派', n((c) => c.status === 'assigned')],
      ['待复核', n((c) => c.status === 'review')],
      ['已完成', n((c) => c.status === 'done')],
      ['进行中任务', s.tasks.filter((t) => Scheduler.ACTIVE.includes(t.status)).length],
      ['已取消任务', s.tasks.filter((t) => t.status === 'cancelled').length],
    ];
    document.getElementById('summary').innerHTML =
      chips.map(([k, v]) => `<span class="chip">${k} <b>${v}</b></span>`).join('');
  }

  /* ---------- 下拉选项 ---------- */
  function staffOptions(selected) {
    return ['<option value="">选择查勘员</option>'].concat(
      S().staff.map((p) =>
        `<option value="${p.id}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.highRiskQualified ? '（高风险资质）' : ''}</option>`)
    ).join('');
  }

  function shiftOptions(staffId, selected) {
    const p = findStaff(staffId);
    if (!p) return '<option value="">先选择查勘员</option>';
    if (!p.shifts.length) return '<option value="">该员暂无班次</option>';
    return ['<option value="">选择班次</option>'].concat(
      p.shifts.map((h) =>
        `<option value="${h.id}" data-start="${h.start}" data-end="${h.end}" ${h.id === selected ? 'selected' : ''}>${h.date} ${h.start}–${h.end}</option>`)
    ).join('');
  }

  /* ---------- 待派区 ---------- */
  function assignFormHTML(c) {
    const sel = ui.assignSel[c.id] || {};
    return `
      <form class="inline-form js-assign-form" data-case-id="${c.id}">
        <select name="staffId" class="js-assign-staff">${staffOptions(sel.staffId)}</select>
        <select name="shiftId" class="js-assign-shift">${shiftOptions(sel.staffId, sel.shiftId)}</select>
        <input type="time" name="start" value="${esc(sel.start || '')}" required>
        <input type="time" name="end" value="${esc(sel.end || '')}" required>
        <button class="btn primary" type="submit">派工</button>
      </form>`;
  }

  function renderPending() {
    const list = Scheduler.sortCases(S().cases.filter((c) => c.status === 'pending'));
    const el = document.getElementById('pending-list');
    if (!list.length) {
      el.innerHTML = '<p class="empty">待派区已清空。</p>';
      return;
    }
    el.innerHTML = list.map((c) => `
      <article class="card ${c.riskLevel === 'high' ? 'high' : ''}">
        <div class="card-head">
          <strong>${c.id} · ${esc(c.title)}</strong>
          <span class="badge ${c.riskLevel === 'high' ? 'danger' : 'muted'}">${RISK[c.riskLevel]}</span>
        </div>
        <div class="meta">${esc(c.event)} · ${esc(c.region)} · 损失 ${fmtLoss(c.loss)}</div>
        ${c.pendingReason ? `<div class="reason">留派原因：${esc(c.pendingReason)}</div>` : ''}
        ${assignFormHTML(c)}
      </article>`).join('');
  }

  /* ---------- 任务台 ---------- */
  function prepayHTML(t, kase) {
    if (!kase) return '';
    if (kase.prepayPaid) return `<div class="prepay paid">已预付 · ${fmtTs(kase.prepayAt)}</div>`;
    if (t.status === 'scheduled') return '<div class="prepay"><button class="btn" type="button" disabled>到场后办理预付</button></div>';
    if (t.reviewRequired && !t.reviewConfirmed) {
      return '<div class="prepay blocked">高风险案件复核确认前不能继续预付</div>';
    }
    if (t.status === 'done') {
      return `<div class="prepay"><button class="btn ok" type="button" data-action="prepay" data-id="${kase.id}">办理预付</button></div>`;
    }
    return '';
  }

  function reviewHTML(t) {
    if (ui.reviewFor !== t.id) {
      return `<div class="row"><button class="btn warn" type="button" data-action="toggle-review" data-id="${t.id}">复核确认</button></div>`;
    }
    const reviewers = S().staff.filter((p) => p.highRiskQualified && p.id !== t.staffId);
    const opts = reviewers.length
      ? reviewers.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')
      : '<option value="">暂无可用复核人</option>';
    return `
      <form class="inline-form js-review-form" data-task-id="${t.id}">
        <select name="reviewerId" ${reviewers.length ? '' : 'disabled'}>${opts}</select>
        <button class="btn primary" type="submit" ${reviewers.length ? '' : 'disabled'}>确认复核</button>
        <button class="btn ghost" type="button" data-action="toggle-review" data-id="${t.id}">收起</button>
        <span class="hint">复核人须具备高风险资质且非承办人</span>
      </form>`;
  }

  function onsiteFormHTML(t) {
    return `
      <form class="onsite-form js-onsite-form" data-task-id="${t.id}">
        <label>灾损记录<textarea name="damageNote" required placeholder="例：屋顶掀翻、墙体渗水、设备进水……"></textarea></label>
        <label>风险记录<textarea name="riskNote" required placeholder="例：残存屋架坠落风险、化学品泄漏风险……"></textarea></label>
        <div class="row">
          <button class="btn primary" type="submit">确认到场</button>
          <button class="btn ghost" type="button" data-action="toggle-onsite" data-id="${t.id}">收起</button>
        </div>
      </form>`;
  }

  function reassignFormHTML(t) {
    const err = ui.errors[t.id];
    return `
      <form class="inline-form js-reassign-form" data-task-id="${t.id}">
        <select name="staffId" class="js-re-staff">${staffOptions(t.staffId)}</select>
        <select name="shiftId" class="js-re-shift">${shiftOptions(t.staffId, t.shiftId)}</select>
        <input type="time" name="start" value="${t.start}" required>
        <input type="time" name="end" value="${t.end}" required>
        <button class="btn primary" type="submit">确认改派</button>
        <button class="btn ghost" type="button" data-action="toggle-reassign" data-id="${t.id}">收起</button>
        ${err ? `<div class="reason">改派被拒：${esc(err)}</div>` : ''}
      </form>`;
  }

  function taskCardHTML(t) {
    const kase = findCase(t.caseId);
    const p = findStaff(t.staffId);
    const cancelled = t.status === 'cancelled';
    const actions = [];
    if (t.status === 'scheduled') {
      actions.push(`<button class="btn ok" type="button" data-action="toggle-onsite" data-id="${t.id}">到场登记</button>`);
      actions.push(`<button class="btn" type="button" data-action="toggle-reassign" data-id="${t.id}">改派</button>`);
      actions.push(`<button class="btn danger" type="button" data-action="cancel-task" data-id="${t.id}">取消</button>`);
    } else if (t.status === 'onsite') {
      actions.push(`<button class="btn danger" type="button" data-action="cancel-task" data-id="${t.id}">取消</button>`);
    }
    return `
      <article class="card task ${cancelled ? 'cancelled' : ''} ${t.reviewRequired ? 'high' : ''}">
        <div class="card-head">
          <strong>${t.id} · ${t.caseId} ${esc(kase ? kase.title : '')}</strong>
          <span class="badge ${t.status}">${TASK_STATUS[t.status]}</span>
          ${t.reviewRequired ? '<span class="badge danger">高风险</span>' : ''}
        </div>
        <div class="meta">${esc(p ? p.name : '?')}${p && p.highRiskQualified ? '（高风险资质）' : ''} · ${t.date} ${t.start}–${t.end} · ${esc(t.region)}</div>
        ${t.onsiteAt ? `<dl class="notes"><dt>灾损</dt><dd>${esc(t.damageNote)}</dd><dt>风险</dt><dd>${esc(t.riskNote)}</dd></dl>` : ''}
        ${t.reviewRequired && !t.reviewConfirmed && t.status === 'onsite' ? reviewHTML(t) : ''}
        ${t.reviewConfirmed ? `<div class="reviewed">复核人：${esc(t.reviewBy)} · ${fmtTs(t.reviewedAt)}</div>` : ''}
        ${!cancelled ? prepayHTML(t, kase) : ''}
        ${ui.onsiteFor === t.id ? onsiteFormHTML(t) : ''}
        ${ui.reassignFor === t.id ? reassignFormHTML(t) : ''}
        ${actions.length ? `<div class="row actions">${actions.join('')}</div>` : ''}
        <details class="history">
          <summary>变更轨迹（${t.history.length}）</summary>
          <ul>${t.history.map((h) => `<li><time>${fmtTs(h.ts)}</time>${esc(h.action)}：${esc(h.detail)}</li>`).join('')}</ul>
        </details>
      </article>`;
  }

  function renderTasks() {
    const s = S();
    const active = s.tasks
      .filter((t) => t.status !== 'cancelled')
      .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
    const cancelled = s.tasks.filter((t) => t.status === 'cancelled');
    document.getElementById('task-list').innerHTML =
      active.concat(cancelled).map(taskCardHTML).join('') || '<p class="empty">暂无任务。</p>';
  }

  /* ---------- 人员与班次 ---------- */
  function renderStaff() {
    const s = S();
    document.getElementById('staff-list').innerHTML = s.staff.map((p) => {
      const tasks = s.tasks
        .filter((t) => t.staffId === p.id && Scheduler.ACTIVE.includes(t.status))
        .sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
      return `
        <article class="card">
          <div class="card-head">
            <strong>${esc(p.name)}</strong>
            <span class="badge ${p.highRiskQualified ? 'ok' : 'muted'}">${p.highRiskQualified ? '高风险资质' : '一般资质'}</span>
          </div>
          <div class="shifts">
            ${p.shifts.map((h) => `<span class="chip">${h.date} ${h.start}–${h.end}<button class="x" type="button" data-action="remove-shift" data-staff="${p.id}" data-id="${h.id}" title="删除班次">×</button></span>`).join('') || '<span class="hint">未登记班次</span>'}
          </div>
          ${tasks.length
            ? `<ul class="mini">${tasks.map((t) => `<li>${t.date} ${t.start}–${t.end} · ${t.caseId} · ${esc(t.region)}</li>`).join('')}</ul>`
            : '<div class="hint">暂无进行中任务</div>'}
        </article>`;
    }).join('');

    const sel = document.querySelector('#add-shift-form select[name="staffId"]');
    const v = sel.value;
    sel.innerHTML = staffOptions('');
    if (v) sel.value = v;
  }

  /* ---------- 变更记录 ---------- */
  function renderAudit() {
    const list = S().audit.slice(0, 100);
    document.getElementById('audit-list').innerHTML = list.map((a) => `
      <div class="audit-item">
        <time>${fmtTs(a.ts)}</time>
        <span class="badge ${AUDIT_CLASS[a.type] || 'info'}">${esc(a.type)}</span>
        <span>${esc(a.detail)}</span>
      </div>`).join('') || '<p class="empty">暂无变更。</p>';
  }

  function renderDatalists() {
    const s = S();
    const uniq = (arr) => [...new Set(arr)];
    document.getElementById('dl-events').innerHTML =
      uniq(s.cases.map((c) => c.event)).map((e) => `<option value="${esc(e)}">`).join('');
    document.getElementById('dl-regions').innerHTML =
      uniq(s.cases.map((c) => c.region)).map((e) => `<option value="${esc(e)}">`).join('');
  }

  /* 重渲染前暂存待派区各派工表单的当前选择，避免被清空 */
  function captureAssignForms() {
    document.querySelectorAll('.js-assign-form').forEach((f) => {
      ui.assignSel[f.dataset.caseId] = {
        staffId: f.staffId.value, shiftId: f.shiftId.value, start: f.start.value, end: f.end.value,
      };
    });
  }

  function renderAll() {
    captureAssignForms();
    renderSummary();
    renderPending();
    renderTasks();
    renderStaff();
    renderAudit();
    renderDatalists();
  }

  /* ---------- 事件：按钮 ---------- */
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const { action, id } = btn.dataset;

    if (action === 'toggle-onsite') {
      ui.onsiteFor = ui.onsiteFor === id ? null : id;
      ui.reassignFor = null;
      renderAll();
    } else if (action === 'toggle-reassign') {
      ui.reassignFor = ui.reassignFor === id ? null : id;
      ui.onsiteFor = null;
      delete ui.errors[id];
      renderAll();
    } else if (action === 'toggle-review') {
      ui.reviewFor = ui.reviewFor === id ? null : id;
      renderAll();
    } else if (action === 'cancel-task') {
      const why = prompt('取消原因（班次将立即释放）：', '报案人要求改期');
      if (why === null) return;
      Store.cancelTask(id, why.trim());
      renderAll();
    } else if (action === 'prepay') {
      const r = Store.prepay(id);
      if (!r.ok) alert(r.reason);
      renderAll();
    } else if (action === 'remove-shift') {
      const r = Store.removeShift(btn.dataset.staff, id);
      if (!r.ok) alert(r.reason);
      renderAll();
    }
  });

  /* ---------- 事件：联动下拉 ---------- */
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('.js-assign-staff')) {
      const form = t.closest('form');
      form.shiftId.innerHTML = shiftOptions(t.value, '');
      form.start.value = '';
      form.end.value = '';
    } else if (t.matches('.js-re-staff')) {
      const form = t.closest('form');
      form.shiftId.innerHTML = shiftOptions(t.value, '');
    } else if (t.matches('.js-assign-shift') || t.matches('.js-re-shift')) {
      const form = t.closest('form');
      const opt = t.selectedOptions[0];
      if (opt && opt.dataset.start) {
        form.start.value = opt.dataset.start;
        form.end.value = opt.dataset.end;
      }
    }
  });

  /* ---------- 事件：表单提交 ---------- */
  document.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;

    if (f.id === 'add-case-form') {
      const d = Object.fromEntries(new FormData(f));
      if (!d.event.trim() || !d.region.trim() || !d.title.trim()) return;
      Store.addCase({
        event: d.event.trim(), region: d.region.trim(), title: d.title.trim(),
        loss: +d.loss || 0, riskLevel: d.riskLevel,
      });
      f.reset();
      renderAll();
      return;
    }

    if (f.id === 'add-staff-form') {
      const d = Object.fromEntries(new FormData(f));
      if (!d.name || !d.name.trim()) return;
      Store.addStaff({ name: d.name.trim(), highRiskQualified: d.highRiskQualified === 'on' });
      f.reset();
      renderAll();
      return;
    }

    if (f.id === 'add-shift-form') {
      const d = Object.fromEntries(new FormData(f));
      const r = Store.addShift(d.staffId, { date: d.date, start: d.start, end: d.end });
      if (!r.ok) alert(r.reason);
      renderAll();
      return;
    }

    if (f.matches('.js-assign-form')) {
      const caseId = f.dataset.caseId;
      const staffId = f.staffId.value;
      const shiftId = f.shiftId.value;
      const start = f.start.value;
      const end = f.end.value;
      if (!staffId || !shiftId) {
        Store.setPendingReason(caseId, '请选择查勘员与班次');
      } else {
        const r = Store.createTask({ caseId, staffId, shiftId, start, end });
        if (r.ok) delete ui.assignSel[caseId];
      }
      renderAll();
      return;
    }

    if (f.matches('.js-onsite-form')) {
      const d = Object.fromEntries(new FormData(f));
      Store.onsiteTask(f.dataset.taskId, { damageNote: d.damageNote.trim(), riskNote: d.riskNote.trim() });
      ui.onsiteFor = null;
      renderAll();
      return;
    }

    if (f.matches('.js-review-form')) {
      const r = Store.reviewTask(f.dataset.taskId, f.reviewerId.value);
      if (!r.ok) alert(r.reason);
      ui.reviewFor = null;
      renderAll();
      return;
    }

    if (f.matches('.js-reassign-form')) {
      const taskId = f.dataset.taskId;
      const r = Store.reassignTask(taskId, {
        staffId: f.staffId.value, shiftId: f.shiftId.value, start: f.start.value, end: f.end.value,
      });
      if (r.ok) {
        delete ui.errors[taskId];
        ui.reassignFor = null;
      } else {
        ui.errors[taskId] = (r.reasons || ['改派失败']).join('；');
      }
      renderAll();
      return;
    }
  });

  document.getElementById('reset-btn').addEventListener('click', () => {
    if (confirm('将清空全部数据并恢复示例数据，确定？')) {
      Store.reset();
      renderAll();
    }
  });

  renderAll();
})();
