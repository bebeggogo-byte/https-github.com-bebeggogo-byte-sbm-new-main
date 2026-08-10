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
  const DB_VER = 2;
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
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { keyPath: 'id' });        // 녹음 크래시 복구용 조각
        if (!db.objectStoreNames.contains('compositions')) db.createObjectStore('compositions', { keyPath: 'id' }); // 저장된 조립본
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
    lectures: [],     // {id,title,topic,date,tags[],notes,transcript,rawTranscript,markers[],durationSec,hasAudio,audioType,createdAt,atomized}
    atoms: [],        // {id,title,type,topic,tags[],summary,content,keypoints[],durationSec,lectureId,lectureTitle,createdAt,star,usedIn[]}
    compositions: [], // 저장된 조립본 {id,theme,audience,atomIds[],createdAt,updatedAt}
    settings: { speaker: '', transcribeUrl: '', transcribeKey: '', transcribeModel: 'whisper-1', anthropicKey: '', anthropicModel: 'claude-opus-4-8' },
    tray: [],         // 조립대에 담긴 atom id 목록(순서)
    ui: { atomQuery: '', atomType: '', atomTopic: '', atomTag: '', composeTheme: '', composeAudience: '', recoIds: [] }
  };
  let activeTab = 'record';

  async function loadAll() {
    state.lectures = (await dbAll('lectures')) || [];
    state.atoms = (await dbAll('atoms')) || [];
    state.compositions = (await dbAll('compositions')) || [];
    state.settings = Object.assign(state.settings, (await kvGet('settings', {})) || {});
    state.tray = (await kvGet('tray', [])) || [];
    state.lectures.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    state.atoms.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    state.compositions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    audioCtx: null, analyser: null, rafId: 0, mimeType: '',
    // 마커 · 크래시복구 · 화면꺼짐 방지
    markers: [], chunkSeq: 0, wakeLock: null
  };
  let _lastPersist = 0;

  /* 크래시 대비: 진행 중 녹음의 메타(제목·자막·마커·경과시간)를 주기 저장 */
  function persistRecMeta(force) {
    const now = Date.now();
    if (!force && now - _lastPersist < 3000) return;
    _lastPersist = now;
    kvSet('recActive', {
      title: ($('#recTitle') && $('#recTitle').value) || '',
      topic: ($('#recTopic') && $('#recTopic').value) || '',
      date: ($('#recDate') && $('#recDate').value) || '',
      tags: ($('#recTags') && $('#recTags').value) || '',
      notes: ($('#recNotes') && $('#recNotes').value) || '',
      finalText: rec.finalText, markers: rec.markers,
      elapsed: currentElapsed(), mimeType: rec.mimeType
    }).catch(() => { });
  }

  async function acquireWakeLock() {
    try { if ('wakeLock' in navigator) rec.wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
  }
  function releaseWakeLock() {
    try { if (rec.wakeLock) { rec.wakeLock.release(); rec.wakeLock = null; } } catch (e) { }
  }

  function addMarker(label) {
    if (rec.state !== 'recording' && rec.state !== 'paused') return;
    rec.markers.push({ t: Math.round(currentElapsed()), label });
    persistRecMeta(true);
    const el = $('#markerCount'); if (el) el.textContent = rec.markers.length + '개 표시됨';
    toast('마커 「' + label + '」 ' + fmtHMS(currentElapsed()));
  }

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
    rec.chunks = []; rec.markers = []; rec.chunkSeq = 0;
    try { await dbClear('chunks'); } catch (e) { }
    try {
      rec.mediaRecorder = rec.mimeType ? new MediaRecorder(rec.stream, { mimeType: rec.mimeType }) : new MediaRecorder(rec.stream);
    } catch (e) {
      rec.mediaRecorder = new MediaRecorder(rec.stream);
    }
    rec.mediaRecorder.ondataavailable = (ev) => {
      if (!ev.data || !ev.data.size) return;
      rec.chunks.push(ev.data);
      // 크래시 대비: 조각을 즉시 디스크(IndexedDB)에 저장 — 브라우저가 죽어도 복구 가능
      dbPut('chunks', { id: 'c' + String(rec.chunkSeq++).padStart(6, '0'), blob: ev.data }).catch(() => { });
      persistRecMeta();
    };
    rec.mediaRecorder.start(1000);
    rec.startTs = Date.now(); rec.elapsedBefore = 0; rec.state = 'recording';
    startTimer(); startLevelMeter(); acquireWakeLock();
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
    stopTimer(); stopSpeech(true); stopLevelMeter(); releaseWakeLock();
    const mr = rec.mediaRecorder;
    const finalize = async () => {
      const type = rec.mimeType || (rec.chunks[0] && rec.chunks[0].type) || 'audio/webm';
      const blob = rec.chunks.length ? new Blob(rec.chunks, { type }) : null;
      // stream 정리
      if (rec.stream) rec.stream.getTracks().forEach(t => t.stop());
      const transcript = (rec.finalText || '').trim();
      // 상태 리셋(자막 텍스트 보존 후)
      await saveNewLecture({ blob, type, durationSec: Math.round(wasElapsed), transcript, markers: rec.markers.slice() });
      try { await dbClear('chunks'); } catch (e) { }
      kvSet('recActive', null).catch(() => { });
      rec.state = 'idle'; rec.mediaRecorder = null; rec.chunks = []; rec.stream = null;
      rec.finalText = ''; rec.interimText = ''; rec.elapsedBefore = 0; rec.markers = [];
      RENDER.record();
    };
    if (mr && mr.state !== 'inactive') { mr.onstop = finalize; try { mr.stop(); } catch (e) { finalize(); } }
    else finalize();
  }

  async function saveNewLecture({ blob, type, durationSec, transcript, markers }) {
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
      rawTranscript: '',
      markers: markers || [],
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
        ${active ? `<div class="row" style="justify-content:center">
          <button class="btn sm" data-marker="핵심">💡 핵심</button>
          <button class="btn sm" data-marker="예화">📖 예화</button>
          <button class="btn sm" data-marker="질문">❓ 질문</button>
          <button class="btn sm" data-marker="다시 쓸 것">🔁 다시 쓸 것</button>
          <span class="muted small" id="markerCount">${rec.markers.length ? rec.markers.length + '개 표시됨' : '강의 중 원탭으로 지점 표시'}</span>
        </div>` : ''}
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
    $$('#view-record [data-marker]').forEach(b => b.addEventListener('click', () => addMarker(b.dataset.marker)));
  };

  /* ============================ 뷰: 강의원본 ============================ */
  RENDER.lectures = function () {
    const v = $('#view-lectures');
    const list = state.lectures;
    v.innerHTML = `
      <div class="view-head">
        <div><h1>강의 원본</h1><p class="lead">녹음·자막이 저장된 원본. 여기서 클로드로 <b>원자화</b>하면 아톰이 생성됩니다.</p></div>
        <div class="row">
          <button class="btn sm" id="btnImportLecture">＋ 텍스트로 추가</button>
          <label class="btn sm" style="cursor:pointer">＋ 오디오 파일<input type="file" id="btnImportAudio" accept="audio/*" hidden></label>
        </div>
      </div>
      ${list.length === 0 ? `<div class="empty">아직 강의 원본이 없습니다. <br>[녹음] 탭에서 녹음하거나, <b>＋ 텍스트로 추가</b>로 기존 원고를 붙여넣거나,<br><b>＋ 오디오 파일</b>로 폰 녹음앱 파일을 가져와 시작하세요.</div>`
        : `<div class="grid cols-2" id="lecList"></div>`}`;

    $('#btnImportLecture').addEventListener('click', openImportLecture);
    $('#btnImportAudio').addEventListener('change', (e) => importAudioFile(e.target.files[0]));
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

  /* 폰 녹음앱 등 외부 오디오 파일을 강의 원본으로 가져오기 */
  async function importAudioFile(file) {
    if (!file) return;
    let dur = 0;
    try {
      dur = await new Promise((res) => {
        const a = document.createElement('audio'); const u = URL.createObjectURL(file);
        a.preload = 'metadata';
        a.onloadedmetadata = () => { const d = isFinite(a.duration) ? Math.round(a.duration) : 0; URL.revokeObjectURL(u); res(d); };
        a.onerror = () => { URL.revokeObjectURL(u); res(0); };
        a.src = u;
      });
    } catch (e) { }
    const id = uid('lec_');
    const L = {
      id, title: file.name.replace(/\.[^.]+$/, ''), topic: '', date: nowISO().slice(0, 10),
      tags: [], notes: '', transcript: '', rawTranscript: '', markers: [],
      durationSec: dur, hasAudio: true, audioType: file.type || 'audio/mpeg',
      speaker: state.settings.speaker || '', createdAt: nowISO(), atomized: false
    };
    await dbPut('lectures', L); await dbPut('audio', { id, blob: file });
    state.lectures.unshift(L);
    saveHint('오디오 가져옴'); toast('오디오 파일이 강의 원본으로 추가되었습니다 — 열어서 자막을 채우세요');
    RENDER.lectures();
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
        ${(L.markers && L.markers.length) ? `<div class="callout"><b>강의 중 마커</b> ${L.markers.map(m => `<span class="chip" style="cursor:default">${fmtHMS(m.t)} ${esc(m.label)}</span>`).join(' ')}</div>` : ''}
        <div class="row">
          <button class="btn sm primary" id="lecSave">변경 저장</button>
          ${L.hasAudio ? `<button class="btn sm ghost" id="lecPlay">▶ 오디오</button>` : ''}
          ${state.settings.transcribeUrl && L.hasAudio ? `<button class="btn sm ghost" id="lecTranscribe">🎙 전사 API로 채우기</button>` : ''}
        </div>

        <div class="card" style="box-shadow:none">
          <div class="row spread">
            <strong>교정 — 잘못 들린 단어를 맥락으로 바로잡기</strong>
            ${L.rawTranscript ? '<span class="badge">교정됨 · 원문 보관 중</span>' : ''}
          </div>
          <p class="muted small" style="margin:6px 0 10px">발음·소음으로 음성인식이 틀리게 받아쓴 단어를 클로드가 문맥으로 유추해 교정합니다. <b>① 프롬프트 복사</b> → 클로드 → <b>② 교정본 붙여넣기</b>. 원문은 자동 보관됩니다.</p>
          <div class="row">
            <button class="btn sm primary" id="pfPrompt">① 교정 프롬프트 복사</button>
            <button class="btn sm" id="pfPaste">② 교정본 붙여넣기</button>
            ${state.settings.anthropicKey ? `<button class="btn sm green" id="pfAuto">⚡ 자동 교정</button>` : ''}
            ${L.rawTranscript ? `<button class="btn sm ghost" id="pfRestore">원문 복원</button>` : ''}
          </div>
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
      $('#pfPrompt').addEventListener('click', async () => { await save(true); copy(buildProofreadPrompt(L)); });
      $('#pfPaste').addEventListener('click', async () => { await save(true); openProofreadPaste(L); });
      const pfa = $('#pfAuto'); if (pfa) pfa.addEventListener('click', async () => { await save(true); autoProofread(L, pfa); });
      const pfr = $('#pfRestore'); if (pfr) pfr.addEventListener('click', async () => {
        if (!confirm('교정 전 원문으로 되돌릴까요? (현재 교정본은 사라집니다)')) return;
        L.transcript = L.rawTranscript; L.rawTranscript = ''; await dbPut('lectures', L);
        toast('원문으로 복원되었습니다'); openLecture(L.id);
      });
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
      L.notes ? `강의 의도 메모: ${L.notes}` : '',
      (L.markers && L.markers.length) ? `강사 마커(강의 중 직접 표시한 중요 지점): ${L.markers.map(m => fmtHMS(m.t) + ' 「' + m.label + '」').join(', ')}` : ''
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
- 강사 마커가 있으면 그 지점의 내용을 우선적으로 독립 아톰으로 만드세요.
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

  /* ---------- (선택) 클로드 API 공용 호출 ---------- */
  async function callClaude(prompt, maxTokens) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': state.settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: state.settings.anthropicModel || 'claude-opus-4-8',
        max_tokens: maxTokens || 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) { const t = await res.text(); throw new Error('API ' + res.status + ': ' + clip(t, 200)); }
    const data = await res.json();
    return (data.content || []).map(c => c.text || '').join('\n');
  }

  async function autoAtomize(L, btn) {
    if (!state.settings.anthropicKey) { toast('설정에서 Anthropic API 키를 먼저 입력하세요'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '원자화 중…';
    try {
      const text = await callClaude(buildAtomizePrompt(L));
      const atoms = normalizeAtoms(extractJSON(text), L);
      if (!atoms.length) throw new Error('아톰을 파싱하지 못했습니다');
      await commitAtoms(atoms, L);
      closeModal(); toast(atoms.length + '개 아톰 자동 생성 완료 → [아톰] 탭');
    } catch (e) {
      toast('자동 원자화 실패: ' + e.message + ' — 프롬프트 복사 방식을 이용하세요');
    } finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- 교정: 오인식 단어를 맥락으로 바로잡기 ---------- */
  function buildProofreadPrompt(L) {
    return `아래는 강의 현장 녹음을 음성인식으로 받아쓴 자막입니다. 강사의 발음·현장 소음 때문에 잘못 인식된 단어가 섞여 있습니다.
당신은 전문 속기 교정자입니다. 맥락을 근거로 다음을 수행하세요.

[규칙]
- 문맥상 명백히 잘못 인식된 단어를 올바른 단어로 교정하세요 (발음이 비슷한 오인식, 고유명사, 성경 인명·지명, 전문용어 등).
- 띄어쓰기·맞춤법·문장부호를 바로잡고, 의미 단위로 문단을 나누세요.
- 강사가 실제로 말한 내용은 그대로 유지: 요약·삭제·창작 금지. 군더더기 말버릇("어", "그", 단순 반복)만 정리.
- 확신이 없는 교정은 교정어 뒤에 [?원래표기] 형태로 원래 표기를 남기세요.
- 오직 교정된 본문만 출력하세요 (설명·머리말·코드펜스 금지).

[강의 정보] ${[L.title, L.topic, (L.tags || []).join(', ')].filter(Boolean).join(' / ') || '(없음)'}

[자막 원문]
${(L.transcript || '').trim()}`;
  }

  function openProofreadPaste(L) {
    openModal('교정본 붙여넣기 — ' + L.title, `
      <div class="stack">
        <p class="muted small">클로드가 교정해 준 본문을 붙여넣으면 자막이 교체됩니다. 교정 전 원문은 자동 보관되며 언제든 복원할 수 있습니다.</p>
        <textarea id="pfIn" style="min-height:240px" placeholder="교정된 본문 붙여넣기"></textarea>
        <div class="row"><button class="btn primary" id="pfApply">적용</button><button class="btn ghost" id="pfCancel">취소</button></div>
      </div>`, () => {
      $('#pfCancel').addEventListener('click', () => openLecture(L.id));
      $('#pfApply').addEventListener('click', async () => {
        const t = $('#pfIn').value.trim();
        if (!t) { toast('본문을 붙여넣으세요'); return; }
        if (!L.rawTranscript) L.rawTranscript = L.transcript || '';
        L.transcript = t; await dbPut('lectures', L);
        saveHint('교정 적용됨'); toast('교정본이 적용되었습니다 (원문 보관됨)');
        openLecture(L.id);
      });
    });
  }

  /* 긴 자막은 문단 경계에서 쪼개 순차 교정 */
  function splitForAPI(text, size) {
    const out = []; text = String(text);
    while (text.length > size) {
      let cut = text.lastIndexOf('\n', size);
      if (cut < size * 0.5) cut = text.lastIndexOf('. ', size);
      if (cut < size * 0.5) cut = text.lastIndexOf('다 ', size);
      if (cut < size * 0.5) cut = size;
      out.push(text.slice(0, cut + 1)); text = text.slice(cut + 1);
    }
    if (text.trim()) out.push(text);
    return out;
  }

  async function autoProofread(L, btn) {
    if (!state.settings.anthropicKey) { toast('설정에서 Anthropic API 키를 먼저 입력하세요'); return; }
    const src = (L.transcript || '').trim();
    if (!src) { toast('교정할 자막이 없습니다'); return; }
    btn.disabled = true; const old = btn.textContent;
    try {
      const parts = splitForAPI(src, 6000);
      const fixed = [];
      for (let i = 0; i < parts.length; i++) {
        btn.textContent = '교정 중… (' + (i + 1) + '/' + parts.length + ')';
        const tmp = Object.assign({}, L, { transcript: parts[i] });
        fixed.push((await callClaude(buildProofreadPrompt(tmp), 8000)).trim());
      }
      if (!L.rawTranscript) L.rawTranscript = src;
      L.transcript = fixed.join('\n\n'); await dbPut('lectures', L);
      toast('자동 교정 완료 (원문 보관됨)'); openLecture(L.id);
    } catch (e) {
      toast('자동 교정 실패: ' + e.message + ' — 프롬프트 복사 방식을 쓰세요');
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
        <div class="row">
          <span class="badge">${state.atoms.length}개 · 필터 ${filtered.length}개</span>
          ${state.atoms.length > 3 ? `<button class="btn sm ghost" id="btnDedup" title="중복·유사 아톰 찾기 프롬프트">🧹 중복 정리</button>` : ''}
        </div>
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
    bind('btnDedup', 'click', () => { copy(buildDedupPrompt()); toast('중복 정리 프롬프트 복사됨 — 클로드에 붙여넣고 결과를 보며 직접 정리하세요'); });
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
      <div class="meta small">${esc(a.topic || '—')} · ${esc(clip(a.lectureTitle || '', 18))}${(a.usedIn && a.usedIn.length) ? ' · 사용 ' + a.usedIn.length + '회' : ''}</div>
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
        ${(a.usedIn && a.usedIn.length) ? `<div class="callout small"><b>사용 이력</b> — ${a.usedIn.map(u => esc(u.theme) + ' (' + fmtDay(u.date) + ')').join(' · ')}</div>` : ''}
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
    const ui = state.ui;

    v.innerHTML = `
      <div class="view-head">
        <div><h1>조립대</h1><p class="lead">주제를 주면 소스(아톰)에서 골라 조합합니다. 순서를 다듬고, 아웃라인·원고로 내보내거나 클로드로 하나의 강의로 융합하세요.</p></div>
      </div>

      <div class="card">
        <div class="grid cols-2">
          <div><label class="field">새 강의 주제/제목</label><input type="text" id="cTheme" value="${esc(ui.composeTheme)}" placeholder="예) 자유를 아는 사람의 삶 — 로마서로 본 성령"></div>
          <div><label class="field">대상/길이·톤 (선택)</label><input type="text" id="cAudience" value="${esc(ui.composeAudience)}" placeholder="예) 청년부, 25분, 도전적인 톤"></div>
        </div>
        <div class="row" style="margin-top:10px">
          <button class="btn sm primary" id="cRecommend" ${state.atoms.length ? '' : 'disabled'}>🔎 관련 아톰 추천 (즉시)</button>
          <button class="btn sm" id="cSelPrompt" ${state.atoms.length ? '' : 'disabled'}>📇 클로드 선택 프롬프트 복사</button>
          <button class="btn sm" id="cSelPaste" ${state.atoms.length ? '' : 'disabled'}>선택 결과(JSON) 붙여넣기</button>
          ${state.settings.anthropicKey ? `<button class="btn sm green" id="cAutoSel" ${state.atoms.length ? '' : 'disabled'}>⚡ 자동 선택</button>` : ''}
        </div>
        <p class="muted small" style="margin:8px 0 0"><b>추천</b>은 이 기기에서 키워드로 바로 찾고, <b>선택 프롬프트</b>는 아톰 카탈로그 전체를 클로드에 보여 주제에 맞는 조합·순서를 골라 받습니다(부족한 내용도 제안).</p>
        <div id="recoBox" class="stack" style="margin-top:10px"></div>
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

          ${state.compositions.length ? `
          <div class="card" style="margin-top:14px">
            <strong>저장된 조립본 <span class="badge">${state.compositions.length}</span></strong>
            <div class="stack" style="margin-top:10px" id="compList"></div>
          </div>` : ''}
        </div>

        <div class="tray">
          <div class="card">
            <strong>내보내기 · 융합</strong>
            <div class="stack" style="margin-top:10px">
              <button class="btn primary block" id="cFuse" ${picked.length ? '' : 'disabled'}>🔮 클로드 융합 프롬프트 복사</button>
              <button class="btn block" id="cOutline" ${picked.length ? '' : 'disabled'}>🧾 아웃라인 마크다운 복사</button>
              <button class="btn block" id="cMd" ${picked.length ? '' : 'disabled'}>📄 전체 원고(.md) 내보내기</button>
              ${state.settings.anthropicKey ? `<button class="btn green block" id="cAutoFuse" ${picked.length ? '' : 'disabled'}>⚡ 자동 융합(초안 생성)</button>` : ''}
              <button class="btn block" id="cSaveComp" ${picked.length ? '' : 'disabled'}>💾 조립본으로 저장</button>
            </div>
            <p class="muted small" style="margin-top:10px">‘융합 프롬프트’를 클로드에 붙여넣으면, 담긴 아톰들을 새 주제에 맞춰 도입–전개–마무리로 매끄럽게 이어 붙인 강의 초안을 만들어 줍니다. 저장한 조립본은 아톰 사용 이력에 기록됩니다.</p>
          </div>
        </div>
      </div>`;

    const bind = (id, ev, fn) => { const el = $('#' + id); if (el) el.addEventListener(ev, fn); };
    bind('cTheme', 'input', (e) => { ui.composeTheme = e.target.value; });
    bind('cAudience', 'input', (e) => { ui.composeAudience = e.target.value; });
    bind('cAddMore', 'click', () => switchTab('atoms'));
    bind('cClear', 'click', () => { if (confirm('조립대를 비울까요?')) { state.tray = []; saveTray(); RENDER.compose(); } });
    bind('cFuse', 'click', () => copy(buildFusionPrompt(picked)));
    bind('cOutline', 'click', () => copy(buildOutlineMd(picked)));
    bind('cMd', 'click', () => download(((ui.composeTheme.trim() || '새강의')).replace(/[^\w가-힣\- ]/g, '') + '.md', buildFullMd(picked)));
    bind('cAutoFuse', 'click', (e) => autoFuse(picked, e.currentTarget));
    bind('cSaveComp', 'click', () => saveComposition(picked));
    bind('cRecommend', 'click', () => {
      const theme = ui.composeTheme.trim();
      if (!theme) { toast('먼저 새 강의 주제를 입력하세요'); return; }
      const hits = scoreAtomsForTopic(theme);
      ui.recoIds = hits.map(h => h.a.id);
      if (!hits.length) toast('키워드가 겹치는 아톰이 없습니다 — 클로드 선택 프롬프트를 써 보세요');
      renderReco();
    });
    bind('cSelPrompt', 'click', () => {
      if (!ui.composeTheme.trim()) { toast('먼저 새 강의 주제를 입력하세요'); return; }
      copy(buildSelectionPrompt());
    });
    bind('cSelPaste', 'click', openSelectionPaste);
    bind('cAutoSel', 'click', (e) => autoSelect(e.currentTarget));

    renderTrayList(picked);
    renderReco();
    renderCompList();
  };

  /* ---------- 주제 → 아톰 추천(기기 내 키워드 매칭) ---------- */
  function scoreAtomsForTopic(topicText) {
    const raw = String(topicText).toLowerCase().split(/[^0-9a-z가-힣]+/).filter(w => w.length >= 2);
    if (!raw.length) return [];
    // 한국어 조사 대응: "성령이"→"성령"도 함께 매칭 (3자 이상이면 끝 1자 제거 변형 추가)
    const words = [];
    raw.forEach(w => {
      words.push(w);
      if (/[가-힣]{3,}/.test(w)) words.push(w.slice(0, -1));
    });
    const scored = state.atoms.map(a => {
      const f = (s) => String(s || '').toLowerCase();
      const hay = { title: f(a.title), tags: (a.tags || []).map(f), topic: f(a.topic), summary: f(a.summary), content: f(a.content) };
      let sc = 0; const hit = new Set();
      words.forEach(w => {
        const stem = w; // 같은 어근의 원형/변형 중복 가산 방지
        if (hay.title.includes(w) && !hit.has('t' + stem.slice(0, 2))) { sc += 3; hit.add('t' + stem.slice(0, 2)); }
        if (hay.tags.some(t => t.includes(w)) && !hit.has('g' + stem.slice(0, 2))) { sc += 3; hit.add('g' + stem.slice(0, 2)); }
        if (hay.topic.includes(w) && !hit.has('p' + stem.slice(0, 2))) { sc += 2; hit.add('p' + stem.slice(0, 2)); }
        if (hay.summary.includes(w) && !hit.has('s' + stem.slice(0, 2))) { sc += 2; hit.add('s' + stem.slice(0, 2)); }
        if (hay.content.includes(w) && !hit.has('c' + stem.slice(0, 2))) { sc += 1; hit.add('c' + stem.slice(0, 2)); }
      });
      return { a, sc };
    }).filter(x => x.sc > 0);
    scored.sort((x, y) => y.sc - x.sc);
    return scored.slice(0, 12);
  }

  function renderReco() {
    const box = $('#recoBox'); if (!box) return;
    const atoms = state.ui.recoIds.map(id => state.atoms.find(a => a.id === id)).filter(Boolean);
    if (!atoms.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="muted small">추천 ${atoms.length}개 — 눌러서 담기</div>`;
    atoms.forEach(a => {
      const inTray = state.tray.includes(a.id);
      const el = document.createElement('div'); el.className = 'tray-item';
      el.innerHTML = `
        <div style="flex:1">
          <div><span class="badge" style="margin-right:6px">${esc(a.type)}</span><span class="h">${esc(a.title)}</span>${(a.usedIn && a.usedIn.length) ? ` <span class="muted small">· 사용 ${a.usedIn.length}회</span>` : ''}</div>
          <div class="muted small">${esc(clip(a.summary || a.content, 90))}</div>
        </div>
        <button class="btn sm ${inTray ? 'green' : 'primary'}">${inTray ? '✓ 담김' : '＋ 담기'}</button>`;
      el.querySelector('button').addEventListener('click', () => toggleTray(a.id));
      box.appendChild(el);
    });
  }

  /* ---------- 주제 → 클로드가 카탈로그에서 조합 선택 ---------- */
  function buildCatalogLines(atoms) {
    return atoms.map(a => `${a.id} | ${a.type} | ${a.title} | ${a.topic || '-'} | ${(a.tags || []).join(',') || '-'} | ${clip(a.summary || a.content, 80)}`).join('\n');
  }

  function buildDedupPrompt() {
    return `아래는 내 강의 지식 아톰 카탈로그입니다 (형식: id | 유형 | 제목 | 주제 | 태그 | 요지).
사실상 같은 내용을 담은 중복·유사 아톰 그룹을 찾아 주세요.

[출력 형식]
- 그룹별로: 남길 아톰 id 1개 / 흡수(정리 후보) id들 / 이유 한 줄 / 병합 시 보강하면 좋을 문구 제안
- 중복이 없으면 "중복 없음"이라고만 답하세요.

[카탈로그 ${state.atoms.length}개]
${buildCatalogLines(state.atoms)}`;
  }

  function buildSelectionPrompt() {
    const theme = state.ui.composeTheme.trim() || '(주제 미정)';
    const aud = state.ui.composeAudience.trim();
    return `당신은 강의 기획자입니다. 아래는 내가 실제 강의에서 축적한 지식 아톰 카탈로그입니다 (형식: id | 유형 | 제목 | 주제 | 태그 | 요지).
다음 주제의 강의를 만들려 합니다. 카탈로그에서 어울리는 아톰을 골라 강의 흐름 순서대로 배열해 주세요.

[새 강의 주제] ${theme}
${aud ? '[대상/길이·톤] ' + aud + '\n' : ''}[규칙]
- 실제 카탈로그에 있는 id만 사용하세요. 5~12개 권장.
- 도입 → 전개 → 마무리 흐름이 되도록 순서를 배치하고 각 아톰의 역할을 표시하세요.
- 주제에 필요한데 카탈로그에 없는 내용은 missing 배열에 제안하세요.
- 오직 JSON만 출력 (코드펜스·설명 금지):
{"selection":[{"id":"atom_xxx","order":1,"role":"도입","reason":"한 줄 이유"}],"missing":["카탈로그에 없는, 보강이 필요한 내용"]}

[카탈로그 ${state.atoms.length}개]
${buildCatalogLines(state.atoms)}`;
  }

  function applySelection(parsed) {
    const sel = parsed && Array.isArray(parsed.selection) ? parsed.selection : (Array.isArray(parsed) ? parsed : null);
    if (!sel || !sel.length) { toast('선택 결과를 인식하지 못했습니다'); return false; }
    const ids = sel.slice()
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .map(s => s && s.id).filter(id => id && state.atoms.some(a => a.id === id));
    if (!ids.length) { toast('카탈로그와 일치하는 아톰이 없습니다'); return false; }
    state.tray = Array.from(new Set(ids)); saveTray();
    RENDER.compose();
    toast(state.tray.length + '개 아톰이 조립대에 배치되었습니다');
    const missing = parsed && Array.isArray(parsed.missing) ? parsed.missing.filter(Boolean) : [];
    if (missing.length) {
      openModal('보강이 필요한 내용', `<div class="stack">
        <p class="muted small">클로드가 이 주제에 필요하지만 아직 내 아톰에 없다고 본 내용입니다. 다음 강의 때 다뤄서 소스를 채워 보세요.</p>
        <ul>${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>`);
    }
    return true;
  }

  function openSelectionPaste() {
    openModal('클로드 선택 결과(JSON) 붙여넣기', `
      <div class="stack">
        <p class="muted small">클로드가 준 JSON을 그대로 붙여넣으세요. 조립대가 그 순서로 다시 구성됩니다.</p>
        <textarea id="selIn" class="mono" style="min-height:200px" placeholder='{"selection":[{"id":"atom_...","order":1}],"missing":[]}'></textarea>
        <div class="row"><button class="btn primary" id="selApply">적용</button><button class="btn ghost" id="selCancel">취소</button></div>
      </div>`, () => {
      $('#selCancel').addEventListener('click', closeModal);
      $('#selApply').addEventListener('click', () => {
        const parsed = extractJSON($('#selIn').value);
        if (!parsed) { toast('JSON을 인식하지 못했습니다'); return; }
        closeModal();
        applySelection(parsed);
      });
    });
  }

  async function autoSelect(btn) {
    if (!state.settings.anthropicKey) return;
    if (!state.ui.composeTheme.trim()) { toast('먼저 새 강의 주제를 입력하세요'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '선택 중…';
    try {
      const text = await callClaude(buildSelectionPrompt());
      const parsed = extractJSON(text);
      if (!parsed) throw new Error('결과 파싱 실패');
      applySelection(parsed);
    } catch (e) { toast('자동 선택 실패: ' + e.message + ' — 프롬프트 복사 방식을 쓰세요'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  /* ---------- 조립본 저장/불러오기 ---------- */
  async function saveComposition(picked) {
    const theme = state.ui.composeTheme.trim();
    if (!theme) { toast('먼저 새 강의 주제를 입력하세요'); return; }
    const comp = { id: uid('comp_'), theme, audience: state.ui.composeAudience.trim(), atomIds: state.tray.slice(), createdAt: nowISO(), updatedAt: nowISO() };
    await dbPut('compositions', comp);
    state.compositions.unshift(comp);
    // 아톰 사용 이력 기록(같은 예화 반복 방지용)
    for (const a of picked) {
      a.usedIn = a.usedIn || [];
      if (!a.usedIn.some(u => u.compId === comp.id)) {
        a.usedIn.push({ compId: comp.id, theme, date: nowISO() });
        await dbPut('atoms', a);
      }
    }
    saveHint('조립본 저장됨'); toast('조립본이 저장되었습니다 — 아톰 사용 이력에도 기록');
    RENDER.compose();
  }

  function renderCompList() {
    const box = $('#compList'); if (!box) return;
    box.innerHTML = '';
    state.compositions.forEach(c => {
      const n = c.atomIds.filter(id => state.atoms.some(a => a.id === id)).length;
      const el = document.createElement('div'); el.className = 'tray-item';
      el.innerHTML = `
        <div style="flex:1">
          <div class="h">${esc(c.theme)}</div>
          <div class="muted small">${fmtDay(c.updatedAt)} · 아톰 ${n}개${c.audience ? ' · ' + esc(c.audience) : ''}</div>
        </div>
        <div class="row" style="gap:4px">
          <button class="btn sm" data-c="load">불러오기</button>
          <button class="btn sm ghost" data-c="md">.md</button>
          <button class="icon-btn" data-c="del" title="삭제">✕</button>
        </div>`;
      el.querySelector('[data-c="load"]').addEventListener('click', () => {
        state.ui.composeTheme = c.theme; state.ui.composeAudience = c.audience || '';
        state.tray = c.atomIds.filter(id => state.atoms.some(a => a.id === id));
        saveTray(); RENDER.compose(); toast('조립본을 불러왔습니다');
      });
      el.querySelector('[data-c="md"]').addEventListener('click', () => {
        const picked = c.atomIds.map(id => state.atoms.find(a => a.id === id)).filter(Boolean);
        download(c.theme.replace(/[^\w가-힣\- ]/g, '') + '.md', buildFullMd(picked, c.theme, c.audience));
      });
      el.querySelector('[data-c="del"]').addEventListener('click', async () => {
        if (!confirm(`조립본 "${c.theme}"을(를) 삭제할까요?`)) return;
        await dbDel('compositions', c.id);
        state.compositions = state.compositions.filter(x => x.id !== c.id);
        // 사용 이력에서 제거
        for (const a of state.atoms) {
          if (a.usedIn && a.usedIn.some(u => u.compId === c.id)) {
            a.usedIn = a.usedIn.filter(u => u.compId !== c.id);
            await dbPut('atoms', a);
          }
        }
        RENDER.compose();
      });
      box.appendChild(el);
    });
  }

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
    const theme = state.ui.composeTheme.trim() || '(주제 미정)';
    const aud = state.ui.composeAudience.trim();
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
    const theme = state.ui.composeTheme.trim() || '새 강의';
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
  function buildFullMd(picked, themeArg, audArg) {
    const theme = (themeArg != null ? themeArg : state.ui.composeTheme).trim() || '새 강의';
    const aud = (audArg != null ? audArg : state.ui.composeAudience).trim();
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
    if (!state.settings.anthropicKey) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = '융합 중…';
    try {
      const text = await callClaude(buildFusionPrompt(picked), 8000);
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
      lectures: state.lectures, atoms: state.atoms, compositions: state.compositions, tray: state.tray, audio: []
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
      const exComp = new Set(state.compositions.map(c => c.id));
      let nl = 0, na = 0;
      for (const L of data.lectures) { if (!exLec.has(L.id)) { await dbPut('lectures', L); state.lectures.push(L); nl++; } }
      for (const a of (data.atoms || [])) { if (!exAtom.has(a.id)) { await dbPut('atoms', a); state.atoms.push(a); na++; } }
      for (const c of (data.compositions || [])) { if (!exComp.has(c.id)) { await dbPut('compositions', c); state.compositions.push(c); } }
      state.compositions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    if (!confirm('모든 강의·아톰·조립본·오디오를 삭제합니다. 계속할까요?')) return;
    if (!confirm('정말로 전부 삭제할까요? 되돌릴 수 없습니다.')) return;
    await dbClear('lectures'); await dbClear('atoms'); await dbClear('audio');
    await dbClear('compositions'); await dbClear('chunks');
    state.lectures = []; state.atoms = []; state.compositions = []; state.tray = []; saveTray();
    saveHint('초기화됨'); toast('모든 데이터를 삭제했습니다'); RENDER.data();
  }

  /* ---------- 크래시 복구: 저장 못 한 녹음 되살리기 ---------- */
  async function checkRecovery() {
    try {
      const meta = await kvGet('recActive', null);
      const chunks = await dbAll('chunks');
      if (!chunks || !chunks.length) { if (meta) kvSet('recActive', null).catch(() => { }); return; }
      const dur = Math.round((meta && meta.elapsed) || 0);
      const ok = confirm('저장되지 못한 녹음이 발견되었습니다 (' + fmtHMS(dur) + ' 분량). 복구해서 강의 원본으로 저장할까요?');
      if (!ok) {
        if (confirm('복구 데이터를 삭제할까요? (취소하면 다음 실행 때 다시 묻습니다)')) {
          await dbClear('chunks'); await kvSet('recActive', null);
        }
        return;
      }
      chunks.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const type = (meta && meta.mimeType) || (chunks[0].blob && chunks[0].blob.type) || 'audio/webm';
      const blob = new Blob(chunks.map(c => c.blob), { type });
      const id = uid('lec_');
      const L = {
        id,
        title: (((meta && meta.title) || '').trim()) || ('복구된 녹음 ' + fmtDay(nowISO())),
        topic: ((meta && meta.topic) || '').trim(),
        date: ((meta && meta.date) || '') || nowISO().slice(0, 10),
        tags: parseTags(meta && meta.tags),
        notes: ((meta && meta.notes) || '').trim(),
        transcript: ((meta && meta.finalText) || '').trim(),
        rawTranscript: '', markers: (meta && meta.markers) || [],
        durationSec: dur, hasAudio: true, audioType: type,
        speaker: state.settings.speaker || '', createdAt: nowISO(), atomized: false
      };
      await dbPut('lectures', L); await dbPut('audio', { id, blob });
      state.lectures.unshift(L);
      await dbClear('chunks'); await kvSet('recActive', null);
      toast('녹음이 복구되어 [강의원본]에 저장되었습니다');
      if (activeTab === 'lectures') RENDER.lectures();
    } catch (e) { /* 복구는 최선 노력 */ }
  }

  /* ============================ 초기화 ============================ */
  function bindGlobal() {
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) switchTab(b.dataset.tab); });
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', (e) => { if (e.target === $('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modalBackdrop').hidden) closeModal(); });
    // 녹음 중 이탈 경고
    window.addEventListener('beforeunload', (e) => { if (rec.state === 'recording' || rec.state === 'paused') { e.preventDefault(); e.returnValue = ''; } });
    // 화면 복귀 시 Wake Lock 재획득(녹음 중 화면꺼짐 방지)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && (rec.state === 'recording' || rec.state === 'paused')) acquireWakeLock();
    });
  }

  async function init() {
    try { _db = await openDB(); }
    catch (e) { document.body.innerHTML = '<p style="padding:24px">이 브라우저에서 저장소(IndexedDB)를 열 수 없습니다. 프라이빗 모드를 해제하고 다시 시도해 주세요.</p>'; return; }
    await loadAll();
    bindGlobal();
    switchTab('record');
    saveHint('준비됨');
    checkRecovery();
    // 서비스워커 등록(오프라인/설치)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => { });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
