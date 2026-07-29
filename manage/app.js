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
      meta: { version: 1, seq: 1 },
      settings: { orgName: '네다바웨이', surveyUrl: '', senderName: '네다바웨이 운영팀' },
      courses: [],
      students: [],
      attendance: {},      // "courseId::date": { studentId: 'present'|... }
      templates: defaultTemplates()
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
        body: '[{기관명}] {이름}님, 「{강좌목록}」 수고 많으셨습니다. 더 좋은 강의를 위해 설문 부탁드려요 🙏\n{설문링크}' }
    ];
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const d = JSON.parse(raw);
      d.meta = d.meta || { version: 1, seq: 1 };
      d.settings = Object.assign({ orgName: '네다바웨이', surveyUrl: '', senderName: '네다바웨이 운영팀' }, d.settings || {});
      d.courses = d.courses || []; d.students = d.students || [];
      d.attendance = d.attendance || {}; d.templates = d.templates && d.templates.length ? d.templates : defaultTemplates();
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

  /* ============================ 렌더링 ============================ */
  function render() {
    document.getElementById('orgName').textContent = state.settings.orgName || '네다바웨이';
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));
    document.querySelectorAll('.view').forEach(v => v.hidden = v.id !== 'view-' + activeTab);
    ({ dashboard: renderDashboard, students: renderStudents, courses: renderCourses,
       attendance: renderAttendance, segments: renderSegments, messages: renderMessages, data: renderData }[activeTab])();
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

      <div class="grid kpi" style="margin-bottom:14px">
        ${kpi('총 수강생', activeStudents().length, '취소 제외')}
        ${kpi('확정', counts.confirmed, STATUS.applied + ' ' + counts.applied)}
        ${kpi('대기', counts.waitlist, '취소 ' + counts.cancelled)}
        ${kpi('개설 강좌', state.courses.length, '회차 ' + state.courses.reduce((a, c) => a + (c.sessions || []).length, 0) + '개')}
        ${kpi('평균 출석률', attRate == null ? '—' : attRate + '%', '전체 회차 기준')}
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
            <button class="btn" data-go="segments">🔎 결석 많은 수강생 찾기</button>
            <button class="btn" data-go="messages">✉ 안내/설문 메시지 만들기</button>
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
    const s = id ? studentById(id) : { id: '', name: '', phone: '', email: '', kakao: '', memo: '', courseIds: [], status: 'applied', tags: [] };
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
        <label class="field"><span>태그(쉼표로 구분)</span><input type="text" id="m_tags" value="${esc(s.tags.join(', '))}" placeholder="예: VIP, 재수강"></label>
      </div>
      <label class="field"><span>메모</span><textarea id="m_memo">${esc(s.memo || '')}</textarea></label>
      <div class="modal-actions">
        <button class="btn ghost" data-close>취소</button>
        <button class="btn primary" id="m_save">저장</button>
      </div>`);
    $('#m_save').onclick = () => {
      const name = $('#m_name').value.trim();
      if (!name) { toast('이름을 입력하세요'); return; }
      const courseIds = Array.from($('#m_courses').querySelectorAll('input:checked')).map(i => i.value);
      const tags = $('#m_tags').value.split(',').map(t => t.trim()).filter(Boolean);
      const data = { name, phone: $('#m_phone').value.trim(), email: $('#m_email').value.trim(), kakao: $('#m_kakao').value.trim(), status: $('#m_status').value, courseIds, tags, memo: $('#m_memo').value.trim() };
      if (id) { Object.assign(s, data); }
      else { state.students.push(Object.assign({ id: uid('st_'), appliedAt: new Date().toISOString() }, data)); }
      save(); closeModal(); renderStudents();
      toast(id ? '수정되었습니다' : '추가되었습니다');
    };
  }
  function exportStudents() {
    const header = ['이름', '연락처', '이메일', '카카오', '상태', '신청강좌', '신청강좌수', '태그', '결석수', '출석률', '메모', 'appliedAt'];
    const rows = state.students.map(s => [s.name, s.phone, s.email, s.kakao, STATUS[s.status], courseNames(s.courseIds).join(' / '), s.courseIds.length, s.tags.join(' '), absenceCount(s.id), (studentAttStats(s.id).rate ?? ''), s.memo, s.appliedAt]);
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
    const fields = { courseCount: '신청 강좌 수', course: '특정 강좌', status: '상태', absence: '결석 횟수', tag: '태그' };
    const numOps = { '>=': '이상', '=': '정확히', '<=': '이하' };
    let valInput = '';
    if (r.field === 'courseCount' || r.field === 'absence') valInput = `<input type="number" data-v="${i}" value="${esc(r.value)}" min="0" style="max-width:80px"> <span class="muted">${r.field === 'courseCount' ? '개' : '회'}</span>`;
    else if (r.field === 'course') valInput = `<select data-v="${i}">${state.courses.map(c => `<option value="${c.id}" ${r.value === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
    else if (r.field === 'status') valInput = `<select data-v="${i}">${optionList(STATUS, r.value)}</select>`;
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
  function defaultOp(f) { return f === 'course' ? 'has' : (f === 'status' || f === 'tag') ? 'is' : '>='; }
  function defaultVal(f) { return f === 'course' ? (state.courses[0] || {}).id || '' : f === 'status' ? 'confirmed' : f === 'tag' ? '' : 1; }
  function applySegments() {
    return state.students.filter(s => segRules.every(r => matchRule(s, r)));
  }
  function matchRule(s, r) {
    if (r.field === 'courseCount') { const n = s.courseIds.length, v = +r.value; return r.op === '>=' ? n >= v : r.op === '<=' ? n <= v : n === v; }
    if (r.field === 'absence') { const n = absenceCount(s.id), v = +r.value; return r.op === '>=' ? n >= v : r.op === '<=' ? n <= v : n === v; }
    if (r.field === 'course') { const has = s.courseIds.includes(r.value); return r.op === 'has' ? has : !has; }
    if (r.field === 'status') { return r.op === 'is' ? s.status === r.value : s.status !== r.value; }
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
            ${['{이름}', '{강좌명}', '{강좌목록}', '{날짜}', '{회차}', '{설문링크}', '{기관명}'].map(v => `<code data-var="${v}">${v}</code>`).join('')}
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

    $('#saveSet').onclick = () => { state.settings.orgName = $('#setOrg').value.trim() || '네다바웨이'; state.settings.senderName = $('#setSender').value.trim(); state.settings.surveyUrl = $('#setSurvey').value.trim(); save(); render(); toast('설정을 저장했습니다'); };
    $('#expJson').onclick = () => download('네다바웨이_운영백업_' + today() + '.json', JSON.stringify(state, null, 2), 'application/json');
    $('#impJson').onchange = (e) => importJson(e.target.files[0]);
    $('#loadSample').onclick = () => { if (confirm('현재 데이터를 지우고 샘플을 불러올까요?')) { state = sample(); reattachSeq(); save(); toast('샘플을 불러왔습니다'); go('dashboard'); } };
    $('#resetAll').onclick = () => { if (confirm('모든 데이터를 삭제합니다. 되돌릴 수 없습니다. 계속할까요?')) { state = blank(); reattachSeq(); save(); toast('초기화했습니다'); go('dashboard'); } };
    $('#impCsv').onchange = (e) => importCsv(e.target.files[0]);
    $('#csvTemplate').onclick = () => download('접수양식.csv', toCSV([['이름', '연락처', '이메일', '카카오', '강좌', '상태', '메모'], ['홍길동', '010-1234-5678', 'hong@example.com', 'hong_kko', '말씀묵상 1강 / 리더십 2강', '신청', '']]), 'text/csv');
  }
  function importJson(file) {
    if (!file) return; const r = new FileReader();
    r.onload = () => { try { const d = JSON.parse(r.result); if (!d.students) throw 0; state = d; reattachSeq(); state.settings = Object.assign({ orgName: '네다바웨이' }, state.settings); state.templates = state.templates && state.templates.length ? state.templates : defaultTemplates(); save(); toast('복원했습니다'); go('dashboard'); } catch (e) { toast('올바른 백업 파일이 아닙니다'); } };
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
    d.students = names.map((nm, i) => {
      const pick = []; const num = (i % 4) + 1; // 1~4개 신청
      for (let k = 0; k < num; k++) pick.push(d.courses[(i + k) % 6].id);
      return { id: 'st_s' + i, name: nm, phone: '010-' + (1000 + i * 7).toString().padStart(4, '0') + '-' + (2000 + i * 13).toString().slice(0, 4), email: 'user' + i + '@example.com', kakao: '', memo: i % 5 === 0 ? '재수강' : '', courseIds: pick, tags: i % 5 === 0 ? ['재수강'] : (i % 6 === 0 ? ['VIP'] : []), status: ['confirmed', 'confirmed', 'applied', 'waitlist'][i % 4], appliedAt: new Date().toISOString() };
    });
    // 출석 샘플: 첫 강좌 1회차
    const c0 = d.courses[0]; const day = (c0.sessions[0]);
    if (day) { const rec = {}; d.students.filter(s => s.courseIds.includes(c0.id)).forEach((s, i) => rec[s.id] = ['present', 'present', 'late', 'absent'][i % 4]); d.attendance[c0.id + '::' + day] = rec; }
    return d;
  }
  function sampleSessions(i) {
    // 오늘 기준 과거·미래 회차 몇 개 (고정 계산, 랜덤 미사용)
    const base = new Date(); const out = [];
    for (let k = -1; k <= 2; k++) { const dt = new Date(base.getTime() + (k * 7 + i) * 86400000); out.push(dt.toISOString().slice(0, 10)); }
    return out;
  }

  /* ---------- 부팅 ---------- */
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#modalClose').onclick = closeModal;
  $('#modalBackdrop').onclick = (e) => { if (e.target.id === 'modalBackdrop') closeModal(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  render();
})();
