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
  const DB_VER = 3;
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
        if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });        // 강의 전 설계
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
    plans: [],        // 강의 전 설계 {id,title,topic,audience,intent,slidesText,deep,createdAt,updatedAt}
    settings: { speaker: '', transcribeUrl: '', transcribeKey: '', transcribeModel: 'whisper-1', anthropicKey: '', anthropicModel: 'claude-opus-4-8', autoDeleteAudio: true, slideTheme: 'auto', pexelsKey: '' },
    tray: [],         // 조립대에 담긴 atom id 목록(순서)
    ui: { atomQuery: '', atomType: '', atomTopic: '', atomTag: '', composeTheme: '', composeAudience: '', recoIds: [] }
  };
  let activeTab = 'record';

  async function loadAll() {
    state.lectures = (await dbAll('lectures')) || [];
    state.atoms = (await dbAll('atoms')) || [];
    state.compositions = (await dbAll('compositions')) || [];
    state.plans = (await dbAll('plans')) || [];
    state.settings = Object.assign(state.settings, (await kvGet('settings', {})) || {});
    state.tray = (await kvGet('tray', [])) || [];
    state.lectures.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    state.atoms.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    state.compositions.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    state.plans.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    // 마커 · 크래시복구 · 화면꺼짐 방지 · 연결된 설계
    markers: [], chunkSeq: 0, wakeLock: null, planId: ''
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
      finalText: rec.finalText, markers: rec.markers, planId: rec.planId,
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
      planId: rec.planId || '',
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

  /* ============================ 뷰: 설계 (강의 전) ============================ */

  /* PPTX(zip) 해체 — 라이브러리 없이 슬라이드/노트 텍스트 추출 */
  async function extractPptxText(file) {
    if (!('DecompressionStream' in window)) throw new Error('이 브라우저는 파일 해체를 지원하지 않습니다 — 슬라이드 개요를 복사해 붙여넣으세요');
    const buf = new Uint8Array(await file.arrayBuffer());
    const dv = new DataView(buf.buffer);
    // End of Central Directory 찾기
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('PPTX(ZIP) 형식이 아닙니다');
    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name, method, csize, lho });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    async function readEntry(e) {
      const q = e.lho;
      if (dv.getUint32(q, true) !== 0x04034b50) throw new Error('손상된 항목');
      const nameLen = dv.getUint16(q + 26, true);
      const extraLen = dv.getUint16(q + 28, true);
      const start = q + 30 + nameLen + extraLen;
      const comp = buf.subarray(start, start + e.csize);
      if (e.method === 0) return new TextDecoder().decode(comp);
      if (e.method === 8) {
        const stream = new Blob([comp]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
      throw new Error('지원하지 않는 압축 방식');
    }
    const xmlText = (xml) => {
      const out = []; const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g; let m;
      while ((m = re.exec(xml))) out.push(m[1]);
      return out.join(' ')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
        .replace(/\s+/g, ' ').trim();
    };
    const slideRe = /^ppt\/slides\/slide(\d+)\.xml$/;
    const noteRe = /^ppt\/notesSlides\/notesSlide(\d+)\.xml$/;
    const slides = entries.filter(e => slideRe.test(e.name))
      .sort((a, b) => Number(a.name.match(slideRe)[1]) - Number(b.name.match(slideRe)[1]));
    if (!slides.length) throw new Error('슬라이드를 찾지 못했습니다');
    const notes = {};
    entries.forEach(e => { const m = e.name.match(noteRe); if (m) notes[m[1]] = e; });
    let out = '';
    for (const e of slides) {
      const n = e.name.match(slideRe)[1];
      out += `[슬라이드 ${n}] ${xmlText(await readEntry(e)) || '(텍스트 없음)'}\n`;
      if (notes[n]) {
        const nt = xmlText(await readEntry(notes[n]));
        if (nt) out += `  └ 노트: ${nt}\n`;
      }
    }
    return out.trim();
  }

  /* ---------- PPTX 생성 — 라이브러리 없이 슬라이드 초안(.pptx) 만들기 ---------- */
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  /* 무압축(stored) ZIP 작성기 */
  function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = []; let offset = 0;
    files.forEach(f => {
      const nameU8 = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, nameU8.length, true);
      parts.push(new Uint8Array(lh.buffer), nameU8, data);
      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
      cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
      cd.setUint16(28, nameU8.length, true); cd.setUint32(42, offset, true);
      central.push(new Uint8Array(cd.buffer), nameU8);
      offset += 30 + nameU8.length + data.length;
    });
    let cdSize = 0; central.forEach(c => { cdSize += c.length; });
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true); eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, cdSize, true); eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)],
      { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
  }
  const xesc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const PPTX_NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

  /* slides: [{title, bullets[]}] → .pptx Blob (16:9, 브랜드 브라운/크림)
     renderFn을 주면 슬라이드 XML 생성을 커스텀 렌더러로 대체(디자인 레이아웃용) */
  function buildPptx(slides, renderFn) {
    const NS = PPTX_NS;
    const emptyTree = '<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>';
    const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Nedabah"><a:themeElements>
<a:clrScheme name="Nedabah"><a:dk1><a:srgbClr val="2C2118"/></a:dk1><a:lt1><a:srgbClr val="FFFDF9"/></a:lt1><a:dk2><a:srgbClr val="4E3117"/></a:dk2><a:lt2><a:srgbClr val="F7F1E8"/></a:lt2><a:accent1><a:srgbClr val="6B4423"/></a:accent1><a:accent2><a:srgbClr val="3F7D5A"/></a:accent2><a:accent3><a:srgbClr val="A07D20"/></a:accent3><a:accent4><a:srgbClr val="B4531F"/></a:accent4><a:accent5><a:srgbClr val="4A6FA5"/></a:accent5><a:accent6><a:srgbClr val="7A5AA0"/></a:accent6><a:hlink><a:srgbClr val="4A6FA5"/></a:hlink><a:folHlink><a:srgbClr val="7A5AA0"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Nedabah"><a:majorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Malgun Gothic"/><a:ea typeface="Malgun Gothic"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;
    const slideXml = (s) => {
      const paras = (s.bullets || []).map(b => b
        ? `<a:p><a:pPr marL="285750" indent="-285750"><a:buFont typeface="Arial"/><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="ko-KR" sz="1800" dirty="0"><a:solidFill><a:srgbClr val="1D1D1F"/></a:solidFill></a:rPr><a:t>${xesc(b)}</a:t></a:r></a:p>`
        : '<a:p><a:endParaRPr lang="ko-KR" sz="1800"/></a:p>').join('');
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="411480"/><a:ext cx="10515600" cy="1188720"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="b"/><a:lstStyle/><a:p><a:r><a:rPr lang="ko-KR" sz="3200" b="1" dirty="0"><a:solidFill><a:srgbClr val="1D1D1F"/></a:solidFill></a:rPr><a:t>${xesc(s.title || '')}</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="838200" y="1783080"/><a:ext cx="10515600" cy="4526280"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras || '<a:p><a:endParaRPr lang="ko-KR"/></a:p>'}</p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:overrideClrMapping bg1="lt2" tx1="dk1" bg2="lt1" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/></p:clrMapOvr></p:sld>`;
    };
    const files = [];
    files.push({
      name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`
    });
    files.push({
      name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`
    });
    files.push({
      name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`
    });
    files.push({
      name: 'ppt/_rels/presentation.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>`
    });
    files.push({
      name: 'ppt/slideMasters/slideMaster1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${NS}><p:cSld>${emptyTree}</p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`
    });
    files.push({
      name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`
    });
    files.push({
      name: 'ppt/slideLayouts/slideLayout1.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="빈 화면">${emptyTree}</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`
    });
    files.push({
      name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`
    });
    files.push({ name: 'ppt/theme/theme1.xml', data: theme });
    slides.forEach((s, i) => {
      const out = (renderFn || slideXml)(s, i);
      const xml = typeof out === 'string' ? out : out.xml;
      const img = typeof out === 'string' ? null : out.img;
      files.push({ name: `ppt/slides/slide${i + 1}.xml`, data: xml });
      let rels = `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`;
      if (img) {
        files.push({ name: `ppt/media/image${i + 1}.jpg`, data: img });
        rels += `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${i + 1}.jpg"/>`;
      }
      files.push({
        name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
      });
    });
    return zipStore(files);
  }

  /* ---------- 클로드 디자인 슬라이드: 레이아웃 렌더러 (안티 AI-slop)
     원칙: 장식 라인·스트라이프 금지 / white 지배·brown 보조·gold 악센트 1개 /
     한 슬라이드 한 개념 / 여백 40%+ / 본문 좌정렬 / 다크 샌드위치(표지·질문·마무리) */
  /* 테마 라이브러리 — 품질 기준(레이아웃·여백·타이포·안티슬롭)은 고정,
     토큰만 갈아끼운다. 기본은 애플 미니멀(흰 배경·검은 글씨).
     tf = 제목 폰트 오버라이드(세리프 테마용). */
  const SLIDE_THEMES = {
    cobalt: {
      name: '코발트 블루', mood: '기본 — 선명하고 깊은 블루 포인트',
      t: { pageBg: 'FFFFFF', ink: '000000', gray: '75777B', gray2: '4D5256', card: 'F7F7F7', tintNum: 'E3ECFA', darkBg: '0047AB', darkMain: 'B9CFF0', kicker: '7FA8E0', charge: 'FFFFFF', accent: '0047AB' }
    },
    samsung: {
      name: '삼성 원UI', mood: '기본 — 밝고 친근한 신뢰감, 삼성 블루 포인트',
      t: { pageBg: 'FFFFFF', ink: '000000', gray: '75777B', gray2: '4D5256', card: 'F7F7F7', tintNum: 'E4EAF9', darkBg: '1428A0', darkMain: 'B7C4EE', kicker: '8FA7E8', charge: 'FFFFFF', accent: '1428A0' }
    },
    apple: {
      name: '애플 미니멀', mood: '무채색 절제 — 내용만 남기고 싶을 때',
      t: { pageBg: 'FFFFFF', ink: '1D1D1F', gray: '86868B', gray2: '6E6E73', card: 'F5F5F7', tintNum: 'E8E8ED', darkBg: '000000', darkMain: 'A1A1A6', kicker: '86868B', charge: 'FFFFFF' }
    },
    serif: {
      name: '클래식 세리프', mood: '말씀 묵상·문학·역사 — 고전적인 무게',
      t: { pageBg: 'FFFFFF', ink: '1F1A15', gray: '8A8175', gray2: '5F574B', card: 'F6F3EE', tintNum: 'EAE4DA', accent: 'B08A2E', darkBg: '1F1A15', darkMain: 'C9C2B6', kicker: 'D9B96A', charge: 'D9B96A', tf: 'Cambria' }
    },
    nedabah: {
      name: '네다바웨이 브라운', mood: '공동체 브랜드 행사·수료식',
      t: { pageBg: 'FFFFFF', ink: '2C2118', gray: '9A8B77', gray2: '6E5F4E', card: 'F4EEE4', tintNum: 'E9DCC8', accent: '6B4423', darkBg: '4E3117', darkMain: 'D8C9B4', kicker: 'E3C77E', charge: 'E3C77E' }
    },
    midnight: {
      name: '미드나잇 네이비', mood: '리더십·비전·전략 — 단정한 신뢰감',
      t: { pageBg: 'FFFFFF', ink: '1C2340', gray: '7A82A6', gray2: '4A5378', card: 'EEF2FB', tintNum: 'DEE7F8', accent: '1E2761', darkBg: '1E2761', darkMain: 'CADCFC', kicker: '9FB8E8', charge: 'FFFFFF' }
    },
    forest: {
      name: '포레스트 그린', mood: '성장·회복·습관·자연 주제',
      t: { pageBg: 'FFFFFF', ink: '1E3320', gray: '7C8A7B', gray2: '4C5F4C', card: 'EFF4EC', tintNum: 'DDE8D5', accent: '2C5F2D', darkBg: '2C5F2D', darkMain: 'CFE3C2', kicker: '97BC62', charge: 'FFFFFF' }
    },
    terracotta: {
      name: '웜 테라코타', mood: '공동체·환대·가족 — 따뜻한 온도',
      t: { pageBg: 'FFFFFF', ink: '3A2A26', gray: '9C8A83', gray2: '6B564E', card: 'F1EDE2', tintNum: 'EAD9D2', accent: 'B85042', darkBg: '8E3B31', darkMain: 'EFE0D6', kicker: 'EAD3C4', charge: 'FFFFFF' }
    },
    cherry: {
      name: '체리 볼드', mood: '도전·결단·회개 — 강한 촉구',
      t: { pageBg: 'FFFFFF', ink: '2B1518', gray: '9B8B8D', gray2: '5F4A4E', card: 'FAF3F2', tintNum: 'F3DEDD', accent: '990011', darkBg: '990011', darkMain: 'F2C9CE', kicker: 'F2C9CE', charge: 'FFFFFF' }
    }
  };
  function resolveSlideTheme(userPick, claudePick) {
    if (userPick && userPick !== 'auto' && SLIDE_THEMES[userPick]) return userPick;
    if (claudePick && SLIDE_THEMES[claudePick]) return claudePick;
    return 'cobalt';
  }

  function dzText(id, x, y, w, h, paras, anchor) {
    const ps = paras.filter(p => p && (p.t || p.runs)).map(p => {
      const pPr = `<a:pPr algn="${p.align || 'l'}"${p.bullet ? ' marL="285750" indent="-285750"' : ''}>${p.lnSpc ? `<a:lnSpc><a:spcPct val="${p.lnSpc}"/></a:lnSpc>` : ''}${p.spcAft ? `<a:spcAft><a:spcPts val="${p.spcAft}"/></a:spcAft>` : ''}${p.bullet ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>' : '<a:buNone/>'}</a:pPr>`;
      const rPr = `<a:rPr lang="ko-KR" sz="${p.sz}"${p.b ? ' b="1"' : ''}${p.i ? ' i="1"' : ''}${p.spc ? ` spc="${p.spc}"` : ''} dirty="0"><a:solidFill><a:srgbClr val="${p.color}"/></a:solidFill>${p.font ? `<a:latin typeface="${p.font}"/>` : ''}</a:rPr>`;
      let runs;
      if (p.runs) {
        // 다색 런: 포컬 포인트(하이라이트 단어·악센트 마침표)용
        runs = p.runs.filter(r => r && r.t !== '').map(r => {
          const rr = `<a:rPr lang="ko-KR" sz="${r.sz || p.sz}"${(r.b != null ? r.b : p.b) ? ' b="1"' : ''}${r.i ? ' i="1"' : ''}${(r.spc || p.spc) ? ` spc="${r.spc || p.spc}"` : ''} dirty="0"><a:solidFill><a:srgbClr val="${r.color || p.color}"/></a:solidFill>${(r.font || p.font) ? `<a:latin typeface="${r.font || p.font}"/>` : ''}</a:rPr>`;
          return String(r.t).split('\n').map(line => `<a:r>${rr}<a:t>${xesc(line)}</a:t></a:r>`).join('<a:br/>');
        }).join('');
      } else {
        runs = String(p.t).split('\n').map(line => `<a:r>${rPr}<a:t>${xesc(line)}</a:t></a:r>`).join('<a:br/>');
      }
      return `<a:p>${pPr}${runs}</a:p>`;
    }).join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr wrap="square"${anchor ? ` anchor="${anchor}"` : ''}><a:normAutofit/></a:bodyPr><a:lstStyle/>${ps || '<a:p><a:endParaRPr lang="ko-KR"/></a:p>'}</p:txBody></p:sp>`;
  }
  function dzRect(id, x, y, w, h, fill, prst) {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="${prst || 'rect'}"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ko-KR"/></a:p></p:txBody></p:sp>`;
  }
  /* 슬라이드 배경 — 항상 단색(그라데이션 금지) */
  function dzSlide(bg, inner) {
    const fill = `<a:solidFill><a:srgbClr val="${bg}"/></a:solidFill>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${PPTX_NS}><p:cSld><p:bg><p:bgPr>${fill}<a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  }

  /* 사진은 배경이 아니라 요소 — 오른쪽 라운드 카드(rId2). 텍스트는 왼쪽 컬럼 */
  function dzPhotoCard() {
    return `<p:pic><p:nvPicPr><p:cNvPr id="30" name="photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="6583680" y="548640"/><a:ext cx="5059680" cy="5760720"/></a:xfrm><a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 6000"/></a:avLst></a:prstGeom></p:spPr></p:pic>`;
  }

  function renderDesignedSlide(s, idx, C) {
    C = C || SLIDE_THEMES.cobalt.t;
    const tf = C.tf;                    // 제목 폰트 오버라이드(세리프 테마)
    const AC = C.accent || C.ink;       // 포컬 포인트 색 — 이곳에만 색을 쓴다
    const pageNo = dzText(19, 11200000, 6400000, 700000, 300000, [{ t: String(idx + 1), sz: 1200, color: C.gray, align: 'r' }]);
    // 하이라이트 단어 → 다색 런 분해 (포컬 포인트)
    const hlRuns = (text, hl, base) => {
      text = String(text || '');
      if (hl && text.includes(hl)) {
        const i = text.indexOf(hl);
        return [{ t: text.slice(0, i), color: base }, { t: hl, color: AC }, { t: text.slice(i + hl.length), color: base }];
      }
      return null;
    };
    // 제목 끝 악센트 마침표 — 에디토리얼 포컬
    const dotRuns = (text, base) => [{ t: String(text || ''), color: base }, { t: '.', color: AC }];

    // ── 사진이 있으면: 텍스트 왼쪽 컬럼 + 오른쪽 라운드 사진 카드 (배경은 언제나 흰색) ──
    if (s._img && ['cover', 'section', 'question', 'quote', 'closing'].includes(s.layout)) {
      const wrap = (xml) => ({ xml, img: s._img });
      const L = { x: 822960, w: 5303520 }; // 왼쪽 텍스트 컬럼
      let txt = '';
      if (s.layout === 'cover') {
        txt = dzText(2, L.x, 1554480, L.w, 457200, [{ t: s.kicker || '', sz: 2000, color: AC, spc: 400 }]) +
          dzText(3, L.x, 2103120, L.w, 2103120, [{ runs: dotRuns(s.title, C.ink), sz: 4000, b: 1, spc: -75, font: tf }]) +
          dzText(4, L.x, 4343400, L.w, 731520, [{ t: s.subtitle || '', sz: 2400, color: C.gray2 }]);
      } else if (s.layout === 'section') {
        txt = dzText(2, L.x, 1737360, L.w, 457200, [{ t: s.number || '', sz: 2000, b: 1, color: AC, spc: 400 }]) +
          dzText(3, L.x, 2286000, L.w, 1828800, [{ t: s.title, sz: 3600, b: 1, color: C.ink, font: tf, spc: -50 }]) +
          dzText(4, L.x, 4229100, L.w, 548640, [{ t: s.subtitle || '', sz: 2000, color: C.gray }]);
      } else if (s.layout === 'question') {
        txt = dzText(2, L.x, 1188720, L.w, 1188720, [{ t: '?', sz: 7200, b: 1, color: C.tintNum }]) +
          dzText(3, L.x, 2560320, L.w, 2103120, [{ t: s.question, sz: 2800, b: 1, color: C.ink, font: tf }]) +
          dzText(4, L.x, 4800600, L.w, 457200, [{ t: s.subtitle || '', sz: 2000, color: C.gray }]);
      } else if (s.layout === 'quote') {
        txt = dzText(2, L.x, 1005840, L.w, 1371600, [{ t: '\u201C', sz: 9600, b: 1, color: C.tintNum, font: 'Cambria' }]) +
          dzText(3, L.x, 2331720, L.w, 2103120, [{ t: s.quote, sz: 2400, color: C.ink, font: tf }]) +
          dzText(4, L.x, 4663440, L.w, 457200, [{ t: s.source, sz: 2000, color: C.gray }]);
      } else { // closing
        txt = dzText(2, L.x, 1920240, L.w, 1188720, [{ t: s.main, sz: 2400, color: C.gray2 }]) +
          dzText(3, L.x, 3291840, L.w, 1554480, [{ runs: dotRuns(s.charge, C.ink), sz: 3200, b: 1, spc: -50, font: tf }]);
      }
      return wrap(dzSlide(C.pageBg, txt + dzPhotoCard()));
    }

    // ── 기본: 전부 흰 배경, 슬라이드마다 포컬 포인트 하나 ──
    switch (s.layout) {
      case 'cover': // 포컬: 대제목 + 악센트 마침표
        return dzSlide(C.pageBg,
          dzText(2, 822960, 2011680, 10515600, 457200, [{ t: s.kicker || '', sz: 2000, color: AC, spc: 400 }]) +
          dzText(3, 777240, 2469480, 10561320, 1554480, [{ runs: dotRuns(s.title, C.ink), sz: 5400, b: 1, spc: -100, font: tf }]) +
          dzText(4, 822960, 4114800, 10515600, 548640, [{ t: s.subtitle || '', sz: 2400, color: C.gray2 }]));
      case 'statement': { // 포컬: 하이라이트 단어
        const runs = hlRuns(s.text || s.title, s.highlight, C.ink);
        return dzSlide(C.pageBg,
          dzText(2, 822960, 2194560, 10515600, 2469480,
            [runs ? { runs, sz: 4000, b: 1, spc: -75, font: tf } : { t: s.text || s.title, sz: 4000, b: 1, color: C.ink, spc: -75, font: tf }]));
      }
      case 'section': // 포컬: 거대한 틴트 숫자
        return dzSlide(C.pageBg,
          dzText(2, 0, 365760, 11887200, 6035040, [{ t: s.number || '', sz: 30000, b: 1, color: C.tintNum, align: 'r' }]) +
          dzText(3, 822960, 4846320, 7315200, 914400, [{ t: s.title, sz: 4000, b: 1, color: C.ink, font: tf, spc: -75 }]) +
          dzText(4, 822960, 5760720, 7315200, 457200, [{ t: s.subtitle || '', sz: 2000, color: C.gray }]));
      case 'quote': // 포컬: 거대한 틴트 따옴표
        return dzSlide(C.pageBg,
          dzText(2, 502920, 91440, 2743200, 2743200, [{ t: '\u201C', sz: 20000, b: 1, color: C.tintNum, font: 'Cambria' }]) +
          dzText(3, 1554480, 2331720, 9144000, 1828800, [{ t: s.quote, sz: 3000, color: C.ink, font: tf }]) +
          dzText(4, 1554480, 4434840, 9144000, 457200, [{ t: s.source, sz: 2000, color: C.gray }]) + pageNo);
      case 'question': // 포컬: 거대한 틴트 물음표 + 질문
        return dzSlide(C.pageBg,
          dzText(2, 822960, 594360, 10515600, 1737360, [{ t: '?', sz: 10800, b: 1, color: C.tintNum }]) +
          dzText(3, 822960, 2743200, 10515600, 1828800, [{ t: s.question, sz: 3400, b: 1, color: C.ink, font: tf, spc: -50 }]) +
          dzText(4, 822960, 4846320, 10515600, 457200, [{ t: s.subtitle || '', sz: 2000, color: C.gray }]));
      case 'activity': { // 포컬: 악센트 라벨 + 큰 틴트 숫자 단계
        let inner = dzText(2, 822960, 640080, 2743200, 365760, [{ t: '활동', sz: 1800, b: 1, color: AC, spc: 600 }]) +
          dzText(3, 822960, 1097280, 10515600, 731520, [{ t: s.title, sz: 3000, b: 1, color: C.ink, font: tf }]);
        (s.steps || []).slice(0, 4).forEach((t, i) => {
          const y = 2149856 + i * 1280160;
          inner += dzText(4 + i * 2, 822960, y - 137160, 914400, 1005840, [{ t: String(i + 1), sz: 5400, b: 1, color: C.tintNum }]) +
            dzText(5 + i * 2, 2011680, y + 91440, 8869680, 822960, [{ t, sz: 2200, b: 1, color: C.ink }]);
        });
        return dzSlide(C.pageBg, inner + pageNo);
      }
      case 'stat': // 포컬: 거대한 악센트 숫자
        return dzSlide(C.pageBg,
          dzText(2, 1097280, 1737360, 9966960, 2560320, [{ t: s.value || '', sz: 12000, b: 1, color: AC, align: 'ctr', font: tf, spc: -150 }], 'ctr') +
          dzText(3, 1097280, 4434840, 9966960, 731520, [{ t: s.label || '', sz: 2400, color: C.gray2, align: 'ctr' }]));
      case 'compare': { // 포컬: 오른쪽 카드(틴트+악센트 헤드) — 시선이 결론 쪽에 머문다
        let inner = dzText(2, 822960, 640080, 10515600, 822960, [{ t: s.title, sz: 3200, b: 1, color: C.ink, font: tf }]) +
          dzRect(3, 822960, 1737360, 5029200, 4206240, C.card, 'roundRect') +
          dzRect(4, 6336792, 1737360, 5029200, 4206240, C.tintNum, 'roundRect');
        const colFn = (x, head, items, headC, id) => {
          let h = dzText(id, x + 457200, 2148840, 4114800, 548640, [{ t: head, sz: 2400, b: 1, color: headC }]);
          (items || []).slice(0, 4).forEach((t, i) => {
            h += dzText(id + 1 + i, x + 457200, 2926080 + i * 822960, 4114800, 731520, [{ t, sz: 2000, color: C.gray2 }]);
          });
          return h;
        };
        inner += colFn(822960, s.leftHead || '', s.leftItems, C.gray2, 5);
        inner += colFn(6336792, s.rightHead || '', s.rightItems, AC, 11);
        return dzSlide(C.pageBg, inner);
      }
      case 'closing': // 포컬: 결단 문장 + 악센트 마침표
        return dzSlide(C.pageBg,
          dzText(2, 1097280, 2011680, 9966960, 1737360, [{ t: s.main, sz: 2400, color: C.gray2, align: 'ctr' }], 'ctr') +
          dzText(3, 1097280, 4023360, 9966960, 1005840, [{ runs: dotRuns(s.charge, C.ink), sz: 3600, b: 1, align: 'ctr', spc: -75, font: tf }]));
      default: { // content — 구조 위계: 제목 28 / 소제목 24 / 학습목표 22(포컬) / 설명 20 / 내용 20, 줄간격 2.0
        let inner = dzText(2, 822960, 548640, 10515600, 731520, [{ t: s.title, sz: 2800, b: 1, color: C.ink, font: tf }], 'b');
        let y = 1371600; let id = 3;
        if (s.subtitle) {
          inner += dzText(id++, 822960, y, 10515600, 640080, [{ t: s.subtitle, sz: 2400, b: 1, color: C.gray2 }]);
          y += 731520;
        }
        if (s.lead) { // 학습목표·핵심 리드 — 이 슬라이드의 포컬
          inner += dzText(id++, 822960, y, 10515600, 731520, [{ t: s.lead, sz: 2200, b: 1, color: AC }]);
          y += 822960;
        }
        if (s.desc) {
          inner += dzText(id++, 822960, y, 10515600, 640080, [{ t: s.desc, sz: 2000, color: C.gray }]);
          y += 731520;
        }
        inner += dzText(id, 822960, y, 10515600, Math.max(914400, 6218172 - y),
          (s.bullets || []).map(t => ({ t, sz: 2000, color: (s.lead || s.desc) ? C.gray2 : C.ink, lnSpc: 200000 })));
        return dzSlide(C.pageBg, inner + pageNo);
      }
    }
  }
  function buildDesignedPptx(design, userThemePick) {
    const key = resolveSlideTheme(userThemePick, design.theme);
    const C = SLIDE_THEMES[key].t;
    return buildPptx(design.slides, (s, i) => renderDesignedSlide(s, i, C));
  }

  function normalizeSlideDesign(parsed) {
    const arr = parsed && (Array.isArray(parsed.slides) ? parsed.slides : (Array.isArray(parsed) ? parsed : null));
    if (!arr || !arr.length) return null;
    const LAY = ['cover', 'statement', 'section', 'content', 'quote', 'question', 'activity', 'stat', 'compare', 'closing'];
    const S = (x) => String(x == null ? '' : x).trim();
    const A = (x, n) => Array.isArray(x) ? x.map(S).filter(Boolean).slice(0, n) : [];
    const out = arr.map(s => {
      if (!s) return null;
      let layout = S(s.layout).toLowerCase();
      if (!LAY.includes(layout)) layout = 'content';
      return {
        layout, title: S(s.title), subtitle: S(s.subtitle), kicker: S(s.kicker), number: S(s.number),
        imageQuery: S(s.imageQuery), highlight: S(s.highlight), lead: S(s.lead), desc: S(s.desc),
        text: S(s.text), bullets: A(s.bullets, 5), steps: A(s.steps, 4),
        quote: S(s.quote), source: S(s.source), question: S(s.question),
        value: S(s.value), label: S(s.label),
        leftHead: S(s.leftHead), leftItems: A(s.leftItems, 4),
        rightHead: S(s.rightHead), rightItems: A(s.rightItems, 4),
        main: S(s.main), charge: S(s.charge)
      };
    }).filter(s => s && (s.title || s.text || s.quote || s.question || s.main || s.value || s.bullets.length || s.steps.length || s.leftItems.length));
    if (!out.length) return null;
    const theme = parsed && !Array.isArray(parsed) ? String(parsed.theme || '').trim().toLowerCase() : '';
    return { theme, slides: out };
  }

  function slideDesignRules() {
    const themeLines = Object.keys(SLIDE_THEMES).map(k => `${k} = ${SLIDE_THEMES[k].name} (${SLIDE_THEMES[k].mood})`).join('\n');
    return `[디자인 언어 — 화이트 + 포컬 포인트 (배경 칠하기 절대 금지)]
- 모든 슬라이드는 흰 배경. 배경 전체를 색·사진으로 칠하는 것은 절대 금지. 그라데이션도 금지 — 모든 색은 단색.
- 슬라이드마다 시선이 처음 닿는 **포컬 포인트를 정확히 하나** 설계하라:
  하이라이트 단어(statement.highlight) / 거대 틴트 숫자(section) / 거대 통계 숫자(stat) /
  리드 문장(content.lead) / 거대 물음표(question) / 오른쪽 사진 카드(imageQuery) 중 하나.
- 색은 그 포컬 포인트에만. 나머지는 검정과 그레이 단계로 물러난다.
- 사진은 배경이 아니라 요소 — 오른쪽 라운드 카드로 들어간다.
- 문장은 짧게, 마침표까지 신경 쓴 카피처럼.

[타이포 위계 — 강의실 뒤에서도 보여야 한다]
- content 구조: 제목 28pt / 소제목(subtitle) 24pt / 학습목표(lead) 22pt / 설명(desc) 20pt / 내용(bullets) 20pt, 줄간격 2.0
- 최소 글자 크기 20pt — 이보다 작은 텍스트는 만들지 않는다(렌더러가 보장).
- 안 보이는 슬라이드는 실패다. 글이 많아 20pt를 지키기 어려우면 슬라이드를 쪼개라.

[테마 — 주제에 어울리는 것 하나를 골라 theme 필드로 지정]
${themeLines}

[슬라이드 설계 규칙 — AI 느낌을 지우는 것이 목표]
- 빌보드 테스트(스티브 잡스의 3초 규칙): 슬라이드는 광고판처럼 3초 안에 읽혀야 한다. 잡스는 12장에 단어 19개를 썼다.
  한 단어·한 숫자·한 문장 슬라이드(statement/stat/question/quote/section)가 덱의 절반 이상이 되게 하라.
  bullets가 있는 content 슬라이드는 전체의 1/3 이하로.
- 한 슬라이드 = 하나의 메시지. 원고를 옮겨 적지 말 것(강의는 말로, 슬라이드는 기억 장치로).
- 제목 20자 이내, 불릿 5개 이하·각 40자 이내. 같은 레이아웃을 연속으로 쓰지 말 것.
- 핵심 선언 문장은 statement로 독립. 숫자·통계가 있으면 stat으로 크게. 대비 구조(전/후, A/B)는 compare로.
- 청중을 멈추게 할 질문은 question으로, 인용구는 quote로 독립.
- 구간이 바뀔 때 section(번호 01, 02…)으로 호흡. 활동 안내는 activity(단계 4개 이하).
- 시작 cover(kicker=시리즈명·주최, subtitle=부제), 마지막 closing(main=깊은 얻음, charge=결단 문장).
- 배경 사진이 힘을 실어줄 슬라이드(cover/section/question/quote/closing)에는 imageQuery를 넣어라
  — 영어 구체 명사구(예: "open wooden door light", "misty forest path"). 덱당 2~4장만, 남발 금지.
- 문구는 구체적으로. 클리셰 금지: "~의 여정", "함께 알아보겠습니다", "다양한", "효과적인" 같은 빈 말.
- 총 8~20장 권장.

[레이아웃]
cover(kicker,title,subtitle) · statement(text,highlight=강조 단어) · section(number,title,subtitle) · content(title,subtitle=소제목,lead=학습목표·핵심 한 줄,desc=슬라이드 설명,bullets[]=내용) · quote(quote,source) · question(question,subtitle) · activity(title,steps[]) · stat(value,label) · compare(title,leftHead,leftItems[],rightHead=결론 쪽,rightItems[]) · closing(main,charge)

[출력 — 오직 JSON, 코드펜스·설명 금지]
{"theme":"cobalt","slides":[{"layout":"cover","kicker":"시리즈명","title":"...","subtitle":"...","imageQuery":"open door light"},{"layout":"statement","text":"...","highlight":"강조단어"},{"layout":"section","number":"01","title":"...","subtitle":"..."},{"layout":"content","title":"...","subtitle":"소제목","lead":"학습목표: ...","desc":"슬라이드 설명","bullets":["..."]},{"layout":"question","question":"...","subtitle":"30초, 눈을 감고"},{"layout":"quote","quote":"...","source":"..."},{"layout":"activity","title":"...","steps":["..."]},{"layout":"stat","value":"4:18","label":"..."},{"layout":"compare","title":"...","leftHead":"...","leftItems":["..."],"rightHead":"...","rightItems":["..."]},{"layout":"closing","main":"...","charge":"..."}]}`;
  }
  function buildSlideDesignPromptFromPlan(P) {
    const body = P.deep ? buildPlanMd(P) : `제목: ${P.title}\n${P.intent ? '설계 의도: ' + P.intent + '\n' : ''}슬라이드 개요:\n${P.slidesText || '(없음)'}`;
    return `당신은 강의 프레젠테이션 디자이너입니다. 아래 강의 설계를 바탕으로, 청중이 따라오기 쉽고 통찰이 살아나는 강의용 슬라이드 구성을 설계하세요.

${slideDesignRules()}

[강의 설계]
${body}`;
  }
  function buildSlideDesignPromptFromAtoms(theme, aud, picked) {
    const blocks = picked.map((a, i) => `#${i + 1} [${a.type}] ${a.title}\n${a.content || a.summary}`).join('\n\n');
    return `당신은 강의 프레젠테이션 디자이너입니다. 아래 재료(지식 아톰)로 「${theme || '새 강의'}」 강의용 슬라이드 구성을 설계하세요.${aud ? '\n[대상/길이·톤] ' + aud : ''}

${slideDesignRules()}

[재료 아톰 ${picked.length}개]
${blocks}`;
  }

  /* 테마 선택 셀렉트 (설계·조립대 공용, settings.slideTheme에 저장) */
  function themeSelectHTML(id) {
    const cur = state.settings.slideTheme || 'auto';
    return `<select id="${id}" style="width:auto;max-width:100%">
      <option value="auto" ${cur === 'auto' ? 'selected' : ''}>🎯 자동 — 클로드가 주제 보고 추천</option>
      ${Object.keys(SLIDE_THEMES).map(k => `<option value="${k}" ${cur === k ? 'selected' : ''}>${SLIDE_THEMES[k].name} · ${esc(SLIDE_THEMES[k].mood)}</option>`).join('')}
    </select>`;
  }
  function bindThemeSelect(id) {
    const el = $('#' + id);
    if (el) el.addEventListener('change', (e) => { state.settings.slideTheme = e.target.value; saveSettings(); saveHint('슬라이드 테마 저장됨'); });
  }

  /* ---------- 배경 사진: 크롭·소싱·완성 흐름 ---------- */
  async function cropToJpeg(blobOrFile, W, H) {
    W = W || 1200; H = H || 1366; // 오른쪽 사진 카드 비율
    const bmp = await createImageBitmap(blobOrFile);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const sc = Math.max(W / bmp.width, H / bmp.height);
    const w = bmp.width * sc, h = bmp.height * sc;
    ctx.drawImage(bmp, (W - w) / 2, (H - h) / 2, w, h);
    const out = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.82));
    if (!out) throw new Error('이미지 변환 실패');
    return new Uint8Array(await out.arrayBuffer());
  }
  async function fetchPexelsPhoto(query) {
    const r = await fetch('https://api.pexels.com/v1/search?per_page=1&orientation=portrait&query=' + encodeURIComponent(query),
      { headers: { Authorization: state.settings.pexelsKey } });
    if (!r.ok) throw new Error('Pexels ' + r.status);
    const d = await r.json();
    const p = d.photos && d.photos[0];
    if (!p) return null;
    const url = (p.src.original || p.src.large2x) + '?auto=compress&cs=tinysrgb&fit=crop&w=1200&h=1366';
    const ir = await fetch(url);
    if (!ir.ok) throw new Error('사진 다운로드 실패');
    return await cropToJpeg(await ir.blob());
  }

  /* 디자인 JSON → (사진 소싱) → .pptx 저장 */
  async function finishDesignedDeck(ds, baseName) {
    const PHOTO_LAYOUTS = ['cover', 'section', 'question', 'quote', 'closing'];
    const want = ds.slides.filter(sl => sl.imageQuery && PHOTO_LAYOUTS.includes(sl.layout)).slice(0, 6);
    const doBuild = () => {
      const key = resolveSlideTheme(state.settings.slideTheme, ds.theme);
      const withImg = ds.slides.filter(x => x._img).length;
      download(baseName.replace(/[^\w가-힣\- ]/g, '') + '-디자인슬라이드.pptx', buildDesignedPptx(ds, state.settings.slideTheme));
      toast(ds.slides.length + '장 · ' + SLIDE_THEMES[key].name + (withImg ? ' · 사진 ' + withImg + '장' : '') + ' 완성');
    };
    if (!want.length) { doBuild(); return; }
    if (state.settings.pexelsKey) {
      toast('배경 사진 검색 중… (' + want.length + '장)');
      for (const sl of want) {
        try { const img = await fetchPexelsPhoto(sl.imageQuery); if (img) sl._img = img; } catch (e) { /* 실패 시 그라디언트 유지 */ }
      }
      doBuild(); return;
    }
    // Pexels 키 없음 → 내 사진 직접 선택
    openModal('배경 사진 넣기 (선택)', `
      <div class="stack">
        <p class="muted small">클로드가 이 슬라이드들에 사진을 추천했습니다. 폰/컴퓨터의 사진을 골라 넣거나, 건너뛰면 그라디언트 배경으로 만들어집니다.<br>
        <b>자동으로 찾게 하려면</b>: [데이터] 탭에 무료 Pexels API 키를 넣으세요 (pexels.com/api).</p>
        ${want.map((sl, i) => `
          <div class="row" style="border:1px solid var(--line);border-radius:10px;padding:8px 12px">
            <div style="flex:1"><b>${esc(sl.title || sl.question || sl.charge || sl.layout)}</b><div class="muted small">추천: ${esc(sl.imageQuery)}</div></div>
            <input type="file" accept="image/*" data-photo-idx="${i}" style="width:auto">
          </div>`).join('')}
        <div class="row">
          <button class="btn primary" id="phBuild">.pptx 만들기</button>
          <button class="btn ghost" id="phSkip">사진 없이 계속</button>
        </div>
      </div>`, () => {
      $('#phSkip').addEventListener('click', () => { closeModal(); doBuild(); });
      $('#phBuild').addEventListener('click', async () => {
        const inputs = $$('#modalBody input[data-photo-idx]');
        for (const inp of inputs) {
          const f = inp.files && inp.files[0];
          if (f) { try { want[Number(inp.dataset.photoIdx)]._img = await cropToJpeg(f); } catch (e) { } }
        }
        closeModal(); doBuild();
      });
    });
  }

  function openSlideDesignPaste(baseName) {
    openModal('슬라이드 디자인 결과(JSON) 붙여넣기', `
      <div class="stack">
        <p class="muted small">클로드가 준 JSON을 붙여넣으면 브랜드 디자인이 입혀진 .pptx로 저장됩니다.</p>
        <textarea id="sdIn" class="mono" style="min-height:220px" placeholder='{"slides":[{"layout":"cover",...}]}'></textarea>
        <div class="row"><button class="btn primary" id="sdApply">.pptx 만들기</button><button class="btn ghost" id="sdCancel">취소</button></div>
      </div>`, () => {
      $('#sdCancel').addEventListener('click', closeModal);
      $('#sdApply').addEventListener('click', () => {
        const ds = normalizeSlideDesign(extractJSON($('#sdIn').value));
        if (!ds) { toast('슬라이드 JSON을 인식하지 못했습니다'); return; }
        closeModal();
        finishDesignedDeck(ds, baseName);
      });
    });
  }

  async function autoDesignSlides(promptText, baseName, btn) {
    if (!state.settings.anthropicKey) { toast('설정에서 Anthropic API 키를 먼저 입력하세요'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '디자인 중…';
    try {
      const ds = normalizeSlideDesign(extractJSON(await callClaude(promptText, 8000)));
      if (!ds) throw new Error('결과 파싱 실패');
      await finishDesignedDeck(ds, baseName);
    } catch (e) { toast('자동 디자인 실패: ' + e.message + ' — 프롬프트 복사 방식을 쓰세요'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  /* 설계 보드 → 슬라이드 초안 */
  function makeSlidesFromPlan(P) {
    const slides = [{ title: P.title, bullets: [P.topic, P.audience, '', P.intent].filter((x, i) => x || i === 2) }];
    const d = P.deep;
    if (d) {
      d.sections.forEach(s => {
        slides.push({
          title: s.heading, bullets: [
            s.induces ? '유도: ' + s.induces : '',
            s.insight ? '💡 ' + s.insight : '',
            s.question ? '❓ ' + s.question : '',
            s.activity ? '🧪 ' + s.activity : '',
            (s.quote && (s.quote.text || s.quote.source)) ? '📖 ' + (s.quote.text ? '“' + s.quote.text + '” — ' : '') + (s.quote.source || '') : '',
            s.transition ? '→ ' + s.transition : ''
          ].filter(Boolean)
        });
      });
      if (d.closing.deepGain || d.closing.charge) {
        slides.push({ title: '마무리', bullets: [d.closing.deepGain, d.closing.charge].filter(Boolean) });
      }
    }
    return slides;
  }

  /* 조립본 → 슬라이드 초안 */
  function makeSlidesFromAtoms(theme, audience, picked) {
    const slides = [{ title: theme || '새 강의', bullets: [audience].filter(Boolean) }];
    picked.forEach(a => {
      const bullets = [];
      if (a.summary) bullets.push(a.summary);
      (a.keypoints || []).forEach(k => bullets.push(k));
      if (!bullets.length && a.content) bullets.push(clip(a.content, 200));
      slides.push({ title: a.title, bullets });
    });
    return slides;
  }

  RENDER.design = function () {
    const v = $('#view-design');
    const list = state.plans;
    v.innerHTML = `
      <div class="view-head">
        <div><h1>설계 <span class="badge">강의 전</span></h1><p class="lead">슬라이드가 유도하는 방향을 읽어내고, 단조로운 이득이 아닌 <b>깊이 있는 얻음과 통찰</b>까지 닿는 설계로 끌어올립니다.</p></div>
        <div><button class="btn sm primary" id="btnNewPlan">＋ 새 설계</button></div>
      </div>
      <div class="card">
        <div class="steps">
          <span><b>1</b> 슬라이드 가져오기(.pptx 또는 개요 붙여넣기)</span> ›
          <span><b>2</b> 내 설계 의도 쓰기</span> ›
          <span><b>3</b> 클로드 심화 설계(통찰·질문·활동·책 인용)</span> ›
          <span><b>4</b> [녹음]에서 이 설계를 연결해 강의</span>
        </div>
      </div>
      ${list.length === 0
        ? `<div class="empty" style="margin-top:14px">아직 설계가 없습니다. <b>＋ 새 설계</b>로 시작하세요.</div>`
        : `<div class="grid cols-2" id="planList" style="margin-top:14px"></div>`}`;

    $('#btnNewPlan').addEventListener('click', async () => {
      const P = {
        id: uid('plan_'), title: '새 강의 설계', topic: '', audience: '',
        intent: '', slidesText: '', deep: null,
        createdAt: nowISO(), updatedAt: nowISO()
      };
      await dbPut('plans', P); state.plans.unshift(P);
      openPlan(P.id);
    });

    const wrap = $('#planList'); if (!wrap) return;
    list.forEach(P => {
      const el = document.createElement('div'); el.className = 'item';
      const linked = state.lectures.filter(L => L.planId === P.id).length;
      el.innerHTML = `
        <div class="it-top">
          <div>
            <h3>${esc(P.title)}</h3>
            <div class="meta">${esc(P.topic || '주제 미지정')} · ${fmtDay(P.updatedAt)}${linked ? ' · 강의 ' + linked + '회' : ''}</div>
          </div>
          <span class="badge">${P.deep ? '심화 설계됨' : (P.slidesText ? '슬라이드 있음' : '초안')}</span>
        </div>
        <div class="excerpt">${esc(clip(P.intent || P.slidesText || '(내용 없음)', 180))}</div>
        <div class="row">
          <button class="btn sm primary" data-act="open">열기 · 심화 설계</button>
          ${P.deep ? `<button class="btn sm ghost" data-act="md">📄 .md</button>` : ''}
          <button class="btn sm ghost danger right" data-act="del">삭제</button>
        </div>`;
      el.querySelector('[data-act="open"]').addEventListener('click', () => openPlan(P.id));
      const md = el.querySelector('[data-act="md"]');
      if (md) md.addEventListener('click', () => download(P.title.replace(/[^\w가-힣\- ]/g, '') + '-설계.md', buildPlanMd(P)));
      el.querySelector('[data-act="del"]').addEventListener('click', async () => {
        if (!confirm(`설계 "${P.title}"을(를) 삭제할까요?`)) return;
        await dbDel('plans', P.id);
        state.plans = state.plans.filter(x => x.id !== P.id);
        RENDER.design();
      });
      wrap.appendChild(el);
    });
  };

  function openPlan(id) {
    const P = state.plans.find(x => x.id === id); if (!P) return;
    openModal(P.title, `
      <div class="stack">
        <div class="grid cols-2">
          <div><label class="field">강의 제목</label><input type="text" id="plTitle" value="${esc(P.title)}"></div>
          <div><label class="field">주제/시리즈</label><input type="text" id="plTopic" value="${esc(P.topic || '')}"></div>
        </div>
        <div><label class="field">대상/길이·톤</label><input type="text" id="plAudience" value="${esc(P.audience || '')}" placeholder="예) 청년부 30명, 40분, 묵상형"></div>
        <div><label class="field">내 설계 의도 — 이 강의로 참가자가 어디까지 가길 원하는가</label>
          <textarea id="plIntent" style="min-height:80px" placeholder="예) 정보 전달이 아니라, 참가자 각자가 자기 두려움의 뿌리를 마주하고 자유의 첫걸음을 스스로 정의하게 하고 싶다.">${esc(P.intent || '')}</textarea></div>
        <div>
          <div class="row spread"><label class="field" style="margin:0">슬라이드 개요</label>
            <label class="btn sm" style="cursor:pointer">📂 .pptx 가져오기<input type="file" id="plPptx" accept=".pptx" hidden></label>
          </div>
          <textarea id="plSlides" style="min-height:140px" placeholder="[슬라이드 1] 제목…&#10;[슬라이드 2] …  — .pptx를 가져오면 자동으로 채워집니다. 발표자 노트도 함께 추출됩니다.">${esc(P.slidesText || '')}</textarea>
        </div>

        <div class="card" style="box-shadow:none">
          <div class="row spread">
            <strong>심화 설계 — 유도 방향 읽기 · 통찰 · 활동 · 책 인용</strong>
            ${P.deep ? '<span class="badge">설계 보드 생성됨</span>' : ''}
          </div>
          <p class="muted small" style="margin:6px 0 10px">슬라이드가 유도하고 있는 설계 방향을 읽어내고, 구간마다 심화 통찰·찌르는 질문·활동 가이드·전환 문장과 <b>실존하는 책 구절</b>(지어내기 금지)로 흐름을 여는 설계를 받습니다.</p>
          <div class="row">
            <button class="btn sm primary" id="plPrompt">① 심화 설계 프롬프트 복사</button>
            <button class="btn sm" id="plPaste">② 결과(JSON) 붙여넣기</button>
            ${state.settings.anthropicKey ? `<button class="btn sm green" id="plAuto">⚡ 자동 심화 설계</button>` : ''}
          </div>
        </div>

        ${P.deep ? renderDeepBoard(P.deep) : ''}

        <div class="card" style="box-shadow:none">
          <strong>슬라이드 만들기</strong>
          <p class="muted small" style="margin:6px 0 10px"><b>🎨 클로드 디자인</b>은 클로드가 레이아웃(표지·구간·인용·질문·활동·마무리)까지 설계한 걸 브랜드 디자인 .pptx로 만듭니다. 빠른 초안은 설계 보드를 그대로 나열합니다.</p>
          <div class="row">
            <button class="btn sm primary" id="plDzPrompt">🎨 ① 디자인 프롬프트 복사</button>
            <button class="btn sm" id="plDzPaste">🎨 ② 결과(JSON) → .pptx</button>
            ${state.settings.anthropicKey ? `<button class="btn sm green" id="plDzAuto">⚡ 자동 디자인 .pptx</button>` : ''}
            ${P.deep ? `<button class="btn sm ghost" id="plSlidesGen">🖼 빠른 초안</button>` : ''}
          </div>
          <div class="row" style="margin-top:8px">
            <span class="muted small">테마</span> ${themeSelectHTML('plTheme')}
          </div>
        </div>

        <div class="row">
          <button class="btn primary" id="plSave">저장</button>
          <button class="btn" id="plMd">📄 .md 내보내기</button>
          <button class="btn ghost danger right" id="plDel">삭제</button>
        </div>
        <p class="muted small" style="margin:0">.md 파일은 <b>NotebookLM 소스</b>로 바로 올릴 수 있습니다(드래그 업로드). NotebookLM이 만든 브리핑·정리는 슬라이드 개요 칸에 붙여넣어 다시 심화 설계에 쓰세요. 업로드·슬라이드 생성까지 클로드로 자동화하려면 저장소의 <b>docs/notebooklm-연동.md</b>(notebooklm-py MCP/스킬 설치법)를 참고하세요.</p>
      </div>`, () => {
      const save = async (silent) => {
        P.title = $('#plTitle').value.trim() || P.title;
        P.topic = $('#plTopic').value.trim();
        P.audience = $('#plAudience').value.trim();
        P.intent = $('#plIntent').value.trim();
        P.slidesText = $('#plSlides').value;
        P.updatedAt = nowISO();
        await dbPut('plans', P);
        if (!silent) { saveHint('설계 저장됨'); toast('저장되었습니다'); }
      };
      $('#plSave').addEventListener('click', () => save(false).then(() => { if (activeTab === 'design') RENDER.design(); }));
      $('#plDel').addEventListener('click', async () => {
        if (!confirm(`설계 "${P.title}"을(를) 삭제할까요?`)) return;
        await dbDel('plans', P.id);
        state.plans = state.plans.filter(x => x.id !== P.id);
        closeModal(); if (activeTab === 'design') RENDER.design();
      });
      $('#plPptx').addEventListener('change', async (e) => {
        const f = e.target.files[0]; if (!f) return;
        toast('슬라이드 해체 중…');
        try {
          const text = await extractPptxText(f);
          const ta = $('#plSlides');
          ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n' : '') + text;
          if (!$('#plTitle').value.trim() || $('#plTitle').value === '새 강의 설계') $('#plTitle').value = f.name.replace(/\.[^.]+$/, '');
          await save(true);
          toast('슬라이드 텍스트를 추출했습니다 (' + (text.match(/^\[슬라이드/gm) || []).length + '장)');
        } catch (err) { toast('추출 실패: ' + err.message); }
      });
      $('#plPrompt').addEventListener('click', async () => { await save(true); copy(buildDeepenPrompt(P)); });
      $('#plPaste').addEventListener('click', async () => { await save(true); openDeepenPaste(P); });
      const auto = $('#plAuto'); if (auto) auto.addEventListener('click', async () => { await save(true); autoDeepen(P, auto); });
      const md = $('#plMd'); if (md) md.addEventListener('click', async () => { await save(true); download(P.title.replace(/[^\w가-힣\- ]/g, '') + '-설계.md', buildPlanMd(P)); });
      const sg = $('#plSlidesGen'); if (sg) sg.addEventListener('click', async () => {
        await save(true);
        download(P.title.replace(/[^\w가-힣\- ]/g, '') + '-슬라이드초안.pptx', buildPptx(makeSlidesFromPlan(P)));
        toast('슬라이드 초안(.pptx)을 내보냈습니다 — PowerPoint/키노트/구글슬라이드에서 다듬으세요');
      });
      bindThemeSelect('plTheme');
      $('#plDzPrompt').addEventListener('click', async () => { await save(true); copy(buildSlideDesignPromptFromPlan(P)); });
      $('#plDzPaste').addEventListener('click', async () => { await save(true); openSlideDesignPaste(P.title); });
      const dza = $('#plDzAuto'); if (dza) dza.addEventListener('click', async () => { await save(true); autoDesignSlides(buildSlideDesignPromptFromPlan(P), P.title, dza); });
    });
  }

  function buildDeepenPrompt(P) {
    return `당신은 20년 경력의 강의 설계 컨설턴트입니다. 아래는 내가 준비 중인 강의의 슬라이드 개요와 나의 설계 의도입니다.
슬라이드를 읽고 이 강의가 유도하고 있는 설계 방향을 먼저 읽어낸 뒤, 각 구간을 더 깊게 만들어 주세요.

[목표]
- 참가자가 단조로운 이득·정보가 아니라 **깊이 있는 얻음과 통찰**을 가져가게 하는 설계.
- 구간(슬라이드 묶음)마다: 이 구간이 유도하는 것 / 한 층 더 내려간 심화 통찰 / 참가자를 찌르는 질문 / 통찰을 몸으로 겪게 하는 활동 가이드(진행 방법 포함) / 다음 구간으로의 전환 문장.
- 흐름을 열거나 풀어낼 수 있는 **실존하는 책의 구절**을 제안하세요. 정확히 기억하는 인용만 쓰고(책·저자 명시), 확실하지 않으면 인용문을 지어내지 말고 quote.text를 비우고 quote.source에 "OO의 『책』 — 이런 주제의 대목" 형태로만 제안하세요.
- 내 설계 의도를 존중하되, 의도와 슬라이드 사이의 간극(얕게 머무는 지점)을 솔직하게 지적하세요.

[출력 스키마 — 오직 JSON만, 코드펜스·설명 금지]
{"reading":{"arc":"전체 흐름을 한 문단으로 읽어낸 것","direction":"슬라이드가 유도하고 있는 설계 방향","gaps":["얕게 머무는 지점·의도와의 간극"]},
"sections":[{"slideRef":"1-3","heading":"구간 이름","induces":"유도하는 것","insight":"심화 통찰","question":"찌르는 질문","activity":"활동 가이드","quote":{"text":"인용구(확실할 때만)","source":"『책』 · 저자"},"transition":"전환 문장"}],
"closing":{"deepGain":"참가자가 최종적으로 가져갈 깊은 얻음","charge":"마지막 결단·도전 문장"}}

[강의 정보]
제목: ${P.title}
${P.topic ? '주제: ' + P.topic + '\n' : ''}${P.audience ? '대상/길이·톤: ' + P.audience + '\n' : ''}
[내 설계 의도]
${P.intent || '(미작성 — 슬라이드에서 의도를 추정하되, 추정임을 reading.direction에 밝혀 주세요)'}

[슬라이드 개요]
${P.slidesText || '(없음)'}`;
  }

  function normalizeDeep(parsed) {
    if (!parsed || typeof parsed !== 'object') return null;
    const S = (x) => String(x == null ? '' : x).trim();
    const r = parsed.reading || {};
    const deep = {
      reading: { arc: S(r.arc), direction: S(r.direction), gaps: Array.isArray(r.gaps) ? r.gaps.map(S).filter(Boolean) : [] },
      sections: [], closing: { deepGain: S((parsed.closing || {}).deepGain), charge: S((parsed.closing || {}).charge) }
    };
    (Array.isArray(parsed.sections) ? parsed.sections : []).forEach(s => {
      if (!s) return;
      deep.sections.push({
        slideRef: S(s.slideRef), heading: S(s.heading) || '구간', induces: S(s.induces),
        insight: S(s.insight), question: S(s.question), activity: S(s.activity),
        quote: s.quote ? { text: S(s.quote.text), source: S(s.quote.source) } : null,
        transition: S(s.transition)
      });
    });
    if (!deep.sections.length && !deep.reading.arc) return null;
    return deep;
  }

  function renderDeepBoard(deep) {
    const q = (s) => esc(s || '');
    return `
      <div class="card" style="box-shadow:none">
        <strong>설계 리딩</strong>
        ${deep.reading.arc ? `<p style="margin:8px 0 4px">${q(deep.reading.arc)}</p>` : ''}
        ${deep.reading.direction ? `<p class="small" style="margin:4px 0"><b>유도하고 있는 방향:</b> ${q(deep.reading.direction)}</p>` : ''}
        ${deep.reading.gaps.length ? `<div class="callout" style="margin-top:8px"><b>얕게 머무는 지점</b><ul style="margin:6px 0 0">${deep.reading.gaps.map(g => `<li>${q(g)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${deep.sections.map((s, i) => `
      <div class="item">
        <div class="it-top">
          <h3>${i + 1}. ${q(s.heading)}</h3>
          ${s.slideRef ? `<span class="badge">슬라이드 ${q(s.slideRef)}</span>` : ''}
        </div>
        ${s.induces ? `<div class="small"><b>유도:</b> ${q(s.induces)}</div>` : ''}
        ${s.insight ? `<div class="callout">💡 <b>심화 통찰</b> — ${q(s.insight)}</div>` : ''}
        ${s.question ? `<div class="small">❓ <b>찌르는 질문:</b> ${q(s.question)}</div>` : ''}
        ${s.activity ? `<div class="small">🧪 <b>활동 가이드:</b> ${q(s.activity)}</div>` : ''}
        ${s.quote && (s.quote.text || s.quote.source) ? `<div class="quoteblock">${s.quote.text ? '“' + q(s.quote.text) + '”' : '(인용 방향 제안)'}<span class="src">${q(s.quote.source)}</span></div>` : ''}
        ${s.transition ? `<div class="meta small">→ 전환: ${q(s.transition)}</div>` : ''}
      </div>`).join('')}
      ${(deep.closing.deepGain || deep.closing.charge) ? `
      <div class="card" style="box-shadow:none">
        <strong>마무리</strong>
        ${deep.closing.deepGain ? `<p style="margin:8px 0 4px"><b>깊은 얻음:</b> ${q(deep.closing.deepGain)}</p>` : ''}
        ${deep.closing.charge ? `<p class="small" style="margin:4px 0"><b>결단·도전:</b> ${q(deep.closing.charge)}</p>` : ''}
      </div>` : ''}`;
  }

  function openDeepenPaste(P) {
    openModal('심화 설계 결과(JSON) 붙여넣기 — ' + P.title, `
      <div class="stack">
        <p class="muted small">클로드가 준 JSON을 그대로 붙여넣으면 설계 보드가 만들어집니다.</p>
        <textarea id="dpIn" class="mono" style="min-height:220px" placeholder='{"reading":{...},"sections":[...],"closing":{...}}'></textarea>
        <div class="row"><button class="btn primary" id="dpApply">적용</button><button class="btn ghost" id="dpCancel">취소</button></div>
      </div>`, () => {
      $('#dpCancel').addEventListener('click', () => openPlan(P.id));
      $('#dpApply').addEventListener('click', async () => {
        const deep = normalizeDeep(extractJSON($('#dpIn').value));
        if (!deep) { toast('설계 JSON을 인식하지 못했습니다'); return; }
        P.deep = deep; P.updatedAt = nowISO();
        await dbPut('plans', P);
        saveHint('설계 보드 저장됨'); toast('설계 보드가 만들어졌습니다');
        if (activeTab === 'design') RENDER.design();
        openPlan(P.id);
      });
    });
  }

  async function autoDeepen(P, btn) {
    if (!state.settings.anthropicKey) { toast('설정에서 Anthropic API 키를 먼저 입력하세요'); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = '설계 중…';
    try {
      const text = await callClaude(buildDeepenPrompt(P), 8000);
      const deep = normalizeDeep(extractJSON(text));
      if (!deep) throw new Error('결과 파싱 실패');
      P.deep = deep; P.updatedAt = nowISO();
      await dbPut('plans', P);
      toast('심화 설계 완료');
      if (activeTab === 'design') RENDER.design();
      openPlan(P.id);
    } catch (e) { toast('자동 설계 실패: ' + e.message + ' — 프롬프트 복사 방식을 쓰세요'); }
    finally { btn.disabled = false; btn.textContent = old; }
  }

  function buildPlanMd(P) {
    let md = `# ${P.title} — 강의 설계안\n\n`;
    if (P.topic) md += `주제: ${P.topic}  \n`;
    if (P.audience) md += `대상: ${P.audience}  \n`;
    md += `\n## 설계 의도\n${P.intent || '(미작성)'}\n\n`;
    const d = P.deep;
    if (d) {
      md += `## 설계 리딩\n${d.reading.arc}\n\n**유도 방향:** ${d.reading.direction}\n`;
      if (d.reading.gaps.length) md += `\n**얕게 머무는 지점**\n${d.reading.gaps.map(g => '- ' + g).join('\n')}\n`;
      md += `\n## 구간 설계\n`;
      d.sections.forEach((s, i) => {
        md += `\n### ${i + 1}. ${s.heading}${s.slideRef ? ` (슬라이드 ${s.slideRef})` : ''}\n`;
        if (s.induces) md += `- 유도: ${s.induces}\n`;
        if (s.insight) md += `- 💡 심화 통찰: ${s.insight}\n`;
        if (s.question) md += `- ❓ 질문: ${s.question}\n`;
        if (s.activity) md += `- 🧪 활동: ${s.activity}\n`;
        if (s.quote && (s.quote.text || s.quote.source)) md += `- 📖 인용: ${s.quote.text ? '“' + s.quote.text + '” — ' : ''}${s.quote.source}\n`;
        if (s.transition) md += `- → 전환: ${s.transition}\n`;
      });
      md += `\n## 마무리\n`;
      if (d.closing.deepGain) md += `- 깊은 얻음: ${d.closing.deepGain}\n`;
      if (d.closing.charge) md += `- 결단·도전: ${d.closing.charge}\n`;
    }
    if (P.slidesText) md += `\n---\n\n## 슬라이드 개요(원본)\n\n${P.slidesText}\n`;
    return md;
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
        ${state.plans.length ? `<div style="margin-top:10px">
          <label class="field">설계 연결(선택) — 선택하면 제목·주제·의도가 채워지고, 강의 원본에 설계가 연결됩니다</label>
          <select id="recPlan"><option value="">(연결 안 함)</option>${state.plans.map(p => `<option value="${p.id}" ${rec.planId === p.id ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}</select>
        </div>` : ''}
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
    on('recPlan', 'change', (e) => {
      rec.planId = e.target.value;
      const p = state.plans.find(x => x.id === rec.planId);
      if (p) {
        if ($('#recTitle')) $('#recTitle').value = p.title;
        if ($('#recTopic')) $('#recTopic').value = p.topic || '';
        if ($('#recNotes')) $('#recNotes').value = p.intent || '';
        toast('설계가 연결되었습니다 — 제목·주제·의도를 채웠어요');
      }
    });
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
          <button class="btn sm ghost" id="lecMd" title="NotebookLM 소스로도 사용">📄 .md</button>
          ${L.hasAudio ? `<button class="btn sm ghost danger" id="lecDelAudio">🗑 오디오만 삭제</button>` : ''}
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
      $('#lecMd').addEventListener('click', async () => { await save(true); download(L.title.replace(/[^\w가-힣\- ]/g, '') + '.md', buildLectureMd(L)); });
      const da = $('#lecDelAudio'); if (da) da.addEventListener('click', async () => {
        if (!confirm('이 강의의 오디오만 삭제할까요? 자막·아톰은 유지됩니다.')) return;
        const freed = await deleteAudioOnly(L);
        toast(fmtBytes(freed) + ' 확보 — 오디오 삭제됨');
        openLecture(L.id); if (activeTab === 'lectures') RENDER.lectures();
      });
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

  /* 강의 원본 → .md (NotebookLM 소스로도 사용) */
  function buildLectureMd(L) {
    let md = `# ${L.title}\n\n`;
    const meta = [L.topic && '주제: ' + L.topic, L.date && '날짜: ' + L.date,
      (L.tags && L.tags.length) && '태그: ' + L.tags.join(', '),
      L.durationSec && '길이: ' + fmtHMS(L.durationSec)].filter(Boolean);
    if (meta.length) md += meta.join('  \n') + '\n\n';
    if (L.notes) md += `## 강의 의도\n${L.notes}\n\n`;
    if (L.markers && L.markers.length) md += `## 강의 중 마커\n${L.markers.map(m => `- ${fmtHMS(m.t)} ${m.label}`).join('\n')}\n\n`;
    md += `## 강의 내용(자막)\n\n${L.transcript || '(자막 없음)'}\n`;
    return md;
  }

  /* ============================ 원자화 프롬프트/파싱 ============================ */
  function buildAtomizePrompt(L) {
    const plan = L.planId ? state.plans.find(p => p.id === L.planId) : null;
    const meta = [
      L.title ? `강의 제목: ${L.title}` : '',
      L.topic ? `주제/시리즈: ${L.topic}` : '',
      L.date ? `날짜: ${L.date}` : '',
      (L.tags && L.tags.length) ? `태그: ${L.tags.join(', ')}` : '',
      L.notes ? `강의 의도 메모: ${L.notes}` : '',
      (plan && plan.intent && plan.intent !== L.notes) ? `설계 의도(강의 전 설계): ${plan.intent}` : '',
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
    // 원자화 완료 → 원본 오디오는 용량이 크므로 자동 삭제(설정으로 끌 수 있음)
    if (atoms.length && state.settings.autoDeleteAudio && L.hasAudio) {
      const freed = await deleteAudioOnly(L);
      if (freed) toast('원자화 완료 — 오디오 삭제로 ' + fmtBytes(freed) + ' 확보 (자막·아톰은 유지)');
    }
  }

  /* 오디오만 삭제(자막·아톰·메타 유지) — 반환: 확보한 바이트 */
  async function deleteAudioOnly(L) {
    let freed = 0;
    try { const a = await dbGet('audio', L.id); if (a && a.blob) freed = a.blob.size || 0; } catch (e) { }
    await dbDel('audio', L.id);
    L.hasAudio = false; L.audioType = '';
    await dbPut('lectures', L);
    return freed;
  }

  async function bulkDeleteAtomizedAudio() {
    const targets = state.lectures.filter(L => L.hasAudio && L.atomized);
    if (!targets.length) { toast('삭제할 오디오가 없습니다 (원자화 완료 + 오디오 보유 기준)'); return; }
    if (!confirm(targets.length + '개 강의의 오디오를 삭제합니다. 자막·아톰·설계·조립본은 유지됩니다. 계속할까요?')) return;
    let freed = 0;
    for (const L of targets) freed += await deleteAudioOnly(L);
    toast(fmtBytes(freed) + ' 확보 — 오디오 ' + targets.length + '개 삭제');
    if (activeTab === 'data') RENDER.data();
    if (activeTab === 'lectures') RENDER.lectures();
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
              <button class="btn block" id="cDzPrompt" ${picked.length ? '' : 'disabled'}>🎨 슬라이드 디자인 프롬프트</button>
              <button class="btn block" id="cDzPaste" ${picked.length ? '' : 'disabled'}>🎨 결과(JSON) → .pptx</button>
              ${state.settings.anthropicKey ? `<button class="btn green block" id="cDzAuto" ${picked.length ? '' : 'disabled'}>⚡ 자동 디자인 .pptx</button>` : ''}
              <button class="btn block ghost" id="cPptx" ${picked.length ? '' : 'disabled'}>🖼 빠른 초안(.pptx)</button>
              <div class="row"><span class="muted small">테마</span> ${themeSelectHTML('cTheme2')}</div>
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
    bind('cPptx', 'click', () => {
      download(((ui.composeTheme.trim() || '새강의')).replace(/[^\w가-힣\- ]/g, '') + '-슬라이드초안.pptx',
        buildPptx(makeSlidesFromAtoms(ui.composeTheme.trim(), ui.composeAudience.trim(), picked)));
      toast('슬라이드 초안(.pptx)을 내보냈습니다');
    });
    bindThemeSelect('cTheme2');
    bind('cDzPrompt', 'click', () => copy(buildSlideDesignPromptFromAtoms(ui.composeTheme.trim(), ui.composeAudience.trim(), picked)));
    bind('cDzPaste', 'click', () => openSlideDesignPaste(ui.composeTheme.trim() || '새강의'));
    bind('cDzAuto', 'click', (e) => autoDesignSlides(buildSlideDesignPromptFromAtoms(ui.composeTheme.trim(), ui.composeAudience.trim(), picked), ui.composeTheme.trim() || '새강의', e.currentTarget));
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
        <strong>용량 관리 — 오디오 정리</strong>
        <p class="muted small" style="margin:6px 0 10px">자막·아톰까지 만들어졌다면 원본 오디오는 지워도 됩니다. 자막·아톰·설계·조립본은 그대로 유지됩니다.</p>
        <label class="row small" style="gap:6px">
          <input type="checkbox" id="setAutoDel" ${s.autoDeleteAudio ? 'checked' : ''} style="width:auto">
          원자화가 끝나면 그 강의의 오디오를 자동 삭제
        </label>
        <div class="row" style="margin-top:10px">
          <button class="btn" id="dBulkAudio">원자화 완료된 강의의 오디오 일괄 삭제</button>
        </div>
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
        <strong>배경 사진 API (선택) — Pexels</strong>
        <p class="muted small" style="margin:6px 0 10px">키를 넣으면 슬라이드 만들 때 클로드가 추천한 검색어로 <b>주제에 맞는 무료 사진</b>(상업적 사용 가능)을 자동으로 찾아 넣습니다. 무료 발급: <span class="kbd">pexels.com/api</span>. 키가 없어도 내 사진을 직접 골라 넣을 수 있습니다.</p>
        <div><label class="field">Pexels API Key</label><input type="password" id="setPexelsKey" value="${esc(s.pexelsKey || '')}" placeholder="선택"></div>
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
    saveField('setPexelsKey', 'pexelsKey');

    bind('setAutoDel', 'change', (e) => { state.settings.autoDeleteAudio = e.target.checked; saveSettings(); saveHint('설정 저장됨'); });
    bind('dBulkAudio', 'click', bulkDeleteAtomizedAudio);
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
      lectures: state.lectures, atoms: state.atoms, compositions: state.compositions, plans: state.plans, tray: state.tray, audio: []
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
      const exPlan = new Set(state.plans.map(p => p.id));
      for (const p of (data.plans || [])) { if (!exPlan.has(p.id)) { await dbPut('plans', p); state.plans.push(p); } }
      state.plans.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
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
    await dbClear('compositions'); await dbClear('chunks'); await dbClear('plans');
    state.lectures = []; state.atoms = []; state.compositions = []; state.plans = []; state.tray = []; saveTray();
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
        planId: (meta && meta.planId) || '',
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
