/* =====================================================================
   네다바웨이 운영 관제 센터  (프론트엔드 전용 · localStorage 기반)
   접수 → 수강생 데이터 → 세그먼트 → 출석 → 메시지/설문 을 한 화면에서.
   서버가 없으므로 데이터는 이 브라우저에만 저장됩니다.
   (구글폼 CSV 가져오기 / CSV 내보내기 / 대량발송 CSV 로 실제 도구와 연결)
   ===================================================================== */
(function () {
  'use strict';

  const KEY = 'nedabah_ops_v1';
  const STATUS = { applied: '신청', confirmed: '확정', waitlist: '대기', cancelled: '취소' };
  const ATT = { present: '출석', late: '지각', absent: '결석', excused: '공결' };
  const COURSE_COLORS = ['#6b4423', '#3f7d5a', '#a07d20', '#b4531f', '#4a6fa5', '#8a5a2b', '#7a5aa0', '#b23b3b'];
  const uid = (p) => p + Math.random().toString(36).slice(2, 8) + (state ? state.seq++ : 0);

  /* ---------- 상태 ---------- */
  let state = load();
  let recipients = [];      // 세그먼트 → 메시지로 넘어온 대상 studentId 목록
  let activeTab = 'dashboard';

  function blank() {
    return {
      meta: { version: 2, seq: 1 },
      settings: { orgName: '네다바웨이', surveyUrl: '', senderName: '네다바웨이 운영팀', pin: '', certThreshold: 80, repName: '' },
      courses: [],
      students: [],
      attendance: {},      // "courseId::date": { studentId: 'present'|... }
      templates: defaultTemplates(),
      donors: [],          // 후원자
      inquiries: [],       // 문의 인박스
      todos: [],           // 할일·리마인더
      ledger: []           // 수입·지출 장부(수강료 외 항목)
    };
  }
  function defaultTemplates() {
    return [
      { id: 'tpl_welcome', name: '접수 확정 안내', channel: 'sms', scene: 'welcome',
        body: '[{기관명}] {이름}님, 「{강좌목록}」 접수가 확정되었습니다. 곧 오픈채팅 링크와 준비물을 안내드릴게요. 반갑습니다!' },
      { id: 'tpl_info', name: '개강/준비 안내', channel: 'kakao', scene: 'info',
        body: '[{기관명}] 개강 안내 드립니다. 첫 회차는 {날짜}입니다. 오픈채팅에서 뵙겠습니다. 궁금한 점은 편하게 남겨 주세요.' },
      { id: 'tpl_reminder', name: '회차 리마인드', channel: 'sms', scene: 'reminder',
        body: '[{기관명}] {이름}님, 「{강좌명}」 {날짜} {회차} 진행됩니다. 잊지 말고 함께해요!' },
      { id: 'tpl_absent', name: '결석자 팔로업', channel: 'sms', scene: 'reminder',
        body: '[{기관명}] {이름}님, 지난 회차 함께하지 못해 아쉬웠어요. 자료를 보내드릴까요? 다음 회차에서 뵙겠습니다.' },
      { id: 'tpl_survey', name: '종료 후 설문 요청', channel: 'kakao', scene: 'survey',
        body: '[{기관명}] {이름}님, 「{강좌목록}」 수고 많으셨습니다. 더 좋은 강의를 위해 설문 부탁드려요 🙏\n{설문링크}' },
      { id: 'tpl_pay', name: '수강료 입금 안내', channel: 'sms', scene: 'info',
        body: '[{기관명}] {이름}님, 「{강좌목록}」 수강료 {미납액}원이 확인되지 않았습니다. 입금 부탁드립니다. 감사합니다.' },
      { id: 'tpl_thanks', name: '후원 감사', channel: 'kakao', scene: 'info',
        body: '[{기관명}] {이름}님, 소중한 후원에 진심으로 감사드립니다. 보내주신 마음이 공동체를 세우는 데 귀하게 쓰이겠습니다 🙏' }
    ];
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const d = JSON.parse(raw);
      d.meta = d.meta || { version: 2, seq: 1 };
      d.settings = Object.assign({ orgName: '네다바웨이', surveyUrl: '', senderName: '네다바웨이 운영팀', pin: '', certThreshold: 80, repName: '' }, d.settings || {});
      d.courses = d.courses || []; d.students = d.students || [];
      d.attendance = d.attendance || {}; d.templates = d.templates && d.templates.length ? d.templates : defaultTemplates();
      d.donors = d.donors || []; d.inquiries = d.inquiries || []; d.todos = d.todos || []; d.ledger = d.ledger || [];
      // v1 → v2 수강생 재무·동의 필드 backfill
      d.students.forEach(s => { if (s.feeAmount == null) s.feeAmount = 0; if (s.paidAmount == null) s.paidAmount = 0; if (!s.payStatus) s.payStatus = 'unpaid'; if (s.consent == null) s.consent = false; });
      return d;
    } catch (e) { return blank(); }
  }
  Object.defineProperty(state, 'seq', {
    get() { return this.meta.seq; }, set(v) { this.meta.seq = v; }, configurable: true
  });

  let saveTimer = null;
  function save() {
    localStorage.setItem(KEY, JSON.stringify(state));
    const h = document.getElementById('saveHint');
    h.textContent = '저장됨 · ' + new Date().toLocaleTimeString('ko-KR');
    h.classList.add('flash'); clearTimeout(saveTimer);
    saveTimer = setTimeout(() => h.classList.remove('flash'), 900);
  }

  /* ---------- 유틸 ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const courseById = (id) => state.courses.find(c => c.id === id);
  const studentById = (id) => state.students.find(s => s.id === id);
  const courseNames = (ids) => ids.map(id => (courseById(id) || {}).name).filter(Boolean);

  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => t.hidden = true, 2200);
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => toast('복사되었습니다')).catch(() => fallbackCopy(text));
    } else fallbackCopy(text);
  }
  function fallbackCopy(text) {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand('copy'); toast('복사되었습니다'); } catch (e) { toast('복사 실패'); }
    document.body.removeChild(ta);
  }
  function download(name, content, type) {
    const blob = new Blob(['﻿' + content], { type: (type || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- CSV ---------- */
  function toCSV(rows) {
    return rows.map(r => r.map(c => {
      c = c == null ? '' : String(c);
      return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c;
    }).join(',')).join('\r\n');
  }
  function parseCSV(text) {
    const rows = []; let row = [], cur = '', q = false;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else {
        if (ch === '"') q = true;
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
        else cur += ch;
      }
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.length && r.some(c => c.trim() !== ''));
  }

  /* ---------- 집계 헬퍼 ---------- */
  const activeStudents = () => state.students.filter(s => s.status !== 'cancelled');
  function courseCountDist() {
    const dist = {};
    activeStudents().forEach(s => { const n = s.courseIds.length; dist[n] = (dist[n] || 0) + 1; });
    return dist;
  }
  function enrollmentByCourse() {
    return state.courses.map(c => ({
      course: c,
      count: activeStudents().filter(s => s.courseIds.includes(c.id)).length
    }));
  }
  function absenceCount(studentId) {
    let n = 0;
    Object.values(state.attendance).forEach(rec => { if (rec[studentId] === 'absent') n++; });
    return n;
  }
  function studentAttStats(studentId) {
    let present = 0, total = 0;
    Object.entries(state.attendance).forEach(([k, rec]) => {
      const cid = k.split('::')[0];
      if (!(studentId in rec)) return;
      const st = studentById(studentId);
      if (st && !st.courseIds.includes(cid)) return;
      total++; if (rec[studentId] === 'present' || rec[studentId] === 'late') present++;
    });
    return { present, total, rate: total ? Math.round(present / total * 100) : null };
  }
  function overallAttRate() {
    let p = 0, t = 0;
    Object.values(state.attendance).forEach(rec => Object.values(rec).forEach(v => { t++; if (v === 'present' || v === 'late') p++; }));
    return t ? Math.round(p / t * 100) : null;
  }
  function upcomingSessions(limit) {
    const today = new Date().toISOString().slice(0, 10);
    const list = [];
    state.courses.forEach(c => (c.sessions || []).forEach(d => { if (d >= today) list.push({ course: c, date: d }); }));
    list.sort((a, b) => a.date.localeCompare(b.date));
    return limit ? list.slice(0, limit) : list;
  }

  /* ---------- 재무·후원·할일 집계 ---------- */
  const won = (n) => (Number(n) || 0).toLocaleString('ko-KR') + '원';
  const feeDue = (s) => Math.max(0, (Number(s.feeAmount) || 0) - (Number(s.paidAmount) || 0));
  function totalUnpaid() { return activeStudents().reduce((a, s) => a + (s.payStatus === 'exempt' ? 0 : feeDue(s)), 0); }
  function totalTuitionPaid() { return activeStudents().reduce((a, s) => a + (Number(s.paidAmount) || 0), 0); }
  function ledgerSum(type, monthPrefix) {
    return state.ledger.filter(e => e.type === type && (!monthPrefix || (e.date || '').startsWith(monthPrefix))).reduce((a, e) => a + (Number(e.amount) || 0), 0);
  }
  function donorMonthly() {
    // 정기 후원은 월 금액, 일시 후원은 이번 달분만
    const m = today().slice(0, 7);
    return state.donors.filter(d => d.status !== 'lapsed').reduce((a, d) => {
      if (d.type === 'regular') return a + (Number(d.amount) || 0);
      return a + ((d.date || '').startsWith(m) ? (Number(d.amount) || 0) : 0);
    }, 0);
  }
  function donorLapsedList() {
    // 정기 후원인데 최근 45일간 기록 없음 → 이탈 의심 (수동 status='lapsed'도 포함)
    return state.donors.filter(d => d.status === 'lapsed');
  }
  const openInquiries = () => state.inquiries.filter(q => q.status !== 'done');
  function openTodos() {
    return state.todos.filter(t => !t.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  }
  function certResult(studentId, courseId) {
    // 강좌 회차 중 출결 기록된 회차 기준 출석률
    const c = courseById(courseId); if (!c) return null;
    let present = 0, total = 0;
    (c.sessions || []).forEach(d => {
      const rec = state.attendance[courseId + '::' + d]; if (!rec || !(studentId in rec)) return;
      total++; if (rec[studentId] === 'present' || rec[studentId] === 'late' || rec[studentId] === 'excused') present++;
    });
    if (!total) return { rate: null, total: 0, pass: false };
    const rate = Math.round(present / total * 100);
    return { rate, total, present, pass: rate >= (state.settings.certThreshold || 80) };
  }

  /* ============================ 렌더링 ============================ */
  function render() {
    document.getElementById('orgName').textContent = state.settings.orgName || '네다바웨이';
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + activeTab);
    ({ dashboard: renderDashboard, students: renderStudents, courses: renderCourses,
       attendance: renderAttendance, certs: renderCerts, segments: renderSegments, messages: renderMessages,
       finance: renderFinance, donors: renderDonors, inbox: renderInbox, todos: renderTodos, data: renderData }[activeTab])();
  }
  function go(tab) { activeTab = tab; window.scrollTo(0, 0); render(); }

  /* ---------- 대시보드 ---------- */
  function renderDashboard() {
    const el = $('#view-dashboard');
    const s = state.students;
    const counts = { applied: 0, confirmed: 0, waitlist: 0, cancelled: 0 };
    s.forEach(x => counts[x.status]++);
    const dist = courseCountDist();
    const maxN = Math.max(6, ...Object.keys(dist).map(Number).filter(n => !isNaN(n)), 0);
    const distRows = [];
    for (let n = 1; n <= maxN; n++) {
      if (n > 6 && !dist[n]) continue;
      distRows.push({ label: n + '개 강좌 신청', v: dist[n] || 0 });
    }
    const total = activeStudents().length || 1;
    const enroll = enrollmentByCourse().sort((a, b) => b.count - a.count);
    const maxEnroll = Math.max(1, ...enroll.map(e => e.count));
    const up = upcomingSessions(5);
    const attRate = overallAttRate();

    el.innerHTML = `
      <div class="section-head"><h2>대시보드</h2><span class="desc">전체 운영 현황을 한 눈에</span></div>

      <div class="flow">
        ${flowStep(1, '접수·수강생', '신청자 등록/관리', 'students')}
        ${flowStep(2, '강좌·회차', '6개 강좌·일정 설정', 'courses')}
        ${flowStep(3, '출석부', '회차별 출결 체크', 'attendance')}
        ${flowStep(4, '세그먼트', '조건별 대상 추출', 'segments')}
        ${flowStep(5, '메시지·설문', '안내·설문 발송', 'messages')}
      </div>

      ${dashAlerts()}

      <div class="grid kpi" style="margin-bottom:14px">
        ${kpi('총 수강생', activeStudents().length, '취소 제외')}
        ${kpi('확정', counts.confirmed, STATUS.applied + ' ' + counts.applied)}
        ${kpi('개설 강좌', state.courses.length, '회차 ' + state.courses.reduce((a, c) => a + (c.sessions || []).length, 0) + '개')}
        ${kpi('평균 출석률', attRate == null ? '—' : attRate + '%', '전체 회차')}
        ${kpi('이번 달 수입', shortWon(monthIncome()), '수강료+후원+기타')}
        ${kpi('미수금', shortWon(totalUnpaid()), '수강료 미납')}
      </div>

      <div class="row">
        <div class="card pad" style="flex:1;min-width:300px">
          <h3 style="font-size:15px">신청 강좌 수 분포</h3>
          <p class="muted" style="font-size:12px;margin:0 0 12px">예: "1개만 신청" vs "3개 신청" — 몇 명인지 자동 집계</p>
          ${distRows.length ? distRows.map(r => bar(r.label, r.v, Math.max(1, ...distRows.map(x => x.v)))).join('') : '<p class="muted">데이터가 없습니다.</p>'}
        </div>
        <div class="card pad" style="flex:1;min-width:300px">
          <h3 style="font-size:15px">강좌별 신청 인원</h3>
          <p class="muted" style="font-size:12px;margin:0 0 12px">인기 강좌·미달 강좌 파악</p>
          ${enroll.length ? enroll.map(e => bar(e.course.name, e.count, maxEnroll, e.course.color, true)).join('') : '<p class="muted">강좌를 먼저 등록하세요.</p>'}
        </div>
      </div>

      <div class="row" style="margin-top:14px">
        <div class="card pad" style="flex:1;min-width:300px">
          <h3 style="font-size:15px">다가오는 회차</h3>
          ${up.length ? '<table><tbody>' + up.map(u => `<tr><td style="width:110px"><strong>${u.date}</strong></td><td><span class="course-dot" style="background:${u.course.color}"></span> ${esc(u.course.name)}</td><td class="muted" style="text-align:right">${daysFrom(u.date)}</td></tr>`).join('') + '</tbody></table>' : '<p class="muted">예정된 회차가 없습니다. 강좌·회차에서 일정을 추가하세요.</p>'}
        </div>
        <div class="card pad" style="flex:1;min-width:260px">
          <h3 style="font-size:15px">빠른 작업</h3>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            <button class="btn primary" data-act="add-student">＋ 수강생 추가</button>
            <button class="btn" data-go="finance">💰 미수금 확인·입금 안내</button>
            <button class="btn" data-go="messages">✉ 안내/설문 메시지 만들기</button>
            <button class="btn" data-go="inbox">📥 문의 확인</button>
            <button class="btn" data-go="data">⬆ 구글폼 CSV 가져오기</button>
          </div>
          ${state.students.length === 0 ? '<div class="hint" style="margin-top:12px">처음이신가요? <b>데이터 탭</b>에서 <b>샘플 불러오기</b>로 화면을 먼저 둘러보세요.</div>' : ''}
        </div>
      </div>`;

    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    el.querySelectorAll('[data-act="add-student"]').forEach(b => b.onclick = () => openStudentModal());
    el.querySelectorAll('.flow .step').forEach(b => b.onclick = () => go(b.dataset.tab));
  }
  const flowStep = (n, t, d, tab) => `<div class="step" data-tab="${tab}"><span class="n">${n}</span><div class="t">${t}</div><div class="d">${d}</div></div>`;
  const shortWon = (n) => { n = Number(n) || 0; return n >= 10000 ? (Math.round(n / 1000) / 10).toLocaleString('ko-KR').replace(/\.0$/, '') + '만' : n.toLocaleString('ko-KR'); };
  function monthIncome() { const m = today().slice(0, 7); return ledgerSum('income', m) + donorMonthly(); }
  function dashAlerts() {
    const items = [];
    const unpaid = activeStudents().filter(s => s.payStatus !== 'exempt' && feeDue(s) > 0).length;
    const inq = openInquiries().length;
    const dueToday = openTodos().filter(t => t.due && t.due <= today()).length;
    const noConsent = activeStudents().filter(s => !s.consent).length;
    if (unpaid) items.push(`<button class="btn sm" data-go="finance">💰 미납 ${unpaid}명</button>`);
    if (inq) items.push(`<button class="btn sm" data-go="inbox">📥 미응답 문의 ${inq}건</button>`);
    if (dueToday) items.push(`<button class="btn sm" data-go="todos">⏰ 오늘/기한초과 할일 ${dueToday}건</button>`);
    if (donorLapsedList().length) items.push(`<button class="btn sm" data-go="donors">💗 후원 중단 ${donorLapsedList().length}명</button>`);
    if (noConsent && activeStudents().length) items.push(`<button class="btn sm" data-go="students">⚠ 개인정보 미동의 ${noConsent}명</button>`);
    if (!items.length) return '';
    return `<div class="card pad" style="margin-bottom:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap"><strong style="font-size:13px">🔔 처리할 일</strong> ${items.join(' ')}</div>`;
  }
  const kpi = (label, num, sub) => `<div class="card kpi-card"><div class="label">${label}</div><div class="num">${num} <small>${sub || ''}</small></div></div>`;
  function bar(label, v, max, color, accent) {
    const pct = Math.round(v / (max || 1) * 100);
    return `<div class="bar-row"><div class="bl">${esc(label)}</div><div class="bar-track"><div class="bar-fill ${accent ? 'a' : ''}" style="width:${pct}%;${color ? 'background:' + color : ''}"></div></div><div class="bv">${v}명</div></div>`;
  }
  function daysFrom(d) {
    const diff = Math.round((new Date(d) - new Date(new Date().toISOString().slice(0, 10))) / 86400000);
    return diff === 0 ? '오늘' : diff > 0 ? 'D-' + diff : 'D+' + (-diff);
  }

  /* ---------- 접수·수강생 ---------- */
  let studentFilter = { q: '', status: '', courseId: '' };
  function renderStudents() {
    const el = $('#view-students');
    let list = state.students.slice();
    if (studentFilter.q) { const q = studentFilter.q.toLowerCase(); list = list.filter(s => (s.name + s.phone + s.email + (s.memo || '') + s.tags.join('')).toLowerCase().includes(q)); }
    if (studentFilter.status) list = list.filter(s => s.status === studentFilter.status);
    if (studentFilter.courseId) list = list.filter(s => s.courseIds.includes(studentFilter.courseId));

    el.innerHTML = `
      <div class="section-head">
        <h2>접수·수강생</h2><span class="desc">${state.students.length}명 등록됨</span>
        <div class="spacer"></div>
        <button class="btn" id="expStudents">CSV 내보내기</button>
        <button class="btn primary" id="addStudent">＋ 수강생 추가</button>
      </div>
      <div class="card pad" style="margin-bottom:14px">
        <div class="inline">
          <label class="field"><span>검색(이름·연락처·메모·태그)</span><input type="text" id="fq" value="${esc(studentFilter.q)}" placeholder="검색어"></label>
          <label class="field" style="max-width:150px"><span>상태</span><select id="fstatus">${optionList({ '': '전체', ...STATUS }, studentFilter.status)}</select></label>
          <label class="field" style="max-width:200px"><span>강좌</span><select id="fcourse"><option value="">전체</option>${state.courses.map(c => `<option value="${c.id}" ${studentFilter.courseId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <button class="btn ghost sm" id="fclear">필터 초기화</button>
        </div>
      </div>
      <div class="card table-wrap">
        <table>
          <thead><tr><th>이름</th><th>연락처</th><th>신청 강좌</th><th>상태</th><th>출석률</th><th>결석</th><th>메모</th><th></th></tr></thead>
          <tbody>
            ${list.length ? list.map(rowStudent).join('') : '<tr><td colspan="8" class="empty">해당하는 수강생이 없습니다.</td></tr>'}
          </tbody>
        </table>
      </div>`;

    $('#addStudent').onclick = () => openStudentModal();
    $('#expStudents').onclick = exportStudents;
    $('#fq').oninput = (e) => { studentFilter.q = e.target.value; debounceRender(); };
    $('#fstatus').onchange = (e) => { studentFilter.status = e.target.value; renderStudents(); };
    $('#fcourse').onchange = (e) => { studentFilter.courseId = e.target.value; renderStudents(); };
    $('#fclear').onclick = () => { studentFilter = { q: '', status: '', courseId: '' }; renderStudents(); };
    el.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openStudentModal(b.dataset.edit));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
      if (confirm('이 수강생을 삭제할까요?')) { state.students = state.students.filter(x => x.id !== b.dataset.del); save(); renderStudents(); }
    });
  }
  function rowStudent(s) {
    const st = studentAttStats(s.id);
    const chips = s.courseIds.map(id => { const c = courseById(id); return c ? `<span class="chip" style="border-color:${c.color}"><span class="course-dot" style="background:${c.color}"></span>${esc(c.name)}</span>` : ''; }).join(' ');
    return `<tr>
      <td><strong>${esc(s.name)}</strong>${s.tags.length ? '<br>' + s.tags.map(t => `<span class="badge">${esc(t)}</span>`).join(' ') : ''}</td>
      <td class="muted">${esc(s.phone || '')}${s.email ? '<br>' + esc(s.email) : ''}</td>
      <td class="wrap">${chips || '<span class="muted">—</span>'} <span class="badge">${s.courseIds.length}개</span></td>
      <td><span class="badge ${s.status}">${STATUS[s.status]}</span></td>
      <td>${st.rate == null ? '<span class="muted">—</span>' : st.rate + '%'}</td>
      <td>${absenceCount(s.id) ? '<span class="badge cancelled">' + absenceCount(s.id) + '회</span>' : '<span class="muted">0</span>'}</td>
      <td class="wrap muted">${esc(s.memo || '')}</td>
      <td style="text-align:right"><button class="icon-btn" data-edit="${s.id}">✎</button><button class="icon-btn" data-del="${s.id}">🗑</button></td>
    </tr>`;
  }
  function openStudentModal(id) {
    const s = id ? studentById(id) : { id: '', name: '', phone: '', email: '', kakao: '', memo: '', courseIds: [], status: 'applied', tags: [], feeAmount: 0, paidAmount: 0, payStatus: 'unpaid', consent: false };
    modal(id ? '수강생 수정' : '수강생 추가', `
      <label class="field"><span>이름 *</span><input type="text" id="m_name" value="${esc(s.name)}"></label>
      <div class="inline">
        <label class="field"><span>연락처(휴대폰)</span><input type="tel" id="m_phone" value="${esc(s.phone)}" placeholder="010-0000-0000"></label>
        <label class="field"><span>이메일</span><input type="email" id="m_email" value="${esc(s.email)}"></label>
      </div>
      <div class="inline">
        <label class="field"><span>카카오 ID/닉네임</span><input type="text" id="m_kakao" value="${esc(s.kakao || '')}"></label>
        <label class="field" style="max-width:150px"><span>상태</span><select id="m_status">${optionList(STATUS, s.status)}</select></label>
      </div>
      <label class="field"><span>신청 강좌 (복수 선택)</span></label>
      <div id="m_courses" style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        ${state.courses.length ? state.courses.map(c => `<label class="chip" style="cursor:pointer"><input type="checkbox" value="${c.id}" ${s.courseIds.includes(c.id) ? 'checked' : ''} style="width:auto;margin-right:4px"><span class="course-dot" style="background:${c.color}"></span>${esc(c.name)}</label>`).join('') : '<span class="muted">강좌를 먼저 등록하세요 (강좌·회차 탭)</span>'}
      </div>
      <div class="inline">
        <label class="field" style="max-width:150px"><span>수강료(원)</span><input type="number" id="m_fee" value="${esc(s.feeAmount || 0)}" min="0"></label>
        <label class="field" style="max-width:150px"><span>입금액(원)</span><input type="number" id="m_paid" value="${esc(s.paidAmount || 0)}" min="0"></label>
        <label class="field" style="max-width:140px"><span>입금상태</span><select id="m_pay">${optionList({ unpaid: '미납', partial: '부분납', paid: '완납', exempt: '면제' }, s.payStatus || 'unpaid')}</select></label>
      </div>
      <div class="inline">
        <label class="field"><span>태그(쉼표로 구분)</span><input type="text" id="m_tags" value="${esc(s.tags.join(', '))}" placeholder="예: VIP, 재수강"></label>
      </div>
      <label class="field"><span>메모</span><textarea id="m_memo">${esc(s.memo || '')}</textarea></label>
      <label class="chip" style="cursor:pointer;display:inline-flex"><input type="checkbox" id="m_consent" ${s.consent ? 'checked' : ''} style="width:auto;margin-right:6px">개인정보 수집·이용 동의함</label>
      <div class="modal-actions">
        <button class="btn ghost" data-close>취소</button>
        <button class="btn primary" id="m_save">저장</button>
      </div>`);
    $('#m_save').onclick = () => {
      const name = $('#m_name').value.trim();
      if (!name) { toast('이름을 입력하세요'); return; }
      const courseIds = Array.from($('#m_courses').querySelectorAll('input:checked')).map(i => i.value);
      const tags = $('#m_tags').value.split(',').map(t => t.trim()).filter(Boolean);
      const fee = +$('#m_fee').value || 0, paid = +$('#m_paid').value || 0;
      let payStatus = $('#m_pay').value;
      // 입금액과 상태 자동 정합(면제는 유지)
      if (payStatus !== 'exempt') payStatus = paid <= 0 ? 'unpaid' : paid >= fee && fee > 0 ? 'paid' : 'partial';
      const data = { name, phone: $('#m_phone').value.trim(), email: $('#m_email').value.trim(), kakao: $('#m_kakao').value.trim(), status: $('#m_status').value, courseIds, tags, memo: $('#m_memo').value.trim(), feeAmount: fee, paidAmount: paid, payStatus, consent: $('#m_consent').checked };
      if (id) { Object.assign(s, data); }
      else { state.students.push(Object.assign({ id: uid('st_'), appliedAt: new Date().toISOString() }, data)); }
      save(); closeModal(); renderStudents();
      toast(id ? '수정되었습니다' : '추가되었습니다');
    };
  }
  function exportStudents() {
    const PAY = { unpaid: '미납', partial: '부분납', paid: '완납', exempt: '면제' };
    const header = ['이름', '연락처', '이메일', '카카오', '상태', '신청강좌', '신청강좌수', '수강료', '입금액', '미납액', '입금상태', '개인정보동의', '태그', '결석수', '출석률', '메모', 'appliedAt'];
    const rows = state.students.map(s => [s.name, s.phone, s.email, s.kakao, STATUS[s.status], courseNames(s.courseIds).join(' / '), s.courseIds.length, s.feeAmount || 0, s.paidAmount || 0, feeDue(s), PAY[s.payStatus] || '', s.consent ? 'Y' : 'N', s.tags.join(' '), absenceCount(s.id), (studentAttStats(s.id).rate ?? ''), s.memo, s.appliedAt]);
    download('수강생_' + today() + '.csv', toCSV([header, ...rows]), 'text/csv');
    toast('CSV를 내보냈습니다');
  }

  /* ---------- 강좌·회차 ---------- */
  function renderCourses() {
    const el = $('#view-courses');
    el.innerHTML = `
      <div class="section-head"><h2>강좌·회차</h2><span class="desc">최대 강좌 수 제한 없음 · 6개 예시</span>
        <div class="spacer"></div><button class="btn primary" id="addCourse">＋ 강좌 추가</button></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${state.courses.length ? state.courses.map(courseCard).join('') : '<div class="card pad empty">등록된 강좌가 없습니다. 우측 상단 <b>＋ 강좌 추가</b>로 시작하세요.</div>'}
      </div>`;
    $('#addCourse').onclick = () => openCourseModal();
    el.querySelectorAll('[data-editc]').forEach(b => b.onclick = () => openCourseModal(b.dataset.editc));
    el.querySelectorAll('[data-delc]').forEach(b => b.onclick = () => {
      if (confirm('강좌를 삭제할까요? 수강생의 신청 정보와 출석 기록에서도 제거됩니다.')) {
        const cid = b.dataset.delc;
        state.courses = state.courses.filter(c => c.id !== cid);
        state.students.forEach(s => s.courseIds = s.courseIds.filter(x => x !== cid));
        Object.keys(state.attendance).forEach(k => { if (k.startsWith(cid + '::')) delete state.attendance[k]; });
        save(); renderCourses();
      }
    });
  }
  function courseCard(c) {
    const enrolled = activeStudents().filter(s => s.courseIds.includes(c.id)).length;
    const sessions = (c.sessions || []).slice().sort();
    return `<div class="card pad">
      <div style="display:flex;align-items:center;gap:8px">
        <span class="course-dot" style="background:${c.color};width:12px;height:12px"></span>
        <strong style="font-size:15px;flex:1">${esc(c.name)}</strong>
        <button class="icon-btn" data-editc="${c.id}">✎</button><button class="icon-btn" data-delc="${c.id}">🗑</button>
      </div>
      <div class="muted" style="font-size:12px;margin:6px 0">신청 ${enrolled}명 ${c.capacity ? '/ 정원 ' + c.capacity : ''} · 회차 ${sessions.length}개</div>
      ${c.memo ? '<div class="muted" style="font-size:12px;margin-bottom:6px">' + esc(c.memo) + '</div>' : ''}
      <div style="display:flex;flex-wrap:wrap;gap:5px">${sessions.length ? sessions.map(d => `<span class="chip">${d} ${daysFrom(d) === '오늘' ? '· 오늘' : ''}</span>`).join('') : '<span class="muted" style="font-size:12px">회차 미정</span>'}</div>
    </div>`;
  }
  function openCourseModal(id) {
    const c = id ? courseById(id) : { id: '', name: '', color: COURSE_COLORS[state.courses.length % COURSE_COLORS.length], capacity: '', memo: '', sessions: [] };
    modal(id ? '강좌 수정' : '강좌 추가', `
      <label class="field"><span>강좌명 *</span><input type="text" id="c_name" value="${esc(c.name)}" placeholder="예: 말씀묵상 1강"></label>
      <div class="inline">
        <label class="field" style="max-width:120px"><span>색상</span><select id="c_color">${COURSE_COLORS.map(col => `<option value="${col}" ${c.color === col ? 'selected' : ''} style="background:${col}">${col}</option>`).join('')}</select></label>
        <label class="field" style="max-width:120px"><span>정원(선택)</span><input type="number" id="c_cap" value="${esc(c.capacity)}" min="0"></label>
      </div>
      <label class="field"><span>회차 일정</span></label>
      <div class="inline" style="margin-bottom:8px"><input type="date" id="c_newdate"><button class="btn sm" id="c_adddate">회차 추가</button></div>
      <div id="c_sessions" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px"></div>
      <label class="field"><span>메모</span><textarea id="c_memo">${esc(c.memo || '')}</textarea></label>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="c_save">저장</button></div>`);
    let sessions = (c.sessions || []).slice();
    const drawSessions = () => {
      $('#c_sessions').innerHTML = sessions.sort().map(d => `<span class="chip">${d}<span class="x" data-rm="${d}">✕</span></span>`).join('') || '<span class="muted" style="font-size:12px">추가된 회차 없음</span>';
      $('#c_sessions').querySelectorAll('[data-rm]').forEach(x => x.onclick = () => { sessions = sessions.filter(d => d !== x.dataset.rm); drawSessions(); });
    };
    drawSessions();
    $('#c_adddate').onclick = () => { const d = $('#c_newdate').value; if (d && !sessions.includes(d)) { sessions.push(d); drawSessions(); } };
    $('#c_save').onclick = () => {
      const name = $('#c_name').value.trim(); if (!name) { toast('강좌명을 입력하세요'); return; }
      const data = { name, color: $('#c_color').value, capacity: $('#c_cap').value ? +$('#c_cap').value : '', memo: $('#c_memo').value.trim(), sessions };
      if (id) Object.assign(c, data); else state.courses.push(Object.assign({ id: uid('co_') }, data));
      save(); closeModal(); renderCourses(); toast('저장되었습니다');
    };
  }

  /* ---------- 출석부 ---------- */
  let attSel = { courseId: '', date: '' };
  function renderAttendance() {
    const el = $('#view-attendance');
    if (!state.courses.length) { el.innerHTML = headed('출석부') + '<div class="card pad empty">먼저 <b>강좌·회차</b>에서 강좌를 등록하세요.</div>'; return; }
    if (!attSel.courseId) attSel.courseId = state.courses[0].id;
    const course = courseById(attSel.courseId);
    const sessions = (course.sessions || []).slice().sort();
    if (!attSel.date) attSel.date = sessions[0] || '';
    const enrolled = state.students.filter(s => s.courseIds.includes(course.id) && s.status !== 'cancelled');
    const key = attSel.courseId + '::' + attSel.date;
    const rec = state.attendance[key] || {};

    el.innerHTML = `
      <div class="section-head"><h2>출석부</h2><span class="desc">회차별 출결 · 인쇄 가능</span>
        <div class="spacer"></div>
        <button class="btn" id="printAtt">🖨 인쇄</button>
        <button class="btn" id="expAtt">CSV 내보내기</button>
      </div>
      <div class="card pad no-print" style="margin-bottom:14px">
        <div class="inline">
          <label class="field"><span>강좌</span><select id="a_course">${state.courses.map(c => `<option value="${c.id}" ${c.id === attSel.courseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field" style="max-width:200px"><span>회차</span><select id="a_date">${sessions.length ? sessions.map(d => `<option value="${d}" ${d === attSel.date ? 'selected' : ''}>${d} (${daysFrom(d)})</option>`).join('') : '<option value="">회차 없음</option>'}</select></label>
          <button class="btn sm" id="a_allpresent">전원 출석</button>
        </div>
      </div>
      <div class="card pad" id="attSheet">
        <h3 style="font-size:15px"><span class="course-dot" style="background:${course.color}"></span> ${esc(course.name)} <span class="muted" style="font-weight:400">— ${attSel.date || '회차 미선택'}</span></h3>
        ${!attSel.date ? '<p class="muted">이 강좌에 회차가 없습니다. 강좌·회차에서 일정을 추가하세요.</p>' :
        !enrolled.length ? '<p class="muted">이 강좌를 신청한 수강생이 없습니다.</p>' :
        `<div class="table-wrap"><table><thead><tr><th>이름</th><th>연락처</th><th class="no-print">출결</th><th class="no-print">누적 출석률</th></tr></thead><tbody>
          ${enrolled.map(s => attRow(s, rec)).join('')}
        </tbody></table></div>
        <div class="muted no-print" style="margin-top:10px;font-size:12px">출석 ${count(rec, 'present')} · 지각 ${count(rec, 'late')} · 결석 ${count(rec, 'absent')} · 공결 ${count(rec, 'excused')}</div>`}
      </div>`;

    $('#a_course').onchange = (e) => { attSel.courseId = e.target.value; attSel.date = ''; renderAttendance(); };
    $('#a_date').onchange = (e) => { attSel.date = e.target.value; renderAttendance(); };
    $('#printAtt').onclick = () => window.print();
    $('#expAtt').onclick = exportAttendance;
    const ap = $('#a_allpresent'); if (ap) ap.onclick = () => { const r = state.attendance[key] = state.attendance[key] || {}; enrolled.forEach(s => r[s.id] = 'present'); save(); renderAttendance(); };
    el.querySelectorAll('[data-att]').forEach(b => b.onclick = () => {
      const [sid, val] = b.dataset.att.split('|');
      const r = state.attendance[key] = state.attendance[key] || {};
      if (r[sid] === val) delete r[sid]; else r[sid] = val;
      save(); renderAttendance();
    });
  }
  function attRow(s, rec) {
    const cur = rec[s.id];
    const st = studentAttStats(s.id);
    const btn = (v) => `<button class="att-btn ${cur === v ? 'on-' + v : ''}" data-att="${s.id}|${v}" title="${ATT[v]}">${ATT[v][0]}</button>`;
    return `<tr><td><strong>${esc(s.name)}</strong></td><td class="muted">${esc(s.phone || '')}</td>
      <td class="no-print"><div class="att-cell">${btn('present')}${btn('late')}${btn('absent')}${btn('excused')}</div></td>
      <td class="no-print">${st.rate == null ? '—' : st.rate + '% <span class="muted">(' + st.present + '/' + st.total + ')</span>'}</td></tr>`;
  }
  const count = (rec, v) => Object.values(rec).filter(x => x === v).length;
  function exportAttendance() {
    const rows = [['강좌', '회차', '이름', '연락처', '출결']];
    Object.entries(state.attendance).forEach(([k, rec]) => {
      const [cid, date] = k.split('::'); const c = courseById(cid); if (!c) return;
      Object.entries(rec).forEach(([sid, v]) => { const s = studentById(sid); if (s) rows.push([c.name, date, s.name, s.phone, ATT[v]]); });
    });
    download('출석기록_' + today() + '.csv', toCSV(rows), 'text/csv');
    toast('CSV를 내보냈습니다');
  }

  /* ---------- 세그먼트 ---------- */
  let segRules = [{ field: 'courseCount', op: '>=', value: 1 }];
  function renderSegments() {
    const el = $('#view-segments');
    const matched = applySegments();
    el.innerHTML = `
      <div class="section-head"><h2>세그먼트</h2><span class="desc">조건으로 대상자를 자동 추출 → 메시지로 전달</span></div>
      <div class="card pad" style="margin-bottom:14px">
        <p class="muted" style="font-size:12px;margin:0 0 10px">아래 조건을 <b>모두</b> 만족하는 수강생을 찾습니다.</p>
        <div id="segRules">${segRules.map(ruleHTML).join('')}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn sm" id="addRule">＋ 조건 추가</button>
          <div class="spacer"></div>
          <button class="btn sm" data-preset="one">🎯 1개만 신청</button>
          <button class="btn sm" data-preset="three">🎯 3개 이상 신청</button>
          <button class="btn sm" data-preset="absent">🎯 결석 2회 이상</button>
          <button class="btn sm" data-preset="unpaid">🎯 미납자</button>
        </div>
      </div>
      <div class="card">
        <div class="pad" style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line)">
          <strong>${matched.length}명</strong> 조건 일치
          <div class="spacer"></div>
          <button class="btn sm" id="segCsv">CSV 내보내기</button>
          <button class="btn primary sm" id="segToMsg" ${matched.length ? '' : 'disabled'}>✉ 이 대상에게 메시지</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>이름</th><th>연락처</th><th>신청 강좌</th><th>상태</th><th>결석</th></tr></thead><tbody>
          ${matched.length ? matched.map(s => `<tr><td><strong>${esc(s.name)}</strong></td><td class="muted">${esc(s.phone || '')}</td><td class="wrap">${courseNames(s.courseIds).join(', ') || '—'} <span class="badge">${s.courseIds.length}개</span></td><td><span class="badge ${s.status}">${STATUS[s.status]}</span></td><td>${absenceCount(s.id)}회</td></tr>`).join('') : '<tr><td colspan="5" class="empty">조건에 맞는 수강생이 없습니다.</td></tr>'}
        </tbody></table></div>
      </div>`;

    bindRules();
    $('#addRule').onclick = () => { segRules.push({ field: 'courseCount', op: '>=', value: 1 }); renderSegments(); };
    el.querySelectorAll('[data-preset]').forEach(b => b.onclick = () => {
      const p = b.dataset.preset;
      segRules = p === 'one' ? [{ field: 'courseCount', op: '=', value: 1 }]
        : p === 'three' ? [{ field: 'courseCount', op: '>=', value: 3 }]
        : p === 'unpaid' ? [{ field: 'payment', op: 'is', value: 'unpaid' }]
        : [{ field: 'absence', op: '>=', value: 2 }];
      renderSegments();
    });
    $('#segCsv').onclick = () => {
      const rows = [['이름', '연락처', '이메일', '신청강좌', '상태', '결석수'], ...matched.map(s => [s.name, s.phone, s.email, courseNames(s.courseIds).join(' / '), STATUS[s.status], absenceCount(s.id)])];
      download('세그먼트_' + today() + '.csv', toCSV(rows), 'text/csv'); toast('CSV를 내보냈습니다');
    };
    const toMsg = $('#segToMsg'); if (toMsg) toMsg.onclick = () => { recipients = matched.map(s => s.id); go('messages'); toast(matched.length + '명을 메시지 대상으로 담았습니다'); };
  }
  function ruleHTML(r, i) {
    const fields = { courseCount: '신청 강좌 수', course: '특정 강좌', status: '상태', absence: '결석 횟수', payment: '입금상태', tag: '태그' };
    const numOps = { '>=': '이상', '=': '정확히', '<=': '이하' };
    let valInput = '';
    if (r.field === 'courseCount' || r.field === 'absence') valInput = `<input type="number" data-v="${i}" value="${esc(r.value)}" min="0" style="max-width:80px"> <span class="muted">${r.field === 'courseCount' ? '개' : '회'}</span>`;
    else if (r.field === 'course') valInput = `<select data-v="${i}">${state.courses.map(c => `<option value="${c.id}" ${r.value === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    else if (r.field === 'status') valInput = `<select data-v="${i}">${optionList(STATUS, r.value)}</select>`;
    else if (r.field === 'payment') valInput = `<select data-v="${i}">${optionList({ unpaid: '미납', partial: '부분납', paid: '완납', exempt: '면제' }, r.value)}</select>`;
    else valInput = `<input type="text" data-v="${i}" value="${esc(r.value)}" placeholder="태그">`;
    let opSel = '';
    if (r.field === 'courseCount' || r.field === 'absence') opSel = `<select data-op="${i}">${optionList(numOps, r.op)}</select>`;
    else if (r.field === 'course') opSel = `<select data-op="${i}">${optionList({ has: '신청함', not: '신청안함' }, r.op)}</select>`;
    else opSel = `<select data-op="${i}">${optionList({ is: '=', not: '≠' }, r.op)}</select>`;
    return `<div class="rule"><select data-f="${i}">${optionList(fields, r.field)}</select>${opSel}${valInput}${segRules.length > 1 ? `<button class="icon-btn" data-rmrule="${i}">✕</button>` : ''}</div>`;
  }
  function bindRules() {
    const wrap = $('#segRules');
    wrap.querySelectorAll('[data-f]').forEach(s => s.onchange = () => { const i = +s.dataset.f; segRules[i].field = s.value; segRules[i].op = defaultOp(s.value); segRules[i].value = defaultVal(s.value); renderSegments(); });
    wrap.querySelectorAll('[data-op]').forEach(s => s.onchange = () => { segRules[+s.dataset.op].op = s.value; renderSegments(); });
    wrap.querySelectorAll('[data-v]').forEach(inp => inp.onchange = () => { segRules[+inp.dataset.v].value = inp.value; renderSegments(); });
    wrap.querySelectorAll('[data-rmrule]').forEach(b => b.onclick = () => { segRules.splice(+b.dataset.rmrule, 1); renderSegments(); });
  }
  function defaultOp(f) { return f === 'course' ? 'has' : (f === 'status' || f === 'tag' || f === 'payment') ? 'is' : '>='; }
  function defaultVal(f) { return f === 'course' ? (state.courses[0] || {}).id || '' : f === 'status' ? 'confirmed' : f === 'payment' ? 'unpaid' : f === 'tag' ? '' : 1; }
  function applySegments() {
    return state.students.filter(s => segRules.every(r => matchRule(s, r)));
  }
  function matchRule(s, r) {
    if (r.field === 'courseCount') { const n = s.courseIds.length, v = +r.value; return r.op === '>=' ? n >= v : r.op === '<=' ? n <= v : n === v; }
    if (r.field === 'absence') { const n = absenceCount(s.id), v = +r.value; return r.op === '>=' ? n >= v : r.op === '<=' ? n <= v : n === v; }
    if (r.field === 'course') { const has = s.courseIds.includes(r.value); return r.op === 'has' ? has : !has; }
    if (r.field === 'status') { return r.op === 'is' ? s.status === r.value : s.status !== r.value; }
    if (r.field === 'payment') { return r.op === 'is' ? s.payStatus === r.value : s.payStatus !== r.value; }
    if (r.field === 'tag') { const has = s.tags.some(t => t.toLowerCase() === String(r.value).toLowerCase().trim()); return r.op === 'is' ? has : !has; }
    return true;
  }

  /* ---------- 메시지·설문 ---------- */
  let msgState = { templateId: 'tpl_welcome', body: '', channel: 'sms', courseCtx: '', dateCtx: '', sessionCtx: '' };
  function renderMessages() {
    const el = $('#view-messages');
    if (!msgState.body) { const t = state.templates.find(t => t.id === msgState.templateId) || state.templates[0]; if (t) { msgState.body = t.body; msgState.channel = t.channel; } }
    const rcpts = recipients.map(studentById).filter(Boolean);

    el.innerHTML = `
      <div class="section-head"><h2>메시지·설문</h2><span class="desc">문의·안내·리마인드·설문 요청을 대상자에게</span></div>
      <div class="hint warn" style="margin-bottom:14px">이 사이트는 서버가 없어 <b>자동 발송은 하지 않습니다.</b> 대신 대상·문구를 자동으로 만들어 → 문자앱 열기 / 카톡 오픈방 붙여넣기 / 대량발송 CSV 로 연결합니다. (실제 자동발송 연동은 <b>데이터 탭 안내</b> 참고)</div>

      <div class="row">
        <div class="card pad" style="flex:1;min-width:320px">
          <h3 style="font-size:15px">1. 문구 작성</h3>
          <label class="field"><span>템플릿</span>
            <select id="tplSel">${state.templates.map(t => `<option value="${t.id}" ${t.id === msgState.templateId ? 'selected' : ''}>${esc(t.name)} · ${t.channel === 'sms' ? '문자' : '카톡'}</option>`).join('')}</select>
          </label>
          <div class="inline">
            <label class="field" style="max-width:130px"><span>채널</span><select id="chSel">${optionList({ sms: '문자(SMS)', kakao: '카톡 오픈방' }, msgState.channel)}</select></label>
            <label class="field"><span>강좌(변수용)</span><select id="ctxCourse"><option value="">—</option>${state.courses.map(c => `<option value="${c.id}" ${msgState.courseCtx === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          </div>
          <div class="inline">
            <label class="field"><span>날짜(변수용)</span><input type="date" id="ctxDate" value="${esc(msgState.dateCtx)}"></label>
            <label class="field"><span>회차 표기(변수용)</span><input type="text" id="ctxSession" value="${esc(msgState.sessionCtx)}" placeholder="예: 3회차"></label>
          </div>
          <label class="field"><span>내용</span><textarea id="msgBody">${esc(msgState.body)}</textarea></label>
          <div class="var-list">사용 가능 변수:
            ${['{이름}', '{강좌명}', '{강좌목록}', '{날짜}', '{회차}', '{미납액}', '{설문링크}', '{기관명}'].map(v => `<code data-var="${v}">${v}</code>`).join('')}
          </div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn sm" id="saveTpl">현재 문구를 템플릿으로 저장</button>
          </div>
        </div>

        <div class="card pad" style="flex:1;min-width:320px">
          <h3 style="font-size:15px">2. 미리보기</h3>
          <p class="muted" style="font-size:12px;margin:0 0 8px">${rcpts.length ? '첫 대상자 기준 예시' : '대상자를 선택하면 개인화됩니다'}</p>
          <div class="msg-preview" id="preview">${esc(fillVars(msgState.body, rcpts[0]))}</div>
          <p class="muted" style="font-size:11px;margin-top:6px">글자 수 ${fillVars(msgState.body, rcpts[0]).length}자 ${msgState.channel === 'sms' ? '(SMS 90byte 초과 시 LMS로 발송됩니다)' : ''}</p>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="pad" style="display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);flex-wrap:wrap">
          <h3 style="font-size:15px;margin:0">3. 대상자 <span class="badge">${rcpts.length}명</span></h3>
          <div class="spacer"></div>
          <button class="btn sm" id="pickSeg">세그먼트에서 가져오기</button>
          <button class="btn sm" id="pickAll">전체 수강생</button>
          <button class="btn sm" id="pickClear">비우기</button>
        </div>
        ${rcpts.length ? `
        <div class="pad" style="display:flex;gap:8px;flex-wrap:wrap;border-bottom:1px solid var(--line)">
          ${msgState.channel === 'kakao'
            ? `<button class="btn primary" id="copyBroadcast">📋 오픈방 공지 전체 복사</button><span class="muted" style="font-size:12px;align-self:center">카톡 오픈방에 붙여넣기 (개인화 없이 공통 문구)</span>`
            : `<button class="btn accent" id="dlBulk">⬇ 대량발송 CSV (연락처+개인화문구)</button><span class="muted" style="font-size:12px;align-self:center">문자 대량발송 서비스에 업로드용</span>`}
        </div>
        <div style="max-height:360px;overflow:auto">
          ${rcpts.map(recipientLine).join('')}
        </div>` : '<div class="empty">대상자가 없습니다. 위 버튼으로 대상을 선택하세요.</div>'}
      </div>`;

    // 바인딩
    $('#tplSel').onchange = (e) => { const t = state.templates.find(t => t.id === e.target.value); msgState.templateId = e.target.value; if (t) { msgState.body = t.body; msgState.channel = t.channel; } renderMessages(); };
    $('#chSel').onchange = (e) => { msgState.channel = e.target.value; renderMessages(); };
    $('#ctxCourse').onchange = (e) => { msgState.courseCtx = e.target.value; renderMessages(); };
    $('#ctxDate').onchange = (e) => { msgState.dateCtx = e.target.value; renderMessages(); };
    $('#ctxSession').oninput = (e) => { msgState.sessionCtx = e.target.value; $('#preview').textContent = fillVars(msgState.body, rcpts[0]); };
    $('#msgBody').oninput = (e) => { msgState.body = e.target.value; $('#preview').textContent = fillVars(msgState.body, rcpts[0]); };
    el.querySelectorAll('[data-var]').forEach(c => c.onclick = () => { const ta = $('#msgBody'); insertAtCursor(ta, c.dataset.var); msgState.body = ta.value; $('#preview').textContent = fillVars(msgState.body, rcpts[0]); });
    $('#saveTpl').onclick = saveCurrentTemplate;
    $('#pickSeg').onclick = () => go('segments');
    $('#pickAll').onclick = () => { recipients = activeStudents().map(s => s.id); renderMessages(); };
    $('#pickClear').onclick = () => { recipients = []; renderMessages(); };
    const cb = $('#copyBroadcast'); if (cb) cb.onclick = () => copy(fillVars(msgState.body, null));
    const db = $('#dlBulk'); if (db) db.onclick = downloadBulkSMS;
    el.querySelectorAll('[data-sms]').forEach(b => b.onclick = () => { const s = studentById(b.dataset.sms); window.location.href = smsLink(s); });
    el.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copy(fillVars(msgState.body, studentById(b.dataset.copy))));
    el.querySelectorAll('[data-rmr]').forEach(b => b.onclick = () => { recipients = recipients.filter(id => id !== b.dataset.rmr); renderMessages(); });
  }
  function recipientLine(s) {
    return `<div class="recipient-line">
      <span class="nm">${esc(s.name)}</span>
      <span class="ph">${esc(s.phone || '연락처 없음')}</span>
      <span class="muted" style="font-size:12px">${courseNames(s.courseIds).join(', ')}</span>
      <span class="actions">
        ${s.phone ? `<button class="btn sm" data-sms="${s.id}">문자앱 열기</button>` : ''}
        <button class="btn sm ghost" data-copy="${s.id}">복사</button>
        <button class="icon-btn" data-rmr="${s.id}">✕</button>
      </span></div>`;
  }
  function fillVars(body, s) {
    const c = courseById(msgState.courseCtx);
    const map = {
      '{기관명}': state.settings.orgName || '네다바웨이',
      '{이름}': s ? s.name : '○○',
      '{강좌명}': c ? c.name : (s && s.courseIds.length ? (courseById(s.courseIds[0]) || {}).name || '강좌' : '강좌'),
      '{강좌목록}': s && s.courseIds.length ? courseNames(s.courseIds).join(', ') : (c ? c.name : '강좌'),
      '{날짜}': msgState.dateCtx || '(날짜)',
      '{회차}': msgState.sessionCtx || '',
      '{미납액}': s ? (feeDue(s)).toLocaleString('ko-KR') : '(미납액)',
      '{설문링크}': state.settings.surveyUrl || '(설문 링크: 설정에서 입력)'
    };
    return String(body).replace(/\{[^}]+\}/g, m => (m in map ? map[m] : m));
  }
  function smsLink(s) {
    const body = encodeURIComponent(fillVars(msgState.body, s));
    // iOS/Android 호환: 대부분 sms:번호?body= 형식 지원
    return 'sms:' + (s.phone || '').replace(/[^0-9+]/g, '') + '?body=' + body;
  }
  function downloadBulkSMS() {
    const rows = [['이름', '연락처', '메시지']];
    recipients.map(studentById).filter(Boolean).forEach(s => rows.push([s.name, s.phone, fillVars(msgState.body, s)]));
    download('대량발송_' + today() + '.csv', toCSV(rows), 'text/csv');
    toast('대량발송 CSV를 내보냈습니다');
  }
  function insertAtCursor(ta, text) {
    const start = ta.selectionStart || ta.value.length;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(ta.selectionEnd || start);
    ta.focus(); ta.selectionStart = ta.selectionEnd = start + text.length;
  }
  function saveCurrentTemplate() {
    modal('템플릿 저장', `
      <label class="field"><span>템플릿 이름</span><input type="text" id="t_name" placeholder="예: 5월 특강 안내"></label>
      <div class="hint">현재 채널(${msgState.channel === 'sms' ? '문자' : '카톡'})과 내용이 새 템플릿으로 저장됩니다.</div>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="t_save">저장</button></div>`);
    $('#t_save').onclick = () => {
      const name = $('#t_name').value.trim(); if (!name) { toast('이름을 입력하세요'); return; }
      const t = { id: uid('tpl_'), name, channel: msgState.channel, scene: 'custom', body: msgState.body };
      state.templates.push(t); msgState.templateId = t.id; save(); closeModal(); renderMessages(); toast('템플릿을 저장했습니다');
    };
  }

  /* ---------- 데이터(설정/백업/가져오기) ---------- */
  function renderData() {
    const el = $('#view-data');
    el.innerHTML = `
      <div class="section-head"><h2>데이터</h2><span class="desc">설정 · 백업 · 가져오기 · 실제 발송 연동</span></div>

      <div class="row">
        <div class="card pad" style="flex:1;min-width:300px">
          <h3 style="font-size:15px">기본 설정</h3>
          <label class="field"><span>기관명 (메시지 {기관명}에 사용)</span><input type="text" id="setOrg" value="${esc(state.settings.orgName)}"></label>
          <label class="field"><span>보내는 사람 이름</span><input type="text" id="setSender" value="${esc(state.settings.senderName || '')}"></label>
          <label class="field"><span>종료 후 설문 링크 (메시지 {설문링크}에 사용)</span><input type="text" id="setSurvey" value="${esc(state.settings.surveyUrl || '')}" placeholder="구글폼 등 설문 URL"></label>
          <div class="inline">
            <label class="field" style="max-width:170px"><span>대표자명 (수료증 발급)</span><input type="text" id="setRep" value="${esc(state.settings.repName || '')}" placeholder="예: 홍길동"></label>
            <label class="field" style="max-width:150px"><span>수료 기준 출석률(%)</span><input type="number" id="setCert" value="${esc(state.settings.certThreshold || 80)}" min="0" max="100"></label>
          </div>
          <label class="field"><span>화면 잠금 PIN (개인정보 보호 · 숫자 4~8자리, 비우면 해제)</span><input type="text" id="setPin" value="${esc(state.settings.pin || '')}" inputmode="numeric" maxlength="8" placeholder="미설정"></label>
          <button class="btn primary sm" id="saveSet">설정 저장</button>
        </div>

        <div class="card pad" style="flex:1;min-width:300px">
          <h3 style="font-size:15px">백업 / 복원</h3>
          <p class="muted" style="font-size:12px">데이터는 이 브라우저에만 저장됩니다. 정기적으로 백업하세요.</p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn" id="expJson">⬇ 전체 백업(JSON) 내보내기</button>
            <label class="btn" style="text-align:center;cursor:pointer">⬆ 백업(JSON) 복원<input type="file" id="impJson" accept=".json" hidden></label>
            <button class="btn ghost sm" id="loadSample">샘플 데이터 불러오기</button>
            <button class="btn danger sm" id="resetAll">전체 초기화</button>
          </div>
        </div>
      </div>

      <div class="card pad" style="margin-top:14px">
        <h3 style="font-size:15px">접수자 CSV 가져오기 (구글폼 → 이곳)</h3>
        <p class="muted" style="font-size:12px">구글폼 응답을 CSV로 내려받아 업로드하면 수강생으로 등록됩니다. 열 이름에 <b>이름 / 연락처(또는 전화) / 이메일 / 강좌</b>가 있으면 자동 매칭합니다. (강좌명은 " / " 또는 ","로 여러 개 구분)</p>
        <label class="btn primary" style="cursor:pointer">CSV 파일 선택<input type="file" id="impCsv" accept=".csv" hidden></label>
        <button class="btn sm" id="csvTemplate">빈 양식 CSV 받기</button>
        <div id="csvResult" style="margin-top:10px"></div>
      </div>

      <div class="card pad" style="margin-top:14px">
        <h3 style="font-size:15px">실제 문자·카톡 자동발송으로 확장하기</h3>
        <div class="hint">이 관제 센터는 <b>대상·문구 조립까지</b> 자동화합니다. 실제 "버튼 없이 자동 발송"까지 가려면 서버/외부 서비스 연동이 필요합니다:
          <ul style="margin:8px 0 0;padding-left:18px;line-height:1.7">
            <li><b>문자(SMS/LMS)</b>: 네이버 클라우드 SENS, 알리고, 뿌리오 등 → 여기서 내려받은 <b>대량발송 CSV</b>를 업로드하거나 API로 자동화</li>
            <li><b>카카오 알림톡</b>: 카카오 비즈메시지(사업자·템플릿 심사 필요) → 발송 API 연동</li>
            <li><b>오픈채팅 공지</b>: 자동화 API가 없어 <b>공지 문구 복사→붙여넣기</b>가 현실적</li>
            <li><b>접수 자동 수집</b>: 구글폼 → (구글시트) → 정기적으로 CSV 내보내 이곳에 가져오기, 또는 시트+Apps Script로 자동화</li>
          </ul>
          연동 코드가 필요하면 <code>/manage/README.md</code>의 흐름도를 참고하세요.
        </div>
      </div>`;

    $('#saveSet').onclick = () => {
      state.settings.orgName = $('#setOrg').value.trim() || '네다바웨이'; state.settings.senderName = $('#setSender').value.trim();
      state.settings.surveyUrl = $('#setSurvey').value.trim(); state.settings.repName = $('#setRep').value.trim();
      state.settings.certThreshold = Math.min(100, Math.max(0, +$('#setCert').value || 80));
      state.settings.pin = ($('#setPin').value || '').replace(/[^0-9]/g, '').slice(0, 8);
      save(); updateLockBtn(); render(); toast('설정을 저장했습니다');
    };
    $('#expJson').onclick = () => download('네다바웨이_운영백업_' + today() + '.json', JSON.stringify(state, null, 2), 'application/json');
    $('#impJson').onchange = (e) => importJson(e.target.files[0]);
    $('#loadSample').onclick = () => { if (confirm('현재 데이터를 지우고 샘플을 불러올까요?')) { state = sample(); reattachSeq(); save(); updateLockBtn(); toast('샘플을 불러왔습니다'); go('dashboard'); } };
    $('#resetAll').onclick = () => { if (confirm('모든 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) { state = blank(); reattachSeq(); save(); updateLockBtn(); toast('초기화했습니다'); go('dashboard'); } };
    $('#impCsv').onchange = (e) => importCsv(e.target.files[0]);
    $('#csvTemplate').onclick = () => download('접수양식.csv', toCSV([['이름', '연락처', '이메일', '카카오', '강좌', '상태', '메모'], ['홍길동', '010-1234-5678', 'hong@example.com', 'hong_kko', '말씀묵상 1강 / 리더십 2강', '신청', '']]), 'text/csv');
  }
  function importJson(file) {
    if (!file) return; const r = new FileReader();
    r.onload = () => { try { const d = JSON.parse(r.result); if (!d.students) throw 0; state = d; reattachSeq(); state.settings = Object.assign({ orgName: '네다바웨이' }, state.settings); state.templates = state.templates && state.templates.length ? state.templates : defaultTemplates(); state.donors = state.donors || []; state.inquiries = state.inquiries || []; state.todos = state.todos || []; state.ledger = state.ledger || []; state.students.forEach(s => { if (s.feeAmount == null) s.feeAmount = 0; if (s.paidAmount == null) s.paidAmount = 0; if (!s.payStatus) s.payStatus = 'unpaid'; if (s.consent == null) s.consent = false; }); save(); updateLockBtn(); toast('복원했습니다'); go('dashboard'); } catch (e) { toast('올바른 백업 파일이 아닙니다'); } };
    r.readAsText(file);
  }
  function importCsv(file) {
    if (!file) return; const r = new FileReader();
    r.onload = () => {
      const rows = parseCSV(r.result); if (rows.length < 2) { toast('데이터가 없습니다'); return; }
      const head = rows[0].map(h => h.trim());
      const find = (...keys) => head.findIndex(h => keys.some(k => h.replace(/\s/g, '').toLowerCase().includes(k)));
      const iName = find('이름', 'name'), iPhone = find('연락처', '전화', '휴대', 'phone', 'tel'),
        iEmail = find('이메일', 'email', '메일'), iKakao = find('카카오', 'kakao'),
        iCourse = find('강좌', '수강', 'course'), iStatus = find('상태', 'status'), iMemo = find('메모', 'memo', '비고');
      const statusMap = { '신청': 'applied', '확정': 'confirmed', '대기': 'waitlist', '취소': 'cancelled' };
      let added = 0, newCourses = 0;
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i]; const name = (iName >= 0 ? row[iName] : row[0] || '').trim(); if (!name) continue;
        const courseNamesRaw = iCourse >= 0 ? (row[iCourse] || '').split(/\s*[\/,]\s*/).map(x => x.trim()).filter(Boolean) : [];
        const courseIds = courseNamesRaw.map(cn => {
          let c = state.courses.find(x => x.name === cn);
          if (!c) { c = { id: uid('co_'), name: cn, color: COURSE_COLORS[state.courses.length % COURSE_COLORS.length], capacity: '', memo: '', sessions: [] }; state.courses.push(c); newCourses++; }
          return c.id;
        });
        const statusRaw = iStatus >= 0 ? (row[iStatus] || '').trim() : '';
        state.students.push({ id: uid('st_'), name, phone: iPhone >= 0 ? (row[iPhone] || '').trim() : '', email: iEmail >= 0 ? (row[iEmail] || '').trim() : '', kakao: iKakao >= 0 ? (row[iKakao] || '').trim() : '', memo: iMemo >= 0 ? (row[iMemo] || '').trim() : '', courseIds, tags: [], status: statusMap[statusRaw] || 'applied', appliedAt: new Date().toISOString() });
        added++;
      }
      save();
      $('#csvResult').innerHTML = `<div class="hint">✅ ${added}명 등록${newCourses ? ' · 새 강좌 ' + newCourses + '개 자동 생성' : ''}. <button class="btn sm" onclick="location.reload()">새로고침</button></div>`;
      toast(added + '명을 가져왔습니다');
    };
    r.readAsText(file);
  }

  /* ---------- 재무·정산 ---------- */
  function renderFinance() {
    const el = $('#view-finance');
    const m = today().slice(0, 7);
    const tuitionPaid = totalTuitionPaid();
    const incOther = ledgerSum('income');
    const donations = state.donors.filter(d => d.status !== 'lapsed').reduce((a, d) => a + (Number(d.amount) || 0) * (d.type === 'regular' ? 1 : 0), 0);
    const expense = ledgerSum('expense');
    const net = tuitionPaid + incOther + donorTotalReceived() - expense;
    const PAY = { unpaid: '미납', partial: '부분납', paid: '완납', exempt: '면제' };
    // 강좌별 정산
    const perCourse = state.courses.map(c => {
      const studs = activeStudents().filter(s => s.courseIds.includes(c.id));
      const billed = studs.reduce((a, s) => a + (s.payStatus === 'exempt' ? 0 : Math.round((Number(s.feeAmount) || 0) / Math.max(1, s.courseIds.length))), 0);
      const collected = studs.reduce((a, s) => a + Math.round((Number(s.paidAmount) || 0) / Math.max(1, s.courseIds.length)), 0);
      return { c, n: studs.length, billed, collected };
    });
    const unpaidList = activeStudents().filter(s => s.payStatus !== 'exempt' && feeDue(s) > 0).sort((a, b) => feeDue(b) - feeDue(a));

    el.innerHTML = `
      <div class="section-head"><h2>재무·정산</h2><span class="desc">수강료 입금·미수금 · 수입/지출 · 강좌별 정산</span>
        <div class="spacer"></div>
        <button class="btn sm" id="finExport">CSV 내보내기</button>
        <button class="btn primary sm" id="addLedger">＋ 수입/지출 입력</button>
      </div>

      <div class="grid kpi" style="margin-bottom:14px">
        ${kpi('수강료 수납', shortWon(tuitionPaid), '누적 입금')}
        ${kpi('미수금', shortWon(totalUnpaid()), unpaidList.length + '명 미납')}
        ${kpi('후원 수입', shortWon(donorTotalReceived()), '누적')}
        ${kpi('기타 수입', shortWon(incOther), '장부')}
        ${kpi('지출', shortWon(expense), '장부')}
        ${kpi('순수입', shortWon(net), '수입−지출')}
      </div>

      <div class="row">
        <div class="card" style="flex:1;min-width:320px">
          <div class="pad" style="border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
            <h3 style="font-size:15px;margin:0">미수금 (수강료 미납)</h3><div class="spacer"></div>
            <button class="btn sm primary" id="finMsg" ${unpaidList.length ? '' : 'disabled'}>✉ 입금 안내 보내기</button>
          </div>
          <div class="table-wrap"><table><thead><tr><th>이름</th><th class="num">수강료</th><th class="num">입금</th><th class="num">미납</th><th></th></tr></thead><tbody>
            ${unpaidList.length ? unpaidList.map(s => `<tr><td><strong>${esc(s.name)}</strong> <span class="badge ${s.payStatus}">${PAY[s.payStatus]}</span></td><td class="num">${(s.feeAmount || 0).toLocaleString('ko-KR')}</td><td class="num">${(s.paidAmount || 0).toLocaleString('ko-KR')}</td><td class="num overdue">${feeDue(s).toLocaleString('ko-KR')}</td><td style="text-align:right"><button class="btn sm" data-payedit="${s.id}">입금 처리</button></td></tr>`).join('') : '<tr><td colspan="5" class="empty">미납이 없습니다 👍</td></tr>'}
          </tbody></table></div>
        </div>
        <div class="card" style="flex:1;min-width:300px">
          <div class="pad" style="border-bottom:1px solid var(--line)"><h3 style="font-size:15px;margin:0">강좌별 정산</h3></div>
          <div class="table-wrap"><table><thead><tr><th>강좌</th><th class="num">인원</th><th class="num">청구</th><th class="num">수납</th></tr></thead><tbody>
            ${perCourse.length ? perCourse.map(p => `<tr><td><span class="course-dot" style="background:${p.c.color}"></span> ${esc(p.c.name)}</td><td class="num">${p.n}</td><td class="num">${p.billed.toLocaleString('ko-KR')}</td><td class="num">${p.collected.toLocaleString('ko-KR')}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">강좌가 없습니다.</td></tr>'}
          </tbody></table></div>
          <div class="pad muted" style="font-size:11px">청구·수납은 수강생의 수강료/입금액을 신청 강좌 수로 나눠 배분한 근사치입니다.</div>
        </div>
      </div>

      <div class="card" style="margin-top:14px">
        <div class="pad" style="border-bottom:1px solid var(--line);display:flex;align-items:center;gap:8px">
          <h3 style="font-size:15px;margin:0">수입·지출 장부</h3>
          <div class="spacer"></div>
          <button class="btn sm" id="calc33">🧮 프리랜서 3.3% 계산기</button>
        </div>
        <div class="table-wrap"><table><thead><tr><th>날짜</th><th>구분</th><th>항목</th><th>분류</th><th class="num">금액</th><th></th></tr></thead><tbody>
          ${state.ledger.length ? state.ledger.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => `<tr><td>${esc(e.date || '')}</td><td>${e.type === 'income' ? '<span class="amt pos">수입</span>' : '<span class="amt neg">지출</span>'}</td><td>${esc(e.title)}</td><td class="muted">${esc(e.category || '')}</td><td class="num">${(Number(e.amount) || 0).toLocaleString('ko-KR')}</td><td style="text-align:right"><button class="icon-btn" data-delledger="${e.id}">🗑</button></td></tr>`).join('') : '<tr><td colspan="6" class="empty">항목이 없습니다. 우측 상단에서 입력하세요.</td></tr>'}
        </tbody></table></div>
      </div>`;

    $('#addLedger').onclick = () => openLedgerModal();
    $('#finExport').onclick = exportFinance;
    $('#calc33').onclick = openTaxCalc;
    const fm = $('#finMsg'); if (fm) fm.onclick = () => { recipients = unpaidList.map(s => s.id); msgState.templateId = 'tpl_pay'; const t = state.templates.find(t => t.id === 'tpl_pay'); if (t) { msgState.body = t.body; msgState.channel = t.channel; } go('messages'); toast(unpaidList.length + '명 · 입금 안내 템플릿 준비됨'); };
    el.querySelectorAll('[data-payedit]').forEach(b => b.onclick = () => openPayModal(b.dataset.payedit));
    el.querySelectorAll('[data-delledger]').forEach(b => b.onclick = () => { if (confirm('삭제할까요?')) { state.ledger = state.ledger.filter(e => e.id !== b.dataset.delledger); save(); renderFinance(); } });
  }
  function donorTotalReceived() { return state.donors.reduce((a, d) => a + (Number(d.received) || 0), 0); }
  function openPayModal(id) {
    const s = studentById(id); if (!s) return;
    modal('입금 처리 · ' + s.name, `
      <div class="inline">
        <label class="field"><span>수강료(원)</span><input type="number" id="p_fee" value="${esc(s.feeAmount || 0)}"></label>
        <label class="field"><span>입금액(원)</span><input type="number" id="p_paid" value="${esc(s.paidAmount || 0)}"></label>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:10px"><button class="btn sm" id="p_full">완납 처리</button><button class="btn sm" id="p_exempt">면제</button></div>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="p_save">저장</button></div>`);
    $('#p_full').onclick = () => { $('#p_paid').value = $('#p_fee').value; };
    $('#p_exempt').onclick = () => { s.payStatus = 'exempt'; s.paidAmount = 0; save(); closeModal(); renderFinance(); toast('면제 처리했습니다'); };
    $('#p_save').onclick = () => {
      const fee = +$('#p_fee').value || 0, paid = +$('#p_paid').value || 0;
      s.feeAmount = fee; s.paidAmount = paid;
      s.payStatus = paid <= 0 ? 'unpaid' : paid >= fee && fee > 0 ? 'paid' : 'partial';
      save(); closeModal(); renderFinance(); toast('입금 정보를 저장했습니다');
    };
  }
  function openLedgerModal() {
    modal('수입/지출 입력', `
      <div class="inline">
        <label class="field" style="max-width:130px"><span>구분</span><select id="l_type">${optionList({ income: '수입', expense: '지출' }, 'expense')}</select></label>
        <label class="field"><span>날짜</span><input type="date" id="l_date" value="${today()}"></label>
      </div>
      <label class="field"><span>항목 *</span><input type="text" id="l_title" placeholder="예: 강의실 대관료, 교재 인쇄, 특강 수입"></label>
      <div class="inline">
        <label class="field"><span>분류</span><input type="text" id="l_cat" placeholder="예: 대관/인쇄/광고/수수료"></label>
        <label class="field" style="max-width:160px"><span>금액(원) *</span><input type="number" id="l_amt" min="0"></label>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="l_save">저장</button></div>`);
    $('#l_save').onclick = () => {
      const title = $('#l_title').value.trim(), amt = +$('#l_amt').value || 0;
      if (!title || !amt) { toast('항목과 금액을 입력하세요'); return; }
      state.ledger.push({ id: uid('lg_'), type: $('#l_type').value, date: $('#l_date').value, title, category: $('#l_cat').value.trim(), amount: amt });
      save(); closeModal(); renderFinance(); toast('저장되었습니다');
    };
  }
  function openTaxCalc() {
    modal('프리랜서 3.3% 원천징수 계산기', `
      <p class="muted" style="font-size:12px">강의료 등 사업소득 지급 시 원천징수(소득세 3% + 지방세 0.3%) 기준입니다.</p>
      <label class="field"><span>지급 총액(세전, 원)</span><input type="number" id="t_gross" placeholder="예: 1000000"></label>
      <div id="t_out" class="msg-preview" style="min-height:auto">금액을 입력하세요.</div>
      <div class="modal-actions"><button class="btn primary" data-close>닫기</button></div>`);
    const calc = () => {
      const g = +$('#t_gross').value || 0; const tax = Math.floor(g * 0.033); const net = g - tax;
      $('#t_out').innerHTML = `원천징수 <b>${tax.toLocaleString('ko-KR')}원</b> (3.3%)<br>실지급액 <b>${net.toLocaleString('ko-KR')}원</b>`;
    };
    $('#t_gross').oninput = calc;
  }
  function exportFinance() {
    const PAY = { unpaid: '미납', partial: '부분납', paid: '완납', exempt: '면제' };
    const rows = [['구분', '날짜', '이름/항목', '분류', '수강료/청구', '입금/금액', '미납', '상태']];
    activeStudents().forEach(s => rows.push(['수강료', s.appliedAt ? s.appliedAt.slice(0, 10) : '', s.name, courseNames(s.courseIds).join(' / '), s.feeAmount || 0, s.paidAmount || 0, feeDue(s), PAY[s.payStatus] || '']));
    state.ledger.forEach(e => rows.push([e.type === 'income' ? '수입' : '지출', e.date || '', e.title, e.category || '', '', e.amount || 0, '', '']));
    state.donors.forEach(d => rows.push(['후원', d.date || '', d.name, d.type === 'regular' ? '정기' : '일시', '', d.amount || 0, '', d.status === 'lapsed' ? '중단' : '']));
    download('재무_' + today() + '.csv', toCSV(rows), 'text/csv'); toast('재무 CSV를 내보냈습니다');
  }

  /* ---------- 후원 ---------- */
  function renderDonors() {
    const el = $('#view-donors');
    const list = state.donors.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const regular = state.donors.filter(d => d.type === 'regular' && d.status !== 'lapsed');
    el.innerHTML = `
      <div class="section-head"><h2>후원</h2><span class="desc">정기·일시 후원자 관리 · 감사 발송</span>
        <div class="spacer"></div>
        <button class="btn sm" id="donExport">CSV</button>
        <button class="btn primary sm" id="addDonor">＋ 후원자 추가</button>
      </div>
      <div class="grid kpi" style="margin-bottom:14px">
        ${kpi('후원자', state.donors.length, regular.length + '명 정기')}
        ${kpi('월 정기 후원', shortWon(donorMonthly()), '이탈 제외')}
        ${kpi('누적 수령', shortWon(donorTotalReceived()), '전체')}
        ${kpi('후원 중단', donorLapsedList().length, '팔로업 필요')}
      </div>
      <div class="card table-wrap">
        <table><thead><tr><th>이름</th><th>유형</th><th>연락처</th><th class="num">약정액</th><th class="num">누적수령</th><th>최근</th><th>상태</th><th></th></tr></thead><tbody>
          ${list.length ? list.map(donorRow).join('') : '<tr><td colspan="8" class="empty">후원자가 없습니다.</td></tr>'}
        </tbody></table>
      </div>
      <div class="hint" style="margin-top:12px">감사 메시지는 각 행의 <b>감사</b> 버튼(문자앱/복사)으로 보냅니다. 비영리 임의단체는 세액공제용 기부금영수증 발급이 제한될 수 있으니 규정을 확인하세요.</div>`;
    $('#addDonor').onclick = () => openDonorModal();
    $('#donExport').onclick = () => { const rows = [['이름', '유형', '연락처', '약정액', '누적수령', '주기', '최근', '상태', '메모'], ...state.donors.map(d => [d.name, d.type === 'regular' ? '정기' : '일시', d.phone, d.amount || 0, d.received || 0, d.cycle || '', d.date || '', d.status === 'lapsed' ? '중단' : '활성', d.memo || ''])]; download('후원자_' + today() + '.csv', toCSV(rows), 'text/csv'); toast('CSV를 내보냈습니다'); };
    el.querySelectorAll('[data-editd]').forEach(b => b.onclick = () => openDonorModal(b.dataset.editd));
    el.querySelectorAll('[data-deld]').forEach(b => b.onclick = () => { if (confirm('후원자를 삭제할까요?')) { state.donors = state.donors.filter(d => d.id !== b.dataset.deld); save(); renderDonors(); } });
    el.querySelectorAll('[data-thank]').forEach(b => b.onclick = () => thankDonor(b.dataset.thank));
  }
  function donorRow(d) {
    return `<tr class="${d.status === 'lapsed' ? '' : ''}">
      <td><strong>${esc(d.name)}</strong></td>
      <td><span class="badge ${d.type === 'regular' ? 'regular' : 'onetime'}">${d.type === 'regular' ? '정기' : '일시'}</span></td>
      <td class="muted">${esc(d.phone || '')}</td>
      <td class="num">${(Number(d.amount) || 0).toLocaleString('ko-KR')}</td>
      <td class="num">${(Number(d.received) || 0).toLocaleString('ko-KR')}</td>
      <td class="muted">${esc(d.date || '')}</td>
      <td>${d.status === 'lapsed' ? '<span class="badge lapsed">중단</span>' : '<span class="badge regular">활성</span>'}</td>
      <td style="text-align:right"><button class="btn sm" data-thank="${d.id}">감사</button><button class="icon-btn" data-editd="${d.id}">✎</button><button class="icon-btn" data-deld="${d.id}">🗑</button></td>
    </tr>`;
  }
  function openDonorModal(id) {
    const d = id ? state.donors.find(x => x.id === id) : { id: '', name: '', phone: '', type: 'regular', amount: 0, received: 0, cycle: '매월', date: today(), status: 'active', memo: '' };
    modal(id ? '후원자 수정' : '후원자 추가', `
      <label class="field"><span>이름 *</span><input type="text" id="d_name" value="${esc(d.name)}"></label>
      <div class="inline">
        <label class="field" style="max-width:130px"><span>유형</span><select id="d_type">${optionList({ regular: '정기', onetime: '일시' }, d.type)}</select></label>
        <label class="field"><span>연락처</span><input type="tel" id="d_phone" value="${esc(d.phone || '')}"></label>
      </div>
      <div class="inline">
        <label class="field"><span>약정액(원)</span><input type="number" id="d_amount" value="${esc(d.amount || 0)}"></label>
        <label class="field"><span>누적 수령(원)</span><input type="number" id="d_received" value="${esc(d.received || 0)}"></label>
      </div>
      <div class="inline">
        <label class="field" style="max-width:150px"><span>주기</span><input type="text" id="d_cycle" value="${esc(d.cycle || '')}" placeholder="매월/분기/일시"></label>
        <label class="field"><span>최근 후원일</span><input type="date" id="d_date" value="${esc(d.date || '')}"></label>
        <label class="field" style="max-width:130px"><span>상태</span><select id="d_status">${optionList({ active: '활성', lapsed: '중단' }, d.status)}</select></label>
      </div>
      <label class="field"><span>메모</span><textarea id="d_memo">${esc(d.memo || '')}</textarea></label>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="d_save">저장</button></div>`);
    $('#d_save').onclick = () => {
      const name = $('#d_name').value.trim(); if (!name) { toast('이름을 입력하세요'); return; }
      const data = { name, phone: $('#d_phone').value.trim(), type: $('#d_type').value, amount: +$('#d_amount').value || 0, received: +$('#d_received').value || 0, cycle: $('#d_cycle').value.trim(), date: $('#d_date').value, status: $('#d_status').value, memo: $('#d_memo').value.trim() };
      if (id) Object.assign(d, data); else state.donors.push(Object.assign({ id: uid('dn_') }, data));
      save(); closeModal(); renderDonors(); toast('저장되었습니다');
    };
  }
  function thankDonor(id) {
    const d = state.donors.find(x => x.id === id); if (!d) return;
    const t = state.templates.find(t => t.id === 'tpl_thanks');
    let body = (t ? t.body : '[{기관명}] {이름}님, 후원에 감사드립니다 🙏').replace(/\{기관명\}/g, state.settings.orgName || '네다바웨이').replace(/\{이름\}/g, d.name);
    modal('감사 메시지 · ' + d.name, `
      <label class="field"><span>내용</span><textarea id="th_body" style="min-height:120px">${esc(body)}</textarea></label>
      <div style="display:flex;gap:8px">
        ${d.phone ? '<button class="btn accent" id="th_sms">문자앱 열기</button>' : ''}
        <button class="btn" id="th_copy">복사</button>
        <div class="spacer"></div><button class="btn ghost" data-close>닫기</button>
      </div>`);
    const th = $('#th_sms'); if (th) th.onclick = () => { window.location.href = 'sms:' + (d.phone || '').replace(/[^0-9+]/g, '') + '?body=' + encodeURIComponent($('#th_body').value); };
    $('#th_copy').onclick = () => copy($('#th_body').value);
  }

  /* ---------- 문의 인박스 ---------- */
  let inboxFilter = 'open';
  function renderInbox() {
    const el = $('#view-inbox');
    let list = state.inquiries.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (inboxFilter === 'open') list = list.filter(q => q.status !== 'done');
    const CH = { insta: '인스타 DM', kakao: '카카오', sms: '문자', email: '이메일', phone: '전화', etc: '기타' };
    const ST = { new: '신규', progress: '진행', done: '완료' };
    el.innerHTML = `
      <div class="section-head"><h2>문의</h2><span class="desc">인스타 DM·카톡·메일 문의를 한 곳에서 추적</span>
        <div class="spacer"></div>
        <button class="btn sm ${inboxFilter === 'open' ? 'primary' : ''}" id="inbOpen">미완료</button>
        <button class="btn sm ${inboxFilter === 'all' ? 'primary' : ''}" id="inbAll">전체</button>
        <button class="btn primary sm" id="addInq">＋ 문의 추가</button>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(300px,1fr))">
        ${list.length ? list.map(q => `
          <div class="card pad">
            <div style="display:flex;align-items:center;gap:6px">
              <span class="badge ${q.status}">${ST[q.status]}</span>
              <span class="badge">${CH[q.channel] || q.channel}</span>
              <strong style="flex:1">${esc(q.from || '이름 미상')}</strong>
              <button class="icon-btn" data-editq="${q.id}">✎</button><button class="icon-btn" data-delq="${q.id}">🗑</button>
            </div>
            <div class="muted" style="font-size:11px;margin:4px 0">${esc(q.date || '')} ${q.contact ? '· ' + esc(q.contact) : ''}</div>
            <div style="font-size:13px;white-space:pre-wrap;margin:6px 0">${esc(q.body || '')}</div>
            ${q.memo ? '<div class="muted" style="font-size:12px">↳ ' + esc(q.memo) + '</div>' : ''}
            <div style="display:flex;gap:6px;margin-top:8px">
              ${q.status !== 'done' ? `<button class="btn sm" data-nextq="${q.id}">${q.status === 'new' ? '진행으로' : '완료로'}</button>` : `<button class="btn sm ghost" data-reopenq="${q.id}">다시 열기</button>`}
            </div>
          </div>`).join('') : '<div class="card pad empty">문의가 없습니다.</div>'}
      </div>`;
    $('#addInq').onclick = () => openInquiryModal();
    $('#inbOpen').onclick = () => { inboxFilter = 'open'; renderInbox(); };
    $('#inbAll').onclick = () => { inboxFilter = 'all'; renderInbox(); };
    el.querySelectorAll('[data-editq]').forEach(b => b.onclick = () => openInquiryModal(b.dataset.editq));
    el.querySelectorAll('[data-delq]').forEach(b => b.onclick = () => { if (confirm('삭제할까요?')) { state.inquiries = state.inquiries.filter(q => q.id !== b.dataset.delq); save(); renderInbox(); } });
    el.querySelectorAll('[data-nextq]').forEach(b => b.onclick = () => { const q = state.inquiries.find(x => x.id === b.dataset.nextq); q.status = q.status === 'new' ? 'progress' : 'done'; save(); renderInbox(); });
    el.querySelectorAll('[data-reopenq]').forEach(b => b.onclick = () => { const q = state.inquiries.find(x => x.id === b.dataset.reopenq); q.status = 'progress'; save(); renderInbox(); });
  }
  function openInquiryModal(id) {
    const q = id ? state.inquiries.find(x => x.id === id) : { id: '', from: '', channel: 'insta', contact: '', body: '', memo: '', status: 'new', date: today() };
    modal(id ? '문의 수정' : '문의 추가', `
      <div class="inline">
        <label class="field"><span>보낸 사람</span><input type="text" id="q_from" value="${esc(q.from || '')}"></label>
        <label class="field" style="max-width:150px"><span>채널</span><select id="q_channel">${optionList({ insta: '인스타 DM', kakao: '카카오', sms: '문자', email: '이메일', phone: '전화', etc: '기타' }, q.channel)}</select></label>
      </div>
      <div class="inline">
        <label class="field"><span>연락처(선택)</span><input type="text" id="q_contact" value="${esc(q.contact || '')}"></label>
        <label class="field" style="max-width:150px"><span>날짜</span><input type="date" id="q_date" value="${esc(q.date || today())}"></label>
        <label class="field" style="max-width:130px"><span>상태</span><select id="q_status">${optionList({ new: '신규', progress: '진행', done: '완료' }, q.status)}</select></label>
      </div>
      <label class="field"><span>문의 내용</span><textarea id="q_body">${esc(q.body || '')}</textarea></label>
      <label class="field"><span>처리 메모</span><textarea id="q_memo" style="min-height:60px">${esc(q.memo || '')}</textarea></label>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="q_save">저장</button></div>`);
    $('#q_save').onclick = () => {
      const data = { from: $('#q_from').value.trim(), channel: $('#q_channel').value, contact: $('#q_contact').value.trim(), date: $('#q_date').value, status: $('#q_status').value, body: $('#q_body').value.trim(), memo: $('#q_memo').value.trim() };
      if (id) Object.assign(q, data); else state.inquiries.push(Object.assign({ id: uid('iq_') }, data));
      save(); closeModal(); renderInbox(); toast('저장되었습니다');
    };
  }

  /* ---------- 할일·리마인더 ---------- */
  function renderTodos() {
    const el = $('#view-todos');
    const open = openTodos();
    const done = state.todos.filter(t => t.done);
    const timeline = buildTimeline();
    el.innerHTML = `
      <div class="section-head"><h2>할일 · 운영 캘린더</h2><span class="desc">회차·정산·마감을 한 타임라인으로</span>
        <div class="spacer"></div><button class="btn primary sm" id="addTodo">＋ 할일 추가</button></div>
      <div class="row">
        <div class="card" style="flex:1;min-width:300px">
          <div class="pad" style="border-bottom:1px solid var(--line)"><h3 style="font-size:15px;margin:0">할일 (${open.length})</h3></div>
          <div>
            ${open.length ? open.map(todoRow).join('') : '<div class="empty">할일이 없습니다 🎉</div>'}
            ${done.length ? `<div class="pad muted" style="font-size:12px;border-top:1px solid var(--line)">완료 ${done.length}건</div>` + done.slice(0, 5).map(todoRow).join('') : ''}
          </div>
        </div>
        <div class="card" style="flex:1;min-width:300px">
          <div class="pad" style="border-bottom:1px solid var(--line)"><h3 style="font-size:15px;margin:0">다가오는 일정</h3></div>
          <div class="table-wrap"><table><tbody>
            ${timeline.length ? timeline.map(t => `<tr><td style="width:110px"><strong>${t.date}</strong><br><span class="muted" style="font-size:11px">${daysFrom(t.date)}</span></td><td>${t.icon} ${esc(t.label)}</td></tr>`).join('') : '<tr><td class="empty">예정된 일정이 없습니다.</td></tr>'}
          </tbody></table></div>
        </div>
      </div>`;
    $('#addTodo').onclick = () => openTodoModal();
    el.querySelectorAll('[data-togglet]').forEach(b => b.onclick = () => { const t = state.todos.find(x => x.id === b.dataset.togglet); t.done = !t.done; save(); renderTodos(); });
    el.querySelectorAll('[data-editt]').forEach(b => b.onclick = () => openTodoModal(b.dataset.editt));
    el.querySelectorAll('[data-delt]').forEach(b => b.onclick = () => { state.todos = state.todos.filter(x => x.id !== b.dataset.delt); save(); renderTodos(); });
  }
  function todoRow(t) {
    const over = !t.done && t.due && t.due < today();
    return `<div class="recipient-line ${t.done ? 'todo-done' : ''}">
      <input type="checkbox" ${t.done ? 'checked' : ''} data-togglet="${t.id}" style="width:auto">
      <span class="nm" style="min-width:0;flex:1">${esc(t.title)}</span>
      ${t.due ? `<span class="${over ? 'overdue' : 'muted'}" style="font-size:12px">${t.due} ${over ? '· 지남' : '· ' + daysFrom(t.due)}</span>` : ''}
      <span class="actions"><button class="icon-btn" data-editt="${t.id}">✎</button><button class="icon-btn" data-delt="${t.id}">🗑</button></span>
    </div>`;
  }
  function openTodoModal(id) {
    const t = id ? state.todos.find(x => x.id === id) : { id: '', title: '', due: '', done: false };
    modal(id ? '할일 수정' : '할일 추가', `
      <label class="field"><span>할일 *</span><input type="text" id="td_title" value="${esc(t.title)}" placeholder="예: 3주차 자료 업로드, 정산 마감"></label>
      <label class="field" style="max-width:200px"><span>기한(선택)</span><input type="date" id="td_due" value="${esc(t.due || '')}"></label>
      <div class="modal-actions"><button class="btn ghost" data-close>취소</button><button class="btn primary" id="td_save">저장</button></div>`);
    $('#td_save').onclick = () => {
      const title = $('#td_title').value.trim(); if (!title) { toast('할일을 입력하세요'); return; }
      const data = { title, due: $('#td_due').value };
      if (id) Object.assign(t, data); else state.todos.push(Object.assign({ id: uid('td_'), done: false }, data));
      save(); closeModal(); renderTodos(); toast('저장되었습니다');
    };
  }
  function buildTimeline() {
    const t = today(); const out = [];
    upcomingSessions().forEach(u => out.push({ date: u.date, label: u.course.name + ' 회차', icon: '📘' }));
    openTodos().forEach(td => { if (td.due) out.push({ date: td.due, label: td.title, icon: '✅' }); });
    return out.filter(x => x.date >= t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 12);
  }

  /* ---------- 수료증 ---------- */
  let certCourseId = '';
  function renderCerts() {
    const el = $('#view-certs');
    if (!state.courses.length) { el.innerHTML = headed('수료') + '<div class="card pad empty">먼저 강좌를 등록하세요.</div>'; return; }
    if (!certCourseId) certCourseId = state.courses[0].id;
    const course = courseById(certCourseId);
    const studs = activeStudents().filter(s => s.courseIds.includes(course.id));
    const rows = studs.map(s => ({ s, r: certResult(s.id, course.id) }));
    const th = state.settings.certThreshold || 80;
    el.innerHTML = `
      <div class="section-head"><h2>수료</h2><span class="desc">출석률 ${th}% 이상 자동 수료 판정</span>
        <div class="spacer"></div>
        <label class="field" style="margin:0;max-width:220px"><select id="certCourse">${state.courses.map(c => `<option value="${c.id}" ${c.id === certCourseId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      </div>
      <div class="card table-wrap">
        <table><thead><tr><th>이름</th><th class="num">출석</th><th class="num">출석률</th><th>판정</th><th></th></tr></thead><tbody>
          ${rows.length ? rows.map(({ s, r }) => `<tr><td><strong>${esc(s.name)}</strong></td><td class="num">${r.total ? r.present + '/' + r.total : '—'}</td><td class="num">${r.rate == null ? '—' : r.rate + '%'}</td><td>${r.rate == null ? '<span class="badge">기록없음</span>' : r.pass ? '<span class="badge paid">수료</span>' : '<span class="badge unpaid">미수료</span>'}</td><td style="text-align:right">${r.pass ? `<button class="btn sm" data-cert="${s.id}">수료증</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">이 강좌 수강생이 없습니다.</td></tr>'}
        </tbody></table>
      </div>
      <div class="hint" style="margin-top:12px">출석률은 <b>회차별 출결이 기록된 회차</b> 기준입니다. 공결은 출석으로 인정합니다. 기준(%)은 데이터 탭에서 조정하세요.</div>`;
    $('#certCourse').onchange = (e) => { certCourseId = e.target.value; renderCerts(); };
    el.querySelectorAll('[data-cert]').forEach(b => b.onclick = () => showCert(b.dataset.cert, course.id));
  }
  function showCert(sid, cid) {
    const s = studentById(sid), c = courseById(cid), r = certResult(sid, cid);
    modal('수료증 미리보기', `
      <div class="cert-card" id="certPrint">
        <div class="ct">CERTIFICATE · 수 료 증</div>
        <div class="cn">${esc(s.name)}</div>
        <div class="cb">위 사람은 <b>${esc(state.settings.orgName || '네다바웨이')}</b>의<br>「<b>${esc(c.name)}</b>」 과정을 성실히 이수하였기에<br>이 수료증을 수여합니다.<br><span class="muted">출석률 ${r.rate}%</span></div>
        <div class="muted" style="font-size:12px">${today()}</div>
        <div style="margin-top:10px;font-weight:700">${esc(state.settings.orgName || '네다바웨이')}${state.settings.repName ? ' · ' + esc(state.settings.repName) : ''}</div>
      </div>
      <div class="modal-actions"><button class="btn ghost" data-close>닫기</button><button class="btn primary" id="certPrintBtn">🖨 인쇄/PDF 저장</button></div>`);
    $('#certPrintBtn').onclick = () => printCert(s, c, r);
  }
  function printCert(s, c, r) {
    const w = window.open('', '_blank');
    if (!w) { toast('팝업이 차단되었습니다'); return; }
    w.document.write(`<html><head><meta charset="utf-8"><title>수료증_${esc(s.name)}</title><style>body{font-family:'Noto Serif KR',serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.c{border:6px double #6b4423;border-radius:14px;padding:60px 80px;text-align:center;max-width:560px}.t{letter-spacing:8px;color:#8a5a2b;font-size:14px}.n{font-size:38px;font-weight:800;margin:20px 0}.b{font-size:16px;line-height:2.2;margin:20px 0}.o{margin-top:24px;font-weight:700;font-size:18px}</style></head><body><div class="c"><div class="t">CERTIFICATE · 수 료 증</div><div class="n">${esc(s.name)}</div><div class="b">위 사람은 <b>${esc(state.settings.orgName || '네다바웨이')}</b>의<br>「<b>${esc(c.name)}</b>」 과정을 성실히 이수하였기에 이 수료증을 수여합니다.<br>출석률 ${r.rate}%</div><div>${today()}</div><div class="o">${esc(state.settings.orgName || '네다바웨이')}${state.settings.repName ? ' · ' + esc(state.settings.repName) : ''}</div></div><script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  /* ---------- 공용 UI ---------- */
  function headed(t) { return `<div class="section-head"><h2>${t}</h2></div>`; }
  function optionList(map, sel) { return Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === String(sel) ? 'selected' : ''}>${esc(v)}</option>`).join(''); }
  function modal(title, html) {
    $('#modalTitle').textContent = title; $('#modalBody').innerHTML = html;
    $('#modalBackdrop').hidden = false;
    $('#modalBody').querySelectorAll('[data-close]').forEach(b => b.onclick = closeModal);
  }
  function closeModal() { $('#modalBackdrop').hidden = true; $('#modalBody').innerHTML = ''; }
  const today = () => new Date().toISOString().slice(0, 10);
  let dr = null; function debounceRender() { clearTimeout(dr); dr = setTimeout(renderStudents, 200); }
  function reattachSeq() { try { Object.defineProperty(state, 'seq', { get() { return this.meta.seq; }, set(v) { this.meta.seq = v; }, configurable: true }); } catch (e) {} }

  /* ---------- 샘플 데이터 ---------- */
  function sample() {
    const d = blank();
    const cNames = ['말씀묵상 기초 1강', '말씀묵상 심화 2강', '청소년 리더십 3강', '정체성 습관설계 4강', 'AI 작업실 5강', '관점노트 6강'];
    d.courses = cNames.map((n, i) => ({ id: 'co_s' + i, name: n, color: COURSE_COLORS[i], capacity: 20, memo: '', sessions: sampleSessions(i) }));
    const names = ['김소망', '이믿음', '박사랑', '최기쁨', '정평강', '한은혜', '오진리', '윤빛나', '장다윗', '서한나', '문요셉', '배루디아'];
    const fees = [50000, 80000, 100000, 120000];
    d.students = names.map((nm, i) => {
      const pick = []; const num = (i % 4) + 1; // 1~4개 신청
      for (let k = 0; k < num; k++) pick.push(d.courses[(i + k) % 6].id);
      const fee = fees[i % 4] * num / ((i % 4) + 1); const feeAmount = 30000 * num;
      // 입금 상태 다양화: 완납/부분/미납/면제
      const payVariant = i % 4;
      const paidAmount = payVariant === 0 ? feeAmount : payVariant === 1 ? Math.round(feeAmount / 2) : payVariant === 3 ? 0 : 0;
      const payStatus = payVariant === 0 ? 'paid' : payVariant === 1 ? 'partial' : payVariant === 2 ? 'unpaid' : (i === 3 ? 'exempt' : 'unpaid');
      return { id: 'st_s' + i, name: nm, phone: '010-' + (1000 + i * 7).toString().padStart(4, '0') + '-' + (2000 + i * 13).toString().slice(0, 4), email: 'user' + i + '@example.com', kakao: '', memo: i % 5 === 0 ? '재수강' : '', courseIds: pick, tags: i % 5 === 0 ? ['재수강'] : (i % 6 === 0 ? ['VIP'] : []), status: ['confirmed', 'confirmed', 'applied', 'waitlist'][i % 4], feeAmount, paidAmount, payStatus, consent: i % 7 !== 0, appliedAt: new Date().toISOString() };
    });
    // 출석 샘플: 첫 강좌 1회차
    const c0 = d.courses[0]; const day = (c0.sessions[0]);
    if (day) { const rec = {}; d.students.filter(s => s.courseIds.includes(c0.id)).forEach((s, i) => rec[s.id] = ['present', 'present', 'late', 'absent'][i % 4]); d.attendance[c0.id + '::' + day] = rec; }
    // 후원자 샘플
    d.donors = [
      { id: 'dn_0', name: '이든든', phone: '010-2222-0001', type: 'regular', amount: 30000, received: 360000, cycle: '매월', date: today().slice(0, 7) + '-05', status: 'active', memo: '' },
      { id: 'dn_1', name: '박한결', phone: '010-2222-0002', type: 'regular', amount: 50000, received: 600000, cycle: '매월', date: today().slice(0, 7) + '-03', status: 'active', memo: '' },
      { id: 'dn_2', name: '최소망', phone: '010-2222-0003', type: 'onetime', amount: 100000, received: 100000, cycle: '일시', date: today().slice(0, 7) + '-10', status: 'active', memo: '개강 축하' },
      { id: 'dn_3', name: '정온유', phone: '010-2222-0004', type: 'regular', amount: 20000, received: 40000, cycle: '매월', date: '2026-03-05', status: 'lapsed', memo: '3월 이후 중단' }
    ];
    // 문의 샘플
    d.inquiries = [
      { id: 'iq_0', from: '@jeju_mom', channel: 'insta', contact: '', body: '6개 강좌 중 2개만 들어도 되나요? 시간표가 궁금해요.', memo: '', status: 'new', date: today() },
      { id: 'iq_1', from: '김문의', channel: 'kakao', contact: '010-3333-0002', body: '수강료 분납 가능한지요?', memo: '분납 안내 예정', status: 'progress', date: today() },
      { id: 'iq_2', from: '이완료', channel: 'email', contact: 'done@example.com', body: '환불 규정 문의', memo: '규정 안내 완료', status: 'done', date: '2026-07-20' }
    ];
    // 할일 샘플
    d.todos = [
      { id: 'td_0', title: '3주차 강의자료 업로드', due: today(), done: false },
      { id: 'td_1', title: '미납자 입금 안내 발송', due: addDays(2), done: false },
      { id: 'td_2', title: '월말 정산 마감', due: addDays(7), done: false },
      { id: 'td_3', title: '개강 안내 문자 발송', due: addDays(-2), done: true }
    ];
    // 장부 샘플
    d.ledger = [
      { id: 'lg_0', type: 'expense', date: today().slice(0, 7) + '-02', title: '강의실 대관료', category: '대관', amount: 150000 },
      { id: 'lg_1', type: 'expense', date: today().slice(0, 7) + '-04', title: '교재 인쇄', category: '인쇄', amount: 80000 },
      { id: 'lg_2', type: 'income', date: today().slice(0, 7) + '-06', title: '외부 특강료', category: '강의', amount: 300000 }
    ];
    return d;
  }
  function addDays(n) { return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10); }
  function sampleSessions(i) {
    // 오늘 기준 과거·미래 회차 몇 개 (고정 계산, 랜덤 미사용)
    const base = new Date(); const out = [];
    for (let k = -1; k <= 2; k++) { const dt = new Date(base.getTime() + (k * 7 + i) * 86400000); out.push(dt.toISOString().slice(0, 10)); }
    return out;
  }

  /* ---------- PIN 잠금 ---------- */
  let unlocked = false;
  function updateLockBtn() { $('#lockBtn').hidden = !(state.settings.pin); }
  function showLock() {
    if (!state.settings.pin) { unlocked = true; $('#lockScreen').hidden = true; return; }
    unlocked = false; $('#lockScreen').hidden = false; $('#lockErr').hidden = true;
    const pin = $('#lockPin'); pin.value = ''; setTimeout(() => pin.focus(), 50);
  }
  function tryUnlock() {
    if ($('#lockPin').value === state.settings.pin) { unlocked = true; $('#lockScreen').hidden = true; render(); }
    else { $('#lockErr').textContent = 'PIN이 일치하지 않습니다.'; $('#lockErr').hidden = false; $('#lockPin').value = ''; $('#lockPin').focus(); }
  }
  $('#lockSubmit').onclick = tryUnlock;
  $('#lockPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });
  $('#lockBtn').onclick = showLock;

  /* ---------- 부팅 ---------- */
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#modalClose').onclick = closeModal;
  $('#modalBackdrop').onclick = (e) => { if (e.target.id === 'modalBackdrop') closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  updateLockBtn();
  render();
  if (state.settings.pin) showLock();
})();
