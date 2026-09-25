/* ============================================================
 * scheduler.js —— 排程层（纯规则，无 DOM、无读写 localStorage）
 * 负责：案件排序、派工可行性校验（资质 / 班次 / 撞车 / 跨区90分钟）、
 *       复核人与预付门槛判定。所有方法均为纯函数，便于测试。
 * ============================================================ */
(function (global) {
  'use strict';

  var CROSS_REGION_GAP_MIN = 90;

  var RISK = {
    high: { label: '高风险', rank: 3 },
    mid: { label: '中风险', rank: 2 },
    low: { label: '低风险', rank: 1 }
  };

  var CASE_STATUS = {
    pending: '待派',
    scheduled: '已派工',
    surveyed: '已到场',
    reviewed: '已复核',
    paid: '已预付',
    cancelled: '已取消'
  };

  var TASK_STATUS = {
    scheduled: '待到场',
    surveyed: '已到场',
    reviewed: '已复核',
    paid: '已预付',
    reassigned: '已改派',
    cancelled: '已取消'
  };

  /* 仍占用人员时间的任务状态（已释放的改派/取消任务不参与撞车） */
  var ACTIVE_TASK_STATUS = ['scheduled', 'surveyed', 'reviewed', 'paid'];

  function toTs(s) {
    if (typeof s === 'number') return s;
    return new Date(String(s).replace(' ', 'T')).getTime();
  }

  function pad(n) { return n < 10 ? '0' + n : '' + n; }

  function fmt(tsOrStr, withDate) {
    var d = new Date(toTs(tsOrStr));
    var out = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    if (withDate === false) return out;
    return out + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function riskLabel(r) { return (RISK[r] || { label: r }).label; }

  function regionName(state, code) {
    var r = state.regions.filter(function (x) { return x.code === code; })[0];
    return r ? r.name : code;
  }

  function eventName(state, id) {
    var e = state.events.filter(function (x) { return x.id === id; })[0];
    return e ? e.name : id;
  }

  function staffById(state, id) {
    return state.staff.filter(function (s) { return s.id === id; })[0] || null;
  }

  function caseById(state, id) {
    return state.cases.filter(function (c) { return c.id === id; })[0] || null;
  }

  function tasksForCase(state, caseId) {
    return state.tasks
      .filter(function (t) { return t.caseId === caseId; })
      .sort(function (a, b) { return toTs(a.createdAt) - toTs(b.createdAt); });
  }

  /* 排序：事件发生时间倒序（最新灾害优先）→ 区域固定顺序升序 → 估损金额降序 */
  function sortedCases(state) {
    return state.cases.slice().sort(function (a, b) {
      if (a.eventId !== b.eventId) {
        var ea = state.events.filter(function (e) { return e.id === a.eventId; })[0];
        var eb = state.events.filter(function (e) { return e.id === b.eventId; })[0] || ea;
        return (eb ? eb.from : '') < (ea ? ea.from : '') ? -1
          : (eb ? eb.from : '') > (ea ? ea.from : '') ? 1 : 0;
      }
      if (a.regionCode !== b.regionCode) return a.regionCode < b.regionCode ? -1 : 1;
      if (b.loss !== a.loss) return b.loss - a.loss;
      return a.no < b.no ? -1 : a.no > b.no ? 1 : 0;
    });
  }

  function pendingCases(state) {
    return sortedCases(state).filter(function (c) { return c.status === 'pending'; });
  }

  function shiftCovering(state, staffId, start, end) {
    var s = toTs(start), e = toTs(end);
    return state.shifts.filter(function (sh) {
      return sh.staffId === staffId && toTs(sh.start) <= s && e <= toTs(sh.end);
    })[0] || null;
  }

  function activeTasksForStaff(state, staffId, ignoreTaskId) {
    return state.tasks.filter(function (t) {
      return t.staffId === staffId &&
        ACTIVE_TASK_STATUS.indexOf(t.status) >= 0 &&
        t.id !== ignoreTaskId;
    });
  }

  function overlap(t1s, t1e, t2s, t2e) {
    return t1s < t2e && t1e > t2s;
  }

  /*
   * 派工可行性校验。
   * draft: { caseId, staffId, start, end } （时间均为 'YYYY-MM-DD HH:mm'）
   * 返回 { ok:true } 或 { ok:false, reasons:[...] }
   */
  function validateAssignment(state, draft) {
    var reasons = [];
    var c = caseById(state, draft.caseId);
    var s = staffById(state, draft.staffId);
    var start = toTs(draft.start), end = toTs(draft.end);

    if (!c) {
      reasons.push('案件不存在');
      return { ok: false, reasons: reasons };
    }
    if (c.status !== 'pending') {
      reasons.push('案件当前为「' + CASE_STATUS[c.status] + '」，不是待派状态');
    }
    if (!s) {
      reasons.push('请选择查勘人员');
    }
    if (isNaN(start) || isNaN(end) || !(start < end)) {
      reasons.push('到场时段无效：开始时间必须早于结束时间');
    }
    if (reasons.length) return { ok: false, reasons: reasons };

    // 1) 高风险资质
    if (c.risk === 'high' && !s.highRisk) {
      reasons.push('资质不符：该案为高风险现场，' + s.name + ' 未取得高风险查勘资质');
    }

    // 2) 班次覆盖
    var shift = shiftCovering(state, s.id, start, end);
    if (!shift) {
      var sameDay = state.shifts.filter(function (sh) {
        return sh.staffId === s.id && fmt(sh.start, false) === fmt(start, false);
      })[0];
      if (sameDay) {
        reasons.push('不在 ' + s.name + ' 的登记班次内：当日班次 ' +
          fmt(sameDay.start) + '–' + fmt(sameDay.end).slice(11) +
          '，拟派时段超出班次范围');
      } else {
        reasons.push('不在 ' + s.name + ' 的登记班次内：' + fmt(start, false) + ' 该日无登记班次');
      }
    }

    // 3) 与该人员在办任务核对：撞车 / 跨区赶场不足90分钟
    activeTasksForStaff(state, s.id).forEach(function (t) {
      var other = caseById(state, t.caseId);
      var ts = toTs(t.start), te = toTs(t.end);

      if (overlap(start, end, ts, te)) {
        reasons.push('任务撞车：' + fmt(t.start) + '–' + fmt(t.end).slice(11) +
          ' 已承担 ' + other.no + '（' + regionName(state, other.regionCode) + '）任务 ' + t.id);
        return;
      }

      var cross = other.regionCode !== c.regionCode;
      if (cross) {
        var gap = start >= te ? start - te : ts - end; // 两端任务的间隔毫秒
        var gapMin = Math.round(gap / 60000);
        if (gapMin < CROSS_REGION_GAP_MIN) {
          reasons.push('跨区赶场仅 ' + gapMin + ' 分钟（' +
            regionName(state, other.regionCode) + ' → ' + regionName(state, c.regionCode) +
            '，任务 ' + t.id + ' ' + fmt(t.start) + '–' + fmt(t.end).slice(11) +
            '），不足 ' + CROSS_REGION_GAP_MIN + ' 分钟');
        }
      }
    });

    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* 高风险复核人：须高风险资质，且不得与到场查勘员为同一人 */
  function validateReviewer(state, task, reviewerId) {
    var reasons = [];
    var reviewer = staffById(state, reviewerId);
    var c = caseById(state, task.caseId);
    if (!reviewer) reasons.push('请选择复核人');
    if (reviewer && !reviewer.highRisk && c.risk === 'high') {
      reasons.push('高风险案件复核人须具备高风险资质');
    }
    if (reviewer && reviewer.id === task.staffId) {
      reasons.push('查勘与复核不得为同一人（岗位回避）');
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  /* 高风险案件复核确认前不能继续预付 */
  function canPrepay(state, task) {
    if (!task) return { ok: false, reason: '任务不存在' };
    var c = caseById(state, task.caseId);
    if (c.risk === 'high' && !(task.review && task.review.confirmed)) {
      return { ok: false, reason: '高风险案件未经复核确认，不能预付' };
    }
    if (task.status !== 'reviewed') return { ok: false, reason: '任务尚未完成复核' };
    return { ok: true, reason: null };
  }

  /* 班次当前占用情况（用于人员班次卡片显示与删除拦截） */
  function shiftOccupancy(state, shift) {
    return state.tasks.filter(function (t) {
      return t.staffId === shift.staffId &&
        ACTIVE_TASK_STATUS.indexOf(t.status) >= 0 &&
        toTs(t.start) >= toTs(shift.start) - 1 &&
        toTs(t.end) <= toTs(shift.end) + 1;
    });
  }

  global.Scheduler = {
    CROSS_REGION_GAP_MIN: CROSS_REGION_GAP_MIN,
    RISK: RISK,
    CASE_STATUS: CASE_STATUS,
    TASK_STATUS: TASK_STATUS,
    ACTIVE_TASK_STATUS: ACTIVE_TASK_STATUS,
    toTs: toTs,
    fmt: fmt,
    pad: pad,
    riskLabel: riskLabel,
    regionName: regionName,
    eventName: eventName,
    staffById: staffById,
    caseById: caseById,
    tasksForCase: tasksForCase,
    sortedCases: sortedCases,
    pendingCases: pendingCases,
    shiftCovering: shiftCovering,
    activeTasksForStaff: activeTasksForStaff,
    validateAssignment: validateAssignment,
    validateReviewer: validateReviewer,
    canPrepay: canPrepay,
    shiftOccupancy: shiftOccupancy
  };
})(window);
