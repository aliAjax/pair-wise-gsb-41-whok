/* 排程层：案件排序与派工/改派校验。纯函数，不碰页面、不碰存储。 */
const Scheduler = (() => {
  'use strict';

  const MIN_TRAVEL_MINUTES = 90;                 // 跨区赶场最少间隔（分钟）
  const ACTIVE = ['scheduled', 'onsite'];        // 进行中（未完结）的任务
  const OCCUPIED = ['scheduled', 'onsite', 'done']; // 仍占用班次时段的任务（取消才释放）

  const toMin = (hhmm) => {
    const [h, m] = String(hhmm || '').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };

  /* 案件排序：事件 → 区域 → 损失（高在前） */
  function sortCases(cases) {
    return [...cases].sort((a, b) =>
      a.event.localeCompare(b.event, 'zh-Hans-CN') ||
      a.region.localeCompare(b.region, 'zh-Hans-CN') ||
      b.loss - a.loss ||
      a.id.localeCompare(b.id)
    );
  }

  /*
   * 派工/改派校验。入参 { caseId, staffId, shiftId, start, end, excludeTaskId }
   * 返回 { ok, reasons[] }，reasons 即"留在待派区"的原因。
   */
  function validateAssignment(state, { caseId, staffId, shiftId, start, end, excludeTaskId }) {
    const reasons = [];
    const kase = state.cases.find((c) => c.id === caseId);
    const staff = state.staff.find((p) => p.id === staffId);
    if (!kase) reasons.push('案件不存在');
    if (!staff) reasons.push('查勘员不存在');
    if (!kase || !staff) return { ok: false, reasons };

    const shift = staff.shifts.find((h) => h.id === shiftId);
    if (!shift) {
      reasons.push('所选班次不存在');
    }
    if (!start || !end) {
      reasons.push('请填写起止时间');
    } else if (toMin(start) >= toMin(end)) {
      reasons.push('结束时间须晚于开始时间');
    } else if (shift && (toMin(start) < toMin(shift.start) || toMin(end) > toMin(shift.end))) {
      reasons.push(`超出班次时段（${shift.date} ${shift.start}–${shift.end}）`);
    }

    // 资质：高风险案件须由登记过高风险资质的查勘员承办
    if (kase.riskLevel === 'high' && !staff.highRiskQualified) {
      reasons.push(`资质不符：${caseId} 为高风险案件，${staff.name} 未登记高风险资质`);
    }

    // 撞车与跨区赶场：同一查勘员、同一班次日期、仍占时段的任务
    if (shift && start && end && toMin(start) < toMin(end)) {
      const ns = toMin(start);
      const ne = toMin(end);
      const sameDay = state.tasks.filter((t) =>
        t.staffId === staffId && t.date === shift.date && t.id !== excludeTaskId && OCCUPIED.includes(t.status)
      );
      for (const t of sameDay) {
        const ts = toMin(t.start);
        const te = toMin(t.end);
        if (ns < te && ts < ne) {
          reasons.push(`任务撞车：与 ${t.caseId}（${t.start}–${t.end} ${t.region}）时间重叠`);
          continue;
        }
        if (t.region !== kase.region) {
          const gap = ne <= ts ? ts - ne : ns - te;
          if (gap < MIN_TRAVEL_MINUTES) {
            reasons.push(`跨区赶场不足${MIN_TRAVEL_MINUTES}分钟：${t.region} ${t.start}–${t.end} 与本次（${kase.region}）仅间隔 ${gap} 分钟`);
          }
        }
      }
    }

    return { ok: reasons.length === 0, reasons };
  }

  return { MIN_TRAVEL_MINUTES, ACTIVE, OCCUPIED, toMin, sortCases, validateAssignment };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Scheduler;
