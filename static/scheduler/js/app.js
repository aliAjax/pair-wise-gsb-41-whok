/* ============================================================
 * app.js —— 页面层
 * 只负责渲染、弹窗与交互；数据持久化调 Store，排程规则调 Scheduler。
 * ============================================================ */
(function () {
  'use strict';

  var state = Store.load();
  var tab = 'board';
  var logFilter = { caseId: '', action: '' };
  var historyOpen = {};

  /* ---------------- 基础工具 ---------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (ch) {
      if (ch == null) return;
      node.appendChild(typeof ch === 'string' ? document.createTextNode(ch) : ch);
    });
    return node;
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }
  function money(n) {
    return '¥' + String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function riskBadge(r) {
    var cls = r === 'high' ? 'b-red' : r === 'mid' ? 'b-amber' : 'b-gray';
    return '<span class="badge ' + cls + '">' + Scheduler.riskLabel(r) + '</span>';
  }
  function caseStatusBadge(s) {
    var cls = { pending: 'b-blue', scheduled: 'b-amber', surveyed: 'b-amber',
      reviewed: 'b-green', paid: 'b-green', cancelled: 'b-gray' }[s] || 'b-gray';
    return '<span class="badge ' + cls + '">' + Scheduler.CASE_STATUS[s] + '</span>';
  }
  function taskStatusBadge(s) {
    var cls = { scheduled: 'b-blue', surveyed: 'b-amber', reviewed: 'b-green',
      paid: 'b-green', reassigned: 'b-gray', cancelled: 'b-gray' }[s] || 'b-gray';
    return '<span class="badge ' + cls + '">' + Scheduler.TASK_STATUS[s] + '</span>';
  }
  function operator() {
    var v = $('#operator').value.trim();
    return v || '当班调度';
  }
  function nowStr() {
    var d = new Date();
    return d.getFullYear() + '-' + Scheduler.pad(d.getMonth() + 1) + '-' + Scheduler.pad(d.getDate()) +
      ' ' + Scheduler.pad(d.getHours()) + ':' + Scheduler.pad(d.getMinutes());
  }
  function persist() { Store.save(state); }

  function addLog(action, level, caseId, taskId, staffId, detail) {
    state.seq.log = (state.seq.log || 0) + 1;
    state.logs.push({
      id: 'L-' + state.seq.log, at: nowStr(), action: action, level: level || 'info',
      caseId: caseId || null, taskId: taskId || null, staffId: staffId || null,
      operator: operator(), detail: detail
    });
  }

  /* ---------------- Toast / 弹窗 ---------------- */
  function toast(msg, kind) {
    var root = $('#toast-root');
    if (!root.children.length) root.appendChild(el('div', { class: 'toast' }));
    var box = $('.toast', root);
    var t = el('div', { class: 't ' + (kind || 'ok') }, [msg]);
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 3200);
  }

  function closeModal() { $('#modal-root').innerHTML = ''; }

  function openModal(title, bodyNode, opts) {
    opts = opts || {};
    var root = $('#modal-root');
    root.innerHTML = '';
    var mask = el('div', { class: 'modal-mask', onClick: function (e) {
      if (e.target === mask && opts.dismissOnMask !== false) closeModal();
    } });
    var modal = el('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    modal.appendChild(el('div', { class: 'modal-h' }, [
      el('h3', null, [title]),
      el('button', { class: 'x', type: 'button', onClick: closeModal }, ['×'])
    ]));
    modal.appendChild(el('div', { class: 'modal-b' }, [bodyNode]));
    if (opts.footer) modal.appendChild(el('div', { class: 'modal-f' }, opts.footer));
    mask.appendChild(modal);
    root.appendChild(mask);
    return modal;
  }

  function confirmDialog(title, text, onOk, okLabel, danger) {
    var body = el('div', null, [el('p', { style: 'margin:4px 0' }, [text])]);
    openModal(title, body, {
      footer: [
        el('button', { class: 'btn sec', type: 'button', onClick: closeModal }, ['取消']),
        el('button', {
          class: 'btn ' + (danger ? 'danger' : ''), type: 'button',
          onClick: function () { closeModal(); onOk(); }
        }, [okLabel || '确定'])
      ]
    });
  }

  /*
   * 通用表单弹窗
   * fields: [{name,label,type,required,options:[v,t,disabled],value,placeholder,full,step,min}]
   */
  function openFormModal(title, fields, onSubmit, opts) {
    opts = opts || {};
    var grid = el('div', { class: 'form-grid' });
    var controls = {};

    fields.forEach(function (f) {
      var box = el('div', { class: 'field' + (f.full ? ' full' : '') });
      box.appendChild(el('label', null, [f.label + (f.required ? ' *' : '')]));
      var ctl;
      if (f.type === 'textarea') {
        ctl = el('textarea', { name: f.name, placeholder: f.placeholder || '' });
        ctl.value = f.value || '';
      } else if (f.type === 'select') {
        ctl = el('select', { name: f.name });
        ctl.appendChild(el('option', { value: '' }, [f.placeholder || '请选择']));
        (f.options || []).forEach(function (o) {
          var attrs = { value: o[0] };
          if (o[2]) attrs.disabled = 'disabled';
          ctl.appendChild(el('option', attrs, [o[1]]));
        });
        ctl.value = f.value || '';
      } else {
        ctl = el('input', { type: f.type || 'text', name: f.name,
          placeholder: f.placeholder || '', step: f.step || null, min: f.min || null });
        ctl.value = f.value == null ? '' : f.value;
      }
      controls[f.name] = ctl;
      box.appendChild(ctl);
      grid.appendChild(box);
    });

    var errBox = el('div', { class: 'form-error', style: 'display:none' });
    var body = el('div', null, [errBox, grid]);

    function submit() {
      var data = {};
      var missing = [];
      fields.forEach(function (f) {
        var val = controls[f.name].value.trim();
        data[f.name] = val;
        if (f.required && !val) missing.push(f.label);
      });
      if (missing.length) {
        errBox.style.display = 'block';
        errBox.innerHTML = '<b>以下为必填项：</b><ul>' +
          missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>';
        return;
      }
      var result = onSubmit(data, controls, errBox);
      if (result !== false) closeModal();
    }

    var footerBtns = [el('button', { class: 'btn sec', type: 'button', onClick: closeModal }, ['取消'])];
    if (opts.extraFooter) footerBtns = footerBtns.concat(opts.extraFooter(controls));
    footerBtns.push(el('button', { class: 'btn', type: 'button', onClick: submit }, [opts.okLabel || '保存']));
    openModal(title, body, { footer: footerBtns, wide: opts.wide });
  }

  /* ---------------- KPI ---------------- */
  function renderKpi() {
    var pending = state.cases.filter(function (c) { return c.status === 'pending'; });
    var blocked = pending.filter(function (c) { return c.rejectReasons && c.rejectReasons.length; });
    var activeTasks = state.tasks.filter(function (t) {
      return Scheduler.ACTIVE_TASK_STATUS.indexOf(t.status) >= 0;
    });
    var awaitingReview = activeTasks.filter(function (t) { return t.status === 'surveyed'; });
    var paid = state.tasks.filter(function (t) { return t.status === 'paid'; }).length;
    var onDuty = {};
    state.shifts.forEach(function (s) { onDuty[s.staffId] = true; });

    var bar = $('#kpi');
    bar.innerHTML = '';
    [
      { n: pending.length, l: '待派案件', k: pending.length ? 'amber' : '' },
      { n: blocked.length, l: '留在待派区（校验未过）', k: blocked.length ? 'red' : '' },
      { n: activeTasks.length, l: '在途/进行中任务', k: '' },
      { n: awaitingReview.length, l: '等待复核（预付冻结）', k: awaitingReview.length ? 'red' : '' },
      { n: Object.keys(onDuty).length, l: '今日有班次人员', k: 'green' },
      { n: paid, l: '已预付任务', k: 'green' }
    ].forEach(function (x) {
      bar.appendChild(el('div', { class: 'kpi ' + x.k, html:
        '<div class="num">' + x.n + '</div><div class="lbl">' + x.l + '</div>' }));
    });
  }

  /* ---------------- 排程台：待派区 ---------------- */
  function renderPendingPanel() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-h' }, [
      el('h2', null, ['待派区']),
      el('span', { class: 'hint' }, ['排序：事件新→旧 · 区域固定顺序 · 损失高→低'])
    ]));
    var body = el('div', { class: 'panel-b' });

    var pending = Scheduler.pendingCases(state);
    if (!pending.length) {
      body.appendChild(el('div', { class: 'empty' }, ['全部案件均已派出 🎉']));
    } else {
      pending.forEach(function (c, i) {
        var ev = state.events.filter(function (e) { return e.id === c.eventId; })[0];
        var card = el('div', { class: 'case-card ' + c.risk });
        card.innerHTML =
          '<div class="cc-top"><span class="cc-no">#' + esc(c.no) + '</span>' + riskBadge(c.risk) + '</div>' +
          '<div class="cc-title">' + esc(c.title) + '</div>' +
          '<div class="cc-meta">' +
            '<span class="cc-sort">' + esc(ev ? ev.name : c.eventId) + '</span>' +
            '<span class="cc-sort">' + esc(Scheduler.regionName(state, c.regionCode)) + '</span>' +
            '<span class="cc-sort">估损 ' + money(c.loss) + '</span>' +
            '<span class="cc-sort">序位 ' + (i + 1) + '</span>' +
          '</div>';
        card.appendChild(el('div', { class: 'card-actions' }, [
          el('button', { class: 'btn sm', type: 'button', onClick: function () { openDispatchModal(c); } }, ['派工']),
          el('button', { class: 'btn sm sec', type: 'button', onClick: function () { openTraceModal(c.id); } }, ['轨迹'])
        ]));
        if (c.rejectReasons && c.rejectReasons.length) {
          var box = el('div', { class: 'reject-box', html:
            '<b>留在待派区原因（' + esc(c.rejectAt || '') + ' 校验未通过，班次未占用）：</b><ul>' +
            c.rejectReasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' });
          card.appendChild(box);
        }
        body.appendChild(card);
      });
    }
    panel.appendChild(body);
    return panel;
  }

  function taskActionButtons(t, c) {
    var btns = [];
    if (t.status === 'scheduled') {
      btns.push(el('button', { class: 'btn sm', type: 'button', onClick: function () { openArriveModal(t); } }, ['到场记录']));
      btns.push(el('button', { class: 'btn sm warn', type: 'button', onClick: function () { openReassignModal(t); } }, ['改派']));
      btns.push(el('button', { class: 'btn sm danger', type: 'button', onClick: function () { openCancelModal(t); } }, ['取消']));
    } else if (t.status === 'surveyed') {
      btns.push(el('button', { class: 'btn sm', type: 'button', onClick: function () { openReviewModal(t); } },
        [c.risk === 'high' ? '高风险复核确认' : '复核确认']));
      btns.push(el('button', { class: 'btn sm warn', type: 'button', onClick: function () { openReassignModal(t); } }, ['改派']));
      btns.push(el('button', { class: 'btn sm sec', disabled: 'disabled', title: '复核确认前不能预付' }, ['预付（冻结）']));
    } else if (t.status === 'reviewed') {
      btns.push(el('button', { class: 'btn sm', type: 'button', onClick: function () { openPayModal(t); } }, ['登记预付']));
    } else if (t.status === 'paid') {
      btns.push(el('span', { class: 'badge b-green' }, ['预付已到账，本任务完成']));
    }
    btns.push(el('button', { class: 'btn sm sec', type: 'button', onClick: function () { openTraceModal(c.id); } }, ['轨迹']));
    return btns;
  }

  function taskCard(t) {
    var c = Scheduler.caseById(state, t.caseId);
    var s = Scheduler.staffById(state, t.staffId);
    var card = el('div', { class: 'task' });
    var head = el('div', { class: 'task-h', html:
      '<span class="time">' + Scheduler.fmt(t.start) + '–' + Scheduler.fmt(t.end).slice(11) + '</span>' +
      taskStatusBadge(t.status) + (s.highRisk ? '<span class="badge b-red">高风险资质</span>' : '')
    });
    card.appendChild(head);

    var body = el('div', { class: 'task-b' });
    body.innerHTML =
      '<div class="row"><span>案件：</span>#' + esc(c.no) + ' ' + riskBadge(c.risk) + ' ' + esc(c.title) + '</div>' +
      '<div class="row"><span>区域：</span>' + esc(Scheduler.regionName(state, c.regionCode)) +
      '　<span>估损：</span>' + money(c.loss) + '</div>' +
      '<div class="row"><span>查勘员：</span>' + esc(s.name) + '（' + esc(s.title) + ' ' + esc(s.phone) + '）</div>';

    if (t.status === 'cancelled' || t.status === 'reassigned') {
      body.appendChild(el('div', { class: 'hold-note', html:
        (t.status === 'cancelled' ? '已取消，班次已释放。' : '已改派，班次已释放给新任务。') +
        (t.cancelReason ? '原因：' + esc(t.cancelReason) : '') }));
    }
    if (t.survey) {
      body.appendChild(el('div', { class: 'hold-note', style: 'background:#eef6ff;border-color:#bfd9f2;color:#24567f', html:
        '<b>到场记录（' + esc(t.survey.arrivedAt) + '）</b><br>' + esc(t.survey.damageDesc) +
        '<br>现场估损：' + money(t.survey.lossEstimate) +
        (t.survey.risks && t.survey.risks.length
          ? '<br>现场风险：' + t.survey.risks.map(esc).map(function (x) { return '· ' + x; }).join('　')
          : '') }));
    }
    if (t.review) {
      body.appendChild(el('div', { class: 'hold-note', style: 'background:#e7f4ed;border-color:#b7dcc7;color:#1d5e3b', html:
        '<b>复核' + (t.review.confirmed ? '确认' : '') + '</b>：复核人 ' +
        esc(Scheduler.staffById(state, t.review.reviewerId) ? Scheduler.staffById(state, t.review.reviewerId).name : t.review.reviewerId) +
        '（' + esc(t.review.reviewedAt) + '）' +
        (t.review.opinion ? '<br>意见：' + esc(t.review.opinion) : '') }));
    }
    if (t.payment) {
      body.appendChild(el('div', { class: 'hold-note', style: 'background:#e7f4ed;border-color:#b7dcc7;color:#1d5e3b', html:
        '<b>预付已登记</b>：' + money(t.payment.amount) +
        '（' + esc(t.payment.paidAt) + '）' + (t.payment.remark ? '　' + esc(t.payment.remark) : '') }));
    }
    if (t.status === 'surveyed' && c.risk === 'high') {
      body.appendChild(el('div', { class: 'gap-warn' }, ['⛔ 高风险案件：复核确认前不能继续预付']));
    }
    card.appendChild(body);

    var active = Scheduler.ACTIVE_TASK_STATUS.indexOf(t.status) >= 0;
    card.appendChild(el('div', { class: 'task-actions' },
      active ? taskActionButtons(t, c)
        : [el('button', { class: 'btn sm sec', type: 'button', onClick: function () { openTraceModal(c.id); } }, ['查看轨迹'])])
    );
    return card;
  }

  function renderBoardRight() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-h' }, [
      el('h2', null, ['任务排程（按人员班次时间）']),
      el('span', { class: 'legend' }, ['跨区任务自动核对 ≥ ' + Scheduler.CROSS_REGION_GAP_MIN + ' 分钟间隔'])
    ]));
    var body = el('div', { class: 'panel-b' });

    var active = state.tasks
      .filter(function (t) { return Scheduler.ACTIVE_TASK_STATUS.indexOf(t.status) >= 0; })
      .sort(function (a, b) { return Scheduler.toTs(a.start) - Scheduler.toTs(b.start); });

    var groups = {};
    active.forEach(function (t) {
      var d = Scheduler.fmt(t.start, false);
      (groups[d] = groups[d] || []).push(t);
    });
    Object.keys(groups).sort().forEach(function (d) {
      body.appendChild(el('div', { class: 'day-sep' }, [d + '（' + groups[d].length + ' 个在办任务）']));
      // 同一天按人员再分组显示，便于看同一查勘员的任务间隔
      var byStaff = {};
      groups[d].forEach(function (t) { (byStaff[t.staffId] = byStaff[t.staffId] || []).push(t); });
      Object.keys(byStaff).sort().forEach(function (sid) {
        var st = Scheduler.staffById(state, sid);
        body.appendChild(el('div', { class: 'muted', style: 'font-size:12px;margin:6px 0 2px' },
          ['▸ ' + st.name + (st.highRisk ? '（高风险资质）' : '')]));
        byStaff[sid].forEach(function (t) { body.appendChild(taskCard(t)); });
      });
    });
    if (!active.length) body.appendChild(el('div', { class: 'empty' }, ['暂无在办任务']));

    // 已释放（取消/改派）的历史任务，可折叠查看
    var released = state.tasks
      .filter(function (t) { return t.status === 'cancelled' || t.status === 'reassigned'; })
      .sort(function (a, b) { return Scheduler.toTs(b.start) - Scheduler.toTs(a.start); });
    if (released.length) {
      var key = 'released';
      var toggle = el('button', { class: 'history-toggle', type: 'button' },
        [(historyOpen[key] ? '▼' : '▶') + ' 已释放班次的历史任务（' + released.length + '，改派/取消后班次立即释放）']);
      toggle.addEventListener('click', function () {
        historyOpen[key] = !historyOpen[key]; render();
      });
      body.appendChild(toggle);
      if (historyOpen[key]) released.forEach(function (t) { body.appendChild(taskCard(t)); });
    }
    panel.appendChild(body);
    return panel;
  }

  function renderBoard() {
    var board = el('div', { class: 'board' });
    board.appendChild(renderPendingPanel());
    board.appendChild(renderBoardRight());
    return board;
  }

  /* ---------------- 派工弹窗 ---------------- */
  function defaultTaskWindow() {
    // 默认取演示当天 16:00–17:00，方便与既有班次/任务校验
    return { start: '2026-09-25 16:00', end: '2026-09-25 17:00' };
  }

  function dispatchFields(c, prefill) {
    var d = prefill || defaultTaskWindow();
    var options = state.staff.map(function (s) {
      var disabled = c.risk === 'high' && !s.highRisk;
      return [s.id, s.name + '（' + s.title + (s.highRisk ? '·高风险资质' : '·无高风险资质') + '）', disabled];
    });
    var def = prefill ? prefill.staffId
      : (state.staff.filter(function (s) { return !(c.risk === 'high' && !s.highRisk); })[0] || {}).id;
    return [
      { name: 'staffId', label: '查勘员', type: 'select', required: true, options: options,
        value: def || '', placeholder: c.risk === 'high' ? '仅高风险资质人员可选' : '请选择查勘员' },
      { name: 'start', label: '到场开始', type: 'datetime-local', required: true, value: d.start },
      { name: 'end', label: '到场结束', type: 'datetime-local', required: true, value: d.end }
    ];
  }

  function doDispatch(c, data, taskRef, suppressModal, keepActiveOnReject) {
    var draft = { caseId: c.id, staffId: data.staffId, start: data.start, end: data.end };
    var result = Scheduler.validateAssignment(state, draft);
    if (!result.ok) {
      if (keepActiveOnReject && c.currentTaskId) {
        // 改派失败：原任务仍然有效，保留现状（不释放旧班次），仅把原因写卡片
        c.rejectReasons = result.reasons;
        c.rejectAt = nowStr();
      } else {
        // 留在待派区并写明原因
        c.status = 'pending';
        c.currentTaskId = null;
        c.rejectReasons = result.reasons;
        c.rejectAt = nowStr();
      }
      addLog('dispatch_rejected', 'bad', c.id, null, data.staffId,
        (keepActiveOnReject ? '改派校验未通过，原任务保留、原班次不释放；新派工原因：\n'
          : '派工校验未通过，案件留在待派区：\n') +
        result.reasons.map(function (r) { return '· ' + r; }).join('\n'));
      persist(); render();
      if (suppressModal) toast('校验未通过，已按新派工留在待派区并写明原因', 'err');
      else toast('校验未通过，案件留在待派区并已写明原因', 'err');
      return false;
    }

    var s = Scheduler.staffById(state, data.staffId);
    state.seq.task = (state.seq.task || 0) + 1;
    var tid = 'T20260925-' + Scheduler.pad(state.seq.task);
    var t = {
      id: tid, caseId: c.id, staffId: s.id,
      start: data.start, end: data.end, status: 'scheduled', createdAt: nowStr(),
      cancelledAt: null, cancelReason: null, survey: null, review: null, payment: null
    };
    state.tasks.push(t);
    c.status = 'scheduled';
    c.currentTaskId = tid;
    c.rejectReasons = [];
    c.rejectAt = null;
    if (taskRef) taskRef.t = t;
    addLog('dispatch', 'good', c.id, tid, s.id,
      '派工成功：' + s.name + (s.highRisk ? '（高风险资质）' : '') +
      '，' + Scheduler.fmt(data.start) + '–' + Scheduler.fmt(data.end).slice(11) +
      '，' + Scheduler.regionName(state, c.regionCode));
    persist(); render();
    toast('派工成功，班次已占用：' + s.name);
    return true;
  }

  function openDispatchModal(c) {
    openFormModal('派工 · #' + c.no + '（' + Scheduler.riskLabel(c.risk) + '）',
      dispatchFields(c),
      function (data) { doDispatch(c, data); });
  }

  /* ---------------- 改派 / 取消（立即释放班次） ---------------- */
  function openReassignModal(t) {
    var c = Scheduler.caseById(state, t.caseId);
    var old = Scheduler.staffById(state, t.staffId);
    var ref = {};
    openFormModal('改派 · #' + c.no + '（原 ' + old.name + '）',
      dispatchFields(c, { staffId: t.staffId, start: t.start, end: t.end }),
      function (data) {
        var ok = doDispatch(c, data, ref, true, true);
        if (!ok) return false;
        var nt = ref.t;
        // 旧任务立即释放班次
        t.status = 'reassigned';
        t.cancelledAt = nowStr();
        t.cancelReason = '改派给 ' + Scheduler.staffById(state, nt.staffId).name + '（新任务 ' + nt.id + '）';
        addLog('reassign', 'warn', c.id, t.id, t.staffId,
          '改派：原查勘员 ' + old.name + ' 的任务 ' + t.id + ' 立即释放班次；' +
          '新任务 ' + nt.id + ' 派给 ' + Scheduler.staffById(state, nt.staffId).name);
        persist(); render();
        toast('已改派，原班次立即释放', 'info');
        return true;
      },
      { okLabel: '确认改派' });
  }

  function openCancelModal(t) {
    var c = Scheduler.caseById(state, t.caseId);
    openFormModal('取消任务 · ' + t.id, [
      { name: 'reason', label: '取消原因', type: 'textarea', required: true, full: true,
        placeholder: '如：报案人撤案 / 现场交通中断改约次日…' }
    ], function (data) {
      var s = Scheduler.staffById(state, t.staffId);
      t.status = 'cancelled';
      t.cancelledAt = nowStr();
      t.cancelReason = data.reason;
      c.status = 'cancelled';
      c.currentTaskId = null;
      addLog('cancel', 'warn', c.id, t.id, t.staffId,
        '取消派工并立即释放 ' + s.name + ' ' + Scheduler.fmt(t.start) + '–' +
        Scheduler.fmt(t.end).slice(11) + ' 班次。原因：' + data.reason +
        '；案件可在台账中「重开」，重开后仍可追溯本任务与全部变更');
      persist(); render();
      toast('任务已取消，班次立即释放', 'info');
    }, { okLabel: '确认取消' });
  }

  /* ---------------- 到场记录 ---------------- */
  function openArriveModal(t) {
    var c = Scheduler.caseById(state, t.caseId);
    var s = Scheduler.staffById(state, t.staffId);
    openFormModal('到场记录 · #' + c.no, [
      { name: 'arrivedAt', label: '到场时间', type: 'datetime-local', required: true, value: t.start },
      { name: 'damageDesc', label: '灾损情况', type: 'textarea', required: true, full: true,
        placeholder: '结构/设备/物资受损范围、数量、初步原因…' },
      { name: 'lossEstimate', label: '现场估损（元）', type: 'number', required: true,
        value: String(c.loss), step: '1000', min: '0' },
      { name: 'risks', label: '现场风险（每行一条）', type: 'textarea', full: true,
        placeholder: c.risk === 'high' ? '高风险现场必须记录风险，每行一条，如：边坡后缘有裂缝，存在二次滑塌风险' : '',
        value: '' }
    ], function (data) {
      var risks = data.risks.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      if (c.risk === 'high' && !risks.length) {
        toast('高风险现场必须记录至少一条现场风险', 'err');
        return false;
      }
      t.survey = {
        arrivedAt: Scheduler.fmt(data.arrivedAt),
        damageDesc: data.damageDesc,
        lossEstimate: Number(data.lossEstimate),
        risks: risks,
        recorderId: s.id, recorderName: s.name
      };
      t.status = 'surveyed';
      c.status = 'surveyed';
      c.loss = Number(data.lossEstimate);
      addLog('arrive', 'good', c.id, t.id, s.id,
        '到场记录：' + Scheduler.fmt(data.arrivedAt) + '，' + data.damageDesc +
        '；现场估损 ' + money(data.lossEstimate) +
        (risks.length ? '；风险' + risks.length + '项：' + risks.join(' / ') : '') +
        (c.risk === 'high' ? '；高风险案件，复核确认前冻结预付' : ''));
      persist(); render();
      toast('到场记录已保存' + (c.risk === 'high' ? '，预付冻结等待复核' : ''));
    }, { okLabel: '提交到场记录', wide: true });
  }

  /* ---------------- 复核与预付 ---------------- */
  function openReviewModal(t) {
    var c = Scheduler.caseById(state, t.caseId);
    if (!t.survey) { toast('任务缺少到场记录', 'err'); return; }
    var options = state.staff.map(function (s) {
      var disabled = (c.risk === 'high' && !s.highRisk) || s.id === t.staffId;
      return [s.id, s.name + '（' + s.title + (s.highRisk ? '·高风险资质' : '') +
        (s.id === t.staffId ? '·到场人需回避' : '') + '）', disabled];
    });
    openFormModal((c.risk === 'high' ? '高风险复核确认' : '复核确认') + ' · #' + c.no, [
      { name: 'reviewerId', label: '复核人', type: 'select', required: true, options: options,
        placeholder: c.risk === 'high' ? '须高风险资质，且与到场人不同' : '不得与到场人为同一人' },
      { name: 'opinion', label: '复核意见', type: 'textarea', required: true, full: true,
        placeholder: '灾损与估损是否属实、风险管控措施、是否同意预付…' }
    ], function (data) {
      var check = Scheduler.validateReviewer(state, t, data.reviewerId);
      if (!check.ok) { toast(check.reasons[0], 'err'); return false; }
      t.review = {
        reviewerId: data.reviewerId,
        reviewedAt: nowStr(),
        opinion: data.opinion,
        confirmed: true
      };
      t.status = 'reviewed';
      c.status = 'reviewed';
      var rv = Scheduler.staffById(state, data.reviewerId);
      addLog('review', 'good', c.id, t.id, data.reviewerId,
        (c.risk === 'high' ? '高风险复核确认' : '复核确认') + '：复核人 ' + rv.name +
        '，意见：' + data.opinion + '；预付解冻，可登记预付');
      persist(); render();
      toast('复核已确认，预付解冻');
    }, { okLabel: '确认复核' });
  }

  function openPayModal(t) {
    var c = Scheduler.caseById(state, t.caseId);
    var gate = Scheduler.canPrepay(state, t);
    if (!gate.ok) { toast(gate.reason, 'err'); return; }
    var cap = Math.round((t.survey ? t.survey.lossEstimate : c.loss) * 0.5);
    openFormModal('登记预付 · #' + c.no, [
      { name: 'amount', label: '预付金额（元）', type: 'number', required: true,
        value: String(cap), step: '1000', min: '1' },
      { name: 'remark', label: '备注', type: 'text', full: true, placeholder: '预付单号、收款账户等' }
    ], function (data) {
      if (Number(data.amount) <= 0) { toast('预付金额必须大于 0', 'err'); return false; }
      var stillOk = Scheduler.canPrepay(state, t); // 保存前再次校验门槛
      if (!stillOk) { toast(stillOk.reason, 'err'); return false; }
      t.payment = { amount: Number(data.amount), paidAt: nowStr(), remark: data.remark || '' };
      t.status = 'paid';
      c.status = 'paid';
      addLog('prepay', 'good', c.id, t.id, t.staffId,
        '登记预付 ' + money(data.amount) + (data.remark ? '，备注：' + data.remark : '') +
        '（已通过' + (c.risk === 'high' ? '高风险复核确认' : '复核') + '门槛）');
      persist(); render();
      toast('预付已登记');
    }, { okLabel: '确认预付' });
  }

  /* ---------------- 重开（仍可追溯） ---------------- */
  function openReopenModal(c) {
    confirmDialog('重开案件 · #' + c.no,
      '重开后案件回到待派区重新排工；原有任务、人员、到场/复核记录与全部变更日志都会保留，可继续追溯。确认重开？',
      function () {
        c.status = 'pending';
        c.currentTaskId = null;
        c.rejectReasons = [];
        c.rejectAt = null;
        addLog('reopen', 'warn', c.id, null, null,
          '案件重开，回到待派区。历史任务与变更记录全部保留，可在轨迹中追溯');
        persist(); render();
        toast('案件已重开，回到待派区', 'info');
      }, '确认重开');
  }

  /* ---------------- 案件台账 ---------------- */
  function renderCases() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-h' }, [
      el('h2', null, ['案件台账（' + state.cases.length + '）']),
      el('button', { class: 'btn sm', type: 'button', onClick: openNewCaseModal }, ['＋ 登记案件'])
    ]));
    var rows = Scheduler.sortedCases(state).map(function (c) {
      var t = c.currentTaskId ? state.tasks.filter(function (x) { return x.id === c.currentTaskId; })[0] : null;
      var s = t ? Scheduler.staffById(state, t.staffId) : null;
      return el('tr', null, [
        el('td', { html: '#' + esc(c.no) }),
        el('td', null, [Scheduler.eventName(state, c.eventId)]),
        el('td', null, [Scheduler.regionName(state, c.regionCode)]),
        el('td', null, [esc(c.title)]),
        el('td', { class: 'center', html: riskBadge(c.risk) }),
        el('td', { class: 'loss' }, [money(c.loss)]),
        el('td', { html: caseStatusBadge(c.status) }),
        el('td', null, [t ? esc(s.name) + '<br><span class="muted" style="font-size:12px">' +
          Scheduler.fmt(t.start) + '</span>' : '—']),
        el('td', null, [el('div', { class: 'row-actions' }, [
          c.status === 'pending'
            ? el('button', { class: 'btn sm', type: 'button', onClick: function () { openDispatchModal(c); } }, ['派工'])
            : null,
          (c.status === 'cancelled' || c.status === 'paid')
            ? el('button', { class: 'btn sm sec', type: 'button', onClick: function () { openReopenModal(c); } }, ['重开'])
            : null,
          el('button', { class: 'btn sm sec', type: 'button', onClick: function () { openTraceModal(c.id); } }, ['轨迹'])
        ])])
      ]);
    });
    panel.appendChild(el('div', { class: 'panel-b table-wrap' }, [
      el('table', null, [
        el('thead', { html: '<tr><th>案号</th><th>事件</th><th>区域</th><th>案情</th><th>风险</th>' +
          '<th class="right">估损</th><th>状态</th><th>当前查勘员</th><th>操作</th></tr>' }),
        el('tbody', null, rows)
      ])
    ]));
    return panel;
  }

  function openNewCaseModal() {
    openFormModal('登记案件', [
      { name: 'title', label: '案情摘要', type: 'text', required: true, full: true, placeholder: '如：村民住房受损、范围与受损标的…' },
      { name: 'eventId', label: '所属事件', type: 'select', required: true,
        options: state.events.map(function (e) { return [e.id, e.name + '（' + e.from + ' 起）']; }),
        value: state.events[0].id },
      { name: 'regionCode', label: '区域', type: 'select', required: true,
        options: state.regions.map(function (r) { return [r.code, r.name]; }),
        value: state.regions[0].code },
      { name: 'risk', label: '风险等级', type: 'select', required: true,
        options: [['high', '高风险（需高风险资质 + 复核确认后预付）'], ['mid', '中风险'], ['low', '低风险']],
        value: 'mid' },
      { name: 'loss', label: '估损金额（元）', type: 'number', required: true, value: '100000', step: '1000', min: '0' }
    ], function (data) {
      state.seq.case = (state.seq.case || 106) + 1;
      var no = '260925-' + state.seq.case;
      var id = 'C260925-' + state.seq.case;
      state.cases.push({
        id: id, no: no, eventId: data.eventId, regionCode: data.regionCode,
        title: data.title, risk: data.risk, loss: Number(data.loss),
        status: 'pending', currentTaskId: null, rejectReasons: [], createdAt: nowStr()
      });
      addLog('case_create', 'info', id, null, null,
        '登记报案：' + Scheduler.eventName(state, data.eventId) + ' · ' +
        Scheduler.regionName(state, data.regionCode) + '，' + Scheduler.riskLabel(data.risk) +
        '，估损 ' + money(data.loss) + '；' + data.title);
      persist(); render();
      toast('案件已登记，进入待派区');
    }, { okLabel: '登记并进入待派区', wide: true });
  }

  /* ---------------- 人员班次 ---------------- */
  function renderStaff() {
    var panel = el('div', { class: 'panel' });
    panel.appendChild(el('div', { class: 'panel-h' }, [
      el('h2', null, ['人员班次（' + state.staff.length + ' 人）']),
      el('div', null, [
        el('span', { class: 'legend', style: 'margin-right:10px' },
          ['班次必须登记后才能派工；取消/改派立即释放']),
        el('button', { class: 'btn sm', type: 'button', onClick: openNewStaffModal }, ['＋ 登记人员'])
      ])
    ]));
    var grid = el('div', { class: 'staff-grid panel-b' });
    state.staff.forEach(function (s) {
      var card = el('div', { class: 'staff-card' });
      card.appendChild(el('h3', { html: esc(s.name) +
        (s.highRisk ? '<span class="badge b-red">高风险资质</span>' : '<span class="badge b-gray">普通资质</span>') }));
      card.appendChild(el('div', { class: 'reg' },
        [s.id + ' · ' + s.title + ' · ' + s.phone + ' · 常驻地：' + Scheduler.regionName(state, s.homeRegionCode)]));

      var myShifts = state.shifts.filter(function (sh) { return sh.staffId === s.id; })
        .sort(function (a, b) { return Scheduler.toTs(a.start) - Scheduler.toTs(b.start); });
      if (!myShifts.length) card.appendChild(el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:6px' }, ['暂无班次']));
      myShifts.forEach(function (sh) {
        var occ = Scheduler.shiftOccupancy(state, sh);
        var row = el('div', { class: 'shift' + (occ.length ? ' busy' : '') });
        row.appendChild(el('span', null, [
          Scheduler.fmt(sh.start, false) + ' ' + Scheduler.fmt(sh.start).slice(11) + '–' +
          Scheduler.fmt(sh.end).slice(11),
          occ.length ? el('span', { class: 'badge b-red', style: 'margin-left:6px' },
            ['占用 ' + occ.length]) : el('span', { class: 'badge b-green', style: 'margin-left:6px' }, ['空闲'])
        ]));
        row.appendChild(el('button', { class: 'x', title: '删除班次', type: 'button', onClick: function () {
          if (occ.length) { toast('该班次有 ' + occ.length + ' 个在办任务占用，须先改派或取消任务', 'err'); return; }
          confirmDialog('删除班次', '删除 ' + s.name + ' ' + Scheduler.fmt(sh.start) + '–' +
            Scheduler.fmt(sh.end).slice(11) + ' 的班次登记？', function () {
              state.shifts = state.shifts.filter(function (x) { return x.id !== sh.id; });
              addLog('shift_delete', 'warn', null, null, s.id,
                '删除班次：' + Scheduler.fmt(sh.start) + '–' + Scheduler.fmt(sh.end).slice(11));
              persist(); render();
              toast('班次已删除', 'info');
            }, '删除', true);
        } }, ['×']));
        card.appendChild(row);
      });

      var add = el('div', { class: 'add-shift' });
      var dIn = el('input', { type: 'date', value: '2026-09-25', style: 'width:130px' });
      var sIn = el('input', { type: 'time', value: '13:00', style: 'width:82px' });
      var eIn = el('input', { type: 'time', value: '18:00', style: 'width:82px' });
      var addBtn = el('button', { class: 'btn sm sec', type: 'button' }, ['＋ 班次']);
      addBtn.addEventListener('click', function () {
        if (!dIn.value || !sIn.value || !eIn.value) { toast('请填写完整班次时间', 'err'); return; }
        var st = dIn.value + ' ' + sIn.value, en = dIn.value + ' ' + eIn.value;
        if (Scheduler.toTs(st) >= Scheduler.toTs(en)) { toast('班次开始必须早于结束', 'err'); return; }
        var dup = state.shifts.some(function (x) {
          return x.staffId === s.id && x.start === st && x.end === en;
        });
        if (dup) { toast('该班次已登记', 'err'); return; }
        state.seq.shift++;
        state.shifts.push({ id: 'SH-' + state.seq.shift, staffId: s.id,
          date: dIn.value, start: st, end: en });
        addLog('shift_add', 'info', null, null, s.id, '登记班次：' + Scheduler.fmt(st) + '–' + Scheduler.fmt(en).slice(11));
        persist(); render();
        toast('班次已登记');
      });
      add.appendChild(dIn); add.appendChild(sIn); add.appendChild(el('span', null, ['—']));
      add.appendChild(eIn); add.appendChild(addBtn);
      card.appendChild(add);
      grid.appendChild(card);
    });
    panel.appendChild(grid);
    return panel;
  }

  function openNewStaffModal() {
    openFormModal('登记人员', [
      { name: 'name', label: '姓名', type: 'text', required: true, placeholder: '姓名' },
      { name: 'title', label: '职务', type: 'text', value: '查勘员' },
      { name: 'phone', label: '联系电话', type: 'text', placeholder: '138-…' },
      { name: 'homeRegionCode', label: '常驻区域', type: 'select', required: true,
        options: state.regions.map(function (r) { return [r.code, r.name]; }),
        value: state.regions[0].code },
      { name: 'highRisk', label: '高风险资质', type: 'select', required: true,
        options: [['yes', '具备（可派高风险现场）'], ['no', '不具备（高风险现场派工将被拦截）']],
        value: 'no' }
    ], function (data) {
      state.seq.staff = (state.seq.staff || 5) + 1;
      var id = 'S' + Scheduler.pad(state.seq.staff);
      state.staff.push({
        id: id, name: data.name, phone: data.phone || '—', title: data.title || '查勘员',
        highRisk: data.highRisk === 'yes', homeRegionCode: data.homeRegionCode
      });
      addLog('staff_create', 'info', null, null, id,
        '登记人员：' + data.name + '（' + (data.title || '查勘员') +
        (data.highRisk === 'yes' ? '，高风险资质' : '，普通资质') + '），常驻 ' +
        Scheduler.regionName(state, data.homeRegionCode));
      persist(); render();
      toast('人员已登记，请继续登记班次');
    });
  }

  /* ---------------- 轨迹与日志 ---------------- */
  var ACTION_LABELS = {
    case_create: '登记案件', dispatch: '派工成功', dispatch_rejected: '派工校验未过',
    reassign: '改派', cancel: '取消任务', arrive: '到场记录', review: '复核确认',
    prepay: '登记预付', reopen: '重开案件', shift_add: '登记班次',
    shift_delete: '删除班次', staff_create: '登记人员'
  };

  function openTraceModal(caseId) {
    var c = Scheduler.caseById(state, caseId);
    var body = el('div');
    body.appendChild(el('div', { class: 'trace-sec', html:
      '<h4>案件信息</h4><dl class="kv">' +
      '<dt>案号</dt><dd>#' + esc(c.no) + '</dd>' +
      '<dt>事件</dt><dd>' + esc(Scheduler.eventName(state, c.eventId)) + '</dd>' +
      '<dt>区域</dt><dd>' + esc(Scheduler.regionName(state, c.regionCode)) + '</dd>' +
      '<dt>案情</dt><dd>' + esc(c.title) + '</dd>' +
      '<dt>风险</dt><dd>' + riskBadge(c.risk) + '</dd>' +
      '<dt>估损</dt><dd>' + money(c.loss) + '</dd>' +
      '<dt>状态</dt><dd>' + caseStatusBadge(c.status) + '</dd>' +
      '<dt>登记时间</dt><dd>' + esc(c.createdAt) + '</dd></dl>' }));

    var tasks = Scheduler.tasksForCase(state, c.id);
    var sec = el('div', { class: 'trace-sec' });
    sec.appendChild(el('h4', null, ['任务与人员（' + tasks.length + ' 个，含已取消/改派）']));
    if (!tasks.length) sec.appendChild(el('div', { class: 'muted', style: 'font-size:13px' }, ['暂无派工任务']));
    tasks.forEach(function (t) {
      var s = Scheduler.staffById(state, t.staffId);
      sec.appendChild(el('div', { class: 'shift', style: 'display:block;margin-bottom:8px' }, [
        el('div', { html: '<b>' + t.id + '</b> ' + taskStatusBadge(t.status) +
          '　' + Scheduler.fmt(t.start) + '–' + Scheduler.fmt(t.end).slice(11) +
          '　查勘员：' + esc(s.name) + (s.highRisk ? '（高风险资质）' : '') }),
        t.cancelReason ? el('div', { style: 'font-size:12.5px;margin-top:3px' }, ['释放原因：' + esc(t.cancelReason)]) : null,
        t.survey ? el('div', { style: 'font-size:12.5px;margin-top:3px' },
          ['到场：' + esc(t.survey.damageDesc) + '；估损 ' + money(t.survey.lossEstimate) +
           (t.survey.risks.length ? '；风险 ' + t.survey.risks.length + ' 项' : '')]) : null,
        t.review ? el('div', { style: 'font-size:12.5px;margin-top:3px' },
          ['复核：' + esc(Scheduler.staffById(state, t.review.reviewerId).name) + ' ' +
           esc(t.review.opinion)]) : null,
        t.payment ? el('div', { style: 'font-size:12.5px;margin-top:3px' },
          ['预付：' + money(t.payment.amount)]) : null
      ]));
    });
    body.appendChild(sec);

    var logSec = el('div', { class: 'trace-sec' });
    logSec.appendChild(el('h4', null, ['变更日志']));
    var list = el('div');
    state.logs.filter(function (l) { return l.caseId === c.id; })
      .sort(function (a, b) { return Scheduler.toTs(b.at) - Scheduler.toTs(a.at); })
      .forEach(function (l) {
        list.appendChild(el('div', { class: 'log-item ' + (l.level === 'bad' ? 'bad' : l.level === 'warn' ? 'warn' : 'good') }, [
          el('div', null, [
            el('span', { class: 'log-act' }, [ACTION_LABELS[l.action] || l.action]),
            el('span', { class: 'log-time', style: 'margin-left:8px' }, [l.at + ' · ' + l.operator])
          ]),
          el('div', { class: 'log-d' }, [l.detail])
        ]));
      });
    logSec.appendChild(list);
    body.appendChild(logSec);
    openModal('案件轨迹 · #' + c.no, body, { wide: true });
  }

  function renderLogs() {
    var panel = el('div', { class: 'panel' });
    var caseSel = el('select', null, [el('option', { value: '' }, ['全部案件'])]);
    state.cases.forEach(function (c) {
      caseSel.appendChild(el('option', { value: c.id }, ['#' + c.no]));
    });
    caseSel.value = logFilter.caseId;
    var actSel = el('select', null, [el('option', { value: '' }, ['全部操作'])]);
    Object.keys(ACTION_LABELS).forEach(function (a) {
      actSel.appendChild(el('option', { value: a }, [ACTION_LABELS[a]]));
    });
    actSel.value = logFilter.action;
    caseSel.addEventListener('change', function () { logFilter.caseId = caseSel.value; render(); });
    actSel.addEventListener('change', function () { logFilter.action = actSel.value; render(); });

    panel.appendChild(el('div', { class: 'panel-h' }, [
      el('h2', null, ['变更日志（不可删除，重开后仍可追溯）']),
      el('div', { class: 'log-filter' }, [caseSel, actSel])
    ]));
    var body = el('div', { class: 'panel-b' });
    var logs = state.logs
      .filter(function (l) { return !logFilter.caseId || l.caseId === logFilter.caseId; })
      .filter(function (l) { return !logFilter.action || l.action === logFilter.action; })
      .sort(function (a, b) { return Scheduler.toTs(b.at) - Scheduler.toTs(a.at); });
    if (!logs.length) body.appendChild(el('div', { class: 'empty' }, ['无匹配日志']));
    logs.forEach(function (l) {
      var c = l.caseId ? Scheduler.caseById(state, l.caseId) : null;
      var s = l.staffId ? Scheduler.staffById(state, l.staffId) : null;
      body.appendChild(el('div', { class: 'log-item ' + (l.level === 'bad' ? 'bad' : l.level === 'warn' ? 'warn' : l.level === 'good' ? 'good' : '') }, [
        el('div', null, [
          el('span', { class: 'log-act' }, [ACTION_LABELS[l.action] || l.action]),
          el('span', { class: 'log-time', style: 'margin-left:8px' }, [l.at + ' · ' + l.operator])
        ]),
        el('div', { class: 'log-d' }, [
          (c ? '案件 #' + c.no + '　' : '') + (s ? '人员：' + s.name + '　' : '') + (l.taskId ? '任务：' + l.taskId : ''),
          el('div', null, [l.detail])
        ])
      ]));
    });
    panel.appendChild(body);
    return panel;
  }

  /* ---------------- 总渲染 ---------------- */
  function render() {
    renderKpi();
    var view = $('#view');
    view.innerHTML = '';
    if (tab === 'board') view.appendChild(renderBoard());
    else if (tab === 'cases') view.appendChild(renderCases());
    else if (tab === 'staff') view.appendChild(renderStaff());
    else if (tab === 'logs') view.appendChild(renderLogs());
  }

  /* ---------------- 事件绑定 ---------------- */
  $('#tabs').addEventListener('click', function (e) {
    var btn = e.target.closest('.tab');
    if (!btn) return;
    tab = btn.dataset.tab;
    document.querySelectorAll('.tab').forEach(function (x) {
      x.classList.toggle('active', x === btn);
    });
    closeModal();
    render();
  });

  $('#operator').value = Store.getOperator();
  $('#operator').addEventListener('change', function () {
    Store.setOperator($('#operator').value.trim() || '当班调度');
  });

  $('#reset-demo').addEventListener('click', function () {
    confirmDialog('重置演示数据', '将清空全部本地登记与变更，恢复为初始演示数据。是否继续？',
      function () {
        state = Store.reset();
        logFilter = { caseId: '', action: '' };
        render();
        toast('已恢复演示数据', 'info');
      }, '重置', true);
  });

  render();
})();
