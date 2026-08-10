/* =====================================================================
   강의 스튜디오 — 녹음 · 원자화 · 조립  (프론트엔드 전용 / 백엔드 없음)
   -----------------------------------------------------------------
   흐름:  녹음+자막 → 강의원본 저장 → 클로드로 원자화(JSON) → 아톰 라이브러리
          → 조립대에서 새 강의로 조립·융합
   저장:  IndexedDB (이 브라우저에만 저장). 오디오 blob 포함.
          폰↔노트북 이동은 [데이터] 탭의 JSON 백업 내보내기/가져오기 사용.
   AI:    이미 쓰고 있는 클로드와 "프롬프트 복사 → 답(JSON) 붙여넣기"로 연결.
          (선택) OpenAI 호환 음성인식 API 키를 넣으면 녹음 파일 자동 전사 가능.
   ===================================================================== */
(function () {
  'use strict';

  /* ============================ 상수/유틸 ============================ */
  const DB_NAME = 'lecture-studio';
  const DB_VER = 1;
  const ATOM_TYPES = ['개념', '정의', '사례', '예화', '비유', '통계', '인용', '질문', '적용', '실천', '반론', '전환'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const uid = (p) => (p || 'id_') + Math.random().toString(36).slice(2, 9) + Math.random().toString(36).slice(2, 5);
  const nowISO = () => new Date().toISOString();
  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('ko-KR', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso || ''; } };
  const fmtDay = (iso) => { try { return new Date(iso).toLocaleDateString('ko-KR', { dateStyle: 'medium' }); } catch (e) { return iso || ''; } };
  const clip = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n) + '…' : s; };
  const fmtHMS = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const pad = (x) => String(x).padStart(2, '0');
    return (h > 0 ? h + ':' : '') + pad(m) + ':' + pad(s);
  };
  const fmtBytes = (b) => {
    if (!b) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0; b = Number(b);
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return b.toFixed(b >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
  };

  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(() => { t.hidden = true; }, 2400);
  }
  function saveHint(txt) {
    const h = $('#saveHint'); h.textContent = txt || '저장됨 · ' + new Date().toLocaleTimeString('ko-KR');
    h.classList.add('flash'); clearTimeout(h._t); h._t = setTimeout(() => h.classList.remove('flash'), 1000);
  }
  function copy(text) {
    const ok = () => toast('클립보드에 복사되었습니다');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else fallback();
    function fallback() {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('복사 실패 — 직접 선택해 복사하세요'); }
      document.body.removeChild(ta);
    }
  }
  function download(name, content, type) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: (type || 'text/plain') + ';charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  }

  /* ============================ IndexedDB ============================ */
  let _db = null;
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('lectures')) db.createObjectStore('lectures', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('atoms')) db.createObjectStore('atoms', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(store, mode) { return _db.transaction(store, mode).objectStore(store); }
  function idbReq(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  const dbGet = (store, key) => idbReq(tx(store, 'readonly').get(key));
  const dbAll = (store) => idbReq(tx(store, 'readonly').getAll());
  const dbPut = (store, val) => idbReq(tx(store, 'readwrite').put(val));
  const dbDel = (store, key) => idbReq(tx(store, 'readwrite').delete(key));
  const dbClear = (store) => idbReq(tx(store, 'readwrite').clear());
  async function kvGet(k, dflt) { const r = await dbGet('kv', k); return r ? r.v : dflt; }
  const kvSet = (k, v) => dbPut('kv', { k, v });

  /* ============================ 상태(메모리) ============================ */
  const state = {
    lectures: [],   // {id,title,topic,date,tags[],notes,transcript,durationSec,hasAudio,audioType,createdAt,atomized}
    atoms: [],      // {id,title,type,topic,tags[],summary,content,keypoints[],durationSec,lectureId,lectureTitle,createdAt,star}
    settings: { speaker: '', transcribeUrl: '', transcribeKey: '', transcribeModel: 'whisper-1', anthropicKey: '', anthropicModel: 'claude-opus-4-8' },
    tray: [],       // 조립대에 담긴 atom id 목록(순서)
    ui: { atomQuery: '', atomType: '', atomTopic: '', atomTag: '' }
  };
  let activeTab = 'record';

  async function loadAll() {
    state.lectures = (await dbAll('lectures')) || [];
    state.atoms = (await dbAll('atoms')) || [];
    state.settings = Object.assign(state.settings, (await kvGet('settings', {})) || {});
    state.tray = (await kvGet('tray', [])) || [];
    state.lectures.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    state.atoms.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }
  const saveSettings = () => kvSet('settings', state.settings);
  const saveTray = () => kvSet('tray', state.tray);

  /* ============================ 라우팅/렌더 ============================ */
  const RENDER = {};
  function switchTab(tab) {
    activeTab = tab;
    $$('#tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $$('#views .view').forEach(v => { v.hidden = v.id !== 'view-' + tab; });
    render(tab);
    try { window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' }); } catch (e) { window.scrollTo(0, 0); }
  }
  function render(tab) { (RENDER[tab] || (() => { }))(); }
  function rerenderAtomsRelated() {
    if (activeTab === 'atoms') RENDER.atoms();
    if (activeTab === 'compose') RENDER.compose();
    if (activeTab === 'record') RENDER.record();
    if (activeTab === 'lectures') RENDER.lectures();
  }

  /* ============================ 모달 ============================ */
  function openModal(title, bodyHTML, onMount) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = bodyHTML;
    $('#modalBackdrop').hidden = false;
    if (onMount) onMount($('#modalBody'));
  }
  function closeModal() { $('#modalBackdrop').hidden = true; $('#modalBody').innerHTML = ''; }

  /* ============================ 녹음 엔진 ============================ */
  const rec = {
    stream: null, mediaRecorder: null, chunks: [], startTs: 0, elapsedBefore: 0,
    timerId: 0, state: 'idle', // idle|recording|paused
    // Web Speech
    recog: null, speechOn: false, finalText: '', interimText: '',
    // level meter
    audioCtx: null, analyser: null, rafId: 0, mimeType: ''
  };

  function speechSupported() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }

  function pickMime() {
    const cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
    if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
      for (const c of cands) if (MediaRecorder.isTypeSupported(c)) return c;
    }
    return '';
  }

  async function startRecording() {
    try {
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, channelCount: 1 } });
    } catch (e) {
      toast('마이크 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.');
      return;
    }
    rec.mimeType = pickMime();
    rec.chunks = [];
    try {
      rec.mediaRecorder = rec.mimeType ? new MediaRecorder(rec.stream, { mimeType: rec.mimeType }) : new MediaRecorder(rec.stream);
    } catch (e) {
      rec.mediaRecorder = new MediaRecorder(rec.stream);
    }
    rec.mediaRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    rec.mediaRecorder.start(1000);
    rec.startTs = Date.now(); rec.elapsedBefore = 0; rec.state = 'recording';
    startTimer(); startLevelMeter();
    if ($('#liveSpeechToggle') && $('#liveSpeechToggle').checked) startSpeech();
    RENDER.record();
  }
  function pauseRecording() {
    if (rec.state !== 'recording') return;
    try { rec.mediaRecorder.pause(); } catch (e) { }
    rec.elapsedBefore += (Date.now() - rec.startTs) / 1000;
    rec.state = 'paused'; stopTimer(); stopSpeech(true);
    RENDER.record();
  }
  function resumeRecording() {
    if (rec.state !== 'paused') return;
    try { rec.mediaRecorder.resume(); } catch (e) { }
    rec.startTs = Date.now(); rec.state = 'recording'; startTimer();
    if ($('#liveSpeechToggle') && $('#liveSpeechToggle').checked) startSpeech();
    RENDER.record();
  }
  function currentElapsed() {
    return rec.elapsedBefore + (rec.state === 'recording' ? (Date.now() - rec.startTs) / 1000 : 0);
  }
  function startTimer() {
    stopTimer();
    rec.timerId = setInterval(() => { const el = $('#recTime'); if (el) el.textContent = fmtHMS(currentElapsed()); }, 250);
  }
  function stopTimer() { if (rec.timerId) { clearInterval(rec.timerId); rec.timerId = 0; } }

  function startLevelMeter() {
    try {
      rec.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = rec.audioCtx.createMediaStreamSource(rec.stream);
      rec.analyser = rec.audioCtx.createAnalyser(); rec.analyser.fftSize = 512;
      src.connect(rec.analyser);
      const data = new Uint8Array(rec.analyser.frequencyBinCount);
      const tick = () => {
        if (!rec.analyser) return;
        rec.analyser.getByteTimeDomainData(data);
        let sum = 0; for (let i = 0; i < data.length; i++) { const v = (data[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / data.length);
        const bar = $('#levelBar'); if (bar) bar.style.width = Math.min(100, Math.round(rms * 260)) + '%';
        rec.rafId = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { /* level meter optional */ }
  }
  function stopLevelMeter() {
    if (rec.rafId) cancelAnimationFrame(rec.rafId); rec.rafId = 0;
    if (rec.audioCtx) { try { rec.audioCtx.close(); } catch (e) { } rec.audioCtx = null; }
    rec.analyser = null; const bar = $('#levelBar'); if (bar) bar.style.width = '0';
  }

  /* --- Web Speech 실시간 자막 --- */
  function startSpeech() {
    if (!speechSupported()) return;
    if (rec.recog) return; // already running
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.lang = 'ko-KR'; r.continuous = true; r.interimResults = true; r.maxAlternatives = 1;
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i];
        if (res.isFinal) rec.finalText += (rec.finalText && !/\s$/.test(rec.finalText) ? ' ' : '') + res[0].transcript.trim();
        else interim += res[0].transcript;
      }
      rec.interimText = interim;
      paintLiveCaption();
    };
    r.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') { rec.speechOn = false; toast('실시간 자막 권한이 거부되었습니다'); }
    };
    r.onend = () => {
      // 녹음 중이면 자동 재시작(연속 인식)
      if (rec.speechOn && rec.state === 'recording') { try { r.start(); } catch (e) { } }
      else { rec.recog = null; }
    };
    try { r.start(); rec.recog = r; rec.speechOn = true; } catch (e) { rec.recog = null; }
  }
  function stopSpeech(keep) {
    rec.speechOn = false;
    if (rec.recog) { try { rec.recog.stop(); } catch (e) { } rec.recog = null; }
    if (!keep) rec.interimText = '';
    paintLiveCaption();
  }
  function paintLiveCaption() {
    const box = $('#liveCap'); if (!box) return;
    box.innerHTML = esc(rec.finalText) + (rec.interimText ? ' <span class="interim">' + esc(rec.interimText) + '</span>' : '');
    box.scrollTop = box.scrollHeight;
  }

  async function stopRecording() {
    if (rec.state === 'idle') return;
    const wasElapsed = currentElapsed();
    stopTimer(); stopSpeech(true); stopLevelMeter();
    const mr = rec.mediaRecorder;
    const finalize = async () => {
      const type = rec.mimeType || (rec.chunks[0] && rec.chunks[0].type) || 'audio/webm';
      const blob = rec.chunks.length ? new Blob(rec.chunks, { type }) : null;
      // stream 정리
      if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
      const transcript = (rec.finalText || '').trim();
      // 상태 리셋(자막 텍스트 보존 후)
      await saveNewLecture({ blob, type, durationSec: Math.round(wasElapsed), transcript });
      rec.state = 'idle'; rec.mediaRecorder = null; rec.chunks = []; rec.stream = null;
      rec.finalText = ''; rec.interimText = ''; rec.elapsedBefore = 0;
      RENDER.record();
    };
    if (mr && mr.state !== 'inactive') { mr.onstop = finalize; try { mr.stop(); } catch (e) { finalize(); } }
    else finalize();
  }

  async function saveNewLecture({ blob, type, durationSec, transcript }) {
    const titleGuess = ($('#recTitle') && $('#recTitle').value.trim()) || '';
    const id = uid('lec_');
    const lecture = {
      id,
      title: titleGuess || ('강의 ' + fmtDay(nowISO())),
      topic: ($('#recTopic') && $('#recTopic').value.trim()) || '',
      date: ($('#recDate') && $('#recDate').value) || nowISO().slice(0, 10),
      tags: parseTags($('#recTags') && $('#recTags').value),
      notes: ($('#recNotes') && $('#recNotes').value.trim()) || '',
      transcript: transcript || '',
      durationSec: durationSec || 0,
      hasAudio: !!blob, audioType: type || '',
      speaker: state.settings.speaker || '',
      createdAt: nowISO(),
      atomized: false
    };
    await dbPut('lectures', lecture);
    if (blob) await dbPut('audio', { id, blob });
    state.lectures.unshift(lecture);
    saveHint('강의 원본 저장됨');
    toast('강의 원본이 저장되었습니다 → [강의원본] 탭에서 확인·원자화');
    // 입력폼 초기화
    ['recTitle', 'recTopic', 'recTags', 'recNotes'].forEach(idn => { const el = $('#' + idn); if (el) el.value = ''; });
  }
  function parseTags(s) {
    return String(s || '').split(/[,#\n]/).map(x => x.trim()).filter(Boolean).slice(0, 20);
  }

  /* ============================ 뷰: 녹음 ============================ */
  RENDER.record = function () {
    const v = $('#view-record');
    const recording = rec.state === 'recording', paused = rec.state === 'paused', active = recording || paused;
    const spSup = speechSupported();
    v.innerHTML = `
      <div class="view-head">
        <div><h1>녹음</h1><p class="lead">무선마이크로 강의하는 소리를 노트북 마이크로 녹음합니다. 지원 브라우저에선 실시간 자막도 함께 기록됩니다.</p></div>
      </div>

      <div class="card">
        <div class="grid cols-2">
          <div><label class="field">강의 제목</label><input type="text" id="recTitle" placeholder="예) 로마서 8장 — 성령의 인도" ${active ? '' : ''}></div>
          <div><label class="field">주제/시리즈</label><input type="text" id="recTopic" placeholder="예) 로마서 강해"></div>
          <div><label class="field">날짜</label><input type="text" id="recDate" value="${esc(nowISO().slice(0, 10))}" placeholder="YYYY-MM-DD"></div>
          <div><label class="field">태그(쉼표로 구분)</label><input type="text" id="recTags" placeholder="예) 성령, 자유, 양자됨"></div>
        </div>
        <div style="margin-top:10px"><label class="field">메모(강의 전 개요·의도)</label><textarea id="recNotes" placeholder="이 강의에서 다루려는 핵심, 대상, 흐름을 적어두면 원자화 품질이 좋아집니다."></textarea></div>
      </div>

      <div class="card rec-hero">
        <div class="rec-time" id="recTime">${fmtHMS(currentElapsed())}</div>
        <div class="level"><i id="levelBar"></i></div>
        <div class="row" style="justify-content:center">
          ${!active ? `<button class="rec-btn" id="btnStart">● 녹음 시작</button>` : ''}
          ${recording ? `<button class="btn" id="btnPause">⏸ 일시정지</button>` : ''}
          ${paused ? `<button class="btn green" id="btnResume">▶ 재개</button>` : ''}
          ${active ? `<button class="rec-btn recording" id="btnStop">■ 정지·저장</button>` : ''}
        </div>
        <label class="row small" style="gap:6px; justify-content:center">
          <input type="checkbox" id="liveSpeechToggle" ${spSup ? 'checked' : 'disabled'} style="width:auto">
          실시간 자막(음성→텍스트) ${spSup ? '' : '— 이 브라우저는 미지원'}
        </label>
        ${!spSup ? `<div class="rec-warn">iOS Safari 등은 실시간 자막을 지원하지 않습니다. 녹음은 정상 저장되며, 저장 후 [강의원본]에서 클로드/전사API로 텍스트를 채울 수 있습니다.</div>` : ''}
        <div class="live-cap" id="liveCap" aria-live="polite">${active ? '' : '<span class="interim">여기에 말한 내용이 실시간으로 표시됩니다…</span>'}</div>
      </div>

      <div class="card">
        <div class="steps">
          <span><b>1</b> 녹음</span> ›
          <span><b>2</b> 강의원본에서 원자화(클로드)</span> ›
          <span><b>3</b> 아톰 라이브러리에 분류 저장</span> ›
          <span><b>4</b> 조립대에서 새 강의로 융합</span>
        </div>
      </div>`;

    if (active) paintLiveCaption();
    const on = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    on('btnStart', 'click', startRecording);
    on('btnStop', 'click', stopRecording);
    on('btnPause', 'click', pauseRecording);
    on('btnResume', 'click', resumeRecording);
    on('liveSpeechToggle', 'change', (e) => {
      if (rec.state === 'recording') { if (e.target.checked) startSpeech(); else stopSpeech(true); }
    });
  };

  /* ============================ 뷰: 강의원본 ============================ */
  RENDER.lectures = function () {
    const v = $('#view-lectures');
    const list = state.lectures;
    v.innerHTML = `
      <div class="view-head">
        <div><h1>강의 원본</h1><p class="lead">녹음·자막이 저장된 원본. 여기서 클로드로 <b>원자화</b>하면 아톰이 생성됩니다.</p></div>
        <div><button class="btn sm" id="btnImportLecture">＋ 텍스트로 추가</button></div>
      </div>
      ${list.length === 0 ? `<div class="empty">아직 강의 원본이 없습니다. <br>[녹음] 탭에서 녹음하거나, 위 <b>＋ 텍스트로 추가</b>로 기존 원고/자막을 붙여넣어 시작하세요.</div>`
        : `<div class="grid cols-2" id="lecList"></div>`}`;

    $('#btnImportLecture').addEventListener('click', openImportLecture);
    if (!list.length) return;
    const wrap = $('#lecList');
    list.forEach(L => {
      const el = document.createElement('div'); el.className = 'item';
      const atomCount = state.atoms.filter(a => a.lectureId === L.id).length;
      el.innerHTML = `
        <div class="it-top">
          <div>
            <h3>${esc(L.title)}</h3>
            <div class="meta">${esc(L.topic || '주제 미지정')} · ${esc(L.date || fmtDay(L.createdAt))} · ${fmtHMS(L.durationSec)} ${L.hasAudio ? '· 🎧' : ''}</div>
          </div>
          <div class="right badge">${atomCount ? atomCount + ' 아톰' : (L.transcript ? '자막 있음' : '자막 없음')}</div>
        </div>
        ${L.tags && L.tags.length ? `<div class="tagrow">${L.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="excerpt">${esc(clip(L.transcript || L.notes || '(자막/메모 없음)', 220))}</div>
        <div class="row">
          <button class="btn sm primary" data-act="open" data-id="${L.id}">열기 · 원자화</button>
          ${L.hasAudio ? `<button class="btn sm ghost" data-act="play" data-id="${L.id}">▶ 재생</button>` : ''}
          <button class="btn sm ghost danger right" data-act="del" data-id="${L.id}">삭제</button>
        </div>`;
      wrap.appendChild(el);
    });
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-act]'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.act;
      if (act === 'open') openLecture(id);
      else if (act === 'play') playAudio(id);
      else if (act === 'del') delLecture(id);
    });
  };

  function openImportLecture() {
    openModal('텍스트로 강의 추가', `
      <div class="stack">
        <div class="grid cols-2">
          <div><label class="field">제목</label><input type="text" id="imTitle" placeholder="강의 제목"></div>
          <div><label class="field">주제/시리즈</label><input type="text" id="imTopic" placeholder="주제"></div>
          <div><label class="field">날짜</label><input type="text" id="imDate" value="${esc(nowISO().slice(0,10))}"></div>
          <div><label class="field">태그(쉼표)</label><input type="text" id="imTags" placeholder="태그1, 태그2"></div>
        </div>
        <div><label class="field">원고/자막 텍스트</label><textarea id="imText" style="min-height:200px" placeholder="강의 원고나 전사된 자막을 붙여넣으세요."></textarea></div>
        <div class="row"><button class="btn primary" id="imSave">저장</button><button class="btn ghost" id="imCancel">취소</button></div>
      </div>`, () => {
      $('#imCancel').addEventListener('click', closeModal);
      $('#imSave').addEventListener('click', async () => {
        const txt = $('#imText').value.trim();
        if (!txt && !$('#imTitle').value.trim()) { toast('제목이나 본문을 입력하세요'); return; }
        const id = uid('lec_');
        const L = {
          id, title: $('#imTitle').value.trim() || ('강의 ' + fmtDay(nowISO())),
          topic: $('#imTopic').value.trim(), date: $('#imDate').value || nowISO().slice(0, 10),
          tags: parseTags($('#imTags').value), notes: '', transcript: txt, durationSec: 0,
          hasAudio: false, audioType: '', speaker: state.settings.speaker || '', createdAt: nowISO(), atomized: false
        };
        await dbPut('lectures', L); state.lectures.unshift(L);
        closeModal(); saveHint('추가됨'); RENDER.lectures();
      });
    });
  }

  async function playAudio(id) {
    const a = await dbGet('audio', id);
    if (!a || !a.blob) { toast('오디오가 없습니다'); return; }
    const url = URL.createObjectURL(a.blob);
    const L = state.lectures.find(x => x.id === id) || {};
    openModal('재생 — ' + (L.title || ''), `
      <div class="stack">
        <audio controls autoplay style="width:100%" src="${url}"></audio>
        <div class="row"><button class="btn sm" id="dlAudio">오디오 파일 다운로드</button><span class="muted small">형식: ${esc(L.audioType || 'audio')}</span></div>
      </div>`, () => {
      $('#dlAudio').addEventListener('click', () => {
        const ext = (L.audioType || '').includes('mp4') ? 'm4a' : (L.audioType || '').includes('ogg') ? 'ogg' : 'webm';
        download((L.title || 'lecture').replace(/[^\w가-힣\- ]/g, '') + '.' + ext, a.blob);
      });
    });
    $('#modalBackdrop').addEventListener('click', function h(e) {
      if (e.target === $('#modalBackdrop') || e.target.id === 'modalClose') { URL.revokeObjectURL(url); $('#modalBackdrop').removeEventListener('click', h); }
    });
  }

  async function delLecture(id) {
    const L = state.lectures.find(x => x.id === id);
    if (!confirm(`"${L ? L.title : ''}" 원본을 삭제할까요? (연결된 아톰은 유지됩니다)`)) return;
    await dbDel('lectures', id); await dbDel('audio', id);
    state.lectures = state.lectures.filter(x => x.id !== id);
    saveHint('삭제됨'); RENDER.lectures();
  }

  /* ---------- 강의 상세 + 원자화 ---------- */
  function openLecture(id) {
    const L = state.lectures.find(x => x.id === id); if (!L) return;
    const atoms = state.atoms.filter(a => a.lectureId === id);
    openModal(L.title, `
      <div class="stack">
        <div class="grid cols-2">
          <div><label class="field">제목</label><input type="text" id="lecTitle" value="${esc(L.title)}"></div>
          <div><label class="field">주제/시리즈</label><input type="text" id="lecTopic" value="${esc(L.topic || '')}"></div>
          <div><label class="field">날짜</label><input type="text" id="lecDate" value="${esc(L.date || '')}"></div>
          <div><label class="field">태그(쉼표)</label><input type="text" id="lecTags" value="${esc((L.tags || []).join(', '))}"></div>
        </div>
        <div><label class="field">자막/원고 (편집 가능)</label><textarea id="lecTranscript" style="min-height:180px">${esc(L.transcript || '')}</textarea></div>
        <div class="row">
          <button class="btn sm primary" id="lecSave">변경 저장</button>
          ${L.hasAudio ? `<button class="btn sm ghost" id="lecPlay">▶ 오디오</button>` : ''}
          ${state.settings.transcribeUrl && L.hasAudio ? `<button class="btn sm ghost" id="lecTranscribe">🎙 전사 API로 채우기</button>` : ''}
        </div>

        <div class="card" style="box-shadow:none">
          <div class="row spread">
            <strong>원자화 — 클로드로 지식 아톰 만들기</strong>
            <span class="badge">${atoms.length} 아톰 생성됨</span>
          </div>
          <p class="muted small" style="margin:6px 0 10px">아래 <b>① 프롬프트 복사</b> → 클로드에 붙여넣기 → 나온 JSON을 <b>② 붙여넣기</b> 하면 아톰이 자동 생성·분류됩니다. ${state.settings.anthropicKey ? '(API 키가 있어 <b>자동 실행</b>도 가능합니다.)' : ''}</p>
          <div class="row">
            <button class="btn sm primary" id="atomPrompt">① 원자화 프롬프트 복사</button>
            <button class="btn sm" id="atomPaste">② 클로드 답(JSON) 붙여넣기</button>
            ${state.settings.anthropicKey ? `<button class="btn sm green" id="atomAuto">⚡ 자동 원자화</button>` : ''}
          </div>
        </div>

        <button class="btn ghost danger sm" id="lecDel">이 강의 원본 삭제</button>
      </div>`, () => {
      const save = async (silent) => {
        L.title = $('#lecTitle').value.trim() || L.title;
        L.topic = $('#lecTopic').value.trim();
        L.date = $('#lecDate').value.trim();
        L.tags = parseTags($('#lecTags').value);
        L.transcript = $('#lecTranscript').value;
        await dbPut('lectures', L);
        if (!silent) { saveHint('강의 저장됨'); toast('저장되었습니다'); }
      };
      $('#lecSave').addEventListener('click', () => save(false).then(() => { RENDER.lectures(); }));
      const play = $('#lecPlay'); if (play) play.addEventListener('click', () => playAudio(L.id));
      const tr = $('#lecTranscribe'); if (tr) tr.addEventListener('click', () => transcribeViaAPI(L));
      $('#lecDel').addEventListener('click', () => { closeModal(); delLecture(L.id); });
      $('#atomPrompt').addEventListener('click', async () => { await save(true); copy(buildAtomizePrompt(L)); });
      $('#atomPaste').addEventListener('click', async () => { await save(true); openAtomPaste(L); });
      const auto = $('#atomAuto'); if (auto) auto.addEventListener('click', async () => { await save(true); autoAtomize(L, auto); });
    });
  }

  /* ============================ 원자화 프롬프트/파싱 ============================ */
  function buildAtomizePrompt(L) {
    const meta = [
      L.title ? `강의 제목: ${L.title}` : '',
      L.topic ? `주제/시리즈: ${L.topic}` : '',
      L.date ? `날짜: ${L.date}` : '',
      (L.tags && L.tags.length) ? `태그: ${L.tags.join(', ')}` : '',
      L.notes ? `강의 의도 메모: ${L.notes}` : ''
    ].filter(Boolean).join('\n');
    const body = (L.transcript || L.notes || '').trim();
    return `당신은 강의 내용을 재사용 가능한 "지식 아톰"으로 분해하는 편집자입니다.
아래 강의 원문을 읽고, 나중에 다른 강의로 재조립할 수 있도록 의미 단위로 쪼개(원자화) 주세요.

[규칙]
- 각 아톰은 그 자체로 이해되는 자기완결적 단위여야 합니다(맥락 없이도 읽힘).
- 한 아톰 = 하나의 생각/사례/예화/정의/적용. 너무 잘게 쪼개지 말고, 재사용 가능한 크기로.
- type은 다음 중 하나: ${ATOM_TYPES.join(', ')}.
- content는 강의에서 실제로 말한 내용을 다듬어 그대로 담되(왜곡 금지), 군더더기·중복은 제거.
- topic은 이 아톰이 속한 상위 주제(짧게). tags는 검색용 키워드 2~5개.
- summary는 한 문장 요지. keypoints는 핵심 bullet 1~4개.
- 오직 JSON만 출력하세요. 코드펜스나 설명 문장 없이 아래 스키마 그대로.

[출력 스키마]
{"atoms":[{"title":"짧은 제목","type":"개념","topic":"상위주제","tags":["키워드"],"summary":"한 문장 요지","content":"자기완결적 본문","keypoints":["핵심"],"durationSec":60}]}

[강의 메타]
${meta || '(없음)'}

[강의 원문]
${body || '(원문 없음 — 메타만 보고 최선을 다해 추정하지 말고, 원문이 없다고 답하세요.)'}`;
  }

  function extractJSON(text) {
    if (!text) return null;
    let t = String(text).trim();
    // 코드펜스 제거
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) t = fence[1].trim();
    // 직접 파싱 시도
    try { return JSON.parse(t); } catch (e) { }
    // 첫 { ~ 마지막 } 구간
    const s = t.indexOf('{'), e2 = t.lastIndexOf('}');
    if (s >= 0 && e2 > s) { try { return JSON.parse(t.slice(s, e2 + 1)); } catch (e) { } }
    // 배열 형태
    const as = t.indexOf('['), ae = t.lastIndexOf(']');
    if (as >= 0 && ae > as) { try { const arr = JSON.parse(t.slice(as, ae + 1)); return { atoms: arr }; } catch (e) { } }
    return null;
  }

  function normalizeAtoms(parsed, L) {
    let arr = [];
    if (Array.isArray(parsed)) arr = parsed;
    else if (parsed && Array.isArray(parsed.atoms)) arr = parsed.atoms;
    else return [];
    const out = [];
    arr.forEach(a => {
      if (!a || (!a.content && !a.title && !a.summary)) return;
      let type = String(a.type || '개념').trim();
      if (!ATOM_TYPES.includes(type)) type = '개념';
      out.push({
        id: uid('atom_'),
        title: String(a.title || clip(a.summary || a.content || '아톰', 40)).trim(),
        type,
        topic: String(a.topic || L.topic || '').trim(),
        tags: Array.isArray(a.tags) ? a.tags.map(x => String(x).trim()).filter(Boolean).slice(0, 8)
          : parseTags(a.tags),
        summary: String(a.summary || '').trim(),
        content: String(a.content || a.summary || '').trim(),
        keypoints: Array.isArray(a.keypoints) ? a.keypoints.map(x => String(x).trim()).filter(Boolean).slice(0, 8) : [],
        durationSec: Number(a.durationSec) || 0,
        lectureId: L.id, lectureTitle: L.title,
        createdAt: nowISO(), star: false
      });
    });
    return out;
  }

  async function commitAtoms(atoms, L) {
    for (const a of atoms) { await dbPut('atoms', a); state.atoms.unshift(a); }
    if (atoms.length) { L.atomized = true; await dbPut('lectures', L); }
    saveHint(atoms.length + '개 아톰 저장됨');
  }

  function openAtomPaste(L) {
    openModal('클로드 답(JSON) 붙여넣기 — ' + L.title, `
      <div class="stack">
        <p class="muted small">클로드가 준 JSON(또는 코드블록째)을 그대로 붙여넣고 <b>가져오기</b>를 누르세요.</p>
        <textarea id="jsonIn" class="mono" style="min-height:220px" placeholder='{"atoms":[ ... ]}'></textarea>
        <div id="jsonPreview" class="callout" hidden></div>
        <div class="row">
          <button class="btn primary" id="jsonImport">가져오기</button>
          <button class="btn ghost" id="jsonCancel">취소</button>
        </div>
      </div>`, () => {
      $('#jsonCancel').addEventListener('click', closeModal);
      $('#jsonImport').addEventListener('click', async () => {
        const parsed = extractJSON($('#jsonIn').value);
        if (!parsed) { toast('JSON을 인식하지 못했습니다. 형식을 확인하세요.'); return; }
        const atoms = normalizeAtoms(parsed, L);
        if (!atoms.length) { toast('유효한 아톰이 없습니다.'); return; }
        await commitAtoms(atoms, L);
        closeModal();
        toast(atoms.length + '개 아톰이 생성되었습니다 → [아톰] 탭');
        if (activeTab === 'atoms') RENDER.atoms();
      });
    });
  }

  /* ---------- (선택) 클로드 API 자동 원자화 ---------- */
  async function autoAtomize(L, btn) {
    const key = state.settings.anthropicKey;
    if (!key) { toast('설정에서 Anthropic API 키를 먼저 입력하세요'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '원자화 중…';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: state.settings.anthropicModel || 'claude-opus-4-8',
          max_tokens: 4096,
          messages: [{ role: 'user', content: buildAtomizePrompt(L) }]
        })
      });
      if (!res.ok) { const t = await res.text(); throw new Error('API ' + res.status + ': ' + clip(t, 200)); }
      const data = await res.json();
      const text = (data.content || []).map(c => c.text || '').join('\n');
      const atoms = normalizeAtoms(extractJSON(text), L);
      if (!atoms.length) throw new Error('아톰을 파싱하지 못했습니다');
      await commitAtoms(atoms, L);
      closeModal(); toast(atoms.length + '개 아톰 자동 생성 완료 → [아톰] 탭');
    } catch (e) {
      toast('자동 원자화 실패: ' + e.message + ' — 프롬프트 복사 방식을 이용하세요');
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- (선택) 전사 API ---------- */
  async function transcribeViaAPI(L) {
    const url = state.settings.transcribeUrl;
    if (!url) { toast('설정에서 전사 API 주소를 입력하세요'); return; }
    const a = await dbGet('audio', L.id);
    if (!a || !a.blob) { toast('오디오가 없습니다'); return; }
    toast('전사 요청 중… 잠시만요');
    try {
      const ext = (L.audioType || '').includes('mp4') ? 'm4a' : (L.audioType || '').includes('ogg') ? 'ogg' : 'webm';
      const fd = new FormData();
      fd.append('file', a.blob, 'audio.' + ext);
      fd.append('model', state.settings.transcribeModel || 'whisper-1');
      fd.append('language', 'ko');
      const headers = {}; if (state.settings.transcribeKey) headers['Authorization'] = 'Bearer ' + state.settings.transcribeKey;
      const res = await fetch(url, { method: 'POST', headers, body: fd });
      if (!res.ok) { const t = await res.text(); throw new Error('API ' + res.status + ': ' + clip(t, 160)); }
      const data = await res.json().catch(() => null);
      const text = data && (data.text || (data.results && data.results.text)) || '';
      if (!text) throw new Error('응답에서 텍스트를 찾지 못했습니다');
      const ta = $('#lecTranscript'); if (ta) ta.value = (ta.value ? ta.value + '\n' : '') + text.trim();
      L.transcript = ta ? ta.value : text.trim(); await dbPut('lectures', L);
      toast('전사 완료 — 자막이 채워졌습니다');
    } catch (e) { toast('전사 실패: ' + e.message); }
  }

  /* ============================ 뷰: 아톰 ============================ */
  RENDER.atoms = function () {
    const v = $('#view-atoms');
    const topics = Array.from(new Set(state.atoms.map(a => a.topic).filter(Boolean))).sort();
    const tags = Array.from(new Set(state.atoms.flatMap(a => a.tags || []))).sort();
    const types = ATOM_TYPES.filter(t => state.atoms.some(a => a.type === t));
    const f = state.ui;
    const filtered = filteredAtoms();

    v.innerHTML = `
      <div class="view-head">
        <div><h1>아톰 라이브러리</h1><p class="lead">강의에서 쪼개진 지식 조각들. 검색·분류하고, 조립대에 담아 재조합합니다.</p></div>
        <div class="badge">${state.atoms.length}개 · 필터 ${filtered.length}개</div>
      </div>

      <div class="card">
        <div class="row">
          <input type="search" id="aQuery" placeholder="🔍 제목·내용·요지 검색" value="${esc(f.atomQuery)}" style="flex:1; min-width:200px">
          <select id="aType" style="width:auto"><option value="">모든 유형</option>${ATOM_TYPES.map(t => `<option ${f.atomType === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
          <select id="aTopic" style="width:auto"><option value="">모든 주제</option>${topics.map(t => `<option ${f.atomTopic === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
        </div>
        ${tags.length ? `<div class="tagrow" style="margin-top:10px">
          <span class="chip ${!f.atomTag ? 'on' : ''}" data-tag="">전체태그</span>
          ${tags.slice(0, 40).map(t => `<span class="chip ${f.atomTag === t ? 'on' : ''}" data-tag="${esc(t)}">#${esc(t)}</span>`).join('')}
        </div>` : ''}
      </div>

      ${state.atoms.length === 0
        ? `<div class="empty">아직 아톰이 없습니다.<br>[강의원본] 탭에서 강의를 열어 <b>원자화</b>하면 여기에 쌓입니다.</div>`
        : (filtered.length === 0 ? `<div class="empty">조건에 맞는 아톰이 없습니다.</div>` : `<div class="grid cols-3" id="atomGrid" style="margin-top:14px"></div>`)}`;

    const bind = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    let qTimer;
    bind('aQuery', 'input', (e) => { clearTimeout(qTimer); qTimer = setTimeout(() => { f.atomQuery = e.target.value; RENDER.atoms(); }, 220); });
    bind('aType', 'change', (e) => { f.atomType = e.target.value; RENDER.atoms(); });
    bind('aTopic', 'change', (e) => { f.atomTopic = e.target.value; RENDER.atoms(); });
    $$('#view-atoms .chip[data-tag]').forEach(c => c.addEventListener('click', () => { f.atomTag = c.dataset.tag; RENDER.atoms(); }));

    const grid = $('#atomGrid'); if (!grid) return;
    filtered.forEach(a => grid.appendChild(atomCardEl(a, true)));
  };

  function filteredAtoms() {
    const f = state.ui; const q = f.atomQuery.trim().toLowerCase();
    return state.atoms.filter(a => {
      if (f.atomType && a.type !== f.atomType) return false;
      if (f.atomTopic && a.topic !== f.atomTopic) return false;
      if (f.atomTag && !(a.tags || []).includes(f.atomTag)) return false;
      if (q) {
        const hay = (a.title + ' ' + a.summary + ' ' + a.content + ' ' + (a.tags || []).join(' ') + ' ' + a.topic).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  function atomCardEl(a, withPick) {
    const el = document.createElement('div');
    const inTray = state.tray.includes(a.id);
    el.className = 'item atom-card' + (inTray ? ' picked' : '');
    el.innerHTML = `
      <div class="atom-type t-${esc(a.type)}">
        <div class="row spread" style="align-items:flex-start">
          <span class="badge"><span class="dot-type" style="background:var(--tc)"></span>${esc(a.type)}</span>
          ${a.star ? '<span title="즐겨찾기">⭐</span>' : ''}
        </div>
        <p class="atom-title">${esc(a.title)}</p>
      </div>
      <div class="excerpt">${esc(clip(a.summary || a.content, 150))}</div>
      ${(a.tags && a.tags.length) ? `<div class="tagrow">${a.tags.slice(0, 4).map(t => `<span class="chip small">#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="meta small">${esc(a.topic || '—')} · ${esc(clip(a.lectureTitle || '', 18))}</div>
      <div class="row">
        ${withPick ? `<button class="btn sm ${inTray ? 'green' : 'primary'}" data-act="tray">${inTray ? '✓ 담김' : '＋ 조립대'}</button>` : ''}
        <button class="btn sm ghost" data-act="view">보기</button>
      </div>`;
    el.querySelector('[data-act="view"]').addEventListener('click', (e) => { e.stopPropagation(); openAtom(a); });
    const t = el.querySelector('[data-act="tray"]');
    if (t) t.addEventListener('click', (e) => { e.stopPropagation(); toggleTray(a.id); });
    return el;
  }

  function toggleTray(id) {
    const i = state.tray.indexOf(id);
    if (i >= 0) state.tray.splice(i, 1); else state.tray.push(id);
    saveTray();
    const c = state.tray.length;
    toast(i >= 0 ? '조립대에서 제외' : '조립대에 담김 (' + c + '개)');
    rerenderAtomsRelated();
  }

  function openAtom(a) {
    openModal(a.title, `
      <div class="stack">
        <div class="row">
          <span class="badge">${esc(a.type)}</span>
          <span class="badge">${esc(a.topic || '주제 없음')}</span>
          <button class="btn sm ghost right" id="atStar">${a.star ? '⭐ 즐겨찾기 해제' : '☆ 즐겨찾기'}</button>
        </div>
        <div><label class="field">제목</label><input type="text" id="atTitle" value="${esc(a.title)}"></div>
        <div class="grid cols-2">
          <div><label class="field">유형</label><select id="atType">${ATOM_TYPES.map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
          <div><label class="field">주제</label><input type="text" id="atTopic" value="${esc(a.topic || '')}"></div>
        </div>
        <div><label class="field">태그(쉼표)</label><input type="text" id="atTags" value="${esc((a.tags || []).join(', '))}"></div>
        <div><label class="field">요지</label><textarea id="atSummary" style="min-height:60px">${esc(a.summary || '')}</textarea></div>
        <div><label class="field">본문</label><textarea id="atContent" style="min-height:150px">${esc(a.content || '')}</textarea></div>
        ${a.keypoints && a.keypoints.length ? `<div class="callout"><b>핵심</b><ul style="margin:6px 0 0">${a.keypoints.map(k => `<li>${esc(k)}</li>`).join('')}</ul></div>` : ''}
        <div class="meta small">출처: ${esc(a.lectureTitle || '—')} · ${fmtDate(a.createdAt)}</div>
        <div class="row">
          <button class="btn primary" id="atSave">저장</button>
          <button class="btn ${state.tray.includes(a.id) ? 'green' : 'ghost'}" id="atTray">${state.tray.includes(a.id) ? '✓ 조립대에 담김' : '＋ 조립대에 담기'}</button>
          <button class="btn ghost danger right" id="atDel">삭제</button>
        </div>
      </div>`, () => {
      $('#atStar').addEventListener('click', async () => { a.star = !a.star; await dbPut('atoms', a); openAtom(a); if (activeTab === 'atoms') RENDER.atoms(); });
      $('#atSave').addEventListener('click', async () => {
        a.title = $('#atTitle').value.trim() || a.title;
        a.type = $('#atType').value; a.topic = $('#atTopic').value.trim();
        a.tags = parseTags($('#atTags').value); a.summary = $('#atSummary').value.trim();
        a.content = $('#atContent').value.trim();
        await dbPut('atoms', a); saveHint('아톰 저장됨'); closeModal(); rerenderAtomsRelated();
      });
      $('#atTray').addEventListener('click', () => { toggleTray(a.id); closeModal(); });
      $('#atDel').addEventListener('click', async () => {
        if (!confirm('이 아톰을 삭제할까요?')) return;
        await dbDel('atoms', a.id); state.atoms = state.atoms.filter(x => x.id !== a.id);
        const i = state.tray.indexOf(a.id); if (i >= 0) { state.tray.splice(i, 1); saveTray(); }
        saveHint('삭제됨'); closeModal(); rerenderAtomsRelated();
      });
    });
  }

  /* ============================ 뷰: 조립대 ============================ */
  RENDER.compose = function () {
    const v = $('#view-compose');
    const picked = state.tray.map(id => state.atoms.find(a => a.id === id)).filter(Boolean);
    const total = picked.reduce((s, a) => s + (a.durationSec || 0), 0);

    v.innerHTML = `
      <div class="view-head">
        <div><h1>조립대</h1><p class="lead">담아둔 아톰을 새 강의로 <b>조립·조합·융합</b>합니다. 순서를 바꾸고, 아웃라인·마크다운으로 내보내거나 클로드로 하나의 강의로 엮으세요.</p></div>
      </div>

      <div class="card">
        <div class="grid cols-2">
          <div><label class="field">새 강의 주제/제목</label><input type="text" id="cTheme" placeholder="예) 자유를 아는 사람의 삶 — 로마서로 본 성령"></div>
          <div><label class="field">대상/길이·톤 (선택)</label><input type="text" id="cAudience" placeholder="예) 청년부, 25분, 도전적인 톤"></div>
        </div>
      </div>

      <div class="compose-wrap" style="margin-top:14px">
        <div>
          <div class="row spread">
            <strong>담긴 아톰 <span class="badge">${picked.length}개 · 약 ${fmtHMS(total)}</span></strong>
            <div class="row">
              <button class="btn sm ghost" id="cClear" ${picked.length ? '' : 'disabled'}>비우기</button>
              <button class="btn sm" id="cAddMore">＋ 아톰 더 담기</button>
            </div>
          </div>
          <div class="stack" id="trayList" style="margin-top:10px"></div>
        </div>

        <div class="tray">
          <div class="card">
            <strong>내보내기 · 융합</strong>
            <div class="stack" style="margin-top:10px">
              <button class="btn primary block" id="cFuse" ${picked.length ? '' : 'disabled'}>🔮 클로드 융합 프롬프트 복사</button>
              <button class="btn block" id="cOutline" ${picked.length ? '' : 'disabled'}>🧾 아웃라인 마크다운 복사</button>
              <button class="btn block" id="cMd" ${picked.length ? '' : 'disabled'}>📄 전체 원고(.md) 내보내기</button>
              ${state.settings.anthropicKey ? `<button class="btn green block" id="cAutoFuse" ${picked.length ? '' : 'disabled'}>⚡ 자동 융합(초안 생성)</button>` : ''}
            </div>
            <p class="muted small" style="margin-top:10px">‘융합 프롬프트’를 클로드에 붙여넣으면, 담긴 아톰들을 새 주제에 맞춰 도입–전개–마무리로 매끄럽게 이어 붙인 강의 초안을 만들어 줍니다.</p>
          </div>
        </div>
      </div>`;

    const bind = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    bind('cAddMore', 'click', () => switchTab('atoms'));
    bind('cClear', 'click', () => { if (confirm('조립대를 비울까요?')) { state.tray = []; saveTray(); RENDER.compose(); } });
    bind('cFuse', 'click', () => copy(buildFusionPrompt(picked)));
    bind('cOutline', 'click', () => copy(buildOutlineMd(picked)));
    bind('cMd', 'click', () => download(((($('#cTheme').value.trim()) || '새강의')).replace(/[^\w가-힣\- ]/g, '') + '.md', buildFullMd(picked)));
    bind('cAutoFuse', 'click', (e) => autoFuse(picked, e.currentTarget));

    renderTrayList(picked);
  };

  function renderTrayList(picked) {
    const box = $('#trayList'); if (!box) return;
    if (!picked.length) { box.innerHTML = `<div class="empty">담긴 아톰이 없습니다. <b>＋ 아톰 더 담기</b>에서 골라 담으세요.</div>`; return; }
    box.innerHTML = '';
    picked.forEach((a, idx) => {
      const el = document.createElement('div');
      el.className = 'tray-item'; el.draggable = true; el.dataset.id = a.id;
      el.innerHTML = `
        <span class="grab" title="드래그로 순서 변경">⠿</span>
        <div style="flex:1">
          <div><span class="badge" style="margin-right:6px">${esc(a.type)}</span><span class="h">${esc(a.title)}</span></div>
          <div class="muted small">${esc(clip(a.summary || a.content, 90))}</div>
        </div>
        <div class="stack" style="gap:4px">
          <button class="icon-btn" data-mv="up" title="위로">▲</button>
          <button class="icon-btn" data-mv="down" title="아래로">▼</button>
          <button class="icon-btn" data-mv="rm" title="빼기">✕</button>
        </div>`;
      el.querySelector('[data-mv="up"]').addEventListener('click', () => moveTray(idx, -1));
      el.querySelector('[data-mv="down"]').addEventListener('click', () => moveTray(idx, 1));
      el.querySelector('[data-mv="rm"]').addEventListener('click', () => { toggleTray(a.id); });
      // drag & drop
      el.addEventListener('dragstart', (e) => { el.classList.add('dragging'); e.dataTransfer.setData('text/plain', a.id); e.dataTransfer.effectAllowed = 'move'; });
      el.addEventListener('dragend', () => el.classList.remove('dragging'));
      el.addEventListener('dragover', (e) => { e.preventDefault(); });
      el.addEventListener('drop', (e) => {
        e.preventDefault(); const dragId = e.dataTransfer.getData('text/plain');
        const from = state.tray.indexOf(dragId), to = state.tray.indexOf(a.id);
        if (from < 0 || to < 0 || from === to) return;
        state.tray.splice(to, 0, state.tray.splice(from, 1)[0]); saveTray(); RENDER.compose();
      });
      box.appendChild(el);
    });
  }
  function moveTray(idx, dir) {
    const to = idx + dir; if (to < 0 || to >= state.tray.length) return;
    const t = state.tray; [t[idx], t[to]] = [t[to], t[idx]]; saveTray(); RENDER.compose();
  }

  function buildFusionPrompt(picked) {
    const theme = ($('#cTheme') && $('#cTheme').value.trim()) || '(주제 미정)';
    const aud = ($('#cAudience') && $('#cAudience').value.trim()) || '';
    const blocks = picked.map((a, i) => `#${i + 1} [${a.type}] ${a.title}${a.topic ? ' (주제:' + a.topic + ')' : ''}\n${a.content || a.summary}`).join('\n\n');
    return `당신은 노련한 강의 구성가입니다. 아래 "지식 아톰"들을 재료로, 다음 주제의 새 강의 원고를 만들어 주세요.

[새 강의 주제] ${theme}
${aud ? '[대상/길이·톤] ' + aud + '\n' : ''}
[구성 지침]
- 담긴 아톰들을 주제에 맞게 자연스럽게 이어 붙이되(조립·융합), 필요하면 순서를 바꾸고 매끄러운 전환 문장을 넣으세요.
- 도입(왜 이 주제인가) → 전개(아톰들을 논리적으로 배치) → 마무리(적용·결단)의 흐름.
- 각 아톰의 핵심은 살리되 새 맥락에 맞게 다듬으세요. 사실 왜곡·없는 내용 창작은 금지.
- 결과물: ① 한 문단 개요 ② 소제목이 있는 아웃라인 ③ 실제로 말할 수 있는 강의 원고.
- 어떤 부분이 어떤 아톰(#번호)에서 왔는지 아웃라인에 괄호로 표시해 주세요.

[재료 아톰 ${picked.length}개]
${blocks}`;
  }

  function buildOutlineMd(picked) {
    const theme = ($('#cTheme') && $('#cTheme').value.trim()) || '새 강의';
    let md = `# ${theme}\n\n> 아톰 ${picked.length}개로 조립한 아웃라인\n\n`;
    picked.forEach((a, i) => {
      md += `## ${i + 1}. ${a.title}  \n`;
      md += `\`${a.type}\`${a.topic ? ' · ' + a.topic : ''}  \n`;
      if (a.summary) md += `- 요지: ${a.summary}\n`;
      (a.keypoints || []).forEach(k => md += `  - ${k}\n`);
      md += `\n`;
    });
    return md;
  }
  function buildFullMd(picked) {
    const theme = ($('#cTheme') && $('#cTheme').value.trim()) || '새 강의';
    const aud = ($('#cAudience') && $('#cAudience').value.trim()) || '';
    let md = `# ${theme}\n`;
    if (aud) md += `_${aud}_\n`;
    md += `\n_강의 스튜디오에서 아톰 ${picked.length}개로 조립 · ${fmtDay(nowISO())}_\n\n---\n\n`;
    picked.forEach((a, i) => {
      md += `## ${i + 1}. ${a.title}\n\n`;
      md += `<sub>${a.type}${a.topic ? ' · ' + a.topic : ''}${(a.tags && a.tags.length) ? ' · ' + a.tags.map(t => '#' + t).join(' ') : ''}</sub>\n\n`;
      md += `${a.content || a.summary}\n\n`;
      if (a.lectureTitle) md += `<sub>출처: ${a.lectureTitle}</sub>\n\n`;
    });
    return md;
  }

  async function autoFuse(picked, btn) {
    const key = state.settings.anthropicKey;
    if (!key) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '융합 중…';
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: state.settings.anthropicModel || 'claude-opus-4-8', max_tokens: 4096, messages: [{ role: 'user', content: buildFusionPrompt(picked) }] })
      });
      if (!res.ok) throw new Error('API ' + res.status);
      const data = await res.json();
      const text = (data.content || []).map(c => c.text || '').join('\n');
      openModal('융합 초안', `<div class="stack"><textarea class="mono" style="min-height:340px">${esc(text)}</textarea>
        <div class="row"><button class="btn primary" id="fCopy">복사</button><button class="btn" id="fDl">.md 저장</button></div></div>`, () => {
        $('#fCopy').addEventListener('click', () => copy(text));
        $('#fDl').addEventListener('click', () => download('융합초안.md', text));
      });
    } catch (e) { toast('자동 융합 실패: ' + e.message + ' — 프롬프트 복사 방식을 쓰세요'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ============================ 뷰: 데이터/설정 ============================ */
  RENDER.data = function () {
    const v = $('#view-data');
    const s = state.settings;
    v.innerHTML = `
      <div class="view-head"><div><h1>데이터 · 설정</h1><p class="lead">모든 데이터는 이 브라우저(IndexedDB)에만 저장됩니다. 폰↔노트북 이동은 백업 파일로 합니다.</p></div></div>

      <div class="card">
        <strong>백업 · 이동</strong>
        <p class="muted small" style="margin:6px 0 10px">강의·아톰을 하나의 JSON 파일로 내보내고, 다른 기기(폰/노트북)에서 가져오면 그대로 옮겨집니다. (오디오는 용량이 커서 기본 제외 — 필요 시 포함 선택)</p>
        <div class="row">
          <button class="btn primary" id="dExport">JSON 백업 내보내기</button>
          <button class="btn" id="dExportAudio">오디오 포함 백업</button>
          <label class="btn" style="cursor:pointer">가져오기(병합)<input type="file" id="dImport" accept="application/json,.json" hidden></label>
        </div>
        <div id="storageInfo" class="callout" style="margin-top:12px">저장 사용량 계산 중…</div>
      </div>

      <div class="card">
        <strong>기본 정보</strong>
        <div style="margin-top:10px"><label class="field">강사 이름(원고 서명 등)</label><input type="text" id="setSpeaker" value="${esc(s.speaker || '')}" placeholder="선택"></div>
      </div>

      <div class="card">
        <strong>클로드 API (선택) — ‘⚡ 자동’ 버튼 활성화</strong>
        <p class="muted small" style="margin:6px 0 10px">키를 넣으면 원자화·융합을 클로드에 직접 요청합니다. 키는 이 브라우저에만 저장되며 서버로 전송되지 않습니다. 넣지 않아도 <b>프롬프트 복사 → 붙여넣기</b>로 모든 기능을 쓸 수 있습니다.</p>
        <div class="grid cols-2">
          <div><label class="field">Anthropic API Key</label><input type="password" id="setAnthKey" value="${esc(s.anthropicKey || '')}" placeholder="sk-ant-..."></div>
          <div><label class="field">모델</label><input type="text" id="setAnthModel" value="${esc(s.anthropicModel || 'claude-opus-4-8')}"></div>
        </div>
      </div>

      <div class="card">
        <strong>음성 전사 API (선택) — OpenAI 호환 Whisper</strong>
        <p class="muted small" style="margin:6px 0 10px">iOS 등 실시간 자막이 안 되는 기기에서, 녹음 파일을 자동으로 텍스트로 바꿀 때 사용합니다. (예: <span class="kbd">https://api.openai.com/v1/audio/transcriptions</span>)</p>
        <div class="grid cols-2">
          <div><label class="field">전사 API URL</label><input type="text" id="setTrUrl" value="${esc(s.transcribeUrl || '')}" placeholder="https://.../v1/audio/transcriptions"></div>
          <div><label class="field">API Key</label><input type="password" id="setTrKey" value="${esc(s.transcribeKey || '')}" placeholder="선택"></div>
          <div><label class="field">모델</label><input type="text" id="setTrModel" value="${esc(s.transcribeModel || 'whisper-1')}"></div>
        </div>
      </div>

      <div class="card">
        <strong>초기화</strong>
        <p class="muted small" style="margin:6px 0 10px">되돌릴 수 없습니다. 먼저 백업을 권장합니다.</p>
        <button class="btn danger" id="dWipe">모든 데이터 삭제</button>
      </div>`;

    const bind = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    const saveField = (id, key) => bind(id, 'change', (e) => { state.settings[key] = e.target.value.trim(); saveSettings(); saveHint('설정 저장됨'); });
    saveField('setSpeaker', 'speaker'); saveField('setAnthKey', 'anthropicKey'); saveField('setAnthModel', 'anthropicModel');
    saveField('setTrUrl', 'transcribeUrl'); saveField('setTrKey', 'transcribeKey'); saveField('setTrModel', 'transcribeModel');

    bind('dExport', 'click', () => exportBackup(false));
    bind('dExportAudio', 'click', () => exportBackup(true));
    bind('dImport', 'change', (e) => importBackup(e.target.files[0]));
    bind('dWipe', 'click', wipeAll);
    updateStorageInfo();
  };

  async function updateStorageInfo() {
    const box = $('#storageInfo'); if (!box) return;
    let audioBytes = 0;
    try { const all = await dbAll('audio'); all.forEach(a => { if (a.blob) audioBytes += a.blob.size || 0; }); } catch (e) { }
    let quota = '';
    if (navigator.storage && navigator.storage.estimate) {
      try { const est = await navigator.storage.estimate(); quota = ` · 브라우저 할당 사용 ${fmtBytes(est.usage)} / ${fmtBytes(est.quota)}`; } catch (e) { }
    }
    box.innerHTML = `강의 <b>${state.lectures.length}</b>개 · 아톰 <b>${state.atoms.length}</b>개 · 오디오 <b>${fmtBytes(audioBytes)}</b>${quota}`;
  }

  async function exportBackup(withAudio) {
    const payload = {
      app: 'lecture-studio', version: 1, exportedAt: nowISO(),
      settings: { speaker: state.settings.speaker }, // 키는 백업에 넣지 않음(보안)
      lectures: state.lectures, atoms: state.atoms, tray: state.tray, audio: []
    };
    if (withAudio) {
      toast('오디오 인코딩 중…');
      const all = await dbAll('audio');
      for (const a of all) {
        if (!a.blob) continue;
        const b64 = await blobToDataURL(a.blob);
        payload.audio.push({ id: a.id, dataUrl: b64 });
      }
    }
    const name = 'lecture-studio-backup-' + nowISO().slice(0, 10) + (withAudio ? '-audio' : '') + '.json';
    download(name, JSON.stringify(payload), 'application/json');
    toast('백업을 내보냈습니다');
  }
  function blobToDataURL(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  function dataURLtoBlob(u) {
    const [head, data] = u.split(','); const mime = (head.match(/data:(.*?);/) || [, 'audio/webm'])[1];
    const bin = atob(data); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  async function importBackup(file) {
    if (!file) return;
    try {
      const text = await file.text(); const data = JSON.parse(text);
      if (data.app !== 'lecture-studio' || !Array.isArray(data.lectures)) { toast('이 앱의 백업 파일이 아닙니다'); return; }
      const exLec = new Set(state.lectures.map(l => l.id));
      const exAtom = new Set(state.atoms.map(a => a.id));
      let nl = 0, na = 0;
      for (const L of data.lectures) { if (!exLec.has(L.id)) { await dbPut('lectures', L); state.lectures.push(L); nl++; } }
      for (const a of (data.atoms || [])) { if (!exAtom.has(a.id)) { await dbPut('atoms', a); state.atoms.push(a); na++; } }
      if (Array.isArray(data.audio)) {
        for (const au of data.audio) { if (au.dataUrl) await dbPut('audio', { id: au.id, blob: dataURLtoBlob(au.dataUrl) }); }
      }
      state.lectures.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      state.atoms.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      saveHint('가져오기 완료'); toast(`가져오기 완료: 강의 +${nl}, 아톰 +${na}`);
      RENDER.data();
    } catch (e) { toast('가져오기 실패: ' + e.message); }
  }

  async function wipeAll() {
    if (!confirm('모든 강의·아톰·오디오를 삭제합니다. 계속할까요?')) return;
    if (!confirm('정말로 전부 삭제할까요? 되돌릴 수 없습니다.')) return;
    await dbClear('lectures'); await dbClear('atoms'); await dbClear('audio');
    state.lectures = []; state.atoms = []; state.tray = []; saveTray();
    saveHint('초기화됨'); toast('모든 데이터를 삭제했습니다'); RENDER.data();
  }

  /* ============================ 초기화 ============================ */
  function bindGlobal() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', (e) => { if (e.target === $('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalBackdrop').hidden) closeModal(); });
    // 녹음 중 이탈 경고
    window.addEventListener('beforeunload', (e) => { if (rec.state === 'recording' || rec.state === 'paused') { e.preventDefault(); e.returnValue = ''; } });
  }

  async function init() {
    try { _db = await openDB(); }
    catch (e) { document.body.innerHTML = '<p style="padding:24px">이 브라우저에서 저장소(IndexedDB)를 열 수 없습니다. 프라이빗 모드를 해제하고 다시 시도해 주세요.</p>'; return; }
    await loadAll();
    bindGlobal();
    switchTab('record');
    saveHint('준비됨');
    // 서비스워커 등록(오프라인/설치)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
