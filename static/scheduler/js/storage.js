/* ============================================================
 * storage.js —— 保存层
 * 只负责数据的读写与演示数据初始化，不包含任何排程/校验规则。
 * 数据存于 localStorage（命名空间 typhoon-survey-desk-v1）。
 * ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'typhoon-survey-desk-v1';
  var OPERATOR_KEY = 'typhoon-survey-desk-operator';

  var EVENTS = [
    { id: 'TY15', name: '2026年第15号台风', from: '2026-09-24' },
    { id: 'TY14', name: '2026年第14号台风', from: '2026-09-19' }
  ];

  var REGIONS = [
    { code: 'DONGQI', name: '东岐乡' },
    { code: 'BEILING', name: '北岭乡' },
    { code: 'LINHAI', name: '临海镇' },
    { code: 'NANTANG', name: '南塘镇' }
  ];

  function ts(s) { return new Date(s.replace(' ', 'T')).getTime(); }

  function seedState() {
    var cases = [
      { id: 'C260925-101', no: '260925-101', eventId: 'TY15', regionCode: 'LINHAI',
        title: '临港纺织厂仓库进水、成品布匹水淹', risk: 'high', loss: 1850000,
        status: 'pending', currentTaskId: null, rejectReasons: [], createdAt: '2026-09-25 07:40' },
      { id: 'C260925-102', no: '260925-102', eventId: 'TY15', regionCode: 'NANTANG',
        title: '南塘沿街12间商铺屋顶掀翻、卷帘门变形', risk: 'mid', loss: 620000,
        status: 'pending', currentTaskId: null, rejectReasons: [], createdAt: '2026-09-25 08:05' },
      { id: 'C260925-103', no: '260925-103', eventId: 'TY15', regionCode: 'LINHAI',
        title: '海塘外侧32亩养殖塘决口、增氧设备损毁', risk: 'high', loss: 1320000,
        status: 'pending', currentTaskId: null, rejectReasons: [], createdAt: '2026-09-25 08:20' },
      { id: 'C260925-104', no: '260925-104', eventId: 'TY14', regionCode: 'DONGQI',
        title: '东岐村两处老旧民房屋瓦脱落、偏房局部倒塌', risk: 'low', loss: 180000,
        status: 'pending', currentTaskId: null, rejectReasons: [], createdAt: '2026-09-25 09:10' },
      { id: 'C260925-105', no: '260925-105', eventId: 'TY15', regionCode: 'BEILING',
        title: '35kV变电站护坡滑塌，设备区积水', risk: 'high', loss: 980000,
        status: 'surveyed', currentTaskId: 'T20260925-001', rejectReasons: [],
        createdAt: '2026-09-25 06:55' },
      { id: 'C260925-106', no: '260925-106', eventId: 'TY15', regionCode: 'NANTANG',
        title: '南塘中心粮库3号仓雨损、包粮受潮', risk: 'mid', loss: 410000,
        status: 'cancelled', currentTaskId: null, rejectReasons: [],
        createdAt: '2026-09-25 07:15' }
    ];

    var staff = [
      { id: 'S01', name: '李建国', phone: '138-0001-1001', highRisk: true,
        homeRegionCode: 'LINHAI', title: '高级查勘员' },
      { id: 'S02', name: '王海燕', phone: '138-0001-1002', highRisk: true,
        homeRegionCode: 'NANTANG', title: '高级查勘员' },
      { id: 'S03', name: '赵承志', phone: '138-0001-1003', highRisk: false,
        homeRegionCode: 'DONGQI', title: '查勘员' },
      { id: 'S04', name: '陈晓雯', phone: '138-0001-1004', highRisk: false,
        homeRegionCode: 'LINHAI', title: '助理查勘员' },
      { id: 'S05', name: '周志刚', phone: '138-0001-1005', highRisk: true,
        homeRegionCode: 'BEILING', title: '高级查勘员' }
    ];

    var shifts = [
      { id: 'SH-01', staffId: 'S01', date: '2026-09-25', start: '2026-09-25 08:00', end: '2026-09-25 18:00' },
      { id: 'SH-02', staffId: 'S01', date: '2026-09-26', start: '2026-09-26 08:30', end: '2026-09-26 17:30' },
      { id: 'SH-03', staffId: 'S02', date: '2026-09-25', start: '2026-09-25 09:00', end: '2026-09-25 19:00' },
      { id: 'SH-04', staffId: 'S03', date: '2026-09-25', start: '2026-09-25 08:30', end: '2026-09-25 16:30' },
      { id: 'SH-05', staffId: 'S04', date: '2026-09-25', start: '2026-09-25 10:00', end: '2026-09-25 18:00' },
      { id: 'SH-06', staffId: 'S05', date: '2026-09-25', start: '2026-09-25 08:00', end: '2026-09-25 17:00' }
    ];

    var tasks = [
      { id: 'T20260925-000', caseId: 'C260925-106', staffId: 'S02',
        start: '2026-09-25 09:00', end: '2026-09-25 10:00',
        status: 'cancelled', createdAt: '2026-09-25 07:50',
        cancelledAt: '2026-09-25 08:10', cancelReason: '报案人来电称粮库已自行烘干处置，暂不申请查勘',
        survey: null, review: null, payment: null },
      { id: 'T20260925-001', caseId: 'C260925-105', staffId: 'S05',
        start: '2026-09-25 14:00', end: '2026-09-25 15:15',
        status: 'surveyed', createdAt: '2026-09-25 08:35',
        cancelledAt: null, cancelReason: null,
        survey: {
          arrivedAt: '2026-09-25 14:08',
          damageDesc: '变电站北侧护坡滑塌长约35米、高6米，泥石冲入设备区围墙，电缆沟积水约40厘米；主变未受损。',
          lossEstimate: 980000,
          risks: ['边坡后缘仍有2-5厘米张开裂缝，存在二次滑塌风险', '上游集雨面积大，气象预报今夜仍有阵雨', '设备区临时抽水中，电气安全距离不足'],
          recorderId: 'S05', recorderName: '周志刚'
        },
        review: null, payment: null }
    ];

    var logs = [
      { id: 'L-01', at: '2026-09-25 06:55', action: 'case_create', level: 'info',
        caseId: 'C260925-105', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：35kV变电站护坡滑塌（高风险），估损98万元' },
      { id: 'L-02', at: '2026-09-25 07:15', action: 'case_create', level: 'info',
        caseId: 'C260925-106', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：南塘中心粮库雨损（中风险），估损41万元' },
      { id: 'L-03', at: '2026-09-25 07:40', action: 'case_create', level: 'info',
        caseId: 'C260925-101', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：临港纺织厂仓库水淹（高风险），估损185万元' },
      { id: 'L-04', at: '2026-09-25 07:50', action: 'dispatch', level: 'good',
        caseId: 'C260925-106', taskId: 'T20260925-000', staffId: 'S02', operator: '调度-周敏',
        detail: '派工成功：王海燕，09-25 09:00–10:00，南塘镇' },
      { id: 'L-05', at: '2026-09-25 08:05', action: 'case_create', level: 'info',
        caseId: 'C260925-102', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：南塘沿街商铺屋顶掀翻（中风险），估损62万元' },
      { id: 'L-06', at: '2026-09-25 08:10', action: 'cancel', level: 'warn',
        caseId: 'C260925-106', taskId: 'T20260925-000', staffId: 'S02', operator: '调度-周敏',
        detail: '取消派工并释放王海燕 09:00–10:00 班次。原因：报案人称已自行处置，暂不申请查勘' },
      { id: 'L-07', at: '2026-09-25 08:20', action: 'case_create', level: 'info',
        caseId: 'C260925-103', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：养殖塘决口（高风险），估损132万元' },
      { id: 'L-08', at: '2026-09-25 08:35', action: 'dispatch', level: 'good',
        caseId: 'C260925-105', taskId: 'T20260925-001', staffId: 'S05', operator: '调度-周敏',
        detail: '派工成功：周志刚（高风险资质），09-25 14:00–15:15，北岭乡' },
      { id: 'L-09', at: '2026-09-25 09:10', action: 'case_create', level: 'info',
        caseId: 'C260925-104', taskId: null, staffId: null, operator: '受理台-林芳',
        detail: '登记报案：东岐乡村民住房受损（低风险），估损18万元' },
      { id: 'L-10', at: '2026-09-25 15:25', action: 'arrive', level: 'good',
        caseId: 'C260925-105', taskId: 'T20260925-001', staffId: 'S05', operator: '周志刚',
        detail: '到场记录：护坡滑塌35米，估损98万元；记录风险3项，等待高风险复核确认后方可预付' }
    ];

    return {
      events: EVENTS,
      regions: REGIONS,
      cases: cases,
      staff: staff,
      shifts: shifts,
      tasks: tasks,
      logs: logs,
      seq: { shift: 6, task: 1, log: 10, case: 106, staff: 5 }
    };
  }

  function load() {
    try {
      var raw = global.localStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.cases && parsed.staff) return parsed;
      }
    } catch (e) { /* 存储损坏时回退为演示数据 */ }
    var fresh = seedState();
    save(fresh);
    return fresh;
  }

  function save(state) {
    global.localStorage.setItem(KEY, JSON.stringify(state));
  }

  function reset() {
    var fresh = seedState();
    save(fresh);
    return fresh;
  }

  function getOperator() {
    return global.localStorage.getItem(OPERATOR_KEY) || '调度-周敏';
  }
  function setOperator(name) {
    global.localStorage.setItem(OPERATOR_KEY, name);
  }

  global.Store = {
    load: load,
    save: save,
    reset: reset,
    getOperator: getOperator,
    setOperator: setOperator,
    seedState: seedState,
    toTs: ts
  };
})(window);
