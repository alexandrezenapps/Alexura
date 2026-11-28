/* ============================================================
   JIZURA — editor UI
   ============================================================ */
(() => {
'use strict';
if (!document.getElementById('app')) return;          // engine-only pages (tests)
const $ = id => document.getElementById(id);
const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
const LS_KEY = 'jizura.project.v1';
const HUD_CHARS = '0123456789:./-_()【】・No.LYRICRECUNTITLEDXYlinebpminterlude—─／ ';
const ICON = {
  dice: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor"/><circle cx="10.5" cy="10.5" r="1" fill="currentColor"/><circle cx="10.5" cy="5.5" r="1" fill="currentColor"/><circle cx="5.5" cy="10.5" r="1" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>',
  pen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z"/><path d="M9.5 4l2.5 2.5"/></svg>',
  tap: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2" fill="currentColor"/><circle cx="8" cy="8" r="5.5"/></svg>',
  range: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 3v10M13 3v10"/><path d="M5.5 8h5M8.5 5.5L11 8l-2.5 2.5"/></svg>',
};

const S = { project: null, plan: null, audio: null, audioFile: null, cloudSongId: null, cloudSongs: [], cloudHistory: [], cloudUser: null, renderer: new J.Renderer(), playing: false, playbackRate: 1, kpStageMode: 'video', kpArtworkUrl: '', t: 0, t0: 0, playStopAt: null, loop: 'all', loopHold: null, need: true, exporting: null, tap: null, slow: false, lineEls: [], curLine: -2 };
const LOOP_CYCLE = ['all', 'line', 'cut', false];
const LOOP_COPY = {
  all:  { ja: 'ループ', en: 'Loop', titleJa: '全体を繰り返し', titleEn: 'Loop the whole piece' },
  line: { ja: '行ループ', en: 'Line loop', titleJa: 'この行を繰り返し', titleEn: 'Loop this line' },
  cut:  { ja: 'カットループ', en: 'Cut loop', titleJa: 'このカットを繰り返し', titleEn: 'Loop this cut' },
  off:  { ja: 'ループ', en: 'Loop', titleJa: '繰り返しなし', titleEn: 'No loop' },
};
const isEn = () => document.documentElement.lang === 'en';
function cutAround(t) {
  const c = J.cutAt(S.plan, t);
  if (c) return c;
  const cs = S.plan.cuts;
  let ans = null;
  for (let i = 0; i < cs.length; i++) { if (cs[i].start <= t) ans = cs[i]; else break; }
  return ans;
}
function loopRange(t) {
  const T = t != null ? t : S.t;
  const endAll = S.plan.duration;
  if (S.loop === 'cut') {
    const cut = cutAround(T);
    return cut ? { start: cut.start, end: cut.end } : { start: 0, end: endAll };
  }
  if (S.loop === 'line') {
    const cut = cutAround(T);
    if (!cut || cut.line < 0) return cut ? { start: cut.start, end: cut.end } : { start: 0, end: endAll };
    const same = S.plan.cuts.filter(c => c.line === cut.line && c.layout !== 'interlude' && c.layout !== 'title');
    if (!same.length) return { start: cut.start, end: cut.end };
    return { start: same[0].start, end: same[same.length - 1].end };
  }
  return { start: 0, end: endAll };
}
function refreshLoopHold(t) {
  S.loopHold = (S.loop === 'line' || S.loop === 'cut') ? loopRange(t != null ? t : S.t) : null;
}
function activeLoopRange() {
  if ((S.loop === 'line' || S.loop === 'cut') && S.loopHold) return S.loopHold;
  return loopRange(S.t);
}
function syncLoopBtn() {
  const b = $('btnLoop'); if (!b) return;
  const key = S.loop || 'off';
  const copy = LOOP_COPY[key] || LOOP_COPY.off;
  const en = isEn();
  b.textContent = en ? copy.en : copy.ja;
  b.title = en ? copy.titleEn : copy.titleJa;
  b.setAttribute('aria-pressed', String(!!S.loop));
  b.dataset.mode = key;
  refreshLoopHold();
}

/* WebAudio player (works inside sandboxed pages where blob media may be blocked) */
const AP = {
  ctx: null, src: null, startAt: 0, base: 0, rate: 1, gain: null, analyser: null, freqBins: null, vol: 0.8, muted: false,
  play(buffer, offset, rate = 1) {
    if (!buffer) return;
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    this.stop();
    if (!this.gain) {
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 256;
      this.analyser.smoothingTimeConstant = 0.78;
      this.freqBins = new Uint8Array(this.analyser.frequencyBinCount);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
      this.applyVol();
    }
    const s = this.ctx.createBufferSource(); s.buffer = buffer; s.connect(this.gain);
    const maxOff = Math.max(0, (Number(buffer.duration) || 0) - 0.01);
    const off = Math.max(0, Math.min(Number(offset) || 0, maxOff));
    this.rate = rate > 0 ? rate : 1; s.playbackRate.value = this.rate;
    s.start(0, off); this.src = s; this.startAt = this.ctx.currentTime; this.base = off;
  },
  setRate(rate) {
    const r = Math.max(0.25, Math.min(2.5, Number(rate) || 1));
    if (this.ctx && this.src) {
      const curPos = this.time();
      this.base = curPos;
      this.startAt = this.ctx.currentTime;
      this.rate = r;
      try { this.src.playbackRate.setTargetAtTime(r, this.ctx.currentTime, 0.01); } catch (e) { this.src.playbackRate.value = r; }
    } else {
      this.rate = r;
    }
  },
  getSpectrum() {
    if (!this.analyser || !this.freqBins || !S.playing) return null;
    try {
      this.analyser.getByteFrequencyData(this.freqBins);
      return this.freqBins;
    } catch (e) {
      return null;
    }
  },
  stop() { if (this.src) { try { this.src.stop(); } catch (e) {} try { this.src.disconnect(); } catch (e) {} this.src = null; } },
  time() { return this.ctx ? this.base + (this.ctx.currentTime - this.startAt) * this.rate : 0; },
  /* preview volume only (exports keep the original level) */
  setVol(v, muted) { if (v != null) this.vol = Math.max(0, Math.min(1, v)); if (muted != null) this.muted = !!muted; this.applyVol(); },
  applyVol() { if (!this.gain) return; const v = this.muted ? 0 : this.vol * this.vol; try { this.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015); } catch (e) { this.gain.gain.value = v; } },
};
/* Volume preview: synced across main transport bar & Karaoke Player deck */
function initVolume() {
  const el = $('vol'), mb = $('btnMute'), kpEl = $('kpVolRange'), kpMb = $('kpBtnMute');
  if (!el && !kpEl) return;
  let v = 0.8, m = false;
  try { const o = JSON.parse(localStorage.getItem('jizura.previewVolume') || 'null'); if (o) { v = +o.v; m = !!o.m; } } catch (e) {}
  if (!(v >= 0 && v <= 1)) v = 0.8;
  const show = () => {
    const pct = Math.round(AP.vol * 100);
    const isMuted = AP.muted || AP.vol === 0;
    if (el) { el.value = pct; el.title = 'Volume ' + pct + '%'; }
    if (mb) { mb.textContent = isMuted ? '消音' : '音量'; mb.setAttribute('aria-pressed', String(AP.muted)); }
    if (kpEl) { kpEl.value = pct; kpEl.title = pct + '%'; }
    if (kpMb) { kpMb.textContent = isMuted ? '🔇' : '🔊'; kpMb.setAttribute('aria-pressed', String(AP.muted)); }
  };
  const save = () => { try { localStorage.setItem('jizura.previewVolume', JSON.stringify({ v: AP.vol, m: AP.muted })); } catch (e) {} };
  AP.setVol(v, m); show();
  if (el) el.addEventListener('input', () => { AP.setVol(el.value / 100, false); show(); save(); });
  if (mb) mb.addEventListener('click', () => { AP.setVol(null, !AP.muted); show(); save(); });
  if (kpEl) kpEl.addEventListener('input', () => { AP.setVol(kpEl.value / 100, false); show(); save(); });
  if (kpMb) kpMb.addEventListener('click', () => { AP.setVol(null, !AP.muted); show(); save(); });
}

/* ---------------- project persistence ---------------- */
function mergeProject(p) {
  const defs = J.defaultProject();
  const d = J.defaultProject();
  const o = Object.assign(d, p || {});
  o.fx = Object.assign(defs.fx, (p && p.fx) || {});
  o.timing = Object.assign(defs.timing, (p && p.timing) || {});
  if (!o.timing.lineEnds || typeof o.timing.lineEnds !== 'object') o.timing.lineEnds = {};
  if (!o.timing.wordTimes || typeof o.timing.wordTimes !== 'object') o.timing.wordTimes = {};
  if (!o.timing.lineMeta || typeof o.timing.lineMeta !== 'object') o.timing.lineMeta = {};
  o.detection = (p && p.detection && typeof p.detection === 'object') ? p.detection : null;
  o.karaoke = p && typeof p.karaoke === 'boolean' ? p.karaoke : true;
  const kc = (p && p.karaokeCfg && typeof p.karaokeCfg === 'object') ? p.karaokeCfg : {};
  const defKc = defs.karaokeCfg || { mode: 'progressive', fontSize: 1.0, yPct: 86, autoScroll: true, baseColor: '', activeColor: '', bgAlpha: 0.78 };
  o.karaokeCfg = {
    mode: kc.mode === 'word' || kc.mode === 'progressive' || kc.mode === 'char' ? kc.mode : defKc.mode,
    fontSize: J.clamp(isFinite(+kc.fontSize) ? +kc.fontSize : defKc.fontSize, 0.65, 1.85),
    yPct: J.clamp(isFinite(+kc.yPct) ? +kc.yPct : defKc.yPct, 10, 92),
    autoScroll: typeof kc.autoScroll === 'boolean' ? kc.autoScroll : true,
    baseColor: typeof kc.baseColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(kc.baseColor) ? kc.baseColor : '',
    activeColor: typeof kc.activeColor === 'string' && /^#[0-9a-f]{3,8}$/i.test(kc.activeColor) ? kc.activeColor : '',
    bgAlpha: J.clamp(isFinite(+kc.bgAlpha) ? +kc.bgAlpha : defKc.bgAlpha, 0, 1),
  };
  const tr = (p && p.translation && typeof p.translation === 'object') ? p.translation : {};
  const defTr = defs.translation || {
    enabled: false,
    targetLang: 'fr',
    lines: {},
    cfg: { fontSize: 0.78, yPct: 76, position: 'below', color: '', bgAlpha: 0.72, italic: false, showInPrompter: true, showInVideo: true },
  };
  const trLines = {};
  if (tr.lines && typeof tr.lines === 'object') {
    for (const [k, v] of Object.entries(tr.lines)) {
      if (typeof v === 'string' && v.trim()) trLines[k] = v;
    }
  }
  const trCfg = (tr.cfg && typeof tr.cfg === 'object') ? tr.cfg : {};
  const defTrCfg = defTr.cfg || { fontSize: 0.78, yPct: 76, position: 'below', color: '', bgAlpha: 0.72, italic: false, showInPrompter: true, showInVideo: true };
  o.translation = {
    enabled: Boolean(tr.enabled),
    targetLang: typeof tr.targetLang === 'string' && J.LANG_LABEL[tr.targetLang] && tr.targetLang !== 'auto' && tr.targetLang !== 'multi' ? tr.targetLang : defTr.targetLang,
    lines: trLines,
    cfg: {
      fontSize: J.clamp(isFinite(+trCfg.fontSize) ? +trCfg.fontSize : defTrCfg.fontSize, 0.5, 1.5),
      yPct: J.clamp(isFinite(+trCfg.yPct) ? +trCfg.yPct : defTrCfg.yPct, 8, 94),
      position: trCfg.position === 'above' || trCfg.position === 'below' || trCfg.position === 'custom' ? trCfg.position : defTrCfg.position,
      color: typeof trCfg.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(trCfg.color) ? trCfg.color : '',
      bgAlpha: J.clamp(isFinite(+trCfg.bgAlpha) ? +trCfg.bgAlpha : defTrCfg.bgAlpha, 0, 1),
      italic: typeof trCfg.italic === 'boolean' ? trCfg.italic : false,
      showInPrompter: typeof trCfg.showInPrompter === 'boolean' ? trCfg.showInPrompter : true,
      showInVideo: typeof trCfg.showInVideo === 'boolean' ? trCfg.showInVideo : true,
    },
  };
  const en = J.defaultProject().enabled;
  for (const g of Object.keys(en)) en[g] = Object.assign(en[g], ((p && p.enabled) || {})[g] || {});
  o.enabled = en;
  o.overrides = (p && p.overrides) || {};
  o.locks = { tech: {}, params: {} };
  // project files are untrusted: only plain keys may be locked, and only on (never a value we did not write)
  for (const [g, on] of Object.entries((p && p.locks && p.locks.tech) || {})) if (on === true && /^[\w-]+$/.test(g)) o.locks.tech[g] = true;
  for (const [k, on] of Object.entries((p && p.locks && p.locks.params) || {})) if (on === true && /^[\w-]+$/.test(k)) o.locks.params[k] = true;
  delete o.appVersion;
  // project files are untrusted: colours must be colours, font keys plain keys (they end up in the page's HTML / CSS)
  o.colors = { enabled: !!(p && p.colors && p.colors.enabled) };
  for (const [k, v] of Object.entries((p && p.colors) || {})) {
    if (k === 'enabled') continue;
    if (k === 'schemeShift' && Number.isInteger(v)) o.colors.schemeShift = v;
    else if (typeof v === 'boolean') o.colors[k] = v;
    else if (typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v)) o.colors[k] = v;
  }
  o.userFonts = (Array.isArray(p && p.userFonts) ? p.userFonts : []).filter(uf => uf && J.SAFE_FONT_KEY.test(uf.key))
    .map(uf => ({ key: uf.key, label: String(uf.label || uf.key).slice(0, 80), family: J.safeFamily(uf.family || uf.key.slice(5)), weight: J.clamp(parseInt(uf.weight, 10) || 400, 100, 900) }));
  for (const uf of o.userFonts) if (!J.FONTS[uf.key]) J.addUserFont(uf.key, uf.label, uf.family, uf.weight);
  migrateOrder(o, p);
  o.themeId = p && typeof p.themeId === 'string' && J.THEMES && J.THEMES[p.themeId] ? p.themeId : null;
  o.fonts = {};
  for (const [role, k] of Object.entries((p && p.fonts) || {})) {
    if (!/^[\w-]+$/.test(role)) continue;
    if (Array.isArray(k)) {
      const valid = k.filter(x => typeof x === 'string' && J.FONTS[x]);
      if (valid.length) o.fonts[role] = valid;
    } else if (typeof k === 'string' && J.FONTS[k]) o.fonts[role] = k;
  }
  return o;
}
/* v0.10: untagged lines of an LRC text now stay where they are written — move per-line settings of older projects along */
function migrateOrder(o, p) {
  const was = p && p.timingOrder; o.timingOrder = 2;
  if (!p || was === 2) return;
  const map = J.parseOrderV1(o.lyrics || ''); if (!map) return;
  const mv = obj => { const r = {}; for (const [k, v] of Object.entries(obj || {})) { const i = +k; r[Number.isInteger(i) && map[i] != null ? map[i] : k] = v; } return r; };
  o.timing.lineTimes = mv(o.timing.lineTimes); o.overrides = mv(o.overrides);
  const R = o.exportRange;
  if (R && Number.isInteger(R.from) && Number.isInteger(R.to)) {
    const idx = []; for (let i = R.from; i <= R.to && i < map.length; i++) idx.push(map[i]);
    o.exportRange = idx.length ? { from: Math.min(...idx), to: Math.max(...idx) } : null;
  }
}
const SET_UI = { horror: { name: 'ホラー', badge: 'ホ' }, typo: { name: '文字PV系', badge: '文' }, kinetic: { name: 'キネティック', badge: 'キ' }, extra2: { name: '追加分2', badge: '追2' } };
function setBadges(d) {
  return (d && d.extra ? '<span class="set-badge ex" title="最初の公開版のあとに追加">追加</span>' : '') + (d && d.wa ? '<span class="set-badge" title="和風の演出">和</span>' : '')
    + (d && d.set && SET_UI[d.set] ? `<span class="set-badge set-${d.set}" title="${SET_UI[d.set].name}">${SET_UI[d.set].badge}</span>` : '')
    + (d && d.x2 && d.set !== 'extra2' ? `<span class="set-badge set-extra2" title="${SET_UI.extra2.name}">${SET_UI.extra2.badge}</span>` : '');
}
function loadLocal() { try { const s = localStorage.getItem(LS_KEY); if (s) return mergeProject(JSON.parse(s)); } catch (e) {} return mergeProject(null); }
let saveTimer = 0;
let cloudSaveTimer = 0;
function autosave() { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 700); }
function flushSave() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(LS_KEY, JSON.stringify(S.project)); } catch (e) {}
  if (S.cloudUser && S.cloudSongId && $('chkFbAutoSave') && $('chkFbAutoSave').checked && window.AlexuraCloud) {
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => {
      if (S.cloudUser && S.cloudSongId) saveCurrentSongToFirebase(false, true);
    }, 2400);
  }
}
window.addEventListener('pagehide', () => { if (S.project) flushSave(); });

/* ---------------- planning ---------------- */
function audioLike() {
  const T = S.project.timing;
  if (S.audio) {
    const a = Object.assign({}, S.audio);
    if (T.bpm > 0) a.beats = J.beatGrid(T.bpm, T.beatOffset || 0, S.audio.duration);
    return a;
  }
  if (T.bpm > 0) return { beats: J.beatGrid(T.bpm, T.beatOffset || 0, 600) };
  return null;
}
/* 自動判定・多言語のとき、判定結果を言語欄の横に出す */
function langNote() {
  const el = $('langNote');
  const pillsEl = $('detectedLangPills');
  const info = J.resolveLangInfo ? J.resolveLangInfo(S.project) : { primary: J.resolveLang(S.project), detectedLanguages: [J.resolveLang(S.project)], isMixed: false };
  const curMode = (S.project && S.project.lang) || 'auto';
  if (el) {
    if (curMode === 'auto' || curMode === 'multi') {
      const names = (info.detectedLanguages || []).map(c => J.LANG_LABEL[c] || c);
      el.textContent = info.isMixed
        ? '→ Mix : ' + names.join(' + ')
        : '→ ' + (J.LANG_LABEL[info.primary] || info.primary);
    } else {
      el.textContent = info.isMixed ? ('(' + (info.detectedLanguages || []).map(c => J.LANG_LABEL[c] || c).join(' + ') + ')') : '';
    }
  }
  if (pillsEl) {
    const langs = (info.detectedLanguages || []).filter(c => c && c !== 'auto' && c !== 'multi');
    const showPills = langs.length > 1 || (langs.length === 1 && (curMode === 'auto' || curMode === 'multi' || (S.project.detection && S.project.detection.source === 'ai')));
    if (showPills) {
      let html = info.isMixed ? `<span class="lang-pill is-mixed">Mix ×${langs.length}</span>` : '';
      html += langs.map(c => `<span class="lang-pill">${escapeHtml(J.LANG_LABEL[c] || c)}</span>`).join('');
      pillsEl.innerHTML = html;
      pillsEl.hidden = false;
    } else {
      pillsEl.innerHTML = '';
      pillsEl.hidden = true;
    }
  }
  if (langNote.last !== undefined && langNote.last !== J.lang) { try { renderFontRoles(); } catch (e) {} }   // font menus show the language's faces
  langNote.last = J.lang;
}
let tlPlanRev = 0;
function replan() {
  tlPlanRev++;
  S.plan = J.plan(S.project, audioLike());
  // lines locked in older projects (seed only): take a snapshot now, so from here on they stay exactly as they are
  for (const [i, o] of Object.entries(S.project.overrides || {})) if (o && o.lock && !Array.isArray(o.lockedCuts)) { const snap = J.lineSnapshot(S.plan, +i); if (snap) o.lockedCuts = snap; }
  langNote();
  if (S.t > S.plan.duration) S.t = 0;
  refreshLoopHold();
  renderLines(); sizeViewport(); drawTimeline(); updateTimeUI(); syncLyricsEditor();
  lastCutIdx = -2;
  lastKpState = { key: '' };
  updateKaraokePrompter();
  if (typeof cutPick !== 'undefined' && cutPick.g) fillCutPick();
  S.need = true; autosave(); ensureFonts(); drawSwatch(); showNow();
  clearTimeout(warmTimer); warmTimer = setTimeout(warm, 450);
}
/* pre-decompose glyphs used by piece animations while the editor is idle, so playback does not hitch */
let warmTimer = 0, warmJob = 0;
function warm() {
  const job = ++warmJob;
  const cuts = S.plan.cuts.filter(c => c.enter === 'assemble' || ['explode', 'fall', 'drift'].includes(c.exit));
  const src = $('view');
  const cv = document.createElement('canvas'); cv.width = src.width; cv.height = src.height;
  const ctx = cv.getContext('2d');
  let i = 0;
  const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(() => f(null), 40);
  const step = (deadline) => {
    if (job !== warmJob || S.exporting) return;
    do {
      const c = cuts[i++]; if (!c) break;
      const ts = [];
      if (c.enter === 'assemble') ts.push(c.start + Math.min(c.inDur * 0.3, c.dur * 0.2));
      if (c.outDur > 0) ts.push(c.end - c.outDur * 0.5);
      for (const t of ts) { try { S.renderer.frame(ctx, S.plan, t, { scale: cv.width / S.plan.W, fast: true, noHud: true, noGhost: true }); } catch (e) {} }
    } while (i < cuts.length && deadline && deadline.timeRemaining() > 10);
    if (i < cuts.length) idle(step);
  };
  idle(step);
}
let replanTimer = 0;
const replanSoon = (ms = 220) => { clearTimeout(replanTimer); replanTimer = setTimeout(replan, ms); };
let fontKey = '';
let thumbFonts = null;
async function ensureFonts() {
  const txt = S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS;
  const keys = J.fontsOfPlan(S.plan);                       // only the faces this plan draws with
  const key = txt + '|' + keys.join(',') + '|' + Object.keys(J.FONTS).length + '|' + J.lang;   // the lyric language changes the faces
  if (key === fontKey) return;
  fontKey = key;
  showMsg('フォントを読み込み中…');
  try { await J.ensureFonts(txt, keys); } catch (e) {}
  showMsg(null); S.need = true; drawStyleGrid(); loadThumbFonts();
}
// style thumbnails need two glyphs of every style's display face — fetched only once the style grid is actually shown
function loadThumbFonts() {
  if (thumbFonts || !$('styleGrid').offsetParent) return;
  thumbFonts = J.ensureFonts('字面', [...new Set(J.STYLE_ORDER.map(k => J.STYLES[k].fonts.display[0]))]).then(() => drawStyleGrid()).catch(() => {});
}
function showMsg(m) { const el = $('viewMsg'); if (!m) { el.hidden = true; return; } el.textContent = m; el.hidden = false; }

/* ---------------- viewport & drawing ---------------- */
// 固定表示: on wide & tall windows the page itself doesn't scroll (see style.css html.fixed-ok)
const FIXED_MQ = window.matchMedia ? window.matchMedia('(min-width: 1181px) and (min-height: 620px)') : null;
document.documentElement.classList.add('fixed-ok');
function fixedLayout() { return !!(FIXED_MQ && FIXED_MQ.matches) && document.documentElement.classList.contains('fixed-ok'); }
function sizeViewport() {
  const vp = $('viewport'), c = $('view');
  if (!vp || !c) return;
  const ar = S.plan.W / S.plan.H;
  let cssW = vp.clientWidth || 800, cssH = cssW / ar;
  // fixed workspace or full-screen karaoke: respect the viewport container height
  const inFs = !!(vp.closest('.col-stage') && vp.closest('.col-stage').classList.contains('is-karaoke-fs'));
  const maxH = (fixedLayout() || inFs) ? Math.max(160, vp.clientHeight - 2) : Math.max(220, window.innerHeight * 0.68);
  if (cssH > maxH) { cssH = maxH; cssW = cssH * ar; }
  const roundW = Math.max(10, Math.round(cssW));
  const roundH = Math.max(10, Math.round(cssH));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const pw = Math.round(Math.min(S.plan.W, roundW * dpr)), ph = Math.round(pw / ar);
  let changed = false;
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; changed = true; }
  const wPx = roundW + 'px', hPx = roundH + 'px';
  if (c.style.width !== wPx) { c.style.width = wPx; changed = true; }
  if (c.style.height !== hPx) { c.style.height = hPx; changed = true; }
  if (changed) S.need = true;
}
// preview only: dotted outline of the centre that 中央を空ける keeps free (never in exports)
function drawCenterGuide(ctx, k) {
  const P = S.plan, z = P.zones; if (!z) return;
  const r = z[0].side === 'left' ? [z[0].w, 0, P.W - z[0].w - z[1].w, P.H] : [0, z[0].h, P.W, P.H - z[0].h - z[1].h];
  ctx.save(); ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.setLineDash([14, 10]); ctx.lineWidth = 2 / k * 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeRect(r[0] + 4, r[1] + 4, r[2] - 8, r[3] - 8);
  ctx.setLineDash([]); ctx.restore();
}
function draw() {
  const c = $('view'), ctx = c.getContext('2d');
  const t0 = performance.now();
  S.renderer.frame(ctx, S.plan, S.t, { scale: c.width / S.plan.W, fast: S.playing && S.slow });
  if (S.plan.centerFree) drawCenterGuide(ctx, c.width / S.plan.W);
  const dt = performance.now() - t0;
  S.slow = S.playing ? (dt > 30 ? true : dt < 14 ? false : S.slow) : false;
  updateTimeUI(); drawTimeline(); updateCutInfo(); updateKaraokePrompter();
}
function tick(now) {
  requestAnimationFrame(tick);
  if (S.exporting) return;
  if (S.playing) {
    // rAF timestamps can precede the moment play()/seek() stamped t0 → clamp so t never goes negative
    let t = Math.max(0, S.audio ? AP.time() : (now - S.t0) / 1000 * playRate());
    if (S.playStopAt != null && t >= S.playStopAt - 1e-3) {
      const stopAt = S.playStopAt;
      S.playStopAt = null;
      pause();
      seek(stopAt);
      return;
    }
    const range = activeLoopRange();
    if (t >= range.end - 1e-3) {
      if (S.loop && !S.tap) { seek(range.start); t = range.start; }
      else { pause(); t = Math.min(t, S.plan.duration - 1e-3); if (S.tap) stopTap(); }
    }
    S.t = t; S.need = true;
    followTlPlayhead();
  }
  if (S.tap) updateTapTelemetry(S.t);
  if (S.playing || S.kpStageMode === 'visual' || S.need) drawKaraokeVisualizers(now);
  if (S.need) { S.need = false; draw(); }
}
let lastTimeMsTxt = '', lastDurMsTxt = '';
function updateTimeUI() {
  const curStr = J.fmtTime(S.t), durStr = J.fmtTime(S.plan.duration);
  $('timeNow').textContent = curStr;
  $('timeDur').textContent = durStr;
  if ($('kpTimeNow')) $('kpTimeNow').textContent = curStr;
  if ($('kpTimeDur')) $('kpTimeDur').textContent = durStr;
  if (J.fmtTimeMs) {
    const pMs = J.fmtTimeMs(S.t);
    if (pMs !== lastTimeMsTxt && $('tlPlayMs')) { lastTimeMsTxt = pMs; $('tlPlayMs').textContent = pMs; }
    const dMs = J.fmtTimeMs(S.plan.duration);
    if (dMs !== lastDurMsTxt && $('tlDurMs')) { lastDurMsTxt = dMs; $('tlDurMs').textContent = dMs; }
  }
  const frac = S.t / Math.max(0.001, S.plan.duration);
  const sVal = String(Math.round(J.clamp(frac, 0, 1) * 10000));
  if (!S.scrubbing) {
    $('scrub').value = sVal;
    if ($('kpProgress')) $('kpProgress').value = sVal;
  }
  if ($('kpProgWrap')) $('kpProgWrap').style.setProperty('--kp-pct', (J.clamp(frac, 0, 1) * 100).toFixed(2) + '%');
}
// Playback speed: honors active tap sync speed during tap mode, otherwise S.playbackRate
const playRate = () => (S.tap && S.tap.rate > 0 ? S.tap.rate : (S.playbackRate > 0 ? S.playbackRate : 1));
function syncPlayButtonsUI() {
  const sym = S.playing ? '❚❚' : '▶';
  const lbl = S.playing ? 'Pause' : 'Lecture';
  if ($('btnPlay')) { $('btnPlay').textContent = sym; $('btnPlay').setAttribute('aria-label', lbl); }
  if ($('kpBtnPlay')) { $('kpBtnPlay').textContent = sym; $('kpBtnPlay').setAttribute('aria-label', lbl); }
  if ($('kpVisualStage')) $('kpVisualStage').classList.toggle('is-playing', !!S.playing);
}
function play() {
  refreshLoopHold();
  if (S.audio) AP.play(S.audio.buffer, S.t, playRate());
  else S.t0 = performance.now() - S.t * 1000 / playRate();
  S.playing = true; syncPlayButtonsUI();
  if (S.tap) syncTapTransportBtn();
}
function pause() {
  S.playStopAt = null;
  S.playing = false; AP.stop();
  syncPlayButtonsUI(); S.need = true;
  if (S.tap) syncTapTransportBtn();
}
function seek(t) {
  const dur = (S.plan && S.plan.duration) ? S.plan.duration : 0;
  S.t = J.clamp(t, 0, Math.max(0, dur - 1e-3));
  if (S.audio) { if (S.playing) AP.play(S.audio.buffer, S.t, playRate()); }
  else S.t0 = performance.now() - S.t * 1000 / playRate();
  refreshLoopHold();
  updateTimeUI();
  updateKaraokePrompter();
  if (S.tap) updateTapTelemetry(S.t);
  S.need = true;
}
function playRange(startSec, endSec) {
  const s = J.clamp(Number(startSec) || 0, 0, Math.max(0, (S.plan && S.plan.duration) ? S.plan.duration - 0.02 : 600));
  const e = Math.max(s + 0.06, Number(endSec) || (s + 0.4));
  S.playStopAt = e;
  seek(s);
  play();
}

/* ---------------- Live Karaoke Prompter (Mode A/B/C, Auto-Scroll & Full-Screen) ---------------- */
let lastKpState = { key: '', mode: '' };
let lastKpScrollSig = '';
let lastKpScrollIdx = -2;
function getKaraokeCfg() {
  const def = { mode: 'progressive', fontSize: 1.0, yPct: 86, autoScroll: true, baseColor: '', activeColor: '', bgAlpha: 0.78 };
  return (S.project && S.project.karaokeCfg) ? Object.assign(def, S.project.karaokeCfg) : def;
}
function applyKaraokeLabels() {
  const lang = (document.documentElement.lang || 'fr').toLowerCase();
  const isFr = lang.startsWith('fr'), isEn = lang.startsWith('en'), isZh = lang.startsWith('zh'), isKo = lang.startsWith('ko'), isId = lang.startsWith('id'), isVi = lang.startsWith('vi');
  const copy = isFr ? {
    title: '🎤 Karaoké', word: 'Mot', prog: 'Progressif', char: 'Caractère', cfg: '⚙ Réglages',
    fsOn: '✕ Quitter plein écran', fsOff: '⛶ Plein écran', size: 'Taille', pos: 'Position', bg: 'Fond',
    base: 'Texte', active: 'Chanté', scroll: 'Défilement auto', top: 'Haut', mid: 'Centre', bot: 'Bas',
    syncMaster: 'Synchro Chant↔Affichage', tapWord: '⏱ Caler mot ici', autoAlign: '⚡ Auto-Calage Voix',
    stageVid: 'Vidéo', stageAud: 'Audio', speed: 'Vitesse', wordsCfg: '⚙ Mots', coverBtn: 'Pochette',
  } : isEn ? {
    title: '🎤 Karaoke', word: 'Word', prog: 'Progressive', char: 'Char', cfg: '⚙ Settings',
    fsOn: '✕ Exit Fullscreen', fsOff: '⛶ Fullscreen', size: 'Size', pos: 'Position', bg: 'Backdrop',
    base: 'Base', active: 'Active', scroll: 'Auto-scroll', top: 'Top', mid: 'Center', bot: 'Bottom',
    syncMaster: 'Vocal↔Display Sync', tapWord: '⏱ Pin word here', autoAlign: '⚡ Auto-Align Vocals',
    stageVid: 'Video', stageAud: 'Audio', speed: 'Speed', wordsCfg: '⚙ Words', coverBtn: 'Cover',
  } : isZh ? {
    title: '🎤 卡拉OK同步', word: '逐词', prog: '渐进', char: '逐字', cfg: '⚙ 样式设置',
    fsOn: '✕ 退出全屏', fsOff: '⛶ 全屏卡拉OK', size: '字号', pos: '位置', bg: '透明度',
    base: '未唱', active: '高亮', scroll: '自动滚动', top: '上', mid: '中', bot: '下',
    syncMaster: '歌声↔歌词微调', tapWord: '⏱ 锁定当前词', autoAlign: '⚡ 人声自动精对齐',
    stageVid: '视频', stageAud: '封面声波', speed: '倍速', wordsCfg: '⚙ 词高亮', coverBtn: '更换封面',
  } : isKo ? {
    title: '🎤 노래방 싱크', word: '단어별', prog: '점진적', char: '글자별', cfg: '⚙ 설정',
    fsOn: '✕ 전체화면 종료', fsOff: '⛶ 전체화면', size: '크기', pos: '위치', bg: '배경',
    base: '기본색', active: '하이라이트', scroll: '자동 스크롤', top: '상', mid: '중', bot: '하',
    syncMaster: '보컬↔가사 싱크', tapWord: '⏱ 현재 단어 고정', autoAlign: '⚡ 보컬 자동 정렬',
    stageVid: '비디오', stageAud: '앨범/파형', speed: '속도', wordsCfg: '⚙ 단어설정', coverBtn: '앨범 커버',
  } : isId ? {
    title: '🎤 Karaoke', word: 'Kata', prog: 'Progresif', char: 'Huruf', cfg: '⚙ Pengaturan',
    fsOn: '✕ Keluar Layar Penuh', fsOff: '⛶ Layar Penuh', size: 'Ukuran', pos: 'Posisi', bg: 'Latar',
    base: 'Teks', active: 'Aktif', scroll: 'Gulir Otomatis', top: 'Atas', mid: 'Tengah', bot: 'Bawah',
    syncMaster: 'Sinkron Vokal↔Lirik', tapWord: '⏱ Tandai Kata', autoAlign: '⚡ Selaraskan Vokal',
    stageVid: 'Video', stageAud: 'Audio', speed: 'Kecepatan', wordsCfg: '⚙ Kata', coverBtn: 'Sampul',
  } : isVi ? {
    title: '🎤 Karaoke', word: 'Theo từ', prog: 'Từng nhịp', char: 'Theo ký tự', cfg: '⚙ Cài đặt',
    fsOn: '✕ Thoát toàn màn hình', fsOff: '⛶ Toàn màn hình', size: 'Cỡ chữ', pos: 'Vị trí', bg: 'Nền',
    base: 'Chữ thường', active: 'Đang hát', scroll: 'Tự cuộn', top: 'Trên', mid: 'Giữa', bot: 'Dưới',
    syncMaster: 'Đồng bộ Giọng↔Lời', tapWord: '⏱ Khớp từ tại đây', autoAlign: '⚡ Tự khớp giọng hát',
    stageVid: 'Video', stageAud: 'Âm thanh', speed: 'Tốc độ', wordsCfg: '⚙ Tô từ', coverBtn: 'Ảnh bìa',
  } : {
    title: '🎤 カラオケ同期', word: '単語別', prog: 'プログレッシブ', char: '文字別', cfg: '⚙ 設定',
    fsOn: '✕ 全画面終了', fsOff: '⛶ 全画面', size: '文字サイズ', pos: '表示位置', bg: '背景透過',
    base: '通常色', active: '強調色', scroll: '自動スクロール', top: '上', mid: '中央', bot: '下',
    syncMaster: 'ボーカル↔表示補正', tapWord: '⏱ 今の単語を固定', autoAlign: '⚡ 声に自動フィット',
    stageVid: '動画', stageAud: '波形/アート', speed: '速度', wordsCfg: '⚙ ハイライト', coverBtn: 'ジャケット',
  };
  const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  setT('kpTitle', copy.title);
  setT('btnKaraokeCfg', copy.cfg);
  setT('lblKFontSize', copy.size);
  setT('lblKPosY', copy.pos);
  setT('lblKBgAlpha', copy.bg);
  setT('lblKBaseColor', copy.base);
  setT('lblKActiveColor', copy.active);
  setT('lblKAutoScroll', copy.scroll);
  setT('lblKpSyncMaster', copy.syncMaster);
  setT('btnKpTapWord', copy.tapWord);
  setT('btnKpAutoAlign', copy.autoAlign);
  setT('kpStageBtnVideo', copy.stageVid);
  setT('kpStageBtnVisual', copy.stageAud);
  setT('lblKpSpeed', copy.speed);
  setT('kpBtnHighlightCfg', copy.wordsCfg);
  setT('kpStageArtOverlay', copy.coverBtn);
  const seg = $('kModeSeg');
  if (seg) {
    const bw = seg.querySelector('[data-kmode="word"]'), bp = seg.querySelector('[data-kmode="progressive"]'), bc = seg.querySelector('[data-kmode="char"]');
    if (bw) bw.textContent = copy.word;
    if (bp) bp.textContent = copy.prog;
    if (bc) bc.textContent = copy.char;
  }
  const py = document.querySelectorAll('.kp-presets [data-ky]');
  py.forEach(b => {
    const v = b.dataset.ky;
    b.textContent = v === '14' ? copy.top : v === '50' ? copy.mid : copy.bot;
  });
  const fsBtn = $('btnKaraokeFs'), kpFsBtn = $('kpBtnFs'), stg = document.querySelector('.col-stage');
  const isFs = !!(stg && stg.classList.contains('is-karaoke-fs'));
  if (fsBtn) {
    fsBtn.textContent = isFs ? copy.fsOn : copy.fsOff;
    fsBtn.setAttribute('aria-pressed', String(isFs));
  }
  if (kpFsBtn) {
    kpFsBtn.textContent = isFs ? '✕' : '⛶';
    kpFsBtn.setAttribute('aria-pressed', String(isFs));
    kpFsBtn.title = isFs ? copy.fsOn : copy.fsOff;
  }
}
function applyKaraokeStyleVars() {
  const kp = $('karaokePrompter');
  if (!kp) return;
  const cfg = getKaraokeCfg();
  kp.dataset.kmode = cfg.mode;
  kp.style.setProperty('--k-size', String(cfg.fontSize));
  const fs = !!(kp.closest('.col-stage') && kp.closest('.col-stage').classList.contains('is-karaoke-fs'));
  const alpha = cfg.bgAlpha <= 0.02 ? 0 : (fs ? cfg.bgAlpha : Math.max(0.18, cfg.bgAlpha));
  kp.style.setProperty('--k-bg-alpha', cfg.bgAlpha <= 0.02 ? '0' : alpha.toFixed(2));
  kp.dataset.bgClear = cfg.bgAlpha <= 0.02 ? 'true' : 'false';
  if (cfg.baseColor) kp.style.setProperty('--k-base', cfg.baseColor);
  else kp.style.removeProperty('--k-base');
  if (cfg.activeColor) kp.style.setProperty('--k-active', cfg.activeColor);
  else kp.style.removeProperty('--k-active');
}
function syncKaraokeControls() {
  if (!S.project) return;
  const cfg = getKaraokeCfg();
  applyKaraokeLabels();
  applyKaraokeStyleVars();
  const seg = $('kModeSeg');
  if (seg) seg.querySelectorAll('button[data-kmode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.kmode === cfg.mode)));
  if ($('kFontSize')) $('kFontSize').value = String(cfg.fontSize);
  if ($('kFontSizeVal')) $('kFontSizeVal').textContent = Math.round(cfg.fontSize * 100) + '%';
  if ($('kPosY')) $('kPosY').value = String(Math.round(cfg.yPct));
  if ($('kPosYVal')) $('kPosYVal').textContent = Math.round(cfg.yPct) + '%';
  if ($('kBgAlpha')) $('kBgAlpha').value = String(Math.round(cfg.bgAlpha * 100));
  if ($('kBgAlphaVal')) $('kBgAlphaVal').textContent = Math.round(cfg.bgAlpha * 100) + '%';
  if ($('kBaseColor')) $('kBaseColor').value = cfg.baseColor || '#7c8594';
  if ($('kActiveColor')) $('kActiveColor').value = cfg.activeColor || '#ffffff';
  if ($('kAutoScroll')) $('kAutoScroll').checked = cfg.autoScroll !== false;
  const gOff = Math.round(J.clamp(Number((S.project.timing && S.project.timing.globalOffsetMs) || 0), -600, 600));
  const offBadge = $('kpSyncOffsetBadge');
  if (offBadge) {
    offBadge.textContent = gOff === 0 ? '0 ms' : `${gOff > 0 ? '+' : ''}${gOff} ms`;
    offBadge.classList.toggle('is-shifted', gOff !== 0);
  }
}
function ensureTranslationState() {
  if (!S.project) return null;
  if (!S.project.translation || typeof S.project.translation !== 'object') {
    S.project.translation = J.defaultProject().translation;
  }
  if (!S.project.translation.lines || typeof S.project.translation.lines !== 'object') {
    S.project.translation.lines = {};
  }
  if (!S.project.translation.cfg || typeof S.project.translation.cfg !== 'object') {
    S.project.translation.cfg = Object.assign({}, J.defaultProject().translation.cfg);
  }
  return S.project.translation;
}
function getTransCfg() {
  const tr = ensureTranslationState();
  return Object.assign({
    fontSize: 0.78, yPct: 76, position: 'below', color: '', bgAlpha: 0.72, italic: false, showInPrompter: true, showInVideo: true,
  }, (tr && tr.cfg) || {});
}
function transCopy() {
  const lang = document.documentElement.lang;
  if (lang === 'en') {
    return {
      title: '🌐 Optional Translation Layer',
      on: 'Translation ON',
      off: 'Translation OFF',
      translateBtn: '🌐 Translate',
      translating: '🌐 Translating…',
      styleBtn: '⚙ Style',
      fontSize: 'Trans. size',
      pos: 'Position',
      posY: 'Y Pos.',
      bgAlpha: 'Trans. bg',
      color: 'Color',
      italic: 'Italic',
      prompter: 'Prompter',
      video: 'Video',
      noLines: 'No lyric lines to translate.',
      translatedMsg: (n, l) => `Translated ${n} line(s) into ${l} (original lyrics untouched).`,
      clearedMsg: 'Translation layer cleared (original lyrics & timestamps preserved).',
      billingMsg: 'Translation API requires Cloud billing; you can also type translations per line in the Lyrics Editor.',
      failMsg: 'Translation error; manual per-line translation remains available below.',
    };
  }
  if (lang === 'fr') {
    return {
      title: '🌐 Couche de traduction optionnelle',
      on: 'Traduction ON',
      off: 'Traduction OFF',
      translateBtn: '🌐 Traduire',
      translating: '🌐 Traduction…',
      styleBtn: '⚙ Style',
      fontSize: 'Taille trad.',
      pos: 'Position',
      posY: 'Pos. Y',
      bgAlpha: 'Fond trad.',
      color: 'Couleur',
      italic: 'Italique',
      prompter: 'Prompteur',
      video: 'Vidéo',
      noLines: 'Aucune ligne de paroles à traduire.',
      translatedMsg: (n, l) => `${n} ligne(s) traduite(s) en ${l} (paroles originales intactes).`,
      clearedMsg: 'Couche de traduction effacée (paroles et minutages originaux préservés).',
      billingMsg: 'La traduction IA nécessite la facturation Cloud ; vous pouvez saisir une traduction par ligne dans l’éditeur.',
      failMsg: 'Erreur de traduction ; vous pouvez saisir la traduction manuellement dans l’éditeur de paroles.',
    };
  }
  if (lang === 'ja') {
    return {
      title: '🌐 オプション翻訳レイヤー',
      on: '翻訳 ON',
      off: '翻訳 OFF',
      translateBtn: '🌐 翻訳する',
      translating: '🌐 翻訳中…',
      styleBtn: '⚙ 表示設定',
      fontSize: '翻訳サイズ',
      pos: '配置',
      posY: '縦位置 Y',
      bgAlpha: '翻訳背景',
      color: '文字色',
      italic: '斜体',
      prompter: 'プロンプター',
      video: '動画内',
      noLines: '翻訳する歌詞行がありません。',
      translatedMsg: (n, l) => `${n}行を ${l} に翻訳しました（元の歌詞と時刻は変更されません）。`,
      clearedMsg: '翻訳レイヤーを消去しました（元の歌詞は保持）。',
      billingMsg: '自動翻訳APIには課金有効化が必要です。歌詞エディタから手動翻訳も入力できます。',
      failMsg: '翻訳エラー：下の歌詞エディタから行ごとに手動翻訳を入力できます。',
    };
  }
  return {
    title: '🌐 Optional Translation Layer',
    on: 'Translation ON',
    off: 'Translation OFF',
    translateBtn: '🌐 Translate',
    translating: '🌐 Translating…',
    styleBtn: '⚙ Style',
    fontSize: 'Trans. size',
    pos: 'Position',
    posY: 'Y Pos.',
    bgAlpha: 'Trans. bg',
    color: 'Color',
    italic: 'Italic',
    prompter: 'Prompter',
    video: 'Video',
    noLines: 'No lyric lines to translate.',
    translatedMsg: (n, l) => `Translated ${n} line(s) into ${l} (original lyrics untouched).`,
    clearedMsg: 'Translation layer cleared (original lyrics & timestamps preserved).',
    billingMsg: 'Translation API requires Cloud billing; you can also type translations per line in the Lyrics Editor.',
    failMsg: 'Translation error; manual per-line translation remains available below.',
  };
}
function applyTranslationStyleVars() {
  const kp = $('karaokePrompter');
  if (!kp) return;
  const cfg = getTransCfg();
  kp.style.setProperty('--t-size', String(cfg.fontSize));
  kp.style.setProperty('--t-bg-alpha', String(cfg.bgAlpha));
  kp.style.setProperty('--t-style', cfg.italic ? 'italic' : 'normal');
  if (cfg.color) kp.style.setProperty('--t-color', cfg.color);
  else kp.style.removeProperty('--t-color');
}
function syncTranslationControls() {
  if (!S.project) return;
  const tr = ensureTranslationState();
  const cfg = getTransCfg();
  const c = transCopy();
  applyTranslationStyleVars();
  if ($('trPanelTitle')) $('trPanelTitle').textContent = c.title;
  const btnT = $('btnToggleTrans');
  if (btnT) {
    btnT.textContent = tr.enabled ? c.on : c.off;
    btnT.setAttribute('aria-pressed', String(!!tr.enabled));
  }
  if ($('trTargetLang')) $('trTargetLang').value = tr.targetLang || 'fr';
  if ($('btnTransCfgToggle')) $('btnTransCfgToggle').textContent = c.styleBtn;
  if ($('lblTrFontSize')) $('lblTrFontSize').textContent = c.fontSize;
  if ($('lblTrPos')) $('lblTrPos').textContent = c.pos;
  if ($('lblTrPosY')) $('lblTrPosY').textContent = c.posY;
  if ($('lblTrBgAlpha')) $('lblTrBgAlpha').textContent = c.bgAlpha;
  if ($('lblTrColor')) $('lblTrColor').textContent = c.color;
  if ($('lblTrItalic')) $('lblTrItalic').textContent = c.italic;
  if ($('lblTrShowPrompter')) $('lblTrShowPrompter').textContent = c.prompter;
  if ($('lblTrShowVideo')) $('lblTrShowVideo').textContent = c.video;
  if ($('trFontSize')) $('trFontSize').value = String(cfg.fontSize);
  if ($('trFontSizeVal')) $('trFontSizeVal').textContent = Math.round(cfg.fontSize * 100) + '%';
  if ($('trPosMode')) $('trPosMode').value = cfg.position || 'below';
  if ($('trPosYWrap')) $('trPosYWrap').style.opacity = cfg.position === 'custom' ? '1' : '0.55';
  if ($('trPosY')) $('trPosY').value = String(Math.round(cfg.yPct));
  if ($('trPosYVal')) $('trPosYVal').textContent = Math.round(cfg.yPct) + '%';
  if ($('trBgAlpha')) $('trBgAlpha').value = String(Math.round(cfg.bgAlpha * 100));
  if ($('trBgAlphaVal')) $('trBgAlphaVal').textContent = Math.round(cfg.bgAlpha * 100) + '%';
  if ($('trColor')) $('trColor').value = cfg.color || '#e2e8f0';
  if ($('trItalic')) $('trItalic').checked = Boolean(cfg.italic);
  if ($('trShowPrompter')) $('trShowPrompter').checked = cfg.showInPrompter !== false;
  if ($('trShowVideo')) $('trShowVideo').checked = cfg.showInVideo !== false;
}
function updateTransCfg(patch, needReplan = true) {
  if (!S.project) return;
  const tr = ensureTranslationState();
  tr.cfg = Object.assign(getTransCfg(), patch || {});
  syncTranslationControls();
  if (needReplan) {
    replanSoon(35);
  } else {
    updateKaraokePrompter();
    autosave();
  }
}
function toggleTranslationLayer(force) {
  const tr = ensureTranslationState();
  if (!tr) return;
  tr.enabled = typeof force === 'boolean' ? force : !tr.enabled;
  syncTranslationControls();
  replan();
  flushSave();
}
function clearTranslationLayer() {
  const tr = ensureTranslationState();
  if (!tr) return;
  tr.lines = {};
  tr.enabled = false;
  syncTranslationControls();
  replan();
  flushSave();
  toast(transCopy().clearedMsg);
}
async function translateAllLyrics() {
  const tr = ensureTranslationState();
  if (!tr) return false;
  const c = transCopy();
  const parsed = J.parseLyrics(S.project.lyrics || '');
  const payloadLines = [];
  parsed.lines.forEach((ln, idx) => {
    if (!ln.interlude && ln.text && ln.text.trim()) {
      const langHint = ln.language || (S.project.timing && S.project.timing.lineMeta && S.project.timing.lineMeta[idx] && S.project.timing.lineMeta[idx].language) || (J.detectLineLang ? J.detectLineLang(ln.text) : '');
      payloadLines.push({ index: idx, text: ln.text, language: langHint || '' });
    }
  });
  if (!payloadLines.length) {
    toast(c.noLines);
    return false;
  }
  const targetLang = ($('trTargetLang') && $('trTargetLang').value) || tr.targetLang || 'fr';
  tr.targetLang = targetLang;
  const btn = $('btnTranslateLyrics');
  const origTxt = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = c.translating; }
  try {
    const res = await J.translateLyricsLines(payloadLines, targetLang);
    if (res && res.billingRequired) {
      toast(c.billingMsg);
      return false;
    }
    if (!res || !res.success || !Array.isArray(res.translations)) {
      toast(c.failMsg);
      return false;
    }
    // Store translation on separate layer WITHOUT mutating S.project.lyrics or timing maps
    const nextMap = {};
    let count = 0;
    for (const item of res.translations) {
      if (item && Number.isInteger(+item.index) && typeof item.translatedText === 'string' && item.translatedText.trim()) {
        nextMap[+item.index] = item.translatedText.trim();
        count++;
      }
    }
    tr.lines = nextMap;
    tr.enabled = true;
    if (Array.isArray(res.detectedSourceLanguages) && res.detectedSourceLanguages.length) {
      if (!S.project.detection) S.project.detection = { detectedLanguages: [] };
      const merged = Array.from(new Set([...(S.project.detection.detectedLanguages || []), ...res.detectedSourceLanguages]));
      S.project.detection.detectedLanguages = merged;
    }
    syncTranslationControls();
    replan();
    flushSave();
    recordWork('translate_lyrics', 'sync', `${count} ligne(s) → ${J.LANG_LABEL[targetLang] || targetLang}`);
    toast(c.translatedMsg(count, J.LANG_LABEL[targetLang] || targetLang));
    return true;
  } catch (err) {
    toast(c.failMsg);
    return false;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = origTxt || c.translateBtn; }
  }
}
function toggleKaraokeFullscreen(force) {
  const stg = document.querySelector('.col-stage');
  if (!stg) return;
  const want = typeof force === 'boolean' ? force : !stg.classList.contains('is-karaoke-fs');
  stg.classList.toggle('is-karaoke-fs', want);
  document.body.classList.toggle('has-karaoke-fs', want);
  if (want) {
    try { if (stg.requestFullscreen && !document.fullscreenElement) stg.requestFullscreen().catch(() => {}); } catch (e) {}
  } else {
    try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (e) {}
  }
  applyKaraokeLabels();
  applyKaraokeStyleVars();
  setTimeout(() => { sizeViewport(); drawTimeline(); updateKaraokePrompter(); drawKaraokeVisualizers(performance.now()); }, 30);
}
function syncKaraokeDeckMeta() {
  const p = S.project || {};
  const rawTitle = String(p.title || '').trim();
  const audioBase = String(p.audioName || '').replace(/\.[^.]+$/, '').trim();
  const title = rawTitle || audioBase || 'Alexura Studio';
  const lang = (document.documentElement.lang || 'fr').toLowerCase();
  const defSub = lang.startsWith('fr') ? 'Lecteur Karaoké Studio' : lang.startsWith('en') ? 'Studio Karaoke Player' : lang.startsWith('zh') ? '专业卡拉OK播放器' : lang.startsWith('ko') ? '스튜디오 가라오케 플레이어' : lang.startsWith('id') ? 'Pemutar Karaoke Studio' : lang.startsWith('vi') ? 'Trình phát Karaoke Studio' : 'スタジオカラオケプレーヤー';
  const artist = String(p.artist || '').trim() || (S.audio ? `${S.audio.bpm || '—'} BPM` : defSub);
  setT('kpDeckTitle', title);
  setT('kpDeckArtist', artist);
  setT('kpStageTitle', title);
  setT('kpStageArtist', artist);
  const mark = document.querySelector('.kp-vinyl-mark');
  if (mark) mark.textContent = (title[0] || 'A').toUpperCase();
}
function setPlaybackRate(rate) {
  const r = J.clamp(Number(rate) || 1, 0.5, 2.0);
  S.playbackRate = r;
  if ($('kpSpeedSel')) {
    const valStr = String(r);
    const hasOpt = Array.from($('kpSpeedSel').options).some(o => Number(o.value) === r);
    if (hasOpt) $('kpSpeedSel').value = valStr;
  }
  if (S.playing) {
    if (S.audio) AP.setRate(playRate());
    else S.t0 = performance.now() - S.t * 1000 / playRate();
  }
  S.need = true;
}
function jumpLyricLine(dir) {
  const L = (S.plan && S.plan.lines) || [];
  const vocal = L.filter(l => !l.interlude && l.text);
  const pool = vocal.length ? vocal : L;
  if (!pool.length) {
    seek(dir < 0 ? 0 : Math.max(0, (S.plan && S.plan.duration ? S.plan.duration - 0.1 : 0)));
    return;
  }
  let idx = -1;
  for (let i = 0; i < pool.length; i++) {
    if (pool[i].start <= S.t + 0.08) idx = i;
    else break;
  }
  let target = 0;
  if (dir < 0) {
    if (idx >= 0 && (S.t - pool[idx].start) > 1.8) target = pool[idx].start;
    else target = idx > 0 ? pool[idx - 1].start : 0;
  } else {
    const next = pool.find(l => l.start > S.t + 0.08);
    target = next ? next.start : pool[pool.length - 1].start;
  }
  seek(target + 0.002);
}
function setKpStageMode(mode) {
  const next = mode === 'visual' ? 'visual' : 'video';
  S.kpStageMode = next;
  const vp = $('viewport'), vs = $('kpVisualStage');
  if (vp) vp.classList.toggle('is-visual-mode', next === 'visual');
  if (vs) vs.hidden = next !== 'visual';
  if ($('kpStageBtnVideo')) $('kpStageBtnVideo').setAttribute('aria-pressed', String(next === 'video'));
  if ($('kpStageBtnVisual')) $('kpStageBtnVisual').setAttribute('aria-pressed', String(next === 'visual'));
  if (next === 'visual') drawKaraokeVisualizers(performance.now());
  else { sizeViewport(); S.need = true; }
}
function loadKaraokeArtwork(file) {
  if (!file) return;
  if (S.kpArtworkUrl && S.kpArtworkUrl.startsWith('blob:')) {
    try { URL.revokeObjectURL(S.kpArtworkUrl); } catch (e) {}
  }
  const url = URL.createObjectURL(file);
  S.kpArtworkUrl = url;
  const img1 = $('kpStageArtImg'), img2 = $('kpDeckArtImg'), vinyl = $('kpStageArtVinyl'), disc = $('kpDeckArtDisc');
  if (img1) { img1.src = url; img1.hidden = false; }
  if (img2) { img2.src = url; img2.hidden = false; }
  if (vinyl) vinyl.hidden = true;
  if (disc) disc.hidden = true;
  setKpStageMode('visual');
}
function drawKaraokeVisualizers(now) {
  const spec = AP.getSpectrum();
  const activeCfg = getKaraokeCfg();
  const accentCol = activeCfg.activeColor || '#0a84ff';
  const timeSec = (now || performance.now()) * 0.001;

  const mini = $('kpMiniViz');
  if (mini) {
    const mctx = mini.getContext('2d');
    if (mctx) {
      const mw = mini.width, mh = mini.height;
      mctx.clearRect(0, 0, mw, mh);
      const bars = 6, bw = 3.5, gap = 2.5, totalW = bars * bw + (bars - 1) * gap, x0 = (mw - totalW) * 0.5;
      for (let i = 0; i < bars; i++) {
        let amp = 0.14;
        if (spec) amp = spec[Math.min(spec.length - 1, 2 + i * 7)] / 255;
        else if (S.playing) amp = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(timeSec * (5 + i * 1.3) + i));
        const bh = Math.max(3, amp * (mh * 0.58));
        mctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(56,189,248,0.92)';
        mctx.fillRect(x0 + i * (bw + gap), mh - 6 - bh, bw, bh);
      }
    }
  }

  if (S.kpStageMode !== 'visual') return;
  const cv = $('kpVizCanvas'), stage = $('kpVisualStage');
  if (!cv || !stage || stage.hidden) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = Math.max(320, Math.round((stage.clientWidth || 800) * dpr));
  const ch = Math.max(180, Math.round((stage.clientHeight || 450) * dpr));
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const ctx = cv.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, cw, ch);
  let bass = 0.12;
  if (spec) {
    for (let i = 0; i < 8; i++) bass += spec[i] / 255;
    bass /= 8;
  } else if (S.playing) {
    bass = 0.22 + 0.2 * Math.sin(timeSec * 3.8);
  }

  const cx = cw * 0.5, cy = ch * 0.44;
  const rGlow = Math.min(cw, ch) * (0.42 + bass * 0.22);
  const g = ctx.createRadialGradient(cx, cy, rGlow * 0.08, cx, cy, rGlow);
  g.addColorStop(0, `rgba(10, 132, 255, ${(0.22 + bass * 0.28).toFixed(3)})`);
  g.addColorStop(0.5, `rgba(214, 180, 106, ${(0.08 + bass * 0.10).toFixed(3)})`);
  g.addColorStop(1, 'rgba(5, 5, 8, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);

  const bars = 64;
  const usableW = cw * 0.86;
  const step = usableW / bars;
  const barW = Math.max(2 * dpr, step * 0.56);
  const startX = (cw - usableW) * 0.5;
  const baseY = ch - 18 * dpr;
  const maxBarH = ch * 0.24;

  const grad = ctx.createLinearGradient(startX, baseY - maxBarH, startX + usableW, baseY);
  grad.addColorStop(0, 'rgba(56, 189, 248, 0.85)');
  grad.addColorStop(0.5, accentCol || '#0a84ff');
  grad.addColorStop(1, 'rgba(214, 180, 106, 0.82)');
  ctx.fillStyle = grad;

  for (let i = 0; i < bars; i++) {
    const mirrorIdx = Math.abs(i - bars * 0.5) / (bars * 0.5);
    let val = 0.06;
    if (spec) {
      const bin = Math.min(spec.length - 1, Math.floor(mirrorIdx * (spec.length * 0.65)));
      val = spec[bin] / 255;
    } else if (S.playing) {
      val = 0.18 + 0.36 * (0.5 + 0.5 * Math.sin(timeSec * 4.4 - mirrorIdx * 5.2));
    } else {
      val = 0.05 + 0.04 * (0.5 + 0.5 * Math.sin(timeSec * 1.4 + i * 0.2));
    }
    const bh = Math.max(3 * dpr, val * maxBarH);
    const x = startX + i * step + (step - barW) * 0.5;
    ctx.globalAlpha = 0.28 + val * 0.68;
    ctx.fillRect(x, baseY - bh, barW, bh);
  }
  ctx.globalAlpha = 1;
}
function syncKaraokeBtn() {
  const b = $('btnKaraokeHud');
  if (!b || !S.project) return;
  const on = S.project.karaoke !== false;
  const lang = document.documentElement.lang;
  b.setAttribute('aria-pressed', String(on));
  b.textContent = lang === 'fr' ? (on ? 'Karaoké ON' : 'Karaoké OFF')
    : lang === 'en' ? (on ? 'Karaoke ON' : 'Karaoke OFF')
    : (on ? '字幕バー ON' : '字幕バー OFF');
}
function formatLangName(code) {
  const c = String(code || '').toLowerCase();
  if (!c || c === 'auto') return '';
  if (J.LANG_LABEL && J.LANG_LABEL[code]) return J.LANG_LABEL[code];
  const map = { fr: 'Français', en: 'English', ja: '日本語', ko: '한국어', 'zh-hans': '简体中文', 'zh-hant': '繁體中文', zh: '中文', vi: 'Tiếng Việt', id: 'Indonesia', es: 'Español', pt: 'Português', de: 'Deutsch', it: 'Italiano', ar: 'العربية', ru: 'Русский', th: 'ไทย' };
  return map[c] || code.toUpperCase();
}
function syncAudioDetectPanel() {
  const el = $('audioDetectPanel');
  if (!el) return;
  const det = S.project && S.project.detection;
  const a = S.audio;
  if (!det && !a) { el.hidden = true; el.innerHTML = ''; return; }
  const uiLang = document.documentElement.lang;
  const isFr = uiLang === 'fr', isEn = uiLang === 'en';
  const typeRaw = (det && det.audioType) || (a && a.acousticSummary && a.acousticSummary.audioType) || 'singing';
  const typeLabel = {
    singing: isFr ? '🎵 Chant' : isEn ? '🎵 Singing' : '🎵 歌声',
    speech: isFr ? '🗣️ Parole' : isEn ? '🗣️ Speech' : '🗣️ 语音',
    instrumental: isFr ? '🎹 Instrumental' : isEn ? '🎹 Instrumental' : '🎹 纯伴奏',
    combination: isFr ? '🎶 Chant + Instrumental' : isEn ? '🎶 Singing + Instrumental' : '🎶 人声 + 间奏',
  }[typeRaw] || (isFr ? '🎵 Chant' : isEn ? '🎵 Singing' : '🎵 歌声');

  const pills = [];
  const fmt = (det && det.format) || (a && a.format);
  if (fmt) pills.push(`<span class="ad-pill">${escapeHtml(fmt)}</span>`);
  pills.push(`<span class="ad-pill is-type">${escapeHtml(typeLabel)}</span>`);

  const langs = (det && Array.isArray(det.detectedLanguages) && det.detectedLanguages.length)
    ? det.detectedLanguages
    : (det && det.language && det.language !== 'auto' && det.language !== 'instrumental' ? [det.language] : []);
  if (langs.length) {
    const names = [...new Set(langs.map(formatLangName).filter(Boolean))];
    if (names.length) pills.push(`<span class="ad-pill is-lang">🌐 ${escapeHtml(names.join(' + '))}</span>`);
  }
  if (det && Array.isArray(det.detectedSpeakers) && det.detectedSpeakers.length > 1) {
    const cleanSpk = det.detectedSpeakers.filter(s => s && s !== 'Instrumental');
    if (cleanSpk.length > 1) pills.push(`<span class="ad-pill is-speaker">🎤 ${escapeHtml(cleanSpk.slice(0, 4).join(' · '))}</span>`);
  }
  if (det && det.hasRepeatedChorus) {
    pills.push(`<span class="ad-pill is-chorus">${isFr ? '↻ Refrains détectés' : isEn ? '↻ Choruses' : '↻ 副歌重复'}</span>`);
  }
  if (det && det.hasBackingVocals) {
    pills.push(`<span class="ad-pill is-harmony">${isFr ? '🎙️ Chœurs / Harmonies' : isEn ? '🎙️ Backing / Harmonies' : '🎙️ 和声 / 伴唱'}</span>`);
  }
  if (det && det.hasInstrumentalSections) {
    pills.push(`<span class="ad-pill is-inst">${isFr ? '🎼 Pauses instrumentales' : isEn ? '🎼 Instrumental breaks' : '🎼 间奏段落'}</span>`);
  }
  if (det && det.hasUnclearSections) {
    pills.push(`<span class="ad-pill is-warn">${isFr ? '⚠ Passages flous signalés' : isEn ? '⚠ Unclear vocals flagged' : '⚠ 含模糊段落'}</span>`);
  }
  const pp = (det && det.preprocessing) || (a && a.preprocessing);
  if (pp && pp.sampleRate) {
    const khz = (pp.sampleRate / 1000).toFixed(1).replace(/\.0$/, '');
    pills.push(`<span class="ad-pill" title="Stage 1: ${escapeHtml(`${pp.sampleRate}Hz · ${pp.channels || 1}ch · norm ${pp.normGain || 1}x`)}">${khz}kHz · ${pp.silenceCount ?? 0} ${isFr ? 'silences' : isEn ? 'silences' : '静音段'}</span>`);
  }
  const vs = det && det.validationSummary;
  if (vs && (vs.uncertainWords || vs.missingWords || vs.misrecognizedWords || vs.overlappingWords || vs.uncertainBoundaries)) {
    const parts = [];
    if (vs.uncertainWords) parts.push(`${vs.uncertainWords} ${isFr ? 'incertains' : isEn ? 'uncertain' : '不确定'}`);
    if (vs.missingWords) parts.push(`${vs.missingWords} ${isFr ? 'manquants' : isEn ? 'missing' : '缺失区间'}`);
    if (vs.misrecognizedWords) parts.push(`${vs.misrecognizedWords} ${isFr ? 'à vérifier' : isEn ? 'suspect' : '疑似误识'}`);
    if (vs.overlappingWords) parts.push(`${vs.overlappingWords} ${isFr ? 'superposés' : isEn ? 'overlap' : '重叠'}`);
    if (vs.uncertainBoundaries) parts.push(`${vs.uncertainBoundaries} ${isFr ? 'bornes' : isEn ? 'bounds' : '边界待核'}`);
    const gapTip = Array.isArray(vs.missingVocalGaps) && vs.missingVocalGaps.length
      ? vs.missingVocalGaps.slice(0, 4).map(g => `${J.fmtTime(g.start)}–${J.fmtTime(g.end)}`).join(', ')
      : '';
    pills.push(`<span class="ad-pill is-val" title="${escapeHtml(gapTip)}">✓ ${escapeHtml(parts.join(' · '))}</span>`);
  }
  el.innerHTML = pills.join('');
  el.hidden = pills.length === 0;
  syncQualityControlPanel();
}
function qcCopy() {
  const l = (document.documentElement.lang || 'fr').toLowerCase();
  if (l === 'fr') return {
    title: 'Contrôle Qualité & Précision',
    overallPrefix: 'Fiabilité estimée',
    high: 'Haute confiance', highDesc: 'Preuve acoustique solide pour le mot et son minutage',
    med: 'Confiance moyenne', medDesc: 'Mot reconnu, borne exacte à vérifier',
    low: 'Faible confiance', lowDesc: 'Incertain — révision manuelle recommandée',
    noisy: '⚠ Bruit ambiant détecté',
    distorted: '⚠ Distorsion / écrêtage audio',
    reverb: '⚠ Forte réverbération',
    overlap: '⚠ Chanteurs / voix superposés',
    reanalyzeAll: '🔬 Ré-analyser segments faibles',
    reanalyzing: '⏳ Ré-analyse haute précision…',
    nextLow: '⚠ Prochain faible',
    reanalyzeDone: (n, up) => n ? `✓ ${n} segment(s) ré-analysé(s) · ${up} mot(s) amélioré(s)` : 'Aucun segment à faible confiance à ré-analyser',
    trLbl: 'Transcr.', alLbl: 'Align.', clLbl: 'Clarté', ovLbl: 'Superpos.', unLbl: 'Incertitude',
    reanalyzeLine: '🔬 Ré-analyser',
    honestCap: 'max honnête <100%',
    autoBtn: 'Analyser et performer automatisé',
    autoTitle: 'Analyser par IA la coordination voix-paroles-vidéo, corriger les faibles confiances et optimiser la fluidité karaoké',
    autoRunning: 'Analyse & optimisation IA en cours…',
    coordLbl: 'Voix ↔ Vidéo',
    tightSyncLbl: 'Verrouillé ±45 ms',
    stageAudit: '1/3 Analyse coordination voix ↔ vidéo…',
    stageAi: '2/3 Ré-analyse IA & calage 10 ms des faibles confiances…',
    stageSmooth: '3/3 Lissage karaoké vidéo & vérification finale…',
    repTitleDone: 'Optimisation IA terminée',
    repTitleWarn: 'Optimisation locale + avertissement IA',
    repKpiConf: 'Fiabilité',
    repKpiDrift: 'Écart voix↔vidéo',
    repKpiLow: 'Mots faibles',
    repKpiFlow: 'Fluidité vidéo',
    repFlowUnit: 'liss.',
    aiWarnBilling: '⚠ Quota ou facturation Gemini requis — secours acoustique local appliqué.',
    aiWarnKey: '⚠ Clé API Gemini invalide ou absente — secours acoustique local appliqué.',
    aiWarnDegraded: '⚠ Service IA partiel ou hors ligne — précision optimisée via moteur vocal local.',
    noAudioNote: 'Sans audio chargé : lissage temporel des paroles et vérification orthographique appliqués.',
    autoToast: (bPct, aPct, fixed) => `✓ Optimisation IA : fiabilité ${bPct}% → ${aPct}% · ${fixed} mot(s) réparé(s)`,
  };
  if (l === 'ja') return {
    title: '精度\u30fb品質管理 (QC)',
    overallPrefix: '推定信頼度',
    high: '高信頼', highDesc: '強い音響証拠に基づく単語とタイミング',
    med: '中信頼', medDesc: '単語は認識済み\u30fb境界の目視確認推奨',
    low: '低信頼', lowDesc: '不確実 — 手動確認と再解析を推奨',
    noisy: '⚠ 背景ノイズ検出',
    distorted: '⚠ 音割れ\u30fb歪み検出',
    reverb: '⚠ 強い残響 (リバーブ)',
    overlap: '⚠ 重複ボーカル検出',
    reanalyzeAll: '🔬 低信頼区間を再解析',
    reanalyzing: '⏳ 高精度で再解析中…',
    nextLow: '⚠ 次の低信頼単語',
    reanalyzeDone: (n, up) => n ? `✓ ${n}区間を再解析 \u30fb ${up}語を改善` : '再解析が必要な低信頼区間はありません',
    trLbl: '認識', alLbl: '整合', clLbl: '明瞭度', ovLbl: '重複', unLbl: '不確実性',
    reanalyzeLine: '🔬 再解析',
    honestCap: '推定上限 <100%',
    autoBtn: 'AI\u81ea\u52d5解析\u30fb精度最適化',
    autoTitle: '声と動画字幕の同期誤差を解析し、低信頼箇所の\u81ea\u52d5修復と滑らかな表示を最適化します',
    autoRunning: 'AI同期解析\u30fb最適化を実行中…',
    coordLbl: '声 ↔ 動画',
    tightSyncLbl: '同期率 ±45ms',
    stageAudit: '1/3 声と動画字幕の座標\u30fb信頼度を解析中…',
    stageAi: '2/3 AI再解析と10msアタック補正を実行中…',
    stageSmooth: '3/3 カラオケ表示の平滑化と最終検証…',
    repTitleDone: 'AI最適化完了',
    repTitleWarn: 'ローカル精密補正完了（AI警告あり）',
    repKpiConf: '信頼度',
    repKpiDrift: '平均誤差',
    repKpiLow: '低信頼語',
    repKpiFlow: '表示滑らかさ',
    repFlowUnit: '平滑',
    aiWarnBilling: '⚠ Gemini課金または割り当て上限のため、ローカル音響補正を適用しました。',
    aiWarnKey: '⚠ Gemini APIキー未設定/無効のため、ローカル音響補正を適用しました。',
    aiWarnDegraded: '⚠ クラウドAI応答エラーのため、ローカル音響エンジンで同期を最適化しました。',
    noAudioNote: '音声未読込のため、字幕のオーバーラップ解消と表記チェックを実行しました。',
    autoToast: (bPct, aPct, fixed) => `✓ AI最適化完了：信頼度 ${bPct}% → ${aPct}%（${fixed}語改善）`,
  };
  return {
    title: 'Accuracy & Quality Control',
    overallPrefix: 'Estimated reliability',
    high: 'HIGH CONFIDENCE', highDesc: 'Strong acoustic evidence for word and timing',
    med: 'MEDIUM CONFIDENCE', medDesc: 'Word recognized, boundary needs verification',
    low: 'LOW CONFIDENCE', lowDesc: 'Uncertain — manual review required',
    noisy: '⚠ Background noise detected',
    distorted: '⚠ Audio clipping / distortion',
    reverb: '⚠ Heavy reverberation',
    overlap: '⚠ Overlapping singers / vocals',
    reanalyzeAll: '🔬 Re-analyze low segments',
    reanalyzing: '⏳ Re-analyzing with high accuracy…',
    nextLow: '⚠ Next low-conf',
    reanalyzeDone: (n, up) => n ? `✓ Re-analyzed ${n} segment(s) · improved ${up} word(s)` : 'No low-confidence segments require re-analysis',
    trLbl: 'Transcr.', alLbl: 'Align.', clLbl: 'Clarity', ovLbl: 'Overlap', unLbl: 'Uncertainty',
    reanalyzeLine: '🔬 Re-analyze',
    honestCap: 'honest cap <100%',
    autoBtn: 'AI Auto-Analyze & Optimize',
    autoTitle: 'Analyze singing vs video lyric coordination with AI, fix low-confidence words, and smooth karaoke flow',
    autoRunning: 'AI analyzing & optimizing…',
    coordLbl: 'Voice ↔ Video',
    tightSyncLbl: 'Locked ±45ms',
    stageAudit: '1/3 Auditing singing vs video coordination…',
    stageAi: '2/3 AI re-analyzing low-confidence & drifting words…',
    stageSmooth: '3/3 Smoothing karaoke video flow & verifying…',
    repTitleDone: 'AI Optimization Complete',
    repTitleWarn: 'Local Optimization + AI Warning',
    repKpiConf: 'Reliability',
    repKpiDrift: 'Voice↔Video',
    repKpiLow: 'Low-conf',
    repKpiFlow: 'Video flow',
    repFlowUnit: 'smooth',
    aiWarnBilling: '⚠ Gemini billing or quota limit hit — applied local Whisper/acoustic fallback.',
    aiWarnKey: '⚠ Gemini API key missing or invalid — applied local acoustic optimization.',
    aiWarnDegraded: '⚠ AI cloud request degraded — applied local acoustic engine continuity.',
    noAudioNote: 'No audio loaded: smoothed lyric overlaps and verified spelling locally.',
    autoToast: (bPct, aPct, fixed) => `✓ AI Optimized: reliability ${bPct}% → ${aPct}% · ${fixed} word(s) repaired`,
  };
}
function clearQcAutoReport() {
  const rep = $('qcAutoReport');
  if (!rep) return;
  rep.hidden = true;
  rep.classList.remove('is-busy', 'is-warn', 'is-error');
  rep.innerHTML = '';
}
function syncQualityControlPanel() {
  const box = $('qcSummaryBox');
  if (!box) return;
  const L = (S.plan && S.plan.lines) || [];
  const hasContent = Boolean(S.audio || (L && L.some(ln => !ln.interlude && (ln.wordsTimed || []).length)));
  if (!hasContent) { clearQcAutoReport(); box.hidden = true; return; }
  box.hidden = false;
  const cp = qcCopy();
  if ($('qcBoxTitle')) $('qcBoxTitle').textContent = cp.title;

  let hi = 0, med = 0, lo = 0, total = 0, uncSum = 0;
  for (const ln of L) {
    if (!ln || ln.interlude) continue;
    const words = (S.project && S.project.timing && S.project.timing.wordTimes && S.project.timing.wordTimes[ln.index]) || ln.wordsTimed || [];
    for (const w of words) {
      total++;
      const q = J.evaluateWordQuality ? J.evaluateWordQuality(w, S.audio, ln.meta) : { qualityTier: 'MEDIUM', recognitionUncertainty: 0.25 };
      if (q.qualityTier === 'HIGH') hi++;
      else if (q.qualityTier === 'LOW') lo++;
      else med++;
      uncSum += q.recognitionUncertainty;
    }
  }
  const avgScore = total ? Math.min(97, Math.max(5, Math.round((1 - uncSum / total) * 100))) : null;
  if ($('qcOverallBadge')) {
    $('qcOverallBadge').textContent = avgScore != null ? `${cp.overallPrefix} : ${avgScore}% (${cp.honestCap})` : '—';
  }
  const tiersEl = $('qcTierCounts');
  if (tiersEl) {
    tiersEl.innerHTML =
      `<span class="qc-tier-pill is-high" title="${escapeHtml(cp.highDesc)}">● ${escapeHtml(cp.high)}: ${hi}</span>` +
      `<span class="qc-tier-pill is-mid" title="${escapeHtml(cp.medDesc)}">◐ ${escapeHtml(cp.med)}: ${med}</span>` +
      `<span class="qc-tier-pill is-low" title="${escapeHtml(cp.lowDesc)}">▲ ${escapeHtml(cp.low)}: ${lo}</span>`;
  }
  const coordEl = $('qcCoordStrip');
  if (coordEl) {
    if (total > 0 && J.analyzeVocalToVideoCoordination) {
      const typesetOn = Boolean(S.plan ? S.plan.typeset : (S.project && S.project.typeset));
      const coord = J.analyzeVocalToVideoCoordination(S.audio, L, S.project && S.project.timing, { typeset: typesetOn });
      const driftCls = !coord.hasAudio ? '' : coord.avgAbsErrMs <= 30 ? 'is-good' : coord.avgAbsErrMs <= 55 ? 'is-warn' : 'is-drift';
      const syncCls = coord.tightSyncPct >= 82 ? 'is-good' : coord.tightSyncPct >= 62 ? 'is-warn' : 'is-drift';
      const driftVal = coord.hasAudio
        ? `${coord.medianVideoDriftMs > 0 ? '+' : ''}${coord.medianVideoDriftMs} ms (±${coord.avgAbsErrMs} ms)`
        : '—';
      coordEl.innerHTML =
        `<span class="qc-coord-metric ${driftCls}"><span>${escapeHtml(cp.coordLbl)}:</span><strong>${escapeHtml(driftVal)}</strong></span>` +
        `<span class="qc-coord-sep" aria-hidden="true">·</span>` +
        `<span class="qc-coord-metric ${syncCls}"><span>${escapeHtml(cp.tightSyncLbl)}:</span><strong>${coord.tightSyncPct}%</strong></span>`;
      coordEl.hidden = false;
    } else {
      coordEl.hidden = true;
    }
  }
  const qCond = (S.audio && S.audio.qualityConditions) || (S.project && S.project.detection && S.project.detection.validationSummary && S.project.detection.validationSummary.qualityConditions) || null;
  const alertsEl = $('qcCondAlerts');
  if (alertsEl) {
    const warns = [];
    if (qCond && qCond.isNoisy) warns.push(cp.noisy);
    if (qCond && qCond.isDistorted) warns.push(cp.distorted);
    if (qCond && qCond.isReverberated) warns.push(cp.reverb);
    if (qCond && qCond.hasOverlappingSingers) warns.push(cp.overlap);
    alertsEl.innerHTML = warns.map(w => `<span>${escapeHtml(w)}</span>`).join('');
    alertsEl.hidden = warns.length === 0;
  }
  const btnAuto = $('btnAutoQcPerform'), btnAutoLbl = $('btnAutoQcPerformLbl');
  if (btnAuto && !btnAuto.dataset.busy) {
    if (btnAutoLbl) btnAutoLbl.textContent = cp.autoBtn;
    btnAuto.title = cp.autoTitle;
    btnAuto.setAttribute('aria-busy', 'false');
    btnAuto.disabled = total === 0;
  }
  const btnRe = $('btnReanalyzeLow'), btnNext = $('btnNextLowConf');
  if (btnRe && !btnRe.dataset.busy) {
    btnRe.textContent = lo > 0 ? `${cp.reanalyzeAll} (${lo})` : cp.reanalyzeAll;
    btnRe.disabled = total === 0;
  }
  if (btnNext) {
    btnNext.textContent = cp.nextLow;
    btnNext.disabled = lo === 0;
  }
}
function jumpToNextLowConfWord() {
  const L = (S.plan && S.plan.lines) || [];
  const candidates = [];
  for (const ln of L) {
    if (!ln || ln.interlude) continue;
    const words = getEditableWords(ln.index);
    words.forEach((w, wi) => {
      const q = J.evaluateWordQuality ? J.evaluateWordQuality(w, S.audio, ln.meta) : { qualityTier: 'MEDIUM' };
      if (q.qualityTier === 'LOW') candidates.push({ li: ln.index, wi });
    });
  }
  if (!candidates.length) { toast(qcCopy().reanalyzeDone(0, 0)); return; }
  const curIdx = candidates.findIndex(c => c.li > EDL.lineIdx || (c.li === EDL.lineIdx && c.wi > EDL.wordIdx));
  const pick = candidates[curIdx >= 0 ? curIdx : 0];
  tlFocusWord(pick.li, pick.wi);
}
async function reanalyzeLowConfidenceUI(onlyLineIdx = null) {
  if (!J.reanalyzeLowConfidenceSegments || !S.plan || !S.plan.lines) return;
  const cp = qcCopy();
  const btn = $('btnReanalyzeLow');
  if (btn) { btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = cp.reanalyzing; }
  try {
    ensureTimingMaps();
    const inputLines = S.plan.lines.map((ln, idx) => {
      const words = ln.interlude ? [] : getEditableWords(idx);
      const lineForcedLow = onlyLineIdx != null && idx === onlyLineIdx;
      return {
        index: idx,
        start: ln.start,
        end: ln.visEnd || ln.end,
        text: ln.text,
        interlude: !!ln.interlude,
        isInstrumentalSection: !!ln.interlude,
        language: (ln.meta && ln.meta.language) || J.resolveLang(S.project),
        speaker: (ln.meta && ln.meta.speaker) || 'Lead',
        unclear: lineForcedLow || Boolean(ln.meta && ln.meta.unclear),
        flags: lineForcedLow ? Array.from(new Set(((ln.meta && ln.meta.flags) || []).concat(['uncertain_boundary']))) : ((ln.meta && ln.meta.flags) || []),
        words,
      };
    });
    const res = await J.reanalyzeLowConfidenceSegments(S.audio, inputLines, J.resolveLang(S.project));
    if (res && Array.isArray(res.lines)) {
      pushEdit();
      res.lines.forEach((rl, idx) => {
        if (!rl || rl.interlude || rl.isInstrumentalSection) return;
        if (Array.isArray(rl.words) && rl.words.length) S.project.timing.wordTimes[idx] = rl.words;
        if (rl.flags) S.project.timing.lineMeta[idx] = Object.assign({}, S.project.timing.lineMeta[idx] || {}, { flags: rl.flags });
        if (rl.text && S.plan.lines[idx] && rl.text !== S.plan.lines[idx].text && !/^\[?unclear/i.test(rl.text) && Array.isArray(rl.words) && rl.words.length) {
          syncLineTextFromWords(idx, rl.words);
        }
      });
      if (S.project.detection && res.validationSummary) {
        S.project.detection.validationSummary = res.validationSummary;
        S.project.detection.hasUnclearSections = res.validationSummary.lowConfidenceWords > 0;
      }
      replan();
      flushSave();
      syncUI();
      if (res.reanalyzedCount > 0) recordWork('reanalyze_low', 'sync', `${res.reanalyzedCount} seg · +${res.upgradedCount}`);
      toast(cp.reanalyzeDone(res.reanalyzedCount, res.upgradedCount));
    }
  } finally {
    if (btn) { delete btn.dataset.busy; }
    syncQualityControlPanel();
  }
}

async function autoOptimizeQcAndCoordinationUI() {
  if (!S.project || !S.plan || !Array.isArray(S.plan.lines) || !S.plan.lines.length) return null;
  const btn = $('btnAutoQcPerform');
  if (btn && btn.dataset.busy === '1') return null;

  const cp = qcCopy();
  const uiLang = (document.documentElement.lang || 'fr').toLowerCase();
  const btnLbl = $('btnAutoQcPerformLbl');
  const rep = $('qcAutoReport');
  const typesetOn = Boolean(S.plan ? S.plan.typeset : S.project.typeset);

  const setReportBusy = (stageText, pct = 28, subText = '') => {
    if (!rep) return;
    rep.hidden = false;
    rep.classList.remove('is-warn', 'is-error');
    rep.classList.add('is-busy');
    const barPct = Math.max(8, Math.min(100, Math.round(pct)));
    rep.innerHTML =
      `<div class="qc-auto-rep-head"><span>⏳ ${escapeHtml(stageText)}</span><span class="qc-auto-rep-engine mono">${barPct}%</span></div>` +
      `<div class="qc-auto-prog" aria-hidden="true"><span class="qc-auto-prog-fill" style="width:${barPct}%"></span></div>` +
      (subText ? `<p class="qc-auto-note">${escapeHtml(subText)}</p>` : '');
  };

  if (btn) {
    btn.dataset.busy = '1';
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.classList.add('is-running');
  }
  if (btnLbl) btnLbl.textContent = cp.autoRunning;

  try {
    ensureTimingMaps();
    const gShift = J.clamp(Number(S.project.timing.globalOffsetMs) || 0, -600, 600) / 1000 - (typesetOn ? 0.2 : 0);

    // Stage 1: Baseline Voice ↔ Video Coordination Audit (accounting cleanly for typeset 200ms lead)
    const beforeAudit = J.analyzeVocalToVideoCoordination
      ? J.analyzeVocalToVideoCoordination(S.audio, S.plan.lines, S.project.timing, { typeset: typesetOn })
      : { hasAudio: false, overallConfidencePct: 75, avgAbsErrMs: 0, medianVideoDriftMs: 0, lowCount: 0, tightSyncPct: 0, weakLineIndices: [], perLine: [] };

    setReportBusy(
      cp.stageAudit,
      32,
      `${cp.repKpiConf} ${beforeAudit.overallConfidencePct}% · ${beforeAudit.lowCount} ${cp.low.toLowerCase()} · ${cp.repKpiDrift} ±${beforeAudit.avgAbsErrMs} ms`,
    );

    const songLang = J.resolveLang ? J.resolveLang(S.project) : 'auto';
    const rawLinesInput = S.plan.lines.map((ln, idx) => {
      const words = ln.interlude ? [] : getEditableWords(idx).map(w => Object.assign({}, w));
      const rawStart = words.length ? words[0].start : Math.max(0, (Number(ln.start) || 0) - gShift);
      const rawEnd = words.length ? words[words.length - 1].end : Math.max(rawStart + 0.2, (Number(ln.visEnd || ln.end) || rawStart + 2) - gShift);
      return {
        index: idx,
        start: +rawStart.toFixed(3),
        end: +rawEnd.toFixed(3),
        text: ln.text,
        interlude: Boolean(ln.interlude),
        isInstrumentalSection: Boolean(ln.interlude),
        language: (ln.meta && ln.meta.language) || songLang,
        speaker: (ln.meta && ln.meta.speaker) || 'Lead',
        unclear: Boolean(ln.meta && ln.meta.unclear),
        flags: (ln.meta && ln.meta.flags) || [],
        words,
      };
    });

    // Stage 2: Extract bounded target audio clips (<= 14s per slice centered on weak words) + call AI /api/qc-auto-perform
    setReportBusy(cp.stageAi, 64);
    const audioSlices = [];
    const blobToB64 = (blob) => new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { const s = String(r.result || ''); res(s.includes(',') ? s.split(',')[1] : s); };
      r.onerror = rej;
      r.readAsDataURL(blob);
    });

    const priorityIndices = Array.isArray(beforeAudit.weakLineIndices) && beforeAudit.weakLineIndices.length
      ? beforeAudit.weakLineIndices.slice(0, 5)
      : rawLinesInput.filter(l => !l.interlude).slice(0, 3).map(l => l.index);

    if (S.audio && S.audio.buffer && J.audioMonoWavWindow) {
      for (const pIdx of priorityIndices) {
        const targetLn = rawLinesInput[pIdx];
        if (!targetLn || targetLn.interlude || !targetLn.words.length) continue;
        let padS = Math.max(0, targetLn.start - 0.35);
        let padE = Math.min(S.audio.duration || (targetLn.end + 0.6), targetLn.end + 0.35);
        if (padE - padS > 14) {
          const weakW = targetLn.words.find(w => !w.validated && ((w.alignmentConfidence ?? 1) < 0.78 || (w.recognitionConfidence ?? 1) < 0.76)) || targetLn.words[0];
          const mid = Number(weakW && weakW.start) || ((padS + padE) * 0.5);
          padS = Math.max(0, mid - 7);
          padE = Math.min(S.audio.duration || (padS + 14), padS + 14);
        }
        try {
          const wavBlob = J.audioMonoWavWindow(S.audio.buffer, padS, Math.max(0.3, padE - padS), 16000);
          const audioBase64 = await blobToB64(wavBlob);
          let separatedVocalBase64 = '';
          if (J.audioVocalSeparatedWavWindow && (!S.audio.preprocessing || S.audio.preprocessing.shouldSeparate !== false)) {
            const sepBlob = J.audioVocalSeparatedWavWindow(S.audio.buffer, padS, Math.max(0.3, padE - padS), 16000);
            separatedVocalBase64 = await blobToB64(sepBlob);
          }
          const hasUnc = targetLn.words.some(w => (w.recognitionConfidence ?? 1) < 0.76 || /\[?unclear/i.test(w.text));
          audioSlices.push({
            lineIdx: pIdx,
            startSec: padS,
            endSec: padE,
            existingWords: targetLn.words,
            needsTranscriptRefresh: hasUnc,
            audioBase64,
            separatedVocalBase64,
          });
        } catch {}
      }
    }

    let serverData = null;
    let aiNotice = '';
    const postAutoPerform = (slicesPayload) => fetch('/api/qc-auto-perform', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lines: beforeAudit.perLine.length ? beforeAudit.perLine : rawLinesInput,
        coordinationAudit: {
          medianVideoDriftMs: beforeAudit.medianVideoDriftMs,
          avgAbsErrMs: beforeAudit.avgAbsErrMs,
          lowConfCount: beforeAudit.lowCount,
          overlapCount: beforeAudit.overlapCount,
          microGapCount: beforeAudit.microGapCount,
        },
        audioSlices: slicesPayload,
        vocalSegments: (S.audio && Array.isArray(S.audio.vocalSegments)) ? S.audio.vocalSegments.slice(0, 32) : [],
        qualityConditions: (S.audio && S.audio.qualityConditions) || null,
        globalOffsetMs: Number(S.project.timing.globalOffsetMs) || 0,
        typesetLeadActive: typesetOn,
        lang: songLang,
        uiLang,
      }),
    });

    try {
      let resp = await postAutoPerform(audioSlices);
      if (resp.status === 413 && audioSlices.length) {
        const leanSlices = audioSlices.map(sl => Object.assign({}, sl, { separatedVocalBase64: '' }));
        resp = await postAutoPerform(leanSlices);
      }
      if (resp.ok) {
        serverData = await resp.json();
        if (serverData && (serverData.aiStatus === 'degraded' || serverData.aiStatus === 'unavailable')) {
          aiNotice = serverData.requiresBilling
            ? cp.aiWarnBilling
            : serverData.requiresApiKey
            ? cp.aiWarnKey
            : cp.aiWarnDegraded;
        }
      } else {
        let errJson = null;
        try { errJson = await resp.json(); } catch {}
        aiNotice = (errJson && errJson.requiresBilling)
          ? cp.aiWarnBilling
          : (errJson && errJson.requiresApiKey)
          ? cp.aiWarnKey
          : cp.aiWarnDegraded;
      }
    } catch {
      aiNotice = cp.aiWarnDegraded;
    }

    // Stage 3: Apply AI + 10ms Acoustic Precision Optimization + Karaoke Video Fluidity Smoothing first,
    // then calibrate globalOffsetMs from post-reanchor residual drift (prevents double-shifting).
    setReportBusy(cp.stageSmooth, 92);
    pushEdit();

    const optRes = J.autoOptimizeKaraokePrecision
      ? J.autoOptimizeKaraokePrecision(S.audio, rawLinesInput, {
          lang: songLang,
          targetLineIndices: priorityIndices,
          repairedSlices: (serverData && serverData.repairedSlices) || [],
          orthographyFixes: (serverData && serverData.orthographyFixes) || [],
        })
      : { lines: rawLinesInput, validationSummary: null, stats: { reanalyzedLines: 0, upgradedWords: 0, fixedOverlaps: 0, smoothedGaps: 0 } };

    if (optRes && Array.isArray(optRes.lines)) {
      let prevLineStart = 0;
      optRes.lines.forEach((rl, idx) => {
        if (!rl || rl.interlude || rl.isInstrumentalSection) return;
        if (Array.isArray(rl.words) && rl.words.length) {
          S.project.timing.wordTimes[idx] = rl.words;
          const firstS = +Math.max(prevLineStart, Number(rl.words[0].start) || 0).toFixed(3);
          const lastE = +Math.max(firstS + 0.12, Number(rl.words[rl.words.length - 1].end) || (firstS + 0.5)).toFixed(3);
          if (!rl.words[0].validated || S.project.timing.lineTimes[idx] == null || firstS < S.project.timing.lineTimes[idx]) {
            S.project.timing.lineTimes[idx] = firstS;
          }
          prevLineStart = +(S.project.timing.lineTimes[idx] + 0.05).toFixed(3);
          if ((S.project.timing.lineEnds && S.project.timing.lineEnds[idx] != null) || (lastE - firstS > 3.45)) {
            S.project.timing.lineEnds[idx] = +Math.max(Number(S.project.timing.lineEnds[idx]) || 0, lastE).toFixed(3);
          }
          const planTxtNorm = String((S.plan.lines[idx] && S.plan.lines[idx].text) || '').replace(/\s+/g, '');
          const wordsTxtNorm = rl.words.map(w => String(w.text || '')).join('').replace(/\s+/g, '');
          if (wordsTxtNorm && wordsTxtNorm !== planTxtNorm && !/^\[?unclear/i.test(String(rl.text || ''))) {
            syncLineTextFromWords(idx, rl.words);
          }
        }
        if (rl.flags) {
          S.project.timing.lineMeta[idx] = Object.assign({}, S.project.timing.lineMeta[idx] || {}, {
            flags: rl.flags,
            unclear: Boolean(rl.unclear),
          });
        }
      });
      if (S.project.detection && optRes.validationSummary) {
        S.project.detection.validationSummary = optRes.validationSummary;
        S.project.detection.hasUnclearSections = optRes.validationSummary.lowConfidenceWords > 0;
      }
    }

    replan();
    let midAudit = J.analyzeVocalToVideoCoordination
      ? J.analyzeVocalToVideoCoordination(S.audio, S.plan.lines, S.project.timing, { typeset: typesetOn })
      : beforeAudit;

    let appliedOffsetDeltaMs = 0;
    if (midAudit.hasAudio) {
      const residualShift = Math.abs(midAudit.medianVideoDriftMs) >= 18
        ? -midAudit.medianVideoDriftMs
        : ((!optRes.stats.reanalyzedLines && serverData && Math.abs(Number(serverData.recommendedOffsetAdjustMs) || 0) >= 18)
          ? Math.round(Number(serverData.recommendedOffsetAdjustMs))
          : 0);
      if (Math.abs(residualShift) >= 18) {
        const prevOff = Number(S.project.timing.globalOffsetMs) || 0;
        const candOff = J.clamp(Math.round(prevOff + residualShift), -600, 600);
        if (candOff !== prevOff) {
          S.project.timing.globalOffsetMs = candOff;
          replan();
          const candAudit = J.analyzeVocalToVideoCoordination
            ? J.analyzeVocalToVideoCoordination(S.audio, S.plan.lines, S.project.timing, { typeset: typesetOn })
            : midAudit;
          if (candAudit.avgAbsErrMs <= midAudit.avgAbsErrMs) {
            appliedOffsetDeltaMs = candOff - prevOff;
            midAudit = candAudit;
          } else {
            S.project.timing.globalOffsetMs = prevOff;
            replan();
          }
        }
      }
    }

    flushSave();
    syncUI();

    const afterAudit = midAudit;
    const fixedLowCount = Math.max(optRes.stats.upgradedWords || 0, Math.max(0, beforeAudit.lowCount - afterAudit.lowCount));
    const flowFixes = (optRes.stats.fixedOverlaps || 0) + (optRes.stats.smoothedGaps || 0);
    const engineTag = (serverData && serverData.engineUsed) ? String(serverData.engineUsed) : (S.audio ? '10ms Acoustic' : 'Timing');
    const diagNote = (serverData && (serverData.coordinationDiagnosis || serverData.optimizationSummary))
      ? `${serverData.coordinationDiagnosis || ''} ${serverData.optimizationSummary || ''}`.trim()
      : (!afterAudit.hasAudio ? cp.noAudioNote : '');

    if (rep) {
      rep.hidden = false;
      rep.classList.remove('is-busy', 'is-error');
      rep.classList.toggle('is-warn', Boolean(aiNotice));
      const headTitle = aiNotice ? cp.repTitleWarn : cp.repTitleDone;
      const headIco = aiNotice ? '⚠' : '✓';
      const driftBeforeTxt = beforeAudit.hasAudio ? `±${beforeAudit.avgAbsErrMs} ms` : '—';
      const driftAfterTxt = afterAudit.hasAudio ? `±${afterAudit.avgAbsErrMs} ms` : '—';
      const calSuffix = appliedOffsetDeltaMs !== 0 ? ` (${appliedOffsetDeltaMs > 0 ? '+' : ''}${appliedOffsetDeltaMs} ms)` : '';
      rep.innerHTML =
        `<div class="qc-auto-rep-head"><span>${headIco} ${escapeHtml(headTitle)}</span><span class="qc-auto-rep-engine mono">${escapeHtml(engineTag)}</span></div>` +
        `<div class="qc-auto-kpis">` +
          `<div class="qc-auto-kpi"><span>${escapeHtml(cp.repKpiConf)}</span><strong>${beforeAudit.overallConfidencePct}% → ${afterAudit.overallConfidencePct}%</strong></div>` +
          `<div class="qc-auto-kpi"><span>${escapeHtml(cp.repKpiDrift)}</span><strong>${escapeHtml(driftBeforeTxt)} → ${escapeHtml(driftAfterTxt)}${escapeHtml(calSuffix)}</strong></div>` +
          `<div class="qc-auto-kpi"><span>${escapeHtml(cp.repKpiLow)}</span><strong>${beforeAudit.lowCount} → ${afterAudit.lowCount} (-${fixedLowCount})</strong></div>` +
          `<div class="qc-auto-kpi"><span>${escapeHtml(cp.repKpiFlow)}</span><strong>${afterAudit.tightSyncPct}% · ${flowFixes} ${escapeHtml(cp.repFlowUnit)}</strong></div>` +
        `</div>` +
        (aiNotice ? `<p class="qc-auto-alert">${escapeHtml(aiNotice)}</p>` : '') +
        (diagNote ? `<p class="qc-auto-note">${escapeHtml(diagNote)}</p>` : '');
    }

    recordWork(
      'auto_qc_perform',
      'sync',
      `${beforeAudit.overallConfidencePct}%→${afterAudit.overallConfidencePct}% · ±${beforeAudit.avgAbsErrMs}→±${afterAudit.avgAbsErrMs}ms`,
    );
    toast(cp.autoToast(beforeAudit.overallConfidencePct, afterAudit.overallConfidencePct, fixedLowCount));
    return { beforeAudit, afterAudit, stats: optRes.stats, appliedOffsetDeltaMs, serverData, aiNotice };
  } finally {
    if (btn) {
      delete btn.dataset.busy;
      btn.setAttribute('aria-busy', 'false');
      btn.classList.remove('is-running');
    }
    syncQualityControlPanel();
  }
}
function renderLineTagsHtml(ln) {
  if (!ln || ln.interlude || !ln.meta) return '';
  const m = ln.meta;
  const uiLang = document.documentElement.lang;
  const isFr = uiLang === 'fr', isEn = uiLang === 'en';
  const tags = [];
  const spkCount = (S.project && S.project.detection && Array.isArray(S.project.detection.detectedSpeakers)) ? S.project.detection.detectedSpeakers.length : 0;
  if (m.speaker && m.speaker !== 'Instrumental' && (m.speaker !== 'Lead' || spkCount > 1)) {
    tags.push(`<span class="ln-tag is-speaker">${escapeHtml(m.speaker)}</span>`);
  }
  if (m.section === 'chorus' || m.isRepeatedChorus) {
    tags.push(`<span class="ln-tag is-chorus">${m.isRepeatedChorus ? (isFr ? 'Refrain ↻' : isEn ? 'Chorus ↻' : '副歌 ↻') : (isFr ? 'Refrain' : isEn ? 'Chorus' : '副歌')}</span>`);
  } else if (m.section === 'pre_chorus') {
    tags.push(`<span class="ln-tag">${isFr ? 'Pré-refrain' : isEn ? 'Pre-Chorus' : '导歌'}</span>`);
  } else if (m.section === 'bridge') {
    tags.push(`<span class="ln-tag">${isFr ? 'Pont' : isEn ? 'Bridge' : '桥段'}</span>`);
  }
  if (m.vocalType === 'speech' || m.section === 'speech') {
    tags.push(`<span class="ln-tag is-speech">${isFr ? 'Parlé' : isEn ? 'Spoken' : '念白'}</span>`);
  } else if (m.backingText || m.vocalType === 'harmony' || m.vocalType === 'backing' || m.vocalType === 'overlapping') {
    const lbl = m.vocalType === 'overlapping' ? (isFr ? 'Superposé' : isEn ? 'Overlap' : '重叠人声') : (isFr ? 'Chœur' : isEn ? 'Harmony' : '和声');
    tags.push(`<span class="ln-tag is-harmony" title="${escapeHtml(m.backingText || '')}">${lbl}</span>`);
  }
  const lf = Array.isArray(m.flags) ? m.flags : [];
  if (m.unclear || m.vocalType === 'unclear' || lf.includes('uncertain_word') || lf.includes('misrecognized_word')) {
    const flbl = lf.includes('misrecognized_word')
      ? (isFr ? 'À vérifier' : isEn ? 'Verify' : '待核对')
      : (isFr ? 'Flou' : isEn ? 'Unclear' : '模糊');
    tags.push(`<span class="ln-tag is-warn" title="${escapeHtml(m.validationNote || '')}">${flbl}</span>`);
  } else if (lf.includes('missing_word')) {
    tags.push(`<span class="ln-tag is-gap" title="${escapeHtml(m.validationNote || '')}">${isFr ? 'Manquant ?' : isEn ? 'Gap ?' : '疑似漏词'}</span>`);
  } else if (lf.includes('uncertain_boundary')) {
    tags.push(`<span class="ln-tag is-warn" title="${escapeHtml(m.validationNote || '')}">${isFr ? 'Borne ±' : isEn ? 'Bound ±' : '边界±'}</span>`);
  }
  return tags.length ? `<span class="ln-tags">${tags.join('')}</span>` : '';
}
function buildWordChars(w) {
  if (Array.isArray(w.chars) && w.chars.length) return w.chars;
  if (J.buildCharTimings) return J.buildCharTimings(w.text, w.start, w.end, S.audio);
  const chars = [...String(w.text || '')];
  const step = Math.max(0.01, (w.end - w.start) / Math.max(1, chars.length));
  return chars.map((ch, i) => ({ ch, start: +(w.start + i * step).toFixed(3), end: +(w.start + (i + 1) * step).toFixed(3) }));
}
function createWordSpan(w, wi, mode) {
  const sp = document.createElement('span');
  const flags = Array.isArray(w.flags) ? w.flags : [];
  const isUnc = flags.includes('uncertain_word') || flags.includes('misrecognized_word');
  const isOv = flags.includes('overlapping_vocals');
  const isBnd = flags.includes('uncertain_boundary');
  sp.className = 'kw' + (isUnc ? ' is-uncertain' : '') + (isOv ? ' is-overlap' : '') + (isBnd ? ' is-boundary-warn' : '');
  sp.dataset.w = w.text;
  sp.dataset.i = String(wi);
  sp.dataset.s = String(w.start);
  const recPct = w.recognitionConfidence != null ? Math.round(w.recognitionConfidence * 100) : null;
  const alignPct = w.alignmentConfidence != null ? Math.round(w.alignmentConfidence * 100) : null;
  const charInfo = Array.isArray(w.chars) && w.chars.length > 1 ? ` · ${w.chars.length} car.` : '';
  const phInfo = Array.isArray(w.phonemes) && w.phonemes.length ? ` · /${w.phonemes.map(p => p.unit).filter(Boolean).join('')}/` : '';
  const spkInfo = w.speaker && w.speaker !== 'Lead' ? ` · ${w.speaker}` : '';
  const confInfo = (recPct != null || alignPct != null) ? ` | rec ${recPct ?? '-'}% · align ${alignPct ?? '-'}%` : '';
  const flagInfo = flags.length ? ` [${flags.join(', ')}]` : '';
  sp.title = `${J.fmtTime(w.start)} → ${J.fmtTime(w.end)}${charInfo}${phInfo}${spkInfo}${confInfo}${flagInfo}`;
  if (mode === 'char') {
    const chs = buildWordChars(w);
    chs.forEach((c, ci) => {
      const cs = document.createElement('span');
      cs.className = 'kc';
      cs.textContent = c.ch != null ? c.ch : (c.char || '');
      cs.dataset.s = String(c.start);
      cs.dataset.e = String(c.end);
      cs.dataset.ci = String(ci);
      sp.appendChild(cs);
    });
  } else {
    sp.textContent = w.text;
  }
  sp.addEventListener('click', ev => {
    ev.stopPropagation();
    const row = sp.closest('.ks-line');
    if (row && row.dataset.line != null) selectLyricWord(+row.dataset.line, wi, false);
    else if (S.plan && S.plan.lines) {
      const lnNow = J.lineAt ? J.lineAt(S.plan, w.start + 0.005) : null;
      if (lnNow) selectLyricWord(lnNow.index, wi, false);
    }
    seek(w.start + 0.002);
    if (!S.playing && S.audio) play();
  });
  return sp;
}
function applyWordElementHighlight(sp, w, t, mode, lang) {
  if (!sp || !w) return;
  if (mode === 'char') {
    const cSpans = sp.children;
    const chs = buildWordChars(w, lang);
    for (let ci = 0; ci < chs.length; ci++) {
      const c = chs[ci], cs = cSpans[ci];
      if (!cs) continue;
      cs.classList.toggle('is-sung', t >= c.end);
      cs.classList.toggle('is-now', t >= c.start && t <= c.end);
    }
    sp.classList.toggle('is-sung', t >= w.end);
    sp.classList.toggle('is-now', t >= w.start && t <= w.end);
    return;
  }
  let pct = 0;
  if (t >= w.end) pct = 100;
  else if (t > w.start) {
    if (Array.isArray(w.chars) && w.chars.length > 1) {
      let done = 0;
      for (let ci = 0; ci < w.chars.length; ci++) {
        const c = w.chars[ci];
        if (t >= c.end) done += 1;
        else if (t > c.start) { done += J.clamp((t - c.start) / Math.max(0.01, c.end - c.start), 0, 1); break; }
        else break;
      }
      pct = J.clamp((done / w.chars.length) * 100, 0, 100);
    } else {
      pct = J.clamp(((t - w.start) / Math.max(0.02, w.end - w.start)) * 100, 0, 100);
    }
  }
  sp.style.setProperty('--kp', pct.toFixed(1) + '%');
  sp.classList.toggle('is-sung', mode === 'word' ? t >= w.start : pct >= 99.5);
  sp.classList.toggle('is-now', t >= w.start && t <= w.end);
}
let lastKpBadgeText = '';
let lastKpMomentEvalT = -999;
let lastKpMomentWordIdx = -1;
let lastKpMomentSnap = null;
function updateKaraokePrompter() {
  const activeEl = $('karaokeActive'), transActiveEl = $('karaokeTransActive'), backingEl = $('karaokeBacking'), nextEl = $('karaokeNext'), badge = $('karaokeModeBadge');
  const scrollStage = $('karaokeScrollStage'), scrollLinesEl = $('karaokeScrollLines');
  if (!activeEl || !S.plan || !S.plan.lines) return;
  const cfg = getKaraokeCfg();
  const trCfg = getTransCfg();
  const trEnabled = !!(S.project && S.project.translation && S.project.translation.enabled);
  const trShowPrompter = trEnabled && trCfg.showInPrompter !== false;
  const mode = cfg.mode || 'progressive';
  const langCode = J.resolveLang ? J.resolveLang(S.project) : 'auto';
  const t = S.t;
  const L = S.plan.lines;
  let ln = J.lineAt ? J.lineAt(S.plan, t) : null;
  let upcoming = null;
  if (!ln) {
    upcoming = L.find(l => !l.interlude && l.start > t) || null;
  } else {
    upcoming = L.find(l => !l.interlude && l.index > ln.index) || null;
  }

  const displayLn = (ln && !ln.interlude) ? ln : (upcoming && upcoming.start - t <= 1.2 ? upcoming : null);
  const displayTrans = (trShowPrompter && displayLn && displayLn.translatedText) ? displayLn.translatedText : '';
  const key = (displayLn ? `${displayLn.index}:${displayLn.text}:${(displayLn.wordsTimed || []).length}:${displayTrans}` : (upcoming ? `wait:${upcoming.index}` : 'none'));

  if (badge) {
    const wt = S.project && S.project.timing && S.project.timing.wordTimes;
    const hasAiWords = wt && displayLn && Array.isArray(wt[displayLn.index]) && wt[displayLn.index].length > 0;
    const lang = document.documentElement.lang;
    let baseLbl = hasAiWords
      ? (lang === 'fr' ? 'Syncro Voix & Parole' : lang === 'en' ? 'Voice & Lyric Sync' : 'AI 词字精同步')
      : (lang === 'fr' ? 'Alignement Vocal 10ms' : lang === 'en' ? '10ms Vocal Sync' : '10ms 声学词同步');
    if (displayLn && displayLn.wordsTimed && displayLn.wordsTimed.length) {
      const words = displayLn.wordsTimed;
      let activeWi = -1;
      for (let wi = 0; wi < words.length; wi++) {
        if (t >= words[wi].start && t <= words[wi].end) { activeWi = wi; break; }
      }
      if (S.audio && J.getMomentCoordinationSnapshot) {
        if (!lastKpMomentSnap || activeWi !== lastKpMomentWordIdx || Math.abs(t - lastKpMomentEvalT) >= 0.08) {
          lastKpMomentEvalT = t;
          lastKpMomentWordIdx = activeWi;
          lastKpMomentSnap = J.getMomentCoordinationSnapshot(S.audio, displayLn, activeWi >= 0 ? words[activeWi] : null, t);
        }
      } else {
        lastKpMomentSnap = null;
      }
      const snap = lastKpMomentSnap;
      const pctScore = snap ? snap.momentScore : Math.round((words.reduce((a, w) => a + (w.alignmentConfidence ?? 0.85), 0) / words.length) * 100);
      const driftBadge = snap && activeWi >= 0 && snap.hasAudio
        ? ` · ${snap.driftMs >= 0 ? '+' : ''}${snap.driftMs}ms`
        : '';
      const spk = (displayLn.meta && displayLn.meta.speaker && displayLn.meta.speaker !== 'Lead')
        ? displayLn.meta.speaker
        : (words[0].speaker && words[0].speaker !== 'Lead' ? words[0].speaker : '');
      const lCode = displayLn.language || (displayLn.meta && displayLn.meta.language) || '';
      const lTag = lCode && J.LANG_LABEL[lCode] ? ` · ${lCode}` : '';
      baseLbl += ` · ${pctScore}%${driftBadge}${lTag}` + (spk ? ` · ${spk}` : '');
    }
    if (baseLbl !== lastKpBadgeText) {
      lastKpBadgeText = baseLbl;
      badge.textContent = baseLbl;
    }
  }

  if (lastKpState.key !== key || lastKpState.mode !== mode) {
    lastKpState.key = key;
    lastKpState.mode = mode;
    activeEl.innerHTML = '';
    if (displayLn && displayLn.wordsTimed && displayLn.wordsTimed.length) {
      displayLn.wordsTimed.forEach((w, wi) => activeEl.appendChild(createWordSpan(w, wi, mode, langCode)));
    } else {
      const lang = document.documentElement.lang;
      activeEl.innerHTML = `<span class="muted" style="font-size:13px;font-weight:500">${escapeHtml(
        ln && ln.interlude ? '♪ Interlude' : upcoming ? `♪ ${upcoming.text}` : (lang === 'fr' ? 'Prêt pour le karaoké' : lang === 'en' ? 'Karaoke ready' : 'カラオケ待機中')
      )}</span>`;
    }
    if (transActiveEl) {
      if (displayTrans) {
        transActiveEl.textContent = displayTrans;
        transActiveEl.hidden = false;
      } else {
        transActiveEl.textContent = '';
        transActiveEl.hidden = true;
      }
    }
    if (backingEl) {
      const m = displayLn && displayLn.meta;
      const bTxt = m && m.backingText ? `♪ (${m.backingText})` : '';
      backingEl.textContent = bTxt;
      backingEl.hidden = !bTxt;
    }
    if (nextEl) {
      const preview = displayLn ? upcoming : null;
      nextEl.textContent = preview ? `↳ ${preview.text}` : '';
    }
  } else if (transActiveEl) {
    if (displayTrans) {
      if (transActiveEl.textContent !== displayTrans) transActiveEl.textContent = displayTrans;
      transActiveEl.hidden = false;
    } else {
      transActiveEl.hidden = true;
    }
  }

  if (displayLn && displayLn.wordsTimed && displayLn.wordsTimed.length) {
    const spans = activeEl.children;
    for (let wi = 0; wi < displayLn.wordsTimed.length; wi++) {
      applyWordElementHighlight(spans[wi], displayLn.wordsTimed[wi], t, mode, langCode);
    }
  }

  // Scrollable multi-line karaoke stage + automatic lyric centering
  if (scrollStage && scrollLinesEl) {
    const vocalLines = L.filter(l => !l.interlude && l.text);
    const sig = mode + '|' + (trShowPrompter ? '1' : '0') + '|' + vocalLines.map(l => `${l.index}:${l.text}:${l.start}:${trShowPrompter ? (l.translatedText || '') : ''}`).join(';');
    if (sig !== lastKpScrollSig) {
      lastKpScrollSig = sig;
      lastKpScrollIdx = -2;
      scrollLinesEl.innerHTML = '';
      vocalLines.forEach(l => {
        const row = document.createElement('div');
        row.className = 'ks-line';
        row.dataset.line = String(l.index);
        if (Array.isArray(l.wordsTimed) && l.wordsTimed.length) {
          l.wordsTimed.forEach((w, wi) => row.appendChild(createWordSpan(w, wi, mode, langCode)));
        } else {
          const origSpan = document.createElement('span');
          origSpan.className = 'ks-orig';
          origSpan.textContent = l.text;
          row.appendChild(origSpan);
        }
        if (trShowPrompter && l.translatedText) {
          const trDiv = document.createElement('div');
          trDiv.className = 'ks-trans';
          trDiv.textContent = l.translatedText;
          row.appendChild(trDiv);
        }
        row.addEventListener('click', () => { seek(l.start + 0.002); if (!S.playing && S.audio) play(); });
        scrollLinesEl.appendChild(row);
      });
    }
    const curIdx = displayLn ? displayLn.index : (ln && !ln.interlude ? ln.index : -1);
    const rows = scrollLinesEl.children;
    let activeRow = null;
    for (let ri = 0; ri < rows.length; ri++) {
      const row = rows[ri];
      const idx = +(row.dataset.line || -1);
      const lObj = vocalLines[ri];
      const isCur = idx === curIdx;
      const isPast = curIdx >= 0 ? idx < curIdx : (lObj ? lObj.end < t : false);
      row.classList.toggle('is-cur', isCur);
      row.classList.toggle('is-past', !isCur && isPast);
      if (isCur) activeRow = row;
      if (isCur || !isPast) {
        if (row.dataset.pastDone === '1') row.dataset.pastDone = '';
      }
      if (lObj && Array.isArray(lObj.wordsTimed)) {
        if (isCur || (isPast && row.dataset.pastDone !== '1') || row.dataset.dirty === '1') {
          row.dataset.dirty = isCur ? '1' : '';
          for (let wi = 0; wi < lObj.wordsTimed.length; wi++) {
            applyWordElementHighlight(row.children[wi], lObj.wordsTimed[wi], isCur ? t : (isPast ? lObj.end + 1 : -1), mode, langCode);
          }
          if (!isCur && isPast) row.dataset.pastDone = '1';
        }
      }
    }
    if (cfg.autoScroll !== false && activeRow && curIdx !== lastKpScrollIdx) {
      lastKpScrollIdx = curIdx;
      const targetTop = Math.max(0, activeRow.offsetTop - scrollStage.clientHeight / 2 + activeRow.offsetHeight / 2);
      try {
        if (typeof scrollStage.scrollTo === 'function') scrollStage.scrollTo({ top: targetTop, behavior: 'smooth' });
        else scrollStage.scrollTop = targetTop;
      } catch (e) {
        scrollStage.scrollTop = targetTop;
      }
    } else if (curIdx !== lastKpScrollIdx) {
      lastKpScrollIdx = curIdx;
    }
  }

  // Vocal entry lead-in countdown bar during rests/interludes before next sung phrase
  const leadBar = $('kpLeadBar'), leadText = $('kpLeadText'), leadFill = $('kpLeadFill');
  if (leadBar && leadText && leadFill) {
    const waitTarget = upcoming && (!ln || ln.interlude || t < ln.start - 0.04) ? upcoming : null;
    const diff = waitTarget ? (waitTarget.start - t) : -1;
    if (waitTarget && diff > 0.04 && diff <= 2.8) {
      const l = (document.documentElement.lang || 'fr').toLowerCase();
      leadBar.hidden = false;
      leadText.textContent = l === 'fr'
        ? `♪ Entrée vocale dans ${diff.toFixed(1)}s`
        : l === 'en'
        ? `♪ Vocal entry in ${diff.toFixed(1)}s`
        : l.startsWith('zh')
        ? `♪ 准备开唱 ${diff.toFixed(1)}s`
        : l === 'ko'
        ? `♪ 보컬 시작 ${diff.toFixed(1)}초 전`
        : `♪ 歌い出しまで ${diff.toFixed(1)}秒`;
      const pct = J.clamp((1 - diff / 2.8) * 100, 4, 100);
      leadFill.style.width = pct.toFixed(1) + '%';
    } else {
      leadBar.hidden = true;
      leadFill.style.width = '0%';
    }
  }
}

/* Pro Vocal Coordination Actions: global live sync nudge, anchored phrase/song alignment, 1-click live word pin */
function nudgeGlobalSyncOffset(deltaMs, exactMs = null) {
  if (!S.project) return 0;
  ensureTimingMaps();
  const prev = Number(S.project.timing.globalOffsetMs) || 0;
  const next = J.clamp(Math.round(exactMs != null ? exactMs : (prev + (Number(deltaMs) || 0))), -600, 600);
  if (next === prev && exactMs == null) return next;
  pushEdit();
  S.project.timing.globalOffsetMs = next;
  replan();
  syncKaraokeControls();
  syncLyricsEditor();
  flushSave();
  return next;
}

function alignAllWordsAcousticallyUI() {
  if (!S.project || !S.plan || !Array.isArray(S.plan.lines) || !S.plan.lines.length) return { linesAligned: 0, wordsAligned: 0 };
  const lang = (document.documentElement.lang || 'fr').toLowerCase();
  if (!S.audio || !(S.audio.wordAttack100 && S.audio.wordAttack100.length)) {
    toast(lang === 'fr'
      ? "Chargez un fichier audio pour aligner automatiquement les mots sur la voix."
      : lang === 'en'
      ? 'Load an audio file first to align words with vocals.'
      : '请先加载音频文件后再执行声学词对齐。');
    return { linesAligned: 0, wordsAligned: 0 };
  }
  pushEdit();
  ensureTimingMaps();
  const globalLang = J.resolveLang ? J.resolveLang(S.project) : 'auto';
  const gShift = J.clamp(Number(S.project.timing.globalOffsetMs) || 0, -600, 600) / 1000 - (S.project.typeset ? 0.2 : 0);
  let linesAligned = 0, wordsAligned = 0;
  S.plan.lines.forEach((ln, li) => {
    if (!ln || ln.interlude || !ln.text) return;
    const words = getEditableWords(li);
    if (!words.length) return;
    const spk = (ln.meta && ln.meta.speaker) || 'Lead';
    const lineLang = ln.language || globalLang;
    const rawStart = Math.max(0, ln.start - gShift);
    const rawEnd = Math.max(rawStart + 0.15, (ln.visEnd || ln.end) - gShift);
    const aligned = J.alignLineWordsAnchored
      ? J.alignLineWordsAnchored(S.audio, words, rawStart, rawEnd, lineLang, spk)
      : words;
    S.project.timing.wordTimes[li] = aligned;
    linesAligned++;
    wordsAligned += aligned.filter(w => !w.validated).length;
  });
  replan();
  syncLyricsEditor();
  syncQualityControlPanel();
  flushSave();
  recordWork('vocal_coord_align', 'sync', `${linesAligned} lignes · ${wordsAligned} mots calés (10ms)`);
  toast(lang === 'fr'
    ? `⚡ Auto-calage vocal terminé : ${linesAligned} phrases alignées (mots verrouillés conservés).`
    : lang === 'en'
    ? `⚡ Auto vocal word alignment finished: ${linesAligned} lines synced.`
    : `⚡ 人声逐词自动对齐完成：已校准 ${linesAligned} 行（已锁定词保持不变）。`);
  return { linesAligned, wordsAligned };
}

function kpQuickTapCurrentWord() {
  if (!S.project || !S.plan || !Array.isArray(S.plan.lines)) return null;
  const L = S.plan.lines;
  const gShift = J.clamp(Number(S.project.timing.globalOffsetMs) || 0, -600, 600) / 1000 - (S.project.typeset ? 0.2 : 0);
  const tDisp = Math.max(0, S.t);
  let ln = (J.lineAt && J.lineAt(S.plan, tDisp));
  if (!ln || ln.interlude) {
    ln = L.find(l => !l.interlude && l.end >= tDisp - 0.15) || L.find(l => !l.interlude);
  }
  if (!ln) return null;
  const li = ln.index;
  const words = getEditableWords(li);
  if (!words.length) return null;
  ensureTimingMaps();

  // Target word: closest unvalidated/active word at current timestamp
  let wi = words.findIndex((w, idx) => {
    const dispWStart = (ln.wordsTimed && ln.wordsTimed[idx]) ? ln.wordsTimed[idx].start : (w.start + gShift);
    const dispWEnd = (ln.wordsTimed && ln.wordsTimed[idx]) ? ln.wordsTimed[idx].end : (w.end + gShift);
    return tDisp <= dispWEnd + 0.05 && tDisp >= dispWStart - 0.35;
  });
  if (wi < 0) wi = words.findIndex(w => !w.validated);
  if (wi < 0) wi = 0;

  pushEdit();
  const minRaw = wi > 0 ? (words[wi - 1].start + 0.03) : Math.max(0, (ln.start - gShift) - 0.25);
  const rawTapT = Math.max(minRaw, tDisp - gShift);
  const atk = J.estimateVocalAttackNear
    ? J.estimateVocalAttackNear(S.audio, rawTapT, 0.085, minRaw)
    : { found: false, attackTime: +rawTapT.toFixed(3) };
  const pinT = atk.found ? atk.attackTime : +rawTapT.toFixed(3);
  const prevDur = Math.max(0.12, (words[wi].end || 0) - (words[wi].start || 0));

  if (wi > 0 && words[wi - 1].end > pinT - 0.005) {
    words[wi - 1].end = +Math.max(words[wi - 1].start + 0.03, pinT - 0.005).toFixed(3);
    rescaleWordChars(words[wi - 1], words[wi - 1].start, words[wi - 1].end);
  }
  words[wi].start = pinT;
  words[wi].end = +Math.max(pinT + 0.08, pinT + prevDur).toFixed(3);
  words[wi].validated = true;
  words[wi].alignmentConfidence = 0.96;
  words[wi].flags = (words[wi].flags || []).filter(f => f !== 'uncertain_boundary');
  rescaleWordChars(words[wi], words[wi].start, words[wi].end);
  if (wi === 0 && pinT < (ln.start - gShift)) {
    S.project.timing.lineTimes[li] = pinT;
  }

  // Re-align unvalidated neighbors cleanly around the new anchor if audio exists
  const rawLineStart = S.project.timing.lineTimes[li] != null ? S.project.timing.lineTimes[li] : Math.max(0, ln.start - gShift);
  const rawLineEnd = Math.max(rawLineStart + 0.2, (ln.visEnd || ln.end) - gShift, words[words.length - 1].end);
  const spk = (ln.meta && ln.meta.speaker) || 'Lead';
  const resultWords = (S.audio && J.alignLineWordsAnchored)
    ? J.alignLineWordsAnchored(S.audio, words, rawLineStart, rawLineEnd, ln.language || (J.resolveLang ? J.resolveLang(S.project) : 'auto'), spk)
    : words;

  S.project.timing.wordTimes[li] = resultWords;
  replan();
  if (typeof selectLyricWord === 'function') selectLyricWord(li, wi);
  syncLyricsEditor();
  syncQualityControlPanel();
  flushSave();

  const lang = (document.documentElement.lang || 'fr').toLowerCase();
  toast(lang === 'fr'
    ? `⏱ Mot "${words[wi].text}" calé à ${J.fmtTime(pinT)}${atk.found ? ' (attaque vocale)' : ''}`
    : `⏱ Pinned "${words[wi].text}" at ${J.fmtTime(pinT)}`);
  return { lineIdx: li, wordIdx: wi, start: pinT };
}

/* ---------------- timeline (CORE FUNCTION 07: Professional Multi-Track Audio Timeline) ---------------- */
// zoomable view: [TL.off, TL.off + D / TL.z] seconds across ruler, waveform+vocal, lyric segments, word boxes & char timings
const layoutHue = k => (J.LAYOUT_ORDER.indexOf(k) * 37 + 30) % 360;
const TL = { z: 1, off: 0, hover: -1, drag: -1, wHover: null, wDrag: null, showWave: true, showVocal: true, follow: true, selCharIdx: -1, hoverTime: null, cache: { cv: null, key: '' } };
let tlMonoFont = '';
function tlView() {
  const D = Math.max(0.001, S.plan.duration), vd = D / TL.z;
  TL.off = J.clamp(TL.off, 0, Math.max(0, D - vd));
  return { D, vd, off: TL.off };
}
function tlZoom(f, tc) {
  const { D, vd } = tlView();
  const maxZ = Math.max(24, D * 4);
  const z = J.clamp(TL.z * f, 1, maxZ);
  const c = tc == null ? S.t : tc, frac = (c - TL.off) / vd;
  TL.z = z; TL.off = c - frac * (D / z); tlView(); drawTimeline();
}
function tlFocusWord(li, wi) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li != null ? li : EDL.lineIdx];
  if (!ln || ln.interlude) return;
  const words = getEditableWords(ln.index);
  const wIdx = wi != null ? wi : EDL.wordIdx;
  const wd = words[wIdx] || words[0];
  const { D } = tlView();
  const s = wd ? wd.start : ln.start;
  const e = wd ? wd.end : (ln.visEnd || ln.end);
  const dur = Math.max(0.06, e - s);
  const targetSpan = J.clamp(Math.max(dur * 4.5, 1.2), 0.35, D);
  TL.z = J.clamp(D / targetSpan, 1, Math.max(24, D * 4));
  TL.off = Math.max(0, (s + e) * 0.5 - targetSpan * 0.5);
  tlView();
  if (wd) selectLyricWord(ln.index, wIdx, false);
  seek(s + 0.001);
  drawTimeline();
}
function tlBands(h, dpr) {
  const rulerTop = 0, rulerBot = Math.round(20 * dpr);
  const waveTop = rulerBot, waveBot = Math.round(h * 0.50);
  const segTop = waveBot, segBot = Math.round(h * 0.65);
  const wordTop = segBot, wordBot = Math.round(h * 0.84);
  const charTop = wordBot, charBot = Math.max(wordBot + 6 * dpr, h - 5 * dpr);
  return { rulerTop, rulerBot, waveTop, waveBot, segTop, segBot, wordTop, wordBot, charTop, charBot };
}
// while playing zoomed in: redraw (which scrolls the view) once the playhead leaves the visible part
function followTlPlayhead() {
  if (!TL.follow || !(TL.z > 1) || TL.drag >= 0 || TL.wDrag) return;
  const { vd, off } = tlView();
  if (S.t < off || S.t > off + vd * 0.90) drawTimeline();
}
function tlInspCopy() {
  const l = (document.documentElement.lang || 'fr').toLowerCase();
  if (l === 'fr') return {
    waveLbl: 'Audio', vocalLbl: 'Voix', followLbl: 'Suivi', zoomWord: '🔍 Mot', playWord: '▶ Mot',
    startLbl: 'Début (HH:MM:SS.mmm)', endLbl: 'Fin (HH:MM:SS.mmm)',
    noSel: 'Aucun mot sélectionné',
    confPrefix: 'Confiance alignement',
    recPrefix: 'reconnaissance',
    manualVal: 'Validé manuellement',
    secVocal: 'Section vocale', secInst: 'Section instrumentale', secOverlap: 'Voix superposées', secMix: 'Audio analysé',
    disclaimer: 'Affichage HH:MM:SS.mmm pour l’édition fine image par image — ne garantit pas une reconnaissance vocale à la milliseconde ; la confiance réelle d’alignement acoustique est affichée ci-dessus.',
    chars: 'car.', noAudio: 'Aucun audio chargé',
  };
  if (l === 'ja') return {
    waveLbl: '波形', vocalLbl: 'ボーカル', followLbl: '追従', zoomWord: '🔍 単語拡大', playWord: '▶ 単語',
    startLbl: '開始 (HH:MM:SS.mmm)', endLbl: '終了 (HH:MM:SS.mmm)',
    noSel: '単語未選択',
    confPrefix: 'アライメント信頼度',
    recPrefix: '認識',
    manualVal: '手動確定済み',
    secVocal: 'ボーカル区間', secInst: 'インスト区間', secOverlap: '重複ボーカル', secMix: '解析済み',
    disclaimer: 'HH:MM:SS.mmm表示はフレーム単位の精密編集用であり、AI音声認識が1ms精度を保証するものではありません。実際のアライメント信頼度を上に明示しています。',
    chars: '文字', noAudio: '音声未読み込み',
  };
  return {
    waveLbl: 'Audio', vocalLbl: 'Vocals', followLbl: 'Follow', zoomWord: '🔍 Word', playWord: '▶ Word',
    startLbl: 'Start (HH:MM:SS.mmm)', endLbl: 'End (HH:MM:SS.mmm)',
    noSel: 'No word selected',
    confPrefix: 'Alignment confidence',
    recPrefix: 'recognition',
    manualVal: 'Manually validated',
    secVocal: 'Vocal section', secInst: 'Instrumental section', secOverlap: 'Overlapping vocals', secMix: 'Analyzed audio',
    disclaimer: 'HH:MM:SS.mmm provides frame-like millisecond editing resolution — it does not guarantee millisecond AI recognition accuracy. Actual alignment confidence is tracked above.',
    chars: 'chars', noAudio: 'No audio loaded',
  };
}
function tlAudioSectionAt(t) {
  const A = S.audio;
  if (!A) return 'none';
  if (Array.isArray(A.overlapSegments) && A.overlapSegments.some(s => t >= s.start && t <= s.end)) return 'overlap';
  if (Array.isArray(A.vocalSegments) && A.vocalSegments.some(s => t >= s.start && t <= s.end)) return 'vocal';
  if (Array.isArray(A.instrumentalSegments) && A.instrumentalSegments.some(s => t >= s.start && t <= s.end)) return 'inst';
  return 'mix';
}
function syncTimelineInspector() {
  const c = tlInspCopy();
  const qc = qcCopy();
  const setT = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  setT('lblTlWave', c.waveLbl);
  setT('lblTlVocal', c.vocalLbl);
  setT('lblTlFollow', c.followLbl);
  setT('tlZoomWord', c.zoomWord);
  setT('tlPlayWordBtn', c.playWord);
  setT('tlReanalyzeBtn', qc.reanalyzeLine);
  setT('lblTlStartMs', c.startLbl);
  setT('lblTlEndMs', c.endLbl);
  setT('tlPrecisionDisclaimer', c.disclaimer);
  if ($('tlPlayMs') && J.fmtTimeMs) $('tlPlayMs').textContent = J.fmtTimeMs(S.t);
  if ($('tlDurMs') && J.fmtTimeMs) $('tlDurMs').textContent = J.fmtTimeMs(S.plan ? S.plan.duration : 0);
  if ($('tlZoomVal')) $('tlZoomVal').textContent = TL.z.toFixed(1) + '×';

  const L = (S.plan && S.plan.lines) || [];
  const ln = L[EDL.lineIdx];
  const words = ln && !ln.interlude ? getEditableWords(EDL.lineIdx) : [];
  const w = words[EDL.wordIdx] || null;
  const insp = $('tlInspector');
  if (insp) insp.classList.toggle('is-empty', !w);
  const startInp = $('tlWordStartMs'), endInp = $('tlWordEndMs');
  const confEl = $('tlConfBadge');
  const qcMetricsEl = $('tlQcMetrics');
  if (!w) {
    setT('tlSelWordBadge', c.noSel);
    setT('tlSelCharBadge', '');
    if (confEl) {
      confEl.className = 'tl-conf-badge mono';
      confEl.textContent = `${c.confPrefix} : —`;
    }
    if (qcMetricsEl) qcMetricsEl.innerHTML = '';
    setT('tlSectionBadge', S.audio ? c.secMix : c.noAudio);
    if (startInp && document.activeElement !== startInp) startInp.value = J.fmtTimeMs ? J.fmtTimeMs(0) : '00:00:00.000';
    if (endInp && document.activeElement !== endInp) endInp.value = J.fmtTimeMs ? J.fmtTimeMs(0) : '00:00:00.000';
    return;
  }
  const durMs = Math.max(1, Math.round((w.end - w.start) * 1000));
  setT('tlSelWordBadge', `« ${w.text} » · ${durMs}ms`);
  const chs = buildWordChars(w);
  if (TL.selCharIdx >= 0 && TL.selCharIdx < chs.length) {
    const ch = chs[TL.selCharIdx];
    const chTxt = ch.ch != null ? ch.ch : (ch.char || '');
    setT('tlSelCharBadge', `[${TL.selCharIdx + 1}/${chs.length} '${chTxt}' ${J.fmtTimeMs(ch.start)}→${J.fmtTimeMs(ch.end)}]`);
  } else {
    setT('tlSelCharBadge', chs.length ? `${chs.length} ${c.chars}` : '');
  }
  const qm = J.evaluateWordQuality ? J.evaluateWordQuality(w, S.audio, ln && ln.meta) : {
    transcriptionConfidence: w.recognitionConfidence ?? 0.8,
    alignmentConfidence: w.alignmentConfidence ?? 0.78,
    audioClarity: w.audioClarity ?? 0.75,
    vocalOverlap: w.vocalOverlap ?? 0.08,
    recognitionUncertainty: w.recognitionUncertainty ?? 0.24,
    qualityTier: 'MEDIUM',
    conditionWarnings: [],
  };
  const tierLabel = qm.qualityTier === 'HIGH' ? qc.high : qm.qualityTier === 'LOW' ? qc.low : qc.med;
  const tierDesc = qm.qualityTier === 'HIGH' ? qc.highDesc : qm.qualityTier === 'LOW' ? qc.lowDesc : qc.medDesc;
  const alignPct = Math.round(qm.alignmentConfidence * 100);
  const recPct = Math.round(qm.transcriptionConfidence * 100);
  if (confEl) {
    confEl.className = 'tl-conf-badge mono ' + (qm.qualityTier === 'HIGH' ? 'is-high' : qm.qualityTier === 'LOW' ? 'is-low' : 'is-mid');
    confEl.title = tierDesc;
    const parts = [tierLabel, `${c.confPrefix} : ${alignPct}%`, `${c.recPrefix} ${recPct}%`];
    if (w.validated) parts.push(c.manualVal);
    confEl.textContent = parts.join(' · ');
  }
  if (qcMetricsEl) {
    const clPct = Math.round(qm.audioClarity * 100);
    const ovPct = Math.round(qm.vocalOverlap * 100);
    const unPct = Math.round(qm.recognitionUncertainty * 100);
    const condTags = (qm.conditionWarnings || []).map(cw =>
      cw === 'noisy' ? qc.noisy : cw === 'distorted' ? qc.distorted : cw === 'reverberated' ? qc.reverb : qc.overlap
    ).join(' ');
    qcMetricsEl.innerHTML =
      `<span class="qm-item">${escapeHtml(qc.trLbl)}: <strong>${recPct}%</strong></span>` +
      `<span class="qm-item">${escapeHtml(qc.alLbl)}: <strong>${alignPct}%</strong></span>` +
      `<span class="qm-item">${escapeHtml(qc.clLbl)}: <strong>${clPct}%</strong></span>` +
      `<span class="qm-item">${escapeHtml(qc.ovLbl)}: <strong>${ovPct}%</strong></span>` +
      `<span class="qm-item">${escapeHtml(qc.unLbl)}: <strong>${unPct}%</strong></span>` +
      (condTags ? `<span class="qm-item" style="color:#b45309"><strong>${escapeHtml(condTags)}</strong></span>` : '');
  }
  const secType = tlAudioSectionAt((w.start + w.end) * 0.5);
  const secLabel = secType === 'overlap' ? c.secOverlap : secType === 'vocal' ? c.secVocal : secType === 'inst' ? c.secInst : c.secMix;
  setT('tlSectionBadge', w.speaker && w.speaker !== 'Lead' ? `${secLabel} · ${w.speaker}` : secLabel);
  if (startInp && document.activeElement !== startInp && J.fmtTimeMs) startInp.value = J.fmtTimeMs(w.start);
  if (endInp && document.activeElement !== endInp && J.fmtTimeMs) endInp.value = J.fmtTimeMs(w.end);
}
let lastTlZoomTxt = '';
function drawTimeline() {
  const c = $('timeline'), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(10, Math.round(c.clientWidth * dpr)), h = Math.max(10, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  let { D, vd, off } = tlView();
  // follow the playhead while playing (zoomed in)
  if (TL.follow && TL.z > 1 && S.playing && TL.drag < 0 && !TL.wDrag && (S.t < off || S.t > off + vd * 0.90)) { TL.off = S.t - vd * 0.1; ({ D, vd, off } = tlView()); }
  if (J.fmtTimeMs) {
    const pMs = J.fmtTimeMs(S.t);
    if (pMs !== lastTimeMsTxt && $('tlPlayMs')) { lastTimeMsTxt = pMs; $('tlPlayMs').textContent = pMs; }
    const dMs = J.fmtTimeMs(D);
    if (dMs !== lastDurMsTxt && $('tlDurMs')) { lastDurMsTxt = dMs; $('tlDurMs').textContent = dMs; }
  }
  const zTxt = TL.z.toFixed(1) + '×';
  if (zTxt !== lastTlZoomTxt && $('tlZoomVal')) { lastTlZoomTxt = zTxt; $('tlZoomVal').textContent = zTxt; }

  const outX = c.getContext('2d');
  if (!outX) return;
  const X = t => (t - off) / vd * w, T = px => off + px / w * vd;
  const B = tlBands(h, dpr);
  if (!tlMonoFont) tlMonoFont = getComputedStyle(document.body).getPropertyValue('--mono') || 'monospace';
  const monoFont = tlMonoFont;

  const expR = S.project && S.project.exportRange ? `${S.project.exportRange.from}:${S.project.exportRange.to}` : '';
  const whKey = TL.wHover ? `${TL.wHover.lineIdx}:${TL.wHover.wordIdx}:${TL.wHover.edge}` : '';
  const wdKey = TL.wDrag ? `${TL.wDrag.lineIdx}:${TL.wDrag.wordIdx}:${TL.wDrag.edge}` : '';
  const cacheKey = `${w}x${h}:${dpr}|${tlPlanRev}|${TL.z.toFixed(4)}|${off.toFixed(4)}|${TL.showWave ? 1 : 0}${TL.showVocal ? 1 : 0}|${TL.hover}|${TL.drag}|${whKey}|${wdKey}|${EDL.lineIdx}:${EDL.wordIdx}:${TL.selCharIdx}|${S.loop}|${expR}|${S.audio ? S.audio.duration : 0}`;

  if (!TL.cache) TL.cache = { cv: null, key: '' };
  let cacheCtx = null;
  if (TL.cache.cv && TL.cache.cv.width === w && TL.cache.cv.height === h && TL.cache.key === cacheKey) {
    outX.drawImage(TL.cache.cv, 0, 0);
  } else {
    try {
      if (!TL.cache.cv) TL.cache.cv = document.createElement('canvas');
      if (TL.cache.cv.width !== w || TL.cache.cv.height !== h) { TL.cache.cv.width = w; TL.cache.cv.height = h; }
      cacheCtx = TL.cache.cv.getContext('2d');
    } catch (e) { cacheCtx = null; }

    const x = cacheCtx || outX;

    // Background (Deep Obsidian Pro Mastering Timeline)
    x.fillStyle = '#07090f'; x.fillRect(0, 0, w, h);
    // Track separators
    x.fillStyle = '#0c0f17'; x.fillRect(0, B.rulerTop, w, B.rulerBot - B.rulerTop);
    x.fillStyle = 'rgba(255,255,255,0.06)';
    [B.rulerBot, B.waveBot, B.segBot, B.wordBot, B.charBot].forEach(y => x.fillRect(0, y, w, 1));

    // Time ruler ticks (adaptive step down to 100ms / 50ms on deep zoom)
    const pxPerSec = w / Math.max(0.05, vd);
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
    let step = 60;
    for (const s of steps) { if (s * pxPerSec >= 44 * dpr) { step = s; break; } }
    const tStart = Math.floor(off / step) * step;
    x.font = `500 ${8.5 * dpr}px ${monoFont}`;
    for (let tt = tStart; tt <= off + vd + step * 0.5; tt += step) {
      if (tt < 0 || tt > D) continue;
      const rx = Math.round(X(tt));
      x.fillStyle = 'rgba(255,255,255,0.16)';
      x.fillRect(rx, B.rulerBot - 5 * dpr, 1, 5 * dpr);
      x.fillStyle = '#94a3b8';
      const lbl = step < 1 ? J.fmtTimeMs(tt).slice(3) : J.fmtTime(tt);
      x.fillText(lbl, rx + 3 * dpr, B.rulerTop + 10 * dpr);
    }

    // Export range shading
    const R = exportRange();
    if (R) { x.fillStyle = 'rgba(10,132,255,0.10)'; x.fillRect(X(R.t0), 0, X(R.t1) - X(R.t0), h); }

    // Instrumental, vocal & overlap sections inside waveform track
    if (S.audio) {
      const drawSegs = (segs, fill, border, tag) => {
        if (!Array.isArray(segs)) return;
        for (const s of segs) {
          const x0 = X(s.start), x1 = X(s.end);
          if (x1 < 0 || x0 > w) continue;
          const cx0 = Math.max(0, x0), cw = Math.max(1, Math.min(w, x1) - cx0);
          x.fillStyle = fill;
          x.fillRect(cx0, B.waveTop + 1, cw, B.waveBot - B.waveTop - 2);
          x.fillStyle = border;
          x.fillRect(cx0, B.waveTop + 1, cw, 2 * dpr);
          if (cw > 34 * dpr && tag) {
            x.fillStyle = border;
            x.font = `700 ${7.5 * dpr}px ${monoFont}`;
            x.fillText(tag, cx0 + 4 * dpr, B.waveTop + 11 * dpr);
          }
        }
      };
      drawSegs(S.audio.instrumentalSegments, 'rgba(148,163,184,0.08)', 'rgba(148,163,184,0.52)', 'INST');
      drawSegs(S.audio.vocalSegments, 'rgba(16,185,129,0.10)', 'rgba(52,211,153,0.68)', 'VOIX');
      drawSegs(S.audio.overlapSegments, 'rgba(168,85,247,0.14)', 'rgba(192,132,252,0.78)', 'DUO');
    }

    // Track 1: Full audio waveform + separate Vocal waveform overlay
    const waveMid = (B.waveTop + B.waveBot) * 0.5;
    const waveAmp = Math.max(6 * dpr, (B.waveBot - B.waveTop) * 0.44);
    if (TL.showWave && S.audio && S.audio.peaks) {
      const pk = S.audio.peaks, n = pk.length, sd = S.audio.duration;
      x.fillStyle = 'rgba(148,163,184,0.42)';
      for (let i = 0; i < w; i += 2) {
        const t = T(i); if (t > sd) break; if (t < 0) continue;
        const v = pk[Math.min(n - 1, Math.floor(t / sd * n))];
        const hh = Math.max(1, v * waveAmp * 2);
        x.fillRect(i, waveMid - hh / 2, 1.5, hh);
      }
    }
    if (TL.showVocal && S.audio && (S.audio.vocalEnv100 || S.audio.vocalEnergy)) {
      const env = S.audio.vocalEnv100 || S.audio.vocalEnergy;
      const rate = S.audio.vocalEnv100 ? 100 : 50;
      let maxV = 0.05;
      for (let k = 0; k < env.length; k += 4) if (env[k] > maxV) maxV = env[k];
      x.fillStyle = 'rgba(56,189,248,0.88)';
      for (let i = 0; i < w; i += 2) {
        const t = T(i);
        const idx = Math.floor(t * rate);
        if (idx < 0 || idx >= env.length) continue;
        const norm = J.clamp(env[idx] / maxV, 0, 1);
        const vh = norm * waveAmp * 1.75;
        if (vh > 1) x.fillRect(i, waveMid - vh / 2, 1.5, vh);
      }
    }

    // Track 2: Individual Lyric Segments (lines & interludes)
    const segH = B.segBot - B.segTop - 2;
    const L = (S.plan && S.plan.lines) || [];
    for (const ln of L) {
      const x0 = X(ln.start), x1 = X(ln.visEnd || ln.end);
      if (x1 < 0 || x0 > w) continue;
      const isSelL = ln.index === EDL.lineIdx;
      const cx0 = Math.max(0, x0), cw = Math.max(2 * dpr, Math.min(w, x1) - cx0 - 1);
      const hue = ln.interlude ? 215 : ((ln.index * 47 + 205) % 360);
      x.fillStyle = ln.interlude ? 'rgba(148,163,184,0.12)' : (isSelL ? 'rgba(10,132,255,0.24)' : `hsla(${hue},68%,56%,0.16)`);
      x.fillRect(cx0, B.segTop + 1, cw, segH);
      x.fillStyle = isSelL ? '#0a84ff' : (ln.interlude ? '#94a3b8' : `hsla(${hue},78%,64%,0.85)`);
      x.fillRect(cx0, B.segTop + 1, Math.max(1.5 * dpr, isSelL ? 2.5 * dpr : 1.5 * dpr), segH);
      if (isSelL) {
        x.strokeStyle = 'rgba(59,158,255,0.68)'; x.lineWidth = dpr;
        x.strokeRect(cx0 + 0.5, B.segTop + 1.5, Math.max(1, cw - 1), segH - 1);
      }
      if (cw > 26 * dpr) {
        x.fillStyle = isSelL ? '#ffffff' : '#e2e8f0';
        x.font = `600 ${9 * dpr}px ${monoFont}`;
        x.save(); x.beginPath(); x.rect(cx0 + 3 * dpr, B.segTop + 1, Math.max(1, cw - 5 * dpr), segH); x.clip();
        const segTxt = ln.interlude ? `♪ ${ln.secs || Math.round(ln.end - ln.start)}s` : `${ln.index + 1}. ${ln.text}`;
        x.fillText(segTxt, cx0 + 4 * dpr, B.segTop + segH - 4 * dpr);
        x.restore();
      }
    }

    // Track 3: Word-level timestamps across all visible lines (plus acoustic audio highlight for selected word)
    const wordH = B.wordBot - B.wordTop - 2;
    const charH = B.charBot - B.charTop - 2;
    let selWordObj = null;
    for (const ln of L) {
      if (ln.interlude) continue;
      const words = Array.isArray(ln.wordsTimed) ? ln.wordsTimed : getEditableWords(ln.index);
      const isSelLine = ln.index === EDL.lineIdx;
      words.forEach((wd, wi) => {
        const wx0 = X(wd.start), wx1 = X(wd.end);
        if (wx1 < -4 || wx0 > w + 4) return;
        const isSelW = isSelLine && wi === EDL.wordIdx;
        const qm = J.evaluateWordQuality ? J.evaluateWordQuality(wd, S.audio, ln.meta) : { qualityTier: 'MEDIUM' };
        const isLow = qm.qualityTier === 'LOW';
        const isHigh = qm.qualityTier === 'HIGH';

        if (isSelW) {
          selWordObj = wd;
          x.fillStyle = 'rgba(10,132,255,0.14)';
          x.fillRect(wx0, B.waveTop, Math.max(2 * dpr, wx1 - wx0), B.charBot - B.waveTop);
        }

        x.fillStyle = isSelW
          ? 'rgba(10,132,255,0.34)'
          : isLow
            ? 'rgba(239,68,68,0.22)'
            : isHigh
              ? 'rgba(16,185,129,0.20)'
              : 'rgba(245,158,11,0.18)';
        x.fillRect(wx0, B.wordTop + 1, Math.max(2 * dpr, wx1 - wx0 - 1), wordH);

        if (isSelLine) {
          const hStart = (TL.wDrag && TL.wDrag.lineIdx === ln.index && TL.wDrag.wordIdx === wi && TL.wDrag.edge === 'start') || (TL.wHover && TL.wHover.lineIdx === ln.index && TL.wHover.wordIdx === wi && TL.wHover.edge === 'start');
          const hEnd = (TL.wDrag && TL.wDrag.lineIdx === ln.index && TL.wDrag.wordIdx === wi && TL.wDrag.edge === 'end') || (TL.wHover && TL.wHover.lineIdx === ln.index && TL.wHover.wordIdx === wi && TL.wHover.edge === 'end');
          x.fillStyle = hStart ? '#3b9eff' : isLow ? '#f87171' : isHigh ? '#34d399' : '#fbbf24';
          x.fillRect(wx0 - dpr * 0.5, B.wordTop + 1, 2 * dpr, wordH);
          x.beginPath(); x.arc(wx0, B.wordTop + 4 * dpr, (hStart ? 3.8 : 2.5) * dpr, 0, Math.PI * 2); x.fill();
          x.fillStyle = hEnd ? '#3b9eff' : '#94a3b8';
          x.fillRect(wx1 - dpr * 0.5, B.wordTop + 1, 2 * dpr, wordH);
          x.beginPath(); x.arc(wx1, B.wordBot - 4 * dpr, (hEnd ? 3.8 : 2.2) * dpr, 0, Math.PI * 2); x.fill();
        } else {
          x.fillStyle = isLow ? 'rgba(248,113,113,0.78)' : isHigh ? 'rgba(52,211,153,0.62)' : 'rgba(251,191,36,0.65)';
          x.fillRect(wx0, B.wordTop + 1, 1.2 * dpr, wordH);
        }

        if (wx1 - wx0 > 14 * dpr) {
          x.fillStyle = isSelW ? '#ffffff' : (isLow ? '#fca5a5' : isHigh ? '#6ee7b7' : '#fcd34d');
          x.font = `${isSelW ? 700 : 600} ${8.5 * dpr}px ${monoFont}`;
          x.save(); x.beginPath(); x.rect(wx0 + 2 * dpr, B.wordTop + 1, Math.max(1, wx1 - wx0 - 4 * dpr), wordH); x.clip();
          x.fillText(wd.text, wx0 + 3 * dpr, B.wordTop + wordH - 5 * dpr);
          x.restore();
        }

        if (!isSelW && vd <= 8) {
          const chs = buildWordChars(wd);
          chs.forEach(ch => {
            const cx0 = X(ch.start), cx1 = X(ch.end);
            if (cx1 < 0 || cx0 > w) return;
            x.fillStyle = 'rgba(148,163,184,0.14)';
            x.fillRect(cx0, B.charTop + 1, Math.max(1, cx1 - cx0 - 1), charH);
            if (cx1 - cx0 > 10 * dpr) {
              x.fillStyle = '#cbd5e1';
              x.font = `500 ${8 * dpr}px ${monoFont}`;
              x.fillText(ch.ch != null ? ch.ch : (ch.char || ''), cx0 + 2 * dpr, B.charTop + charH - 4 * dpr);
            }
          });
        }
      });
    }

    // Track 4: Selected Word Character-Level Timestamps
    if (selWordObj) {
      const chs = buildWordChars(selWordObj);
      chs.forEach((ch, ci) => {
        const cx0 = X(ch.start), cx1 = X(ch.end);
        if (cx1 < -2 || cx0 > w + 2) return;
        const isSelCh = ci === TL.selCharIdx;
        x.fillStyle = isSelCh ? 'rgba(10,132,255,0.38)' : 'rgba(56,189,248,0.18)';
        x.fillRect(cx0, B.charTop + 1, Math.max(2 * dpr, cx1 - cx0 - 1), charH);
        x.fillStyle = isSelCh ? '#0a84ff' : 'rgba(56,189,248,0.75)';
        x.fillRect(cx0, B.charTop + 1, dpr, charH);
        if (cx1 - cx0 > 8 * dpr) {
          x.fillStyle = isSelCh ? '#ffffff' : '#7dd3fc';
          x.font = `700 ${8.5 * dpr}px ${monoFont}`;
          const label = (ch.ch != null ? ch.ch : (ch.char || '')) + (cx1 - cx0 > 46 * dpr ? ` ${(ch.end - ch.start) * 1000 | 0}ms` : '');
          x.save(); x.beginPath(); x.rect(cx0 + dpr, B.charTop + 1, Math.max(1, cx1 - cx0 - 2 * dpr), charH); x.clip();
          x.fillText(label, cx0 + 2.5 * dpr, B.charTop + charH - 4 * dpr);
          x.restore();
        }
      });
    }

    // Beats + Zoom overview bar at bottom
    const beats = S.plan.beats || [];
    x.fillStyle = 'rgba(255,255,255,0.20)';
    for (const b of beats) { if (b < off) continue; if (b > off + vd) break; x.fillRect(Math.round(X(b)), h - 5 * dpr, 1, 5 * dpr); }
    if (TL.z > 1) {
      x.fillStyle = 'rgba(255,255,255,0.08)'; x.fillRect(0, h - 3 * dpr, w, 3 * dpr);
      x.fillStyle = '#0a84ff'; x.fillRect(off / D * w, h - 3 * dpr, Math.max(6 * dpr, vd / D * w), 3 * dpr);
    }

    // Top Ruler Line-Start Handles
    x.font = `600 ${8.5 * dpr}px ${monoFont}`;
    const LT = S.project.timing.lineTimes || {};
    for (const ln of L) {
      const lx = X(ln.start);
      if (lx < -20 * dpr || lx > w + 2) continue;
      const on = ln.index === TL.drag || ln.index === TL.hover, man = LT[ln.index] != null;
      x.fillStyle = on ? '#0a84ff' : man ? '#38bdf8' : '#64748b';
      x.fillRect(lx - (on ? dpr : 0), B.rulerTop, on ? 2 * dpr : 1, B.rulerBot - B.rulerTop);
      x.beginPath(); x.moveTo(lx - 4.5 * dpr, B.rulerTop); x.lineTo(lx + 4.5 * dpr, B.rulerTop); x.lineTo(lx, B.rulerTop + 6.5 * dpr); x.closePath(); x.fill();
      x.fillStyle = on ? '#3b9eff' : '#94a3b8';
      x.fillText(String(ln.index + 1).padStart(2, '0'), lx + 3 * dpr, B.rulerTop + 17.5 * dpr);
    }

    // Active Loop Highlight
    if (S.loop === 'line' || S.loop === 'cut') {
      const r = activeLoopRange();
      x.fillStyle = 'rgba(10,132,255,0.14)';
      x.fillRect(X(r.start), 0, Math.max(2 * dpr, X(r.end) - X(r.start)), h);
    }

    if (cacheCtx) {
      TL.cache.key = cacheKey;
      outX.drawImage(TL.cache.cv, 0, 0);
    }
  }

  // Playhead cursor (dynamic overlay per frame)
  const px = X(S.t);
  outX.fillStyle = '#0a84ff';
  outX.fillRect(Math.round(px) - dpr, 0, 2 * dpr, h);
  outX.beginPath(); outX.moveTo(px - 5 * dpr, 0); outX.lineTo(px + 5 * dpr, 0); outX.lineTo(px, 6 * dpr); outX.closePath(); outX.fill();
}
function tlTime(ev) {
  const r = $('timeline').getBoundingClientRect(), { vd, off } = tlView();
  return off + J.clamp((ev.clientX - r.left) / r.width, 0, 1) * vd;
}
function timelineSeek(ev) { seek(tlTime(ev)); }
/* the line whose start handle is under the pointer (top ruler band, ±8px) */
function tlHandleAt(ev) {
  const c = $('timeline'), r = c.getBoundingClientRect(), { vd, off } = tlView();
  if (ev.clientY - r.top > Math.max(24, r.height * 0.22)) return -1;
  let best = -1, bd = 8;
  for (const ln of S.plan.lines) { const d = Math.abs((ln.start - off) / vd * r.width - (ev.clientX - r.left)); if (d < bd) { bd = d; best = ln.index; } }
  return best;
}
/* word start/end handle under pointer (word track band 0.63..0.86) for selected line */
function tlWHandleAt(ev) {
  const c = $('timeline'), r = c.getBoundingClientRect(), { vd, off } = tlView();
  const yFrac = (ev.clientY - r.top) / Math.max(1, r.height);
  if (yFrac < 0.62 || yFrac > 0.87) return null;
  const ln = (S.plan && S.plan.lines) ? S.plan.lines[EDL.lineIdx] : null;
  if (!ln || ln.interlude || !Array.isArray(ln.wordsTimed) || !ln.wordsTimed.length) return null;
  let best = null, bd = 7.5;
  const px = ev.clientX - r.left;
  ln.wordsTimed.forEach((wd, wi) => {
    const ds = Math.abs((wd.start - off) / vd * r.width - px);
    if (ds < bd) { bd = ds; best = { lineIdx: ln.index, wordIdx: wi, edge: 'start' }; }
    const de = Math.abs((wd.end - off) / vd * r.width - px);
    if (de < bd) { bd = de; best = { lineIdx: ln.index, wordIdx: wi, edge: 'end' }; }
  });
  return best;
}
/* click a word box on track 3 or a character box on track 4 to select and inspect exact acoustic span */
function tlWordBoxAt(ev) {
  const c = $('timeline'), r = c.getBoundingClientRect();
  const yFrac = (ev.clientY - r.top) / Math.max(1, r.height);
  const t = tlTime(ev);
  const L = (S.plan && S.plan.lines) || [];
  if (yFrac >= 0.84 && yFrac <= 0.98) {
    const ln = L[EDL.lineIdx];
    const words = ln && !ln.interlude ? getEditableWords(ln.index) : [];
    const w = words[EDL.wordIdx];
    if (w) {
      const chs = buildWordChars(w);
      const ci = chs.findIndex(ch => t >= ch.start && t <= ch.end);
      if (ci >= 0) return { lineIdx: ln.index, wordIdx: EDL.wordIdx, charIdx: ci };
    }
  }
  if (yFrac >= 0.64 && yFrac <= 0.85) {
    for (const ln of L) {
      if (ln.interlude) continue;
      const words = Array.isArray(ln.wordsTimed) ? ln.wordsTimed : getEditableWords(ln.index);
      const wi = words.findIndex(wd => t >= wd.start && t <= wd.end);
      if (wi >= 0) return { lineIdx: ln.index, wordIdx: wi, charIdx: -1 };
    }
  }
  if (yFrac >= 0.50 && yFrac < 0.64) {
    const ln = L.find(item => !item.interlude && t >= item.start && t <= (item.visEnd || item.end));
    if (ln) return { lineIdx: ln.index, wordIdx: 0, charIdx: -1 };
  }
  return null;
}
function tlDragTo(i, ev) {
  let t = tlTime(ev);
  if (!ev.shiftKey && S.plan.beats && S.plan.beats.length) {       // snap to the nearest beat (Shift: free)
    let bt = null, bd = 0.12; for (const b of S.plan.beats) { const d = Math.abs(b - t); if (d < bd) { bd = d; bt = b; } if (b > t + 0.2) break; }
    if (bt != null) t = bt;
  }
  const L = S.plan.lines, lo = i > 0 ? L[i - 1].start + 0.2 : 0, hi = i < L.length - 1 ? L[i + 1].start - 0.2 : S.plan.duration - 0.2;
  t = +J.clamp(t, lo, Math.max(lo, hi)).toFixed(3);
  if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
  // pin the neighbours too, so moving one boundary never shifts the lines after it
  L.forEach(ln => { if (S.project.timing.lineTimes[ln.index] == null) S.project.timing.lineTimes[ln.index] = +ln.start.toFixed(3); });
  S.project.timing.lineTimes[i] = t;
  replan(); seek(t + 0.001);
}
function tlDragWordTo(wh, ev) {
  if (!wh) return;
  const t = tlTime(ev);
  applyWordTimeBoundary(wh.lineIdx, wh.wordIdx, wh.edge, t, { quiet: true, fastDrag: true });
}

/* ---------------- keep the playing line in view (the list scrolls inside its column) ---------------- */
let listTouched = 0;
function followLine(li) {
  if (!S.playing || li < 0 || !fixedLayout()) return;
  if (performance.now() - listTouched < 2500) return;                       // the user is scrolling the list
  const el = S.lineEls[li], col = el && el.closest('.col-left');
  if (!el || !col || col.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
  const tp = $('tapPanel'), pad = tp && !tp.hidden ? tp.offsetHeight + 12 : 8;   // 固定表示中のタップboxの下に隠れないように
  const r = el.getBoundingClientRect(), c = col.getBoundingClientRect();
  if (r.top >= c.top + pad && r.bottom <= c.bottom - 8) return;
  col.scrollTo({ top: col.scrollTop + (r.top - c.top) - Math.max(c.height * 0.3, pad + 24), behavior: 'smooth' });
}
function bindFollow() {
  const col = document.querySelector('.col-left'); if (!col) return;
  const touch = () => { listTouched = performance.now(); };
  col.addEventListener('wheel', touch, { passive: true }); col.addEventListener('touchmove', touch, { passive: true }); col.addEventListener('pointerdown', touch);
}

/* ---------------- cut info ---------------- */
const CHIP_GROUPS = [
  ['layout', 'l', 'レイアウト'], ['enter', 'e', '登場'], ['hold', 'h', '保持'], ['exit', 'x', '退場'],
  ['decor', '', '装飾'], ['treat', 't', '加工'], ['bg', 'b', '背景'], ['cam', 'c', 'カメラ'], ['trans', 'c', 'つなぎ'],
];
const cutPick = { g: null, line: -1, k: -1 };
let lastCutIdx = -2;

function lyricCutK(cut) {
  if (!cut || cut.line < 0) return -1;
  let k = 0;
  for (const c of S.plan.cuts) {
    if (c.line !== cut.line) continue;
    if (!J.LAYOUTS[c.layout] || J.LAYOUTS[c.layout].special) continue;
    if (c.index === cut.index) return k;
    k++;
  }
  return -1;
}
function cutQuietSlot(line, k) {
  const o = (S.project.overrides || {})[line] || {};
  return (o.cutQuiet && (o.cutQuiet[k] || o.cutQuiet[String(k)])) || {};
}
function markCutQuiet(i, k, groups, on) {
  if (i == null || i < 0 || k == null || k < 0) return;
  const cur = Object.assign({}, S.project.overrides[i] || {});
  const cutQuiet = Object.assign({}, cur.cutQuiet || {});
  const q = Object.assign({}, cutQuiet[k] || cutQuiet[String(k)] || {});
  delete cutQuiet[String(k)];
  groups.forEach(g => { if (on) q[g] = true; else delete q[g]; });
  if (Object.keys(q).length) cutQuiet[k] = q; else delete cutQuiet[k];
  if (Object.keys(cutQuiet).length) cur.cutQuiet = cutQuiet; else delete cur.cutQuiet;
  if (Object.keys(cur).length) S.project.overrides[i] = cur; else delete S.project.overrides[i];
}
function cutTechSlot(line, k) {
  const o = (S.project.overrides || {})[line] || {};
  const t = (o.cutTech && (o.cutTech[k] || o.cutTech[String(k)])) || {};
  const lay = o.cutLayouts && (o.cutLayouts[k] || o.cutLayouts[String(k)]);
  return lay && t.layout == null ? Object.assign({ layout: lay }, t) : t;
}
function cutGroupVal(cut, g) {
  if (g === 'layout') return cut.layout || '';
  if (g === 'enter') return cut.enter || '';
  if (g === 'hold') return cut.hold || '';
  if (g === 'exit') return cut.exit || '';
  if (g === 'treat') return cut.treat || 'none';
  if (g === 'bg') return cut.bg || 'none';
  if (g === 'cam') return cut.cam || 'push';
  if (g === 'trans') return cut.trans || '';
  if (g === 'decor') return (cut.decor && cut.decor[0] && cut.decor[0].id) || '';
  return '';
}
function groupName(g, k) {
  if (!k) return 'なし';
  const tbl = J.registry(g);
  return (tbl && tbl[k] && tbl[k].name) || k;
}
function pickEnabledTech(g, opts) {
  opts = opts || {};
  const tbl = J.registry(g) || {};
  const en = (S.project.enabled || {})[g] || {};
  let keys = J.order(g).filter(key => {
    const def = tbl[key];
    if (!def || def.special) return false;
    if (en[key] === false) return false;
    return !J.randomOk || J.randomOk(S.project, g, key);
  });
  if (!keys.length) keys = J.order(g).filter(key => tbl[key] && !tbl[key].special && en[key] !== false);
  if (g === 'layout' && opts.n != null) {
    const fit = keys.filter(key => !J.LAYOUTS[key].fits || J.LAYOUTS[key].fits(opts.n));
    if (fit.length) keys = fit;
  }
  if (opts.allowNone && !keys.includes('none')) keys = ['none'].concat(keys);
  if (opts.avoid && keys.length > 1) keys = keys.filter(key => key !== opts.avoid);
  if (!keys.length) return '';
  return keys[(Math.random() * keys.length) | 0];
}
function rerollCurrentCut(kind) {
  if (S.exporting || S.tap) return;
  const cut = J.cutAt(S.plan, S.t);
  const k = lyricCutK(cut);
  if (!cut || k < 0) { toast('この位置のカットは抽選できません'); return; }
  remember();
  const n = [...String(cut.text || '').replace(/\s+/g, '')].length;
  const groups = kind === 'omakase'
    ? CHIP_GROUPS.map(x => x[0])
    : ['layout', 'enter', 'hold', 'exit', 'cam', 'trans'];
  const t0 = S.t;
  groups.forEach(g => {
    const allowNone = g === 'decor' || g === 'trans';
    const key = pickEnabledTech(g, { avoid: kind === 'omakase' ? cutGroupVal(cut, g) : null, allowNone, n });
    if (key) setCutTech(cut.line, k, g, key);
  });
  markCutQuiet(cut.line, k, groups, true);
  closeCutPick();
  replan();
  commit();
  seek(t0);
  toast(kind === 'omakase' ? 'このカットをおまかせ' : 'このカットをシャッフル');
}
function updateCutInfo() {
  const cut = J.cutAt(S.plan, S.t);
  const idx = cut ? cut.index : -1;
  const li = cut ? cut.line : -1;
  if (li !== S.curLine) { S.lineEls.forEach((el, i) => el.classList.toggle('cur', i === li)); S.curLine = li; followLine(li); }
  if (idx === lastCutIdx) return;
  lastCutIdx = idx;
  // the cut playing now is marked in the line list
  document.querySelectorAll('.cut-lay.playing').forEach(x => x.classList.remove('playing'));
  if (cut && S.lineEls[li]) { const kk = lyricCutK(cut), cs = kk >= 0 && S.lineEls[li].querySelector(`.cut-lay[data-k="${kk}"]`); if (cs) cs.classList.add('playing'); }
  const el = $('cutInfo');
  if (!cut) { el.innerHTML = '<span class="hint">この位置にカットはありません</span>'; closeCutPick(); return; }
  if (S.mode !== 'pro') {          // かんたん／スマホは本家と同じ静的なチップ表示
    closeCutPick();
    const chip = (cls, k, v) => `<span class="chip ${cls}"><b>${k}</b>${v}</span>`;
    const n = (tbl, k) => (tbl[k] ? tbl[k].name : k);
    el.innerHTML = [
      `<span class="chip mono">#${String(cut.index + 1).padStart(2, '0')}</span>`,
      chip('l', 'レイアウト', n(J.LAYOUTS, cut.layout)), chip('e', '登場', n(J.ENTER, cut.enter)), chip('h', '保持', n(J.HOLD, cut.hold)), chip('x', '退場', n(J.EXIT, cut.exit)),
      cut.decor && cut.decor.length ? chip('', '装飾', cut.decor.map(d => n(J.DECOR, d.id)).join('・')) : '',
      cut.treat && cut.treat !== 'none' ? chip('t', '加工', n(J.TREAT, cut.treat)) : '',
      cut.bg && cut.bg !== 'none' ? chip('b', '背景', n(J.BG, cut.bg)) : '',
      cut.cam && cut.cam !== 'push' ? chip('c', 'カメラ', n(J.CAMERA, cut.cam)) : '',
      cut.trans ? chip('c', 'つなぎ', n(J.TRANS, cut.trans)) : '',
    ].join('');
    return;
  }
  const k = lyricCutK(cut);
  const slot = k >= 0 ? cutTechSlot(cut.line, k) : {};
  const quiet = k >= 0 ? cutQuietSlot(cut.line, k) : {};
  const bits = [`<span class="chip mono">#${String(cut.index + 1).padStart(2, '0')}</span>`];
  CHIP_GROUPS.forEach(([g, cls, label]) => {
    const forced = slot[g] != null && slot[g] !== '' && !quiet[g];
    bits.push(`<button type="button" class="chip ${cls}${forced ? ' is-forced' : ''}" data-g="${g}" aria-pressed="${cutPick.g === g ? 'true' : 'false'}" ${k < 0 ? 'disabled' : ''}><b>${label}</b>${escapeHtml(groupName(g, cutGroupVal(cut, g)))}</button>`);
  });
  bits.push(`<button type="button" class="ghost small cut-roll" data-roll="shuffle" ${k < 0 ? 'disabled' : ''} title="このカットだけ構成を再抽選">シャッフル</button>`);
  bits.push(`<button type="button" class="ghost small cut-roll accent" data-roll="omakase" ${k < 0 ? 'disabled' : ''} title="このカットだけ手法をランダムに">おまかせ</button>`);
  el.innerHTML = bits.join('');
  if (k >= 0) {
    el.querySelectorAll('button.chip[data-g]').forEach(b => b.addEventListener('click', () => toggleCutPick(b.dataset.g, cut, k)));
    el.querySelectorAll('button.cut-roll').forEach(b => b.addEventListener('click', () => rerollCurrentCut(b.dataset.roll)));
  }
  followCutPick(cut, k);
}
function followCutPick(cut, k) {
  if (S.mode !== 'pro' || !cutPick.g) return;
  const p = $('cutPick');
  if (!cut || k < 0) {
    cutPick.g = null; cutPick.line = -1; cutPick.k = -1;
    if (p) p.hidden = true;
    return;
  }
  cutPick.line = cut.line;
  cutPick.k = k;
  if (p) p.hidden = false;
  fillCutPick();
}
function closeCutPick() {
  cutPick.g = null; cutPick.line = -1; cutPick.k = -1;
  const p = $('cutPick'); if (p) p.hidden = true;
  lastCutIdx = -2;
}
function toggleCutPick(g, cut, k) {
  if (S.mode !== 'pro') return;
  if (cutPick.g === g && cutPick.line === cut.line && cutPick.k === k) { closeCutPick(); updateCutInfo(); return; }
  cutPick.g = g; cutPick.line = cut.line; cutPick.k = k;
  $('cutPick').hidden = false;
  fillCutPick();
  lastCutIdx = -2; updateCutInfo();
}
function fillCutPick() {
  const g = cutPick.g, grid = $('cutPickGrid');
  if (!g || !grid) return;
  const meta = CHIP_GROUPS.find(x => x[0] === g);
  const cut = J.cutAt(S.plan, S.t);
  $('cutPickTitle').textContent = (meta ? meta[2] : g) + (cut ? ' · #' + String(cut.index + 1).padStart(2, '0') : '');
  const cur = cut ? cutGroupVal(cut, g) : '';
  const forced = cutTechSlot(cutPick.line, cutPick.k)[g];
  const onKey = forced || cur;
  grid.innerHTML = '';
  if (g === 'decor' || g === 'trans') {
    const none = document.createElement('button');
    none.type = 'button';
    none.className = 'tcard' + (forced === 'none' ? ' is-on' : '');
    none.innerHTML = '<span class="tcard-name" style="padding:16px 6px"><span>なし</span></span>';
    none.addEventListener('click', () => { setCutTech(cutPick.line, cutPick.k, g, 'none'); replan(); });
    grid.appendChild(none);
  }
  const [W, H] = J.designSize(S.project.aspect || '16:9');
  const th = 80, tw = Math.max(72, Math.round(th * W / H));
  const items = J.order(g).filter(key => J.registry(g)[key] && !J.registry(g)[key].special);
  items.forEach(key => {
    const def = J.registry(g)[key];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tcard' + (key === onKey ? ' is-on' : '');
    b.title = key;
    b.innerHTML = `<canvas width="${tw}" height="${th}" data-g="${g}" data-k="${key}"></canvas><span class="tcard-name"><span>${escapeHtml(def.name)}</span>${setBadges(def)}</span>`;
    b.addEventListener('click', () => {
      setCutTech(cutPick.line, cutPick.k, g, key);
      replan();
    });
    grid.appendChild(b);
  });
  queueThumbs(grid);
}

/* ---------------- line list ---------------- */
function renderLines() {
  const ol = $('lineList'); ol.innerHTML = ''; S.lineEls = []; S.curLine = -2;
  const ov = S.project.overrides, R = exportRangeLines();
  const layoutOpts = '<option value="">自動</option>' + J.LAYOUT_ORDER.map(k => `<option value="${k}">${J.LAYOUTS[k].name}</option>`).join('');
  // layout menus hold only their current choice until they are used: a long song has hundreds of them
  // (with ~180 options each, building them all made every replan slow)
  const lazyLay = (sel, v) => {
    sel.innerHTML = '<option value="">自動</option>' + (v && J.LAYOUTS[v] ? `<option value="${v}">${J.LAYOUTS[v].name}</option>` : '');
    sel.value = v || '';
    const fill = () => { if (sel.dataset.full) return; const cur = sel.value; sel.innerHTML = layoutOpts; sel.value = cur; sel.dataset.full = '1'; };
    for (const ev of ['pointerdown', 'mousedown', 'focus', 'keydown', 'touchstart']) sel.addEventListener(ev, fill, { capture: true, passive: true });
  };
  const cutOpts = '<option value="">カット 自動</option>' + [1, 2, 3, 4, 5, 6].map(n => `<option value="${n}">カット ${n}</option>`).join('');
  S.plan.lines.forEach((ln, i) => {
    const o = ov[i] || {};
    const li = document.createElement('li'); li.className = 'ln' + (ln.interlude ? ' is-inter' : '') + (R && i >= R.from && i <= R.to ? ' in-range' : '');
    const manual = S.project.timing.lineTimes && S.project.timing.lineTimes[i] != null;
    const label = ln.interlude ? `〔間奏${ln.secs ? ' ' + ln.secs + '秒' : ''}〕` : ln.text;
    li.innerHTML = `<span class="no">${String(i + 1).padStart(2, '0')}</span>
      <input class="time mono" type="number" step="0.01" min="0" value="${ln.start.toFixed(2)}" title="開始（秒）${manual ? '・手動' : '・自動'}" aria-label="${i + 1}行目の開始秒" style="${manual ? 'border-color:var(--cyan)' : ''}">
      <span class="txt" title="${escapeHtml(label)}">${escapeHtml(label)}${renderLineTagsHtml(ln)}</span>
      <div class="meta"><span class="cuts"></span>
      <span class="tools">
        <button class="icon ghost edit" title="この行の歌詞を直す" aria-label="${i + 1}行目の歌詞を直す">${ICON.pen}</button>
        ${ln.interlude ? '' : `<select class="ncut" aria-label="${i + 1}行目のカット数">${cutOpts}</select>`}
        ${ln.interlude ? '' : `<select class="lay pro-only" aria-label="レイアウト指定"></select>`}
        <button class="icon ghost tapfrom" title="この行からタップで同期し直す" aria-label="${i + 1}行目からタップ">${ICON.tap}</button>
        <button class="icon ghost rng" title="書き出す範囲にする（Shift+クリックで範囲を広げる）" aria-pressed="${R && i >= R.from && i <= R.to ? 'true' : 'false'}" aria-label="${i + 1}行目を書き出す範囲に">${ICON.range}</button>
        ${ln.interlude ? '' : `<button class="icon ghost dice" title="この行を再抽選（再生位置の行は D キー）">${ICON.dice}</button>`}
        ${ln.interlude ? '' : `<button class="icon ghost lock" title="この行の構成をロック（再生位置の行は L キー）" aria-pressed="${o.lock ? 'true' : 'false'}">${ICON.lock}</button>`}
      </span></div>`;
    const q = sel => li.querySelector(sel);
    if (q('.lay')) lazyLay(q('.lay'), o.layout || '');
    if (q('.ncut')) q('.ncut').value = o.cuts ? String(o.cuts) : '';
    q('.time').addEventListener('change', e => {
      const v = parseFloat(e.target.value);
      pushEdit();
      if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
      if (isFinite(v)) {
        // keep the order: a typed time stays between the fixed times (typed or LRC) of the lines around it
        const lt = S.project.timing.lineTimes, L = S.plan.lines;
        const fix = j => (lt[j] != null && isFinite(+lt[j])) ? +lt[j] : (L[j] && L[j].lrc != null ? L[j].lrc : null);
        let lo = 0, hi = Infinity;
        for (let j = i - 1; j >= 0; j--) { const f = fix(j); if (f != null) { lo = f + 0.05; break; } }
        for (let j = i + 1; j < L.length; j++) { const f = fix(j); if (f != null) { hi = f - 0.05; break; } }
        let w = Math.max(0, v);
        if (hi >= lo && (w < lo || w > hi)) { w = J.clamp(w, lo, hi); toast(`前後の行と順番が入れ替わらないよう ${w.toFixed(2)} 秒にしました`); }
        lt[i] = +w.toFixed(3);
      } else delete S.project.timing.lineTimes[i];
      replan();
    });
    q('.txt').addEventListener('click', () => seek(ln.start + 0.001));
    q('.txt').addEventListener('dblclick', () => editLine(li, ln));
    q('.edit').addEventListener('click', () => editLine(li, ln));
    if (q('.lay')) q('.lay').addEventListener('change', e => { remember(); setOv(i, { layout: e.target.value || undefined }); replan(); commit(); });
    if (q('.ncut')) q('.ncut').addEventListener('change', e => { remember(); setOv(i, { cuts: +e.target.value || undefined, single: undefined }); replan(); commit(); seek(ln.start + 0.001); });
    q('.tapfrom').addEventListener('click', () => startTap(i));
    q('.rng').addEventListener('click', e => setExportRange(i, e.shiftKey));
    if (q('.dice')) q('.dice').addEventListener('click', () => rerollLine(i));
    if (q('.lock')) q('.lock').addEventListener('click', () => toggleLineLock(i));
    const cutsEl = q('.cuts');
    S.plan.cuts.filter(c => c.line === i && J.LAYOUTS[c.layout] && !J.LAYOUTS[c.layout].special).forEach((c, k) => {
      const forced = o.cutLayouts && o.cutLayouts[k];
      const sel = document.createElement('select');
      sel.className = 'cut-lay pro-only' + (forced ? ' is-forced' : '');
      lazyLay(sel, forced || c.layout);
      sel.title = `${c.text}｜${J.ENTER[c.enter].name} → ${J.EXIT[c.exit].name}`;
      sel.setAttribute('aria-label', `${i + 1}行目 カット${k + 1}のレイアウト`);
      sel.style.borderColor = `hsla(${layoutHue(c.layout)},70%,58%,0.7)`;
      sel.addEventListener('pointerdown', () => seek(c.start + Math.min(c.dur * 0.5, c.inDur + 0.05)));
      sel.addEventListener('change', e => { setCutLayout(i, k, e.target.value); replan(); seek(c.start + Math.min(c.dur * 0.5, c.inDur + 0.05)); });
      sel.dataset.k = String(k);
      // カットの開始時刻 (詳細モード): the first cut starts with the line; the others can be typed (empty = automatic)
      if (k > 0) {
        const tIn = document.createElement('input');
        const own = o.cutTime && o.cutTime[k] != null;
        tIn.type = 'number'; tIn.step = '0.01'; tIn.min = '0'; tIn.className = 'cut-time pro-only mono' + (own ? ' is-forced' : '');
        tIn.value = c.start.toFixed(2); tIn.title = own ? 'このカットの開始時刻（手動）。空にすると自動に戻ります' : 'このカットの開始時刻（自動）。数値を入れると固定します';
        tIn.setAttribute('aria-label', `${i + 1}行目 カット${k + 1}の開始時刻`);
        tIn.addEventListener('change', e => {
          const v = parseFloat(e.target.value);
          pushEdit();
          const ct = Object.assign({}, (S.project.overrides[i] || {}).cutTime || {});
          if (isFinite(v) && e.target.value !== '') ct[k] = +Math.max(0, v - ln.start).toFixed(3); else delete ct[k];
          setOv(i, { cutTime: Object.keys(ct).length ? ct : undefined }); replan(); seek(Math.max(0, (isFinite(v) ? v : c.start)) + 0.001);
        });
        const pair = document.createElement('div'); pair.className = 'cut-pair';
        pair.append(tIn, sel); cutsEl.appendChild(pair);
      } else cutsEl.appendChild(sel);
    });
    // スマホ: a row is one line of text; tapping it opens its tools (and jumps there)
    if (S.openLine === i) li.classList.add('open');
    li.addEventListener('click', e => {
      if (S.mode !== 'mobile' || e.target.closest('button, select, input, .cuts')) return;
      const was = li.classList.contains('open');
      S.lineEls.forEach(x => x.classList.remove('open'));
      if (!was) { li.classList.add('open'); S.openLine = i; } else S.openLine = -1;
    });
    ol.appendChild(li); S.lineEls.push(li);
  });
  $('linesInfo').textContent = `${S.plan.lines.length}行 / ${S.plan.cuts.length}カット`;
  syncRangeUI();
}

/* ---------------- 行から歌詞を直す ---------------- */
// the lyrics text is the source: a plan line knows the row it came from (ln.src); LRC time tags on that row are kept
const LRC_PREFIX = /^\s*(?:\[\d+:\d+(?:[.:]\d+)?\])*/;
function editLine(li, ln) {
  if (ln.src == null || li.querySelector('.txt-edit')) return;
  const rows = S.project.lyrics.replace(/\r/g, '').split('\n'), row = rows[ln.src] || '';
  const pre = (row.match(LRC_PREFIX) || [''])[0], body = row.slice(pre.length).trim();
  const txt = li.querySelector('.txt'), inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'txt-edit'; inp.value = body; inp.setAttribute('aria-label', `${ln.index + 1}行目の歌詞`);
  inp.title = '記法（/ 区切り・*強調*・行末の ! ・| 注釈・[間奏 8]）もそのまま使えます。Enter で確定、Esc で取り消し';
  txt.replaceWith(inp); inp.focus(); inp.select();
  let done = false;
  const finish = ok => {
    if (done) return; done = true;
    const v = inp.value.trim();
    if (ok && v && v !== body) {
      pushEdit();
      rows[ln.src] = pre + v;
      S.project.lyrics = rows.join('\n'); $('lyrics').value = S.project.lyrics;
      if (!S.project.timing.wordTimes) S.project.timing.wordTimes = {};
      if (J.realignLineWords) {
        const cleanBody = v.replace(/\*([^*]+)\*/g, '$1').replace(/\|.*$/, '').replace(/!$/, '').replace(/\//g, ' ').trim();
        const prevW = S.project.timing.wordTimes[ln.index] || ln.wordsTimed || [];
        const spk = (ln.meta && ln.meta.speaker) || 'Lead';
        S.project.timing.wordTimes[ln.index] = J.realignLineWords(S.audio, cleanBody, ln.start, ln.visEnd || ln.end, J.resolveLang(S.project), spk, prevW);
      } else if (J.alignWordsAcoustic) {
        const cleanBody = v.replace(/\*([^*]+)\*/g, '$1').replace(/\|.*$/, '').replace(/!$/, '').replace(/\//g, ' ').trim();
        S.project.timing.wordTimes[ln.index] = J.alignWordsAcoustic(S.audio, cleanBody, ln.start, ln.visEnd || ln.end, J.resolveLang(S.project));
      } else {
        delete S.project.timing.wordTimes[ln.index];
      }
      replan(); flushSave(); toast(`${ln.index + 1}行目の歌詞を直しました`);
    } else renderLines();
  };
  inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); } });
  inp.addEventListener('blur', () => finish(true));
}

/* ---------------- CORE FUNCTION 06: Precision Lyrics, Word, Char & Timestamp Editor ---------------- */
const EDL = { lineIdx: 0, wordIdx: 0 };
function leCopy() {
  const l = (document.documentElement.lang || 'fr').toLowerCase();
  if (l === 'fr') return {
    title: 'Éditeur de paroles & minutage', recalc: '↻ Réaligner', save: '✓ Enregistrer',
    playLine: '▶ Phrase', addLine: '+ Ligne', delLine: '✕ Ligne',
    lStart: 'Début phrase (s)', lEnd: 'Fin phrase (s)', words: 'Mots de la phrase',
    insPh: 'Mot manquant…', addBefore: '+ Avant', addAfter: '+ Après',
    wordPh: 'Mot sélectionné…', apply: 'Appliquer', playWord: '▶ Mot', delWord: '✕ Mot',
    valid: 'Verrouiller / validé (protège contre le réalignement)',
    wStart: 'Début mot (s)', wEnd: 'Fin mot (s)', chars: 'Caractères & minutage fin', addChar: '+ Caractère',
    defWord: 'mot', defLine: 'Nouvelle phrase',
    savedMsg: '✓ Corrections enregistrées et validation mise à jour.',
    recalcMsg: '↻ Alignement recalculé en préservant les mots validés.',
    realignWordMsg: '✓ Mot corrigé et mots voisins réalignés acoustiquement.',
  };
  if (l === 'en') return {
    title: 'Lyrics & Timestamp Editor', recalc: '↻ Recalculate', save: '✓ Save Corrected',
    playLine: '▶ Sentence', addLine: '+ Line', delLine: '✕ Line',
    lStart: 'Line Start (s)', lEnd: 'Line End (s)', words: 'Words in Line',
    insPh: 'Missing word…', addBefore: '+ Before', addAfter: '+ After',
    wordPh: 'Selected word…', apply: 'Apply & Align', playWord: '▶ Word', delWord: '✕ Word',
    valid: 'Validated lock (protected from realignment)',
    wStart: 'Word Start (s)', wEnd: 'Word End (s)', chars: 'Characters & Fine Timestamps', addChar: '+ Char',
    defWord: 'word', defLine: 'New lyric line',
    savedMsg: '✓ Corrected version saved and validated.',
    recalcMsg: '↻ Alignment recalculated while preserving validated timestamps.',
    realignWordMsg: '✓ Word updated and unvalidated neighbors realigned acoustically.',
  };
  if (l.startsWith('zh')) return {
    title: '歌词与逐词时间戳精修编辑器', recalc: '↻ 重新对齐', save: '✓ 保存修正版',
    playLine: '▶ 复听整句', addLine: '+ 加一行', delLine: '✕ 删此行',
    lStart: '句起时间 (秒)', lEnd: '句止时间 (秒)', words: '本句分词列表',
    insPh: '输入漏词…', addBefore: '+ 前插', addAfter: '+ 后插',
    wordPh: '修改当前词…', apply: '应用并重对齐', playWord: '▶ 复听此词', delWord: '✕ 删词',
    valid: '已校对锁定（后续重对齐时保留此词时间戳）',
    wStart: '词起时间 (秒)', wEnd: '词止时间 (秒)', chars: '单字字符与毫秒级时间戳', addChar: '+ 加字',
    defWord: '新词', defLine: '新增歌词句',
    savedMsg: '✓ 已保存修正版本并更新校验结果。',
    recalcMsg: '↻ 已根据人声重新对齐（保留已锁定的准确时间戳）。',
    realignWordMsg: '✓ 已修改词文本并自动重对齐相邻未锁定词。',
  };
  return {
    title: '歌詞・単語・文字タイムスタンプ詳細エディタ', recalc: '↻ 再計算', save: '✓ 修正を保存',
    playLine: '▶ 行を再生', addLine: '+ 行追加', delLine: '✕ 行削除',
    lStart: '行開始 (秒)', lEnd: '行終了 (秒)', words: '単語トークン',
    insPh: '不足語句…', addBefore: '+ 前に追加', addAfter: '+ 後に追加',
    wordPh: '選択中の単語…', apply: '適用・再整列', playWord: '▶ 単語再生', delWord: '✕ 削除',
    valid: '確定ロック（自動再整列から保護）',
    wStart: '開始 (秒)', wEnd: '終了 (秒)', chars: '1文字ごとの時刻調整', addChar: '+ 文字追加',
    defWord: '語', defLine: '新しい歌詞行',
    savedMsg: '✓ 修正内容を保存し検証を更新しました。',
    recalcMsg: '↻ 確定済み単語を保持したまま再整列しました。',
    realignWordMsg: '✓ 単語を変更し周辺単語を声学的に再整列しました。',
  };
}
function applyLeLabels() {
  const c = leCopy();
  const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  setT('leTitle', c.title);
  setT('btnLeRecalcLine', c.recalc);
  setT('btnLeSave', c.save);
  setT('lePlayLine', c.playLine);
  setT('leAddLine', c.addLine);
  setT('btnAddLyricLine', c.addLine);
  setT('leDelLine', c.delLine);
  setT('lblLeLineStart', c.lStart);
  setT('lblLeLineEnd', c.lEnd);
  setT('lblLeWords', c.words);
  setT('leAddWordBefore', c.addBefore);
  setT('leAddWordAfter', c.addAfter);
  setT('leApplyWord', c.apply);
  setT('lePlayWord', c.playWord);
  setT('leDelWord', c.delWord);
  setT('lblLeWordValid', c.valid);
  setT('lblLeWordStart', c.wStart);
  setT('lblLeWordEnd', c.wEnd);
  setT('lblLeChars', c.chars);
  setT('leAddChar', c.addChar);
  if ($('leInsertWordText')) $('leInsertWordText').placeholder = c.insPh;
  if ($('leWordText')) $('leWordText').placeholder = c.wordPh;
  applyTapLabels();
  applyCloudLabels();
}
function ensureTimingMaps() {
  if (!S.project.timing) S.project.timing = {};
  if (!S.project.timing.lineTimes) S.project.timing.lineTimes = {};
  if (!S.project.timing.lineEnds) S.project.timing.lineEnds = {};
  if (!S.project.timing.wordTimes) S.project.timing.wordTimes = {};
  if (!S.project.timing.lineMeta) S.project.timing.lineMeta = {};
}
function getEditableWords(li) {
  const ln = S.plan && S.plan.lines ? S.plan.lines[li] : null;
  if (!ln || ln.interlude) return [];
  ensureTimingMaps();
  const saved = S.project.timing.wordTimes[li];
  if (Array.isArray(saved) && saved.length) return saved.map(w => Object.assign({}, w));
  const globalShift = J.clamp(Number(S.project.timing.globalOffsetMs) || 0, -600, 600) / 1000;
  const leadShift = (S.plan && S.plan.typeset ? 0.2 : 0) - globalShift;
  if (Array.isArray(ln.wordsTimed) && ln.wordsTimed.length) {
    S.project.timing.wordTimes[li] = ln.wordsTimed.map(w => {
      const ws = +Math.max(0, (Number(w.start) || 0) + leadShift).toFixed(3);
      const we = +Math.max(ws + 0.02, (Number(w.end) || (ws + 0.15)) + leadShift).toFixed(3);
      return Object.assign({}, w, {
        start: ws,
        end: we,
        chars: Array.isArray(w.chars) && w.chars.length
          ? w.chars.map(ch => ({
              ch: ch.ch,
              start: +Math.max(0, (Number(ch.start) || 0) + leadShift).toFixed(3),
              end: +Math.max(0.008, (Number(ch.end) || 0.02) + leadShift).toFixed(3),
            }))
          : (J.buildCharTimings ? J.buildCharTimings(w.text, ws, we, S.audio) : []),
      });
    });
    return S.project.timing.wordTimes[li].map(w => Object.assign({}, w));
  }
  const s = Math.max(0, (Number(ln.start) || 0) + leadShift);
  const e = Math.max(s + 0.14, (Number(ln.visEnd || ln.end) || (s + 2)) + leadShift);
  const aligned = J.alignWordsAcoustic ? J.alignWordsAcoustic(S.audio, ln.text, s, e, J.resolveLang(S.project)) : [];
  S.project.timing.wordTimes[li] = aligned;
  return aligned.map(w => Object.assign({}, w));
}
function joinWordsText(words) {
  const list = (words || []).map(w => String(w.text || '').trim()).filter(Boolean);
  if (!list.length) return '';
  let out = '';
  for (let i = 0; i < list.length; i++) {
    const tk = list[i];
    if (!out) { out = tk; continue; }
    const prev = list[i - 1];
    const isPrevCjk = /[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]$/.test(prev);
    const isCurCjk = /^[\u3040-\u30ff\u4e00-\u9fff\uac00-\ud7af]/.test(tk);
    const isPunct = /^[,.!?;:)\]}»"'’、。！？]/.test(tk);
    const isOpen = /[(\[{«"'‘]$/.test(prev);
    if ((isPrevCjk && isCurCjk) || isPunct || isOpen) out += tk;
    else out += ' ' + tk;
  }
  return out;
}
function syncLineTextFromWords(li, words) {
  const ln = S.plan && S.plan.lines ? S.plan.lines[li] : null;
  if (!ln || ln.src == null) return;
  const rows = String(S.project.lyrics || '').replace(/\r/g, '').split('\n');
  const row = rows[ln.src] || '';
  const pre = (row.match(LRC_PREFIX) || [''])[0];
  const tailBar = row.includes('|') ? ' | ' + row.slice(row.indexOf('|') + 1).trim() : '';
  const body = joinWordsText(words) || '…';
  rows[ln.src] = pre + body + tailBar;
  S.project.lyrics = rows.join('\n');
  if ($('lyrics')) $('lyrics').value = S.project.lyrics;
}
function refreshStage6Validation() {
  if (!J.validateKaraokeAlignment || !S.plan || !S.plan.lines) return;
  ensureTimingMaps();
  const valLines = S.plan.lines.map((ln, idx) => ({
    start: ln.start,
    end: ln.visEnd || ln.end,
    isInstrumentalSection: !!ln.interlude,
    words: S.project.timing.wordTimes[idx] || ln.wordsTimed || [],
    flags: (S.project.timing.lineMeta[idx] && S.project.timing.lineMeta[idx].flags) || [],
  }));
  const val = J.validateKaraokeAlignment(S.audio, valLines);
  val.lines.forEach((vl, idx) => {
    if (vl && Array.isArray(vl.words) && vl.words.length) S.project.timing.wordTimes[idx] = vl.words;
    if (vl && Array.isArray(vl.flags)) {
      S.project.timing.lineMeta[idx] = Object.assign({}, S.project.timing.lineMeta[idx] || {}, { flags: vl.flags });
    }
  });
  if (S.project.detection) {
    S.project.detection.validationSummary = val.validationSummary;
    S.project.detection.hasUnclearSections = val.validationSummary.uncertainWords > 0 || val.validationSummary.misrecognizedWords > 0;
  }
  syncAudioDetectPanel();
}
function selectLyricWord(li, wi = 0, doSeek = false) {
  const L = (S.plan && S.plan.lines) || [];
  if (!L.length) return;
  EDL.lineIdx = J.clamp(li | 0, 0, L.length - 1);
  const words = getEditableWords(EDL.lineIdx);
  EDL.wordIdx = words.length ? J.clamp(wi | 0, 0, words.length - 1) : 0;
  TL.selCharIdx = -1;
  syncLyricsEditor();
  syncTimelineInspector();
  drawTimeline();
  if (doSeek) {
    const ln = L[EDL.lineIdx];
    const w = words[EDL.wordIdx];
    seek((w ? w.start : ln.start) + 0.002);
  }
}
function rescaleWordChars(w, newStart, newEnd) {
  const chs = buildWordChars(w);
  const oldS = Number(w.start) || newStart;
  const oldE = Math.max(oldS + 0.01, Number(w.end) || newEnd);
  const oldSpan = oldE - oldS;
  const newSpan = Math.max(0.02, newEnd - newStart);
  w.chars = chs.map((c, idx) => {
    const r0 = J.clamp((c.start - oldS) / oldSpan, 0, 1);
    const r1 = J.clamp((c.end - oldS) / oldSpan, r0, 1);
    const cs = idx === 0 ? newStart : +(newStart + r0 * newSpan).toFixed(3);
    const ce = idx === chs.length - 1 ? newEnd : +Math.max(cs + 0.005, newStart + r1 * newSpan).toFixed(3);
    return { ch: c.ch != null ? c.ch : (c.char || ''), start: +cs.toFixed(3), end: +ce.toFixed(3) };
  });
}
function applyWordTimeBoundary(li, wi, edge, rawTime, opts = {}) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln || ln.interlude) return;
  const words = getEditableWords(li);
  const w = words[wi]; if (!w) return;
  if (!opts.noUndo && !opts.quiet) pushEdit();
  ensureTimingMaps();
  const prevEnd = wi > 0 ? Math.max(0, words[wi - 1].start + 0.02) : 0;
  const nextStart = wi < words.length - 1 ? words[wi + 1].end - 0.02 : (ln.visEnd || ln.end) + 2;
  let ws = Number(w.start), we = Number(w.end);
  if (edge === 'start') {
    ws = +J.clamp(Number(rawTime), prevEnd, we - 0.02).toFixed(3);
    if (wi > 0 && words[wi - 1].end > ws && !words[wi - 1].validated) {
      words[wi - 1].end = +Math.max(words[wi - 1].start + 0.02, ws).toFixed(3);
      rescaleWordChars(words[wi - 1], words[wi - 1].start, words[wi - 1].end);
    }
    if (ws < ln.start && (li === 0 || ws > L[li - 1].start + 0.1)) {
      S.project.timing.lineTimes[li] = ws;
    }
  } else {
    we = +J.clamp(Number(rawTime), ws + 0.02, Math.max(ws + 0.04, nextStart)).toFixed(3);
    if (wi < words.length - 1 && words[wi + 1].start < we && !words[wi + 1].validated) {
      words[wi + 1].start = +Math.min(words[wi + 1].end - 0.02, we).toFixed(3);
      rescaleWordChars(words[wi + 1], words[wi + 1].start, words[wi + 1].end);
    }
    const maxLineEnd = li < L.length - 1 ? L[li + 1].start - 0.02 : S.plan.duration;
    if (we > (ln.visEnd || ln.end) && we <= maxLineEnd) {
      S.project.timing.lineEnds[li] = we;
    }
  }
  w.start = ws;
  w.end = we;
  w.validated = true;
  w.alignmentConfidence = 0.96;
  w.flags = (w.flags || []).filter(f => f !== 'uncertain_boundary');
  rescaleWordChars(w, ws, we);
  S.project.timing.wordTimes[li] = words;
  if (opts.fastDrag) {
    ln.wordsTimed = words;
    if (S.project.timing.lineTimes[li] != null) ln.start = S.project.timing.lineTimes[li];
    if (S.project.timing.lineEnds[li] != null) { ln.visEnd = S.project.timing.lineEnds[li]; ln.end = Math.max(ln.end, ln.visEnd); }
    tlPlanRev++;
    syncTimelineInspector();
    drawTimeline();
    return;
  }
  refreshStage6Validation();
  replan();
  syncTimelineInspector();
  if (!opts.quiet) { flushSave(); seek(ws + 0.002); }
}
function applyLineBoundary(li, edge, rawTime) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln) return;
  ensureTimingMaps();
  pushEdit();
  // Lock neighbor line start times so manual boundary edits never ripple into subsequent lines
  L.forEach((other, idx) => {
    if (S.project.timing.lineTimes[idx] == null) S.project.timing.lineTimes[idx] = +other.start.toFixed(3);
  });
  const tVal = +Math.max(0, Number(rawTime) || 0).toFixed(3);
  if (edge === 'start') {
    const lo = li > 0 ? L[li - 1].start + 0.12 : 0;
    const hi = li < L.length - 1 ? L[li + 1].start - 0.12 : Math.max(lo + 0.15, S.plan.duration - 0.12);
    const ns = +J.clamp(tVal, lo, Math.max(lo, hi)).toFixed(3);
    const oldS = ln.start, oldE = ln.visEnd || ln.end;
    S.project.timing.lineTimes[li] = ns;
    const words = getEditableWords(li);
    if (words.length && !words.every(w => w.validated)) {
      const span = Math.max(0.15, oldE - ns);
      const oldSpan = Math.max(0.15, oldE - oldS);
      words.forEach(w => {
        if (w.validated) return;
        const r0 = J.clamp((w.start - oldS) / oldSpan, 0, 1);
        const r1 = J.clamp((w.end - oldS) / oldSpan, r0, 1);
        w.start = +(ns + r0 * span).toFixed(3);
        w.end = +Math.max(w.start + 0.02, ns + r1 * span).toFixed(3);
        rescaleWordChars(w, w.start, w.end);
      });
      S.project.timing.wordTimes[li] = words;
    }
  } else {
    const lo = ln.start + 0.15;
    const hi = li < L.length - 1 ? L[li + 1].start : Math.max(lo + 0.2, (S.audio ? S.audio.duration : S.plan.duration + 10));
    const ne = +J.clamp(tVal, lo, Math.max(lo, hi)).toFixed(3);
    S.project.timing.lineEnds[li] = ne;
    const words = getEditableWords(li);
    if (words.length) {
      const lastW = words[words.length - 1];
      if (!lastW.validated && lastW.end > ne) {
        lastW.end = +Math.max(lastW.start + 0.02, ne).toFixed(3);
        rescaleWordChars(lastW, lastW.start, lastW.end);
        S.project.timing.wordTimes[li] = words;
      }
    }
  }
  refreshStage6Validation();
  replan();
  flushSave();
}
function commitWordTextEdit(li, wi, rawNewText) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln || ln.interlude) return;
  const words = getEditableWords(li);
  if (wi < 0 || wi >= words.length) return;
  const txt = String(rawNewText || '').trim();
  if (!txt) { deleteWordInLine(li, wi); return; }
  pushEdit();
  ensureTimingMaps();
  const lang = J.resolveLang(S.project);
  const spk = (ln.meta && ln.meta.speaker) || (words[wi] && words[wi].speaker) || 'Lead';
  const sLine = ln.start, eLine = ln.visEnd || ln.end;
  const realigned = J.realignSurroundingWords
    ? J.realignSurroundingWords(S.audio, words, wi, txt, sLine, eLine, lang, spk)
    : words;
  S.project.timing.wordTimes[li] = realigned;
  syncLineTextFromWords(li, realigned);
  refreshStage6Validation();
  replan();
  flushSave();
  EDL.wordIdx = J.clamp(wi, 0, Math.max(0, realigned.length - 1));
  syncLyricsEditor();
  toast(leCopy().realignWordMsg);
}
function insertWordInLine(li, wi, where, rawWordText) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln || ln.interlude) return;
  const words = getEditableWords(li);
  const textToAdd = String(rawWordText || '').trim() || leCopy().defWord;
  pushEdit();
  ensureTimingMaps();
  const pos = words.length === 0 ? 0 : (where === 'before' ? wi : wi + 1);
  const sLine = ln.start, eLine = ln.visEnd || ln.end;
  const leftBound = pos > 0 ? words[pos - 1].end : sLine;
  const rightBound = pos < words.length ? words[pos].start : eLine;
  let ws = leftBound, we = rightBound;
  if (we - ws < 0.14) {
    // Borrow slight room from unvalidated neighbor rather than overlapping or touching validated anchors
    if (pos > 0 && !words[pos - 1].validated && words[pos - 1].end - words[pos - 1].start > 0.25) {
      const cut = Math.min(0.18, (words[pos - 1].end - words[pos - 1].start) * 0.45);
      words[pos - 1].end = +(words[pos - 1].end - cut).toFixed(3);
      rescaleWordChars(words[pos - 1], words[pos - 1].start, words[pos - 1].end);
      ws = words[pos - 1].end;
    }
    if (pos < words.length && !words[pos].validated && words[pos].end - words[pos].start > 0.25) {
      const cut = Math.min(0.18, (words[pos].end - words[pos].start) * 0.45);
      words[pos].start = +(words[pos].start + cut).toFixed(3);
      rescaleWordChars(words[pos], words[pos].start, words[pos].end);
      we = words[pos].start;
    }
    if (we - ws < 0.08) {
      ws = +Math.max(sLine, (ws + we) * 0.5 - 0.1).toFixed(3);
      we = +Math.max(ws + 0.12, ws + 0.2).toFixed(3);
    }
  }
  const spk = (ln.meta && ln.meta.speaker) || 'Lead';
  const lang = J.resolveLang(S.project);
  const inserted = J.alignWordsAcoustic
    ? J.alignWordsAcoustic(S.audio, textToAdd, ws, we, lang, spk, 0.99).map(w => Object.assign(w, { validated: true, flags: [] }))
    : [{ text: textToAdd, start: +ws.toFixed(3), end: +we.toFixed(3), chars: [], recognitionConfidence: 0.99, alignmentConfidence: 0.92, speaker: spk, flags: [], validated: true }];
  const nextWords = words.slice(0, pos).concat(inserted, words.slice(pos));
  S.project.timing.wordTimes[li] = nextWords;
  syncLineTextFromWords(li, nextWords);
  if ($('leInsertWordText')) $('leInsertWordText').value = '';
  refreshStage6Validation();
  replan();
  flushSave();
  EDL.wordIdx = pos;
  syncLyricsEditor();
  if ($('leWordText')) { $('leWordText').focus(); $('leWordText').select(); }
}
function deleteWordInLine(li, wi) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln || ln.interlude) return;
  const words = getEditableWords(li);
  if (wi < 0 || wi >= words.length) return;
  if (words.length <= 1) { deleteLyricLine(li); return; }
  pushEdit();
  ensureTimingMaps();
  const nextWords = words.slice(0, wi).concat(words.slice(wi + 1));
  S.project.timing.wordTimes[li] = nextWords;
  syncLineTextFromWords(li, nextWords);
  refreshStage6Validation();
  EDL.wordIdx = Math.max(0, Math.min(wi, nextWords.length - 1));
  replan();
  flushSave();
}
function shiftSparseLineMaps(fromIdx, delta) {
  ensureTimingMaps();
  const keys = ['lineTimes', 'lineEnds', 'wordTimes', 'lineMeta'];
  for (const k of keys) {
    const src = S.project.timing[k] || {};
    const out = {};
    for (const [sk, v] of Object.entries(src)) {
      const idx = +sk;
      if (!Number.isInteger(idx)) continue;
      if (delta < 0 && idx === fromIdx) continue;
      const ni = (delta > 0 && idx > fromIdx) ? idx + 1 : (delta < 0 && idx > fromIdx) ? idx - 1 : idx;
      if (ni >= 0) out[ni] = v;
    }
    S.project.timing[k] = out;
  }
  const ovSrc = S.project.overrides || {}, ovOut = {};
  for (const [sk, v] of Object.entries(ovSrc)) {
    const idx = +sk;
    if (!Number.isInteger(idx)) continue;
    if (delta < 0 && idx === fromIdx) continue;
    const ni = (delta > 0 && idx > fromIdx) ? idx + 1 : (delta < 0 && idx > fromIdx) ? idx - 1 : idx;
    if (ni >= 0) ovOut[ni] = v;
  }
  S.project.overrides = ovOut;
}
function addLyricLineAfter(afterIdx, customText) {
  const L = (S.plan && S.plan.lines) || [];
  pushEdit();
  ensureTimingMaps();
  const c = leCopy();
  const text = String(customText || '').trim() || c.defLine;
  const hasPrev = afterIdx >= 0 && afterIdx < L.length;
  const prevLn = hasPrev ? L[afterIdx] : null;
  const nextLn = (afterIdx + 1 < L.length) ? L[afterIdx + 1] : null;
  // Pin existing line times so inserting a line never moves previously validated lines
  L.forEach((ln, idx) => {
    if (S.project.timing.lineTimes[idx] == null) S.project.timing.lineTimes[idx] = +ln.start.toFixed(3);
  });
  const rows = String(S.project.lyrics || '').replace(/\r/g, '').split('\n').filter((r, idx, arr) => !(arr.length === 1 && r === ''));
  const insertRowPos = prevLn && prevLn.src != null ? prevLn.src + 1 : rows.length;
  rows.splice(insertRowPos, 0, text);
  const newIdx = prevLn ? afterIdx + 1 : L.length;
  shiftSparseLineMaps(prevLn ? afterIdx : L.length - 1, +1);

  const sNew = prevLn
    ? +((nextLn ? Math.min(prevLn.end + 0.15, (prevLn.start + nextLn.start) * 0.55) : prevLn.end + 0.25)).toFixed(3)
    : 0.4;
  const eNew = nextLn
    ? +Math.max(sNew + 0.5, nextLn.start - 0.1).toFixed(3)
    : +(sNew + 2.5).toFixed(3);
  S.project.timing.lineTimes[newIdx] = sNew;
  S.project.timing.lineEnds[newIdx] = eNew;
  if (J.alignWordsAcoustic) {
    S.project.timing.wordTimes[newIdx] = J.alignWordsAcoustic(S.audio, text, sNew, eNew, J.resolveLang(S.project), 'Lead', 0.95);
  }
  S.project.lyrics = rows.join('\n');
  if ($('lyrics')) $('lyrics').value = S.project.lyrics;
  EDL.lineIdx = newIdx;
  EDL.wordIdx = 0;
  replan();
  flushSave();
}
function deleteLyricLine(li) {
  const L = (S.plan && S.plan.lines) || [];
  if (li < 0 || li >= L.length) return;
  const ln = L[li];
  pushEdit();
  ensureTimingMaps();
  L.forEach((other, idx) => {
    if (idx !== li && S.project.timing.lineTimes[idx] == null) S.project.timing.lineTimes[idx] = +other.start.toFixed(3);
  });
  const rows = String(S.project.lyrics || '').replace(/\r/g, '').split('\n');
  if (ln.src != null && ln.src >= 0 && ln.src < rows.length) rows.splice(ln.src, 1);
  else rows.splice(li, 1);
  shiftSparseLineMaps(li, -1);
  S.project.lyrics = rows.join('\n');
  if ($('lyrics')) $('lyrics').value = S.project.lyrics;
  EDL.lineIdx = Math.max(0, Math.min(li, L.length - 2));
  EDL.wordIdx = 0;
  refreshStage6Validation();
  replan();
  flushSave();
}
function updateWordChar(li, wi, ci, patch) {
  const words = getEditableWords(li);
  const w = words[wi]; if (!w) return;
  const chs = buildWordChars(w).map(c => Object.assign({}, c));
  if (ci < 0 || ci >= chs.length) return;
  pushEdit();
  ensureTimingMaps();
  const c = chs[ci];
  if (patch.ch !== undefined) c.ch = String(patch.ch);
  if (patch.start !== undefined && isFinite(+patch.start)) {
    const lo = ci > 0 ? chs[ci - 1].start + 0.005 : Math.max(0, w.start - 0.5);
    const hi = c.end - 0.005;
    c.start = +J.clamp(+patch.start, lo, Math.max(lo, hi)).toFixed(3);
    if (ci > 0 && chs[ci - 1].end > c.start) chs[ci - 1].end = c.start;
    if (ci === 0) w.start = c.start;
  }
  if (patch.end !== undefined && isFinite(+patch.end)) {
    const lo = c.start + 0.005;
    const hi = ci < chs.length - 1 ? chs[ci + 1].end - 0.005 : w.end + 0.5;
    c.end = +J.clamp(+patch.end, lo, Math.max(lo, hi)).toFixed(3);
    if (ci < chs.length - 1 && chs[ci + 1].start < c.end) chs[ci + 1].start = c.end;
    if (ci === chs.length - 1) w.end = c.end;
  }
  w.chars = chs;
  w.text = chs.map(x => x.ch).join('').trim() || w.text;
  w.start = chs[0].start;
  w.end = chs[chs.length - 1].end;
  w.validated = true;
  w.flags = (w.flags || []).filter(f => f !== 'uncertain_word' && f !== 'misrecognized_word' && f !== 'uncertain_boundary');
  S.project.timing.wordTimes[li] = words;
  if (patch.ch !== undefined) syncLineTextFromWords(li, words);
  refreshStage6Validation();
  replan();
  flushSave();
}
function addWordChar(li, wi) {
  const words = getEditableWords(li);
  const w = words[wi]; if (!w) return;
  pushEdit();
  ensureTimingMaps();
  const chs = buildWordChars(w).map(c => Object.assign({}, c));
  const last = chs[chs.length - 1];
  const cs = last ? Math.max(w.start, +(last.end - 0.03).toFixed(3)) : w.start;
  if (last && last.end - last.start > 0.04) last.end = cs;
  const ce = +(Math.max(cs + 0.04, w.end)).toFixed(3);
  chs.push({ ch: 'a', start: cs, end: ce });
  w.chars = chs;
  w.text = chs.map(x => x.ch).join('');
  w.end = ce;
  w.validated = true;
  S.project.timing.wordTimes[li] = words;
  syncLineTextFromWords(li, words);
  replan();
  flushSave();
}
function deleteWordChar(li, wi, ci) {
  const words = getEditableWords(li);
  const w = words[wi]; if (!w) return;
  const chs = buildWordChars(w).map(c => Object.assign({}, c));
  if (chs.length <= 1) { deleteWordInLine(li, wi); return; }
  pushEdit();
  ensureTimingMaps();
  chs.splice(ci, 1);
  w.chars = chs;
  w.text = chs.map(x => x.ch).join('');
  w.start = chs[0].start;
  w.end = chs[chs.length - 1].end;
  w.validated = true;
  S.project.timing.wordTimes[li] = words;
  syncLineTextFromWords(li, words);
  refreshStage6Validation();
  replan();
  flushSave();
}
function recalculateLineAlignment(li) {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[li]; if (!ln || ln.interlude) return;
  pushEdit();
  ensureTimingMaps();
  const prevW = S.project.timing.wordTimes[li] || ln.wordsTimed || [];
  const spk = (ln.meta && ln.meta.speaker) || 'Lead';
  const lang = J.resolveLang(S.project);
  const nextWords = J.realignLineWords
    ? J.realignLineWords(S.audio, ln.text, ln.start, ln.visEnd || ln.end, lang, spk, prevW)
    : J.alignWordsAcoustic(S.audio, ln.text, ln.start, ln.visEnd || ln.end, lang, spk, 0.94);
  S.project.timing.wordTimes[li] = nextWords;
  refreshStage6Validation();
  replan();
  flushSave();
  toast(leCopy().recalcMsg);
}
function saveCorrectedLyrics() {
  const L = (S.plan && S.plan.lines) || [];
  const ln = L[EDL.lineIdx];
  pushEdit();
  ensureTimingMaps();
  if (ln && !ln.interlude) {
    const words = getEditableWords(ln.index).map(w => Object.assign({}, w, {
      validated: true,
      recognitionConfidence: Math.max(0.98, w.recognitionConfidence || 0.98),
      alignmentConfidence: Math.max(0.95, w.alignmentConfidence || 0.95),
      flags: (w.flags || []).filter(f => f !== 'uncertain_word' && f !== 'misrecognized_word' && f !== 'uncertain_boundary'),
    }));
    S.project.timing.wordTimes[ln.index] = words;
    S.project.timing.lineTimes[ln.index] = +ln.start.toFixed(3);
    S.project.timing.lineEnds[ln.index] = +(ln.visEnd || ln.end).toFixed(3);
    const curM = Object.assign({}, S.project.timing.lineMeta[ln.index] || {});
    curM.flags = (curM.flags || []).filter(f => f !== 'uncertain_word' && f !== 'misrecognized_word' && f !== 'uncertain_boundary');
    curM.unclear = false;
    S.project.timing.lineMeta[ln.index] = curM;
  }
  refreshStage6Validation();
  replan();
  flushSave();
  recordWork('lyrics_edit', 'sync', ln && !ln.interlude ? `Ligne #${(ln.index || 0) + 1} validée` : 'Corrections sauvegardées');
  toast(leCopy().savedMsg);
}
function syncLyricsEditor() {
  const panel = $('lyricsEditorPanel');
  if (!panel || !S.plan) { syncTimelineInspector(); return; }
  const L = S.plan.lines || [];
  const lineSel = $('leLineSel'), strip = $('leWordStrip'), charList = $('leCharList');
  if (!L.length) {
    if ($('leStats')) $('leStats').textContent = '0 lignes';
    if (lineSel) lineSel.innerHTML = '';
    if (strip) strip.innerHTML = '';
    if (charList) charList.innerHTML = '';
    syncTimelineInspector();
    return;
  }
  EDL.lineIdx = J.clamp(EDL.lineIdx | 0, 0, L.length - 1);
  const ln = L[EDL.lineIdx];
  if (lineSel) {
    lineSel.innerHTML = L.map((item, idx) => {
      const txt = item.interlude ? `[Interlude ${item.secs || 4}s]` : item.text;
      return `<option value="${idx}">${String(idx + 1).padStart(2, '0')} · ${J.fmtTime(item.start)} · ${escapeHtml(txt.slice(0, 26))}</option>`;
    }).join('');
    lineSel.value = String(EDL.lineIdx);
  }
  if ($('leLineStart')) $('leLineStart').value = ln.start.toFixed(3);
  if ($('leLineEnd')) $('leLineEnd').value = (ln.visEnd || ln.end).toFixed(3);
  const langBadge = $('leLineLangBadge');
  if (langBadge) {
    const lCode = !ln.interlude ? (ln.language || (ln.meta && ln.meta.language) || (J.detectLineLang ? J.detectLineLang(ln.text) : '') || '') : '';
    langBadge.textContent = lCode ? (J.LANG_LABEL[lCode] || lCode) : '—';
    langBadge.title = lCode ? `Langue de la ligne : ${J.LANG_LABEL[lCode] || lCode}` : 'Interlude / non linguistique';
  }
  const transInp = $('leLineTransEdit');
  if (transInp) {
    transInp.disabled = !!ln.interlude;
    if (document.activeElement !== transInp) {
      const trMap = (S.project.translation && S.project.translation.lines) || {};
      transInp.value = ln.interlude ? '' : (trMap[ln.index] || '');
    }
  }

  const words = ln.interlude ? [] : getEditableWords(EDL.lineIdx);
  EDL.wordIdx = words.length ? J.clamp(EDL.wordIdx | 0, 0, words.length - 1) : 0;

  let valTotal = 0, wordTotal = 0;
  L.forEach((item, idx) => {
    if (item.interlude) return;
    const ws = (S.project.timing && S.project.timing.wordTimes && S.project.timing.wordTimes[idx]) || item.wordsTimed || [];
    ws.forEach(w => { wordTotal++; if (w.validated) valTotal++; });
  });
  if ($('leStats')) {
    $('leStats').textContent = `L${EDL.lineIdx + 1}/${L.length} · ${words.length} mots · ${valTotal}/${wordTotal} validés`;
  }

  if (strip) {
    strip.innerHTML = '';
    if (ln.interlude) {
      strip.innerHTML = '<span class="muted" style="font-size:11.5px">Section instrumentale / interlude</span>';
    } else {
      words.forEach((w, wi) => {
        const flags = Array.isArray(w.flags) ? w.flags : [];
        const isWarn = flags.includes('uncertain_word') || flags.includes('misrecognized_word') || flags.includes('uncertain_boundary');
        const isOv = flags.includes('overlapping_vocals');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'le-word' + (wi === EDL.wordIdx ? ' is-sel' : '') + (w.validated ? ' is-val' : '') + (isWarn ? ' is-warn' : '') + (isOv ? ' is-overlap' : '');
        btn.innerHTML = `<span>${escapeHtml(w.text)}</span><span class="le-wt">${w.start.toFixed(2)}</span>`;
        btn.title = `${J.fmtTime(w.start)} → ${J.fmtTime(w.end)}`;
        btn.addEventListener('click', () => selectLyricWord(EDL.lineIdx, wi, false));
        strip.appendChild(btn);
      });
    }
  }

  const selWord = words[EDL.wordIdx] || null;
  const insp = $('leWordInspector');
  if (insp) insp.style.opacity = selWord ? '1' : '0.45';
  if ($('leWordText')) $('leWordText').value = selWord ? selWord.text : '';
  if ($('leWordStart')) $('leWordStart').value = selWord ? selWord.start.toFixed(3) : '';
  if ($('leWordEnd')) $('leWordEnd').value = selWord ? selWord.end.toFixed(3) : '';
  if ($('leWordValid')) $('leWordValid').checked = Boolean(selWord && selWord.validated);
  if ($('leWordConf')) {
    if (selWord) {
      const qm = J.evaluateWordQuality ? J.evaluateWordQuality(selWord, S.audio, ln && ln.meta) : null;
      if (qm) {
        const cp = qcCopy();
        const tLbl = qm.qualityTier === 'HIGH' ? cp.high : qm.qualityTier === 'LOW' ? cp.low : cp.med;
        $('leWordConf').textContent = `${tLbl} · ${cp.trLbl} ${Math.round(qm.transcriptionConfidence * 100)}% · ${cp.alLbl} ${Math.round(qm.alignmentConfidence * 100)}% · ${cp.clLbl} ${Math.round(qm.audioClarity * 100)}% · ${cp.ovLbl} ${Math.round(qm.vocalOverlap * 100)}% · ${cp.unLbl} ${Math.round(qm.recognitionUncertainty * 100)}%`;
      } else {
        const rp = selWord.recognitionConfidence != null ? Math.round(selWord.recognitionConfidence * 100) + '%' : '-';
        const ap = selWord.alignmentConfidence != null ? Math.round(selWord.alignmentConfidence * 100) + '%' : '-';
        $('leWordConf').textContent = `rec ${rp} · align ${ap}`;
      }
    } else {
      $('leWordConf').textContent = '';
    }
  }

  if (charList) {
    charList.innerHTML = '';
    if (selWord) {
      const chs = buildWordChars(selWord);
      chs.forEach((c, ci) => {
        const row = document.createElement('div');
        row.className = 'le-char-row';
        const gInp = document.createElement('input');
        gInp.type = 'text'; gInp.className = 'le-ch-txt'; gInp.maxLength = 6; gInp.value = c.ch != null ? c.ch : (c.char || '');
        const sInp = document.createElement('input');
        sInp.type = 'number'; sInp.step = '0.005'; sInp.min = '0'; sInp.className = 'le-ch-start mono'; sInp.value = Number(c.start).toFixed(3);
        const sep = document.createElement('span'); sep.className = 'le-ch-sep'; sep.textContent = '→';
        const eInp = document.createElement('input');
        eInp.type = 'number'; eInp.step = '0.005'; eInp.min = '0'; eInp.className = 'le-ch-end mono'; eInp.value = Number(c.end).toFixed(3);
        const dBtn = document.createElement('button');
        dBtn.type = 'button'; dBtn.className = 'ghost small le-ch-del'; dBtn.textContent = '✕';
        gInp.addEventListener('change', () => updateWordChar(EDL.lineIdx, EDL.wordIdx, ci, { ch: gInp.value }));
        sInp.addEventListener('change', () => updateWordChar(EDL.lineIdx, EDL.wordIdx, ci, { start: parseFloat(sInp.value) }));
        eInp.addEventListener('change', () => updateWordChar(EDL.lineIdx, EDL.wordIdx, ci, { end: parseFloat(eInp.value) }));
        dBtn.addEventListener('click', () => deleteWordChar(EDL.lineIdx, EDL.wordIdx, ci));
        row.append(gInp, sInp, sep, eInp, dBtn);
        charList.appendChild(row);
      });
    }
  }
  syncTimelineInspector();
  syncQualityControlPanel();
}
function bindLyricsEditor() {
  applyLeLabels();
  const sel = $('leLineSel');
  if (sel) sel.addEventListener('change', () => selectLyricWord(+sel.value, 0, true));
  if ($('lePrevLine')) $('lePrevLine').addEventListener('click', () => selectLyricWord(EDL.lineIdx - 1, 0, true));
  if ($('leNextLine')) $('leNextLine').addEventListener('click', () => selectLyricWord(EDL.lineIdx + 1, 0, true));
  if ($('lePlayLine')) $('lePlayLine').addEventListener('click', () => {
    const ln = S.plan && S.plan.lines ? S.plan.lines[EDL.lineIdx] : null;
    if (ln) playRange(ln.start, ln.visEnd || ln.end);
  });
  if ($('leAddLine')) $('leAddLine').addEventListener('click', () => addLyricLineAfter(EDL.lineIdx));
  if ($('btnAddLyricLine')) $('btnAddLyricLine').addEventListener('click', () => addLyricLineAfter(EDL.lineIdx));
  if ($('leDelLine')) $('leDelLine').addEventListener('click', () => deleteLyricLine(EDL.lineIdx));
  if ($('leLineStart')) $('leLineStart').addEventListener('change', e => applyLineBoundary(EDL.lineIdx, 'start', e.target.value));
  if ($('leLineEnd')) $('leLineEnd').addEventListener('change', e => applyLineBoundary(EDL.lineIdx, 'end', e.target.value));

  document.querySelectorAll('#lyricsEditorPanel [data-nudge]').forEach(btn => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.nudge;
      const delta = parseFloat(btn.dataset.delta) || 0;
      const ln = S.plan && S.plan.lines ? S.plan.lines[EDL.lineIdx] : null;
      if (!ln) return;
      if (kind === 'lineStart') applyLineBoundary(EDL.lineIdx, 'start', ln.start + delta);
      else if (kind === 'lineEnd') applyLineBoundary(EDL.lineIdx, 'end', (ln.visEnd || ln.end) + delta);
      else {
        const words = getEditableWords(EDL.lineIdx);
        const w = words[EDL.wordIdx]; if (!w) return;
        if (kind === 'wordStart') applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, 'start', w.start + delta);
        else if (kind === 'wordEnd') applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, 'end', w.end + delta);
      }
    });
  });

  if ($('leAddWordBefore')) $('leAddWordBefore').addEventListener('click', () => insertWordInLine(EDL.lineIdx, EDL.wordIdx, 'before', $('leInsertWordText') ? $('leInsertWordText').value : ''));
  if ($('leAddWordAfter')) $('leAddWordAfter').addEventListener('click', () => insertWordInLine(EDL.lineIdx, EDL.wordIdx, 'after', $('leInsertWordText') ? $('leInsertWordText').value : ''));
  const doApplyWord = () => commitWordTextEdit(EDL.lineIdx, EDL.wordIdx, $('leWordText') ? $('leWordText').value : '');
  if ($('leApplyWord')) $('leApplyWord').addEventListener('click', doApplyWord);
  if ($('leWordText')) $('leWordText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); doApplyWord(); } });
  if ($('lePlayWord')) $('lePlayWord').addEventListener('click', () => {
    const words = getEditableWords(EDL.lineIdx);
    const w = words[EDL.wordIdx];
    if (w) playRange(w.start, w.end);
  });
  if ($('leDelWord')) $('leDelWord').addEventListener('click', () => deleteWordInLine(EDL.lineIdx, EDL.wordIdx));
  if ($('leWordStart')) $('leWordStart').addEventListener('change', e => applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, 'start', e.target.value));
  if ($('leWordEnd')) $('leWordEnd').addEventListener('change', e => applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, 'end', e.target.value));
  if ($('leWordValid')) $('leWordValid').addEventListener('change', e => {
    const words = getEditableWords(EDL.lineIdx);
    const w = words[EDL.wordIdx]; if (!w) return;
    pushEdit();
    w.validated = !!e.target.checked;
    if (w.validated) w.flags = (w.flags || []).filter(f => f !== 'uncertain_word' && f !== 'misrecognized_word' && f !== 'uncertain_boundary');
    S.project.timing.wordTimes[EDL.lineIdx] = words;
    refreshStage6Validation();
    replan();
    flushSave();
  });
  if ($('leAddChar')) $('leAddChar').addEventListener('click', () => addWordChar(EDL.lineIdx, EDL.wordIdx));
  if ($('btnLeRecalcLine')) $('btnLeRecalcLine').addEventListener('click', () => recalculateLineAlignment(EDL.lineIdx));
  if ($('btnLeSave')) $('btnLeSave').addEventListener('click', saveCorrectedLyrics);
  if ($('leLineTransEdit')) {
    const commitLineTrans = (val, flushNow) => {
      const L = (S.plan && S.plan.lines) || [];
      const ln = L[EDL.lineIdx];
      if (!ln || ln.interlude) return;
      const tr = ensureTranslationState();
      const txt = String(val || '').trim();
      if (txt) {
        tr.lines[ln.index] = txt;
        if (!tr.enabled) tr.enabled = true;
      } else {
        delete tr.lines[ln.index];
      }
      syncTranslationControls();
      replanSoon(90);
      if (flushNow) flushSave();
      else autosave();
    };
    $('leLineTransEdit').addEventListener('input', e => commitLineTrans(e.target.value, false));
    $('leLineTransEdit').addEventListener('change', e => commitLineTrans(e.target.value, true));
  }
}

/* ---------------- 歌詞・タイミングの取り消し（Ctrl+Z） ---------------- */
// separate from the ◀ ▶ history of looks: lyric edits, dragged / typed / tapped line times
const ED = { undo: [], redo: [] };
const edSnap = () => JSON.stringify({ lyrics: S.project.lyrics, lineTimes: S.project.timing.lineTimes || {}, lineEnds: S.project.timing.lineEnds || {}, wordTimes: S.project.timing.wordTimes || {}, lineMeta: S.project.timing.lineMeta || {}, detection: S.project.detection || null, translation: S.project.translation || null });
function pushEdit() { const s = edSnap(); if (ED.undo[ED.undo.length - 1] !== s) ED.undo.push(s); if (ED.undo.length > 60) ED.undo.shift(); ED.redo = []; updateEditBtns(); }
function edGo(d) {
  const from = d < 0 ? ED.undo : ED.redo, to = d < 0 ? ED.redo : ED.undo;
  if (!from.length) return;
  const o = JSON.parse(from.pop()), cur = JSON.parse(edSnap());
  if ('ov' in o) { cur.ov = S.project.overrides; cur.range = S.project.exportRange || null; }   // clearLyrics() also cleared these
  to.push(JSON.stringify(cur));
  S.project.lyrics = o.lyrics; S.project.timing.lineTimes = o.lineTimes; S.project.timing.lineEnds = o.lineEnds || {}; S.project.timing.wordTimes = o.wordTimes || {}; S.project.timing.lineMeta = o.lineMeta || {}; S.project.detection = o.detection || null; $('lyrics').value = o.lyrics;
  if ('translation' in o && o.translation) S.project.translation = o.translation;
  if ('ov' in o) { S.project.overrides = o.ov || {}; S.project.exportRange = o.range || null; }
  clearQcAutoReport();
  replan(); syncTranslationControls(); syncAudioDetectPanel(); flushSave(); updateEditBtns();
  toast(d < 0 ? '元に戻しました' : 'やり直しました');
}
// LRC を読み込む: replaces the lyrics (and everything tied to line numbers, like 歌詞を消す); undoable
function loadLrc(text, sub) {
  if (S.tap || S.exporting) return;
  const P = S.project;
  const snap = JSON.parse(edSnap()); snap.ov = P.overrides || {}; snap.range = P.exportRange || null;
  ED.undo.push(JSON.stringify(snap)); if (ED.undo.length > 60) ED.undo.shift(); ED.redo = [];
  pause();
  P.lyrics = String(text).replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').trim(); P.timing.lineTimes = {}; P.timing.lineEnds = {}; P.timing.wordTimes = {}; P.timing.lineMeta = {}; P.overrides = {}; P.exportRange = null;
  $('lyrics').value = P.lyrics;
  clearQcAutoReport();
  replan(); flushSave(); updateEditBtns(); seek(0);
  const n = J.parseLyrics(P.lyrics).lines.filter(l => l.lrc != null).length;
  if (sub) toast(`字幕ファイルを読み込みました（${sub.lines} 行・間奏 ${sub.gaps} か所・「元に戻す」で戻せます）`);
  else toast(`LRC を読み込みました（時刻付き ${n} 行・「元に戻す」で戻せます）`);
}
function applyExportLabels() {
  const lang = document.documentElement.lang || 'fr';
  const titleEl = $('lblLyricsExpTitle'), transEl = $('lblExpIncludeTrans');
  if (lang === 'en') {
    if (titleEl) titleEl.textContent = 'Export synchronized lyrics';
    if (transEl) transEl.textContent = 'Include translation';
    if ($('btnExpJSON')) $('btnExpJSON').textContent = 'JSON (Words & Chars)';
    if ($('btnExpELRC')) $('btnExpELRC').textContent = 'Enhanced LRC';
  } else if (lang === 'fr') {
    if (titleEl) titleEl.textContent = 'Exporter les paroles synchronisées';
    if (transEl) transEl.textContent = 'Inclure traduction';
    if ($('btnExpJSON')) $('btnExpJSON').textContent = 'JSON (mots & car.)';
    if ($('btnExpELRC')) $('btnExpELRC').textContent = 'Enhanced LRC';
  } else {
    if (titleEl) titleEl.textContent = '同期歌詞エクスポート';
    if (transEl) transEl.textContent = '翻訳を含める';
    if ($('btnExpJSON')) $('btnExpJSON').textContent = 'JSON (語・文字)';
    if ($('btnExpELRC')) $('btnExpELRC').textContent = 'Enhanced LRC';
  }
  const chk = $('expIncludeTrans');
  const qChk = $('quickExpTransChk');
  const defChecked = !!(S.project && S.project.translation && S.project.translation.enabled);
  if (chk && chk.dataset.userTouched !== '1') chk.checked = defChecked;
  if (qChk && qChk.dataset.userTouched !== '1') qChk.checked = chk ? chk.checked : defChecked;
}
function syncMainStudioLabels() {
  const lang = document.documentElement.lang || 'fr';
  const copy = lang === 'fr' ? {
    audioSec: 'Audio & Minutage',
    dropTitle: 'Importer ou glisser-déposer une chanson',
    uploadBtn: 'Importer Audio',
    noAudio: 'Aucun audio — glissez un fichier (MP3, WAV, FLAC…) ou cliquez pour importer',
    quickExpTitle: 'Exporter les paroles',
    quickExpTrans: 'Trad.',
  } : lang === 'en' ? {
    audioSec: 'Song & Timing',
    dropTitle: 'Upload or drag & drop a song',
    uploadBtn: 'Upload Song',
    noAudio: 'No song loaded — drag & drop MP3, WAV, FLAC or click to browse',
    quickExpTitle: 'Export Lyrics',
    quickExpTrans: 'Trans.',
  } : (lang === 'zh-Hans' || lang === 'zh-Hant') ? {
    audioSec: lang === 'zh-Hans' ? '歌曲与节拍定时' : '歌曲與節拍定時',
    dropTitle: lang === 'zh-Hans' ? '点击上传或拖拽音频文件至此' : '點擊上傳或拖曳音訊檔案至此',
    uploadBtn: lang === 'zh-Hans' ? '上传歌曲' : '上傳歌曲',
    noAudio: lang === 'zh-Hans' ? '未加载音频（支持拖拽 MP3 / WAV / FLAC / M4A）' : '未載入音訊（支援拖曳 MP3 / WAV / FLAC / M4A）',
    quickExpTitle: lang === 'zh-Hans' ? '导出同步歌词' : '匯出同步歌詞',
    quickExpTrans: lang === 'zh-Hans' ? '含翻译' : '含翻譯',
  } : lang === 'ko' ? {
    audioSec: '오디오 & 타이밍',
    dropTitle: '곡 업로드 또는 드래그 앤 드롭',
    uploadBtn: '곡 업로드',
    noAudio: '오디오 없음 (MP3 / WAV / FLAC / M4A 드래그 또는 클릭)',
    quickExpTitle: '가사 내보내기',
    quickExpTrans: '번역',
  } : lang.startsWith('id') ? {
    audioSec: 'Audio & Timing',
    dropTitle: 'Unggah atau seret & lepas lagu',
    uploadBtn: 'Unggah Lagu',
    noAudio: 'Tidak ada audio — seret MP3, WAV, FLAC atau klik untuk memilih',
    quickExpTitle: 'Ekspor Lirik',
    quickExpTrans: 'Terj.',
  } : lang.startsWith('vi') ? {
    audioSec: 'Âm thanh & Thời gian',
    dropTitle: 'Tải lên hoặc kéo thả bài hát',
    uploadBtn: 'Tải bài hát',
    noAudio: 'Chưa có âm thanh — kéo MP3, WAV, FLAC hoặc nhấn để chọn',
    quickExpTitle: 'Xuất lời bài hát',
    quickExpTrans: 'Dịch',
  } : {
    audioSec: '曲とタイミング',
    dropTitle: '曲をアップロード／ドラッグ＆ドロップ',
    uploadBtn: '曲を読み込む',
    noAudio: '曲なし（MP3 / WAV / FLAC 等をドロップまたはクリック）',
    quickExpTitle: '同期歌詞を書き出す',
    quickExpTrans: '翻訳',
  };
  setT('lblAudioSecTitle', copy.audioSec);
  setT('lblDropAudioTitle', copy.dropTitle);
  setT('lblUploadAudioBtn', copy.uploadBtn);
  setT('lblQuickExportTitle', copy.quickExpTitle);
  setT('lblQuickExportTrans', copy.quickExpTrans);
  audioNameDefault = copy.noAudio;
  if (!S.audio && $('audioName')) $('audioName').textContent = copy.noAudio;
}
function saveSyncedLyrics(format = 'lrc') {
  const fmt = String(format || 'lrc').toLowerCase();
  const R = exportRangeLines(), r = exportRange();
  const rangeObj = R && r ? { from: R.from, to: R.to, t0: r.t0, t1: r.t1 } : null;
  const chk = $('expIncludeTrans');
  const includeTranslation = chk ? !!chk.checked : !!(S.project && S.project.translation && S.project.translation.enabled);
  const opts = { includeTranslation, audio: S.audio };
  const base = baseName() + rangeSuffix();
  let txt = '', ext = '.lrc', mime = 'text/plain;charset=utf-8', act = 'export_lrc';

  if (fmt === 'srt') {
    txt = J.srtText(S.project, S.plan, rangeObj, opts);
    ext = '.srt';
    act = 'export_srt';
  } else if (fmt === 'vtt') {
    txt = J.vttText(S.project, S.plan, rangeObj, opts);
    ext = '.vtt';
    mime = 'text/vtt;charset=utf-8';
    act = 'export_vtt';
  } else if (fmt === 'elrc' || fmt === 'enhanced-lrc') {
    txt = J.enhancedLrcText(S.project, S.plan, rangeObj, opts);
    ext = '.elrc.lrc';
    act = 'export_elrc';
  } else if (fmt === 'json') {
    txt = J.lyricsJsonText(S.project, S.plan, rangeObj, opts);
    ext = '.lyrics.json';
    mime = 'application/json;charset=utf-8';
    act = 'export_lyrics_json';
  } else if (fmt === 'txt') {
    txt = J.txtLyricsText(S.project, S.plan, rangeObj, opts);
    ext = '.txt';
    act = 'export_txt';
  } else {
    txt = J.lrcText(S.project, S.plan.lines, rangeObj, opts);
    ext = '.lrc';
    act = 'export_lrc';
  }

  const fname = base + ext;
  J.saveFile(fname, new Blob([txt], { type: mime }));
  recordWork(act, 'export', fname);
  const lang = document.documentElement.lang;
  toast((lang === 'en' ? 'Exported: ' : lang === 'fr' ? 'Exporté : ' : '書き出しました: ') + fname);
  return { filename: fname, content: txt };
}
function saveLrc() {
  return saveSyncedLyrics('lrc');
}
// 歌詞を消す: lyrics + everything tied to line numbers (times, per-line settings, export range); undoable
function clearLyrics() {
  if (S.tap || S.exporting) return;
  const P = S.project;
  if (!P.lyrics.trim() && !Object.keys(P.timing.lineTimes || {}).length) { $('lyrics').focus(); return; }
  const snap = JSON.parse(edSnap()); snap.ov = P.overrides || {}; snap.range = P.exportRange || null;
  ED.undo.push(JSON.stringify(snap)); if (ED.undo.length > 60) ED.undo.shift(); ED.redo = [];
  pause();
  P.lyrics = ''; P.timing.lineTimes = {}; P.timing.lineEnds = {}; P.timing.wordTimes = {}; P.timing.lineMeta = {}; P.overrides = {}; P.exportRange = null; $('lyrics').value = '';
  clearQcAutoReport();
  replan(); flushSave(); updateEditBtns(); seek(0);
  toast('歌詞を消しました（「元に戻す」か Ctrl+Z で戻せます）');
}
// 初期化: back to a blank project — song (also the copy kept in this browser), settings and both histories go
let audioNameDefault = '';
async function resetAll() {
  if (S.exporting) return;
  if (S.tap) stopTap();
  pause();
  audioSeq++;                                  // a song still being analysed must not come back after the reset
  S.project = mergeProject(null); S.project.lyrics = '';
  delete S.project.cloudSongId;
  S.cloudSongId = null;
  if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = '';
  S.audio = null; S.audioFile = null; if ($('audioFile')) $('audioFile').value = '';
  if (J.forgetSong) await J.forgetSong();
  $('audioName').textContent = audioNameDefault;
  ED.undo = []; ED.redo = []; H.list = []; H.i = -1;
  TL.z = 1; TL.off = 0;
  $('lyrics').value = ''; fontKey = '';
  clearQcAutoReport();
  syncUI(); replan(); commit(); updateEditBtns(); flushSave(); seek(0);
  toast('初期化しました');
}
function updateEditBtns() { const u = $('btnUndoEdit'); if (u) u.disabled = !ED.undo.length; }

/* ---------------- 書き出す範囲（選んだ行だけ） ---------------- */
function exportRangeLines() {
  const r = S.project.exportRange, n = S.plan ? S.plan.lines.length : 0;
  if (!r || !n || !(r.from >= 0)) return null;
  const from = Math.min(n - 1, r.from | 0), to = Math.min(n - 1, Math.max(from, r.to | 0));
  return { from, to };
}
function exportRange() {
  const R = exportRangeLines(); if (!R) return null;
  const L = S.plan.lines, a = L[R.from], b = L[R.to], last = R.to === L.length - 1;
  const t0 = Math.max(0, a.start - 0.25);
  const t1 = last ? S.plan.duration : Math.min(L[R.to + 1].start, (b.interlude ? b.end : b.visEnd) + 0.35);
  return { t0, t1 };
}
function rangeSuffix() { const R = exportRangeLines(); if (!R) return ''; const f = n => String(n + 1).padStart(2, '0'); return '_L' + f(R.from) + (R.to > R.from ? '-' + f(R.to) : ''); }
function setExportRange(i, extend) {
  const R = exportRangeLines();
  if (extend && R) S.project.exportRange = { from: Math.min(R.from, i), to: Math.max(R.to, i) };
  else if (R && R.from === i && R.to === i) S.project.exportRange = null;          // click again: back to the whole song
  else S.project.exportRange = { from: i, to: i };
  flushSave(); renderLines();
  const R2 = exportRangeLines();
  toast(R2 ? `書き出す範囲：${R2.from + 1}${R2.to > R2.from ? '〜' + (R2.to + 1) : ''}行目` : '書き出す範囲：全体');
}
function syncRangeUI() {
  const R = exportRangeLines(), n = S.plan.lines.length;
  const opts = (sel, first) => `<option value="-1">${first}</option>` + S.plan.lines.map((ln, i) => `<option value="${i}">${String(i + 1).padStart(2, '0')} ${escapeHtml((ln.interlude ? '〔間奏〕' : ln.text).slice(0, 14))}</option>`).join('');
  document.querySelectorAll('.rngFrom').forEach(el => { el.innerHTML = opts(el, '全体'); el.value = R ? String(R.from) : '-1'; });
  document.querySelectorAll('.rngTo').forEach(el => { el.innerHTML = opts(el, '—'); el.value = R ? String(R.to) : '-1'; el.disabled = !R; });
  const r = exportRange();
  document.querySelectorAll('.rngInfo').forEach(el => { el.textContent = r ? `${J.fmtTime(r.t0)} 〜 ${J.fmtTime(r.t1)}（${(r.t1 - r.t0).toFixed(1)}秒）` : `全体（${S.plan.duration.toFixed(1)}秒）`; });
}
function bindRangeUI() {
  document.querySelectorAll('.rngFrom').forEach(el => el.addEventListener('change', () => {
    const v = +el.value, R = exportRangeLines();
    S.project.exportRange = v < 0 ? null : { from: v, to: R ? Math.max(v, R.to) : v };
    flushSave(); renderLines();
  }));
  document.querySelectorAll('.rngTo').forEach(el => el.addEventListener('change', () => {
    const v = +el.value, R = exportRangeLines(); if (!R) return;
    S.project.exportRange = v < 0 ? { from: R.from, to: R.from } : { from: Math.min(R.from, v), to: Math.max(R.from, v) };
    flushSave(); renderLines();
  }));
}
/* この行を再抽選 / ロック: each is one step of 前の案 / 次の案, so a reroll can be taken back */
function rerollLine(i) {
  const ln = S.plan.lines[i]; if (!ln || ln.interlude || S.exporting || S.tap) return;
  const cur = (S.project.overrides || {})[i] || {};
  remember();
  setOv(i, { seed: (cur.seed | 0) + 1, lock: false, lockedSeed: undefined, lockedCuts: undefined });
  replan(); commit(); seek(S.plan.lines[i].start + 0.001);
}
function toggleLineLock(i) {
  const ln = S.plan.lines[i]; if (!ln || ln.interlude || S.exporting || S.tap) return;
  const cur = (S.project.overrides || {})[i] || {};
  remember();
  if (cur.lock) setOv(i, { lock: false, lockedSeed: undefined, lockedCuts: undefined });
  else setOv(i, { lock: true, lockedSeed: ln.seed, lockedCuts: J.lineSnapshot(S.plan, i) || undefined });
  replan(); commit();
}
// the lyric line under the playhead (-1: title card or none)
function lineAtPlayhead() { const c = J.cutAt(S.plan, S.t); return c && c.line >= 0 ? c.line : -1; }
function setOv(i, patch) {
  const cur = Object.assign({}, S.project.overrides[i] || {}, patch);
  for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === false || cur[k] === '') delete cur[k];
  if (Object.keys(cur).length) S.project.overrides[i] = cur; else delete S.project.overrides[i];
}
function setCutLayout(i, k, layout) { setCutTech(i, k, 'layout', layout); }
function setCutTech(i, k, group, key) {
  if (i == null || i < 0 || k == null || k < 0) return;
  const cur = Object.assign({}, S.project.overrides[i] || {});
  const cutTech = Object.assign({}, cur.cutTech || {});
  const slot = Object.assign({}, cutTech[k] || cutTech[String(k)] || {});
  delete cutTech[String(k)];
  if (!key) delete slot[group];
  else slot[group] = key;
  if (Object.keys(slot).length) cutTech[k] = slot;
  else delete cutTech[k];
  if (Object.keys(cutTech).length) cur.cutTech = cutTech; else delete cur.cutTech;
  const cutQuiet = Object.assign({}, cur.cutQuiet || {});
  const q = Object.assign({}, cutQuiet[k] || cutQuiet[String(k)] || {});
  delete cutQuiet[String(k)];
  delete q[group];
  if (Object.keys(q).length) cutQuiet[k] = q; else delete cutQuiet[k];
  if (Object.keys(cutQuiet).length) cur.cutQuiet = cutQuiet; else delete cur.cutQuiet;
  if (group === 'layout') {
    const cutLayouts = Object.assign({}, cur.cutLayouts || {});
    if (!key) delete cutLayouts[k]; else cutLayouts[k] = key;
    if (Object.keys(cutLayouts).length) cur.cutLayouts = cutLayouts; else delete cur.cutLayouts;
  }
  if (Object.keys(cur).length) S.project.overrides[i] = cur; else delete S.project.overrides[i];
}
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- style tab ---------------- */
let styleCatFilter = 'all';
const STYLE_CAT_META = [
  ['all', { fr: 'Tous', en: 'All', ja: 'すべて', 'zh-Hans': '全部', 'zh-Hant': '全部', ko: '전체', id: 'Semua', vi: 'Tất cả' }],
  ['guofeng', { fr: 'Chinois Classique', en: 'Classical Chinese', ja: '中国風・国風', 'zh-Hans': '国风古典', 'zh-Hant': '國風古典', ko: '중국 고풍', id: 'Tiongkok Klasik', vi: 'Cổ Phong' }],
  ['bauhaus', { fr: 'Bauhaus', en: 'Bauhaus', ja: 'Bauhaus' }],
  ['popart', { fr: 'Pop Art', en: 'Pop Art', ja: 'Pop Art' }],
  ['iso3d', { fr: '3D Iso', en: '3D Iso', ja: '3D Iso' }],
  ['compositing', { fr: 'Compositing', en: 'Compositing', ja: 'Compositing' }],
  ['cinematic', { fr: 'Cinéma', en: 'Cinematic', ja: 'Cinematic' }],
  ['musicvideo', { fr: 'Music Video', en: 'Music Video', ja: 'Music Video' }],
  ['trapsoul', { fr: 'Trap Soul', en: 'Trap Soul', ja: 'Trap Soul' }],
  ['rnb', { fr: 'R&B', en: 'R&B', ja: 'R&B' }],
  ['hiphop', { fr: 'Hip-Hop', en: 'Hip-Hop', ja: 'Hip-Hop' }],
  ['pop', { fr: 'Pop', en: 'Pop', ja: 'Pop' }],
  ['artmotion', { fr: 'Art & Motion', en: 'Art & Motion', ja: 'Art & Motion' }],
  ['futuristic', { fr: 'Futuristic', en: 'Futuristic', ja: 'Futuristic' }],
  ['lifestyle', { fr: 'Lifestyle', en: 'Lifestyle', ja: 'Lifestyle' }],
  ['animation', { fr: 'Animation', en: 'Animation', ja: 'Animation' }],
];
function styleMatchesCat(k, cat) {
  if (!cat || cat === 'all') return true;
  if (J.THEMES[cat] && Array.isArray(J.THEMES[cat].styles) && J.THEMES[cat].styles.includes(k)) return true;
  return !!(J.STYLES[k] && J.STYLES[k].cat === cat);
}
function drawStyleThumbAccent(x, st, sc) {
  const cat = st.cat || '';
  x.save();
  if (cat === 'bauhaus') {
    x.fillStyle = sc.accent;
    x.beginPath(); x.arc(28, 28, 13, 0, Math.PI * 2); x.fill();
    x.fillStyle = sc.accent2 || sc.fg;
    x.fillRect(18, 50, 14, 14);
    x.strokeStyle = sc.accent2 || sc.fg; x.lineWidth = 1.6;
    for (let d = -12; d <= 16; d += 4) { x.beginPath(); x.moveTo(156 + d, 22); x.lineTo(148 + d, 38); x.stroke(); }
    x.fillStyle = sc.accent;
    x.beginPath(); x.moveTo(146, 86); x.lineTo(174, 86); x.lineTo(160, 62); x.closePath(); x.fill();
  } else if (cat === 'popart') {
    x.fillStyle = sc.accent; x.globalAlpha = 0.28;
    for (let px = 14; px < 72; px += 9) for (let py = 14; py < 46; py += 9) { x.beginPath(); x.arc(px, py, 2.2, 0, Math.PI * 2); x.fill(); }
    x.globalAlpha = 1; x.strokeStyle = sc.fg; x.lineWidth = 2;
    x.beginPath(); x.moveTo(142, 0); x.lineTo(126, 108); x.stroke();
    x.fillStyle = sc.accent;
    x.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2, r = i % 2 ? 7 : 15;
      x[i ? 'lineTo' : 'moveTo'](164 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    x.closePath(); x.fill();
  } else if (cat === 'iso3d') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    x.strokeStyle = c1; x.lineWidth = 1.4;
    const drawMiniIso = (cx, cy, r) => {
      const dx = r * 0.866, dy = r * 0.5;
      x.beginPath();
      x.moveTo(cx, cy - r); x.lineTo(cx + dx, cy - dy); x.lineTo(cx, cy); x.lineTo(cx - dx, cy - dy); x.closePath();
      x.moveTo(cx - dx, cy - dy); x.lineTo(cx - dx, cy + dy); x.lineTo(cx, cy + r); x.lineTo(cx, cy);
      x.moveTo(cx + dx, cy - dy); x.lineTo(cx + dx, cy + dy); x.lineTo(cx, cy + r);
      x.stroke();
    };
    drawMiniIso(28, 30, 14);
    x.strokeStyle = c2; drawMiniIso(164, 72, 13);
  } else if (cat === 'compositing') {
    x.strokeStyle = sc.accent; x.globalAlpha = 0.65; x.setLineDash([4, 3]); x.lineWidth = 1.4;
    x.strokeRect(58, 12, 76, 84);
    x.setLineDash([]);
    x.fillStyle = sc.accent; x.globalAlpha = 0.22;
    x.beginPath(); x.arc(96, 40, 14, 0, Math.PI * 2); x.fill();
    x.beginPath(); x.ellipse(96, 84, 24, 20, 0, Math.PI, Math.PI * 2); x.fill();
  } else if (cat === 'cinematic') {
    x.fillStyle = '#000000'; x.globalAlpha = 0.72;
    x.fillRect(0, 0, 192, 11); x.fillRect(0, 97, 192, 11);
    x.globalAlpha = 0.55; x.fillStyle = sc.accent2 || sc.accent;
    x.fillRect(16, 78, 160, 2);
  } else if (cat === 'futuristic') {
    x.strokeStyle = sc.accent; x.lineWidth = 1.4; x.globalAlpha = 0.8;
    x.strokeRect(10, 12, 14, 14); x.strokeRect(168, 76, 14, 14);
  } else if (cat === 'guofeng') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    // Delicate hanging scroll inner frame corner lines
    x.strokeStyle = c1; x.globalAlpha = 0.42; x.lineWidth = 1.2;
    x.strokeRect(7, 7, 178, 94);
    // Miniature distant mountain silhouette sweep
    x.fillStyle = c2; x.globalAlpha = 0.18;
    x.beginPath();
    x.moveTo(0, 108); x.lineTo(0, 82);
    x.quadraticCurveTo(38, 66, 76, 78);
    x.quadraticCurveTo(120, 56, 166, 76);
    x.lineTo(192, 70); x.lineTo(192, 108); x.closePath();
    x.fill();
    // Miniature cinnabar chop seal stamp top-left
    x.globalAlpha = 0.88;
    x.strokeStyle = c1; x.lineWidth = 1.6;
    x.strokeRect(14, 14, 16, 16);
    x.lineWidth = 1;
    x.beginPath();
    x.moveTo(18, 18); x.lineTo(26, 18);
    x.moveTo(22, 18); x.lineTo(22, 26);
    x.moveTo(18, 26); x.lineTo(26, 26);
    x.stroke();
  } else if (cat === 'trapsoul') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    x.strokeStyle = c1; x.lineWidth = 1.5; x.globalAlpha = 0.58;
    x.beginPath(); x.arc(96, 54, 30, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 0.34; x.strokeStyle = c2; x.lineWidth = 1.1;
    x.beginPath(); x.arc(96, 54, 42, 0, Math.PI * 2); x.stroke();
    x.globalAlpha = 0.78; x.fillStyle = c1;
    [[22, 24, 3.2], [168, 22, 2.5], [164, 84, 3.5]].forEach(([px, py, r]) => { x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); });
    x.fillStyle = c2; x.globalAlpha = 0.65;
    for (let i = 0; i < 5; i++) x.fillRect(14 + i * 6, 88 - (6 + (i % 3) * 4), 3.5, 6 + (i % 3) * 4);
  } else if (cat === 'rnb') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    for (let w = 0; w < 3; w++) {
      x.strokeStyle = w % 2 ? c2 : c1;
      x.lineWidth = w === 1 ? 1.8 : 1.2;
      x.globalAlpha = 0.56 - w * 0.1;
      x.beginPath();
      for (let px = 8; px <= 184; px += 8) {
        const py = (w === 0 ? 22 : w === 1 ? 78 : 88) + Math.sin(px * 0.045 + w * 1.5) * 5;
        x[px === 8 ? 'moveTo' : 'lineTo'](px, py);
      }
      x.stroke();
    }
    x.fillStyle = c1; x.globalAlpha = 0.72;
    x.beginPath(); x.arc(168, 22, 4.5, 0, Math.PI * 2); x.fill();
  } else if (cat === 'hiphop') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    const heights = [18, 11, 26, 15, 22, 12];
    heights.forEach((h, i) => {
      x.fillStyle = c1; x.globalAlpha = 0.78;
      x.fillRect(12 + i * 7, 92 - h, 4.5, h);
      x.fillStyle = c2; x.globalAlpha = 0.9;
      x.fillRect(12 + i * 7, 92 - h - 3.5, 4.5, 2);
    });
    x.strokeStyle = c2; x.lineWidth = 2.2; x.globalAlpha = 0.65;
    x.beginPath(); x.moveTo(152, 14); x.lineTo(176, 38); x.moveTo(162, 14); x.lineTo(176, 28); x.stroke();
  } else if (cat === 'pop') {
    const c1 = sc.accent, c2 = sc.accent2 || sc.fg;
    const star = (cx, cy, r, col, a) => {
      x.save(); x.translate(cx, cy); x.fillStyle = col; x.globalAlpha = a;
      x.beginPath();
      for (let i = 0; i < 8; i++) {
        const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.22 : r;
        x[i ? 'lineTo' : 'moveTo'](Math.cos(ang) * rr, Math.sin(ang) * rr);
      }
      x.closePath(); x.fill(); x.restore();
    };
    star(24, 24, 8, c1, 0.88);
    star(166, 26, 6.5, c2, 0.85);
    star(160, 82, 8.5, c1, 0.82);
    star(30, 80, 5.5, c2, 0.78);
  } else if (cat === 'animation' || cat === 'musicvideo') {
    x.fillStyle = sc.accent; x.globalAlpha = 0.75;
    x.beginPath(); x.arc(24, 24, 4, 0, Math.PI * 2); x.arc(166, 28, 3, 0, Math.PI * 2); x.fill();
    x.fillStyle = sc.accent2 || sc.accent;
    x.beginPath(); x.arc(154, 78, 5, 0, Math.PI * 2); x.fill();
  }
  x.restore();
}
function renderStyleCatBar() {
  const bar = $('styleCatBar'); if (!bar) return;
  const rawLang = document.documentElement.lang || 'fr';
  const lang = ['fr', 'en', 'zh-Hans', 'zh-Hant', 'ko', 'id', 'vi', 'ja'].includes(rawLang) ? rawLang : 'fr';
  if (!bar.children.length) {
    STYLE_CAT_META.forEach(([cid, labels]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'style-cat-btn';
      btn.dataset.cat = cid;
      const cnt = cid === 'all' ? J.STYLE_ORDER.length : J.STYLE_ORDER.filter(k => styleMatchesCat(k, cid)).length;
      const lbl = labels[lang] || labels.en;
      btn.textContent = `${lbl} (${cnt})`;
      btn.addEventListener('click', () => {
        styleCatFilter = cid;
        drawStyleGrid();
      });
      bar.appendChild(btn);
    });
  }
  [...bar.children].forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.cat === styleCatFilter ? 'true' : 'false');
  });
}
function drawStyleGrid() {
  const g = $('styleGrid'); if (!g) return;
  renderStyleCatBar();
  if (!g.children.length) {
    J.STYLE_ORDER.forEach(k => {
      const b = document.createElement('button'); b.className = 'stile'; b.dataset.k = k;
      b.title = J.STYLES[k].desc;
      b.innerHTML = `<canvas width="192" height="108"></canvas><span>${escapeHtml(J.STYLES[k].name)}</span><span class="badges">${setBadges(J.STYLES[k])}</span>`;
      b.addEventListener('click', () => { remember(); S.project.style = k; S.project.colors.enabled = false; syncUI(); replan(); commit(); });
      g.appendChild(b);
    });
  }
  [...g.children].forEach(b => {
    const k = b.dataset.k, st = J.STYLES[k], sc = st.schemes[0], cv = b.querySelector('canvas');
    b.hidden = !styleMatchesCat(k, styleCatFilter);
    b.setAttribute('aria-pressed', S.project.style === k ? 'true' : 'false');
    const off = !J.randomOk(S.project, 'style', k);
    b.classList.toggle('set-off', off);
    b.title = st.desc + (off ? (st.extra && S.project.extra !== true ? '（追加分がオフのため、おまかせでは選ばれません）' : st.set && !J.setOn(S.project, st.set) ? '（このセットがオフのため、おまかせでは選ばれません）' : '（和風の演出がオフのため、おまかせでは選ばれません）') : '');
    if (cv.dataset.drawn === k) return;
    cv.dataset.drawn = k;
    const x = cv.getContext('2d');
    x.fillStyle = sc.bg; x.fillRect(0, 0, 192, 108);
    drawStyleThumbAccent(x, st, sc);
    st.schemes.slice(1, 4).forEach((s2, i) => { x.fillStyle = s2.bg; x.fillRect(192 - 14 * (i + 1), 0, 14, 10); });
    const f = (st.fonts && st.fonts.display && st.fonts.display[0]) || 'gothic_black';
    const glyph = st.cat === 'compositing' ? 'Aa' : st.cat === 'guofeng' ? '古風' : '字面';
    x.font = J.fontCSS(f, 44); x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = sc.ghostB; x.fillText(glyph, 96 - 3, 52 - 1);
    x.fillStyle = sc.ghostA; x.fillText(glyph, 96 + 3, 52 + 2);
    x.fillStyle = sc.fg; x.fillText(glyph, 96, 52);
    x.fillStyle = sc.accent; x.fillRect(12, 90, 30, 4);
    x.font = J.fontCSS('mono', 9); x.textAlign = 'left'; x.fillStyle = sc.sub; x.fillText(k.toUpperCase().slice(0, 16), 48, 93);
  });
}
function fontSelectOptions(sel) {
  const isMix = Array.isArray(sel);
  let html = '<option value="">スタイルの既定</option>';
  if (isMix) html += `<option value="__mix__" selected>Mix (${sel.length})</option>`;
  const groups = new Map();
  for (const [k, f] of Object.entries(J.FONTS)) {
    const gName = f.group || '';
    if (!groups.has(gName)) groups.set(gName, []);
    groups.get(gName).push([k, f]);
  }
  const opt = ([k, f]) => {
    const g = J.faceOf ? J.faceOf(k) : f, alt = g.label && g.label !== f.label ? ' → ' + g.label : '';
    return `<option value="${escapeHtml(k)}" ${!isMix && sel === k ? 'selected' : ''}>${escapeHtml(f.label + alt)}</option>`;
  };
  for (const [gName, items] of groups) {
    if (!gName) html += items.map(opt).join('');
    else if (gName === 'Classical Chinese') html += `<optgroup label="${escapeHtml('国风古典 · Classical Chinese')}">${items.map(opt).join('')}</optgroup>`;
    else html += `<optgroup label="${escapeHtml('Art & Motion · ' + gName)}">${items.map(opt).join('')}</optgroup>`;
  }
  return html;
}
function renderFontRoles() {
  const box = $('fontRoles'); box.innerHTML = '';
  [['display', '見出し'], ['serif', '明朝枠'], ['body', '小さな文字']].forEach(([role, label]) => {
    const row = document.createElement('div'); row.className = 'font-row';
    row.innerHTML = `<span class="muted">${label}</span><select aria-label="${label}のフォント">${fontSelectOptions(S.project.fonts[role])}</select>`;
    row.querySelector('select').addEventListener('change', e => {
      if (e.target.value === '__mix__') return;
      if (e.target.value) S.project.fonts[role] = e.target.value; else delete S.project.fonts[role];
      fontKey = ''; replan();
    });
    box.appendChild(row);
  });
}
const BASE_KEYS = [['bg', '背景'], ['fg', '文字'], ['sub', '補助']];
const ACCENT_KEYS = [['accent', 'アクセント'], ['ghostA', 'ズレ色A'], ['ghostB', 'ズレ色B']];
function renderColors() {
  const st = J.STYLES[S.project.style] || J.STYLES.noir, sc = st.schemes[0];
  const c = S.project.colors;
  $('colorOn').checked = !!c.enabled;
  $('accentOn').checked = !!c.accentOn;
  const fill = (rowId, keys, flag) => {
    const row = $(rowId); row.innerHTML = '';
    keys.forEach(([k, label]) => {
      const l = document.createElement('label');
      const v = (c[flag] && c[k]) || c[k] || sc[k];
      l.innerHTML = `${label}<input type="color" value="${toColorInput(v)}">`;
      l.querySelector('input').addEventListener('input', e => {
        c[k] = e.target.value.toUpperCase();
        if (!c[flag]) { c[flag] = true; $(flag === 'enabled' ? 'colorOn' : 'accentOn').checked = true; }
        replanSoon(60); drawSwatch();
      });
      row.appendChild(l);
    });
  };
  fill('colorRow', BASE_KEYS, 'enabled');
  fill('colorRowAccent', ACCENT_KEYS, 'accentOn');
  drawSwatch();
}
const toColorInput = v => { const h = String(v || '#000000'); return /^#[0-9a-f]{6}$/i.test(h) ? h.toLowerCase() : J.toHex(...J.hex(h)).toLowerCase(); };
function swatchHTML(cols) { return cols.filter(c => /^#[0-9a-f]{3,8}$/i.test(String(c))).map(c => `<i style="background:${c}" title="${c}"></i>`).join(''); }
function drawSwatch() {
  const sc = S.plan ? S.plan.style.schemes[0] : null; if (!sc) return;
  $('paletteSwatch').innerHTML = swatchHTML([sc.accent, sc.ghostA, sc.ghostB]);
}
function randomPalette() {
  remember();
  const c = S.project.colors;
  const sc0 = J.STYLES[S.project.style].schemes[0];
  const bg = c.enabled && c.bg ? c.bg : sc0.bg;
  let p, guard = 0;
  do { p = J.randomPalette(bg); } while (guard++ < 6 && p.ghostA === c.ghostA && p.ghostB === c.ghostB);
  Object.assign(c, { accent: p.accent, ghostA: p.ghostA, ghostB: p.ghostB, accentOn: true });
  renderColors(); replan(); commit();
  toast('配色：アクセント・ズレ色A/Bを変更', [p.accent, p.ghostA, p.ghostB]);
}

/* ---------------- history of looks (◀ ▶) ---------------- */
// only the "look" is tracked — lyrics, timing and output settings are never rolled back
const HKEYS = ['style', 'mood', 'seed', 'fx', 'enabled', 'fonts', 'colors', 'overrides', 'locks'];
const H = { list: [], i: -1 };
const lookSnap = () => JSON.stringify(Object.fromEntries(HKEYS.map(k => [k, S.project[k] ?? null])));
function remember() {            // call before changing the look: makes sure the current look is on the stack
  const s = lookSnap();
  if (H.i >= 0 && H.list[H.i] === s) return;
  H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1;
}
function commit() {              // call after changing the look
  const s = lookSnap();
  if (H.list[H.i] !== s) { H.list = H.list.slice(0, H.i + 1); H.list.push(s); H.i = H.list.length - 1; }
  if (H.list.length > 80) { H.list.splice(0, H.list.length - 80); H.i = H.list.length - 1; }
  updateHist();
}
function histGo(d) {
  if (S.exporting) return;
  remember();                    // hand edits made since the last step become a stop of their own
  const j = H.i + d; if (j < 0 || j >= H.list.length) return;
  H.i = j;
  Object.assign(S.project, JSON.parse(H.list[j]));
  fontKey = ''; syncUI(); replan(); updateHist();
  toast(`${j + 1} / ${H.list.length} 案目`);
  restartPreview();
}
function updateHist() {
  const canB = H.i > 0, canF = H.i < H.list.length - 1;
  ['btnPrev', 'btnPrev2'].forEach(id => { $(id).disabled = !canB; });
  ['btnNext', 'btnNext2'].forEach(id => { $(id).disabled = !canF; });
  $('histPos').textContent = H.list.length > 1 ? `${H.i + 1} / ${H.list.length}` : '';
}

/* ---------------- locks (what Randomize / Shuffle must not touch) ----------------
   project.locks = { tech: { group: true }, params: { key: true } }
   tech:   freezes that group's ON/OFF selection, i.e. the candidate count the panel shows (120/140, 28/28).
           Randomize re-picks which techniques are candidates, so freezing the pool is what keeps the count —
           this does not pin one technique in place.
   params: freezes the current value of the effects sliders, on-twos and flash.
   Neither goes into J.plan: they only bracket the places that rewrite the look (Randomize, mood reroll). */
const LOCK_TITLE_ON = 'おまかせ／シャッフルで変えないようにロック';
const TECH_LOCK_ON = 'おまかせでON／OFFを変えないようにロック';
const LOCK_TITLE_OFF = 'ロック中。クリックで解除';
function locksOf() {
  const P = S.project;
  if (!P.locks) P.locks = { tech: {}, params: {} };
  if (!P.locks.tech) P.locks.tech = {};
  if (!P.locks.params) P.locks.params = {};
  return P.locks;
}
function lockOn(k) { return !!locksOf().params[k]; }
function lockName(k) {
  const f = FX.find(x => x[0] === k);
  return f ? f[1] : k;
}
function groupLabel(g) { const m = GROUPS.find(x => x[0] === g); return m ? m[1] : g; }
function toggleTechLock(g) {
  const L = locksOf();
  remember();
  if (L.tech[g]) { delete L.tech[g]; toast('ロック解除：' + groupLabel(g)); }
  else { L.tech[g] = true; toast('ロック：' + groupLabel(g)); }
  commit(); autosave(); renderTech();
}
function toggleParamLock(k) {
  const L = locksOf();
  remember();
  if (L.params[k]) { delete L.params[k]; toast('ロック解除：' + lockName(k)); }
  else { L.params[k] = true; toast('ロック：' + lockName(k)); }
  commit(); autosave(); renderFx();
}
function lockedEnabled() {                        // ON/OFF selection of every locked group, as it is now
  const P = S.project, out = {};
  for (const g of Object.keys(locksOf().tech)) if (P.enabled && P.enabled[g]) out[g] = Object.assign({}, P.enabled[g]);
  return out;
}
function restoreEnabled(keep) {                   // put the locked groups back after Randomize
  const P = S.project;
  for (const g of Object.keys(keep || {})) { P.enabled = P.enabled || {}; P.enabled[g] = keep[g]; }
}
function lockedParams() {                         // current value of every locked effect / set switch
  const out = {}, L = locksOf(), F = S.project.fx;
  for (const k of Object.keys(L.params)) {
    if (!L.params[k]) continue;
    if (k === 'koma') out[k] = J.komaOf(F);                      // on-twos: freeze the effective value even when unset
    else if (k === 'flash') out[k] = !!F.flash;
    else if (F[k] != null) out[k] = F[k];
  }
  return out;
}
function restoreParams(keep) {
  const P = S.project;
  for (const k of Object.keys(keep || {})) P.fx[k] = keep[k];
}
function lockBtn(k, anchor) {                     // lock button for effects that are not sliders (on-twos, flash)
  const p = anchor.parentElement;
  let b = p.querySelector(':scope > .lk[data-lk="' + k + '"]');
  if (!b) {
    b = document.createElement('button');
    b.type = 'button'; b.className = 'icon ghost lk pro-only'; b.dataset.lk = k;
    b.innerHTML = ICON.lock;
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleParamLock(k); });
    anchor.insertAdjacentElement('afterend', b);
  }
  const on = !!locksOf().params[k];
  b.setAttribute('aria-pressed', String(on));
  b.title = on ? LOCK_TITLE_OFF : LOCK_TITLE_ON;
  return b;
}

/* ---------------- おまかせ ---------------- */
function restartPreview() { seek(0); if (!S.playing && S.mode !== 'pro') play(); }
const themeName = th => { const o = document.querySelector(`.themeSel option[value="${th}"]`); return o ? o.textContent : th; };
function omakase() {
  if (S.exporting || S.tap) return;
  remember();
  const keepE = lockedEnabled(), keepP = lockedParams();
  const th = J.THEMES[S.project.themeId] ? S.project.themeId : null;
  const r = J.omakase(S.project, Math.random, th, S.audio);
  Object.assign(S.project, r);
  if (S.audio && S.audio.beats && S.audio.beats.length && S.project.timing) S.project.timing.snap = true;
  restoreEnabled(keepE); restoreParams(keepP);
  fontKey = ''; syncUI(); replan(); commit();
  toast((th ? `おまかせ（${themeName(th)}）：` : 'おまかせ：') + `${J.STYLES[r.style].name} × ${J.MOODS[r.mood].name}`, r.colors.accentOn ? [r.colors.accent, r.colors.ghostA, r.colors.ghostB] : null);
  restartPreview();
}
// change just one aspect of the current look
function rerollPart(part) {
  if (S.exporting || S.tap) return;
  remember();
  const P = S.project;
  let msg = '';
  if (part === 'style') {
    const th = P.themeId && J.THEMES[P.themeId];
    let pool = th && Array.isArray(th.styles) && th.styles.length
      ? th.styles.filter(k => k !== P.style && J.STYLES[k] && J.randomOk(P, 'style', k))
      : J.STYLE_ORDER.filter(k => k !== P.style && J.randomOk(P, 'style', k));
    if (!pool.length && th && Array.isArray(th.styles)) pool = th.styles.filter(k => k !== P.style && J.STYLES[k]);
    if (!pool.length) pool = J.STYLE_ORDER.filter(k => k !== P.style);
    P.style = pool[Math.floor(Math.random() * pool.length)];
    P.colors.enabled = false;
    msg = `スタイル：${J.STYLES[P.style].name}`;
  } else if (part === 'mood') {
    const keepE = lockedEnabled(), keepP = lockedParams();
    const th = J.THEMES[P.themeId] ? P.themeId : null;
    const r = J.omakase(P, Math.random, th, S.audio);
    Object.assign(P, { mood: r.mood, fx: r.fx, enabled: r.enabled });
    if (S.audio && S.audio.beats && S.audio.beats.length && P.timing) P.timing.snap = true;
    for (const k of ['wa', 'extra', ...J.SET_ORDER]) if (r[k] === true) P[k] = true;     // switches the theme needs
    restoreEnabled(keepE); restoreParams(keepP);
    msg = `雰囲気：${J.MOODS[r.mood].name}`;
  } else if (part === 'cut') {
    P.seed = (Math.random() * 1e9) | 0;
    msg = '構成：レイアウトと動きを再抽選';
  }
  fontKey = ''; syncUI(); replan(); commit();
  toast(msg);
  restartPreview();
}
function showNow() {
  const el = $('easyNow'); if (!el || !S.plan || el.closest('[hidden]')) return;
  const P = S.project, sc = S.plan.style.schemes[0];
  const moodName = P.mood && J.MOODS[P.mood] ? J.MOODS[P.mood].name : 'カスタム';
  const dList = (S.plan.style.fonts && S.plan.style.fonts.display) || [];
  const fk = dList[0];
  const fontBase = J.FONTS[fk] ? (J.faceOf ? J.faceOf(fk) : J.FONTS[fk]).label : fk;   // the face actually drawn for the lyric language
  const fontName = fontBase + (dList.length > 1 ? ` (+${dList.length - 1})` : '');
  const cuts = S.plan.cuts.filter(c => c.line >= 0 && c.layout !== 'interlude');
  const kinds = new Set(cuts.map(c => c.layout)).size;
  const row = (k, v) => `<div class="now-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
  el.innerHTML = row('スタイル', `<b>${escapeHtml(J.STYLES[P.style].name)}</b>`)
    + row('雰囲気', escapeHtml(moodName))
    + row('配色', `<span class="swatches">${swatchHTML([sc.bg, sc.fg, sc.accent, sc.ghostA, sc.ghostB])}</span>${P.colors.accentOn ? '<span class="tagl">ランダム</span>' : ''}`)
    + row('見出し書体', escapeHtml(fontName))
    + row('構成', `${cuts.length} カット・レイアウト ${kinds} 種`)
    + row('演出', `加工 ${cuts.filter(c => c.treat && c.treat !== 'none').length}・背景 ${new Set(cuts.map(c => c.bg).filter(b => b && b !== 'none')).size}種・カメラ ${cuts.filter(c => c.cam && c.cam !== 'push').length}`);
}
let toastTimer = 0;
function toast(m, cols) {
  const el = $('toast'); if (!el) return;
  el.innerHTML = escapeHtml(m) + (cols ? `<span class="swatches">${swatchHTML(cols)}</span>` : '');
  el.hidden = false; el.classList.remove('out'); void el.offsetWidth; el.classList.add('in');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('in'); el.classList.add('out'); toastTimer = setTimeout(() => { el.hidden = true; }, 260); }, 1700);
}

/* ---------------- かんたん / 詳細 ---------------- */
function setMode(m) {
  S.mode = m === 'easy' ? 'easy' : m === 'mobile' ? 'mobile' : 'pro';
  const mobile = S.mode === 'mobile', easy = S.mode === 'easy' || mobile;   // スマホ = the かんたん panel, laid out for a phone
  $('app').classList.toggle('is-easy', easy);
  $('app').classList.toggle('is-mobile', mobile);
  $('app').classList.remove('menu-open'); $('btnMenu').setAttribute('aria-expanded', 'false');
  document.documentElement.classList.toggle('fixed-ok', !mobile);           // one scrolling page on a phone
  $('easyPanel').hidden = !easy;
  $('modeMobile').setAttribute('aria-pressed', String(mobile));
  $('modeEasy').setAttribute('aria-pressed', String(S.mode === 'easy'));
  $('modePro').setAttribute('aria-pressed', String(S.mode === 'pro'));
  try { localStorage.setItem('jizura.mode', S.mode); } catch (e) {}
  if (mobile) mobileInit();
    if (easy) { showNow(); syncOut(); codecNoteSoon(); }
    if (easy) closeCutPick();
    if (S.plan && S.lineEls && S.lineEls.length) { lastCutIdx = -2; updateCutInfo(); }
  sizeViewport(); drawTimeline(); loadThumbFonts();
  syncSlidingMenus(true);
}

/* ---------------- sliding rounded menu highlight indicator ---------------- */
const SLIDING_MENUS = [
  { sel: '.tabs', activeSel: 'button[aria-selected="true"]' },
  { sel: '.modes', activeSel: 'button:not(#btnTour)[aria-pressed="true"]' },
  { sel: '.cloud-tabs', activeSel: '.cloud-tab.is-active, button[aria-selected="true"]' },
  { sel: '.kp-seg', activeSel: 'button[aria-pressed="true"]' },
  { sel: '.lang-switch', activeSel: '[aria-current="page"]' },
];
let slidingMenusBound = false;

function ensureSlidingPill(container) {
  if (!container) return null;
  container.classList.add('has-sliding-pill');
  let pill = container.querySelector(':scope > .sliding-pill');
  if (!pill) {
    pill = document.createElement('span');
    pill.className = 'sliding-pill is-instant';
    pill.setAttribute('aria-hidden', 'true');
    container.prepend(pill);
  }
  return pill;
}

function updateSlidingMenu(container, activeSel, animate = true) {
  if (!container) return null;
  const pill = ensureSlidingPill(container);
  const target = container.querySelector(activeSel);
  if (!target) {
    pill.classList.remove('is-ready');
    pill.dataset.placed = '0';
    return null;
  }

  const cRect = container.getBoundingClientRect ? container.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
  const tRect = target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };

  let x = 0, y = 0, w = 0, h = 0;
  if (cRect.width > 0 && tRect.width > 0) {
    x = +(tRect.left - cRect.left + (container.scrollLeft || 0) - (container.clientLeft || 0)).toFixed(2);
    y = +(tRect.top - cRect.top + (container.scrollTop || 0) - (container.clientTop || 0)).toFixed(2);
    w = +tRect.width.toFixed(2);
    h = +tRect.height.toFixed(2);
  } else if ((container.offsetWidth > 0 || target.offsetWidth > 0) && target.offsetWidth > 0) {
    x = +(target.offsetLeft || 0).toFixed(2);
    y = +(target.offsetTop || 0).toFixed(2);
    w = +(target.offsetWidth || 0).toFixed(2);
    h = +(target.offsetHeight || 0).toFixed(2);
  } else {
    pill.dataset.placed = '0';
    return null;
  }

  const nextW = `${w}px`;
  const nextH = `${h}px`;
  const nextT = `translate3d(${x}px, ${y}px, 0)`;
  const wasPlaced = pill.dataset.placed === '1';
  const prevTarget = pill._lastTarget;
  const shouldInstant = !wasPlaced || animate === false;

  if (
    wasPlaced &&
    prevTarget === target &&
    pill.style.width === nextW &&
    pill.style.height === nextH &&
    pill.style.transform === nextT &&
    pill.classList.contains('is-ready') &&
    (!shouldInstant || pill.classList.contains('is-instant'))
  ) {
    return { x, y, width: w, height: h, target };
  }

  if (shouldInstant) {
    if (!pill.classList.contains('is-instant')) pill.classList.add('is-instant');
  } else {
    if (pill.classList.contains('is-instant')) pill.classList.remove('is-instant');
  }

  pill.style.width = nextW;
  pill.style.height = nextH;
  pill.style.transform = nextT;
  if (!pill.classList.contains('is-ready')) pill.classList.add('is-ready');
  pill._lastTarget = target;

  if (shouldInstant) {
    void pill.offsetWidth;
    pill.dataset.placed = '1';
    requestAnimationFrame(() => {
      if (pill.classList.contains('is-instant')) pill.classList.remove('is-instant');
    });
  } else if (prevTarget !== target) {
    pill.dataset.placed = '1';
  }

  return { x, y, width: w, height: h, target };
}

function syncSlidingMenus(animate = true) {
  for (const spec of SLIDING_MENUS) {
    document.querySelectorAll(spec.sel).forEach((el) => {
      updateSlidingMenu(el, spec.activeSel, animate);
    });
  }
}

function initSlidingMenus() {
  for (const spec of SLIDING_MENUS) {
    document.querySelectorAll(spec.sel).forEach((container) => {
      ensureSlidingPill(container);
      updateSlidingMenu(container, spec.activeSel, false);

      if (container._slidingObs) return;
      if (typeof MutationObserver !== 'undefined') {
        const obs = new MutationObserver((mutations) => {
          const isPillNode = n => n && n.classList && n.classList.contains('sliding-pill');
          const relevant = mutations.some(m => {
            if (isPillNode(m.target)) return false;
            if (m.target === container) {
              if (m.type === 'attributes') return false;
              const touched = [...(m.addedNodes || []), ...(m.removedNodes || [])];
              return touched.some(n => !isPillNode(n));
            }
            return true;
          });
          if (!relevant) return;
          updateSlidingMenu(container, spec.activeSel, true);
        });
        obs.observe(container, {
          attributes: true,
          subtree: true,
          childList: true,
          attributeFilter: ['aria-selected', 'aria-pressed', 'aria-current', 'class', 'hidden'],
        });
        container._slidingObs = obs;
      }
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => {
          if (container._slidingRaf) return;
          container._slidingRaf = requestAnimationFrame(() => {
            container._slidingRaf = 0;
            updateSlidingMenu(container, spec.activeSel, false);
          });
        });
        ro.observe(container);
        container._slidingRo = ro;
      }
    });
  }
  if (!slidingMenusBound) {
    slidingMenusBound = true;
    window.addEventListener('resize', () => syncSlidingMenus(false));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => syncSlidingMenus(false)).catch(() => {});
    }
  }
}

/* スマホ: the preview sticks right under the header; the first time, a phone-friendly size and the line list folded */
function mobileBar() {
  const b = document.querySelector('.bar');
  if (!b) return;
  const h = b.offsetHeight + 'px';
  if (b._lastMbar !== h) {
    b._lastMbar = h;
    document.documentElement.style.setProperty('--mbar', h);
  }
}
function mobileInit() {
  mobileBar();
  let first = true; try { first = localStorage.getItem('jizura.mobileInit') !== '1'; localStorage.setItem('jizura.mobileInit', '1'); } catch (e) {}
  if (first) {
    if ((S.project.res || 1080) > 720) { S.project.res = 720; syncOut(); autosave(); }
    const sec = $('lineList') && $('lineList').closest('.sec'); if (sec) sec.classList.add('fold');
  }
}

/* ---------------- fx tab ---------------- */
const FX = [['motion', '動きの強さ'], ['glitch', 'グリッチ'], ['chroma', '色ズレ'], ['decor', '装飾の量'], ['density', 'カットの細かさ'], ['texture', '質感'], ['bgSwitch', '背景の切替']];
function renderFx() {
  const box = $('fxSliders'); box.innerHTML = '';
  FX.forEach(([k, label]) => {
    const row = document.createElement('div'); row.className = 'slider';
    const v = S.project.fx[k] ?? 0.5;
    const lk = lockOn(k);
    row.innerHTML = `<label for="fx_${k}">${label}</label><input id="fx_${k}" type="range" min="0" max="1" step="0.01" value="${v}"><output>${Math.round(v * 100)}</output>`
      + `<button type="button" class="icon ghost lk pro-only" data-lk="${k}" aria-pressed="${lk}" title="${lk ? LOCK_TITLE_OFF : LOCK_TITLE_ON}">${ICON.lock}</button>`;
    const inp = row.querySelector('input'), out = row.querySelector('output');
    row.querySelector('.lk').addEventListener('click', () => toggleParamLock(k));
    inp.addEventListener('input', () => { S.project.fx[k] = +inp.value; S.project.mood = null; out.textContent = Math.round(inp.value * 100); replanSoon(120); });
    box.appendChild(row);
  });
  lockBtn('flash', $('fxFlash').closest('label'));
  lockBtn('koma', $('fxKoma').closest('label'));
  $('fxFlash').checked = !!S.project.fx.flash;
  $('fxKoma').value = String(J.komaOf(S.project.fx));
  $('fxHud').value = S.project.fx.hud || 'auto';
  $('fxHideNo').checked = !!S.project.fx.hideNo; $('fxHideTime').checked = !!S.project.fx.hideTime;
  $('seed').value = S.project.seed;
}

/* ---------------- technique tab ---------------- */
const GROUPS = [['layout', 'レイアウト'], ['enter', '登場'], ['hold', '保持'], ['exit', '退場'], ['decor', '装飾'], ['treat', '文字の加工'], ['bg', '背景'], ['cam', 'カメラ'], ['fx', '画面効果'], ['trans', 'カット間のつなぎ']];
const openGroups = new Set();
function techItems(g) { return J.order(g).filter(k => J.registry(g)[k] && !J.registry(g)[k].special); }

const previewR = new J.Renderer();
const previewPlans = new Map();
const previewLive = new Set();
let previewObs = null, previewRaf = 0, previewLast = 0;
function previewCacheKey(g, k) {
  const p = S.project;
  return [p.style, p.aspect, g, k, p.colors && p.colors.enabled ? JSON.stringify(p.colors) : '', JSON.stringify(p.fonts || {})].join('|');
}
function getPreviewPlan(g, k) {
  const id = previewCacheKey(g, k);
  let plan = previewPlans.get(id);
  if (plan) return plan;
  plan = J.previewPlan(S.project, g, k);
  previewPlans.set(id, plan);
  if (previewPlans.size > 500) previewPlans.delete(previewPlans.keys().next().value);
  return plan;
}
function previewTime(plan, g, now) {
  const c = plan.cuts[plan.cuts.length - 1];
  const u = now / 1000;
  if (g === 'enter') return c.start + ((u % 1.5) / 1.5) * Math.max(0.3, c.inDur);
  if (g === 'exit') { const od = Math.max(0.3, c.outDur || 0.5); return c.end - od + ((u % 1.5) / 1.5) * od; }
  if (g === 'trans') return c.start + ((u % 1.7) / 1.7) * (c.transDur || 0.35);
  if (g === 'fx') return (u % 1.05);
  const span = Math.max(1.6, c.dur * 0.96);
  return c.start + ((u % span) / span) * (c.dur * 0.96);
}
function paintTechCanvas(cv, g, k, t) {
  const plan = getPreviewPlan(g, k);
  const ctx = cv.getContext('2d');
  try {
    previewR.frame(ctx, plan, t, { scale: cv.width / plan.W, fast: true, noHud: true, noGhost: g !== 'fx' });
  } catch (e) {
    ctx.fillStyle = '#131316'; ctx.fillRect(0, 0, cv.width, cv.height);
  }
  cv.dataset.ready = '1';
}
function techPaneOpen() {
  const pane = $('techLists') && $('techLists').closest('.tabpane');
  const pick = $('cutPick');
  return (pane && !pane.hidden) || (pick && !pick.hidden);
}
function ensurePreviewObs() {
  if (previewObs) return previewObs;
  previewObs = new IntersectionObserver((ents) => {
    const now = performance.now();
    ents.forEach(e => {
      const cv = e.target;
      if (e.isIntersecting && e.intersectionRatio > 0) {
        previewLive.add(cv);
        if (!cv.dataset.ready && cv.dataset.g && cv.dataset.k) paintTechCanvas(cv, cv.dataset.g, cv.dataset.k, previewTime(getPreviewPlan(cv.dataset.g, cv.dataset.k), cv.dataset.g, now));
      } else previewLive.delete(cv);
    });
    kickPreviewLoop();
  }, { root: null, rootMargin: '40px 0px', threshold: [0, 0.12, 0.4] });
  return previewObs;
}
function resetPreviewWatch() {
  previewLive.clear();
  if (previewObs) { previewObs.disconnect(); previewObs = null; }
}
function watchThumb(cv) { ensurePreviewObs().observe(cv); }
function kickPreviewLoop() {
  if (previewRaf) return;
  const tick = (now) => {
    previewRaf = 0;
    if (document.hidden || S.exporting || !techPaneOpen() || !previewLive.size) return;
    if (now - previewLast >= 70) {
      previewLast = now;
      for (const cv of previewLive) {
        if (!cv.isConnected) { previewLive.delete(cv); continue; }
        const g = cv.dataset.g, k = cv.dataset.k;
        if (!g || !k) continue;
        paintTechCanvas(cv, g, k, previewTime(getPreviewPlan(g, k), g, now));
      }
    }
    previewRaf = requestAnimationFrame(tick);
  };
  previewRaf = requestAnimationFrame(tick);
}
// only the thumbnails on screen are drawn (the observer adds them to the live set when they scroll in)
function queueThumbs(list) {
  [...list.querySelectorAll('canvas[data-g]')].forEach(cv => watchThumb(cv));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickPreviewLoop(); });

function renderTech() {
  resetPreviewWatch();
  const box = $('techLists'); box.innerHTML = '';
  const q = ($('techFilter').value || '').trim().toLowerCase();
  let total = 0, onAll = 0;
  GROUPS.forEach(([g, label]) => {
    const tbl = J.registry(g), items = techItems(g), en = S.project.enabled[g] || (S.project.enabled[g] = {});
    const shown = q ? items.filter(k => (tbl[k].name + ' ' + k).toLowerCase().includes(q)) : items;
    const onN = items.filter(k => en[k] !== false).length;
    total += items.length; onAll += onN;
    if (q && !shown.length) return;
    const d = document.createElement('details'); d.className = 'tgroup';
    d.open = !!q || openGroups.has(g);
    const list = document.createElement('div'); list.className = 'checks tech-grid';
    let built = false;
    const build = () => { if (built) return; built = true; fillCards(); };
    d.addEventListener('toggle', () => { if (d.open) { openGroups.add(g); build(); queueThumbs(list); } else openGroups.delete(g); });
    const lked = !!locksOf().tech[g];
    d.innerHTML = `<summary><span class="tg-name">${label}</span><span class="tg-cnt mono">${onN}/${items.length}</span>`
      + `<button type="button" class="icon ghost lk pro-only" data-lk="${g}" aria-pressed="${lked}" title="${lked ? LOCK_TITLE_OFF : TECH_LOCK_ON}">${ICON.lock}</button></summary><div class="tg-tools"><button class="ghost small" data-a="on">すべてON</button><button class="ghost small" data-a="off">すべてOFF</button><button class="ghost small" data-a="flip">反転</button></div>`;
    const [tw, th] = (() => {
      const [W, H] = J.designSize(S.project.aspect || '16:9');
      const h = 90; return [Math.max(80, Math.round(h * W / H)), h];
    })();
    // the cards of a closed group are made when it is first opened (860 cards with canvases made every syncUI slow)
    const fillCards = () => shown.forEach(k => {
      const l = document.createElement('label');
      l.className = 'tcard';
      l.title = k + (tbl[k].tags && tbl[k].tags.length ? '（' + tbl[k].tags.map(t => (J.MOODS[t] ? J.MOODS[t].name : t)).join('・') + '）' : '');
      if (!J.randomOk(S.project, g, k)) { l.classList.add('set-off'); l.title += tbl[k].extra && S.project.extra !== true ? '（追加分がオフのため、自動では選ばれません）' : tbl[k].set && !J.setOn(S.project, tbl[k].set) ? '（このセットがオフのため、自動では選ばれません）' : '（和風の演出がオフのため、自動では選ばれません）'; }
      l.innerHTML = `<canvas width="${tw}" height="${th}" data-g="${g}" data-k="${k}"></canvas><span class="tcard-name"><input type="checkbox" ${en[k] !== false ? 'checked' : ''}> <span>${escapeHtml(tbl[k].name)}</span>${setBadges(tbl[k])}</span>`;
      const cv = l.querySelector('canvas');
      l.querySelector('input').addEventListener('change', e => { en[k] = e.target.checked; S.project.mood = null; d.querySelector('.tg-cnt').textContent = `${items.filter(x => en[x] !== false).length}/${items.length}`; replanSoon(60); });
      list.appendChild(l);
    });
    d.querySelector('summary .lk').addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggleTechLock(g); });
    d.querySelectorAll('.tg-tools button').forEach(b => b.addEventListener('click', () => {
      const a = b.dataset.a;
      shown.forEach(k => { en[k] = a === 'on' ? true : a === 'off' ? false : en[k] === false; });
      if (g === 'layout' && !items.some(k => en[k] !== false)) en.center = true;
      if (g === 'enter') en.cut = true; if (g === 'exit') en.cut = true; if (g === 'hold') en.still = true;
      if (g === 'treat') en.none = true; if (g === 'bg') en.none = true; if (g === 'cam') en.push = true;
      S.project.mood = null; openGroups.add(g); renderTech(); replan();
    }));
    d.appendChild(list);
    box.appendChild(d);
    if (d.open) { build(); queueThumbs(list); }
  });
  $('techTotal').textContent = `${onAll}/${total}`;
}

/* ---------------- output tab ---------------- */
function syncOut() {
  $('outAspect').value = S.project.aspect; $('outRes').value = String(S.project.res); $('outFps').value = String(S.project.fps);
  $('eAspect').value = S.project.aspect; $('eRes').value = String(S.project.res); $('eFps').value = String(S.project.fps);
  $('outQuality').value = S.project.quality || 'high'; $('outAudio').checked = S.project.includeAudio !== false;
  const k = J.keyMode(S.project) || 'off';
  $('outKey').value = k; $('eKey').value = k;
  $('outCenter').checked = $('eCenter').checked = !!S.project.centerFree;
  const tall = J.designSize(S.project.aspect)[1] > J.designSize(S.project.aspect)[0] * 1.1;
  document.querySelectorAll('.center-dir').forEach(el => { el.hidden = !(S.project.centerFree && tall); });
  document.querySelectorAll('.centerDirSel').forEach(el => { el.value = S.project.centerDir === 'lr' ? 'lr' : 'tb'; });
  const kb = $('keyBadge');
  kb.hidden = k === 'off';
  if (k !== 'off') kb.innerHTML = `<i style="background:${J.KEY_BG[k]}"></i>${k === 'green' ? 'グリーンバック' : 'ブラックバック'}`;
}
// the codec check is slow in some browsers: at start-up, let the first preview frames paint before asking
function codecNoteSoon() { (window.requestIdleCallback || (f => setTimeout(f, 400)))(() => codecNote(), { timeout: 1500 }); }
async function codecNote() {
  const [w, h] = J.outputSize(S.project);
  const vc = await J.pickVideoCodec(w, h, S.project.fps, 12e6);
  $('codecNote').textContent = vc ? `このブラウザでは ${vc.label} で書き出します（${w}×${h} / ${S.project.fps}fps）。書き出し中はタブを開いたままにしてください。` : 'このブラウザは動画エンコード（WebCodecs）に対応していません。Chrome / Edge の最新版で開くか、連番PNGを使ってください。';
  $('btnMP4').disabled = !vc; $('eMP4').disabled = !vc;
  ['btnMP4File', 'eMP4File'].forEach(id => { $(id).hidden = !vc || !canPickFile(); });
  if (!vc) $('eMP4').title = 'このブラウザは MP4 書き出しに対応していません（Chrome / Edge 推奨）';
}
const EXP_BTNS = ['btnMP4', 'btnPNG', 'btnPNGA', 'btnPNGL', 'eMP4', 'btnMP4File', 'eMP4File', 'ePNG', 'ePNGA', 'ePNGL'];
function baseName() {
  const k = J.keyMode(S.project);
  return ((S.project.title || 'jizura').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) || 'jizura') + (k ? (k === 'green' ? '_greenback' : '_blackback') : '');
}
const canPickFile = () => typeof window.showSaveFilePicker === 'function' && !document.documentElement.classList.contains('cep') && typeof VideoEncoder !== 'undefined';
async function runExport(kind) {
  if (S.exporting) return;
  // 大きな動画用: the save dialog must open straight from the click (before anything is awaited)
  let file = null, fileName = '';
  if (kind === 'mp4file') {
    try {
      const hnd = await window.showSaveFilePicker({ suggestedName: baseName() + rangeSuffix() + '.mp4', types: [{ description: 'MP4', accept: { 'video/mp4': ['.mp4'] } }] });
      file = await hnd.createWritable(); fileName = hnd.name;
    } catch (e) { if (e && e.name === 'AbortError') return; toast('保存先を開けませんでした: ' + (e && e.message ? e.message : e)); return; }
  }
  pause();
  const ac = new AbortController(); S.exporting = ac;
  const boxes = [...document.querySelectorAll('.exp-box')];
  const setText = m => boxes.forEach(b => { b.querySelector('.exp-text').textContent = m; });
  const txt = { set textContent(m) { setText(m); }, get textContent() { return boxes[0].querySelector('.exp-text').textContent; } };
  boxes.forEach(b => { b.hidden = false; b.querySelector('.exp-bar').style.width = '0%'; });
  setText('準備中…');
  EXP_BTNS.forEach(id => { $(id).disabled = true; });
  const onProgress = (p, m) => { boxes.forEach(b => { b.querySelector('.exp-bar').style.width = (p * 100).toFixed(1) + '%'; }); setText(m); };
  const t0 = performance.now();
  boxes.forEach(b => { const sh = b.querySelector('.exp-share'); if (sh) sh.hidden = true; });
  // keep the phone's screen on while exporting (a sleeping screen stops the encoder)
  let wake = null; try { if (navigator.wakeLock) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
  // スマホ: at most 1080p (phones run out of memory / encoder time at 1440p and 4K)
  const proj = S.mode === 'mobile' && (S.project.res || 1080) > 1080 ? Object.assign({}, S.project, { res: 1080 }) : S.project;
  if (proj !== S.project) toast('スマホの画面では 1080p で書き出します');
  try {
    await J.ensureFonts(S.project.lyrics + (S.project.title || '') + (S.project.artist || '') + HUD_CHARS, J.fontsOfPlan(S.plan));
    const lost = J.missingUserFonts(J.fontsOfPlan(S.plan).concat(Object.values(S.project.fonts || {})));
    if (lost.length) throw new Error(`読み込んだ書体（${[...new Set(lost)].join('・')}）がこのブラウザにないため、書き出しを止めました。「フォント」から同じファイルを読み込み直すか、別の書体を選んでください`);
    if (kind === 'mp4' || kind === 'mp4file') {
      const plan = S.plan, range = exportRange(), span = J.exportSpan(plan, range);
      const r = await J.exportMP4({ plan, project: proj, audio: S.project.includeAudio !== false ? S.audio : null, quality: S.project.quality || 'high', onProgress, signal: ac.signal, range, file });
      file = null;
      txt.textContent = `完成 ${r.blob ? (r.blob.size / 1048576).toFixed(1) + 'MB・' : ''}${r.codec}${r.audio ? ' + ' + r.audio.toUpperCase() : ''}・${((performance.now() - t0) / 1000).toFixed(0)}秒`;
      if (r.blob) {
        const name = baseName() + rangeSuffix() + '.mp4';
        const res = await J.saveFile(name, r.blob);
        if (res === 'declined') txt.textContent += '（保存はキャンセルされました）';
        else recordWork('export_mp4', 'export', `${name} (${(r.blob.size / 1048576).toFixed(1)} MB)`);
        offerShare(boxes, r.blob, name);
      } else {
        txt.textContent += `・「${fileName}」に保存しました`;
        recordWork('export_mp4', 'export', fileName || 'MP4');
      }
      if (r.tried && r.tried.length) txt.textContent += '（最初の方法では失敗したため、別のエンコーダーで書き出しました）';
      // audio that some players cannot play (Opus), or none at all: save the soundtrack as WAV next to it
      if (r.audioWanted && r.audio !== 'aac') {
        await J.saveFile(baseName() + rangeSuffix() + '_audio.wav', J.audioWav(S.audio.buffer, span.dur, span.t0));
        txt.textContent += r.audio ? '。このブラウザでは音声が Opus になり、iPhone・QuickTime などでは音が出ないことがあるため、音声を WAV でも保存しました' : '。このブラウザは音声を書き出せないため、音声を WAV で別に保存しました（動画編集ソフトで重ねてください）';
      } else if (S.project.includeAudio !== false && !S.audio && S.project.audioName) txt.textContent += '。曲が読み込まれていないため音声なしです（「曲を読み込む」から読み込み直してください）';
    } else {
      const blob = await J.exportPNGZip({ plan: S.plan, project: proj, transparent: kind === 'pnga', layers: kind === 'pngl', onProgress, signal: ac.signal, range: exportRange() });
      txt.textContent = `完成 ${(blob.size / 1048576).toFixed(1)}MB`;
      const zname = baseName() + rangeSuffix() + (kind === 'pnga' ? '_alpha' : kind === 'pngl' ? '_layers' : '') + '_png.zip';
      await J.saveFile(zname, blob);
      recordWork('export_png', 'export', `${zname} (${(blob.size / 1048576).toFixed(1)} MB)`);
    }
  } catch (e) {
    txt.textContent = 'エラー: ' + (e && e.message ? e.message : e);
    console.error(e);
    if (file) { try { await file.abort(); } catch (e2) {} }
  } finally {
    S.exporting = null; S.need = true;
    EXP_BTNS.forEach(id => { $(id).disabled = false; });
    try { if (wake) await wake.release(); } catch (e) {}
    codecNote();
  }
}
/* phones: the share sheet is the reliable way to put a video into Photos / Files (a download link often isn't) */
function offerShare(boxes, blob, name) {
  let f = null;
  try { f = new File([blob], name, { type: blob.type || 'video/mp4' }); } catch (e) { return; }
  if (!navigator.canShare || !navigator.share || !navigator.canShare({ files: [f] })) return;
  boxes.forEach(b => {
    const sh = b.querySelector('.exp-share'); if (!sh) return;
    sh.hidden = false;
    sh.onclick = async () => { try { await navigator.share({ files: [f], title: name }); } catch (e) {} };
  });
}

/* ---------------- studio tap sync ---------------- */
function tapCopy() {
  const lang = document.documentElement.lang || 'fr';
  if (lang === 'fr') {
    return {
      btn: '⏱ Synchro au Tap',
      title: '⏱ Synchro au Tap Studio',
      mode: 'Mode',
      mLine: 'Phrase / Ligne',
      mWord: 'Mot par mot (Précis)',
      mCut: 'Phrases + Coupes [Tab]',
      rate: 'Vitesse',
      snap: 'Calage',
      sVocal: 'Attaque vocale (±90ms)',
      sBeat: 'Grille rythmique (BPM)',
      sFree: 'Libre (ms exact)',
      latency: 'Latence',
      autoMicro: 'Micro-calage mots (Voix)',
      microBtn: '✨ Micro-caler phrase',
      holdEnd: 'Maintenir = Fin [E]',
      count: 'Compte 3·2·1',
      click: 'Clic métronome',
      vocal: 'Voix',
      precisionPrefix: 'Précision',
      perfectHit: 'Parfait',
      earlyHit: 'En avance',
      lateHit: 'En retard',
      loopLine: '🔁 Boucler',
      assistRest: '⚡ Finir IA Voix',
      coherenceLbl: 'Coordination',
      syncedWords: 'mots calés',
      tapBtn: 'TAP [Espace]',
      tapWordBtn: 'TAP MOT [Espace]',
      markEnd: '⏹ Fin [E]',
      pause: '⏸ Pause [P]',
      play: '▶ Lecture [P]',
      rew: '⟲ -2s',
      back: '↶ 1 retour',
      skip: '⏭ Passer [S]',
      stop: '✓ Terminer',
      guideLine: 'Appuyez sur <span class="kbd">Espace</span> ou <b>TAP</b> dès que le chanteur démarre la phrase affichée.',
      guideWord: 'Mode <b>Mot par mot</b> : tapez chaque mot en bleu au moment exact où il est prononcé.',
      guideCut: 'Tapez chaque phrase (<span class="kbd">Espace</span>) et tapez <span class="kbd">Tab</span> pour chaque sous-coupe interne.',
      guideHold: ' Maintenez appuyé et relâchez pour fixer la fin précise.',
      doneAll: 'Synchro au Tap enregistrée',
      exactNote: 'Exact',
      vocalSnapNote: 'Voix',
      beatSnapNote: 'BPM',
      endSetNote: 'Fin fixée',
    };
  }
  if (lang === 'en') {
    return {
      btn: '⏱ Tap Sync',
      title: '⏱ Studio Tap Sync',
      mode: 'Mode',
      mLine: 'Line by Line',
      mWord: 'Word by Word (Precise)',
      mCut: 'Lines + Sub-Cuts [Tab]',
      rate: 'Speed',
      snap: 'Snap',
      sVocal: 'Vocal Onset (±90ms)',
      sBeat: 'Beat Grid (BPM)',
      sFree: 'Free (exact ms)',
      latency: 'Latency',
      autoMicro: 'Micro-align words (Vocal)',
      microBtn: '✨ Micro-align line',
      holdEnd: 'Hold = Mark End [E]',
      count: '3·2·1 Count',
      click: 'Metronome Click',
      vocal: 'Vocal',
      precisionPrefix: 'Precision',
      perfectHit: 'Spot on',
      earlyHit: 'Early',
      lateHit: 'Late',
      loopLine: '🔁 Loop Line',
      assistRest: '⚡ Auto-Finish Vocal',
      coherenceLbl: 'Coordination',
      syncedWords: 'words synced',
      tapBtn: 'TAP [Space]',
      tapWordBtn: 'TAP WORD [Space]',
      markEnd: '⏹ End [E]',
      pause: '⏸ Pause [P]',
      play: '▶ Play [P]',
      rew: '⟲ -2s',
      back: '↶ Undo Tap',
      skip: '⏭ Skip [S]',
      stop: '✓ Finish',
      guideLine: 'Press <span class="kbd">Space</span> or <b>TAP</b> right when the singer starts the active line.',
      guideWord: '<b>Word-by-word</b> mode: tap each highlighted word at its exact vocal onset.',
      guideCut: 'Tap each line start (<span class="kbd">Space</span>) and press <span class="kbd">Tab</span> for internal cuts.',
      guideHold: ' Hold and release to capture exact end timestamp.',
      doneAll: 'Tap Sync saved',
      exactNote: 'Exact',
      vocalSnapNote: 'Vocal',
      beatSnapNote: 'BPM',
      endSetNote: 'End set',
    };
  }
  if (lang === 'zh-Hant' || lang === 'zh-Hans' || lang.startsWith('zh')) {
    return {
      btn: '⏱ 節拍點擊同步',
      title: '⏱ 專業點擊對軌同步',
      mode: '模式',
      mLine: '逐行同步',
      mWord: '逐詞精準同步',
      mCut: '行 + 切分鏡頭 [Tab]',
      rate: '速度',
      snap: '對齊',
      sVocal: '人聲起音 (±90ms)',
      sBeat: '節拍網格 (BPM)',
      sFree: '自由毫秒',
      latency: '延遲補償',
      autoMicro: '人聲逐詞微對齊',
      microBtn: '✨ 微對齊本句',
      holdEnd: '按住設定結束 [E]',
      count: '倒數 3·2·1',
      click: '節拍器音效',
      vocal: '人聲',
      precisionPrefix: '精準度',
      perfectHit: '極準',
      earlyHit: '偏早',
      lateHit: '偏晚',
      loopLine: '🔁 單句循環',
      assistRest: '⚡ AI 自動對齊後續',
      coherenceLbl: '人聲協調度',
      syncedWords: '詞已對齊',
      tapBtn: '點擊 TAP [Space]',
      tapWordBtn: '點擊詞彙 [Space]',
      markEnd: '⏹ 結束 [E]',
      pause: '⏸ 暫停 [P]',
      play: '▶ 播放 [P]',
      rew: '⟲ -2s',
      back: '↶ 退回一步',
      skip: '⏭ 跳過 [S]',
      stop: '✓ 完成',
      guideLine: '聽到歌手開口唱出目前歌詞時，立即按下 <span class="kbd">Space</span> 或 <b>TAP</b>。',
      guideWord: '<b>逐詞模式</b>：請依序在每個藍色標記詞彙發音起點點擊。',
      guideCut: '用 <span class="kbd">Space</span> 標記行首，用 <span class="kbd">Tab</span> 標記行內切分點。',
      guideHold: ' 按住並放開可精準記錄結束時間。',
      doneAll: '已完成點擊同步',
      exactNote: '精準',
      vocalSnapNote: '人聲對齊',
      beatSnapNote: '節拍對齊',
      endSetNote: '已設結束',
    };
  }
  return {
    btn: 'タップで同期',
    title: '⏱ スタジオ・タップ同期',
    mode: 'モード',
    mLine: '行ごと（フレーズ）',
    mWord: '単語ごと（高精度）',
    mCut: '行＋カット区切り [Tab]',
    rate: '再生速度',
    snap: 'スナップ',
    sVocal: 'ボーカル発音 (±90ms)',
    sBeat: '拍グリッド (BPM)',
    sFree: 'フリー (ms単位)',
    latency: '遅延補正',
    autoMicro: '単語を声に自動微調整',
    microBtn: '✨ 行内の単語を自動整列',
    holdEnd: '長押し＝終了 [E]',
    count: '3·2·1 カウント',
    click: 'クリック音',
    vocal: '声量',
    precisionPrefix: '精度',
    perfectHit: '完璧',
    earlyHit: '早め',
    lateHit: '遅め',
    loopLine: '🔁 この行をループ',
    assistRest: '⚡ 残りをAI声頭自動同期',
    coherenceLbl: '一致度',
    syncedWords: '語同期済',
    tapBtn: 'TAP [Space]',
    tapWordBtn: '単語TAP [Space]',
    markEnd: '⏹ 終了 [E]',
    pause: '⏸ 一時停止 [P]',
    play: '▶ 再生 [P]',
    rew: '⟲ -2秒',
    back: '↶ 1つ戻る',
    skip: '⏭ スキップ [S]',
    stop: '✓ 完了',
    guideLine: '歌い出しに合わせて <span class="kbd">Space</span> または <b>TAP</b> を押してください。',
    guideWord: '<b>単語ごとモード</b>：青い単語の発音頭に合わせて順番にタップします。',
    guideCut: '行の頭を <span class="kbd">Space</span>、途中のカットを <span class="kbd">Tab</span> で合わせます。',
    guideHold: ' 押したまま離すと正確な終了時刻を記録します。',
    doneAll: 'タップ同期を反映しました',
    exactNote: '直接記録',
    vocalSnapNote: '声頭補正',
    beatSnapNote: '拍補正',
    endSetNote: '終了記録',
  };
}
function applyTapLabels() {
  const c = tapCopy();
  const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  if (!($('btnTap') && $('btnTap').dataset.keepCustom)) {
    const cleanTapLabel = String(c.btn || '').replace(/^⏱\s*/, '');
    setT($('btnTapLbl') ? 'btnTapLbl' : 'btnTap', cleanTapLabel);
  }
  setT('tapTitle', c.title);
  setT('lblTapMode', c.mode);
  setT('lblTapRate', c.rate);
  setT('lblTapSnap', c.snap);
  setT('lblTapLatency', c.latency);
  setT('lblTapAutoMicro', c.autoMicro);
  setT('tapMicroAlign', c.microBtn);
  setT('tapLoopLine', c.loopLine);
  setT('tapAssistRest', c.assistRest);
  setT('lblTapHoldEnd', c.holdEnd);
  setT('lblTapCount', c.count);
  setT('lblTapClick', c.click);
  setT('lblTapVocal', c.vocal);
  setT('tapMarkEnd', c.markEnd);
  setT('tapRewind', c.rew);
  setT('tapBack', c.back);
  setT('tapSkip', c.skip);
  setT('tapStop', c.stop);
  const mSel = $('tapMode');
  if (mSel && mSel.options.length >= 3) {
    mSel.options[0].textContent = c.mLine;
    mSel.options[1].textContent = c.mWord;
    mSel.options[2].textContent = c.mCut;
  }
  const sSel = $('tapSnapMode');
  if (sSel && sSel.options.length >= 3) {
    sSel.options[0].textContent = c.sVocal;
    sSel.options[1].textContent = c.sBeat;
    sSel.options[2].textContent = c.sFree;
  }
  syncTapTransportBtn();
}
function syncTapTransportBtn() {
  const btn = $('tapPlayPause');
  if (!btn) return;
  const c = tapCopy();
  btn.textContent = S.playing ? c.pause : c.play;
}
function playTapClick(accent = false) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!AP.ctx) AP.ctx = new AudioCtx();
    if (AP.ctx.state === 'suspended' && AP.ctx.resume) AP.ctx.resume();
    if (typeof AP.ctx.createOscillator !== 'function' || typeof AP.ctx.createGain !== 'function') return;
    const now = AP.ctx.currentTime || 0;
    const osc = AP.ctx.createOscillator();
    const g = AP.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = accent ? 980 : 720;
    const peak = AP.muted ? 0 : Math.min(0.25, 0.14 * (AP.vol || 0.8));
    if (g.gain && typeof g.gain.setValueAtTime === 'function') {
      g.gain.setValueAtTime(Math.max(0.0001, peak), now);
      if (typeof g.gain.exponentialRampToValueAtTime === 'function') {
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
      }
    }
    osc.connect(g);
    g.connect(AP.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.036);
  } catch (e) {}
}
function tapOpts() {
  let o = null;
  try { o = JSON.parse(localStorage.getItem('jizura.tapOpts') || 'null'); } catch (e) {}
  let learned = 45;
  try {
    const lv = Number(localStorage.getItem('jizura.tapLearnedMs'));
    if (Number.isFinite(lv) && lv >= -60 && lv <= 180) learned = Math.round(lv);
  } catch (e) {}
  const mode = o && ['line', 'word', 'cut'].includes(o.mode) ? o.mode : 'line';
  const rate = o && [1, 0.85, 0.75, 0.5].includes(+o.rate) ? +o.rate : 1;
  const snapMode = o && ['vocal', 'beat', 'free'].includes(o.snapMode) ? o.snapMode : 'vocal';
  const rawLat = o && o.latencyRaw != null ? String(o.latencyRaw) : (o && o.latencyMs != null ? String(o.latencyMs) : 'auto');
  const latencyMode = ['auto', '0', '45', '75', '110', '-30'].includes(rawLat) ? rawLat : 'auto';
  const latencyMs = latencyMode === 'auto' ? learned : (Number(latencyMode) || 0);
  return {
    mode,
    rate,
    snapMode,
    latencyMode,
    latencyMs,
    learnedLatMs: learned,
    autoMicro: o && o.autoMicro === false ? false : true,
    holdEnd: !!(o && o.holdEnd),
    count: !!(o && o.count),
    click: !!(o && o.click),
  };
}
function saveTapOpts() {
  const latVal = $('tapLatency') ? String($('tapLatency').value || 'auto') : 'auto';
  const learned = (S.tap && Number.isFinite(S.tap.learnedLatMs)) ? S.tap.learnedLatMs : 45;
  const payload = {
    mode: $('tapMode') ? $('tapMode').value : 'line',
    rate: $('tapRate') ? (+$('tapRate').value || 1) : 1,
    snapMode: $('tapSnapMode') ? $('tapSnapMode').value : 'vocal',
    latencyRaw: latVal,
    latencyMs: latVal === 'auto' ? learned : (+latVal || 0),
    autoMicro: $('tapAutoMicro') ? !!$('tapAutoMicro').checked : true,
    holdEnd: !!($('tapHoldEnd') && $('tapHoldEnd').checked),
    count: !!($('tapCount') && $('tapCount').checked),
    click: !!($('tapClick') && $('tapClick').checked),
  };
  try { localStorage.setItem('jizura.tapOpts', JSON.stringify(payload)); } catch (e) {}
}
function updateTapCoordBadge() {
  const el = $('tapCoordBadge');
  if (!el || !S.tap) return;
  const c = tapCopy();
  const tap = S.tap;
  const st = tap.stats || { count: 0, proHits: 0, absErrSum: 0, lastDriftMs: null };
  const latTxt = tap.latencyMode === 'auto' ? `Auto ${tap.learnedLatMs}ms` : `${tap.latencyMs}ms`;
  if (!st.count) {
    el.textContent = `${c.precisionPrefix} : ${latTxt}`;
    el.classList.remove('is-pro', 'is-warn');
    return;
  }
  const avgErr = Math.round(st.absErrSum / st.count);
  const lastD = st.lastDriftMs != null ? `${st.lastDriftMs >= 0 ? '+' : ''}${st.lastDriftMs}ms` : '';
  const isPro = avgErr <= 45;
  const isWarn = avgErr > 95;
  el.textContent = `±${avgErr} ms · ${latTxt}` + (lastD ? ` (${lastD})` : '');
  el.classList.toggle('is-pro', isPro);
  el.classList.toggle('is-warn', isWarn);
}
function drawTapRadar(t) {
  const cvs = $('tapRadarCanvas');
  if (!cvs || !S.tap || typeof cvs.getContext !== 'function') return;
  const ctx = cvs.getContext('2d');
  if (!ctx) return;
  const W = cvs.width || 520, H = cvs.height || 68;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  const winBack = 1.1, winAhead = 2.3, span = winBack + winAhead;
  const tMin = t - winBack, tMax = t + winAhead;
  const xOf = (sec) => ((sec - tMin) / span) * W;
  const playX = xOf(t);

  // Beat grid lines
  const beats = S.plan && S.plan.beats;
  if (beats && beats.length) {
    ctx.strokeStyle = 'rgba(148,163,184,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i < beats.length; i++) {
      const b = beats[i];
      if (b < tMin) continue;
      if (b > tMax) break;
      const bx = xOf(b);
      ctx.beginPath(); ctx.moveTo(bx, 0); ctx.lineTo(bx, H); ctx.stroke();
    }
  }

  // Real vocal envelope, pitch voicing band & 10ms attack transients
  if (S.audio && S.audio.vocalEnv100 && S.audio.vocalEnv100.length) {
    const env = S.audio.vocalEnv100;
    const vad = S.audio.voicing100;
    const att = S.audio.wordAttack100;
    const fr = S.audio.fineRate || 100;
    let peakE = 0.05;
    const f0 = Math.max(0, Math.floor(Math.max(0, tMin) * fr));
    const f1 = Math.min(env.length - 1, Math.ceil(tMax * fr));
    for (let f = f0; f <= f1; f++) if (env[f] > peakE) peakE = env[f];

    // Voicing / singing presence floor band
    if (vad && vad.length) {
      ctx.fillStyle = 'rgba(16,185,129,0.12)';
      for (let f = f0; f <= f1; f++) {
        if (vad[f] >= 0.42) {
          const px = xOf(f / fr);
          ctx.fillRect(px, H - 6, Math.max(2, W / ((span * fr) + 1) + 0.5), 4);
        }
      }
    }

    // Vocal envelope ribbon
    ctx.fillStyle = 'rgba(56,189,248,0.22)';
    ctx.beginPath();
    ctx.moveTo(Math.max(0, xOf(f0 / fr)), H);
    for (let f = f0; f <= f1; f++) {
      const px = xOf(f / fr);
      const py = H - 8 - (env[f] / peakE) * (H * 0.54);
      ctx.lineTo(px, py);
    }
    ctx.lineTo(Math.min(W, xOf(f1 / fr)), H);
    ctx.closePath();
    ctx.fill();

    // Attack spikes
    if (att && att.length) {
      ctx.strokeStyle = 'rgba(52,211,153,0.82)';
      ctx.lineWidth = 1.5;
      for (let f = f0; f <= f1; f++) {
        if (att[f] > 0.14) {
          const px = xOf(f / fr);
          const sh = Math.min(H - 12, att[f] * (H * 0.85));
          ctx.beginPath(); ctx.moveTo(px, H - 4); ctx.lineTo(px, H - 4 - sh); ctx.stroke();
        }
      }
    }
  }

  // Upcoming words scrolling toward the playhead target line + active target cue
  const L = (S.plan && S.plan.lines) || [];
  const tap = S.tap;
  let targetWordStart = null;
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  for (let li = Math.max(0, tap.i - 1); li < Math.min(L.length, tap.i + 3); li++) {
    const ln = L[li];
    if (!ln || ln.interlude || ln.end < tMin || ln.start > tMax) continue;
    const words = Array.isArray(ln.wordsTimed) && ln.wordsTimed.length ? ln.wordsTimed : [];
    for (let wi = 0; wi < words.length; wi++) {
      const w = words[wi];
      const isCurTarget = (tap.mode === 'word' && li === tap.i && wi === tap.wi) || (tap.mode !== 'word' && li === tap.i && wi === 0);
      if (isCurTarget) targetWordStart = w.start;
      if (w.end < tMin || w.start > tMax) continue;
      const wx = xOf(w.start);
      const ww = Math.max(14, xOf(w.end) - wx);
      ctx.fillStyle = isCurTarget ? 'rgba(56,189,248,0.92)' : (w.validated ? 'rgba(16,185,129,0.62)' : 'rgba(148,163,184,0.28)');
      ctx.fillRect(wx, 5, Math.min(ww, W - wx), 16);
      if (isCurTarget) {
        ctx.strokeStyle = '#bae6fd';
        ctx.lineWidth = 1;
        ctx.strokeRect(wx, 5, Math.min(ww, W - wx), 16);
      }
      ctx.fillStyle = isCurTarget ? '#082f49' : '#e2e8f0';
      ctx.fillText(w.text.slice(0, 12), wx + 3, 7, Math.max(10, ww - 4));
    }
  }

  // Conductor approach cue when next target word nears playhead (<= 0.85s)
  if (targetWordStart != null) {
    const diff = targetWordStart - t;
    if (diff >= -0.06 && diff <= 0.85) {
      const inHitZone = Math.abs(diff) <= 0.055;
      const rad = Math.max(4, Math.abs(diff) * 26);
      ctx.strokeStyle = inHitZone ? '#34d399' : 'rgba(56,189,248,0.85)';
      ctx.lineWidth = inHitZone ? 2 : 1.5;
      ctx.beginPath();
      ctx.moveTo(playX - rad, 24); ctx.lineTo(playX - rad, H - 14);
      ctx.moveTo(playX + rad, 24); ctx.lineTo(playX + rad, H - 14);
      ctx.stroke();
      if (inHitZone) {
        ctx.fillStyle = '#34d399';
        ctx.font = '700 9px monospace';
        ctx.fillText('TAP!', Math.max(4, playX - 28), H - 13);
      }
    }
  }

  // Center playhead cursor + recent hit flash
  const hitAge = tap.stats && tap.stats.lastHitAt ? (performance.now() - tap.stats.lastHitAt) : 999;
  const hitGlow = hitAge < 180;
  ctx.strokeStyle = hitGlow ? '#34d399' : '#f43f5e';
  ctx.lineWidth = hitGlow ? 3 : 2;
  ctx.beginPath(); ctx.moveTo(playX, 0); ctx.lineTo(playX, H); ctx.stroke();
  ctx.fillStyle = hitGlow ? '#34d399' : '#f43f5e';
  ctx.font = '700 9px monospace';
  ctx.fillText('ICI', Math.min(W - 22, playX + 4), H - 13);
}
function refineTapTime(rawT, minBound = 0) {
  const tap = S.tap;
  const latSec = tap ? ((tap.latencyMode === 'auto' ? tap.learnedLatMs : tap.latencyMs) || 0) / 1000 : 0;
  const snapMode = tap ? tap.snapMode : 'free';
  const c = tapCopy();
  const base = Math.max(minBound, rawT - latSec);
  const atk = J.estimateVocalAttackNear
    ? J.estimateVocalAttackNear(S.audio, rawT, 0.22, minBound)
    : { found: false, attackTime: +base.toFixed(3), driftMs: 0 };

  // Record adaptive reaction EMA calibration whenever vocal attack exists
  if (tap && tap.stats) {
    const rawDrift = atk.found ? atk.driftMs : Math.round(latSec * 1000);
    if (atk.found && tap.latencyMode === 'auto' && Math.abs(rawDrift) <= 185) {
      tap.learnedLatMs = Math.round(J.clamp(0.68 * tap.learnedLatMs + 0.32 * rawDrift, -60, 180));
      tap.latencyMs = tap.learnedLatMs;
      try { localStorage.setItem('jizura.tapLearnedMs', String(tap.learnedLatMs)); } catch (e) {}
    }
    const residualErr = atk.found ? Math.round((base - atk.attackTime) * 1000) : 0;
    tap.stats.count++;
    tap.stats.absErrSum += Math.abs(residualErr);
    if (Math.abs(residualErr) <= 45) tap.stats.proHits++;
    tap.stats.lastDriftMs = residualErr;
    tap.stats.lastHitAt = performance.now();
    updateTapCoordBadge();
  }

  if (snapMode === 'vocal' && S.audio && S.audio.wordAttack100 && S.audio.wordAttack100.length) {
    const fr = S.audio.fineRate || 100;
    const att = S.audio.wordAttack100;
    const env = S.audio.vocalEnv100;
    const idx0 = Math.max(0, Math.floor((Math.max(minBound, base - 0.095)) * fr));
    const idx1 = Math.min(att.length - 1, Math.ceil((base + 0.095) * fr));
    let bestT = base, bestScore = -1;
    for (let f = idx0; f <= idx1; f++) {
      const ft = f / fr;
      if (ft < minBound) continue;
      const distPen = 1 - 0.25 * (Math.abs(ft - base) / 0.095);
      const eBoost = env && env[f] ? (1 + Math.min(1, env[f] * 3) * 0.35) : 1;
      const score = att[f] * eBoost * distPen;
      if (score > bestScore) { bestScore = score; bestT = ft; }
    }
    if (bestScore > 0.025) {
      const snapped = +Math.max(minBound, bestT).toFixed(3);
      const dm = Math.round((snapped - rawT) * 1000);
      return { t: snapped, deltaMs: dm, note: `✓ ${c.vocalSnapNote} (${dm >= 0 ? '+' : ''}${dm}ms)` };
    }
  } else if (snapMode === 'beat' && S.plan && S.plan.beats && S.plan.beats.length) {
    let bestB = null, bestD = 0.16;
    for (const b of S.plan.beats) {
      if (b < minBound) continue;
      const d = Math.abs(b - base);
      if (d < bestD) { bestD = d; bestB = b; }
      if (b > base + 0.2) break;
    }
    if (bestB != null) {
      const snapped = +bestB.toFixed(3);
      const dm = Math.round((snapped - rawT) * 1000);
      return { t: snapped, deltaMs: dm, note: `♪ ${c.beatSnapNote} (${dm >= 0 ? '+' : ''}${dm}ms)` };
    }
  }
  const exact = +base.toFixed(3);
  const dm = Math.round((exact - rawT) * 1000);
  return { t: exact, deltaMs: dm, note: `${c.exactNote} (${dm >= 0 ? '+' : ''}${dm}ms)` };
}
function microAlignTapPhrase(targetLi = null) {
  if (!S.project || !S.plan || !S.plan.lines) return false;
  const L = S.plan.lines;
  const li = targetLi != null ? targetLi : (S.tap ? J.clamp(S.tap.i | 0, 0, L.length - 1) : 0);
  const ln = L[li];
  if (!ln || ln.interlude || !S.audio || !(J.optimizeLineVocalCoordination || J.alignLineWordsAnchored)) return false;
  ensureTimingMaps();
  const words = getEditableWords(li);
  if (!words.length) return false;
  const LT = S.project.timing.lineTimes;
  const LE = S.project.timing.lineEnds;
  const startT = LT[li] != null ? LT[li] : ln.start;
  const nextStart = li + 1 < L.length && LT[li + 1] != null ? LT[li + 1] - 0.03 : ln.end;
  const endT = LE[li] != null ? LE[li] : Math.max(startT + 0.25, Math.min(ln.visEnd || ln.end, nextStart));
  const spk = (ln.meta && ln.meta.speaker) || 'Lead';
  const langCode = ln.language || (J.resolveLang ? J.resolveLang(S.project) : 'auto');
  const aligned = J.optimizeLineVocalCoordination
    ? J.optimizeLineVocalCoordination(S.audio, words, startT, endT, langCode, spk)
    : J.alignLineWordsAnchored(S.audio, words, startT, endT, langCode, spk);
  S.project.timing.wordTimes[li] = aligned;
  replan();
  if (S.tap) updateTap();
  const c = tapCopy();
  if ($('tapSnapNote')) $('tapSnapNote').textContent = `✨ ${c.vocalSnapNote} (${words.length} mots)`;
  return true;
}
function shiftTapPhraseWords(deltaMs, targetLi = null) {
  if (!S.project || !S.plan || !S.plan.lines) return false;
  const L = S.plan.lines;
  const li = targetLi != null ? targetLi : (S.tap ? J.clamp(S.tap.i | 0, 0, L.length - 1) : 0);
  const ln = L[li];
  if (!ln || ln.interlude) return false;
  ensureTimingMaps();
  const words = getEditableWords(li);
  if (!words.length) return false;
  const dSec = (Number(deltaMs) || 0) / 1000;
  let shifted = 0;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w.validated) continue;
    const minS = i > 0 ? words[i - 1].start + 0.035 : 0;
    const nextW = i + 1 < words.length && words[i + 1].validated ? words[i + 1].start - 0.01 : Infinity;
    const dur = Math.max(0.06, (w.end || 0) - (w.start || 0));
    const ns = +J.clamp(w.start + dSec, minS, Math.max(minS, nextW - dur)).toFixed(3);
    const ne = +Math.min(nextW, Math.max(ns + 0.04, ns + dur)).toFixed(3);
    w.start = ns;
    w.end = ne;
    rescaleWordChars(w, ns, ne);
    shifted++;
  }
  S.project.timing.wordTimes[li] = words;
  replan();
  if (S.tap) updateTap();
  if ($('tapSnapNote')) $('tapSnapNote').textContent = `↔ ${deltaMs > 0 ? '+' : ''}${deltaMs}ms (${shifted})`;
  return shifted > 0;
}
function toggleTapLoop(force = null) {
  if (!S.tap) return false;
  S.tap.loopLine = force != null ? !!force : !S.tap.loopLine;
  const btn = $('tapLoopLine');
  if (btn) btn.setAttribute('aria-pressed', String(S.tap.loopLine));
  return S.tap.loopLine;
}
async function assistRemainingTapLines() {
  if (!S.project || !S.plan || !Array.isArray(S.plan.lines)) return { linesUpdated: 0 };
  const lang = (document.documentElement.lang || 'fr').toLowerCase();
  if (!S.audio || !(S.audio.vocalEnv100 && S.audio.vocalEnv100.length)) {
    toast(lang === 'fr' ? 'Chargez un fichier audio pour l’auto-calage IA.' : 'Load an audio file first.');
    return { linesUpdated: 0 };
  }
  pushEdit();
  ensureTimingMaps();
  const L = S.plan.lines;
  const startIdx = S.tap ? J.clamp(S.tap.i | 0, 0, Math.max(0, L.length - 1)) : 0;
  const globalLang = J.resolveLang ? J.resolveLang(S.project) : 'auto';
  const LT = S.project.timing.lineTimes;
  const LE = S.project.timing.lineEnds;

  if (J.aiAlignVocals) {
    const aligned = await J.aiAlignVocals(S.audio, L, globalLang);
    const times = (aligned && aligned.lineTimes) || aligned || {};
    for (let i = startIdx; i < L.length; i++) {
      if (LT[i] == null && times[i] != null) LT[i] = times[i];
    }
  }
  let linesUpdated = 0;
  for (let i = startIdx; i < L.length; i++) {
    const ln = L[i];
    if (!ln || ln.interlude || !ln.text) continue;
    const words = getEditableWords(i);
    if (!words.length) continue;
    const s = LT[i] != null ? LT[i] : ln.start;
    const nextS = i + 1 < L.length && LT[i + 1] != null ? LT[i + 1] - 0.03 : ln.end;
    const e = LE[i] != null ? LE[i] : Math.max(s + 0.25, Math.min(ln.visEnd || ln.end, nextS));
    const spk = (ln.meta && ln.meta.speaker) || 'Lead';
    S.project.timing.wordTimes[i] = J.optimizeLineVocalCoordination
      ? J.optimizeLineVocalCoordination(S.audio, words, s, e, ln.language || globalLang, spk)
      : J.alignLineWordsAnchored(S.audio, words, s, e, ln.language || globalLang, spk);
    linesUpdated++;
  }
  replan();
  if (S.tap) updateTap();
  syncLyricsEditor();
  syncQualityControlPanel();
  flushSave();
  recordWork('tap_assist_rest', 'sync', `${linesUpdated} phrases alignées par IA vocale`);
  toast(lang === 'fr'
    ? `⚡ ${linesUpdated} phrase(s) restante(s) synchronisée(s) mot par mot sur la voix !`
    : `⚡ ${linesUpdated} remaining line(s) synchronized word-by-word with vocals!`);
  return { linesUpdated };
}
function tapTotalSteps(mode) {
  const L = (S.plan && S.plan.lines) || [];
  if (mode !== 'word') return L.length;
  let total = 0;
  for (let i = 0; i < L.length; i++) {
    total += L[i].interlude ? 1 : Math.max(1, getEditableWords(i).length);
  }
  return total;
}
function tapDoneSteps(mode, curLi, curWi) {
  const L = (S.plan && S.plan.lines) || [];
  if (mode !== 'word') return Math.min(L.length, Math.max(0, curLi));
  let n = 0;
  for (let i = 0; i < Math.min(L.length, curLi); i++) {
    n += L[i].interlude ? 1 : Math.max(1, getEditableWords(i).length);
  }
  return n + (curLi < L.length ? Math.max(0, curWi) : 0);
}
function updateTapTelemetry(t) {
  if (!S.tap) return;
  if (S.tap.loopLine && S.playing && S.plan && S.plan.lines) {
    const ln = S.plan.lines[S.tap.i];
    if (ln) {
      const loopLo = Math.max(0, ln.start - 0.45);
      const loopHi = Math.min(Math.max(loopLo + 0.5, ln.end + 0.28), Math.max(0.5, (S.plan.duration || 10) - 0.04));
      if (t >= loopHi || t < loopLo - 0.65) {
        seek(loopLo);
        return;
      }
    }
  }
  if ($('tapTimeNow')) $('tapTimeNow').textContent = J.fmtTime(t);
  drawTapRadar(t);
  const fill = $('tapVocalFill');
  if (fill) {
    let pct = 0;
    if (S.audio && S.audio.vocalEnv100 && S.audio.vocalEnv100.length) {
      const fr = S.audio.fineRate || 100;
      const center = J.clamp(Math.round(t * fr), 0, S.audio.vocalEnv100.length - 1);
      let peak = 0;
      for (let f = Math.max(0, center - 2); f <= Math.min(S.audio.vocalEnv100.length - 1, center + 2); f++) {
        if (S.audio.vocalEnv100[f] > peak) peak = S.audio.vocalEnv100[f];
      }
      pct = Math.round(J.clamp(peak * 260, 0, 100));
    }
    fill.style.width = pct + '%';
  }
  const dot = $('tapBeatDot');
  if (dot) {
    let bIdx = -1, sinceBeat = 9;
    const beats = S.plan && S.plan.beats;
    if (beats && beats.length) {
      for (let i = 0; i < beats.length; i++) {
        if (beats[i] <= t + 0.01) { bIdx = i; sinceBeat = t - beats[i]; }
        else break;
      }
    } else {
      const bpm = (S.project.timing && S.project.timing.bpm > 0 ? S.project.timing.bpm : (S.audio && S.audio.bpm)) || 120;
      const period = 60 / bpm;
      bIdx = Math.floor(t / period);
      sinceBeat = t - bIdx * period;
    }
    dot.classList.toggle('is-pulse', sinceBeat >= -0.01 && sinceBeat < 0.11);
    if (S.playing && !S.tap.counting && bIdx >= 0 && bIdx !== S.tap.lastBeatIdx) {
      S.tap.lastBeatIdx = bIdx;
      if (S.tap.click) playTapClick(bIdx % 4 === 0);
    }
  }
}
// start from any line: playback begins a little before that line, earlier lines keep their times
function startTap(from = 0, wordFrom = 0) {
  const isFr = document.documentElement.lang === 'fr';
  const isEn = document.documentElement.lang === 'en';
  if (S.syncTask) {
    toast(isFr
      ? 'Synchronisation IA en cours : patientez un instant avant d’ouvrir le Tap Studio.'
      : isEn
      ? 'AI sync is currently running — please wait a moment before opening Tap Studio.'
      : 'AI 同步進行中，請稍候再開啟點擊對拍。');
    return;
  }
  if (!S.plan || !S.plan.lines.length) {
    toast(isFr
      ? 'Ajoutez d’abord au moins une ligne de paroles pour utiliser Synchro au Tap.'
      : isEn
      ? 'Add at least one lyric line first to use Tap Sync.'
      : '請先輸入至少一行歌詞再使用點擊對拍。');
    if ($('lyrics')) $('lyrics').focus();
    return;
  }
  from = J.clamp(from | 0, 0, S.plan.lines.length - 1);
  pushEdit();
  ensureTimingMaps();
  const opt = tapOpts();
  const firstWords = opt.mode === 'word' && !S.plan.lines[from].interlude ? getEditableWords(from) : [];
  const wi0 = firstWords.length ? J.clamp(wordFrom | 0, 0, firstWords.length - 1) : 0;
  S.tap = {
    i: from,
    wi: wi0,
    from,
    mode: opt.mode,
    rate: opt.rate,
    snapMode: opt.snapMode,
    latencyMode: opt.latencyMode,
    latencyMs: opt.latencyMs,
    learnedLatMs: opt.learnedLatMs,
    autoMicro: opt.autoMicro,
    holdEnd: opt.holdEnd,
    count: opt.count,
    click: opt.click,
    loopLine: false,
    done: [],
    holding: null,
    finishOnRelease: false,
    lastBeatIdx: -1,
    stats: { count: 0, proHits: 0, absErrSum: 0, lastDriftMs: null, lastHitAt: 0 },
  };
  applyTapLabels();
  $('tapPanel').hidden = false;
  $('btnTap').setAttribute('aria-pressed', 'true');
  if (typeof syncAiActionButtonsState === 'function') syncAiActionButtonsState();
  $('tapPanel').classList.remove('compact');
  if ($('tapMode')) $('tapMode').value = opt.mode;
  if ($('tapRate')) $('tapRate').value = String(opt.rate);
  if ($('tapSnapMode')) $('tapSnapMode').value = opt.snapMode;
  if ($('tapLatency')) $('tapLatency').value = String(opt.latencyMode);
  if ($('tapAutoMicro')) $('tapAutoMicro').checked = opt.autoMicro;
  if ($('tapHoldEnd')) $('tapHoldEnd').checked = opt.holdEnd;
  if ($('tapCount')) $('tapCount').checked = opt.count;
  if ($('tapClick')) $('tapClick').checked = opt.click;
  if ($('tapLoopLine')) $('tapLoopLine').setAttribute('aria-pressed', 'false');
  if ($('tapSnapNote')) $('tapSnapNote').textContent = '—';
  updateTapCoordBadge();
  const prev = from > 0 ? S.plan.lines[from - 1] : null, cur = S.plan.lines[from];
  const targetStart = (opt.mode === 'word' && firstWords[wi0]) ? firstWords[wi0].start : cur.start;
  const t0 = (from === 0 && wi0 === 0) ? 0 : Math.max(0, prev ? prev.start + 0.01 : 0, targetStart - 2.2);
  pause(); seek(t0); updateTap(); updateTapTelemetry(t0);
  if ($('tapBtn')) $('tapBtn').focus();
  if (from > 0) {
    const isFr = document.documentElement.lang === 'fr';
    const isEn = document.documentElement.lang === 'en';
    toast(isFr
      ? `Synchro au Tap depuis la ligne ${from + 1} (${J.fmtTime(t0)})`
      : isEn
      ? `Tap Sync from line ${from + 1} (${J.fmtTime(t0)})`
      : `${from + 1}行目からタップで同期します（${J.fmtTime(t0)} から再生）`);
  }
  const tap = S.tap;
  if (opt.count) {
    const el = $('tapCountNum'); let n = 3; tap.counting = true;
    const step = () => {
      if (S.tap !== tap) { el.hidden = true; return; }
      if (n === 0) { el.hidden = true; tap.counting = false; play(); return; }
      el.hidden = false; el.textContent = String(n--);
      if (tap.click) playTapClick(true);
      tap.cd = setTimeout(step, 650);
    };
    step();
  } else play();
}
function tapNow() {
  if (!S.tap || S.tap.counting) return;
  const tap = S.tap;
  const L = (S.plan && S.plan.lines) || [];
  if (tap.i >= L.length) { stopTap(); return; }
  ensureTimingMaps();
  const LT = S.project.timing.lineTimes;
  const LE = S.project.timing.lineEnds;
  const btn = $('tapBtn');
  if (btn) {
    btn.classList.add('is-hit');
    setTimeout(() => { if (btn) btn.classList.remove('is-hit'); }, 110);
  }
  const li = tap.i;
  const ln = L[li];
  if (tap.mode === 'word' && !ln.interlude) {
    const words = getEditableWords(li);
    const wi = J.clamp(tap.wi | 0, 0, Math.max(0, words.length - 1));
    if (words.length) {
      const prevEndBound = wi > 0
        ? words[wi - 1].start + 0.04
        : (li > 0 && LT[li - 1] != null ? LT[li - 1] + 0.08 : 0);
      const res = refineTapTime(S.t, prevEndBound);
      if ($('tapSnapNote')) $('tapSnapNote').textContent = res.note;
      tap.done.push({
        kind: 'word',
        li,
        wi,
        hadWords: JSON.parse(JSON.stringify(words)),
        hadLineStart: LT[li],
        hadLineEnd: LE[li],
        hadPrevLineEnd: li > 0 ? LE[li - 1] : undefined,
      });
      const prevDur = Math.max(0.14, (words[wi].end || 0) - (words[wi].start || 0));
      if (wi === 0) {
        LT[li] = res.t;
        if (li > 0 && L[li - 1] && L[li - 1].end > res.t - 0.02) {
          LE[li - 1] = +Math.max(L[li - 1].start + 0.15, res.t - 0.02).toFixed(3);
        }
      } else if (words[wi - 1].end > res.t - 0.005) {
        words[wi - 1].end = +Math.max(words[wi - 1].start + 0.03, res.t - 0.005).toFixed(3);
        rescaleWordChars(words[wi - 1], words[wi - 1].start, words[wi - 1].end);
      }
      words[wi].start = res.t;
      words[wi].end = +Math.max(res.t + 0.08, res.t + prevDur).toFixed(3);
      words[wi].validated = true;
      words[wi].alignmentConfidence = 0.96;
      words[wi].flags = (words[wi].flags || []).filter(f => f !== 'uncertain_boundary');
      rescaleWordChars(words[wi], words[wi].start, words[wi].end);
      // Push later unvalidated words forward cleanly so words stay chronological
      for (let k = wi + 1; k < words.length; k++) {
        if (words[k].start < words[k - 1].end + 0.01) {
          const wDur = Math.max(0.12, (words[k].end || 0) - (words[k].start || 0));
          words[k].start = +(words[k - 1].end + 0.01).toFixed(3);
          words[k].end = +(words[k].start + wDur).toFixed(3);
          rescaleWordChars(words[k], words[k].start, words[k].end);
        }
      }
      S.project.timing.wordTimes[li] = words;
      for (const k of Object.keys(LT)) if (+k > li && LT[k] <= res.t + 0.15) delete LT[k];
      tap.holding = tap.holdEnd ? { kind: 'word', li, wi, start: res.t, wallAt: performance.now() } : null;
      tap.cl = li; tap.ck = 1;
      if (wi + 1 < words.length) {
        tap.wi = wi + 1;
      } else {
        tap.i = li + 1;
        tap.wi = 0;
      }
      replan();
      if (tap.i >= L.length) {
        if (tap.holding) { tap.finishOnRelease = true; updateTap(); }
        else stopTap();
      } else {
        updateTap();
      }
      return;
    }
  }
  // Line-by-line or Lines + Cuts mode (or interlude)
  const minLineStart = li > 0 && LT[li - 1] != null ? LT[li - 1] + 0.08 : 0;
  const res = refineTapTime(S.t, minLineStart);
  if ($('tapSnapNote')) $('tapSnapNote').textContent = res.note;
  tap.done.push({ kind: 'line', i: li, had: LT[li], hadEnd: LE[li] });
  LT[li] = res.t;
  for (const k of Object.keys(LT)) if (+k > li && LT[k] <= res.t + 0.15) delete LT[k];
  // When user taps line li, previous phrase li-1 now has a known end boundary — micro-align its words acoustically!
  if (tap.autoMicro && li > 0 && L[li - 1] && !L[li - 1].interlude && S.audio && J.alignLineWordsAnchored) {
    const prevLn = L[li - 1];
    const pStart = LT[li - 1] != null ? LT[li - 1] : prevLn.start;
    const pEnd = LE[li - 1] != null ? LE[li - 1] : Math.max(pStart + 0.2, res.t - 0.025);
    const prevWords = getEditableWords(li - 1);
    if (prevWords.length) {
      S.project.timing.wordTimes[li - 1] = J.alignLineWordsAnchored(
        S.audio, prevWords, pStart, pEnd, prevLn.language || (J.resolveLang ? J.resolveLang(S.project) : 'auto'),
        (prevLn.meta && prevLn.meta.speaker) || 'Lead'
      );
    }
  }
  tap.holding = tap.holdEnd ? { kind: 'line', li, start: res.t, wallAt: performance.now() } : null;
  tap.i = li + 1;
  tap.wi = 0;
  tap.cl = li;
  tap.ck = 1;
  replan();
  if (tap.i >= L.length) {
    if (tap.holding) { tap.finishOnRelease = true; updateTap(); }
    else stopTap();
  } else {
    updateTap();
  }
}
function tapEndHold(explicit = false) {
  if (!S.tap || S.tap.counting) return;
  const tap = S.tap;
  let target = tap.holding;
  if (!target && explicit) {
    const last = [...tap.done].reverse().find(x => x.kind === 'word' || x.kind === 'line');
    if (last && last.kind === 'word') target = { kind: 'word', li: last.li, wi: last.wi, wallAt: 0 };
    else if (last && last.kind === 'line') target = { kind: 'line', li: last.i, wallAt: 0 };
    else if (tap.i < S.plan.lines.length) {
      target = tap.mode === 'word' ? { kind: 'word', li: tap.i, wi: tap.wi, wallAt: 0 } : { kind: 'line', li: tap.i, wallAt: 0 };
    }
  }
  tap.holding = null;
  if (!target) {
    if (tap.finishOnRelease) stopTap();
    return;
  }
  if (!explicit && target.wallAt && performance.now() - target.wallAt < 75) {
    if (tap.finishOnRelease) stopTap();
    return;
  }
  ensureTimingMaps();
  const L = (S.plan && S.plan.lines) || [];
  const LE = S.project.timing.lineEnds;
  const LT = S.project.timing.lineTimes;
  const c = tapCopy();
  if (target.kind === 'word') {
    const words = getEditableWords(target.li);
    const w = words[target.wi];
    if (w) {
      const endT = J.alignVocalTailEnd ? J.alignVocalTailEnd(S.audio, S.t, w.start) : +Math.max(w.start + 0.05, S.t).toFixed(3);
      w.end = endT;
      w.validated = true;
      w.alignmentConfidence = 0.96;
      rescaleWordChars(w, w.start, endT);
      if (target.wi + 1 < words.length && words[target.wi + 1].start < endT + 0.01 && !words[target.wi + 1].validated) {
        words[target.wi + 1].start = +(endT + 0.01).toFixed(3);
        words[target.wi + 1].end = Math.max(words[target.wi + 1].start + 0.08, words[target.wi + 1].end);
        rescaleWordChars(words[target.wi + 1], words[target.wi + 1].start, words[target.wi + 1].end);
      }
      S.project.timing.wordTimes[target.li] = words;
      if (target.wi === words.length - 1) LE[target.li] = endT;
      if ($('tapSnapNote')) $('tapSnapNote').textContent = `⏹ ${c.endSetNote} ${J.fmtTime(endT)}`;
    }
  } else if (target.kind === 'line') {
    const ln = L[target.li];
    if (ln) {
      const minS = LT[target.li] != null ? LT[target.li] : ln.start;
      const endT = J.alignVocalTailEnd ? J.alignVocalTailEnd(S.audio, S.t, minS + 0.1) : +Math.max(ln.start + 0.15, S.t).toFixed(3);
      if (target.li + 1 < L.length && LT[target.li + 1] == null) {
        LT[target.li + 1] = +Math.max(endT + 0.05, L[target.li + 1].start).toFixed(3);
      }
      LE[target.li] = endT;
      if (tap.autoMicro && !ln.interlude && S.audio && J.alignLineWordsAnchored) {
        const lineWords = getEditableWords(target.li);
        if (lineWords.length) {
          S.project.timing.wordTimes[target.li] = J.alignLineWordsAnchored(
            S.audio, lineWords, minS, endT, ln.language || (J.resolveLang ? J.resolveLang(S.project) : 'auto'),
            (ln.meta && ln.meta.speaker) || 'Lead'
          );
        }
      }
      if ($('tapSnapNote')) $('tapSnapNote').textContent = `⏹ ${c.endSetNote} ${J.fmtTime(endT)}`;
    }
  }
  replan();
  if (tap.finishOnRelease) { stopTap(); return; }
  updateTap();
}
/* Tab during tap sync: the next cut of the line just tapped starts now (a line with several cuts) */
function tapCut() {
  if (!S.tap || S.tap.counting || S.tap.cl == null) return;
  const li = S.tap.cl, k = S.tap.ck | 0, ln = S.plan.lines[li];
  const n = S.plan.cuts.filter(c => c.line === li && J.LAYOUTS[c.layout] && !J.LAYOUTS[c.layout].special).length;
  if (!ln || k < 1 || k >= n) {
    const isFr = document.documentElement.lang === 'fr';
    toast(isFr ? 'Plus aucune coupe disponible sur cette ligne' : 'この行にはこれ以上カットがありません');
    return;
  }
  const cur = S.project.overrides[li] || {}, ct = Object.assign({}, cur.cutTime || {});
  S.tap.done.push({ kind: 'cut', cut: true, li, k, had: ct[k] });
  ct[k] = +Math.max(0, S.t - ln.start).toFixed(3);
  setOv(li, { cutTime: ct });
  S.tap.ck = k + 1;
  replan(); updateTap();
}
function tapSkip() {
  if (!S.tap || S.tap.counting) return;
  const tap = S.tap, L = (S.plan && S.plan.lines) || [];
  if (tap.i >= L.length) { stopTap(); return; }
  tap.done.push({ kind: 'skip', li: tap.i, wi: tap.wi });
  if (tap.mode === 'word' && !L[tap.i].interlude) {
    const words = getEditableWords(tap.i);
    if (tap.wi + 1 < words.length) tap.wi++;
    else { tap.i++; tap.wi = 0; }
  } else {
    tap.i++; tap.wi = 0;
  }
  if (tap.i >= L.length) stopTap(); else updateTap();
}
function tapRewind() {
  if (!S.tap) return;
  seek(Math.max(0, S.t - 2.0));
  if ($('tapBtn')) $('tapBtn').focus();
}
function toggleTapPause() {
  if (!S.tap) return;
  if (S.playing) pause(); else play();
  syncTapTransportBtn();
  if ($('tapBtn')) $('tapBtn').focus();
}
function tapBack() {                    // 1つ戻る: undo the last tap and jump back a little
  if (!S.tap || !S.tap.done.length) return;
  const d = S.tap.done.pop(), LT = S.project.timing.lineTimes, LE = S.project.timing.lineEnds;
  if (d.cut || d.kind === 'cut') {
    const ct = Object.assign({}, (S.project.overrides[d.li] || {}).cutTime || {});
    if (d.had != null) ct[d.k] = d.had; else delete ct[d.k];
    setOv(d.li, { cutTime: Object.keys(ct).length ? ct : undefined });
    S.tap.cl = d.li; S.tap.ck = d.k;
  } else if (d.kind === 'skip') {
    S.tap.i = d.li; S.tap.wi = d.wi || 0;
  } else if (d.kind === 'word') {
    S.project.timing.wordTimes[d.li] = d.hadWords;
    if (d.hadLineStart != null) LT[d.li] = d.hadLineStart; else delete LT[d.li];
    if (d.hadLineEnd != null) LE[d.li] = d.hadLineEnd; else delete LE[d.li];
    if (d.li > 0) {
      if (d.hadPrevLineEnd != null) LE[d.li - 1] = d.hadPrevLineEnd; else delete LE[d.li - 1];
    }
    S.tap.i = d.li; S.tap.wi = d.wi;
  } else {
    if (d.had != null) LT[d.i] = d.had; else delete LT[d.i];
    if (d.hadEnd != null) LE[d.i] = d.hadEnd; else delete LE[d.i];
    S.tap.i = d.i; S.tap.wi = 0;
    const prev = [...S.tap.done].reverse().find(x => x.kind === 'line');
    S.tap.cl = prev ? prev.i : null;
    S.tap.ck = 1 + S.tap.done.filter(x => (x.cut || x.kind === 'cut') && prev && x.li === prev.i).length;
  }
  S.tap.holding = null; S.tap.finishOnRelease = false;
  replan(); updateTap();
  seek(Math.max(0, S.t - 2.5)); if (!S.playing) play();
}
function stopTap() {
  const tap = S.tap;
  const slow = tap && tap.rate !== 1;
  const countDone = tap ? tap.done.filter(x => x.kind !== 'skip').length : 0;
  if (tap && tap.cd) clearTimeout(tap.cd);
  if ($('tapCountNum')) $('tapCountNum').hidden = true;
  S.tap = null;
  if (slow && S.playing) seek(S.t);             // back to normal speed
  $('tapPanel').hidden = true;
  $('btnTap').setAttribute('aria-pressed', 'false');
  if (typeof syncAiActionButtonsState === 'function') syncAiActionButtonsState();
  refreshStage6Validation();
  replan();
  flushSave();
  syncLyricsEditor();
  if (countDone > 0) {
    recordWork('tap_sync', 'sync', `${countDone} calage(s) (${tap ? tap.mode : 'line'})`);
    toast(`${tapCopy().doneAll} (${countDone})`);
  }
}
function updateTap() {
  if (!S.tap || !S.plan) return;
  const tap = S.tap;
  const L = S.plan.lines || [];
  const ln = L[tap.i];
  const prev = tap.i > 0 ? L[tap.i - 1] : null;
  const next = tap.i + 1 < L.length ? L[tap.i + 1] : null;
  const c = tapCopy();
  if ($('tapPrevLine')) $('tapPrevLine').textContent = prev ? `‹ ${prev.interlude ? '[Interlude]' : prev.text}` : '';
  $('tapLine').textContent = ln ? `${tap.i + 1}. ${ln.interlude ? '〔Interlude〕' : ln.text}` : '—';
  if ($('tapNextLine')) $('tapNextLine').textContent = next ? `› ${next.interlude ? '[Interlude]' : next.text}` : '';

  const totalSteps = tapTotalSteps(tap.mode);
  const doneSteps = tapDoneSteps(tap.mode, tap.i, tap.wi);
  if ($('tapProg')) $('tapProg').textContent = `${doneSteps} / ${totalSteps}`;

  const qEl = $('tapWordQueue');
  const cohEl = $('tapLineCoherence');
  const words = (ln && !ln.interlude) ? getEditableWords(tap.i) : [];
  const coh = (words.length && J.analyzeLineVocalCoordination)
    ? J.analyzeLineVocalCoordination(S.audio, words, ln.start, ln.visEnd || ln.end)
    : null;
  if (cohEl) {
    if (coh && coh.total > 0) {
      cohEl.textContent = `${c.coherenceLbl} : ${coh.score}% · ${coh.syncedCount}/${coh.total} ${c.syncedWords}` + (coh.hasAudio ? ` (±${coh.avgAbsErrMs}ms)` : '');
      cohEl.classList.toggle('is-high', coh.score >= 82);
      cohEl.classList.toggle('is-mid', coh.score >= 58 && coh.score < 82);
      cohEl.classList.toggle('is-low', coh.score < 58);
    } else {
      cohEl.textContent = `${c.coherenceLbl} : —`;
      cohEl.classList.remove('is-high', 'is-mid', 'is-low');
    }
  }
  if (qEl) {
    if (ln && !ln.interlude && words.length) {
      qEl.hidden = false;
      qEl.innerHTML = '';
      words.forEach((w, wi) => {
        const wCoh = coh && coh.words ? coh.words[wi] : null;
        const stCls = wCoh
          ? (wCoh.status === 'synced' ? ' is-synced'
            : wCoh.status === 'early' ? ' is-drift-early'
            : wCoh.status === 'late' ? ' is-drift-late'
            : wCoh.status === 'silence' ? ' is-drift-silence' : '')
          : '';
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'tap-w' + (tap.mode === 'word' && wi < tap.wi ? ' is-done' : tap.mode === 'word' && wi === tap.wi ? ' is-target' : '') + stCls;
        chip.textContent = w.text;
        const errHint = wCoh && coh.hasAudio ? ` · ${wCoh.onsetErrorMs >= 0 ? '+' : ''}${wCoh.onsetErrorMs}ms (${wCoh.score}%)` : '';
        chip.title = `${J.fmtTime(w.start)} → ${J.fmtTime(w.end)}${errHint}`;
        chip.addEventListener('click', () => {
          if (tap.mode !== 'word') {
            tap.mode = 'word';
            if ($('tapMode')) $('tapMode').value = 'word';
          }
          tap.wi = wi;
          seek(Math.max(0, w.start - 0.85));
          updateTap();
          if ($('tapBtn')) $('tapBtn').focus();
        });
        qEl.appendChild(chip);
      });
    } else {
      qEl.hidden = true;
      qEl.innerHTML = '';
    }
  }
  const guideEl = $('tapGuideText');
  if (guideEl) {
    let msg = tap.mode === 'word' ? c.guideWord : tap.mode === 'cut' ? c.guideCut : c.guideLine;
    if (tap.holdEnd) msg += c.guideHold;
    guideEl.innerHTML = msg;
  }
  if ($('tapBtn')) $('tapBtn').textContent = tap.mode === 'word' ? c.tapWordBtn : c.tapBtn;
  const bb = $('tapBack'); if (bb) bb.disabled = !tap.done.length;
  syncTapTransportBtn();
  $('tapPanel').classList.toggle('compact', tap.done.length >= 6 && tap.mode !== 'word');
}

/* ---------------- sync all inputs from project ---------------- */
function syncUI() {
  $('songTitle').value = S.project.title || ''; $('songArtist').value = S.project.artist || '';
  $('lyrics').value = S.project.lyrics;
  $('bpm').value = S.project.timing.bpm > 0 ? S.project.timing.bpm : '';
  $('bpm').placeholder = S.audio ? `自動 ${S.audio.bpm}` : 'なし';
  $('offset').value = S.project.timing.offset ?? 0.4;
  $('lineScale').value = S.project.timing.lineScale ?? 1;
  $('snap').checked = !!S.project.timing.snap;
  document.querySelectorAll('.wa-toggle').forEach(el => { el.checked = S.project.wa !== false; });
  document.querySelectorAll('.extra-toggle').forEach(el => { el.checked = S.project.extra === true; });
  for (const set of J.SET_ORDER) document.querySelectorAll('.' + set + '-toggle').forEach(el => { el.checked = J.setOn(S.project, set); });
  document.querySelectorAll('.unify-toggle').forEach(el => { el.checked = S.project.unify === true; });
  document.querySelectorAll('.typeset-toggle').forEach(el => { el.checked = S.project.typeset === true; });
  $('lyricLang').value = J.LANG_LABEL[S.project.lang] ? S.project.lang : 'auto'; langNote();
  document.querySelectorAll('.themeSel').forEach(el => { el.value = J.THEMES[S.project.themeId] ? S.project.themeId : ''; });
  syncThemeMeta();
  syncMainStudioLabels();
  syncKaraokeDeckMeta();
  renderFontRoles(); renderColors(); renderFx(); renderTech(); syncOut(); applyExportLabels(); drawStyleGrid(); syncKaraokeBtn(); syncKaraokeControls(); syncTranslationControls(); syncAudioDetectPanel(); syncAiActionButtonsState(); applyLeLabels(); syncLyricsEditor();
}
function syncThemeMeta() {
  const thId = J.THEMES[S.project.themeId] ? S.project.themeId : '';
  document.querySelectorAll('#easyPanel .theme-row').forEach(row => { row.dataset.theme = thId; });
  const note = $('themeMetaNote'); if (!note) return;
  const lang = document.documentElement.lang || 'fr';
  if (!thId) {
    note.textContent = lang === 'fr'
      ? 'Choisissez un thème pour explorer ses styles fluides et animations dédiées'
      : lang === 'en'
        ? 'Pick a theme to explore its curated fluid styles and dedicated motions'
        : lang === 'zh-Hans'
          ? '选择主题后，将在专属流畅国风/艺术风格库中生成演出'
          : lang === 'zh-Hant'
            ? '選擇主題後，將在專屬流暢國風/藝術風格庫中生成演出'
            : lang === 'ko'
              ? '테마를 선택하면 전용 유려한 스타일과 모션으로 자동 생성합니다'
              : '選ぶと、その方向の中でおまかせします';
    return;
  }
  const T = J.THEMES[thId], cnt = (T.styles && T.styles.length) || 20, cur = J.STYLES[S.project.style];
  const sName = cur ? cur.name : '';
  const hasSong = !!(S.audio && (S.audio.bpm || (S.audio.beats && S.audio.beats.length)));
  const bpmTxt = hasSong && S.audio.bpm ? `${Math.round(S.audio.bpm)} BPM` : '';
  const songTag = hasSong
    ? (lang === 'fr' ? ` · Sync audio${bpmTxt ? ' (' + bpmTxt + ')' : ''}`
      : lang === 'en' ? ` · Song-synced${bpmTxt ? ' (' + bpmTxt + ')' : ''}`
      : lang === 'zh-Hans' ? ` · 节拍同步${bpmTxt ? ' (' + bpmTxt + ')' : ''}`
      : lang === 'zh-Hant' ? ` · 節拍同步${bpmTxt ? ' (' + bpmTxt + ')' : ''}`
      : lang === 'ko' ? ` · 곡 비트 동기화${bpmTxt ? ' (' + bpmTxt + ')' : ''}`
      : ` · 曲と同期${bpmTxt ? ' (' + bpmTxt + ')' : ''}`)
    : '';
  note.textContent = (lang === 'fr'
    ? `${T.name} · ${cnt} styles · Actif : ${sName}`
    : lang === 'en'
      ? `${T.name} · ${cnt} bespoke styles · Active: ${sName}`
      : lang === 'zh-Hans'
        ? `${T.name} · 共${cnt}款专属风格 · 当前：${sName}`
        : lang === 'zh-Hant'
          ? `${T.name} · 共${cnt}款專屬風格 · 目前：${sName}`
          : lang === 'ko'
            ? `${T.name} · 전용 ${cnt}종 스타일 · 현재: ${sName}`
            : `${T.name} · 全${cnt}スタイル · 現在：${sName}`) + songTag;
}

function hideAiVoiceActionBar() {
  const bar = $('aiVoiceActionBar');
  if (bar) { bar.hidden = true; bar.innerHTML = ''; }
}

function showAiVoiceActionBar({
  message = '',
  showRetryCloud = false,
  showLoadAudio = false,
  showAcousticAlign = false,
  applyRecognizedLabel = '',
  onApplyRecognized = null,
  reformulations = [],
  unresolvableProblems = [],
  onApplyReformulations = null,
  onSeekAudio = null,
  onReanalyzeProblem = null,
} = {}) {
  const bar = $('aiVoiceActionBar');
  if (!bar) return;
  const isFr = document.documentElement.lang === 'fr';
  const isEn = document.documentElement.lang === 'en';
  const curLang = ($('lyricLang') && $('lyricLang').value) || 'auto';
  const isAlreadyZh = curLang === 'zh-Hans' || curLang === 'zh-Hant';
  const btnVoiceLabel = isFr ? '🎙️ Reconnaissance vocale en direct (Micro)' : isEn ? '🎙️ Live Voice Recognition (Mic)' : '🎙️ 即時麥克風人聲辨識';
  const btnMandarinLabel = isFr ? '🇨🇳 Voix Mandarin (中文普通话)' : isEn ? '🇨🇳 Mandarin Voice (中文)' : '🇨🇳 普通话实时识词';
  const btnLoadLabel = isFr ? '📁 Choisir une chanson (MP3/WAV)' : isEn ? '📁 Choose Song (MP3/WAV)' : '📁 選擇音樂檔案';
  const btnRetryLabel = isFr ? '🔄 Réessayer IA Cloud' : isEn ? '🔄 Retry Cloud AI' : '🔄 重試雲端 AI';
  const btnSyncLabel = isFr ? '⚡ Caler mes paroles sur la voix' : isEn ? '⚡ Sync my lyrics to vocals' : '⚡ 將現有歌詞對齊人聲';

  const refs = Array.isArray(reformulations) ? reformulations : [];
  const probs = Array.isArray(unresolvableProblems) ? unresolvableProblems : [];
  const fmtSec = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = (s % 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${r}`;
  };

  let diagHtml = '';
  if (refs.length || probs.length) {
    const refTitle = isFr
      ? `🧠 Reformulations IA proposées (${refs.length})`
      : isEn
      ? `🧠 AI Lyric Reformulations (${refs.length})`
      : `🧠 AI 歌詞差異重構建議（${refs.length}）`;
    const probTitle = isFr
      ? `⚠️ Points complexes détectés (${probs.length})`
      : isEn
      ? `⚠️ Complex Sync Issues Detected (${probs.length})`
      : `⚠️ 偵測到的困難同步問題（${probs.length}）`;

    const refCards = refs.map((rf, idx) => `
      <div class="ai-diag-card" data-ref-idx="${idx}">
        <div class="ai-diag-meta">
          <span>#${(rf.lineIdx | 0) + 1} · [${fmtSec(rf.start)} – ${fmtSec(rf.end)}] · ${escapeHtml(rf.differenceSummary || rf.differenceType || '')}</span>
          <span>${Math.round((Number(rf.confidence) || 0.85) * 100)}%</span>
        </div>
        <div class="ai-diag-diff">
          <div class="ai-diag-orig">${escapeHtml(rf.originalText || '')}</div>
          <div class="ai-diag-next">→ ${escapeHtml(rf.reformulatedText || '')}</div>
        </div>
        <div class="ai-diag-actions">
          <button type="button" class="accent js-apply-ref" data-ref-idx="${idx}">${isFr ? '✨ Appliquer' : isEn ? '✨ Apply' : '✨ 套用'}</button>
          <button type="button" class="ghost js-seek-sec" data-sec="${Number(rf.start) || 0}">▶ ${fmtSec(rf.start)}</button>
        </div>
      </div>
    `).join('');

    const probCards = probs.map((pr, idx) => `
      <div class="ai-diag-card ${pr.severity === 'high' ? 'is-high' : 'is-warn'}" data-prob-idx="${idx}">
        <div class="ai-diag-meta">
          <span>${pr.severity === 'high' ? '🔴' : '🟡'} ${escapeHtml(pr.title || '')}</span>
          <span>[${fmtSec(pr.start)} – ${fmtSec(pr.end)}]</span>
        </div>
        <div class="ai-diag-desc">${escapeHtml(pr.description || '')}</div>
        <div class="ai-diag-actions">
          <button type="button" class="ghost js-seek-sec" data-sec="${Number(pr.start) || 0}">▶ ${fmtSec(pr.start)}</button>
          ${pr.actionType === 'reanalyze_segment' ? `<button type="button" class="ghost js-reanalyze-prob" data-prob-idx="${idx}">${isFr ? '🔁 Ré-analyser ce passage' : isEn ? '🔁 Re-analyze clip' : '🔁 重新高精度分析'}</button>` : ''}
          ${pr.actionType === 'mic_dictate' ? `<button type="button" class="ghost js-prob-mic">${isFr ? '🎙️ Dicter au micro' : isEn ? '🎙️ Dictate via Mic' : '🎙️ 麥克風補錄'}</button>` : ''}
        </div>
      </div>
    `).join('');

    diagHtml = `
      <div class="ai-diag-wrap">
        ${refs.length ? `<div class="ai-diag-sec-title"><span>${refTitle}</span></div>${refCards}` : ''}
        ${probs.length ? `<div class="ai-diag-sec-title"><span>${probTitle}</span></div>${probCards}` : ''}
      </div>
    `;
  }

  const applyAllRefLabel = isFr
    ? `✨ Appliquer les ${refs.length} reformulation${refs.length > 1 ? 's' : ''} IA`
    : isEn
    ? `✨ Apply all ${refs.length} AI reformulation${refs.length > 1 ? 's' : ''}`
    : `✨ 一鍵套用全部 ${refs.length} 處 AI 重構`;

  bar.innerHTML = `
    <div class="ai-voice-action-msg">${escapeHtml(message)}</div>
    <div class="ai-voice-action-btns">
      ${refs.length && typeof onApplyReformulations === 'function' ? `<button type="button" id="avbApplyAllRef" class="accent">${escapeHtml(applyAllRefLabel)}</button>` : ''}
      ${applyRecognizedLabel && typeof onApplyRecognized === 'function' ? `<button type="button" id="avbApplyRecognized" class="${refs.length ? 'ghost' : 'accent'}">${escapeHtml(applyRecognizedLabel)}</button>` : ''}
      <button type="button" id="avbStartVoice" class="${(applyRecognizedLabel || refs.length) ? 'ghost' : 'accent'}">${btnVoiceLabel}</button>
      ${!isAlreadyZh ? `<button type="button" id="avbStartMandarinVoice" class="ghost">${btnMandarinLabel}</button>` : ''}
      ${showLoadAudio ? `<button type="button" id="avbLoadAudio" class="ghost">${btnLoadLabel}</button>` : ''}
      ${showRetryCloud ? `<button type="button" id="avbRetryCloud" class="ghost">${btnRetryLabel}</button>` : ''}
      ${showAcousticAlign ? `<button type="button" id="avbAcousticSync" class="ghost">${btnSyncLabel}</button>` : ''}
      <button type="button" id="avbDismiss" class="ghost small" aria-label="Fermer">✕</button>
    </div>
    ${diagHtml}
  `;
  bar.hidden = false;

  const allRefBtn = $('avbApplyAllRef');
  if (allRefBtn && typeof onApplyReformulations === 'function') {
    allRefBtn.addEventListener('click', () => {
      onApplyReformulations(refs);
      if (!probs.length) hideAiVoiceActionBar();
      else {
        allRefBtn.remove();
        bar.querySelectorAll('.ai-diag-card[data-ref-idx]').forEach(el => el.remove());
      }
    });
  }
  bar.querySelectorAll('.js-apply-ref').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-ref-idx') || '-1', 10);
      const item = refs[idx];
      if (!item || typeof onApplyReformulations !== 'function') return;
      onApplyReformulations([item]);
      const card = bar.querySelector(`.ai-diag-card[data-ref-idx="${idx}"]`);
      if (card) card.remove();
      if (!bar.querySelector('.ai-diag-card')) hideAiVoiceActionBar();
    });
  });
  bar.querySelectorAll('.js-seek-sec').forEach(btn => {
    btn.addEventListener('click', () => {
      const sec = parseFloat(btn.getAttribute('data-sec') || '0');
      if (typeof onSeekAudio === 'function') onSeekAudio(sec);
      else seek(sec);
    });
  });
  bar.querySelectorAll('.js-reanalyze-prob').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = parseInt(btn.getAttribute('data-prob-idx') || '-1', 10);
      const pr = probs[idx];
      if (!pr || typeof onReanalyzeProblem !== 'function') return;
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = isFr ? '⏳ Analyse…' : '⏳ Analyzing…';
      try {
        const card = bar.querySelector(`.ai-diag-card[data-prob-idx="${idx}"]`);
        await onReanalyzeProblem(pr, card);
      } finally {
        if (btn.isConnected) {
          btn.disabled = false;
          btn.textContent = orig;
        }
      }
    });
  });
  bar.querySelectorAll('.js-prob-mic').forEach(btn => {
    btn.addEventListener('click', () => { hideAiVoiceActionBar(); startLiveVoiceDictation(); });
  });

  const aBtn = $('avbApplyRecognized');
  if (aBtn && typeof onApplyRecognized === 'function') {
    aBtn.addEventListener('click', () => { hideAiVoiceActionBar(); onApplyRecognized(); });
  }
  const vBtn = $('avbStartVoice');
  if (vBtn) vBtn.addEventListener('click', () => { hideAiVoiceActionBar(); startLiveVoiceDictation(); });
  const mBtn = $('avbStartMandarinVoice');
  if (mBtn) mBtn.addEventListener('click', () => { hideAiVoiceActionBar(); startLiveVoiceDictation('zh-Hans'); });
  const lBtn = $('avbLoadAudio');
  if (lBtn) lBtn.addEventListener('click', () => {
    const fileInput = $('audioFile');
    if (fileInput) {
      const onNext = () => {
        fileInput.removeEventListener('change', onNext);
        const waitAudio = setInterval(() => {
          if (S.audio && S.audio.buffer) {
            clearInterval(waitAudio);
            hideAiVoiceActionBar();
            runAiTranscription();
          }
        }, 200);
        setTimeout(() => clearInterval(waitAudio), 12000);
      };
      fileInput.addEventListener('change', onNext, { once: true });
      fileInput.click();
    }
  });
  const rBtn = $('avbRetryCloud');
  if (rBtn) rBtn.addEventListener('click', () => { hideAiVoiceActionBar(); runAiTranscription(); });
  const sBtn = $('avbAcousticSync');
  if (sBtn) sBtn.addEventListener('click', () => {
    hideAiVoiceActionBar();
    const bvs = $('btnVocalSync');
    if (bvs) bvs.click();
  });
  const dBtn = $('avbDismiss');
  if (dBtn) dBtn.addEventListener('click', () => hideAiVoiceActionBar());
}

let activeVoiceController = null;
function stopLiveVoiceDictation() {
  if (activeVoiceController) {
    try { activeVoiceController.stop(); } catch (e) {}
    activeVoiceController = null;
  }
  const btn = $('btnVoiceDictate');
  if (btn) {
    btn.classList.remove('is-listening');
    btn.setAttribute('aria-pressed', 'false');
  }
  if ($('aiVoiceMeterWrap')) $('aiVoiceMeterWrap').hidden = true;
  if ($('aiVoiceMeterFill')) $('aiVoiceMeterFill').style.width = '0%';
  if ($('aiLiveTranscript')) { $('aiLiveTranscript').hidden = true; $('aiLiveTranscript').innerHTML = ''; }
  if ($('aiProgressBox') && !($('btnAiTranscribe') && $('btnAiTranscribe').classList.contains('is-analyzing'))) {
    $('aiProgressBox').hidden = true;
  }
}

function startLiveVoiceDictation(overrideLang = null) {
  const isFr = document.documentElement.lang === 'fr';
  const isEn = document.documentElement.lang === 'en';
  if (activeVoiceController && activeVoiceController.isActive()) {
    stopLiveVoiceDictation();
    return false;
  }
  if (!J.isVoiceRecognitionSupported || !J.isVoiceRecognitionSupported()) {
    toast(isFr
      ? 'Reconnaissance vocale navigateur indisponible ici (utilisez Chrome / Edge avec micro autorisé).'
      : isEn
      ? 'Browser voice recognition is not supported here (use Chrome / Edge with microphone access).'
      : '此瀏覽器不支援即時麥克風語音辨識（請使用 Chrome / Edge 並開啟麥克風權限）。');
    return false;
  }

  hideAiVoiceActionBar();
  if (overrideLang && $('lyricLang')) {
    $('lyricLang').value = overrideLang;
    if (S.project) S.project.lang = overrideLang;
    if (typeof renderFontRoles === 'function') renderFontRoles();
  }
  const langCode = overrideLang || ($('lyricLang') ? $('lyricLang').value : 'auto');
  const isZhMode = String(langCode || '').toLowerCase().startsWith('zh');
  const locale = J.mapLangToSpeechLocale(langCode);
  const btn = $('btnVoiceDictate');
  const box = $('aiProgressBox');
  const stEl = $('aiProgressStage');
  const pctEl = $('aiProgressPct');
  const fillEl = $('aiProgressFill');
  const meterWrap = $('aiVoiceMeterWrap');
  const meterFill = $('aiVoiceMeterFill');
  const locBadge = $('aiVoiceLocaleBadge');
  const liveBox = $('aiLiveTranscript');

  if (btn) { btn.classList.add('is-listening'); btn.setAttribute('aria-pressed', 'true'); }
  if (box) box.hidden = false;
  if (stEl) {
    stEl.textContent = isZhMode
      ? '🇨🇳 中文普通话实时语音识别中… 请唱歌或说话'
      : isFr
        ? '🎙️ Écoute vocale instantanée active… Chantez ou parlez'
        : isEn
          ? '🎙️ Live voice listening… Sing or speak clearly'
          : '🎙️ 即時人聲辨識中… 請唱歌或說話';
  }
  if (pctEl) pctEl.textContent = 'LIVE';
  if (fillEl) fillEl.style.width = '100%';
  if (meterWrap) meterWrap.hidden = false;
  if (locBadge) locBadge.textContent = locale;
  if (liveBox) {
    liveBox.hidden = false;
    liveBox.innerHTML = `<span class="ai-live-interim">${escapeHtml(isZhMode ? '正在聆听中文语音 / 歌声…' : isFr ? 'En attente de votre voix…' : isEn ? 'Listening for your voice…' : '等待語音輸入…')}</span>`;
  }

  let committedCount = 0;
  let lastCommittedLine = '';
  let sessionStartPlaySec = S.audio && S.playing ? Math.max(0, Number(S.t) || 0) : 0;

  const commitVoicePhrase = ({ text, startSec, endSec, confidence, words: whisperWords }) => {
    const clean = String(text || '').trim();
    if (!clean) return;
    const lyricsEl = $('lyrics');
    const curRaw = String(S.project.lyrics || (lyricsEl ? lyricsEl.value : '') || '').trim();
    const isSample = curRaw === String(J.SAMPLE_LYRICS || '').trim();
    const existingLines = (!curRaw || isSample) ? [] : curRaw.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (isSample) {
      S.project.timing.lineTimes = {};
      S.project.timing.wordTimes = {};
      S.project.timing.lineMeta = {};
    }

    const lineIdx = existingLines.length;
    const prevStart = lineIdx > 0 ? (S.project.timing.lineTimes[lineIdx - 1] ?? 0) : -0.4;
    const realStart = S.audio && S.playing
      ? Math.max(prevStart + 0.35, Number(S.t) || (sessionStartPlaySec + startSec))
      : Math.max(prevStart + 0.35, startSec);
    const estEnd = Math.max(realStart + 0.45, realStart + Math.max(0.8, (endSec - startSec)));

    existingLines.push(clean);
    const nextLyrics = existingLines.join('\n');
    S.project.lyrics = nextLyrics;
    if (lyricsEl) lyricsEl.value = nextLyrics;

    S.project.timing.lineTimes[lineIdx] = +realStart.toFixed(3);
    const hasHanzi = /[\u4e00-\u9fff]/.test(clean);
    const resolvedLang = (langCode && langCode !== 'auto' && langCode !== 'multi')
      ? langCode
      : (hasHanzi ? (/[愛這為無點發頭東會說時聲風夢聽國體]/.test(clean) && !/[爱这为无点发头东会说时声风梦听国体]/.test(clean) ? 'zh-Hant' : 'zh-Hans') : (document.documentElement.lang || 'fr'));
    let words = [];
    if (Array.isArray(whisperWords) && whisperWords.length) {
      const shift = realStart - startSec;
      words = whisperWords.map(w => Object.assign({}, w, {
        start: +Math.max(realStart, (Number(w.start) || startSec) + shift).toFixed(3),
        end: +Math.max(realStart + 0.03, (Number(w.end) || endSec) + shift).toFixed(3),
      }));
    } else if (S.audio && S.audio.buffer && S.playing && J.alignWordsAcoustic) {
      words = J.alignWordsAcoustic(S.audio, clean, realStart, estEnd, resolvedLang, 'Lead', confidence || 0.9);
    } else if (J.tokenizeKaraokeWords) {
      const toks = J.tokenizeKaraokeWords(clean, resolvedLang);
      const weights = toks.map(t => Math.max(1, t.replace(/[^A-Za-zÀ-ÿ0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '').length));
      const sumW = weights.reduce((a, b) => a + b, 0) || toks.length || 1;
      let curT = realStart;
      words = toks.map((tk, ti) => {
        const wDur = (weights[ti] / sumW) * (estEnd - realStart);
        const ws = +curT.toFixed(3);
        curT += wDur;
        const we = ti === toks.length - 1 ? +estEnd.toFixed(3) : +Math.max(ws + 0.04, curT).toFixed(3);
        return { text: tk, start: ws, end: we, recognitionConfidence: confidence || 0.9, alignmentConfidence: 0.88, speaker: 'Lead' };
      });
    }
    if (words.length) S.project.timing.wordTimes[lineIdx] = words;
    S.project.timing.lineMeta = S.project.timing.lineMeta || {};
    S.project.timing.lineMeta[lineIdx] = {
      section: 'verse',
      vocalType: 'singing',
      language: resolvedLang,
      speaker: 'Lead',
      recognitionConfidence: confidence || 0.91,
      alignmentConfidence: 0.88,
    };

    S.project.detection = Object.assign({}, S.project.detection || {}, {
      audioType: 'singing',
      language: resolvedLang,
      detectedLanguages: [resolvedLang],
      source: 'live_voice',
    });

    committedCount++;
    lastCommittedLine = clean;
    if (liveBox) {
      liveBox.innerHTML = `<div>${escapeHtml(clean)}</div><div class="ai-live-interim">${escapeHtml(isFr ? 'Parlez ou chantez la phrase suivante…' : isEn ? 'Sing or speak next line…' : '繼續唱出或說出下一句…')}</div>`;
    }
    replanSoon(50);
    autosave();
  };

  activeVoiceController = J.createLiveVoiceRecognizer({
    lang: langCode,
    getClock: () => (S.audio && S.playing ? Number(S.t) || (performance.now() / 1000) : (performance.now() / 1000)),
    onLevel: (lvl) => {
      if (meterFill) meterFill.style.width = `${Math.round(Math.min(1, lvl) * 100)}%`;
    },
    onInterim: ({ text }) => {
      if (!liveBox) return;
      const topHtml = lastCommittedLine ? `<div>${escapeHtml(lastCommittedLine)}</div>` : '';
      const intText = text || (isFr ? 'Écoute vocale active…' : isEn ? 'Listening…' : '正在聆聽…');
      liveBox.innerHTML = `${topHtml}<div class="ai-live-interim">${escapeHtml(intText)}</div>`;
    },
    onPhrase: (phrase) => commitVoicePhrase(phrase),
    onStatus: (state, info) => {
      if (state === 'listening' && info && info.mode === 'whisper_mic' && stEl) {
        stEl.textContent = isFr ? '🎙️ Studio Whisper Mic actif… Chantez ou parlez' : isEn ? '🎙️ Whisper Studio Mic active… Sing or speak clearly' : '🎙️ Studio Whisper 麥克風即時識詞中…';
      } else if (state === 'denied') {
        stopLiveVoiceDictation();
        toast(isFr ? 'Accès microphone refusé : autorisez le micro dans votre navigateur.' : isEn ? 'Microphone permission denied: allow mic access in browser settings.' : '麥克風權限被拒，請在瀏覽器中允許使用麥克風。');
      } else if (state === 'unsupported') {
        stopLiveVoiceDictation();
        toast(isFr ? 'Reconnaissance vocale navigateur indisponible.' : isEn ? 'Browser speech recognition unavailable.' : '瀏覽器不支援語音辨識。');
      } else if (state === 'stopped' && committedCount > 0) {
        flushSave();
        syncUI();
        recordWork('live_voice', 'sync', `${committedCount} phrase(s)`);
        toast(isFr ? `🎙️ ${committedCount} phrase(s) reconnue(s) et synchronisée(s) !` : isEn ? `🎙️ ${committedCount} phrase(s) recognized and synced!` : `🎙️ 已即時辨識並同步 ${committedCount} 句歌詞！`);
      }
    },
  });

  if (S.audio && !S.playing) {
    sessionStartPlaySec = Math.max(0, Number(S.t) || 0);
  }
  activeVoiceController.start(langCode);
  return true;
}

function toggleLiveVoiceRecognition() {
  if (activeVoiceController && activeVoiceController.isActive()) {
    stopLiveVoiceDictation();
    return false;
  }
  return startLiveVoiceDictation();
}

function syncAiActionButtonsState() {
  const bai = $('btnAiTranscribe');
  const bvs = $('btnVocalSync');
  const btap = $('btnTap');
  const hasAudio = !!(S.audio && S.audio.buffer);
  const rawTxt = String((S.project && S.project.lyrics) || ($('lyrics') && $('lyrics').value) || '').trim();
  const isDefaultSample = rawTxt === String(J.SAMPLE_LYRICS || '').trim();
  const hasRealLyrics = rawTxt.length > 0 && !isDefaultSample && !!(S.plan && S.plan.lines && S.plan.lines.length);
  const activeKind = S.syncTask && S.syncTask.kind ? S.syncTask.kind : null;

  if (bai) {
    const busy = activeKind === 'ai_transcribe';
    bai.classList.toggle('is-analyzing', busy);
    bai.classList.toggle('is-ready', hasAudio && !activeKind);
    bai.disabled = Boolean(activeKind);
    bai.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if (bvs) {
    const busy = activeKind === 'vocal_sync';
    bvs.classList.toggle('is-syncing', busy);
    bvs.classList.toggle('is-ready', hasAudio && hasRealLyrics && !activeKind);
    bvs.disabled = Boolean(activeKind);
    bvs.setAttribute('aria-busy', busy ? 'true' : 'false');
  }
  if (btap) {
    const hasLines = !!(S.plan && S.plan.lines && S.plan.lines.length);
    btap.classList.toggle('is-ready', hasLines && !activeKind);
    btap.setAttribute('aria-pressed', S.tap ? 'true' : 'false');
    btap.disabled = Boolean(activeKind);
  }
}

/* Reusable 7-stage Song Lyrics Detection + Streaming + Forced Alignment + Validation */
async function runAiTranscription(opts = {}) {
  const bai = $('btnAiTranscribe');
  const baiLbl = $('btnAiTranscribeLbl') || bai;
  const isFr = document.documentElement.lang === 'fr';
  const isEn = document.documentElement.lang === 'en';
  if (!S.audio) return false;
  if (S.syncTask) {
    if (!opts.auto) {
      toast(isFr ? 'Une synchronisation est déjà en cours…' : isEn ? 'A synchronization task is already running…' : '同步任務正在執行中…');
    }
    return false;
  }
  if (S.tap) stopTap();
  if (activeVoiceController && activeVoiceController.isActive()) stopLiveVoiceDictation();
  hideAiVoiceActionBar();

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  S.syncTask = { kind: 'ai_transcribe', controller };
  syncAiActionButtonsState();

  const origText = baiLbl ? baiLbl.textContent : '';
  const stageLabels = isFr ? {
    1: '1/7 Prétraitement audio…',
    2: '2/7 Isolation vocale…',
    3: '3/7 Reconnaissance du chant…',
    4: '4/7 Alignement phonétique…',
    5: '5/7 Affinage 10 ms…',
    6: '6/7 Validation paroles…',
    7: '7/7 Sous-titres prêts…',
  } : isEn ? {
    1: '1/7 Preprocessing…',
    2: '2/7 Vocal separation…',
    3: '3/7 Singing recognition…',
    4: '4/7 Forced alignment…',
    5: '5/7 Acoustic refine…',
    6: '6/7 Validation check…',
    7: '7/7 Synced subtitles…',
  } : {
    1: '1/7 音频预处理…',
    2: '2/7 人声分离…',
    3: '3/7 歌声转录…',
    4: '4/7 强制对齐…',
    5: '5/7 声学微调…',
    6: '6/7 歌词校验…',
    7: '7/7 生成同步字幕…',
  };
  const setAiProgress = (stageNum, label) => {
    const box = $('aiProgressBox');
    const stEl = $('aiProgressStage');
    const pctEl = $('aiProgressPct');
    const fillEl = $('aiProgressFill');
    const stepsEl = $('aiProgressSteps');
    const pcts = [12, 26, 44, 62, 78, 90, 100];
    const pct = pcts[Math.max(0, Math.min(6, (stageNum | 0) - 1))] || 12;
    if (box) box.hidden = false;
    if (stEl) stEl.textContent = label || '';
    if (pctEl) pctEl.textContent = pct + '%';
    if (fillEl) fillEl.style.width = pct + '%';
    if (stepsEl) {
      stepsEl.querySelectorAll('span[data-step]').forEach(sp => {
        const n = parseInt(sp.dataset.step, 10) || 0;
        sp.classList.toggle('is-done', n > 0 && n < stageNum);
        sp.classList.toggle('is-cur', n === stageNum);
      });
    }
  };
  let aiDone = false;
  const onStage = (stageNum) => {
    const lbl = stageLabels[stageNum] || `${stageNum}/7`;
    if (baiLbl && stageLabels[stageNum]) baiLbl.textContent = lbl;
    setAiProgress(stageNum, lbl);
    if (stageNum >= 7) aiDone = true;
  };
  const liveBox = $('aiLiveTranscript');
  const onPartialResult = (partial) => {
    if (!partial) return;
    if (partial.stage === 'preview' && Array.isArray(partial.previewLines) && partial.previewLines.length) {
      if (liveBox) {
        liveBox.hidden = false;
        const snippet = partial.previewLines.slice(0, 3).map(l => `<div>${escapeHtml(l)}</div>`).join('');
        liveBox.innerHTML = snippet;
      }
    } else if (partial.stage === 'chunk' && Array.isArray(partial.lines) && partial.lines.length) {
      const chunkText = partial.lines.map(l => (l.isInstrumentalSection || l.vocalType === 'instrumental') ? '[interlude 3]' : String(l.text || '').trim()).filter(Boolean).join('\n');
      if (chunkText) {
        S.project.lyrics = chunkText;
        if ($('lyrics')) $('lyrics').value = chunkText;
        S.project.timing.lineTimes = {};
        partial.lines.forEach((l, idx) => { S.project.timing.lineTimes[idx] = +Number(l.start || 0).toFixed(3); });
        replanSoon(60);
      }
      if (liveBox) {
        liveBox.hidden = false;
        const tail = partial.lines.slice(-2).map(l => `<div>${escapeHtml(l.text || '')}</div>`).join('');
        liveBox.innerHTML = `${tail}<div class="ai-live-interim">${isFr ? `Bloc ${partial.chunkIndex}/${partial.totalChunks} reconnu…` : `Chunk ${partial.chunkIndex}/${partial.totalChunks} recognized…`}</div>`;
      }
    }
  };

  if (bai) {
    onStage(1);
  }
  if (!opts.quiet) {
    toast(isFr ? '🎙️ Détection IA vocale en direct (prétraitement, isolation, transcription & synchro)…' : isEn ? '🎙️ Running streaming 7-stage vocal recognition & alignment…' : '🎙️ 启动 7 阶段实时歌声识别与高精度对齐…');
  }

  try {
    let lang = opts.langOverride || ($('lyricLang') ? $('lyricLang').value : 'auto');
    if (lang === 'auto') {
      const hintTxt = `${S.project.title || ''} ${S.project.artist || ''} ${(S.audio && S.audio.fileName) || ''}`;
      if (/[\u4e00-\u9fff]/.test(hintTxt)) lang = 'zh-Hans';
    }
    const result = await J.aiTranscribeMusic(S.audio, lang, onStage, onPartialResult, {
      signal: controller ? controller.signal : undefined,
    });
    if (result && result.aborted) return false;

    if (result && result.success && (result.isInstrumental || (result.lines && result.lines.length))) {
      pushEdit();
      pause();

      const rows = [];
      const resLines = Array.isArray(result.lines) ? result.lines : [];
      if (result.isInstrumental && !resLines.some(l => !l.isInstrumentalSection && l.vocalType !== 'instrumental')) {
        const dur = Math.max(4, Math.round((S.audio.duration || 10) * 10) / 10);
        rows.push({
          text: `[interlude ${dur}]`,
          start: 0,
          end: S.audio.duration || dur,
          isInterlude: true,
          words: [],
          meta: { section: 'instrumental', vocalType: 'instrumental' },
        });
      } else {
        for (const l of resLines) {
          const isInst = Boolean(l.isInstrumentalSection || l.vocalType === 'instrumental');
          const dur = Math.max(2.0, +(Math.max(0.5, (l.end || 0) - (l.start || 0))).toFixed(1));
          const rowText = isInst ? `[interlude ${dur}]` : String(l.text || '').trim();
          if (!rowText) continue;
          rows.push({
            text: rowText,
            start: +Number(l.start || 0).toFixed(3),
            end: +Number(l.end || (l.start || 0) + dur).toFixed(3),
            isInterlude: isInst,
            words: isInst ? [] : (Array.isArray(l.words) ? l.words : []),
            meta: {
              section: l.section || 'verse',
              vocalType: l.vocalType || 'singing',
              language: l.language || result.language || '',
              speaker: l.speaker || 'Lead',
              recognitionConfidence: l.recognitionConfidence ?? 0.92,
              alignmentConfidence: l.alignmentConfidence ?? 0.9,
              isRepeatedChorus: Boolean(l.isRepeatedChorus),
              backingText: l.backingText || '',
              unclear: Boolean(l.unclear),
              flags: Array.isArray(l.flags) ? l.flags : [],
              validationNote: l.validationNote || '',
            },
          });
        }
      }

      const plainLyrics = rows.map(r => r.text).join('\n');
      S.project.lyrics = plainLyrics;
      $('lyrics').value = plainLyrics;

      S.project.timing.lineTimes = {};
      S.project.timing.wordTimes = {};
      S.project.timing.lineMeta = {};
      rows.forEach((r, idx) => {
        S.project.timing.lineTimes[idx] = r.start;
        if (!r.isInterlude && r.words && r.words.length) {
          S.project.timing.wordTimes[idx] = r.words;
        }
        if (r.meta) {
          S.project.timing.lineMeta[idx] = r.meta;
        }
      });

      const detLangs = Array.isArray(result.detectedLanguages) ? result.detectedLanguages.filter(Boolean) : [];
      if (detLangs.length > 1) {
        const langSel = $('lyricLang');
        if (langSel) langSel.value = 'multi';
        S.project.lang = 'multi';
      } else if (result.language && result.language !== 'auto' && result.language !== 'instrumental') {
        const langSel = $('lyricLang');
        if (langSel) {
          const opt = Array.from(langSel.options).find(o => o.value === result.language || (result.language.startsWith(o.value) && o.value !== 'auto'));
          if (opt) { langSel.value = opt.value; S.project.lang = opt.value; }
        }
      }

      if (result.title && $('songTitle') && !$('songTitle').value.trim()) {
        $('songTitle').value = result.title;
        S.project.title = result.title;
      }
      if (result.artist && $('songArtist') && !$('songArtist').value.trim()) {
        $('songArtist').value = result.artist;
        S.project.artist = result.artist;
      }

      S.project.detection = {
        audioType: result.audioType || (result.isInstrumental ? 'instrumental' : 'singing'),
        language: result.language || 'auto',
        detectedLanguages: result.detectedLanguages || [],
        detectedSpeakers: result.detectedSpeakers || [],
        hasBackingVocals: Boolean(result.hasBackingVocals),
        hasUnclearSections: Boolean(result.hasUnclearSections),
        hasInstrumentalSections: Boolean(result.hasInstrumentalSections),
        hasRepeatedChorus: Boolean(result.hasRepeatedChorus),
        format: S.audio.format || '',
        duration: S.audio.duration || 0,
        bpm: S.audio.bpm || 0,
        preprocessing: S.audio.preprocessing || null,
        validationSummary: result.validationSummary || null,
        pipelineReport: result.pipelineReport || null,
        sections: result.sections || [],
        source: result.engine === 'neural_whisper' ? 'neural_whisper' : 'ai',
      };

      replan();
      flushSave();
      syncUI();
      if (typeof syncQualityControlPanel === 'function') syncQualityControlPanel();
      seek(0);
      recordWork('ai_transcribe', 'sync', `${rows.length} ligne(s) · ${result.language || 'auto'}`);

      if (result.isInstrumental && !resLines.some(l => !l.isInstrumentalSection)) {
        toast(isFr ? '🎹 Audio purement instrumental détecté (aucune fausse parole ajoutée).' : isEn ? '🎹 Purely instrumental track detected.' : '🎹 检测到纯音乐伴奏段落。');
      } else if (result.engine === 'neural_whisper') {
        toast(isFr
          ? `🎤 Paroles générées par Whisper Studio IA (${rows.length} phrases) & synchronisées !`
          : isEn
          ? `🎤 Lyrics recognized via Studio Neural Whisper (${rows.length} lines) & word-synced!`
          : `🎤 已透過 Studio Whisper 類神經語音引擎辨識 ${rows.length} 句歌詞並完成逐詞同步！`);
      } else {
        toast(isFr
          ? '🎤 Paroles reconnues, langue & minutage mot par mot prêts !'
          : isEn
          ? '🎤 Lyrics recognized, language detected & word timings synced!'
          : '🎤 已完成高精度歌词识别与逐词同步！');
      }
      return true;
    }

    // Honest acoustic fallback: ONLY align existing real user lyrics (never overwrite with fake placeholders!)
    const curLyrics = String(S.project.lyrics || '').trim();
    const isDefault = curLyrics === String(J.SAMPLE_LYRICS || '').trim();
    const hasRealUserLyrics = curLyrics.length > 0 && !isDefault;
    const acSummary = S.audio.acousticSummary || {};

    S.project.detection = {
      audioType: acSummary.audioType || 'singing',
      language: S.project.lang || 'auto',
      detectedLanguages: [],
      hasBackingVocals: false,
      hasUnclearSections: false,
      hasInstrumentalSections: Boolean(S.audio.instrumentalSegments && S.audio.instrumentalSegments.length > 0),
      hasRepeatedChorus: false,
      format: S.audio.format || '',
      duration: S.audio.duration || 0,
      bpm: S.audio.bpm || 0,
      preprocessing: S.audio.preprocessing || null,
      validationSummary: null,
      pipelineReport: null,
      sections: [],
      source: 'acoustic',
    };

    if (hasRealUserLyrics) {
      pushEdit();
      pause();
      const parsed = J.parseLyrics(curLyrics);
      const times = J.alignLinesToVocals(S.audio, parsed.lines);
      const valInputLines = [];
      if (times && Object.keys(times).length) {
        S.project.timing.lineTimes = times;
        S.project.timing.wordTimes = {};
        S.project.timing.lineMeta = S.project.timing.lineMeta || {};
        const langCode = J.resolveLang(S.project);
        parsed.lines.forEach((ln, i) => {
          if (ln.interlude) { valInputLines.push({ start: times[i] ?? 0, end: (times[i] ?? 0) + (ln.secs || 2), isInstrumentalSection: true, words: [] }); return; }
          const s = times[i] ?? 0.4;
          const e = i < parsed.lines.length - 1 ? (times[i + 1] ?? s + 3.2) : Math.min(S.audio.duration, s + 3.5);
          const wt = J.alignWordsAcoustic ? J.alignWordsAcoustic(S.audio, ln.text, s, e, langCode) : [];
          S.project.timing.wordTimes[i] = wt;
          valInputLines.push({ start: s, end: e, text: ln.text, words: wt });
        });
      }
      if (J.validateKaraokeAlignment && valInputLines.length) {
        const val = J.validateKaraokeAlignment(S.audio, valInputLines);
        S.project.detection.validationSummary = val.validationSummary;
        val.lines.forEach((vl, idx) => {
          if (vl && vl.words && vl.words.length) S.project.timing.wordTimes[idx] = vl.words;
        });
      }
      replan(); flushSave(); syncUI(); seek(0);
    } else {
      syncAudioDetectPanel();
    }

    const isBilling = Boolean(result && (result.billingRequired || result.reason === 'billing_required'));
    const isUnconf = Boolean(result && (result.notConfigured || result.reason === 'ai_not_configured'));
    const barMsg = isBilling
      ? (isFr
          ? '⚠️ La transcription Cloud Gemini requiert l’activation de la facturation sur votre projet Google AI Studio. Vos paroles existantes restent intactes — utilisez la Reconnaissance Vocale en direct ci-dessous pour dicter/chanter vos paroles instantanément :'
          : isEn
          ? '⚠️ Gemini Cloud transcription requires billing enabled on your Google AI Studio project. Your lyrics remain untouched — use Live Voice Recognition below to sing/speak lyrics instantly:'
          : '⚠️ Gemini 雲端識詞需在 Google AI Studio 專案啟用計費。您可使用下方「即時人聲辨識」透過麥克風即時產生同步歌詞：')
      : isUnconf
      ? (isFr
          ? '⚠️ Clé Gemini absente côté serveur (Settings > Secrets). Utilisez la Reconnaissance Vocale en direct ci-dessous :'
          : isEn
          ? '⚠️ Gemini API key not configured in Settings > Secrets. Use Live Voice Recognition below:'
          : '⚠️ 伺服器尚未設定 Gemini API 金鑰（Settings > Secrets）。請使用下方即時語音辨識：')
      : (isFr
          ? `⚠️ Analyse IA Cloud interrompue${result && result.errorMessage ? ' (' + result.errorMessage.slice(0, 70) + ')' : ''}. Essayez à nouveau ou activez la Reconnaissance Vocale en direct :`
          : isEn
          ? `⚠️ Cloud AI interrupted${result && result.errorMessage ? ' (' + result.errorMessage.slice(0, 70) + ')' : ''}. Retry or use Live Voice Recognition below:`
          : '⚠️ 雲端識詞暫時無法完成，請重試或使用即時麥克風語音辨識：');

    showAiVoiceActionBar({
      message: barMsg,
      showRetryCloud: true,
      showAcousticAlign: hasRealUserLyrics,
    });
    if (!opts.auto) {
      toast(isBilling
        ? (isFr ? '💡 IA Cloud : facturation requise — Voix en direct prête ci-dessous.' : isEn ? '💡 Cloud AI requires billing — Live Voice Mic ready below.' : '💡 雲端 AI 需啟用計費 — 可直接使用即時麥克風辨識。')
        : (isFr ? '🎙️ Utilisez la reconnaissance vocale en direct ou réessayez.' : isEn ? '🎙️ Use Live Voice Recognition or retry.' : '🎙️ 請使用即時人聲辨識或重試。'));
    }
    return false;
  } catch (err) {
    showAiVoiceActionBar({
      message: isFr
        ? '⚠️ Connexion IA Cloud indisponible pour le moment. Utilisez la Reconnaissance Vocale en direct ou réessayez :'
        : isEn
        ? '⚠️ Cloud AI connection failed. Use Live Voice Recognition or retry:'
        : '⚠️ 雲端 AI 連線失敗，請使用即時人聲辨識或重試：',
      showRetryCloud: true,
      showAcousticAlign: Boolean(String(S.project.lyrics || '').trim() && String(S.project.lyrics || '').trim() !== String(J.SAMPLE_LYRICS || '').trim()),
    });
    if (!opts.auto) {
      toast(isFr ? '🎙️ Erreur réseau IA — Reconnaissance vocale en direct prête.' : isEn ? '🎙️ Network error — Live Voice Recognition ready.' : '🎙️ 連線錯誤 — 可改用即時麥克風辨識。');
    }
  } finally {
    if (S.syncTask && S.syncTask.controller === controller) S.syncTask = null;
    if (baiLbl) baiLbl.textContent = origText;
    syncAiActionButtonsState();
    if (liveBox && !(activeVoiceController && activeVoiceController.isActive())) {
      liveBox.hidden = true;
      liveBox.innerHTML = '';
    }
    const pBox = $('aiProgressBox');
    if (pBox && !(activeVoiceController && activeVoiceController.isActive())) {
      if (aiDone) {
        setTimeout(() => {
          if (!S.syncTask && !(activeVoiceController && activeVoiceController.isActive())) {
            pBox.hidden = true;
          }
        }, 650);
      } else {
        pBox.hidden = true;
      }
    }
  }
  return false;
}

/* ---------------- wiring ---------------- */
function bind() {
  $('lyrics').addEventListener('input', e => {
    S.project.lyrics = e.target.value;
    if (S.project.timing && S.project.timing.wordTimes) {
      const parsed = J.parseLyrics(S.project.lyrics);
      const wt = S.project.timing.wordTimes;
      Object.keys(wt).forEach(k => {
        const idx = +k, ln = parsed.lines[idx];
        const joined = Array.isArray(wt[k]) ? wt[k].map(w => w.text).join('').replace(/\s+/g, '') : '';
        if (!ln || joined !== String(ln.text || '').replace(/\s+/g, '')) delete wt[k];
      });
    }
    clearQcAutoReport();
    syncAiActionButtonsState();
    replanSoon(260);
  });
  const btnKh = $('btnKaraokeHud');
  if (btnKh) {
    btnKh.addEventListener('click', () => {
      remember();
      S.project.karaoke = S.project.karaoke === false;
      syncKaraokeBtn();
      replan();
      commit();
      flushSave();
    });
  }
  const updateKc = (patch, needReplan = true) => {
    if (!S.project) return;
    S.project.karaokeCfg = Object.assign(getKaraokeCfg(), patch);
    syncKaraokeControls();
    if (needReplan) {
      replanSoon(35);
    } else {
      updateKaraokePrompter();
      autosave();
    }
  };
  const seg = $('kModeSeg');
  if (seg) {
    seg.querySelectorAll('button[data-kmode]').forEach(btn => {
      btn.addEventListener('click', () => updateKc({ mode: btn.dataset.kmode }, true));
    });
  }
  const btnKCfg = $('btnKaraokeCfg'), kcDrawer = $('karaokeControls');
  if (btnKCfg && kcDrawer) {
    btnKCfg.addEventListener('click', () => {
      kcDrawer.hidden = !kcDrawer.hidden;
      btnKCfg.setAttribute('aria-expanded', String(!kcDrawer.hidden));
    });
  }
  const btnKFs = $('btnKaraokeFs');
  if (btnKFs) {
    btnKFs.addEventListener('click', () => toggleKaraokeFullscreen());
  }
  document.addEventListener('fullscreenchange', () => {
    const stg = document.querySelector('.col-stage');
    if (stg && !document.fullscreenElement && stg.classList.contains('is-karaoke-fs')) {
      toggleKaraokeFullscreen(false);
    }
  });
  if ($('kFontSize')) $('kFontSize').addEventListener('input', e => updateKc({ fontSize: parseFloat(e.target.value) || 1 }, true));
  if ($('kPosY')) $('kPosY').addEventListener('input', e => updateKc({ yPct: parseFloat(e.target.value) || 86 }, true));
  document.querySelectorAll('.kp-presets [data-ky]').forEach(b => b.addEventListener('click', () => updateKc({ yPct: parseFloat(b.dataset.ky) || 86 }, true)));
  if ($('kBgAlpha')) $('kBgAlpha').addEventListener('input', e => updateKc({ bgAlpha: (parseFloat(e.target.value) || 0) / 100 }, true));
  if ($('kBaseColor')) $('kBaseColor').addEventListener('input', e => updateKc({ baseColor: e.target.value }, true));
  if ($('kBaseColorAuto')) $('kBaseColorAuto').addEventListener('click', () => updateKc({ baseColor: '' }, true));
  if ($('kActiveColor')) $('kActiveColor').addEventListener('input', e => updateKc({ activeColor: e.target.value }, true));
  if ($('kActiveColorAuto')) $('kActiveColorAuto').addEventListener('click', () => updateKc({ activeColor: '' }, true));
  if ($('kAutoScroll')) $('kAutoScroll').addEventListener('change', e => updateKc({ autoScroll: !!e.target.checked }, false));
  document.querySelectorAll('.kp-sync-nudges [data-sync-nudge]').forEach(btn => {
    btn.addEventListener('click', () => nudgeGlobalSyncOffset(parseInt(btn.dataset.syncNudge, 10) || 0));
  });
  if ($('btnKpOffsetReset')) $('btnKpOffsetReset').addEventListener('click', () => nudgeGlobalSyncOffset(0, 0));
  if ($('btnKpTapWord')) $('btnKpTapWord').addEventListener('click', () => kpQuickTapCurrentWord());
  if ($('btnKpAutoAlign')) $('btnKpAutoAlign').addEventListener('click', () => alignAllWordsAcousticallyUI());
  if ($('btnToggleTrans')) $('btnToggleTrans').addEventListener('click', () => toggleTranslationLayer());
  if ($('btnTranslateLyrics')) $('btnTranslateLyrics').addEventListener('click', () => translateAllLyrics());
  if ($('btnClearTrans')) $('btnClearTrans').addEventListener('click', () => clearTranslationLayer());
  const btnTrCfg = $('btnTransCfgToggle'), trDrawer = $('trDisplayControls');
  if (btnTrCfg && trDrawer) {
    btnTrCfg.addEventListener('click', () => {
      trDrawer.hidden = !trDrawer.hidden;
      btnTrCfg.setAttribute('aria-expanded', String(!trDrawer.hidden));
    });
  }
  if ($('trTargetLang')) $('trTargetLang').addEventListener('change', e => {
    const tr = ensureTranslationState();
    if (!tr) return;
    tr.targetLang = e.target.value;
    autosave();
  });
  if ($('trFontSize')) $('trFontSize').addEventListener('input', e => updateTransCfg({ fontSize: parseFloat(e.target.value) || 0.78 }, true));
  if ($('trPosMode')) $('trPosMode').addEventListener('change', e => updateTransCfg({ position: e.target.value }, true));
  if ($('trPosY')) $('trPosY').addEventListener('input', e => updateTransCfg({ position: 'custom', yPct: parseFloat(e.target.value) || 76 }, true));
  if ($('trBgAlpha')) $('trBgAlpha').addEventListener('input', e => updateTransCfg({ bgAlpha: (parseFloat(e.target.value) || 0) / 100 }, true));
  if ($('trColor')) $('trColor').addEventListener('input', e => updateTransCfg({ color: e.target.value }, true));
  if ($('trColorAuto')) $('trColorAuto').addEventListener('click', () => updateTransCfg({ color: '' }, true));
  if ($('trItalic')) $('trItalic').addEventListener('change', e => updateTransCfg({ italic: !!e.target.checked }, true));
  if ($('trShowPrompter')) $('trShowPrompter').addEventListener('change', e => updateTransCfg({ showInPrompter: !!e.target.checked }, false));
  if ($('trShowVideo')) $('trShowVideo').addEventListener('change', e => updateTransCfg({ showInVideo: !!e.target.checked }, true));
  $('lyricLang').addEventListener('change', e => {
    remember();
    S.project.lang = e.target.value; replan(); renderFontRoles(); commit(); flushSave();
    const info = J.resolveLangInfo ? J.resolveLangInfo(S.project) : { primary: J.resolveLang(S.project), detectedLanguages: [], isMixed: false };
    const lbl = S.project.lang === 'auto'
      ? ('自動判定 → ' + (info.isMixed ? info.detectedLanguages.map(c => J.LANG_LABEL[c] || c).join(' + ') : (J.LANG_LABEL[info.primary] || info.primary)))
      : (J.LANG_LABEL[S.project.lang] || J.LANG_LABEL[info.primary]);
    toast('Langue : ' + lbl);
  });
  $('songTitle').addEventListener('input', e => { S.project.title = e.target.value; syncKaraokeDeckMeta(); replanSoon(300); });
  $('songArtist').addEventListener('input', e => { S.project.artist = e.target.value; syncKaraokeDeckMeta(); replanSoon(300); });
  $('btnSyntax').addEventListener('click', e => { const s = $('syntax'); s.hidden = !s.hidden; e.target.setAttribute('aria-expanded', String(!s.hidden)); });
  $('bpm').addEventListener('change', e => { S.project.timing.bpm = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('offset').addEventListener('change', e => { S.project.timing.offset = Math.max(0, parseFloat(e.target.value) || 0); replan(); });
  $('lineScale').addEventListener('change', e => { S.project.timing.lineScale = J.clamp(parseFloat(e.target.value) || 1, 0.3, 4); replan(); });
  $('snap').addEventListener('change', e => { S.project.timing.snap = e.target.checked; replan(); });
  $('btnResetTimes').addEventListener('click', () => { pushEdit(); S.project.timing.lineTimes = {}; S.project.timing.lineEnds = {}; S.project.timing.wordTimes = {}; clearQcAutoReport(); replan(); });
  $('audioFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) loadAudioFile(f); });
  const adz = $('audioDropzone');
  if (adz) {
    adz.addEventListener('click', e => {
      if (e.target.closest('label.file') || e.target === $('audioFile')) return;
      if ($('audioFile')) $('audioFile').click();
    });
    adz.addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === adz) {
        e.preventDefault();
        if ($('audioFile')) $('audioFile').click();
      }
    });
    adz.addEventListener('dragenter', e => { e.preventDefault(); e.stopPropagation(); adz.classList.add('is-dragover'); });
    adz.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; adz.classList.add('is-dragover'); });
    adz.addEventListener('dragleave', e => {
      if (!e.relatedTarget || !adz.contains(e.relatedTarget)) adz.classList.remove('is-dragover');
    });
    adz.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); adz.classList.remove('is-dragover');
      if ($('dropHint')) $('dropHint').hidden = true;
      const files = Array.from((e.dataTransfer && e.dataTransfer.files) || []);
      const song = files.find(f => /^audio\//.test(f.type) || /\.(mp3|wav|m4a|aac|ogg|flac|opus|webm|mp4|aiff|aif|wma)$/i.test(f.name || ''));
      if (song) loadAudioFile(song);
    });
  }
  $('btnTap').addEventListener('click', () => (S.tap ? stopTap() : startTap()));
  const bai = $('btnAiTranscribe');
  if (bai) {
    bai.addEventListener('click', async () => {
      const isFr = document.documentElement.lang === 'fr';
      const isEn = document.documentElement.lang === 'en';

      if (!S.audio) {
        showAiVoiceActionBar({
          message: isFr
            ? '🎙️ Aucune chanson chargée : importez un morceau pour la détection IA automatique, OU activez dès maintenant la reconnaissance vocale en direct au micro :'
            : isEn
            ? '🎙️ No song loaded yet: import an audio track for automatic AI lyrics recognition, OR start Live Voice Recognition with your microphone right now:'
            : '🎙️ 尚未匯入音樂：請選擇音訊檔案進行 AI 自動識詞，或立即使用「即時人聲辨識」透過麥克風直接錄製同步歌詞：',
          showLoadAudio: true,
        });
        toast(isFr ? 'Importez une chanson ou démarrez la voix en direct ci-dessous !' : isEn ? 'Choose a song or start Live Voice Mic below!' : '請選擇音樂或開啟即時麥克風語音辨識！');
        return;
      }

      runAiTranscription();
    });
  }

  const bvd = $('btnVoiceDictate');
  if (bvd) {
    bvd.addEventListener('click', () => toggleLiveVoiceRecognition());
  }
  const bsv = $('btnStopVoiceInline');
  if (bsv) {
    bsv.addEventListener('click', () => stopLiveVoiceDictation());
  }

  const bvs = $('btnVocalSync');
  if (bvs) {
    bvs.addEventListener('click', async () => {
      const isFr = document.documentElement.lang === 'fr';
      const isEn = document.documentElement.lang === 'en';

      // Case 1: No audio track loaded yet -> offer instant Live Voice Mic OR audio load right in the panel
      if (!S.audio) {
        showAiVoiceActionBar({
          message: isFr
            ? 'Synchro Voix & Paroles : importez un fichier audio pour coordonner en temps réel vos paroles sur la voix, ou activez la Reconnaissance Vocale en direct au micro :'
            : isEn
            ? 'Voice Sync: load an audio file to align lyrics to the singing voice, or start Live Voice Recognition with your microphone to generate & sync lyrics instantaneously:'
            : '人聲同步：請先匯入音樂檔案進行人聲逐詞對齊，或立即使用「即時麥克風語音辨識」邊唱邊自動產生同步歌詞：',
          showLoadAudio: true,
        });
        toast(isFr ? 'Choisissez une chanson ou démarrez la Voix en direct !' : isEn ? 'Load a song or start Live Voice Mic below!' : '請選擇音樂或開啟即時麥克風！');
        return;
      }

      if (S.syncTask) {
        toast(isFr ? 'Une synchronisation est déjà en cours…' : isEn ? 'A synchronization task is already running…' : '同步任務正在執行中…');
        return;
      }

      // Case 2: Audio loaded, no real custom lyrics yet -> chain straight into AI Voice/Lyrics Detection pipeline!
      const rawTxt = String(S.project.lyrics || ($('lyrics') && $('lyrics').value) || '').trim();
      const isDefaultSample = rawTxt === String(J.SAMPLE_LYRICS || '').trim();
      if (!rawTxt || isDefaultSample || !(S.plan && S.plan.lines && S.plan.lines.length)) {
        toast(isFr
          ? 'Aucune parole personnalisée : lancement de la détection vocale IA automatique…'
          : isEn
          ? 'No custom lyrics yet: running automatic AI voice & lyrics detection…'
          : '尚未有自訂歌詞：自動啟動 AI 歌聲識詞與同步…');
        await runAiTranscription();
        return;
      }

      // Case 3: Audio + real lyrics -> Real-Time Streaming Synchro Voix & Paroles
      if (S.tap) stopTap();
      if (activeVoiceController && activeVoiceController.isActive()) stopLiveVoiceDictation();
      hideAiVoiceActionBar();
      const bvsLbl = $('btnVocalSyncLbl') || bvs;
      const origTxt = bvsLbl.textContent;
      const controller = typeof AbortController === 'function' ? new AbortController() : null;
      S.syncTask = { kind: 'vocal_sync', controller };
      syncAiActionButtonsState();

      const stageCopy = isFr
        ? {
            1: '1/4 Analyse orthographe & piste vocale…',
            2: '2/4 Écoute & lien temps réel voix-paroles…',
            3: '3/4 Coordination acoustique 10 ms instant par instant…',
            4: '4/4 Synchro Voix & Paroles prête !',
          }
        : isEn
        ? { 1: '1/4 Spelling check & vocal stem…', 2: '2/4 Real-time voice-lyric linking…', 3: '3/4 10ms Viterbi tuning…', 4: '4/4 Voice Sync & fixes ready!' }
        : { 1: '1/4 歌詞拼寫分析與人聲提取…', 2: '2/4 即時歌聲對齊與錯字訂正…', 3: '3/4 10ms 細微校準…', 4: '4/4 人聲同步與錯字修正完成！' };

      const applyCorrectedLinesToProjectLyrics = (rawLyrics, planLines, correctedLines) => {
        if (!correctedLines || !Object.keys(correctedLines).length) return rawLyrics;
        const rows = String(rawLyrics || '').replace(/\r/g, '').split('\n');
        let changed = false;
        for (const [kStr, nextCleanRaw] of Object.entries(correctedLines)) {
          const idx = +kStr;
          const pl = planLines && planLines[idx];
          const nextClean = String(nextCleanRaw || '').trim();
          if (!pl || pl.interlude || !nextClean) continue;
          const rowIdx = typeof pl.src === 'number' ? pl.src : idx;
          if (rowIdx < 0 || rowIdx >= rows.length) continue;
          const origRow = rows[rowIdx];
          const tsMatch = origRow.match(/^((?:\s*\[\d+:\d+(?:[.:]\d+)?\])+)\s*/);
          const prefix = tsMatch ? tsMatch[1] + ' ' : '';
          const withoutTs = tsMatch ? origRow.slice(tsMatch[0].length) : origRow;
          const barIdx = withoutTs.indexOf('|');
          const suffix = barIdx >= 0 ? ' ' + withoutTs.slice(barIdx).trim() : '';
          const impactBang = (pl.impact && !/[!！]$/.test(nextClean)) ? '!' : '';
          const updatedRow = `${prefix}${nextClean}${impactBang}${suffix}`;
          if (updatedRow !== origRow) {
            rows[rowIdx] = updatedRow;
            changed = true;
          }
        }
        return changed ? rows.join('\n') : rawLyrics;
      };

      const pBox = $('aiProgressBox');
      const stEl = $('aiProgressStage');
      const pctEl = $('aiProgressPct');
      const fillEl = $('aiProgressFill');
      const stepsEl = $('aiProgressSteps');
      const liveEl = $('aiLiveTranscript');
      if (liveEl) { liveEl.hidden = true; liveEl.innerHTML = ''; }

      let lastLiveUiSyncMs = 0;
      const streamedLineTimes = Object.assign({}, (S.project.timing && S.project.timing.lineTimes) || {});
      const streamedWordTimes = Object.assign({}, (S.project.timing && S.project.timing.wordTimes) || {});

      const setSyncProg = (st, customLabel = '', meta = null) => {
        const defaultPct = [18, 45, 78, 100][Math.max(0, Math.min(3, (st | 0) - 1))] || 20;
        const pct = Math.max(5, Math.min(100, Math.round(Number(meta && meta.pct) || defaultPct)));
        const uiStep = Math.max(1, Math.min(4, st <= 1 ? 1 : st <= 3 ? 2 : st <= 5 ? 3 : 4));
        const label = (typeof customLabel === 'string' && customLabel.length > 4 && customLabel !== 'stem' && customLabel !== 'align' && customLabel !== 'optimize' && customLabel !== 'done' && customLabel !== 'acoustic_viterbi')
          ? customLabel
          : (stageCopy[uiStep] || stageCopy[1]);
        if (pBox) pBox.hidden = false;
        if (stEl) stEl.textContent = label;
        if (pctEl) pctEl.textContent = `${pct}%`;
        if (fillEl) fillEl.style.width = `${pct}%`;
        if (stepsEl) {
          stepsEl.querySelectorAll('span[data-step]').forEach(sp => {
            const n = parseInt(sp.dataset.step, 10) || 0;
            sp.classList.toggle('is-done', n <= Math.round((pct / 100) * 7));
            sp.classList.toggle('is-cur', n === Math.min(7, Math.max(1, Math.ceil((pct / 100) * 7))));
          });
        }
        bvsLbl.textContent = isFr ? `Synchro · ${pct}%` : isEn ? `Sync · ${pct}%` : `同步 · ${pct}%`;
      };

      const onLiveSyncEvent = (evt) => {
        if (!evt) return;
        const origPlanLines = S.plan && S.plan.lines ? S.plan.lines : [];
        if (evt.refinedLineTimes && evt.refinedWordTimes) {
          Object.assign(streamedLineTimes, evt.refinedLineTimes);
          Object.assign(streamedWordTimes, evt.refinedWordTimes);
          S.project.timing.lineTimes = Object.assign({}, streamedLineTimes);
          S.project.timing.wordTimes = Object.assign({}, streamedWordTimes);
          const now = performance.now();
          if (now - lastLiveUiSyncMs > 180) {
            lastLiveUiSyncMs = now;
            replan();
            syncUI();
          }
        }
        if (liveEl) {
          const parts = [];
          if (evt.matchedCount != null && evt.totalTokens) {
            parts.push(`<div class="ai-live-line"><strong>⚡ ${evt.matchedCount}/${evt.totalTokens} mots ancrés</strong> · Coordination instant par instant</div>`);
          } else if (Array.isArray(evt.recognizedLines) && evt.recognizedLines.length) {
            parts.push(`<div class="ai-live-line">${escapeHtml(evt.recognizedLines.slice(0, 3).map(l => l.text).join(' / '))}</div>`);
          }
          if (evt.refinedLineTimes) {
            const keys = Object.keys(evt.refinedLineTimes).map(Number).sort((a, b) => a - b).slice(-3);
            keys.forEach(li => {
              const tStart = Number(evt.refinedLineTimes[li] || 0);
              const lTxt = (origPlanLines[li] && origPlanLines[li].text) || '';
              if (lTxt) {
                parts.push(`<div class="ai-live-line"><span class="mono">[${tStart.toFixed(2)}s]</span> ${escapeHtml(lTxt)}</div>`);
              }
            });
          }
          if (parts.length) {
            liveEl.hidden = false;
            liveEl.innerHTML = parts.join('');
          }
        }
      };

      setSyncProg(1, stageCopy[1], { pct: 10 });
      toast(isFr ? 'Synchro Voix & Paroles en temps réel…' : isEn ? 'Real-time Voice Sync running…' : '正在即時執行人聲與歌詞精準對齊…');
      pushEdit();

      let syncDone = false;
      try {
        const origPlanLines = S.plan.lines.slice();
        let alignLangHint = J.resolveLang(S.project);
        if ((!alignLangHint || alignLangHint === 'auto') && /[\u4e00-\u9fff]/.test(`${S.project.lyrics || ''} ${S.project.title || ''} ${S.project.artist || ''} ${(S.audio && S.audio.fileName) || ''}`)) {
          alignLangHint = 'zh-Hans';
        }
        const aligned = await J.aiAlignVocals(S.audio, origPlanLines, alignLangHint, setSyncProg, onLiveSyncEvent, {
          signal: controller ? controller.signal : undefined,
          existingWordTimes: S.project.timing && S.project.timing.wordTimes,
          existingLineTimes: S.project.timing && S.project.timing.lineTimes,
        });
        if (aligned && aligned.aborted) return;

        // Apply automatic orthography & voice-confirmed spelling fixes directly to lyrics editor
        let appliedLyricsChanged = false;
        if (aligned && aligned.correctedLines && Object.keys(aligned.correctedLines).length) {
          const nextLyrics = applyCorrectedLinesToProjectLyrics(S.project.lyrics, origPlanLines, aligned.correctedLines);
          if (nextLyrics !== S.project.lyrics) {
            S.project.lyrics = nextLyrics;
            if ($('lyrics')) $('lyrics').value = nextLyrics;
            appliedLyricsChanged = true;
          }
        }

        const times = aligned && aligned.lineTimes ? aligned.lineTimes : aligned;
        if (times && Object.keys(times).length) {
          syncDone = true;
          S.project.timing.lineTimes = times;
          if (aligned && aligned.wordTimes) S.project.timing.wordTimes = aligned.wordTimes;
          if (aligned && aligned.lineMeta) {
            if (!S.project.timing.lineMeta) S.project.timing.lineMeta = {};
            for (const [k, m] of Object.entries(aligned.lineMeta)) {
              S.project.timing.lineMeta[k] = Object.assign({}, S.project.timing.lineMeta[k] || {}, m);
            }
          }
          const detLang = (aligned && aligned.detectedLanguage && aligned.detectedLanguage !== 'auto')
            ? aligned.detectedLanguage
            : (alignLangHint && alignLangHint !== 'auto' ? alignLangHint : 'auto');
          if (!S.project.detection) {
            S.project.detection = {
              audioType: (S.audio.acousticSummary && S.audio.acousticSummary.audioType) || 'singing',
              language: detLang,
              detectedLanguages: detLang !== 'auto' ? [detLang] : [],
              format: S.audio.format || '',
              duration: S.audio.duration || 0,
              bpm: S.audio.bpm || 0,
              preprocessing: S.audio.preprocessing || null,
              source: aligned.engineSource || (aligned.source === 'ai' ? 'ai' : 'vocal_sync'),
            };
          } else {
            if (detLang !== 'auto') S.project.detection.language = detLang;
            if (aligned.engineSource) S.project.detection.source = aligned.engineSource;
          }
          const langSel = $('lyricLang');
          if (detLang !== 'auto' && langSel && (langSel.value === 'auto' || !S.project.lang || S.project.lang === 'auto')) {
            const opt = Array.from(langSel.options).find(o => o.value === detLang || (detLang.startsWith(o.value) && o.value !== 'auto'));
            if (opt) { langSel.value = opt.value; S.project.lang = opt.value; }
          }
          const activePlanLines = appliedLyricsChanged ? J.parseLyrics(S.project.lyrics).lines : origPlanLines;
          if (J.validateKaraokeAlignment && activePlanLines) {
            const valLines = activePlanLines.map((ln, idx) => ({
              start: times[idx] ?? ln.start,
              end: idx < activePlanLines.length - 1 ? (times[idx + 1] ?? ln.end) : ln.end,
              isInstrumentalSection: !!ln.interlude,
              words: (S.project.timing.wordTimes && S.project.timing.wordTimes[idx]) || [],
            }));
            const val = J.validateKaraokeAlignment(S.audio, valLines);
            S.project.detection.validationSummary = val.validationSummary;
          }

          replan(); flushSave(); syncUI();
          if (typeof syncQualityControlPanel === 'function') syncQualityControlPanel();
          const lineCount = Object.keys(times).length;
          const cohNote = aligned && aligned.coherenceScore
            ? ` · ${aligned.coherenceScore}% (±${aligned.avgAbsErrMs || 0}ms)`
            : '';
          const isDtw = aligned && String(aligned.engineSource || '').includes('neural_whisper');
          const fixList = Array.isArray(aligned && aligned.corrections) ? aligned.corrections : [];
          const fixCount = fixList.length || (aligned && aligned.spellingFixCount) || Object.keys((aligned && aligned.correctedLines) || {}).length;
          const fixSamples = fixList.slice(0, 3).map(c => `${c.original} → ${c.corrected}`).join(', ');
          const fixNote = fixCount > 0
            ? (isFr
                ? ` · ${fixCount} faute${fixCount > 1 ? 's' : ''} corrigée${fixCount > 1 ? 's' : ''}${fixSamples ? ' (' + fixSamples + ')' : ''}`
                : isEn
                ? ` · ${fixCount} fix${fixCount > 1 ? 'es' : ''}${fixSamples ? ' (' + fixSamples + ')' : ''}`
                : ` · 已自動訂正 ${fixCount} 處錯字${fixSamples ? '（' + fixSamples + '）' : ''}`)
            : '';
          recordWork('vocal_sync', 'sync', `${lineCount} lignes${cohNote}${fixCount ? ` · ${fixCount} corrigées` : ''}`);

          toast(isFr
            ? `Synchro Voix & Paroles${isDtw ? ' Neuronale' : ''} réussie (${lineCount} lignes${cohNote})${fixNote} !`
            : isEn
            ? `${isDtw ? 'Neural ' : ''}Voice Sync complete (${lineCount} lines${cohNote})${fixNote}!`
            : `${isDtw ? '類神經' : ''}人聲同步完成（${lineCount} 句${cohNote}）${fixNote}！`);

          const reformList = Array.isArray(aligned && aligned.reformulations) ? aligned.reformulations : [];
          const problemList = Array.isArray(aligned && aligned.unresolvableProblems) ? aligned.unresolvableProblems : [];
          const hasRecRecovery = aligned && Array.isArray(aligned.recognizedLines) && aligned.recognizedLines.length > 0 && (aligned.source === 'acoustic' || (aligned.matchRatio != null && aligned.matchRatio < 0.35));

          const applyReformItems = (items) => {
            if (!Array.isArray(items) || !items.length) return;
            pushEdit();
            const mapCorr = {};
            const curPlan = J.parseLyrics(S.project.lyrics).lines;
            items.forEach(rf => {
              if (rf && rf.reformulatedText) mapCorr[rf.lineIdx] = rf.reformulatedText;
            });
            const nextLyrics = applyCorrectedLinesToProjectLyrics(S.project.lyrics, curPlan, mapCorr);
            if (nextLyrics !== S.project.lyrics) {
              S.project.lyrics = nextLyrics;
              if ($('lyrics')) $('lyrics').value = nextLyrics;
            }
            const useLang = (aligned && aligned.detectedLanguage && aligned.detectedLanguage !== 'auto')
              ? aligned.detectedLanguage
              : (J.resolveLang(S.project) || 'auto');
            items.forEach(rf => {
              const li = rf.lineIdx;
              const ls = +(Number(S.project.timing.lineTimes[li] ?? rf.start) || 0).toFixed(3);
              const nextStart = S.project.timing.lineTimes[li + 1];
              const le = +(Math.max(ls + 0.35, nextStart != null ? nextStart - 0.04 : (Number(rf.end) || ls + 2.8))).toFixed(3);
              if (J.alignWordsAcoustic) {
                let words = J.alignWordsAcoustic(S.audio, rf.reformulatedText, ls, le, useLang, 'Lead', rf.confidence || 0.88);
                if (words.length && J.optimizeLineVocalCoordination) {
                  words = J.optimizeLineVocalCoordination(S.audio, words, ls, le, useLang, 'Lead');
                }
                if (words.length) S.project.timing.wordTimes[li] = words;
              }
              S.project.timing.lineMeta = S.project.timing.lineMeta || {};
              S.project.timing.lineMeta[li] = Object.assign({}, S.project.timing.lineMeta[li] || {}, {
                recognitionConfidence: rf.confidence || 0.88,
                alignmentConfidence: 0.88,
                flags: [],
                validationNote: 'Reformulation IA appliquée',
              });
            });
            replan(); flushSave(); syncUI();
            recordWork('vocal_sync', 'reformulate', `${items.length} ligne(s) reformulée(s) par IA`);
            toast(isFr
              ? `✨ ${items.length} reformulation${items.length > 1 ? 's' : ''} IA appliquée${items.length > 1 ? 's' : ''} & resynchronisée${items.length > 1 ? 's' : ''} !`
              : isEn
              ? `✨ Applied & synced ${items.length} AI reformulation${items.length > 1 ? 's' : ''}!`
              : `✨ 已套用並重新對齊 ${items.length} 句 AI 重構歌詞！`);
          };

          const handleReanalyzeProb = async (pr, cardEl) => {
            if (!J.reanalyzeLineAudio || !S.audio) return;
            const useLang = (aligned && aligned.detectedLanguage && aligned.detectedLanguage !== 'auto')
              ? aligned.detectedLanguage
              : (J.resolveLang(S.project) || 'auto');
            const existWords = (S.project.timing.wordTimes && S.project.timing.wordTimes[pr.lineIdx]) || [];
            const res = await J.reanalyzeLineAudio(S.audio, pr.start, pr.end, existWords, useLang);
            if (res && res.success && Array.isArray(res.lines) && res.lines.length) {
              const bestLine = res.lines[0];
              const heardClean = res.lines.map(l => String(l.text || '').trim()).filter(Boolean).join(' ').trim();
              if (bestLine.words && bestLine.words.length) {
                pushEdit();
                S.project.timing.lineTimes[pr.lineIdx] = +(Number(bestLine.start) || pr.start).toFixed(3);
                S.project.timing.wordTimes[pr.lineIdx] = bestLine.words;
                S.project.timing.lineMeta = S.project.timing.lineMeta || {};
                S.project.timing.lineMeta[pr.lineIdx] = Object.assign({}, S.project.timing.lineMeta[pr.lineIdx] || {}, {
                  alignmentConfidence: bestLine.alignmentConfidence ?? 0.86,
                  flags: [],
                  validationNote: 'Ré-analyse ciblée effectuée',
                });
                replan(); flushSave(); syncUI();
              }
              if (cardEl && heardClean) {
                const descEl = cardEl.querySelector('.ai-diag-desc');
                if (descEl) {
                  descEl.innerHTML = `${escapeHtml(isFr ? 'Voix isolée entendue : ' : 'Isolated voice heard: ')}<strong class="ai-diag-next">« ${escapeHtml(heardClean)} »</strong>`;
                }
                const actionsEl = cardEl.querySelector('.ai-diag-actions');
                if (actionsEl && !actionsEl.querySelector('.js-apply-reanalyzed')) {
                  const applyBtn = document.createElement('button');
                  applyBtn.type = 'button';
                  applyBtn.className = 'accent js-apply-reanalyzed';
                  applyBtn.textContent = isFr ? '✨ Remplacer par cette phrase' : isEn ? '✨ Replace line' : '✨ 套用此辨識句';
                  applyBtn.addEventListener('click', () => {
                    applyReformItems([{
                      lineIdx: pr.lineIdx,
                      reformulatedText: heardClean,
                      start: bestLine.start || pr.start,
                      end: bestLine.end || pr.end,
                      confidence: bestLine.recognitionConfidence || 0.88,
                    }]);
                    cardEl.remove();
                  });
                  actionsEl.prepend(applyBtn);
                }
              }
              toast(isFr ? `🔁 Segment #${pr.lineIdx + 1} ré-analysé avec succès !` : `🔁 Re-analyzed line #${pr.lineIdx + 1}!`);
            } else {
              toast(isFr ? 'Aucune nouvelle articulation vocale nette détectée sur ce passage.' : 'No clearer vocal articulation detected here.');
            }
          };

          if (reformList.length > 0 || problemList.length > 0 || hasRecRecovery) {
            const recLines = hasRecRecovery ? aligned.recognizedLines : [];
            const diagSummaryMsg = (() => {
              if (reformList.length && problemList.length) {
                return isFr
                  ? `Diagnostic Synchro Voix & Paroles : ${reformList.length} différence(s) reformulable(s) par IA et ${problemList.length} passage(s) complexe(s) à vérifier :`
                  : isEn
                  ? `Voice Sync Diagnostic: ${reformList.length} AI reformulation(s) ready and ${problemList.length} complex section(s) flagged:`
                  : `人聲同步診斷：發現 ${reformList.length} 處 AI 可重構差異與 ${problemList.length} 處困難片段：`;
              }
              if (reformList.length) {
                return isFr
                  ? `✨ L’IA a détecté ${reformList.length} passage(s) où vos paroles d’origine diffèrent de la voix chantée et propose une reformulation précise :`
                  : isEn
                  ? `✨ AI found ${reformList.length} line(s) differing from the sung voice and prepared accurate reformulations:`
                  : `✨ AI 偵測到 ${reformList.length} 句歌詞與實際歌聲有差異，並已產生精準重構建議：`;
              }
              if (problemList.length) {
                return isFr
                  ? `⚠️ ${problemList.length} passage(s) n’ont pas pu être résolus à 100% automatiquement (consultez et ré-analysez en un clic ci-dessous) :`
                  : isEn
                  ? `⚠️ ${problemList.length} tricky section(s) could not be fully auto-resolved (inspect or re-analyze below):`
                  : `⚠️ 偵測到 ${problemList.length} 處困難同步段落（可於下方一鍵重分析或補錄）：`;
              }
              return isFr
                ? `💡 Whisper IA a reconnu ${recLines.length} phrase(s) différente(s) dans l'audio (ex. « ${String(recLines[0].text || '').slice(0, 48)}… »). Voulez-vous remplacer vos paroles par la reconnaissance vocale IA ?`
                : isEn
                ? `💡 Neural Whisper heard ${recLines.length} different line(s) in this track (e.g. "${String(recLines[0].text || '').slice(0, 48)}…"). Apply recognized lyrics?`
                : `💡 Whisper 類神經模型辨識出 ${recLines.length} 句不同歌詞（例如：「${String(recLines[0].text || '').slice(0, 36)}…」），要套用並完成對齊嗎？`;
            })();

            showAiVoiceActionBar({
              message: diagSummaryMsg,
              reformulations: reformList,
              unresolvableProblems: problemList,
              onApplyReformulations: applyReformItems,
              onSeekAudio: (sec) => { seek(sec); },
              onReanalyzeProblem: handleReanalyzeProb,
              applyRecognizedLabel: hasRecRecovery
                ? (isFr
                    ? `✨ Appliquer les ${recLines.length} paroles IA reconnues`
                    : isEn
                    ? `✨ Apply ${recLines.length} recognized lyrics`
                    : `✨ 套用 ${recLines.length} 句 AI 辨識歌詞`)
                : '',
              onApplyRecognized: hasRecRecovery ? () => {
                pushEdit();
                const textArr = recLines.map(l => String(l.text || '').trim()).filter(Boolean);
                const joinedTxt = textArr.join('\n');
                if (!joinedTxt) return;
                S.project.lyrics = joinedTxt;
                if ($('lyrics')) $('lyrics').value = joinedTxt;
                S.project.timing.lineTimes = {};
                S.project.timing.wordTimes = {};
                S.project.timing.lineMeta = {};
                const useLang = J.resolveLang(S.project) || 'auto';
                recLines.forEach((l, ri) => {
                  const s = +Number(l.start || 0).toFixed(3);
                  const e = +Math.max(s + 0.25, Number(l.end) || (s + 2.5)).toFixed(3);
                  S.project.timing.lineTimes[ri] = s;
                  let words = Array.isArray(l.words) ? l.words : [];
                  if (words.length && J.refineWordTimingsAcoustic) {
                    words = J.refineWordTimingsAcoustic(S.audio, words, s, e, useLang, l.speaker || 'Lead');
                  }
                  if (words.length && J.optimizeLineVocalCoordination) {
                    words = J.optimizeLineVocalCoordination(S.audio, words, s, e, useLang, l.speaker || 'Lead');
                  }
                  if (words.length) S.project.timing.wordTimes[ri] = words;
                  S.project.timing.lineMeta[ri] = {
                    section: l.section || 'verse',
                    vocalType: l.vocalType || 'singing',
                    language: l.language || useLang,
                    speaker: l.speaker || 'Lead',
                    recognitionConfidence: l.recognitionConfidence ?? 0.9,
                    alignmentConfidence: l.alignmentConfidence ?? 0.88,
                  };
                });
                S.project.detection = Object.assign({}, S.project.detection || {}, { source: 'neural_whisper' });
                replan(); flushSave(); syncUI(); seek(0);
                recordWork('ai_transcribe', 'sync', `${recLines.length} lignes (Whisper)`);
                toast(isFr ? `🎤 ${recLines.length} paroles IA appliquées & synchronisées !` : isEn ? `🎤 Applied & synced ${recLines.length} AI lyrics!` : `🎤 已套用並同步 ${recLines.length} 句 AI 歌詞！`);
              } : null,
            });
          } else if (aligned && aligned.requiresBilling) {
            showAiVoiceActionBar({
              message: isFr
                ? `✅ Calage vocal acoustique appliqué (${lineCount} lignes${cohNote}). Astuce : pour générer ou corriger automatiquement des paroles manquantes, utilisez la Reconnaissance Vocale en direct :`
                : isEn
                ? `✅ Acoustic Voice Sync applied (${lineCount} lines${cohNote}). Tip: use Live Voice Mic to dictate/sing new lines instantaneously:`
                : `✅ 已完成本地人聲聲學逐詞同步（${lineCount} 句${cohNote}）。提示：可用下方即時麥克風補錄歌詞：`,
              showAcousticAlign: false,
            });
          }
        } else {
          toast(isFr ? 'Échec de la synchronisation vocale' : isEn ? 'Could not synchronize vocals' : '未能成功识别人声同步');
        }
      } catch (err) {
        toast((isFr ? 'Erreur de synchro : ' : isEn ? 'Sync error: ' : '同步出错: ') + (err && err.message ? err.message : ''));
      } finally {
        if (S.syncTask && S.syncTask.controller === controller) S.syncTask = null;
        bvsLbl.textContent = origTxt;
        syncAiActionButtonsState();
        if (liveEl) liveEl.hidden = true;
        if (pBox && !(activeVoiceController && activeVoiceController.isActive())) {
          setTimeout(() => { if (!S.syncTask) pBox.hidden = true; }, syncDone ? 650 : 200);
        }
      }
    });
  }
  const tapBtn = $('tapBtn');
  if (tapBtn) {
    tapBtn.addEventListener('pointerdown', e => {
      if (e.button && e.button !== 0) return;
      e.preventDefault();
      tapNow();
    });
    tapBtn.addEventListener('pointerup', () => {
      if (S.tap && S.tap.holding && S.tap.holdEnd) tapEndHold(false);
    });
    tapBtn.addEventListener('pointercancel', () => {
      if (S.tap && S.tap.holding && S.tap.holdEnd) tapEndHold(false);
    });
    // Keyboard accessibility fallback if a click event is synthesized programmatically without pointerdown
    tapBtn.addEventListener('click', e => {
      if (e.detail === 0) tapNow();
    });
  }
  if ($('tapMode')) $('tapMode').addEventListener('change', () => {
    saveTapOpts();
    if (!S.tap) return;
    S.tap.mode = $('tapMode').value;
    S.tap.wi = 0;
    updateTap();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapRate')) $('tapRate').addEventListener('change', () => {
    saveTapOpts();
    if (!S.tap) return;
    S.tap.rate = +$('tapRate').value || 1;
    if (S.playing) seek(S.t);                 // restart at the new speed from where it is
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapSnapMode')) $('tapSnapMode').addEventListener('change', () => {
    saveTapOpts();
    if (!S.tap) return;
    S.tap.snapMode = $('tapSnapMode').value;
    updateTap();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapLatency')) $('tapLatency').addEventListener('change', () => {
    saveTapOpts();
    if (!S.tap) return;
    const raw = String($('tapLatency').value || 'auto');
    S.tap.latencyMode = raw;
    S.tap.latencyMs = raw === 'auto' ? S.tap.learnedLatMs : (+raw || 0);
    updateTapCoordBadge();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapAutoMicro')) $('tapAutoMicro').addEventListener('change', () => {
    saveTapOpts();
    if (S.tap) S.tap.autoMicro = !!$('tapAutoMicro').checked;
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapMicroAlign')) $('tapMicroAlign').addEventListener('click', () => {
    microAlignTapPhrase();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapShiftEarly')) $('tapShiftEarly').addEventListener('click', () => {
    shiftTapPhraseWords(-25);
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapShiftLate')) $('tapShiftLate').addEventListener('click', () => {
    shiftTapPhraseWords(25);
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapLoopLine')) $('tapLoopLine').addEventListener('click', () => {
    toggleTapLoop();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapAssistRest')) $('tapAssistRest').addEventListener('click', () => {
    assistRemainingTapLines();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapHoldEnd')) $('tapHoldEnd').addEventListener('change', () => {
    saveTapOpts();
    if (!S.tap) return;
    S.tap.holdEnd = $('tapHoldEnd').checked;
    updateTap();
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapCount')) $('tapCount').addEventListener('change', () => { saveTapOpts(); if ($('tapBtn')) $('tapBtn').focus(); });
  if ($('tapClick')) $('tapClick').addEventListener('change', () => {
    saveTapOpts();
    if (S.tap) S.tap.click = $('tapClick').checked;
    if ($('tapBtn')) $('tapBtn').focus();
  });
  if ($('tapMarkEnd')) $('tapMarkEnd').addEventListener('click', () => { tapEndHold(true); if ($('tapBtn')) $('tapBtn').focus(); });
  if ($('tapPlayPause')) $('tapPlayPause').addEventListener('click', toggleTapPause);
  if ($('tapRewind')) $('tapRewind').addEventListener('click', tapRewind);
  if ($('tapSkip')) $('tapSkip').addEventListener('click', () => { tapSkip(); if ($('tapBtn')) $('tapBtn').focus(); });
  $('tapStop').addEventListener('click', () => { pause(); stopTap(); });
  $('btnPlay').addEventListener('click', () => (S.playing ? pause() : play()));
  if ($('kpBtnPlay')) $('kpBtnPlay').addEventListener('click', () => (S.playing ? pause() : play()));
  if ($('kpBtnPrev')) $('kpBtnPrev').addEventListener('click', () => jumpLyricLine(-1));
  if ($('kpBtnNext')) $('kpBtnNext').addEventListener('click', () => jumpLyricLine(1));
  if ($('kpSpeedSel')) $('kpSpeedSel').addEventListener('change', e => setPlaybackRate(parseFloat(e.target.value) || 1));
  if ($('kpStageBtnVideo')) $('kpStageBtnVideo').addEventListener('click', () => setKpStageMode('video'));
  if ($('kpStageBtnVisual')) $('kpStageBtnVisual').addEventListener('click', () => setKpStageMode('visual'));
  if ($('kpDeckArtBtn')) $('kpDeckArtBtn').addEventListener('click', () => setKpStageMode(S.kpStageMode === 'visual' ? 'video' : 'visual'));
  if ($('kpArtFile')) $('kpArtFile').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) loadKaraokeArtwork(f); });
  if ($('kpBtnHighlightCfg')) {
    $('kpBtnHighlightCfg').addEventListener('click', () => {
      const dr = $('karaokeControls'), cfgBtn = $('btnKaraokeCfg'), kpCfg = $('kpBtnHighlightCfg');
      if (!dr) return;
      dr.hidden = !dr.hidden;
      const open = String(!dr.hidden);
      if (cfgBtn) cfgBtn.setAttribute('aria-expanded', open);
      if (kpCfg) kpCfg.setAttribute('aria-expanded', open);
    });
  }
  if ($('kpBtnFs')) $('kpBtnFs').addEventListener('click', () => toggleKaraokeFullscreen());
  const kpSc = $('kpProgress');
  if (kpSc) {
    kpSc.addEventListener('input', () => { S.scrubbing = true; seek(kpSc.value / 10000 * S.plan.duration); });
    kpSc.addEventListener('change', () => { S.scrubbing = false; });
  }
  const cutPickAuto = $('cutPickAuto'), cutPickClose = $('cutPickClose');
  if (cutPickClose) cutPickClose.addEventListener('click', () => { closeCutPick(); updateCutInfo(); });
  if (cutPickAuto) cutPickAuto.addEventListener('click', () => {
    if (!cutPick.g) return;
    setCutTech(cutPick.line, cutPick.k, cutPick.g, '');
    replan();
  });
  $('btnLoop').addEventListener('click', () => {
    const i = LOOP_CYCLE.indexOf(S.loop);
    S.loop = LOOP_CYCLE[(i < 0 ? 0 : i + 1) % LOOP_CYCLE.length];
    syncLoopBtn(); S.need = true;
  });
  $('btnShuffle').addEventListener('click', () => { remember(); S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); commit(); });
  const sc = $('scrub');
  sc.addEventListener('input', () => { S.scrubbing = true; seek(sc.value / 10000 * S.plan.duration); });
  sc.addEventListener('change', () => { S.scrubbing = false; });
  const tl = $('timeline');
  let drag = false, raf = 0;
  tl.addEventListener('pointerdown', e => {
    if (tl.setPointerCapture) { try { tl.setPointerCapture(e.pointerId); } catch (err) {} }
    if (!S.tap && !S.exporting) {
      const h = tlHandleAt(e);
      if (h >= 0) { pushEdit(); TL.drag = h; pause(); tl.style.cursor = 'ew-resize'; return; }
      const wh = tlWHandleAt(e);
      if (wh) { pushEdit(); TL.wDrag = wh; selectLyricWord(wh.lineIdx, wh.wordIdx, false); pause(); tl.style.cursor = 'ew-resize'; return; }
      const wb = tlWordBoxAt(e);
      if (wb) {
        if (wb.lineIdx !== EDL.lineIdx || wb.wordIdx !== EDL.wordIdx) selectLyricWord(wb.lineIdx, wb.wordIdx, false);
        if (wb.charIdx >= 0) { TL.selCharIdx = wb.charIdx; syncTimelineInspector(); drawTimeline(); }
      }
    }
    drag = true; timelineSeek(e);
  });
  tl.addEventListener('pointermove', e => {
    if (TL.drag >= 0) { const ev = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => tlDragTo(TL.drag, ev)); return; }
    if (TL.wDrag) { const ev = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => tlDragWordTo(TL.wDrag, ev)); return; }
    if (drag) { timelineSeek(e); return; }
    const hv = tlHandleAt(e);
    const whv = hv < 0 ? tlWHandleAt(e) : null;
    const wChanged = JSON.stringify(whv) !== JSON.stringify(TL.wHover);
    if (hv !== TL.hover || wChanged) {
      TL.hover = hv; TL.wHover = whv;
      tl.style.cursor = (hv >= 0 || whv) ? 'ew-resize' : 'pointer';
      drawTimeline();
    }
  });
  const endDrag = () => {
    const hadWordDrag = !!TL.wDrag;
    if (TL.drag >= 0 || TL.wDrag) {
      TL.drag = -1; TL.wDrag = null;
      if (hadWordDrag) { refreshStage6Validation(); replan(); }
      flushSave(); renderLines(); syncLyricsEditor(); drawTimeline();
    }
    drag = false;
  };
  tl.addEventListener('pointerup', endDrag); tl.addEventListener('pointercancel', endDrag);
  tl.addEventListener('pointerleave', () => { if ((TL.hover >= 0 || TL.wHover) && TL.drag < 0 && !TL.wDrag) { TL.hover = -1; TL.wHover = null; drawTimeline(); } });
  tl.addEventListener('wheel', e => {
    e.preventDefault();
    const { vd } = tlView();
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { TL.off += (e.shiftKey ? e.deltaY : e.deltaX) / tl.clientWidth * vd; tlView(); drawTimeline(); }
    else tlZoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)), tlTime(e));
  }, { passive: false });
  $('tlIn').addEventListener('click', () => tlZoom(1.6));
  $('tlOut').addEventListener('click', () => tlZoom(1 / 1.6));
  $('tlFit').addEventListener('click', () => { TL.z = 1; TL.off = 0; drawTimeline(); });
  if ($('tlZoomWord')) $('tlZoomWord').addEventListener('click', () => tlFocusWord());
  if ($('tlShowWave')) $('tlShowWave').addEventListener('change', e => { TL.showWave = !!e.target.checked; drawTimeline(); });
  if ($('tlShowVocal')) $('tlShowVocal').addEventListener('change', e => { TL.showVocal = !!e.target.checked; drawTimeline(); });
  if ($('tlFollow')) $('tlFollow').addEventListener('change', e => { TL.follow = !!e.target.checked; });
  if ($('tlPlayWordBtn')) $('tlPlayWordBtn').addEventListener('click', () => {
    const words = getEditableWords(EDL.lineIdx);
    const w = words[EDL.wordIdx];
    if (w) playRange(Math.max(0, w.start - 0.12), w.end + 0.12);
  });
  if ($('tlReanalyzeBtn')) $('tlReanalyzeBtn').addEventListener('click', () => reanalyzeLowConfidenceUI(EDL.lineIdx));
  if ($('btnAutoQcPerform')) $('btnAutoQcPerform').addEventListener('click', () => autoOptimizeQcAndCoordinationUI());
  if ($('btnReanalyzeLow')) $('btnReanalyzeLow').addEventListener('click', () => reanalyzeLowConfidenceUI(null));
  if ($('btnNextLowConf')) $('btnNextLowConf').addEventListener('click', () => jumpToNextLowConfWord());
  const bindTlMsInput = (id, edge) => {
    const inp = $(id);
    if (!inp) return;
    const commitMs = () => {
      const parsed = J.parseTimeMs ? J.parseTimeMs(inp.value) : parseFloat(inp.value);
      if (parsed == null) { syncTimelineInspector(); return; }
      applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, edge, parsed);
    };
    inp.addEventListener('change', commitMs);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitMs(); inp.blur(); } });
  };
  bindTlMsInput('tlWordStartMs', 'start');
  bindTlMsInput('tlWordEndMs', 'end');
  document.querySelectorAll('#tlInspector [data-tl-nudge]').forEach(btn => {
    btn.addEventListener('click', () => {
      const edge = btn.dataset.tlNudge === 'start' ? 'start' : 'end';
      const delta = parseFloat(btn.dataset.delta) || 0;
      const words = getEditableWords(EDL.lineIdx);
      const w = words[EDL.wordIdx]; if (!w) return;
      const base = edge === 'start' ? Number(w.start) : Number(w.end);
      applyWordTimeBoundary(EDL.lineIdx, EDL.wordIdx, edge, +(base + delta).toFixed(3));
    });
  });
  const btnUndoEdit = $('btnUndoEdit'); if (btnUndoEdit) btnUndoEdit.addEventListener('click', () => edGo(-1));
  const tapBackBtn = $('tapBack'); if (tapBackBtn) tapBackBtn.addEventListener('click', tapBack);
  bindLyricsEditor();
  bindRangeUI();
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', String(x === b)));
    document.querySelectorAll('.tabpane').forEach(p => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    if (b.dataset.tab === 'out') codecNote();
    if (b.dataset.tab === 'tech') kickPreviewLoop();
    loadThumbFonts();
    syncSlidingMenus(true);
  }));
  $('fxFlash').addEventListener('change', e => { S.project.fx.flash = e.target.checked; replan(); });
  $('techFilter').addEventListener('input', () => renderTech());
  const setSwitch = (cls, key, on, msgOn, msgOff) => document.querySelectorAll('.' + cls).forEach(el => el.addEventListener('change', e => {
    remember();
    S.project[key] = e.target.checked;
    document.querySelectorAll('.' + cls).forEach(x => { x.checked = e.target.checked; });
    renderTech(); drawStyleGrid(); replan(); commit(); flushSave();
    toast(e.target.checked ? msgOn : msgOff);
  }));
  setSwitch('extra-toggle', 'extra', true, '追加分の演出：使う', '追加分の演出：使わない（最初の公開版の演出だけ）');
  setSwitch('wa-toggle', 'wa', true, '和風の演出：使う', '和風の演出：使わない（おまかせ・シャッフルで選ばれません）');
  setSwitch('typo-toggle', 'typo', true, '文字PV系の部品：使う', '文字PV系の部品：使わない（おまかせ・シャッフルで選ばれません）');
  setSwitch('kinetic-toggle', 'kinetic', true, 'キネティックの部品：使う', 'キネティックの部品：使わない（おまかせ・シャッフルで選ばれません）');
  setSwitch('extra2-toggle', 'extra2', true, '追加分2の演出：使う', '追加分2の演出：使わない');
  setSwitch('horror-toggle', 'horror', true, 'ホラーの演出：使う（おまかせの雰囲気に「ホラー」が加わります）', 'ホラーの演出：使わない');
  setSwitch('unify-toggle', 'unify', true, '統一感：オン（パートごとにそろえ、キメ・モーフ・太さも使います）', '統一感：オフ');
  setSwitch('typeset-toggle', 'typeset', true, '文字整列：オン（字間・助詞・英字・0.2秒先・効果控えめ）', '文字整列：オフ');
  $('fxKoma').addEventListener('change', e => { const k = +e.target.value; S.project.fx.koma = k; S.project.fx.onTwos = k > 0; S.project.mood = null; replan(); });
  $('fxHud').addEventListener('change', e => { S.project.fx.hud = e.target.value; replan(); });
  $('fxHideNo').addEventListener('change', e => { remember(); S.project.fx.hideNo = e.target.checked; replan(); commit(); });
  $('fxHideTime').addEventListener('change', e => { remember(); S.project.fx.hideTime = e.target.checked; replan(); commit(); });
  $('seed').addEventListener('change', e => { S.project.seed = parseInt(e.target.value, 10) || 0; replan(); });
  $('btnSeed').addEventListener('click', () => { S.project.seed = (Math.random() * 1e9) | 0; $('seed').value = S.project.seed; replan(); });
  const colorToggle = (flag, keys) => e => {
    remember();
    const c = S.project.colors; c[flag] = e.target.checked;
    if (c[flag]) { const sc0 = J.STYLES[S.project.style].schemes[0]; keys.forEach(([k]) => { if (!c[k]) c[k] = sc0[k]; }); }
    renderColors(); replan(); commit();
  };
  $('colorOn').addEventListener('change', colorToggle('enabled', BASE_KEYS));
  $('accentOn').addEventListener('change', colorToggle('accentOn', ACCENT_KEYS));
  $('btnRandPalette').addEventListener('click', randomPalette);
  $('btnAddFont').addEventListener('click', () => {
    const name = $('localFont').value.trim(); if (!name) return;
    const key = 'local_' + name.replace(/\s+/g, '_');
    const weight = /bold|太|black|heavy|w[6-9]|[6-9]00/i.test(name) ? 700 : 400;
    J.addUserFont(key, name + '（PC）', name, weight);
    S.project.userFonts = (S.project.userFonts || []).filter(u => u.key !== key).concat([{ key, label: name + '（PC）', family: name, weight }]);
    S.project.fonts.display = key; $('localFont').value = '';
    fontKey = ''; renderFontRoles(); replan();
  });
  $('fontFile').addEventListener('change', async e => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const uf = await J.loadFontFile(f);
      S.project.userFonts = (S.project.userFonts || []).filter(x => x.key !== uf.key).concat([uf]);
      S.project.fonts.display = uf.key; fontKey = ''; renderFontRoles(); replan(); flushSave();
    }
    catch (err) { showMsg('フォントを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
  });
  ['outAspect', 'eAspect'].forEach(id => $(id).addEventListener('change', e => { S.project.aspect = e.target.value; syncOut(); replan(); codecNote(); }));
  ['outRes', 'eRes'].forEach(id => $(id).addEventListener('change', e => { S.project.res = +e.target.value; syncOut(); autosave(); codecNote(); }));
  ['outFps', 'eFps'].forEach(id => $(id).addEventListener('change', e => { S.project.fps = +e.target.value; syncOut(); replan(); codecNote(); }));
  $('outQuality').addEventListener('change', e => { S.project.quality = e.target.value; autosave(); });
  ['outKey', 'eKey'].forEach(id => $(id).addEventListener('change', e => {
    S.project.keyBg = e.target.value; syncOut(); replan(); flushSave();
    const k = J.keyMode(S.project);
    toast(k ? `背景：${k === 'green' ? 'グリーンバック' : 'ブラックバック'}（白い文字と演出だけ）` : '背景：通常（スタイルの配色）');
  }));
  $('outAudio').addEventListener('change', e => { S.project.includeAudio = e.target.checked; autosave(); });
  document.querySelectorAll('.centerDirSel').forEach(el => el.addEventListener('change', e => {
    S.project.centerDir = e.target.value; syncOut(); replan(); flushSave();
    toast(e.target.value === 'lr' ? '縦長の画面：左右に分けます' : '縦長の画面：上下に分けます');
  }));
  ['outCenter', 'eCenter'].forEach(id => $(id).addEventListener('change', e => {
    S.project.centerFree = e.target.checked; syncOut(); replan(); flushSave();
    const tall = S.plan.H > S.plan.W * 1.1 && S.project.centerDir !== 'lr';
    toast(e.target.checked ? `中央を空けました：文字と演出を${tall ? '上下' : '左右'}に置きます` : '中央を空けるのをやめました');
  }));
  $('btnMP4').addEventListener('click', () => runExport('mp4'));
  ['btnMP4File', 'eMP4File'].forEach(id => $(id).addEventListener('click', () => runExport('mp4file')));
  $('btnPNG').addEventListener('click', () => runExport('png'));
  $('btnPNGA').addEventListener('click', () => runExport('pnga'));
  $('btnPNGL').addEventListener('click', () => runExport('pngl'));
  $('ePNG').addEventListener('click', () => runExport('png'));
  $('ePNGA').addEventListener('click', () => runExport('pnga'));
  $('ePNGL').addEventListener('click', () => runExport('pngl'));
  document.querySelectorAll('.exp-cancel').forEach(b => b.addEventListener('click', () => { if (S.exporting) S.exporting.abort(); }));
  $('eMP4').addEventListener('click', () => runExport('mp4'));
  // かんたんモード
  $('modeEasy').addEventListener('click', () => setMode('easy'));
  $('modeMobile').addEventListener('click', () => setMode('mobile'));
  $('btnOmakaseTop').addEventListener('click', omakase);
  $('btnMenu').addEventListener('click', () => { const on = !$('app').classList.contains('menu-open'); $('app').classList.toggle('menu-open', on); $('btnMenu').setAttribute('aria-expanded', String(on)); mobileBar(); });
  document.querySelectorAll('.sec > .sec-h h2').forEach(h => h.addEventListener('click', () => { if (S.mode === 'mobile') h.closest('.sec').classList.toggle('fold'); }));
  if (window.ResizeObserver && document.querySelector('.bar')) {
    let barRaf = 0;
    new ResizeObserver(() => {
      if (barRaf) return;
      barRaf = requestAnimationFrame(() => { barRaf = 0; mobileBar(); });
    }).observe(document.querySelector('.bar'));
  }
  $('modePro').addEventListener('click', () => setMode('pro'));
  $('btnOmakase').addEventListener('click', omakase);
  $('btnOmakaseBig').addEventListener('click', omakase);
  ['btnPrev', 'btnPrev2'].forEach(id => $(id).addEventListener('click', () => histGo(-1)));
  ['btnNext', 'btnNext2'].forEach(id => $(id).addEventListener('click', () => histGo(1)));
  $('eStyle').addEventListener('click', () => rerollPart('style'));
  $('eMood').addEventListener('click', () => rerollPart('mood'));
  $('eCut').addEventListener('click', () => rerollPart('cut'));
  $('ePalette').addEventListener('click', () => { randomPalette(); restartPreview(); });
  // À propos (présentation, droits, confidentialité & licences)
  const dlg = $('termsDlg');
  const applyTermsCopy = () => {
    const lang = document.documentElement.lang || 'fr';
    const setEl = (id, val) => { const el = $(id); if (el && val != null) el.textContent = val; };
    const copy = lang === 'en' ? {
      title: 'About Alexura Motion Studio',
      meta: 'Version @VERSION@ · Lyric Video & Vocal Sync Studio · MIT License',
      lead: 'Alexura Motion Studio turns songs and lyrics into animated lyric videos, live karaoke prompters and precision motion projects right in your browser — with acoustic vocal alignment, curated visual themes and export up to 4K 60 fps.',
      rT: 'Creation & export rights',
      rB: 'All exported videos (MP4), transparent PNG sequences, subtitles (LRC, SRT, VTT, JSON) and After Effects project data belong 100% to you, including for commercial use. Imported audio and lyrics remain the property of their rights holders.',
      pT: 'Privacy & data processing',
      pB: 'Audio playback, Canvas/WebCodecs video rendering, MP4 export and local drafts run 100% in your browser. Connected features (Cloud AI transcription/alignment, Google Firebase save, studio weather) only run when explicitly triggered.',
      tT: 'Vocal sync & creative engine',
      tB: '10 ms acoustic vocal onset alignment, guided Tap Sync studio, progressive word-by-word karaoke prompter and 17+ curated visual universes (Trap Soul, R&B, Hip-Hop, Pop, Cinematic, Art & Motion).',
      cT: 'Professional formats & workflow',
      cB: 'Direct-to-disk MP4 export (Chrome / Edge recommended), transparent PNG layers, green/black key backgrounds, word-level Enhanced LRC and structured export for Adobe After Effects.',
      ossSum: 'MIT License & open-source components',
      ossDeps: 'MP4 export: mp4-muxer (MIT License) · Local speech engine: Transformers.js / Whisper · Typefaces: Google Fonts (SIL Open Font License 1.1) · Optional cloud sync: Firebase SDK.',
      noticeBtn: 'Open User Guide',
      closeBtn: 'Close',
    } : lang === 'ja' ? {
      title: 'Alexura Motion Studio について',
      meta: 'バージョン @VERSION@ · 歌詞モーション＆ボーカル同期スタジオ · MIT ライセンス',
      lead: 'Alexura Motion Studio は、楽曲と歌詞からアニメーション歌詞動画やリアルタイムカラオケをブラウザ上で制作し、最大 4K 60fps の MP4 や After Effects 用データとして書き出せるスタジオです。',
      rT: '制作物と商用利用の権利',
      rB: 'このツールで書き出した動画（MP4）・透過 PNG・字幕（LRC / SRT / VTT / JSON）・AE 用データの権利は制作者本人に帰属します。使用した楽曲や歌詞の権利は各権利者に帰属します。',
      pT: 'プライバシーと処理について',
      pB: '音声再生・映像描画・MP4 書き出し・ローカル下書きはお使いのブラウザ内で完結します。クラウド AI 解析・Google Firebase 保存・天気機能はユーザーが実行した時のみ通信します。',
      tT: 'ボーカル同期と演出エンジン',
      tB: '10ms 単位の声頭アタック検出、タップ同期スタジオ、単語単位カラオケプロンプター、17 以上の専用テーマ（Trap Soul / R&B / Hip-Hop / Pop / Cinematic / Art & Motion）を搭載しています。',
      cT: '対応フォーマットとプロ仕様',
      cB: 'ディスク直接書き込み対応 MP4（Chrome / Edge 推奨）、背景透過 PNG 連番、グリーン／ブラックバック合成、単語同期 Enhanced LRC、After Effects 構成書き出しに対応。',
      ossSum: 'MIT ライセンス・使用オープンソース',
      ossDeps: 'MP4 書き出し：mp4-muxer（MIT License） · ローカル音声認識：Transformers.js / Whisper · 書体：Google Fonts（SIL OFL 1.1） · 任意保存：Firebase SDK',
      noticeBtn: '使い方ガイドを開く',
      closeBtn: '閉じる',
    } : (lang === 'zh-Hans' || lang === 'zh-Hant') ? {
      title: lang === 'zh-Hans' ? '关于 Alexura Motion Studio' : '關於 Alexura Motion Studio',
      meta: lang === 'zh-Hans' ? '版本 @VERSION@ · 歌词动态视频与人声同步工作室 · MIT 许可' : '版本 @VERSION@ · 歌詞動態影片與人聲同步工作室 · MIT 授權',
      lead: lang === 'zh-Hans'
        ? 'Alexura Motion Studio 可直接在浏览器中将歌曲与歌词制作成动态歌词 MV、实时卡拉 OK 提词器与高精度排版作品，支持人声智能对齐与最高 4K 60fps MP4 导出。'
        : 'Alexura Motion Studio 可直接在瀏覽器中將歌曲與歌詞製作成動態歌詞 MV、即時卡拉 OK 提詞器與高精度排版作品，支援人聲智慧對齊與最高 4K 60fps MP4 匯出。',
      rT: lang === 'zh-Hans' ? '创作成果与版权归属' : '創作成果與版權歸屬',
      rB: lang === 'zh-Hans'
        ? '您导出的全部视频（MP4）、透明 PNG 序列、字幕（LRC/SRT/VTT/JSON）及 AE 工程数据均完全归创作者所有，可用于商业发布；所用歌曲与歌词版权仍归原权利人所有。'
        : '您匯出的全部影片（MP4）、透明 PNG 序列、字幕（LRC/SRT/VTT/JSON）與 AE 工程資料均完全歸創作者所有，可用於商業發布；所用歌曲與歌詞版權仍歸原權利人所有。',
      pT: lang === 'zh-Hans' ? '隐私与数据处理' : '隱私與資料處理',
      pB: lang === 'zh-Hans'
        ? '音频播放、画面渲染、MP4 导出与本地草稿均在您的浏览器本地完成；仅在您主动触发时才会调用云端 AI 识别、Firebase 云端保存或天气组件。'
        : '音訊播放、畫面算圖、MP4 匯出與本地草稿均在您的瀏覽器本地完成；僅在您主動觸發時才會呼叫雲端 AI 辨識、Firebase 雲端儲存或天氣模組。',
      tT: lang === 'zh-Hans' ? '人声同步与视觉引擎' : '人聲同步與視覺引擎',
      tB: lang === 'zh-Hans'
        ? '提供 10ms 声学人声起音对齐、敲击对拍工作室、逐词渐进卡拉 OK 与 17+ 专属艺术主题（Trap Soul、R&B、Hip-Hop、Pop、Cinematic、Art & Motion）。'
        : '提供 10ms 聲學人聲起音對齊、點擊對拍工作室、逐詞漸進卡拉 OK 與 17+ 專屬藝術主題（Trap Soul、R&B、Hip-Hop、Pop、Cinematic、Art & Motion）。',
      cT: lang === 'zh-Hans' ? '专业导出格式' : '專業匯出格式',
      cB: lang === 'zh-Hans'
        ? '支持直写磁盘的大文件 MP4（推荐 Chrome / Edge）、透明背景 PNG 分层、绿幕/黑底抠像、逐词 Enhanced LRC 与 Adobe After Effects 导出。'
        : '支援直寫磁碟的大檔案 MP4（建議 Chrome / Edge）、透明背景 PNG 分層、綠幕/黑底去背、逐詞 Enhanced LRC 與 Adobe After Effects 匯出。',
      ossSum: lang === 'zh-Hans' ? 'MIT 许可与开源组件' : 'MIT 授權與開源元件',
      ossDeps: 'MP4 : mp4-muxer (MIT) · Whisper : Transformers.js · Fonts : Google Fonts (SIL OFL 1.1) · Cloud : Firebase SDK',
      noticeBtn: lang === 'zh-Hans' ? '查看使用指南' : '查看使用指南',
      closeBtn: lang === 'zh-Hans' ? '关闭' : '關閉',
    } : null;

    if (copy) {
      setEl('termsTitle', copy.title);
      setEl('termsMetaLine', copy.meta);
      setEl('termsLead', copy.lead);
      setEl('termsRightsTitle', copy.rT);
      setEl('termsRightsBody', copy.rB);
      setEl('termsPrivacyTitle', copy.pT);
      setEl('termsPrivacyBody', copy.pB);
      setEl('termsTechTitle', copy.tT);
      setEl('termsTechBody', copy.tB);
      setEl('termsCompatTitle', copy.cT);
      setEl('termsCompatBody', copy.cB);
      setEl('termsOssSummary', copy.ossSum);
      setEl('termsOssDeps', copy.ossDeps);
      setEl('btnTermsNotice', copy.noticeBtn);
      setEl('btnTermsClose', copy.closeBtn);
    } else {
      setEl('btnTermsClose', 'Fermer');
    }
  };
  applyTermsCopy();
  const openTerms = () => {
    applyTermsCopy();
    if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  };
  document.querySelectorAll('.terms-open').forEach(b => b.addEventListener('click', openTerms));
  if ($('btnTermsNotice')) {
    $('btnTermsNotice').addEventListener('click', () => {
      if (dlg.close && dlg.open) dlg.close();
      else dlg.removeAttribute('open');
      openNotice();
    });
  }
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close ? dlg.close() : dlg.removeAttribute('open'); });   // click on the backdrop
  $('btnSave').addEventListener('click', () => {
    const fn = baseName() + '.jizura.json';
    J.saveFile(fn, JSON.stringify(Object.assign({}, S.project, { appVersion: '@VERSION@' }), null, 1));
    recordWork('export_json', 'export', fn);
  });
  $('btnAE').addEventListener('click', () => {
    const fn = baseName() + rangeSuffix() + '_ae.json';
    J.saveFile(fn, JSON.stringify(J.planForAE(S.plan, S.project, exportRange()), null, 1));
    recordWork('export_ae', 'export', fn);
  });
  syncMainStudioLabels();
  $('btnClearLyrics').addEventListener('click', clearLyrics);
  document.querySelectorAll('.themeSel').forEach(el => el.addEventListener('change', () => {
    S.project.themeId = J.THEMES[el.value] ? el.value : null;
    if (S.project.themeId && STYLE_CAT_META.some(([c]) => c === S.project.themeId)) styleCatFilter = S.project.themeId;
    else if (!S.project.themeId) styleCatFilter = 'all';
    document.querySelectorAll('.themeSel').forEach(x => { x.value = el.value; });
    if (S.project.themeId && !S.exporting && !S.tap) omakase();
    else { syncThemeMeta(); drawStyleGrid(); flushSave(); }
  }));
  $('fileLrc').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; openLyricFile(f); });
  if ($('expIncludeTrans')) $('expIncludeTrans').addEventListener('change', e => {
    e.target.dataset.userTouched = '1';
    if ($('quickExpTransChk')) { $('quickExpTransChk').checked = e.target.checked; $('quickExpTransChk').dataset.userTouched = '1'; }
  });
  if ($('quickExpTransChk')) $('quickExpTransChk').addEventListener('change', e => {
    e.target.dataset.userTouched = '1';
    if ($('expIncludeTrans')) { $('expIncludeTrans').checked = e.target.checked; $('expIncludeTrans').dataset.userTouched = '1'; }
  });
  document.querySelectorAll('#quickExportLyrics [data-exp-fmt]').forEach(btn => {
    btn.addEventListener('click', () => saveSyncedLyrics(btn.dataset.expFmt || 'lrc'));
  });
  ['btnLRC', 'eLRC'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('lrc')); });
  ['btnExpSRT', 'eSRT'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('srt')); });
  ['btnExpVTT', 'eVTT'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('vtt')); });
  ['btnExpELRC', 'eELRC'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('elrc')); });
  ['btnExpJSON', 'eJSON'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('json')); });
  ['btnExpTXT', 'eTXT'].forEach(id => { if ($(id)) $(id).addEventListener('click', () => saveSyncedLyrics('txt')); });
  $('btnReset').addEventListener('click', () => {
    const dlg = $('resetDlg');
    if (!dlg || typeof dlg.showModal !== 'function') { if (window.confirm('歌詞・曲・設定・履歴をすべて消して、最初の状態に戻します。元に戻すことはできません。')) resetAll(); return; }
    dlg.returnValue = ''; dlg.showModal();
  });
  $('resetDlg').addEventListener('close', () => { if ($('resetDlg').returnValue === 'reset') resetAll(); });
  $('fileProject').addEventListener('change', async e => { const f = e.target.files && e.target.files[0]; await openProjectFile(f); e.target.value = ''; });
  document.addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    const typing = /INPUT|TEXTAREA|SELECT/.test(tag) && e.target.type !== 'range' && e.target.type !== 'checkbox';
    if (S.tap && (e.code === 'Space' || e.code === 'Enter') && !typing) { e.preventDefault(); if (!e.repeat) tapNow(); return; }
    if (S.tap && e.code === 'KeyE' && !typing) { e.preventDefault(); if (!e.repeat) tapEndHold(true); return; }
    if (S.tap && e.code === 'KeyP' && !typing) { e.preventDefault(); toggleTapPause(); return; }
    if (S.tap && e.code === 'KeyS' && !typing) { e.preventDefault(); tapSkip(); return; }
    if (S.tap && e.code === 'ArrowLeft' && !typing) { e.preventDefault(); tapRewind(); return; }
    if (S.tap && e.code === 'Escape') { pause(); stopTap(); return; }
    if (e.code === 'Escape' && document.querySelector('.col-stage.is-karaoke-fs')) { e.preventDefault(); toggleKaraokeFullscreen(false); return; }
    if (S.tap && e.code === 'Backspace' && !typing) { e.preventDefault(); tapBack(); return; }
    if (S.tap && e.code === 'Tab' && !typing) { e.preventDefault(); tapCut(); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ' && !typing && !S.tap) { e.preventDefault(); edGo(e.shiftKey ? 1 : -1); return; }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY' && !typing && !S.tap) { e.preventDefault(); edGo(1); return; }
    if (typing || $('termsDlg').open || $('resetDlg').open || ($('cloudDlg') && $('cloudDlg').open) || ($('noticeDlg') && $('noticeDlg').open)) return;
    if (e.code === 'Space') { e.preventDefault(); S.playing ? pause() : play(); }
    else if (e.code === 'ArrowRight') seek(S.t + (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'ArrowLeft') seek(S.t - (e.shiftKey ? 1 : 1 / S.plan.fps));
    else if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey && !e.altKey && !S.exporting) { e.preventDefault(); omakase(); }
    else if (e.code === 'KeyD' && !e.metaKey && !e.ctrlKey && !e.altKey) { const i = lineAtPlayhead(); if (i >= 0) { e.preventDefault(); rerollLine(i); } }
    else if (e.code === 'KeyL' && !e.metaKey && !e.ctrlKey && !e.altKey) { const i = lineAtPlayhead(); if (i >= 0) { e.preventDefault(); toggleLineLock(i); } }
  });
  document.addEventListener('keyup', e => {
    if (S.tap && S.tap.holding && S.tap.holdEnd && (e.code === 'Space' || e.code === 'Enter')) {
      tapEndHold(false);
    }
  });
  window.addEventListener('resize', () => { sizeViewport(); drawTimeline(); });
  if (window.ResizeObserver && $('viewport')) {
    let vpRaf = 0;
    new ResizeObserver(() => {
      if (vpRaf) return;
      vpRaf = requestAnimationFrame(() => { vpRaf = 0; sizeViewport(); drawTimeline(); });
    }).observe($('viewport'));
  }
  bindFollow();
  bindDrop();
}

/* lyric file (.lrc / .txt, or .srt / .vtt subtitles): from the file input or dropped on the window */
async function openLyricFile(f) {
  if (!f || S.tap || S.exporting) return;
  if (f.size > 2e6) { toast('LRC ファイルが大きすぎます'); return; }
  let text = '';
  try { const buf = await f.arrayBuffer(); try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e2) { text = new TextDecoder('shift_jis').decode(buf); } }
  catch (err) { toast('LRC を読み込めませんでした'); return; }
  if (S.project.lyrics.trim() && !window.confirm('今の歌詞を LRC の内容に置き換えます（行ごとの時刻・指定・書き出す範囲も消えます。「元に戻す」で戻せます）。よろしいですか？')) return;
  // SRT / WebVTT subtitles: each block becomes a timed line, and a pause after a block's end time becomes an interlude
  if (J.isSubtitleText(text)) { const sub = J.srtToLyrics(text); if (!sub) { toast('LRC を読み込めませんでした'); return; } loadLrc(sub.lyrics, sub); }
  else loadLrc(text);
}
/* saved project (.json) */
async function openProjectFile(f) {
  if (!f || S.exporting) return;
  try {
    const np = mergeProject(JSON.parse(await f.text()));
    if (S.tap) stopTap();
    pause();
    S.project = np;
    delete S.project.cloudSongId;
    S.cloudSongId = null;
    if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = '';
    // another project: undo and 前の案 / 次の案 belonged to the old one
    ED.undo = []; ED.redo = []; H.list = []; H.i = -1;
    clearQcAutoReport();
    syncUI(); replan(); restoreFonts(); commit(); updateEditBtns(); flushSave();
  }
  catch (err) { showMsg('プロジェクトを読み込めませんでした'); setTimeout(() => showMsg(null), 2500); }
}
/* files dropped anywhere on the window: a song, lyrics (LRC / SRT / VTT / text) or a saved project */
function bindDrop() {
  const hint = $('dropHint'); let depth = 0;
  const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const show = on => { if (hint) hint.hidden = !on; };
  window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(true); });
  window.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', e => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) show(false); });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); depth = 0; show(false);
    if (S.exporting || S.tap) return;
    const files = Array.from(e.dataTransfer.files || []);
    const ext = f => (f.name.match(/\.([^.]+)$/) || ['', ''])[1].toLowerCase();
    const song = files.find(f => /^audio\//.test(f.type) || ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'webm', 'mp4', 'aiff', 'aif', 'wma'].includes(ext(f)));
    const proj = files.find(f => ext(f) === 'json');
    const lyr = files.find(f => ['lrc', 'srt', 'vtt', 'txt'].includes(ext(f)));
    if (proj) { openProjectFile(proj); return; }            // a project brings its own lyrics
    if (!song && !lyr) { toast('読み込めるのは 曲・歌詞（LRC / SRT）・プロジェクト（.json）です'); return; }
    (async () => { if (lyr) await openLyricFile(lyr); if (song) loadAudioFile(song); })();
  });
}

/* song file -> beat analysis (file input, or a host such as the After Effects panel) */
let audioSeq = 0;
async function loadAudioFile(f, restored) {
  const my = ++audioSeq;                      // only the latest choice may win (an earlier, slower analysis is dropped)
  $('audioName').textContent = '解析中…';
  try {
    pause();
    const a = await J.analyzeAudio(f);
    if (my !== audioSeq) return false;
    S.audio = a;
    S.audioFile = f || null;
    if (!restored) clearQcAutoReport();
    $('audioName').textContent = `${f.name}（${J.fmtTime(S.audio.duration)}・約${S.audio.bpm}BPM）` + (restored ? '・前回の曲' : '');
    S.project.audioName = f.name;
    if (!restored && J.saveSong) J.saveSong(f);             // kept in this browser: a reload does not drop the song from exports
    S.project.timing.snap = true;
    const acSummary = a.acousticSummary || {};
    if (!restored || !S.project.detection || S.project.detection.source !== 'ai') {
      S.project.detection = {
        audioType: acSummary.audioType || 'singing',
        language: S.project.lang || 'auto',
        detectedLanguages: [],
        hasBackingVocals: false,
        hasUnclearSections: false,
        hasInstrumentalSections: Boolean(a.instrumentalSegments && a.instrumentalSegments.length),
        hasRepeatedChorus: false,
        format: a.format || '',
        duration: a.duration || 0,
        bpm: a.bpm || 0,
        preprocessing: a.preprocessing || null,
        validationSummary: null,
        pipelineReport: null,
        sections: [],
        source: 'acoustic',
      };
    }
    const curRaw = String(S.project.lyrics || '').trim();
    const isDefaultLyrics = !curRaw || curRaw === String(J.SAMPLE_LYRICS || '').trim();
    // When a fresh audio file is uploaded, automatically listen, transcribe & word-align, or align existing user lyrics
    if (!restored) {
      if (isDefaultLyrics) {
        syncUI(); replan();
        runAiTranscription({ auto: true });
        return true;
      } else if (S.plan && S.plan.lines && S.plan.lines.length && (!S.project.timing.lineTimes || !Object.keys(S.project.timing.lineTimes).length)) {
        const vocalTimes = J.alignLinesToVocals(a, S.plan.lines);
        if (vocalTimes && Object.keys(vocalTimes).length) {
          S.project.timing.lineTimes = vocalTimes;
          S.project.timing.wordTimes = {};
          const langCode = J.resolveLang(S.project);
          S.plan.lines.forEach((ln, i) => {
            if (ln.interlude) return;
            const s = vocalTimes[i] ?? 0.4;
            const e = i < S.plan.lines.length - 1 ? (vocalTimes[i + 1] ?? s + 3.2) : Math.min(a.duration, s + 3.5);
            if (J.alignWordsAcoustic) S.project.timing.wordTimes[i] = J.alignWordsAcoustic(a, ln.text, s, e, langCode);
          });
        }
      }
    }
    syncUI(); replan();
    return true;
  } catch (err) { if (my !== audioSeq) return false; $('audioName').textContent = '読み込めませんでした: ' + err.message; S.audio = null; syncAudioDetectPanel(); syncAiActionButtonsState(); return false; }
}

/* ---------------- かんたんモードの案内ツアー ---------------- */
const TOUR = [
  { t: () => $('lyrics'), title: '1. 歌詞を入れる', text: '1行が1フレーズになります。空行で少し間が空き、[間奏 8] と書くと8秒の間奏（背景と装飾だけ）になります。' },
  { t: () => $('audioFile').closest('label') || $('audioFile'), title: '2. 曲を読み込む', text: 'mp3 などを読み込むと拍を検出して、カットの切り替わりを合わせます。曲がなくても作れます。「タップで同期」で行の頭を合わせることもできます。' },
  { t: () => $('btnOmakaseBig'), title: '3. おまかせで作る', text: 'スタイル・雰囲気・動き・配色・構成をまるごと決めます。押すたびに別の案になり、「◀ 前の案」で戻れます。' },
  { t: () => $('btnPlay'), title: '4. 再生して確認する', text: '再生して見てみましょう。下のタイムラインでは、行の区切りをドラッグして動かせます（＋−で拡大）。' },
  { t: () => $('lineList'), title: '5. 気になる行だけ直す', text: '行ごとに、歌詞を直す（✎）、カット数を決める、この行からタップし直す（◎）、この行だけ作り直す（サイコロ）ができます。' },
  { t: () => $('eMP4').closest('.easy-sec') || $('eMP4'), title: '6. 書き出す', text: '画面比（縦長 9:16 など）と解像度を選んで MP4 を書き出します。「書き出す範囲」で選んだ行だけを書き出すこともできます。' },
];
const TR = { i: -1 };
function tourShow(i) {
  const el = $('tour'), n = TOUR.length;
  if (i < 0 || i >= n) return tourEnd();
  TR.i = i;
  const st = TOUR[i], tg = st.t();
  el.hidden = false;
  el.querySelector('.tour-step').textContent = `${i + 1} / ${n}`;
  el.querySelector('.tour-title').textContent = st.title;
  el.querySelector('.tour-text').textContent = st.text;
  el.querySelector('.tour-prev').disabled = i === 0;
  el.querySelector('.tour-next').textContent = i === n - 1 ? 'はじめる' : '次へ';
  if (tg && tg.scrollIntoView) tg.scrollIntoView({ block: 'center', behavior: 'auto' });
  requestAnimationFrame(() => tourPlace(tg));
  el.querySelector('.tour-next').focus();
}
function tourPlace(tg) {
  const el = $('tour'), spot = el.querySelector('.tour-spot'), bub = el.querySelector('.tour-bub');
  const vw = window.innerWidth, vh = window.innerHeight, pad = 6;
  const r = tg ? tg.getBoundingClientRect() : { left: vw / 2, top: vh / 2, width: 0, height: 0, right: vw / 2, bottom: vh / 2 };
  const x0 = Math.max(4, r.left - pad), y0 = Math.max(4, r.top - pad), x1 = Math.min(vw - 4, r.right + pad), y1 = Math.min(vh - 4, r.bottom + pad);
  Object.assign(spot.style, { left: x0 + 'px', top: y0 + 'px', width: Math.max(0, x1 - x0) + 'px', height: Math.max(0, y1 - y0) + 'px' });
  const bw = bub.offsetWidth, bh = bub.offsetHeight, gap = 12;
  let top = y1 + gap <= vh - bh - 8 ? y1 + gap : y0 - gap - bh >= 8 ? y0 - gap - bh : Math.max(8, vh - bh - 8);
  let left = J.clamp(x0 + (x1 - x0) / 2 - bw / 2, 8, vw - bw - 8);
  Object.assign(bub.style, { top: top + 'px', left: left + 'px' });
}
function tourStart() {
  if (S.exporting || S.tap) return;
  if (S.mode !== 'easy') setMode('easy');
  pause(); tourShow(0);
}
function tourEnd() {
  $('tour').hidden = true; TR.i = -1;
  try { localStorage.setItem('jizura.tourDone', '1'); } catch (e) {}
}
function bindTour() {
  const el = $('tour');
  el.querySelector('.tour-next').addEventListener('click', () => tourShow(TR.i + 1));
  el.querySelector('.tour-prev').addEventListener('click', () => tourShow(TR.i - 1));
  el.querySelector('.tour-skip').addEventListener('click', tourEnd);
  $('btnTour').addEventListener('click', tourStart);
  document.addEventListener('keydown', e => {
    if (TR.i < 0) return;
    if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); tourShow(TR.i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopImmediatePropagation(); tourShow(TR.i - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); tourEnd(); }
    else if (e.key !== 'Tab') { e.stopImmediatePropagation(); }
  }, true);
  window.addEventListener('resize', () => { if (TR.i >= 0) tourPlace(TOUR[TR.i].t()); });
  window.addEventListener('scroll', () => { if (TR.i >= 0) tourPlace(TOUR[TR.i].t()); }, true);
}

/* uploaded faces: bring them back from this browser; say so when a project uses one that is not here */
async function restoreFonts() {
  const list = S.project.userFonts || [];
  if (!list.length) return;
  const missing = await J.restoreUserFonts(list);
  fontKey = ''; renderFontRoles(); replan();
  if (missing.length) toast(`読み込んだ書体（${missing.join('・')}）がこのブラウザにありません。「フォント」から同じファイルを読み込み直してください（それまでは近い書体で表示します）`);
}

/* ---------------- Google Auth, Personal Library, Work History & Vercel Hub ---------------- */
const LS_VERCEL = 'jizura.vercelCfg.v1';
const LS_FBAUTO = 'jizura.fbAutoSave.v1';
const LS_HISTORY = 'jizura.localHistory.v1';
let cloudSongsUnsub = null;
let cloudHistoryUnsub = null;
let cloudActiveTab = 'songs';

function cloudCopy() {
  const lang = document.documentElement.lang || 'fr';
  if (lang === 'fr') {
    return {
      gLogin: 'Connexion Google',
      btnTop: '☁ Sauvegarder',
      btnHub: '📚 Projets & Historique',
      title: '☁ Espace Personnel Google — Enregistrements & Historique',
      fbSec: '🔐 Compte Google & Sauvegarde Firebase',
      signedOut: 'Non connecté',
      signedIn: 'Connecté',
      signIn: 'Se connecter avec Google',
      switchAcc: 'Changer de compte',
      signInHint: 'Connectez votre compte Google pour sauvegarder, retrouver et télécharger toutes vos chansons et votre historique.',
      signOut: 'Déconnexion',
      saveSong: '☁ Sauvegarder cette chanson',
      saveNew: '+ Nouvelle copie',
      autoSave: 'Sauvegarde auto',
      tabSongs: 'Mes Enregistrements',
      tabHistory: 'Historique des Travaux',
      tabVercel: 'Vercel & Sync',
      searchSongsPh: 'Rechercher par titre, artiste, paroles…',
      searchHistPh: 'Rechercher dans votre historique…',
      clearHist: '🗑 Vider',
      histCleared: '🗑 Historique effacé.',
      noSongs: 'Aucune chanson enregistrée pour ce compte Google pour l’instant.',
      noHist: 'Aucun travail enregistré dans l’historique pour l’instant.',
      loadBtn: 'Ouvrir',
      dlAudio: '⬇ Audio',
      dlLrc: '⬇ LRC',
      dlElrc: '⬇ LRC+',
      dlSrt: '⬇ SRT',
      dlVtt: '⬇ VTT',
      dlLyricsJson: '⬇ JSON',
      dlTxt: '⬇ TXT',
      dlJson: '⬇ Projet',
      syncBtn: 'Vercel',
      delBtn: 'Supprimer',
      findSongBtn: 'Retrouver',
      vSec: '▲ Vercel — Liaison & Déploiement',
      vProj: 'Nom du projet Vercel',
      vUrl: 'URL de votre app Vercel',
      vHook: 'Vercel Deploy Hook URL (optionnel)',
      vAuto: 'Synchroniser automatiquement vers Vercel après chaque sauvegarde Firebase',
      vSave: '💾 Enregistrer config Vercel',
      vTest: '🔌 Tester Vercel',
      vSync: '📤 Synchroniser la chanson',
      vDeploy: '🚀 Déployer sur Vercel',
      vOpen: '↗ Ouvrir Vercel',
      saving: 'Enregistrement sur Firebase…',
      savedOk: '☁ Chanson et données enregistrées sur Firebase !',
      savedNoAudio: '☁ Projet enregistré sur Firebase (audio trop lourd > 20 Mo conservé en local).',
      savedPartialAudio: '☁ Paroles et projet enregistrés sur Firebase (transfert audio incomplet — réessayez plus tard).',
      loadedOk: '☁ Chanson chargée depuis votre compte Google !',
      deletedOk: '🗑 Chanson supprimée de Firebase.',
      dlOk: '⬇ Téléchargement lancé :',
      dlNoAudio: 'Aucun fichier audio stocké sur le cloud pour cette entrée (téléchargez LRC, SRT, VTT, JSON ou TXT).',
      verifiedBadge: '✓ Vérifié',
      retryPopup: '↻ Réessayer',
      refreshSession: '↻ Vérifier le compte',
      signingIn: 'Connexion…',
      savingBtn: '⏳ Sauvegarde…',
      authCancelledToast: 'Connexion Google annulée.',
      vSavedOk: '✓ Configuration Vercel enregistrée.',
      vTestOk: '✓ App Vercel joignable',
      vTestLocal: '✓ Endpoints /api/* prêts sur ce serveur (renseignez votre URL Vercel pour tester l’app distante).',
      vSyncOk: '📤 Chanson synchronisée vers Vercel !',
      vDeployOk: '🚀 Déploiement Vercel déclenché !',
      vNeedUrl: 'Renseignez une URL HTTPS Vercel valide (ex: https://mon-app.vercel.app).',
      vNeedHook: 'Renseignez votre Vercel Deploy Hook URL pour déclencher un déploiement.',
      actLabels: {
        cloud_save: '☁ Sauvegarde Cloud',
        cloud_load: '📂 Chanson ouverte',
        ai_transcribe: '✨ Détection IA & Sync',
        vocal_sync: '⚡ Synchro vocale',
        tap_sync: '⏱ Synchro au Tap',
        lyrics_edit: '✏ Édition paroles',
        export_mp4: '🎬 Export MP4',
        export_png: '🖼 Export PNG ZIP',
        export_lrc: '📝 Export LRC',
        export_elrc: '📝 Export Enhanced LRC',
        export_srt: '💬 Export SRT',
        export_vtt: '💬 Export WebVTT',
        export_lyrics_json: '📦 Export JSON (mots/car.)',
        export_txt: '📄 Export TXT',
        export_json: '📦 Export Projet JSON',
        export_ae: '🎞 Export AE',
        export_audio: '🎵 Téléch. Audio',
        vercel_sync: '▲ Sync Vercel',
        vercel_deploy: '🚀 Déploiement Vercel',
      },
      catLabels: { save: 'Sauvegarde', sync: 'IA & Synchro', export: 'Export / Téléch.', vercel: 'Vercel' },
    };
  }
  if (lang === 'en') {
    return {
      gLogin: 'Google Sign-In',
      btnTop: '☁ Save',
      btnHub: '📚 Library & History',
      title: '☁ Google Workspace — Saved Songs & Work History',
      fbSec: '🔐 Google Account & Firebase Storage',
      signedOut: 'Signed out',
      signedIn: 'Connected',
      signIn: 'Sign in with Google',
      switchAcc: 'Switch account',
      signInHint: 'Sign in with your Google account to save, find, and download all your songs and work history.',
      signOut: 'Sign out',
      saveSong: '☁ Save current song',
      saveNew: '+ Save new copy',
      autoSave: 'Auto-save',
      tabSongs: 'Saved Songs',
      tabHistory: 'Work History',
      tabVercel: 'Vercel & Sync',
      searchSongsPh: 'Search by title, artist, lyrics…',
      searchHistPh: 'Search your work history…',
      clearHist: '🗑 Clear',
      histCleared: '🗑 Work history cleared.',
      noSongs: 'No songs saved to this Google account yet.',
      noHist: 'No activity history recorded yet.',
      loadBtn: 'Open',
      dlAudio: '⬇ Audio',
      dlLrc: '⬇ LRC',
      dlElrc: '⬇ LRC+',
      dlSrt: '⬇ SRT',
      dlVtt: '⬇ VTT',
      dlLyricsJson: '⬇ JSON',
      dlTxt: '⬇ TXT',
      dlJson: '⬇ Project',
      syncBtn: 'Vercel',
      delBtn: 'Delete',
      findSongBtn: 'Open Song',
      vSec: '▲ Vercel — Connection & Deploy',
      vProj: 'Vercel Project Name',
      vUrl: 'Vercel App URL',
      vHook: 'Vercel Deploy Hook URL (optional)',
      vAuto: 'Automatically sync to Vercel after each Firebase save',
      vSave: '💾 Save Vercel config',
      vTest: '🔌 Test Vercel',
      vSync: '📤 Sync song to Vercel',
      vDeploy: '🚀 Deploy to Vercel',
      vOpen: '↗ Open Vercel',
      saving: 'Saving to Firebase…',
      savedOk: '☁ Song & data saved to Firebase!',
      savedNoAudio: '☁ Project saved to Firebase (audio > 20 MB kept locally).',
      savedPartialAudio: '☁ Lyrics & project saved to Firebase (audio chunk upload incomplete — please retry).',
      loadedOk: '☁ Song loaded from your Google account!',
      deletedOk: '🗑 Song deleted from Firebase.',
      dlOk: '⬇ Download started:',
      dlNoAudio: 'No cloud audio stored for this song (download LRC, SRT, VTT, JSON, or TXT instead).',
      verifiedBadge: '✓ Verified',
      retryPopup: '↻ Retry',
      refreshSession: '↻ Check verification',
      signingIn: 'Signing in…',
      savingBtn: '⏳ Saving…',
      authCancelledToast: 'Google sign-in cancelled.',
      vSavedOk: '✓ Vercel settings saved.',
      vTestOk: '✓ Vercel app reachable',
      vTestLocal: '✓ Local /api/* endpoints ready (enter your Vercel URL to ping your deployed app).',
      vSyncOk: '📤 Song synced to Vercel!',
      vDeployOk: '🚀 Vercel deployment triggered!',
      vNeedUrl: 'Enter a valid HTTPS Vercel app URL (e.g. https://my-app.vercel.app).',
      vNeedHook: 'Enter your Vercel Deploy Hook URL first.',
      actLabels: {
        cloud_save: '☁ Cloud Save',
        cloud_load: '📂 Song Opened',
        ai_transcribe: '✨ AI Lyrics & Sync',
        vocal_sync: '⚡ Vocal Sync',
        tap_sync: '⏱ Tap Sync',
        lyrics_edit: '✏ Lyrics Edit',
        export_mp4: '🎬 MP4 Export',
        export_png: '🖼 PNG ZIP Export',
        export_lrc: '📝 LRC Export',
        export_elrc: '📝 Enhanced LRC Export',
        export_srt: '💬 SRT Export',
        export_vtt: '💬 WebVTT Export',
        export_lyrics_json: '📦 Lyrics JSON Export',
        export_txt: '📄 TXT Export',
        export_json: '📦 Project JSON Export',
        export_ae: '🎞 AE Export',
        export_audio: '🎵 Audio Download',
        vercel_sync: '▲ Vercel Sync',
        vercel_deploy: '🚀 Vercel Deploy',
      },
      catLabels: { save: 'Save', sync: 'AI & Sync', export: 'Download', vercel: 'Vercel' },
    };
  }
  return {
    gLogin: 'Googleログイン',
    btnTop: '☁ 保存',
    btnHub: '📚 曲・履歴',
    title: '☁ Google アカウント — 保存済みの曲・作業履歴',
    fbSec: '🔐 Google ログイン & Firebase 保存',
    signedOut: '未ログイン',
    signedIn: '接続済み',
    signIn: 'Googleでログイン',
    switchAcc: 'アカウント切替',
    signInHint: 'Googleアカウントでログインすると、すべての曲・音声・履歴を保存・検索・ダウンロードできます。',
    signOut: 'ログアウト',
    saveSong: '☁ この曲を保存',
    saveNew: '+ 別名で新規保存',
    autoSave: '自動保存',
    tabSongs: '保存済みの曲',
    tabHistory: '作業履歴',
    tabVercel: 'Vercel連携',
    searchSongsPh: '曲名・アーティスト・歌詞で検索…',
    searchHistPh: '履歴を検索…',
    clearHist: '🗑 履歴を消去',
    histCleared: '🗑 履歴を消去しました。',
    noSongs: 'このGoogleアカウントに保存された曲はまだありません。',
    noHist: 'まだ作業履歴はありません。',
    loadBtn: '開く',
    dlAudio: '⬇ Audio',
    dlLrc: '⬇ LRC',
    dlElrc: '⬇ LRC+',
    dlSrt: '⬇ SRT',
    dlVtt: '⬇ VTT',
    dlLyricsJson: '⬇ JSON',
    dlTxt: '⬇ TXT',
    dlJson: '⬇ Project',
    syncBtn: 'Vercel',
    delBtn: '削除',
    findSongBtn: '曲を開く',
    vSec: '▲ Vercel — 連携・デプロイ',
    vProj: 'Vercel プロジェクト名',
    vUrl: 'Vercel アプリURL',
    vHook: 'Vercel Deploy Hook URL（任意）',
    vAuto: 'Firebase保存時にVercelへ自動同期する',
    vSave: '💾 Vercel設定を保存',
    vTest: '🔌 接続テスト',
    vSync: '📤 Vercelへ同期',
    vDeploy: '🚀 Vercelデプロイ',
    vOpen: '↗ Vercelを開く',
    saving: 'Firebaseに保存中…',
    savedOk: '☁ 曲とデータをFirebaseに保存しました！',
    savedNoAudio: '☁ プロジェクトをFirebaseに保存しました（大容量音声はローカル保持）。',
    savedPartialAudio: '☁ 歌詞とプロジェクトをFirebaseに保存しました（音声のアップロードが一部未完了です）。',
    loadedOk: '☁ Googleアカウントから曲を読み込みました！',
    deletedOk: '🗑 Firebaseから削除しました。',
    dlOk: '⬇ ダウンロード開始:',
    dlNoAudio: 'この曲にはクラウド音声が保存されていません（LRC / SRT / VTT / JSON / TXT はダウンロード可能）。',
    verifiedBadge: '✓ 認証済み',
    retryPopup: '↻ 再試行',
    refreshSession: '↻ 状態を再確認',
    signingIn: '接続中…',
    savingBtn: '⏳ 保存中…',
    authCancelledToast: 'Googleログインがキャンセルされました。',
    vSavedOk: '✓ Vercel設定を保存しました。',
    vTestOk: '✓ Vercelアプリへ接続できました',
    vTestLocal: '✓ ローカル /api/* 準備完了（デプロイ先URLを入力すると疎通確認できます）。',
    vSyncOk: '📤 Vercelへ同期しました！',
    vDeployOk: '🚀 Vercelデプロイを開始しました！',
    vNeedUrl: '有効な HTTPS Vercel URL を入力してください。',
    vNeedHook: 'Vercel Deploy Hook URL を入力してください。',
    actLabels: {
      cloud_save: '☁ クラウド保存',
      cloud_load: '📂 曲を読み込み',
      ai_transcribe: '✨ AI識詞・同期',
      vocal_sync: '⚡ ボーカル同期',
      tap_sync: '⏱ タップ同期',
      lyrics_edit: '✏ 歌詞編集',
      export_mp4: '🎬 MP4書き出し',
      export_png: '🖼 PNG書き出し',
      export_lrc: '📝 LRC保存',
      export_elrc: '📝 Enhanced LRC保存',
      export_srt: '💬 SRT保存',
      export_vtt: '💬 VTT保存',
      export_lyrics_json: '📦 歌詞JSON保存',
      export_txt: '📄 TXT保存',
      export_json: '📦 プロジェクトJSON保存',
      export_ae: '🎞 AE書き出し',
      export_audio: '🎵 音声保存',
      vercel_sync: '▲ Vercel同期',
      vercel_deploy: '🚀 Vercelデプロイ',
    },
    catLabels: { save: '保存', sync: 'AI・同期', export: '書き出し', vercel: 'Vercel' },
  };
}
function syncHeaderGoogleAuth(user) {
  const c = cloudCopy();
  const btnG = $('btnGoogleAuth'), lblG = $('hdrGoogleLabel'), avG = $('hdrGoogleAvatar');
  if (btnG) btnG.classList.toggle('is-online', !!user);
  if ($('btnCloudHub')) $('btnCloudHub').classList.toggle('is-online', !!user);
  if (lblG) {
    lblG.textContent = user ? (user.displayName || user.email || c.signedIn).split(/\s+/)[0].slice(0, 18) : c.gLogin;
  }
  if (avG) {
    if (user && user.photoURL) { avG.src = user.photoURL; avG.hidden = false; }
    else { avG.hidden = true; avG.removeAttribute('src'); }
  }
}
function applyCloudLabels() {
  const c = cloudCopy();
  const setT = (id, t) => { const el = $(id); if (el) el.textContent = t; };
  setT('btnCloudSave', c.btnTop);
  setT('btnCloudHub', c.btnHub);
  setT('cloudTitle', c.title);
  setT('lblFbSection', c.fbSec);
  setT('fbAuthStatus', S.cloudUser ? c.signedIn : c.signedOut);
  setT('btnFbSignIn', c.signIn);
  setT('btnFbSwitchAccount', c.switchAcc);
  setT('fbSignInHint', c.signInHint);
  setT('btnFbSignOut', c.signOut);
  setT('btnFbSaveSong', c.saveSong);
  setT('btnFbSaveNew', c.saveNew);
  setT('lblFbAutoSave', c.autoSave);
  setT('lblTabSongs', c.tabSongs);
  setT('lblTabHistory', c.tabHistory);
  setT('lblTabVercel', c.tabVercel);
  setT('btnClearCloudHistory', c.clearHist);
  if ($('cloudSongSearch')) $('cloudSongSearch').placeholder = c.searchSongsPh;
  if ($('cloudHistorySearch')) $('cloudHistorySearch').placeholder = c.searchHistPh;
  setT('lblVercelSection', c.vSec);
  setT('lblVercelProj', c.vProj);
  setT('lblVercelUrl', c.vUrl);
  setT('lblVercelHook', c.vHook);
  setT('lblVercelAutoSync', c.vAuto);
  setT('btnVercelSave', c.vSave);
  setT('btnVercelTest', c.vTest);
  setT('btnVercelSync', c.vSync);
  setT('btnVercelDeploy', c.vDeploy);
  setT('vercelOpenLink', c.vOpen);
  syncHeaderGoogleAuth(S.cloudUser);
}
function setCloudTab(tab) {
  cloudActiveTab = tab === 'history' || tab === 'vercel' ? tab : 'songs';
  const tabs = [
    ['songs', 'tabCloudSongs', 'panelCloudSongs'],
    ['history', 'tabCloudHistory', 'panelCloudHistory'],
    ['vercel', 'tabCloudVercel', 'panelCloudVercel'],
  ];
  tabs.forEach(([key, tid, pid]) => {
    const active = key === cloudActiveTab;
    const tb = $(tid), pn = $(pid);
    if (tb) { tb.classList.toggle('is-active', active); tb.setAttribute('aria-selected', String(active)); }
    if (pn) pn.hidden = !active;
  });
  syncSlidingMenus(true);
}
let cloudAuthRunner = null;
function showCloudError(err) {
  const box = $('cloudErrorBox');
  if (!box) return;
  if (!err) {
    box.hidden = true;
    box.className = 'cloud-err';
    box.textContent = '';
    return;
  }
  const lang = document.documentElement.lang || 'fr';
  const c = cloudCopy();
  const fmt =
    window.AlexuraCloud && typeof window.AlexuraCloud.formatAuthError === 'function'
      ? window.AlexuraCloud.formatAuthError(err, lang)
      : {
          code: '',
          severity: 'error',
          message: err instanceof Error ? err.message : String(err),
          hint: '',
          canRetryPopup: false,
          canRetryRedirect: false,
          shouldOpenNewTab: false,
          isCancelled: false,
          isRedirecting: false,
        };
  let msg = fmt.message || '';
  if (!window.AlexuraCloud || typeof window.AlexuraCloud.formatAuthError !== 'function') {
    try {
      const parsed = JSON.parse(msg);
      if (parsed && parsed.error) msg = `${parsed.error}${parsed.path ? ' (' + parsed.path + ')' : ''}`;
    } catch (e) {}
  }

  box.className = 'cloud-err' + (fmt.severity === 'info' ? ' is-info' : fmt.severity === 'warn' ? ' is-warn' : '');
  box.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'cloud-err-top';
  const txt = document.createElement('div');
  txt.className = 'cloud-err-msg';
  txt.textContent = msg;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ghost small cloud-err-dismiss';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Fermer');
  closeBtn.addEventListener('click', () => showCloudError(null));
  top.append(txt, closeBtn);
  box.appendChild(top);

  if (fmt.hint) {
    const hintEl = document.createElement('div');
    hintEl.className = 'cloud-err-hint';
    hintEl.textContent = fmt.hint;
    box.appendChild(hintEl);
  }

  const showRefreshBtn = fmt.code === 'auth/email-not-verified' && window.AlexuraCloud && typeof window.AlexuraCloud.reloadUserSession === 'function';
  if (fmt.canRetryPopup || fmt.canRetryRedirect || fmt.shouldOpenNewTab || showRefreshBtn) {
    const actRow = document.createElement('div');
    actRow.className = 'cloud-err-acts';
    if (showRefreshBtn) {
      const btnChk = document.createElement('button');
      btnChk.type = 'button';
      btnChk.className = 'primary small';
      btnChk.textContent = c.refreshSession;
      btnChk.addEventListener('click', async () => {
        try {
          const u = await window.AlexuraCloud.reloadUserSession();
          if (u && u.emailVerified !== false) {
            showCloudError(null);
            await attachCloudListeners(u);
          }
        } catch (rErr) {
          showCloudError(rErr);
        }
      });
      actRow.appendChild(btnChk);
    }
    if (fmt.canRetryPopup && typeof cloudAuthRunner === 'function') {
      const btnRetry = document.createElement('button');
      btnRetry.type = 'button';
      btnRetry.className = 'primary small';
      btnRetry.textContent = c.retryPopup;
      btnRetry.addEventListener('click', () => {
        cloudAuthRunner({ switchAccount: !!S.cloudUser, openModalOnError: true });
      });
      actRow.appendChild(btnRetry);
    }
    if (fmt.canRetryRedirect && window.AlexuraCloud && typeof window.AlexuraCloud.signInGoogleRedirect === 'function') {
      const btnRedir = document.createElement('button');
      btnRedir.type = 'button';
      btnRedir.className = 'ghost small';
      btnRedir.textContent = lang === 'en' ? '↻ Retry with redirect' : lang === 'ja' ? '↻ リダイレクトでログイン' : '↻ Connexion par redirection';
      btnRedir.addEventListener('click', async () => {
        try {
          await window.AlexuraCloud.signInGoogleRedirect();
        } catch (rErr) {
          showCloudError(rErr);
        }
      });
      actRow.appendChild(btnRedir);
    }
    if (fmt.shouldOpenNewTab) {
      const a = document.createElement('a');
      a.className = 'ghost small cloud-link';
      a.href = window.location.href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = lang === 'en' ? '↗ Open in new tab' : lang === 'ja' ? '↗ 新しいタブで開く' : '↗ Ouvrir dans un nouvel onglet';
      actRow.appendChild(a);
    }
    box.appendChild(actRow);
  }
  box.hidden = false;
}
function readLocalHistory() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function writeLocalHistory(arr) {
  try { localStorage.setItem(LS_HISTORY, JSON.stringify((arr || []).slice(0, 80))); } catch (e) {}
}
function formatWhen(ts) {
  let ms = 0;
  if (typeof ts === 'number') ms = ts;
  else if (ts && typeof ts.toMillis === 'function') ms = ts.toMillis();
  else if (typeof ts === 'string') ms = Date.parse(ts) || 0;
  if (!ms) return '';
  try {
    const d = new Date(ms);
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}
async function recordWork(action, category = 'save', details = '', songIdOverride = null) {
  const title = (S.project && S.project.title) || (S.audioFile && S.audioFile.name) || 'Sans titre';
  const artist = (S.project && S.project.artist) || '';
  const songId = songIdOverride !== null ? String(songIdOverride || '') : String(S.cloudSongId || '');
  const entry = {
    historyId: 'local_' + Date.now().toString(36),
    action: String(action || 'work'),
    category: String(category || 'save'),
    songId,
    songTitle: String(title).slice(0, 200),
    artist: String(artist).slice(0, 200),
    details: String(details || '').slice(0, 500),
    localTs: Date.now(),
  };
  const local = [entry, ...readLocalHistory()].slice(0, 80);
  writeLocalHistory(local);
  if (!S.cloudUser) {
    renderWorkHistory([]);
  } else if (window.AlexuraCloud && typeof window.AlexuraCloud.logWorkHistory === 'function') {
    window.AlexuraCloud.logWorkHistory({
      action: entry.action,
      category: entry.category,
      songId: entry.songId,
      songTitle: entry.songTitle,
      artist: entry.artist,
      details: entry.details,
    }).catch(() => {});
  }
}
function srtTextFromProject(proj) {
  return J.srtText ? J.srtText(proj) : '';
}
async function downloadCloudSongArtifact(song, kind) {
  const c = cloudCopy();
  const proj = mergeProject((song && song.project) || {});
  const slug = String((song && song.title) || proj.title || 'alexura').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'alexura';
  if (kind === 'lrc') {
    const txt = J.lrcText(proj);
    const fname = `${slug}.lrc`;
    await J.saveFile(fname, new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    recordWork('export_lrc', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'elrc') {
    const txt = J.enhancedLrcText(proj);
    const fname = `${slug}.elrc.lrc`;
    await J.saveFile(fname, new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    recordWork('export_elrc', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'srt') {
    const txt = srtTextFromProject(proj);
    const fname = `${slug}.srt`;
    await J.saveFile(fname, new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    recordWork('export_srt', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'vtt') {
    const txt = J.vttText(proj);
    const fname = `${slug}.vtt`;
    await J.saveFile(fname, new Blob([txt], { type: 'text/vtt;charset=utf-8' }));
    recordWork('export_vtt', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'txt') {
    const txt = J.txtLyricsText(proj);
    const fname = `${slug}.txt`;
    await J.saveFile(fname, new Blob([txt], { type: 'text/plain;charset=utf-8' }));
    recordWork('export_txt', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'lyrics_json') {
    const txt = J.lyricsJsonText(proj);
    const fname = `${slug}.lyrics.json`;
    await J.saveFile(fname, new Blob([txt], { type: 'application/json;charset=utf-8' }));
    recordWork('export_lyrics_json', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'json') {
    const fname = `${slug}.alexura.json`;
    await J.saveFile(fname, new Blob([JSON.stringify(proj, null, 2)], { type: 'application/json;charset=utf-8' }));
    recordWork('export_json', 'export', fname, song.songId || '');
    toast(`${c.dlOk} ${fname}`);
    return;
  }
  if (kind === 'audio') {
    if (!song || !song.hasAudioChunks || !window.AlexuraCloud) {
      toast(c.dlNoAudio);
      return;
    }
    try {
      const res = await window.AlexuraCloud.loadSongFromCloud(song.songId);
      if (res && res.audioFile) {
        const fname = res.audioFile.name || `${slug}.mp3`;
        await J.saveFile(fname, res.audioFile);
        recordWork('export_audio', 'export', fname, song.songId || '');
        toast(`${c.dlOk} ${fname}`);
      } else {
        toast(c.dlNoAudio);
      }
    } catch (err) {
      showCloudError(err);
    }
  }
}
function readLocalVercelCfg() {
  try {
    const o = JSON.parse(localStorage.getItem(LS_VERCEL) || 'null');
    if (o && typeof o === 'object') return o;
  } catch (e) {}
  return { projectName: 'alexura', appUrl: '', deployHookUrl: '', autoSync: false };
}
function applyVercelInputs(cfg) {
  if (!cfg) return;
  if ($('vercelProjectName')) $('vercelProjectName').value = cfg.projectName || 'alexura';
  if ($('vercelAppUrl')) $('vercelAppUrl').value = cfg.appUrl || '';
  if ($('vercelHookUrl')) $('vercelHookUrl').value = cfg.deployHookUrl || '';
  if ($('vercelAutoSync')) $('vercelAutoSync').checked = !!cfg.autoSync;
  const link = $('vercelOpenLink');
  if (link) {
    try {
      const u = cfg.appUrl && /^https:\/\//i.test(cfg.appUrl.trim()) ? new URL(cfg.appUrl.trim()).toString() : 'https://vercel.com/new';
      link.href = u;
    } catch (e) { link.href = 'https://vercel.com/new'; }
  }
}
function collectVercelInputs() {
  return {
    projectName: ($('vercelProjectName') ? $('vercelProjectName').value.trim() : '') || 'alexura',
    appUrl: $('vercelAppUrl') ? $('vercelAppUrl').value.trim() : '',
    deployHookUrl: $('vercelHookUrl') ? $('vercelHookUrl').value.trim() : '',
    autoSync: !!($('vercelAutoSync') && $('vercelAutoSync').checked),
  };
}
function openCloudHub(tabName = null) {
  const dlg = $('cloudDlg');
  if (!dlg) return;
  applyCloudLabels();
  showCloudError(null);
  applyVercelInputs(readLocalVercelCfg());
  if (tabName) setCloudTab(tabName);
  renderCloudSongs(S.cloudSongs);
  renderWorkHistory(S.cloudHistory);
  if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  if ($('btnCloudHub')) $('btnCloudHub').setAttribute('aria-expanded', 'true');
  refreshServerCapabilities();
  requestAnimationFrame(() => syncSlidingMenus(false));
}
function closeCloudHub() {
  const dlg = $('cloudDlg');
  if (!dlg) return;
  if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
  if ($('btnCloudHub')) $('btnCloudHub').setAttribute('aria-expanded', 'false');
}
async function refreshServerCapabilities() {
  try {
    const r = await fetch('/api/health');
    if (!r.ok) return;
    const h = await r.json();
    if ($('vercelConnBadge')) {
      const fbProj = window.AlexuraCloud && window.AlexuraCloud.config ? window.AlexuraCloud.config.projectId : 'firebase';
      $('vercelConnBadge').textContent = h.vercelConnected ? `Vercel connecté · ${fbProj}` : `Vercel prêt (/api/*) · ${fbProj}`;
    }
    if (h.vercelUrl && $('vercelAppUrl') && !$('vercelAppUrl').value.trim()) {
      $('vercelAppUrl').value = h.vercelUrl;
    }
  } catch (e) {}
}
function renderCloudSongs(songs) {
  S.cloudSongs = Array.isArray(songs) ? songs : S.cloudSongs;
  const all = S.cloudSongs || [];
  if ($('fbSongsCount')) $('fbSongsCount').textContent = String(all.length);
  const listEl = $('cloudSongsList');
  if (!listEl) return;
  const c = cloudCopy();
  const q = ($('cloudSongSearch') ? $('cloudSongSearch').value : '').trim().toLowerCase();
  const flt = $('cloudSongFilter') ? $('cloudSongFilter').value : 'all';
  const srt = $('cloudSongSort') ? $('cloudSongSort').value : 'recent';

  let filtered = all.filter(s => {
    if (flt === 'audio' && !s.hasAudioChunks) return false;
    if (flt === 'timed' && !String(s.lyrics || '').trim()) return false;
    if (q) {
      const hay = `${s.title || ''} ${s.artist || ''} ${s.audioName || ''} ${s.lyrics || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  filtered = filtered.slice().sort((a, b) => {
    if (srt === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
    if (srt === 'duration') return (Number(b.duration) || 0) - (Number(a.duration) || 0);
    const ta = (a.updatedAt && typeof a.updatedAt.toMillis === 'function') ? a.updatedAt.toMillis() : 0;
    const tb = (b.updatedAt && typeof b.updatedAt.toMillis === 'function') ? b.updatedAt.toMillis() : 0;
    return tb - ta;
  });

  listEl.innerHTML = '';
  if (!filtered.length) {
    const emp = document.createElement('div');
    emp.className = 'muted';
    emp.style.fontSize = '12px';
    emp.textContent = S.cloudUser ? c.noSongs : c.signInHint;
    listEl.appendChild(emp);
    return;
  }
  filtered.forEach((s) => {
    const row = document.createElement('div');
    row.className = 'cloud-song-item' + (s.songId === S.cloudSongId ? ' is-active' : '');
    const info = document.createElement('div');
    info.className = 'cloud-song-info';
    const ttl = document.createElement('div');
    ttl.className = 'cloud-song-title';
    ttl.textContent = s.title || s.audioName || s.songId;
    const meta = document.createElement('div');
    meta.className = 'cloud-song-meta mono';
    const durTxt = s.duration ? J.fmtTime(Number(s.duration)) : '00:00';
    const bpmTxt = s.bpm ? `${Math.round(Number(s.bpm))} BPM` : '';
    const audTxt = s.hasAudioChunks ? '🎵 Audio' : '📝 Paroles';
    const wMap = s.project && s.project.timing && s.project.timing.wordTimes ? s.project.timing.wordTimes : null;
    const wCount = wMap ? Object.values(wMap).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0) : 0;
    const wTxt = wCount ? `${wCount} mots` : '';
    const dtTxt = formatWhen(s.updatedAt);
    meta.textContent = [s.artist || 'Alexura', durTxt, bpmTxt, wTxt, audTxt, dtTxt].filter(Boolean).join(' · ');
    info.append(ttl, meta);

    const acts = document.createElement('div');
    acts.className = 'cloud-song-acts';
    const mkBtn = (cls, txt, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = cls; b.textContent = txt;
      b.addEventListener('click', fn);
      return b;
    };
    acts.append(mkBtn('primary small', c.loadBtn, () => loadCloudSongIntoStudio(s.songId)));
    if (s.hasAudioChunks) acts.append(mkBtn('ghost small cloud-dl-btn', c.dlAudio, () => downloadCloudSongArtifact(s, 'audio')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlLrc, () => downloadCloudSongArtifact(s, 'lrc')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlElrc, () => downloadCloudSongArtifact(s, 'elrc')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlSrt, () => downloadCloudSongArtifact(s, 'srt')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlVtt, () => downloadCloudSongArtifact(s, 'vtt')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlLyricsJson, () => downloadCloudSongArtifact(s, 'lyrics_json')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlTxt, () => downloadCloudSongArtifact(s, 'txt')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.dlJson, () => downloadCloudSongArtifact(s, 'json')));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.syncBtn, () => syncSongToVercel(s.songId, s)));
    acts.append(mkBtn('ghost small cloud-dl-btn', c.delBtn, async () => {
      if (!window.AlexuraCloud) return;
      try {
        showCloudError(null);
        await window.AlexuraCloud.deleteSongFromCloud(s.songId);
        if (S.cloudSongId === s.songId) {
          S.cloudSongId = null;
          if (S.project) delete S.project.cloudSongId;
          flushSave();
        }
        if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = S.cloudSongId ? `ID: ${S.cloudSongId}` : '';
        toast(c.deletedOk);
      } catch (err) {
        showCloudError(err);
      }
    }));
    row.append(info, acts);
    listEl.appendChild(row);
  });
}
function renderWorkHistory(entries) {
  if (Array.isArray(entries)) S.cloudHistory = entries;
  const src = S.cloudUser ? (S.cloudHistory || []) : readLocalHistory();
  if ($('fbHistoryCount')) $('fbHistoryCount').textContent = String(src.length);
  const listEl = $('cloudHistoryList');
  if (!listEl) return;
  const c = cloudCopy();
  const q = ($('cloudHistorySearch') ? $('cloudHistorySearch').value : '').trim().toLowerCase();
  const cat = $('cloudHistoryFilter') ? $('cloudHistoryFilter').value : 'all';

  const filtered = src.filter(h => {
    if (cat !== 'all' && h.category !== cat) return false;
    if (q) {
      const hay = `${h.songTitle || ''} ${h.artist || ''} ${h.details || ''} ${h.action || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  listEl.innerHTML = '';
  if (!filtered.length) {
    const emp = document.createElement('div');
    emp.className = 'muted';
    emp.style.fontSize = '12px';
    emp.textContent = c.noHist;
    listEl.appendChild(emp);
    return;
  }
  filtered.forEach((h) => {
    const row = document.createElement('div');
    row.className = 'cloud-song-item';
    const info = document.createElement('div');
    info.className = 'cloud-song-info';

    const ttl = document.createElement('div');
    ttl.className = 'cloud-song-title';
    const bdg = document.createElement('span');
    bdg.className = 'cloud-hist-badge cat-' + (h.category || 'save');
    bdg.textContent = (c.actLabels && c.actLabels[h.action]) || h.action || 'Travail';
    const txtNode = document.createTextNode(h.songTitle || 'Sans titre');
    ttl.append(bdg, txtNode);

    const meta = document.createElement('div');
    meta.className = 'cloud-song-meta mono';
    const when = formatWhen(h.createdAt || h.localTs);
    meta.textContent = [h.artist, h.details, when].filter(Boolean).join(' · ');
    info.append(ttl, meta);

    const acts = document.createElement('div');
    acts.className = 'cloud-song-acts';
    if (h.songId && S.cloudUser && S.cloudSongs.some(s => s.songId === h.songId)) {
      const btnOpen = document.createElement('button');
      btnOpen.type = 'button';
      btnOpen.className = 'primary small';
      btnOpen.textContent = c.findSongBtn;
      btnOpen.addEventListener('click', () => loadCloudSongIntoStudio(h.songId));
      acts.append(btnOpen);
    }
    const btnDel = document.createElement('button');
    btnDel.type = 'button';
    btnDel.className = 'ghost small cloud-dl-btn';
    btnDel.textContent = '✕';
    btnDel.addEventListener('click', async () => {
      if (S.cloudUser && h.historyId && !String(h.historyId).startsWith('local_') && window.AlexuraCloud) {
        try { await window.AlexuraCloud.deleteHistoryEntry(h.historyId); } catch (err) { showCloudError(err); }
      } else {
        writeLocalHistory(readLocalHistory().filter(x => x.historyId !== h.historyId));
        renderWorkHistory(S.cloudHistory);
      }
    });
    acts.append(btnDel);
    row.append(info, acts);
    listEl.appendChild(row);
  });
}
let cloudSaveInFlight = false;
async function saveCurrentSongToFirebase(asNew = false, silent = false) {
  const c = cloudCopy();
  if (!window.AlexuraCloud) return null;
  if (cloudSaveInFlight) return null;
  let activeUser = S.cloudUser || (typeof window.AlexuraCloud.getUser === 'function' ? window.AlexuraCloud.getUser() : null);
  if (!activeUser) {
    if (silent) return null;
    openCloudHub('songs');
    try {
      const signedUser = typeof cloudAuthRunner === 'function'
        ? await cloudAuthRunner({ switchAccount: false, openModalOnError: true })
        : await window.AlexuraCloud.signInGoogle();
      activeUser = S.cloudUser || signedUser || (typeof window.AlexuraCloud.getUser === 'function' ? window.AlexuraCloud.getUser() : null);
      if (activeUser) S.cloudUser = activeUser;
    } catch (err) {
      showCloudError(err);
      return null;
    }
  }
  if (!activeUser) return null;
  if (activeUser.emailVerified === false) {
    if (!silent) {
      openCloudHub('songs');
      showCloudError(new Error('AUTH_EMAIL_NOT_VERIFIED'));
    }
    return null;
  }
  cloudSaveInFlight = true;
  showCloudError(null);
  const saveBtns = ['btnCloudSave', 'btnFbSaveSong', 'btnFbSaveNew'].map(id => $(id)).filter(Boolean);
  saveBtns.forEach(b => { b.disabled = true; });
  if ($('btnCloudSave')) $('btnCloudSave').textContent = c.savingBtn;
  if ($('btnFbSaveSong')) $('btnFbSaveSong').textContent = c.savingBtn;
  if (!silent) toast(c.saving);
  try {
    if (typeof window.AlexuraCloud.ensureUserReady === 'function') {
      await window.AlexuraCloud.ensureUserReady(activeUser).catch(() => {});
    }
    const ownedByOther = S.project && S.project.cloudOwnerUid && S.project.cloudOwnerUid !== activeUser.uid;
    const effectiveSongId = asNew || ownedByOther ? undefined : (S.cloudSongId || undefined);
    const vCfg = collectVercelInputs();
    const songInput = {
      songId: effectiveSongId,
      title: S.project.title || 'Sans titre',
      artist: S.project.artist || '',
      lyrics: S.project.lyrics || '',
      lang: S.project.lang || 'auto',
      audioName: S.project.audioName || (S.audioFile && S.audioFile.name) || '',
      audioMime: (S.audioFile && S.audioFile.type) || (S.audio && S.audio.format ? 'audio/' + S.audio.format : 'audio/mpeg'),
      audioSize: (S.audioFile && S.audioFile.size) || 0,
      duration: (S.audio && S.audio.duration) || (S.plan && S.plan.duration) || 0,
      bpm: (S.audio && S.audio.bpm) || (S.project.timing && S.project.timing.bpm) || 0,
      vercelSyncedUrl: vCfg.appUrl || '',
      project: Object.assign({}, S.project, { appVersion: '@VERSION@', cloudOwnerUid: activeUser.uid }),
    };
    const res = await window.AlexuraCloud.saveSongToCloud(songInput, S.audioFile);
    S.cloudSongId = res.songId;
    S.project.cloudSongId = res.songId;
    S.project.cloudOwnerUid = activeUser.uid;
    if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = `ID: ${res.songId}`;
    try { localStorage.setItem(LS_KEY, JSON.stringify(S.project)); } catch (e) {}
    if (!silent) {
      recordWork('cloud_save', 'save', res.audioSaved ? 'Projet + audio complet' : 'Paroles & synchro', res.songId);
      if (res.audioPartialError) {
        toast(c.savedPartialAudio);
      } else {
        toast(res.audioTooLarge ? c.savedNoAudio : c.savedOk);
      }
    }
    if (vCfg.autoSync && vCfg.appUrl) {
      await syncSongToVercel(res.songId, null, true);
    }
    return res;
  } catch (err) {
    if (!silent) {
      openCloudHub('songs');
      showCloudError(err);
      const fmtErr = window.AlexuraCloud && typeof window.AlexuraCloud.formatAuthError === 'function'
        ? window.AlexuraCloud.formatAuthError(err, document.documentElement.lang || 'fr').message
        : (err && err.message ? err.message : 'Erreur');
      toast('Firebase: ' + String(fmtErr).slice(0, 90));
    }
    return null;
  } finally {
    cloudSaveInFlight = false;
    saveBtns.forEach(b => { b.disabled = false; });
    if ($('btnCloudSave')) $('btnCloudSave').textContent = c.btnTop;
    if ($('btnFbSaveSong')) $('btnFbSaveSong').textContent = c.saveSong;
  }
}
async function loadCloudSongIntoStudio(songId) {
  if (!window.AlexuraCloud) return false;
  const c = cloudCopy();
  showCloudError(null);
  try {
    const res = await window.AlexuraCloud.loadSongFromCloud(songId);
    const s = res.song;
    const np = mergeProject(s.project || {});
    if (S.tap) stopTap();
    pause();
    S.project = np;
    S.cloudSongId = String(s.songId || songId);
    S.project.cloudSongId = S.cloudSongId;
    if (S.cloudUser && S.cloudUser.uid) S.project.cloudOwnerUid = S.cloudUser.uid;
    ED.undo = []; ED.redo = []; H.list = []; H.i = -1;
    syncUI(); replan(); restoreFonts(); commit(); updateEditBtns(); flushSave();
    if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = `ID: ${S.cloudSongId}`;
    if (res.audioFile) {
      await loadAudioFile(res.audioFile, true);
    }
    renderCloudSongs(S.cloudSongs);
    recordWork('cloud_load', 'save', s.title || s.audioName || S.cloudSongId, S.cloudSongId);
    toast(c.loadedOk);
    return true;
  } catch (err) {
    showCloudError(err);
    return false;
  }
}
async function saveVercelSettings() {
  const cfg = collectVercelInputs();
  const c = cloudCopy();
  showCloudError(null);
  try { localStorage.setItem(LS_VERCEL, JSON.stringify(cfg)); } catch (e) {}
  applyVercelInputs(cfg);
  if (S.cloudUser && window.AlexuraCloud) {
    try {
      await window.AlexuraCloud.saveVercelConfig(cfg);
    } catch (err) {
      showCloudError(err);
      return false;
    }
  }
  if ($('vercelStatusNote')) $('vercelStatusNote').textContent = `${c.vSavedOk} (${cfg.projectName})`;
  toast(c.vSavedOk);
  return true;
}
async function testVercelBridge() {
  const cfg = collectVercelInputs();
  const c = cloudCopy();
  if (!cfg.appUrl) {
    const r = await fetch('/api/health');
    const h = r.ok ? await r.json() : {};
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = `${c.vTestLocal} (ok=${!!h.ok})`;
    toast(c.vTestLocal);
    return { ok: true, local: true };
  }
  if (!/^https:\/\//i.test(cfg.appUrl)) {
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = c.vNeedUrl;
    toast(c.vNeedUrl);
    return { ok: false };
  }
  try {
    const r = await fetch('/api/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ping', targetUrl: cfg.appUrl }),
    });
    const res = await r.json();
    const note = res.success ? `${c.vTestOk} (${res.url || cfg.appUrl})` : `Status ${res.status || res.reason || 'erreur'}`;
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = note;
    toast(note);
    return res;
  } catch (err) {
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = err.message || 'Erreur';
    return { ok: false };
  }
}
async function syncSongToVercel(songIdOverride = null, songDoc = null, silent = false) {
  const cfg = collectVercelInputs();
  const c = cloudCopy();
  if (!cfg.appUrl && !cfg.deployHookUrl) {
    if (!silent) toast(c.vNeedUrl);
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = c.vNeedUrl;
    return { success: false };
  }
  const srcProj = (songDoc && songDoc.project) || S.project;
  const payload = {
    source: 'Alexura',
    firebaseProjectId: window.AlexuraCloud ? window.AlexuraCloud.config.projectId : '',
    songId: songIdOverride || S.cloudSongId || 'local',
    title: (songDoc && songDoc.title) || srcProj.title || 'Sans titre',
    artist: (songDoc && songDoc.artist) || srcProj.artist || '',
    lyrics: (songDoc && songDoc.lyrics) || srcProj.lyrics || '',
    lang: (songDoc && songDoc.lang) || srcProj.lang || 'auto',
    timing: srcProj.timing || {},
    karaokeCfg: srcProj.karaokeCfg || {},
    translation: srcProj.translation || null,
    timestamp: new Date().toISOString(),
  };
  try {
    const r = await fetch('/api/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sync', targetUrl: cfg.appUrl, payload }),
    });
    const res = await r.json();
    const msg = res.success ? `${c.vSyncOk} (${res.status})` : `Vercel sync: ${res.reason || res.status}`;
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = msg;
    if (!silent) toast(msg);
    if (res.success) {
      recordWork('vercel_sync', 'vercel', cfg.appUrl || cfg.projectName, payload.songId === 'local' ? '' : payload.songId);
      if (S.cloudUser && window.AlexuraCloud) {
        window.AlexuraCloud.saveVercelConfig(Object.assign({}, cfg, { lastSyncedAt: new Date().toISOString() })).catch(() => {});
      }
    }
    return res;
  } catch (err) {
    if (!silent) toast(err.message || 'Erreur');
    return { success: false };
  }
}
async function deployToVercel() {
  const cfg = collectVercelInputs();
  const c = cloudCopy();
  if (!cfg.deployHookUrl || !/^https:\/\//i.test(cfg.deployHookUrl)) {
    toast(c.vNeedHook);
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = c.vNeedHook;
    return { success: false };
  }
  try {
    const r = await fetch('/api/bridge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'deploy',
        targetUrl: cfg.deployHookUrl,
        payload: { source: 'Alexura', project: cfg.projectName, firebaseProjectId: window.AlexuraCloud ? window.AlexuraCloud.config.projectId : '' },
      }),
    });
    const res = await r.json();
    const msg = res.success ? `${c.vDeployOk} (${res.status})` : `Deploy: ${res.reason || res.status}`;
    if ($('vercelStatusNote')) $('vercelStatusNote').textContent = msg;
    toast(msg);
    if (res.success) {
      recordWork('vercel_deploy', 'vercel', cfg.projectName || 'Vercel');
      if (S.cloudUser && window.AlexuraCloud) {
        window.AlexuraCloud.saveVercelConfig(Object.assign({}, cfg, { lastDeployedAt: new Date().toISOString() })).catch(() => {});
      }
    }
    return res;
  } catch (err) {
    toast(err.message || 'Deploy error');
    return { success: false };
  }
}
function tearDownCloudListeners() {
  if (cloudSongsUnsub) {
    try { cloudSongsUnsub(); } catch (e) {}
    cloudSongsUnsub = null;
  }
  if (cloudHistoryUnsub) {
    try { cloudHistoryUnsub(); } catch (e) {}
    cloudHistoryUnsub = null;
  }
}
async function attachCloudListeners(user) {
  tearDownCloudListeners();
  if (!user || !window.AlexuraCloud) return;
  try {
    if (typeof window.AlexuraCloud.ensureUserReady === 'function') {
      await window.AlexuraCloud.ensureUserReady(user);
    }
    const vCfg = await window.AlexuraCloud.loadVercelConfig();
    if (vCfg) {
      applyVercelInputs(vCfg);
      try { localStorage.setItem(LS_VERCEL, JSON.stringify(vCfg)); } catch (e) {}
    }
  } catch (err) {
    const fmt = typeof window.AlexuraCloud.formatAuthError === 'function'
      ? window.AlexuraCloud.formatAuthError(err, document.documentElement.lang || 'fr')
      : null;
    if (fmt && fmt.code === 'auth/email-not-verified') {
      showCloudError(err);
      return;
    }
    if (!fmt || !fmt.isCancelled) showCloudError(err);
  }
  cloudSongsUnsub = window.AlexuraCloud.subscribeUserSongs(
    (songs) => { renderCloudSongs(songs); renderWorkHistory(S.cloudHistory); },
    (err) => showCloudError(err)
  );
  if (typeof window.AlexuraCloud.subscribeWorkHistory === 'function') {
    cloudHistoryUnsub = window.AlexuraCloud.subscribeWorkHistory(
      (entries) => renderWorkHistory(entries),
      (err) => showCloudError(err)
    );
  }
}
function bindCloudStudio() {
  applyCloudLabels();
  applyVercelInputs(readLocalVercelCfg());
  try {
    if ($('chkFbAutoSave')) $('chkFbAutoSave').checked = localStorage.getItem(LS_FBAUTO) === '1';
  } catch (e) {}
  if ($('chkFbAutoSave')) $('chkFbAutoSave').addEventListener('change', e => {
    try { localStorage.setItem(LS_FBAUTO, e.target.checked ? '1' : '0'); } catch (err) {}
  });

  const runGoogleAuth = async ({ switchAccount = false, openModalOnError = true } = {}) => {
    if (!window.AlexuraCloud) { openCloudHub('songs'); return null; }
    const c = cloudCopy();
    const lang = document.documentElement.lang || 'fr';
    showCloudError(null);
    const btns = ['btnGoogleAuth', 'btnFbSignIn', 'btnFbSwitchAccount'].map(id => $(id)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; b.setAttribute('aria-busy', 'true'); });
    if ($('btnGoogleAuth')) $('btnGoogleAuth').classList.add('is-loading');
    if ($('hdrGoogleLabel') && !S.cloudUser) $('hdrGoogleLabel').textContent = c.signingIn;
    try {
      const fn = switchAccount && typeof window.AlexuraCloud.switchAccountGoogle === 'function'
        ? window.AlexuraCloud.switchAccountGoogle
        : window.AlexuraCloud.signInGoogle;
      const u = await fn();
      showCloudError(null);
      return u;
    } catch (err) {
      const fmt = typeof window.AlexuraCloud.formatAuthError === 'function'
        ? window.AlexuraCloud.formatAuthError(err, lang)
        : null;
      const activeUser = typeof window.AlexuraCloud.getUser === 'function' ? window.AlexuraCloud.getUser() : null;
      if (activeUser && !cloudSongsUnsub) {
        attachCloudListeners(activeUser);
      }
      if (fmt && fmt.isRedirecting) {
        return null;
      }
      if (fmt && fmt.isCancelled && switchAccount) {
        toast(c.authCancelledToast);
        return null;
      }
      if (openModalOnError) openCloudHub('songs');
      showCloudError(err);
      return null;
    } finally {
      btns.forEach(b => { b.disabled = false; b.setAttribute('aria-busy', 'false'); });
      if ($('btnGoogleAuth')) $('btnGoogleAuth').classList.remove('is-loading');
      syncHeaderGoogleAuth(S.cloudUser);
    }
  };
  cloudAuthRunner = runGoogleAuth;

  if ($('btnGoogleAuth')) $('btnGoogleAuth').addEventListener('click', async () => {
    if (S.cloudUser) { openCloudHub('songs'); return; }
    const u = await runGoogleAuth({ switchAccount: false, openModalOnError: true });
    if (u) openCloudHub('songs');
  });
  if ($('btnCloudHub')) $('btnCloudHub').addEventListener('click', () => openCloudHub());
  if ($('btnCloudClose')) $('btnCloudClose').addEventListener('click', closeCloudHub);
  if ($('cloudDlg')) $('cloudDlg').addEventListener('click', e => {
    if (e.target === $('cloudDlg')) closeCloudHub();
  });
  if ($('tabCloudSongs')) $('tabCloudSongs').addEventListener('click', () => setCloudTab('songs'));
  if ($('tabCloudHistory')) $('tabCloudHistory').addEventListener('click', () => setCloudTab('history'));
  if ($('tabCloudVercel')) $('tabCloudVercel').addEventListener('click', () => setCloudTab('vercel'));
  ['cloudSongSearch', 'cloudSongFilter', 'cloudSongSort'].forEach(id => {
    if ($(id)) $(id).addEventListener(id === 'cloudSongSearch' ? 'input' : 'change', () => renderCloudSongs(S.cloudSongs));
  });
  ['cloudHistorySearch', 'cloudHistoryFilter'].forEach(id => {
    if ($(id)) $(id).addEventListener(id === 'cloudHistorySearch' ? 'input' : 'change', () => renderWorkHistory(S.cloudHistory));
  });
  if ($('btnClearCloudHistory')) $('btnClearCloudHistory').addEventListener('click', async () => {
    const c = cloudCopy();
    if (S.cloudUser && window.AlexuraCloud && typeof window.AlexuraCloud.clearWorkHistory === 'function') {
      try { await window.AlexuraCloud.clearWorkHistory(); } catch (err) { showCloudError(err); return; }
    }
    writeLocalHistory([]);
    S.cloudHistory = [];
    renderWorkHistory([]);
    toast(c.histCleared);
  });
  if ($('btnCloudSave')) $('btnCloudSave').addEventListener('click', () => saveCurrentSongToFirebase(false, false));
  if ($('btnFbSaveSong')) $('btnFbSaveSong').addEventListener('click', () => saveCurrentSongToFirebase(false, false));
  if ($('btnFbSaveNew')) $('btnFbSaveNew').addEventListener('click', () => saveCurrentSongToFirebase(true, false));
  if ($('btnFbSignIn')) $('btnFbSignIn').addEventListener('click', () => runGoogleAuth({ switchAccount: false, openModalOnError: false }));
  if ($('btnFbSwitchAccount')) $('btnFbSwitchAccount').addEventListener('click', () => runGoogleAuth({ switchAccount: true, openModalOnError: false }));
  if ($('btnFbSignOut')) $('btnFbSignOut').addEventListener('click', async () => {
    if (!window.AlexuraCloud) return;
    showCloudError(null);
    tearDownCloudListeners();
    try { await window.AlexuraCloud.signOutGoogle(); } catch (err) { showCloudError(err); }
  });
  if ($('btnVercelSave')) $('btnVercelSave').addEventListener('click', saveVercelSettings);
  if ($('btnVercelTest')) $('btnVercelTest').addEventListener('click', testVercelBridge);
  if ($('btnVercelSync')) $('btnVercelSync').addEventListener('click', () => syncSongToVercel(null, null, false));
  if ($('btnVercelDeploy')) $('btnVercelDeploy').addEventListener('click', deployToVercel);

  if (window.AlexuraCloud && typeof window.AlexuraCloud.subscribeBeforeAuthChange === 'function') {
    window.AlexuraCloud.subscribeBeforeAuthChange(() => tearDownCloudListeners());
  }
  if (window.AlexuraCloud && typeof window.AlexuraCloud.subscribeAuthError === 'function') {
    window.AlexuraCloud.subscribeAuthError((err) => {
      openCloudHub('songs');
      showCloudError(err);
    });
  }

  if (window.AlexuraCloud && typeof window.AlexuraCloud.subscribeAuth === 'function') {
    let lastAuthUid = null;
    let hadSignedIn = false;
    window.AlexuraCloud.subscribeAuth(async (user) => {
      const nextUid = user ? user.uid : null;
      if ((lastAuthUid && nextUid && nextUid !== lastAuthUid) || (hadSignedIn && !nextUid) || (nextUid && S.project && S.project.cloudOwnerUid && S.project.cloudOwnerUid !== nextUid)) {
        S.cloudSongId = null;
        if (S.project) {
          delete S.project.cloudSongId;
          delete S.project.cloudOwnerUid;
        }
        if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = '';
      }
      if (nextUid) hadSignedIn = true;
      else if (hadSignedIn) hadSignedIn = false;
      lastAuthUid = nextUid;
      S.cloudUser = user || null;
      tearDownCloudListeners();
      applyCloudLabels();
      const c = cloudCopy();
      if (user) {
        showCloudError(null);
        if ($('fbSignedOutRow')) $('fbSignedOutRow').hidden = true;
        if ($('fbSignedInBox')) $('fbSignedInBox').hidden = false;
        if ($('fbUserName')) $('fbUserName').textContent = user.displayName || user.email || 'Creator';
        if ($('fbUserEmail')) $('fbUserEmail').textContent = user.email || '';
        if ($('fbVerifiedBadge')) {
          $('fbVerifiedBadge').textContent = c.verifiedBadge;
          $('fbVerifiedBadge').hidden = user.emailVerified === false;
        }
        if ($('fbCurSongBadge')) $('fbCurSongBadge').textContent = S.cloudSongId ? `ID: ${S.cloudSongId}` : '';
        const av = $('fbUserAvatar');
        if (av) {
          if (user.photoURL) { av.src = user.photoURL; av.hidden = false; }
          else { av.hidden = true; av.removeAttribute('src'); }
        }
        if (user.emailVerified === false) {
          showCloudError(new Error('AUTH_EMAIL_NOT_VERIFIED'));
          return;
        }
        await attachCloudListeners(user);
      } else {
        if ($('fbSignedOutRow')) $('fbSignedOutRow').hidden = false;
        if ($('fbSignedInBox')) $('fbSignedInBox').hidden = true;
        if ($('fbVerifiedBadge')) $('fbVerifiedBadge').hidden = true;
        S.cloudSongs = [];
        S.cloudHistory = [];
        renderCloudSongs([]);
        renderWorkHistory([]);
      }
    });
  }
}

/* ---------------- Notice (User Manual & Button Guide) ---------------- */
let noticePhotoList = [];
let noticeLightboxIdx = 0;

function openNoticeLightbox(idx) {
  const lb = $('noticeLightbox');
  const img = $('noticeLbImg');
  const title = $('noticeLbTitle');
  const cap = $('noticeLbCaption');
  const counter = $('noticeLbCounter');
  const prev = $('btnNoticeLbPrev');
  const next = $('btnNoticeLbNext');
  if (!lb || !img || !noticePhotoList.length) return;
  const total = noticePhotoList.length;
  noticeLightboxIdx = ((idx % total) + total) % total;
  const entry = noticePhotoList[noticeLightboxIdx];
  img.src = entry.src;
  img.alt = entry.alt || entry.title || '';
  if (title) title.textContent = entry.title || '';
  if (cap) cap.textContent = entry.caption || '';
  if (counter) counter.textContent = (noticeLightboxIdx + 1) + ' / ' + total;
  if (prev) prev.disabled = total <= 1;
  if (next) next.disabled = total <= 1;
  lb.hidden = false;
}

function closeNoticeLightbox() {
  const lb = $('noticeLightbox');
  if (lb) lb.hidden = true;
}

function getNoticeContent() {
  const en = isEn();
  const imgs = {
    overview: '/src/assets/images/notice_studio_overview_1795104247958.jpg',
    header: '/src/assets/images/notice_header_controls_1795104770790.jpg',
    lyrics: '/src/assets/images/notice_lyrics_markup_1795104772435.jpg',
    sync: '/src/assets/images/notice_vocal_sync_1795104248129.jpg',
    tap: '/src/assets/images/notice_tap_studio_1795104774243.jpg',
    stage: '/src/assets/images/notice_stage_timeline_1795104773140.jpg',
    themes: '/src/assets/images/notice_themes_showcase_1795104249830.jpg',
    artfx: '/src/assets/images/notice_art_motion_fx_1795104773745.jpg',
    exportImg: '/src/assets/images/notice_export_pipeline_1795104251232.jpg',
  };
  if (en) {
    return {
      title: 'Notice',
      subtitle: 'Simple & visual Alexura guide · Click any photo to enlarge and understand every button in seconds',
      searchPh: 'Search any button (e.g. Tap, MP4, /, Google, 60fps)…',
      tourBtn: 'Interactive tour',
      tourTitle: 'Close Notice and launch the step-by-step screen spotlight',
      closeLabel: 'Close Notice',
      zoomHint: 'Click to enlarge photo',
      prevPhoto: '← Previous',
      nextPhoto: 'Next →',
      closePhoto: '✕ Close',
      emptyTitle: 'No matching button or guide entry found',
      emptyHint: 'Try searching "MP4", "Tap", "LRC", "Art & Motion", "Google" or "Shortcut".',
      clearSearch: 'Show all chapters',
      matchesFmt: n => n + ' match' + (n > 1 ? 'es' : ''),
      sections: [
        {
          id: 'overview',
          num: '01',
          nav: 'Overview & Top Bar',
          title: '01. Understand the Screen & Every Top Bar Button',
          lead: 'Think of Alexura as a simple 3-step studio from left to right: 1) Prepare your song and lyrics on the left, 2) Watch and adjust timing in the center, 3) Choose a visual style and export your video on the right.',
          gallery: [
            {
              src: imgs.overview,
              title: 'Photo 1 — The 3 columns of your workspace',
              alt: 'Alexura Motion Studio three-column workspace diagram',
              caption: 'Left column = Audio & Lyrics. Center = Live 16:9 video, Karaoke bar & Timeline. Right column = Themes, Visual Styles & Video Export.',
            },
            {
              src: imgs.header,
              title: 'Photo 2 — Close-up of every button in the top bar',
              alt: 'Top navigation bar visual guide with labeled zones',
              caption: 'Project title & artist on the left, golden Randomize trigger, Simple/Advanced mode switch, Cloud & JSON save buttons, and Notice on the right.',
            },
          ],
          steps: [
            { num: 'Step 01', title: 'Add audio & words', desc: 'Drop your MP3/WAV song and paste your lyrics—or let AI listen to the singer and write the lyrics for you.' },
            { num: 'Step 02', title: 'Lock words to voice', desc: 'Press Voice Sync for automatic timing, or open Tap Studio and tap Space as the singer starts each phrase.' },
            { num: 'Step 03', title: 'Pick style & save video', desc: 'Choose a Theme (like Cinema or Art & Motion), tap Randomize until you love the look, then click Export MP4.' },
          ],
          subh: 'Top bar buttons explained simply',
          items: [
            {
              label: 'Song title & Artist',
              zone: 'Top Bar · Left',
              desc: 'Type the name of your song and artist. Alexura displays them cleanly on the opening title card and uses them to name your exported video file.',
              example: '<strong>Example:</strong> Type <code>Midnight Echo</code> and <code>Alexura</code> → your video starts with that title card and exports as <code>Midnight Echo.mp4</code>.',
            },
            {
              label: 'Randomize (Golden top button & R key)',
              zone: 'Top Bar · Instant Styling',
              desc: 'Your magic creative button. One click invents a fresh combination of fonts, colors, background art and text animation matching your active Theme.',
              example: '<strong>Tip:</strong> Don’t like a result? Press <code>R</code> again, or use <strong>◀ / ▶</strong> under the video to go back to a look you liked earlier.',
              photo: { src: imgs.header, title: 'Visual example: Top Bar & Randomize', caption: 'Spot the golden Randomize trigger and mode buttons in the top bar.' },
            },
            {
              label: 'Mobile / Simple / Advanced + ?',
              zone: 'Top Bar · View Mode',
              desc: '<strong>Simple</strong> keeps only the easiest controls (Theme + Randomize + Export). <strong>Advanced</strong> shows all fine-tuning tabs, color pickers and word timeline. <strong>Mobile</strong> stacks everything for phones. <strong>?</strong> launches the live guided tour.',
              example: '<strong>Recommended:</strong> Start in <strong>Simple</strong> to get a great video in 1 minute, then switch to <strong>Advanced</strong> if you want custom fonts or 60 fps.',
            },
            {
              label: 'Google / ☁ Save / 📚 Projects & History',
              zone: 'Top Bar · Cloud Backup',
              desc: 'Sign in with Google so you never lose work. <strong>☁ Save</strong> stores your song audio, lyrics and timing online in Firebase; <strong>Projects & History</strong> lets you reopen older songs or push updates to Vercel.',
              example: '<strong>Example:</strong> Start a project at work, click <strong>☁ Save</strong>, then sign in at home and open <strong>📚 Projects & History</strong> to continue right where you left off.',
            },
            {
              label: 'Open / Save (.json) · Export for AE · Reset',
              zone: 'Top Bar · Files',
              desc: '<strong>Save</strong> downloads a tiny <code>.json</code> project file to your computer; <strong>Open</strong> reloads it anytime. <strong>Export for AE</strong> prepares animation data for Adobe After Effects. <strong>Reset</strong> clears the screen for a brand-new song.',
            },
            {
              label: 'Notice & About / Terms',
              zone: 'Top Bar · Help',
              desc: '<strong>Notice</strong> opens this illustrated handbook anytime. <strong>About</strong> confirms that exported videos belong to you and lists open-source licenses.',
            },
          ],
        },
        {
          id: 'lyrics',
          num: '02',
          nav: 'Lyrics, Symbols & Translation',
          title: '02. Writing Lyrics, Simple Visual Symbols & Translation',
          lead: 'Write or paste one sung sentence per line in the Lyrics box. Want extra drama or an instrumental break? Just add one tiny symbol directly in your text—no complex menus needed.',
          gallery: [
            {
              src: imgs.lyrics,
              title: 'Photo 3 — Before / After: What each lyric symbol draws on screen',
              alt: 'Visual split-screen example showing slash cut, asterisk impact word, exclamation flash, bar note, interlude and translation',
              caption: 'Left: plain text with simple symbols (/, *, !, |, [interlude]). Right: the exact animated video cuts, bold words, flashes and bilingual subtitles generated automatically.',
            },
            {
              src: imgs.overview,
              title: 'Photo 4 — Where the Lyrics & Translation boxes sit',
              alt: 'Left column showing lyrics box and optional translation panel',
              caption: 'Drop any .lrc / .srt / .txt file directly over the window, or activate the Translation panel right under the language selector.',
            },
          ],
          subh: 'Lyrics buttons & visual examples',
          items: [
            {
              label: 'Load LRC / SRT & Clear lyrics',
              zone: 'Top of Lyrics Box',
              desc: 'Imports existing timed lyrics (<code>.lrc</code>, <code>.srt</code>, <code>.vtt</code>) or plain text (<code>.txt</code>) in one click. You can also drag and drop a file directly from your desktop onto Alexura.',
              example: '<strong>Example:</strong> Drop <code>song.lrc</code> → lines like <code>[00:18.50]Under the city lights</code> already arrive synced at 18.5 seconds!',
            },
            {
              label: 'Smart Symbols: / · *word* · ! · |note · [interlude]',
              zone: 'Inside Lyrics Textarea (Syntax Guide)',
              desc: 'Add simple punctuation directly inside any line to direct the camera and typography:',
              example: '<code>I remember / the color</code> → cuts the screen cleanly into 2 separate shots.<br><code>Shine *bright* tonight</code> → makes the word <strong>bright</strong> huge and impactful.<br><code>Wake up!</code> → adds a subtle camera punch/flash.<br><code>light|lumière</code> → shows a small floating note above/below the word.<br><code>[interlude 8]</code> → pauses text for an 8-second guitar/piano solo.<br><code># chorus note</code> → hidden personal memo (never shown in video).',
              photo: { src: imgs.lyrics, title: 'See this transformation in Photo 3', caption: 'Visual comparison of /, *word*, !, |note and bilingual subtitles on stage.' },
            },
            {
              label: 'Lyrics language & 🌐 Translation Layer',
              zone: 'Below Lyrics Box',
              desc: 'Leave language on <strong>Auto-detect</strong> (or pick <strong>Multilingual Mix</strong> for bilingual songs). Click <strong>🌐 Translate</strong> to add a second language underneath—using the exact same vocal timing without touching your original lyrics.',
              example: '<strong>Example:</strong> Keep English lyrics on top and display French translation in soft grey just beneath both on the Karaoke bar and in the exported MP4 (toggle <strong>⚙ Style</strong> to move it above, below, or change color).',
            },
          ],
        },
        {
          id: 'sync',
          num: '03',
          nav: 'Audio, AI & Tap Sync',
          title: '03. Syncing Words Perfectly to the Singer’s Voice',
          lead: 'You have 3 easy ways to match text to singing: 1) Let AI transcribe and time the whole song, 2) Click Voice Sync if you already pasted lyrics, or 3) Open Tap Studio and tap along with the singer like a rhythm game.',
          gallery: [
            {
              src: imgs.sync,
              title: 'Photo 5 — How AI & Voice Sync read the singer’s voice',
              alt: 'Vocal waveform peak analysis and 10 millisecond word boundaries',
              caption: 'Alexura isolates the center vocal energy (emerald) from music beats and snaps every word start/end within 10 ms.',
            },
            {
              src: imgs.tap,
              title: 'Photo 6 — Inside Tap Studio (Spacebar, 0.75× Speed & Loop)',
              alt: 'Tap Sync Studio showing live radar waveform, glowing Spacebar tap key, 0.75x speed selector, ±25ms nudges and loop toggle',
              caption: 'Tap Space as the singer starts each phrase. Slow fast verses to 0.75×, loop tricky lines, or fine-tune by ±25 ms.',
            },
          ],
          subh: 'Audio & Synchronization buttons explained',
          items: [
            {
              label: 'Import audio',
              zone: 'Audio & Timing Section',
              desc: 'Choose an MP3, WAV, M4A, AAC, FLAC, OGG or MP4 file from your device. Everything loads privately inside your browser in seconds and detects tempo (BPM) automatically.',
            },
            {
              label: '✨ AI Transcribe Lyrics',
              zone: 'Audio & Timing Section',
              desc: 'Don’t have the written lyrics? Click this button and AI listens to the isolated vocals, writes out every sung line (even mixed languages) and timestamps every word.',
              photo: { src: imgs.sync, title: 'Visual example: Acoustic AI word locks', caption: 'Every word receives exact timestamps and a green/amber confidence score.' },
            },
            {
              label: '⚡ Voice Sync',
              zone: 'Audio & Timing Section',
              desc: 'Already pasted your lyrics? Click <strong>Voice Sync</strong> once. Alexura listens to your song and automatically lines up every phrase and word with the singer’s voice.',
              example: '<strong>When to use it:</strong> Right after pasting plain lyrics—90% of songs lock cleanly in seconds before you even touch a slider.',
            },
            {
              label: '⏱ Tap to sync (Tap Studio)',
              zone: 'Audio & Timing Section',
              desc: 'Opens the interactive rhythm recorder shown in Photo 6. Watch the moving line, hear the singer, and press <span class="notice-kbd">Space</span> (or click <strong>TAP</strong>) whenever a word or phrase begins.',
              example: '<strong>3 pro helpers inside Tap Studio:</strong><br>• Set <strong>Speed 0.75×</strong> for fast rap verses.<br>• Keep <strong>Vocal Onset Snap (±90ms)</strong> ON so even if your finger is slightly early/late, it magnet-locks onto the singer’s real syllable.<br>• Press <strong>🔁 Loop</strong> to replay one tough sentence until it feels 100% natural, then click <strong>⚡ Finish with AI Voice</strong>.',
              photo: { src: imgs.tap, title: 'Visual example: Tap Studio live radar', caption: 'Follow the emerald vocal peaks and tap Space right on each word entry.' },
            },
            {
              label: '🔬 Quality Control & Word Editor',
              zone: 'Below Audio Section',
              desc: 'Color-codes words by certainty (Green = locked on vocal peak, Amber = check by ear). Click any word chip to hear just that word (<strong>▶ Word</strong>), shift it <strong>-25ms / +25ms</strong>, lock it with a checkmark so nothing moves it again, or insert a forgotten word (<strong>+ Before / + After</strong>).',
            },
          ],
        },
        {
          id: 'stage',
          num: '04',
          nav: 'Stage, Karaoke & Timeline',
          title: '04. Video Stage, Live Karaoke & Pro Timeline',
          lead: 'Check your video like a director: scrub frame by frame, adjust ear-to-screen sync with one click while listening, or drag any word block along the sound wave.',
          figure: {
            src: imgs.stage,
            title: 'Photo 7 — Live 16:9 Stage, Karaoke Prompter & Multi-Track Word Timeline',
            fallbackTitle: 'Stage, Karaoke Bar & Draggable Word Blocks',
            alt: 'Live 16:9 lyric stage above Karaoke prompter highlight bar and draggable colored timeline word blocks',
            caption: 'Top: real-time video stage. Middle: glowing karaoke preview + ±10 ms Singing↔Display sync bar. Bottom: draggable blue/green word blocks directly over the vocal wave.',
          },
          subh: 'Every control under the video explained simply',
          items: [
            {
              label: '▶ Play · Loop · ◀ / ▶ · Shuffle · Randomize',
              zone: 'Transport Bar (Center)',
              desc: '<strong>Play/Pause</strong> previews with sound (<span class="notice-kbd">Space</span>). <strong>Loop</strong> repeats the whole song, current line, or single cut while you polish. <strong>Shuffle</strong> keeps your colors/fonts and tries fresh animations; <strong>Randomize</strong> invents a totally new direction.',
            },
            {
              label: 'Word / Progressive / Character',
              zone: 'Karaoke Prompter Header',
              desc: 'Controls how words light up as you sing:<br>• <strong>Word:</strong> snaps cleanly from word to word.<br>• <strong>Progressive:</strong> paints color smoothly across each syllable like studio karaoke.<br>• <strong>Character:</strong> lights one character at a time (best for Japanese, Chinese, Korean or long sustained notes).',
            },
            {
              label: 'Synchro Singing↔Display (-50 / -10 / +10 / +50ms)',
              zone: 'Karaoke Coordination Strip',
              desc: 'Do the words highlight a hair before or after the singer’s voice? Press <strong>-10ms</strong> or <strong>+10ms</strong> live while listening until your eyes and ears agree 100%. You can also click <strong>⏱ Sync word here</strong> right on the beat.',
              example: '<strong>Example:</strong> Bluetooth headphones add ~80 ms audio delay—press <strong>+50ms</strong> once and the screen lines up with your headphones immediately.',
              photo: { src: imgs.stage, title: 'See this bar in Photo 7', caption: 'Find the ±10 ms coordination buttons and draggable word blocks under the stage.' },
            },
            {
              label: '⚙ Settings / ⛶ Fullscreen / Karaoke ON',
              zone: 'Karaoke Prompter Header',
              desc: '<strong>⚙ Settings</strong> adjusts prompter font size, screen height (Top / Center / Bottom), box transparency and active glow color. <strong>⛶ Fullscreen</strong> turns your whole monitor into a live stage. <strong>Karaoke ON</strong> includes or hides the karaoke subtitle strip inside exported MP4s.',
            },
            {
              label: 'Timeline & Millisecond Inspector (HH:MM:SS.mmm)',
              zone: 'Bottom of Center Column',
              desc: 'Toggle Audio and Vocal waves, click <strong>🔍 Word</strong> to zoom straight into one word, and drag the left or right edge of any colored word block to shorten or stretch how long it stays lit.',
            },
          ],
        },
        {
          id: 'themes',
          num: '05',
          nav: 'Themes, Styles & Art',
          title: '05. Choosing Themes, Art & Motion Fonts & Custom Effects',
          lead: 'Not sure where to start? Pick one Theme first—each Theme comes with matching fonts, backgrounds, camera moves and transitions. Then fine-tune individual details anytime.',
          gallery: [
            {
              src: imgs.themes,
              title: 'Photo 8 — Visual showcase of the 6 Signature Themes',
              alt: 'Six creative themes: Cinematic, Music Video, Art & Motion, Futuristic, Lifestyle, Animation',
              caption: 'Cinematic (film) · Music Video (Pop/Trap/K-Pop) · Art & Motion (Bauhaus/Pop Art/3D/Glitch) · Futuristic (AI/Neon) · Lifestyle (Luxury) · Animation (Anime).',
            },
            {
              src: imgs.artfx,
              title: 'Photo 9 — Visual specimens: Art & Motion Styles + Keep Centre Free & Chroma Key',
              alt: 'Four panels comparing Bauhaus Kinetic, Pop Art Ben-Day halftone, 3D Wireframe depth, Keep Centre Free and Chroma Green',
              caption: 'See Bauhaus geometry, Pop Art halftone dots, 3D wireframe cubes, and how Keep Centre Free frames a singer in the middle.',
            },
          ],
          subh: 'Theme & Style controls made simple',
          items: [
            {
              label: 'Theme Selector (17 Universes · Up to 30 Styles each)',
              zone: 'Right Panel (Simple & Transport)',
              desc: 'Pick your overall mood before pressing Randomize:<br>• <strong>GUOFENG (Classical Chinese · 30 bespoke elements):</strong> Shan-Shui ink landscapes, Forbidden City vermilion, Blue-and-White Porcelain, Dunhuang flying silk ribbons, Lantern Festival, Bamboo, Jade & Wuxia calligraphy.<br>• <strong>CINEMATIC / MUSIC VIDEO / ART &amp; MOTION / FUTURISTIC / LIFESTYLE / ANIMATION:</strong> full studio aesthetics (20 fluid styles each).<br>• <strong>BAUHAUS · POP ART · 3D ISOMETRIC · COMPOSITING:</strong> dedicated geometry, Ben-Day comic halftones, 3D wireframe cubes &amp; Keep-Centre-Free / Chroma framing.',
              photo: { src: imgs.themes, title: 'Compare visual themes in Photo 8', caption: 'Every theme shifts colors, lighting, camera speed and curated visual styles together.' },
            },
            {
              label: 'Change just this: Style / Colors / Mood / Cuts',
              zone: 'Right Panel (Simple Mode)',
              desc: 'Love your color palette but want calmer backgrounds or bolder typography? These 4 buttons re-roll ONLY that one ingredient while keeping everything else untouched.',
            },
            {
              label: 'Style · FX · Techniques Tabs (Advanced)',
              zone: 'Right Panel (Advanced Mode)',
              desc: 'Full director control:<br>• <strong>Style:</strong> pick exact presets, assign fonts per role (Display, Serif, Body, Mono), or upload your own <code>.ttf / .otf</code> font files.<br>• <strong>FX:</strong> slide Motion Intensity, Glitch amount, Flash pulses, or switch <em>Koma</em> frame rate (Smooth / 12 fps / 8 fps hand-drawn anime feel).<br>• <strong>Techniques:</strong> check or uncheck exact layouts, camera sweeps, backgrounds and transitions.',
              photo: { src: imgs.artfx, title: 'See Bauhaus, Pop Art & 3D styles in Photo 9', caption: 'Each Art & Motion style activates dedicated typography, halftones or 3D geometry.' },
            },
            {
              label: 'Lock 🔒 & Dice 🎲 on each lyric line',
              zone: 'Left Line List',
              desc: 'Really love how your chorus looks? Click its <strong>Lock 🔒</strong> icon so Randomize and Shuffle skip that line forever. Click any single cut chip at the bottom to swap just that phrase’s font or animation.',
            },
          ],
        },
        {
          id: 'export',
          num: '06',
          nav: 'Export, Layers & Cloud',
          title: '06. Exporting 4K Video, Transparent Layers & Subtitles',
          lead: 'All rendering happens straight inside your browser—your video never waits in a cloud queue. Choose ready-to-post MP4s, green/transparent overlays for external editing, or timed lyric files.',
          gallery: [
            {
              src: imgs.exportImg,
              title: 'Photo 10 — Complete Export Pipeline (MP4 4K, Chroma Key, PNG Layers, LRC/SRT)',
              alt: 'Multi-format export pipeline diagram showing MP4 4K 60fps, Chroma Green/Black, PNG front/back layers and subtitle formats',
              caption: 'Pick screen shape (16:9 or 9:16), quality up to 4K 60 fps, or export clean transparent layers and word-timed subtitles.',
            },
            {
              src: imgs.artfx,
              title: 'Photo 11 — Keep Centre Free & Pure Green Chroma Example (bottom-right panel)',
              alt: 'Side-by-side comparison of Keep Centre Free around a singer silhouette and Green Screen Chroma Key export',
              caption: 'Keep Centre Free pushes words to the left/right edges so a filmed singer stays unobstructed; Chroma Green isolates pure lyrics for Premiere/CapCut.',
            },
          ],
          subh: 'Every export button explained clearly',
          items: [
            {
              label: 'Aspect Ratio · Resolution · FPS · Range',
              zone: 'Export Settings',
              desc: '<strong>16:9</strong> fits YouTube & widescreen TVs; <strong>9:16</strong> fits TikTok, Instagram Reels & YouTube Shorts; <strong>1:1 / 4:5</strong> fit social feeds; <strong>21:9</strong> gives ultra-wide cinema. Export from 720p up to <strong>4K (2160p)</strong> at 24, 30 or 60 fps—or pick line numbers (e.g. lines 12–24) to export just your chorus for a teaser!',
            },
            {
              label: 'Keep Centre Free & Background Key (Green / Black)',
              zone: 'Export Settings (Compositing)',
              desc: 'Filming yourself singing or layering lyrics over concert footage? Check <strong>Keep Centre Free</strong> so words alternate left/right around your face. Or choose <strong>Green Screen</strong> / <strong>Pure Black</strong> to remove the background cleanly in Premiere, Final Cut, DaVinci or CapCut.',
            },
            {
              label: 'Export MP4 / Large Video (Direct to File)',
              zone: 'Export Buttons',
              desc: '<strong>Export MP4</strong> builds the finished video with full sound right in Chrome/Edge. Exporting a full 4-minute song in 1080p or 4K? Use <strong>Large Video (Direct to File)</strong>—it streams frames straight onto your hard drive so your browser never runs out of memory.',
            },
            {
              label: 'PNG Sequence / Transparent PNG / Front-Back Layers',
              zone: 'Export Buttons (ZIP)',
              desc: 'Downloads a ZIP archive of crystal-clear individual frames. Choose <strong>Transparent PNG</strong> for true alpha transparency (no green fringe), or <strong>Front/Back Layers</strong> to receive separate <code>back/</code> background and <code>front/</code> lyric folders.',
            },
            {
              label: 'LRC / SRT / VTT / Enhanced LRC / JSON / TXT',
              zone: 'Synced Lyrics Export',
              desc: 'One-click download of subtitle files for YouTube/Spotify/Premiere. Turn ON <strong>Include translation</strong> if you generated a bilingual translation layer.',
            },
          ],
        },
        {
          id: 'shortcuts',
          num: '07',
          nav: 'Shortcuts & Visual Recipes',
          title: '07. Fast Keyboard Shortcuts & 3 Visual Step-by-Step Recipes',
          lead: 'Learn 5 keyboard keys to save half your time, or follow one of these 3 ready-made workflows from start to finish.',
          gallery: [
            {
              src: imgs.overview,
              title: '1. Prepare Audio & Lyrics',
              alt: 'Overview of workspace step 1',
              caption: 'Drop MP3 + paste lyrics or click AI Transcribe.',
            },
            {
              src: imgs.tap,
              title: '2. Lock Timing with Voice or Tap',
              alt: 'Tap Studio timing radar step 2',
              caption: 'Voice Sync or Tap Studio [Space] + ±10ms fine check.',
            },
            {
              src: imgs.exportImg,
              title: '3. Style with Theme & Export 4K',
              alt: 'Export pipeline step 3',
              caption: 'Press R for fresh visuals, then export MP4 or Layers.',
            },
          ],
          subh: 'Essential keyboard shortcuts',
          items: [
            { label: 'Space · ← / → · Shift + ← / →', zone: 'Stage Playback', desc: '<span class="notice-kbd">Space</span> plays or pauses video. <span class="notice-kbd">←</span> / <span class="notice-kbd">→</span> step 1 frame at a time; hold <span class="notice-kbd">Shift</span> to jump 1 second.' },
            { label: 'R · D · L', zone: 'Instant Styling', desc: '<span class="notice-kbd">R</span> runs Randomize (within active Theme). <span class="notice-kbd">D</span> redesigns only the current cut under the playhead. <span class="notice-kbd">L</span> locks or unlocks the active line.' },
            { label: 'Ctrl+Z / Cmd+Z · Ctrl+Y', zone: 'Undo / Redo', desc: 'Safely undo or redo lyric edits and timing tweaks anytime.' },
            { label: 'Space · E · P · S · Backspace · Tab · Esc', zone: 'Inside Tap Sync Studio', desc: '<span class="notice-kbd">Space</span> = Tap word/line · <span class="notice-kbd">E</span> = Mark end · <span class="notice-kbd">P</span> = Pause · <span class="notice-kbd">S</span> = Skip · <span class="notice-kbd">Backspace</span> = Step back 1 tap · <span class="notice-kbd">Tab</span> = Split cut · <span class="notice-kbd">Esc</span> = Save & exit.' },
          ],
          steps: [
            { num: 'Recipe A', title: 'Complete Music Video in 2 Min', desc: '1. Import MP3 → 2. Paste lyrics → 3. Click Voice Sync → 4. Pick Music Video or Art & Motion → 5. Press R until it clicks → 6. Export 1080p MP4.' },
            { num: 'Recipe B', title: 'Pinpoint Singing Karaoke', desc: '1. Import audio → 2. Click AI Transcribe Lyrics → 3. Check amber words in Quality Control → 4. Fine-tune Singing↔Display (±10ms) → 5. Export MP4 + Enhanced LRC.' },
            { num: 'Recipe C', title: 'TikTok / Reel / Vocal Overlay', desc: '1. Set Format 9:16 → 2. Tick Keep Centre Free or Chroma Green → 3. Set 60 fps → 4. Export Transparent PNG ZIP or Large MP4 and drop over your footage.' },
          ],
        },
      ],
    };
  }

  // Comprehensive French Notice (Simple explanations + Rich visual photo examples)
  return {
    title: 'Notice',
    subtitle: 'Guide illustré en images d’Alexura Motion Studio · Touches expliquées simplement avec photos à cliquer pour agrandir',
    searchPh: 'Chercher un bouton ou mot-clé (ex: Tap, MP4, /, Google, 60 fps)…',
    tourBtn: 'Visite guidée',
    tourTitle: 'Fermer la Notice et montrer les boutons directement à l’écran',
    closeLabel: 'Fermer la Notice',
    zoomHint: 'Cliquer pour agrandir la photo',
    prevPhoto: '← Photo précédente',
    nextPhoto: 'Photo suivante →',
    closePhoto: '✕ Fermer l’aperçu',
    emptyTitle: 'Aucun bouton ou exemple trouvé pour cette recherche',
    emptyHint: 'Essayez par exemple « MP4 », « Tap », « LRC », « Art & Motion », « Karaoké » ou « Google ».',
    clearSearch: 'Afficher tous les chapitres',
    matchesFmt: n => n + ' résultat' + (n > 1 ? 's' : ''),
    sections: [
      {
        id: 'overview',
        num: '01',
        nav: 'Vue d’ensemble & Barre du haut',
        title: '01. Comprendre l’écran et chaque bouton du haut en un coup d’œil',
        lead: 'Voyez Alexura comme un atelier très simple de gauche à droite : 1) À gauche vous mettez la musique et les paroles, 2) Au centre vous regardez la vidéo et réglez le timing, 3) À droite vous choisissez le style visuel et téléchargez votre vidéo.',
        gallery: [
          {
            src: imgs.overview,
            title: 'Photo 1 — Les 3 zones de votre écran',
            alt: 'Illustration de l’espace de travail Alexura Motion Studio en trois colonnes',
            caption: 'Gauche : Paroles & Audio · Centre : Écran vidéo 16:9, Prompteur Karaoké & Frise · Droite : Thèmes, Effets & Export MP4.',
          },
          {
            src: imgs.header,
            title: 'Photo 2 — Zoom sur tous les boutons de la barre du haut',
            alt: 'Gros plan schématique de la barre supérieure d’Alexura : Titre, Aléatoire, Modes, Google Cloud, JSON, After Effects et Notice',
            caption: 'Repérez facilement le bouton doré Aléatoire, les modes Facile/Avancé, la sauvegarde Google Cloud, les fichiers .json et le bouton Notice.',
          },
        ],
        steps: [
          { num: 'Étape 01', title: 'Mettre le son et le texte', desc: 'Importez votre MP3/WAV puis collez vos paroles — ou laissez l’IA écouter la voix et écrire les paroles toute seule.' },
          { num: 'Étape 02', title: 'Caler sur le chanteur', desc: 'Cliquez sur « Synchro Voix & Paroles » pour une coordination automatique en temps réel, ou tapez au rythme du chant dans « Synchro au Tap ».' },
          { num: 'Étape 03', title: 'Choisir le look et exporter', desc: 'Choisissez un Thème (Cinematic, Art & Motion…), appuyez sur Aléatoire (touche R) puis cliquez sur « Exporter en MP4 ».' },
        ],
        subh: 'À quoi sert chaque bouton de la barre du haut ?',
        items: [
          {
            label: 'Titre du morceau & Artiste',
            zone: 'Barre du haut · Tout à gauche',
            desc: 'Écrivez ici le nom de la chanson et celui du chanteur. Alexura les affiche automatiquement sur la première image d’intro et s’en sert pour nommer votre vidéo finale.',
            example: '<strong>Exemple concret :</strong> Tapez <code>Nuit Électrique</code> et <code>Alexura</code> → votre clip démarre avec un joli carton titre et se télécharge sous le nom <code>Nuit Électrique.mp4</code>.',
          },
          {
            label: 'Aléatoire (bouton du haut & touche R)',
            zone: 'Barre du haut · Création magique',
            desc: 'C’est votre bouton baguette magique : en 1 clic, il invente une mise en scène complète (polices, couleurs, fond animé et effets) accordée au thème choisi.',
            example: '<strong>Astuce simple :</strong> Si l’essai précédent vous plaisait plus, cliquez sur <strong>◀ / ▶</strong> juste sous la vidéo pour revenir en arrière à tout moment.',
            photo: { src: imgs.header, title: 'Voir l’emplacement exact sur la Photo 2', caption: 'Gros plan sur Aléatoire, Facile/Avancé, Google Cloud et Ouvrir/Enregistrer.' },
          },
          {
            label: 'Mobile / Facile / Avancé + ?',
            zone: 'Barre du haut · Confort d’affichage',
            desc: '<strong>Facile</strong> n’affiche que l’essentiel pour créer vite sans se perdre. <strong>Avancé</strong> ouvre tous les réglages pro (polices, couleurs, timeline au millième, techniques). <strong>Mobile</strong> adapte l’écran au téléphone. <strong>?</strong> allume la visite guidée pas à pas.',
            example: '<strong>Conseil :</strong> Démarrez en <strong>Facile</strong> pour obtenir un superbe résultat en 1 minute, puis passez en <strong>Avancé</strong> si vous voulez retoucher un détail précis.',
          },
          {
            label: 'Google / ☁ Sauvegarder / 📚 Projets & Historique',
            zone: 'Barre du haut · Sauvegarde en ligne',
            desc: 'Connectez votre compte Google pour sauvegarder votre chanson, son audio et vos réglages sur votre espace Cloud Firebase, retrouver vos anciens projets ou envoyer vers Vercel.',
            example: '<strong>Exemple concret :</strong> Vous commencez un clip aujourd’hui → cliquez sur <strong>☁ Sauvegarder</strong> → demain, ouvrez <strong>📚 Projets & Historique</strong> pour tout recharger à l’identique.',
          },
          {
            label: 'Ouvrir / Enregistrer (.json) · Exporter pour AE · Réinitialiser',
            zone: 'Barre du haut · Fichiers ordinateur',
            desc: '<strong>Enregistrer</strong> télécharge un petit fichier <code>.json</code> sur votre ordinateur pour garder une copie hors-ligne ; <strong>Ouvrir</strong> le recharge. <strong>Exporter pour AE</strong> sert aux monteurs Adobe After Effects. <strong>Réinitialiser</strong> vide l’écran pour repartir sur un nouveau morceau.',
          },
          {
            label: 'Notice & À propos',
            zone: 'Barre du haut · Guide & Droits',
            desc: '<strong>Notice</strong> ouvre ce manuel illustré quand vous en avez besoin. <strong>À propos</strong> confirme que toutes vos vidéos exportées vous appartiennent à 100 %.',
          },
        ],
      },
      {
        id: 'lyrics',
        num: '02',
        nav: 'Paroles, Symboles & Traduction',
        title: '02. Écrire vos paroles, ajouter des effets simples et traduire',
        lead: 'Écrivez simplement une phrase par ligne dans la grande boîte « Paroles ». En ajoutant un tout petit symbole dans votre texte, vous donnez des ordres précis à la caméra — sans aucun réglage compliqué !',
        gallery: [
          {
            src: imgs.lyrics,
            title: 'Photo 3 — Avant / Après : ce que chaque symbole dessine à l’écran',
            alt: 'Exemple visuel comparant le texte simple avec symboles (/, *, !, |, [interlude]) et le rendu vidéo animé obtenu avec traduction bilingue',
            caption: 'À gauche : votre texte avec /, *, !, | et [interlude]. À droite : les 2 plans coupés, le mot géant percutant, l’éclair de flash, la petite note et la traduction sous-titrée.',
          },
          {
            src: imgs.overview,
            title: 'Photo 4 — Où coller vos paroles et activer la traduction',
            alt: 'Colonne gauche montrant l’éditeur de paroles et le panneau de traduction',
            caption: 'Glissez un fichier .lrc / .srt / .txt directement sur la fenêtre, puis utilisez le panneau Traduction juste dessous si vous voulez une 2e langue.',
          },
        ],
        subh: 'Toutes les touches Paroles expliquées simplement',
        items: [
          {
            label: 'Importer LRC / SRT & Effacer les paroles',
            zone: 'Haut du bloc Paroles',
            desc: 'Charge un fichier déjà horodaté (<code>.lrc</code>, <code>.srt</code>, <code>.vtt</code>) ou un simple fichier texte (<code>.txt</code>). Vous pouvez aussi glisser-déposer le fichier depuis votre bureau directement dans l’écran. <strong>Effacer</strong> vide la boîte (annulable avec <span class="notice-kbd">Ctrl+Z</span>).',
            example: '<strong>Exemple concret :</strong> Glissez <code>chanson.lrc</code> → une ligne comme <code>[00:42.15]Une voix lointaine résonne</code> se place automatiquement à 42,15 secondes.',
          },
          {
            label: 'Les 5 symboles magiques : / · *mot* · ! · |note · [interlude]',
            zone: 'Dans votre texte (bouton Syntaxe)',
            desc: 'Tapez ces petits signes directement dans vos phrases pour mettre en scène votre clip automatiquement :',
            example: '<code>Je me souviens de/la couleur</code> → coupe la phrase en <strong>2 plans différents</strong> au moment du <code>/</code>.<br><code>Reste *fort* ce soir</code> → affiche le mot <strong>fort</strong> en très grand pour un effet choc.<br><code>Réveille-toi !</code> → le point <code>!</code> ajoute un flash lumineux et une secousse caméra.<br><code>lumière|éclat doux</code> → écrit « éclat doux » en petit au-dessus/dessous du mot.<br><code>[interlude 8]</code> → garde 8 secondes sans texte pour un solo de guitare ou de piano.<br><code># refrain 2</code> → ligne de mémo personnelle jamais montrée dans la vidéo.',
            photo: { src: imgs.lyrics, title: 'Voir le résultat en image sur la Photo 3', caption: 'Comparatif visuel direct entre les symboles tapés à gauche et le rendu animé à droite.' },
          },
          {
            label: 'Langue des paroles & 🌐 Couche de traduction',
            zone: 'Juste sous la zone Paroles',
            desc: 'Laissez <strong>Détection auto</strong> (ou <strong>Multilingue Mix</strong> si le chanteur mélange français et anglais). Pour afficher une traduction en plus de l’original, choisissez la langue et cliquez sur <strong>🌐 Traduire</strong> : elle suit exactement le même timing sans modifier votre texte de base.',
            example: '<strong>Exemple concret :</strong> Une chanson en anglais avec sa traduction française discrète en gris doux juste en dessous. Cliquez sur <strong>⚙ Style</strong> pour régler sa taille, sa couleur ou la cacher du prompteur.',
          },
        ],
      },
      {
        id: 'sync',
        num: '03',
        nav: 'Audio, IA & Synchro au Tap',
        title: '03. Synchroniser parfaitement chaque mot sur la voix du chanteur',
        lead: 'Pour que les paroles s’allument exactement quand le chanteur chante, Alexura vous donne 3 outils simples : l’IA qui écrit et cale tout, « Synchro Voix & Paroles » en temps réel, ou le studio « Synchro au Tap » très ludique.',
        gallery: [
          {
            src: imgs.sync,
            title: 'Photo 5 — Comment l’IA et « Synchro Voix & Paroles » repèrent le chant',
            alt: 'Illustration de l’onde sonore vocale avec détection d’attaques à 10 ms et barres d’alignement de chaque mot',
            caption: 'Alexura isole la voix (en vert émeraude) du reste des instruments et coordonne chaque mot en temps réel.',
          },
          {
            src: imgs.tap,
            title: 'Photo 6 — Le studio « Synchro au Tap » avec radar vocal en direct',
            alt: 'Écran du studio Synchro au Tap : onde radar bleu/vert, touche Espace lumineuse, molette Vitesse 0.75x, boutons -25ms/+25ms et Boucle',
            caption: 'Appuyez sur Espace quand le chanteur démarre la phrase. Ralentissez à 0.75× si ça va vite, bouclez une phrase ou décalez de ±25 ms.',
          },
        ],
        subh: 'Les boutons Audio & Synchronisation automatique',
        items: [
          {
            label: 'Importer un morceau',
            zone: 'Colonne gauche · Audio',
            desc: 'Ouvre votre musique (MP3, WAV, M4A, AAC, FLAC, OGG ou MP4) directement dans le navigateur. Alexura calcule tout de suite le tempo (BPM) et repère où le chanteur chante.',
          },
          {
            label: 'Détecter les paroles par IA',
            zone: 'Colonne gauche · Audio',
            desc: 'Vous n’avez pas le texte de la chanson ? Cliquez ici : l’IA écoute le chanteur, sépare sa voix de la musique, écrit toutes les paroles (même en plusieurs langues) et cale chaque mot toute seule.',
            photo: { src: imgs.sync, title: 'Voir l’alignement acoustique sur la Photo 5', caption: 'Chaque mot est calé sur le vrai pic d’énergie de la voix humaine.' },
          },
          {
            label: 'Synchro Voix & Paroles',
            zone: 'Colonne gauche · Audio',
            desc: 'Vous avez déjà collé vos paroles dans la boîte ? Cliquez simplement sur <strong>Synchro Voix & Paroles</strong> : Alexura analyse en temps réel la voix et vos paroles pour placer automatiquement chaque phrase et chaque mot avec une précision millimétrique à chaque instant.',
            example: '<strong>Quand l’utiliser ?</strong> Juste après avoir importé le MP3 et collé le texte. La coordination temps réel calibre chaque syllabe sur la voix.',
          },
          {
            label: 'Contrôle Qualité & Éditeur mot à mot',
            zone: 'Sous les boutons Audio',
            desc: 'Affiche chaque mot en vert (sûr) ou en orange (à vérifier à l’oreille). Cliquez sur un mot pour écouter uniquement ce mot (<strong>▶ Mot</strong>), l’avancer ou le reculer de <strong>25 ms</strong>, le verrouiller avec ✓ ou insérer un mot oublié (<strong>+ Avant / + Après</strong>).',
            example: '<strong>Exemple concret :</strong> Un mot apparaît un peu tôt ? Cliquez dessus → appuyez deux fois sur <strong>+25ms</strong> → réécoutez avec <strong>▶ Phrase</strong> → cochez <strong>Validé</strong> pour le figer.',
          },
        ],
        subh2: 'Toutes les touches du Studio « Synchro au Tap » expliquées simplement',
        items2: [
          {
            label: 'TAP [Espace] & Mode (Phrase / Mot par mot / Coupes [Tab])',
            zone: 'Synchro au Tap Studio',
            desc: 'Lancez l’écoute et appuyez sur la barre <span class="notice-kbd">Espace</span> dès que le chanteur attaque le mot ou la phrase affichée au milieu.<br>• <strong>Phrase / Ligne :</strong> un appui par phrase (super rapide).<br>• <strong>Mot par mot (Précis) :</strong> un appui sur chaque mot pour un karaoké de niveau studio.<br>• <strong>Phrases + Coupes [Tab] :</strong> tapez <span class="notice-kbd">Tab</span> pour forcer un changement de plan visuel.',
            photo: { src: imgs.tap, title: 'Voir le Studio Tap en action sur la Photo 6', caption: 'La barre Espace sert de déclencheur principal avec le radar vocal juste au-dessus.' },
          },
          {
            label: 'Radar Vocal & Calage (Attaque vocale ±90ms / BPM / Libre)',
            zone: 'Synchro au Tap Studio',
            desc: 'Le graphique noir affiche l’onde du chanteur en direct pour vous aider à viser juste. Avec <strong>Attaque vocale (±90ms)</strong> activé, même si votre doigt appuie un peu trop tôt ou trop tard, Alexura réaligne votre tap pile sur le vrai son de la voix ! Et la <strong>Latence Auto-calibrée</strong> corrige automatiquement votre temps de réaction.',
          },
          {
            label: 'Vitesse (1× / 0.85× / 0.75× / 0.5×) & -25ms / +25ms',
            zone: 'Synchro au Tap Studio',
            desc: 'Le refrain ou le couplet rap est trop rapide ? Passez sur <strong>0.75×</strong> ou <strong>0.5×</strong> pour taper tranquillement au ralenti sans déformer la justesse, puis décalez les mots de la phrase de <strong>-25ms</strong> (plus tôt) ou <strong>+25ms</strong> (plus tard).',
          },
          {
            label: '✨ Micro-caler · 🔁 Boucler · ⚡ Finir IA Voix',
            zone: 'Synchro au Tap Studio',
            desc: '• <strong>✨ Micro-caler phrase :</strong> réajuste automatiquement tous les mots de la phrase en cours à 10 ms près sur la voix.<br>• <strong>🔁 Boucler :</strong> rejoue la même phrase en boucle jusqu’à ce que le calage soit irréprochable.<br>• <strong>⚡ Finir IA Voix :</strong> vous avez tapé les 3 premières phrases ? Cliquez ici pour qu’Alexura cale toute la fin du morceau en suivant votre rythme exact.',
          },
          {
            label: 'Fin [E] · Pause [P] · -2s · 1 retour · Passer [S] · ✓ Terminer',
            zone: 'Commandes rapides Tap',
            desc: 'Tapez <span class="notice-kbd">E</span> pour couper la fin d’une note longue, <span class="notice-kbd">P</span> pour faire une pause, <strong>↶ 1 retour</strong> pour refaire le dernier mot raté, <span class="notice-kbd">S</span> pour sauter une phrase déjà bonne, et <strong>✓ Terminer</strong> (<span class="notice-kbd">Échap</span>) pour tout enregistrer.',
          },
        ],
      },
      {
        id: 'stage',
        num: '04',
        nav: 'Scène, Karaoké & Timeline',
        title: '04. Écran vidéo, Prompteur Karaoké et Timeline au millième',
        lead: 'Regardez votre clip comme dans un studio de montage : testez l’accord parfait entre le chant et l’affichage à l’oreille, ou déplacez directement les petits blocs de mots à la souris sur la bande son.',
        figure: {
          src: imgs.stage,
          title: 'Photo 7 — Lecteur 16:9 + Prompteur Karaoké + Blocs de mots sur la Timeline',
          fallbackTitle: 'Scène Vidéo, Prompteur & Timeline Multi-pistes',
          alt: 'Aperçu annoté de la scène vidéo 16:9, du prompteur karaoké progressif, des boutons -10ms/+10ms et des blocs de mots déplaçables sur la timeline',
          caption: 'En haut : votre clip en direct. Au milieu : prompteur karaoké + barre Chant↔Affichage (±10 ms). En bas : chaque mot est un bloc déplaçable à la souris sur la forme d’onde.',
        },
        subh: 'À quoi sert chaque bouton sous la vidéo ?',
        items: [
          {
            label: '▶ Lecture · Boucle · ◀ / ▶ · Mélanger · Aléatoire',
            zone: 'Barre de contrôle centrale',
            desc: '<strong>▶ / ⏸</strong> lance la lecture (<span class="notice-kbd">Espace</span>). <strong>Boucle</strong> répète au choix Tout le morceau, la Ligne active, ou juste le Plan en cours. <strong>◀ / ▶</strong> permet de revoir vos anciens essais de style. <strong>Mélanger</strong> garde vos couleurs/polices et change seulement les animations.',
          },
          {
            label: 'Mot / Progressif / Caractère',
            zone: 'Entête du Prompteur Karaoké',
            desc: 'Choisit comment les mots s’allument quand le chanteur chante :<br>• <strong>Mot :</strong> chaque mot s’allume d’un seul bloc.<br>• <strong>Progressif :</strong> une couleur glisse en douceur de gauche à droite pendant le mot (effet karaoké pro).<br>• <strong>Caractère :</strong> s’allume lettre par lettre / caractère par caractère (idéal pour japonais, chinois, coréen ou notes tenues).',
          },
          {
            label: 'Synchro Chant↔Affichage (-50 / -10 / +10 / +50ms)',
            zone: 'Barre de coordination Karaoké',
            desc: 'Pendant l’écoute, si vous sentez que tout s’affiche juste un rien trop tôt ou trop tard, cliquez sur <strong>-10ms</strong> ou <strong>+10ms</strong> : l’ensemble se recale immédiatement en direct sans rien casser. Vous pouvez aussi cliquer sur <strong>⏱ Caler mot ici</strong> sur le temps fort ou sur <strong>⚡ Auto-Calage Voix</strong>.',
            example: '<strong>Exemple concret :</strong> Sur un casque Bluetooth qui a un léger retard, cliquez deux fois sur <strong>+50ms</strong> et votre œil retrouve immédiatement le rythme exact de vos oreilles.',
            photo: { src: imgs.stage, title: 'Repérer la barre et les blocs sur la Photo 7', caption: 'Les flèches -10ms/+10ms se trouvent juste au-dessus des blocs de mots bleus et verts.' },
          },
          {
            label: '⚙ Réglages · ⛶ Plein écran · Karaoké ON',
            zone: 'Entête du Prompteur Karaoké',
            desc: '<strong>⚙ Réglages</strong> change la taille du texte karaoké, sa position (Haut / Centre / Bas), la transparence du fond et la couleur chantée. <strong>⛶ Plein écran</strong> passe la scène sur tout votre écran. <strong>Karaoké ON</strong> décide si cette barre de karaoké est gravée ou non dans la vidéo MP4 exportée.',
          },
          {
            label: 'Timeline Audio/Voix & Inspecteur HH:MM:SS.mmm',
            zone: 'Tout en bas de la colonne centrale',
            desc: 'Affiche la courbe sonore sous forme de vagues. Cliquez sur <strong>🔍 Mot</strong> pour zoomer sur un mot précis, puis étirez ou déplacez son bloc coloré à la souris. L’inspecteur en dessous permet même d’ajuster le début ou la fin à <strong>±1 ms</strong> ou <strong>±10 ms</strong> près.',
          },
        ],
      },
      {
        id: 'themes',
        num: '05',
        nav: 'Thèmes, Styles & Art & Motion',
        title: '05. Choisir parmi 12 Thèmes, 116+ polices Art & Motion et réglages visuels',
        lead: 'En un clic sur un Thème, tout le clip change d’univers (polices, couleurs, décors animés et mouvements de caméra). Ensuite, vous pouvez ne changer qu’un seul élément ou bloquer vos lignes préférées.',
        gallery: [
          {
            src: imgs.themes,
            title: 'Photo 8 — Aperçu visuel des 6 grands Thèmes studio',
            alt: 'Galerie des 6 thèmes signatures : Cinematic, Pop Art Ben-Day, Bauhaus Cinétique, Cyberpunk, Atelier Luxe et Animation',
            caption: 'Cinematic (cinéma) · Music Video (Pop/Trap/K-Pop) · Art & Motion (Bauhaus/Pop Art/3D/Glitch) · Futuristic · Lifestyle · Animation.',
          },
          {
            src: imgs.artfx,
            title: 'Photo 9 — Exemples en images : Bauhaus, Pop Art, 3D Isométrique & Cadrage',
            alt: 'Planche comparative montrant les styles Bauhaus Kinetic, Pop Art Ben-Day, 3D Isométrique et les modes Libérer le centre / Fond Vert',
            caption: 'Visualisez concrètement la différence entre le style Bauhaus géométrique, Pop Art bande dessinée, 3D filaire et le cadrage autour du chanteur.',
          },
        ],
        subh: 'Les boutons de style expliqués simplement',
        items: [
          {
            label: 'Sélecteur de Thème (17 univers visuels · jusqu’à 30 styles)',
            zone: 'Mode Facile & Barre de Transport',
            desc: 'Choisissez l’atmosphère qui colle à votre chanson :<br>• <strong>GUOFENG (Chinois Classique · 30 éléments uniques) :</strong> lavis Shan-Shui, Cité Interdite, Porcelaine Bleu & Blanc, rubans de Dunhuang, lanternes, bambou, jade & calligraphie Wuxia.<br>• <strong>CINEMATIC · MUSIC VIDEO · FUTURISTIC · LIFESTYLE · ANIMATION :</strong> 20 styles fluides et animations cinéma par univers.<br>• <strong>ART & MOTION (Bauhaus, Pop Art Ben-Day, 3D Isométrique, Compositing) :</strong> géométrie, trames comic, cubes 3D et cadrage Libre au Centre.',
            photo: { src: imgs.themes, title: 'Comparer les thèmes en image (Photo 8)', caption: 'Chaque univers possède ses propres palettes, textures et caméras.' },
          },
          {
            label: 'Modifier uniquement : Style / Palette / Ambiance / Plans',
            zone: 'Colonne droite (Mode Facile)',
            desc: 'Vous aimez vos couleurs actuelles mais voulez tester une autre police ou d’autres transitions ? Cliquez uniquement sur le bouton de ce que vous voulez changer sans perdre le reste !',
            example: '<strong>Exemple concret :</strong> La mise en scène vous plaît mais pas les couleurs ? Cliquez 2 ou 3 fois sur <strong>Palette</strong> jusqu’à trouver le bon accord.',
          },
          {
            label: 'Onglets Avancés : Style · Effets · Techniques',
            zone: 'Colonne droite (Mode Avancé)',
            desc: '• <strong>Style :</strong> choisissez un préréglage exact, réglez chaque police ou importez votre propre police (<code>.ttf / .otf</code>).<br>• <strong>Effets :</strong> dosez l’intensité des mouvements, l’effet Glitch, ou la cadence <em>Koma</em> (fluide, 12 images/s, ou 8 images/s style dessin animé).<br>• <strong>Techniques :</strong> cochez/décochez précisément les entrées, sorties, décors et mouvements de caméra autorisés.',
            photo: { src: imgs.artfx, title: 'Voir les rendus Art & Motion sur la Photo 9', caption: 'Bauhaus, trames Pop Art, cubes 3D isométriques et prisme.' },
          },
          {
            label: 'Cadenas 🔒 & Dé 🎲 sur chaque ligne',
            zone: 'Liste des lignes (Colonne gauche)',
            desc: 'Un refrain est parfait et vous ne voulez surtout plus qu’il change quand vous appuyez sur Aléatoire ? Cliquez sur son <strong>cadenas 🔒</strong> pour le protéger. Ou cliquez sur le <strong>dé 🎲</strong> pour ne changer qu’une seule ligne précise.',
          },
        ],
      },
      {
        id: 'export',
        num: '06',
        nav: 'Export MP4, Calques & Cloud',
        title: '06. Exporter votre vidéo jusqu’en 4K, sur Fond Vert ou en Sous-titres',
        lead: 'Tout est calculé directement sur votre appareil (zéro file d’attente). Vous pouvez exporter une vidéo prête pour YouTube/TikTok, des calques transparents pour votre logiciel de montage, ou vos fichiers de paroles.',
        gallery: [
          {
            src: imgs.exportImg,
            title: 'Photo 10 — Toutes les sorties disponibles : MP4 4K, PNG, LRC, SRT',
            alt: 'Illustration du pipeline d’exportation : MP4 4K 60fps, Fond vert, Calques PNG transparents et cartes LRC SRT VTT',
            caption: 'Formats 16:9 ou 9:16, vidéo jusqu’en 4K 60 images/s, écriture directe sur disque pour longs clips et paquets PNG transparents.',
          },
          {
            src: imgs.artfx,
            title: 'Photo 11 — Exemple visuel « Libérer le centre » & « Fond Vert » (en bas à droite)',
            alt: 'Comparaison côte à côte montrant Libérer le centre autour d’une silhouette de chanteur et l’exportation sur Fond Vert',
            caption: 'Libérer le centre place les mots sur les bords pour ne jamais cacher votre visage ; Fond Vert isole uniquement les lettres animées.',
          },
        ],
        subh: 'Comprendre chaque option d’exportation',
        items: [
          {
            label: 'Format · Résolution · FPS · Plage de lignes',
            zone: 'Paramètres d’export (Droite)',
            desc: '<strong>16:9</strong> pour YouTube et écrans larges · <strong>9:16</strong> pour TikTok, Instagram Reels et Shorts · <strong>1:1 / 4:5</strong> pour les publications carrées/verticales · <strong>21:9</strong> pour le cinéma. Choisissez de 720p à <strong>4K (2160p)</strong> en 24, 30 ou 60 fps, ou exportez seulement un extrait (ex : lignes 12 à 24).',
          },
          {
            label: 'Libérer le centre & Fond (Vert / Noir)',
            zone: 'Paramètres d’export (Incrustation)',
            desc: 'Vous filmez le chanteur au centre de la vidéo ? Cochez <strong>Libérer le centre</strong> pour que les paroles se placent à gauche et à droite sans cacher son visage. Ou activez <strong>Fond vert / noir</strong> pour récupérer uniquement les paroles sur fond uni à poser dans CapCut, Premiere ou Final Cut.',
            photo: { src: imgs.artfx, title: 'Voir l’exemple en image (Photo 11, panneau bas droite)', caption: 'À gauche : texte autour du chanteur. À droite : texte isolé sur fond vert pur.' },
          },
          {
            label: 'Exporter en MP4 / Pour grandes vidéos',
            zone: 'Boutons principaux d’export',
            desc: '<strong>Exporter en MP4</strong> crée votre clip vidéo avec le son (recommandé sur Chrome et Edge). Pour les chansons longues de plus de 2 minutes en 1080p/4K, cliquez plutôt sur <strong>Pour grandes vidéos (enregistrement direct)</strong> afin d’écrire la vidéo en direct sur votre disque dur sans remplir la mémoire.',
          },
          {
            label: 'Séquence PNG · PNG transparent · Calques (back / front)',
            zone: 'Export images ZIP',
            desc: 'Télécharge un dossier ZIP image par image. L’option <strong>PNG transparent</strong> conserve la vraie transparence (sans contour vert), et <strong>Calques PNG</strong> sépare le fond (<code>back/</code>) et les paroles (<code>front/</code>) pour vos logiciels pro.',
          },
          {
            label: 'LRC · SRT · VTT · Enhanced LRC · JSON · TXT',
            zone: 'Paroles synchronisées',
            desc: 'Exporte vos sous-titres horodatés par ligne (LRC, SRT, VTT) ou mot par mot (Enhanced LRC, JSON). Cochez <strong>Inclure traduction</strong> si vous avez activé la couche bilingue.',
          },
        ],
      },
      {
        id: 'shortcuts',
        num: '07',
        nav: 'Raccourcis & Recettes en images',
        title: '07. Raccourcis clavier et 3 recettes faciles étape par étape',
        lead: 'Apprenez ces quelques touches clavier pour aller deux fois plus vite, ou suivez l’un des 3 parcours ci-dessous selon votre besoin.',
        gallery: [
          {
            src: imgs.overview,
            title: 'Étape 1 — Importer audio et paroles',
            alt: 'Vue d’ensemble étape 1',
            caption: 'Glissez votre MP3 et collez le texte (ou lancez Détecter par IA).',
          },
          {
            src: imgs.tap,
            title: 'Étape 2 — Caler au millimètre',
            alt: 'Radar Tap Studio étape 2',
            caption: 'Synchro Voix & Paroles ou Tap Studio [Espace], puis ±10 ms à l’oreille.',
          },
          {
            src: imgs.exportImg,
            title: 'Étape 3 — Styliser et exporter',
            alt: 'Pipeline export 4K étape 3',
            caption: 'Choisissez un Thème, appuyez sur R et exportez votre MP4.',
          },
        ],
        subh: 'Les raccourcis clavier les plus utiles',
        items: [
          { label: 'Espace · ← / → · Maj + ← / →', zone: 'Lecture vidéo', desc: '<span class="notice-kbd">Espace</span> met lecture ou pause. <span class="notice-kbd">←</span> et <span class="notice-kbd">→</span> avancent image par image (ajoutez <span class="notice-kbd">Maj</span> pour sauter d’1 seconde).' },
          { label: 'R · D · L', zone: 'Création rapide', desc: '<span class="notice-kbd">R</span> lance Aléatoire dans le thème actif · <span class="notice-kbd">D</span> change uniquement le plan affiché · <span class="notice-kbd">L</span> verrouille ou déverrouille la ligne courante.' },
          { label: 'Ctrl+Z / Cmd+Z · Ctrl+Y', zone: 'Annuler / Rétablir', desc: 'Revient en arrière ou rétablit vos dernières modifications de texte et de minutage.' },
          { label: 'Espace · E · P · S · Retour · Tab · Échap', zone: 'Dans Synchro au Tap', desc: '<span class="notice-kbd">Espace</span> = Tapper · <span class="notice-kbd">E</span> = Marquer la fin · <span class="notice-kbd">P</span> = Pause · <span class="notice-kbd">S</span> = Passer · <span class="notice-kbd">Retour</span> = Annuler le dernier tap · <span class="notice-kbd">Tab</span> = Couper un plan · <span class="notice-kbd">Échap</span> = Enregistrer et quitter.' },
        ],
        steps: [
          { num: 'Parcours 1', title: 'Clip express en 2 minutes', desc: '1. Importez le MP3 → 2. Collez les paroles → 3. Cliquez « Synchro Voix & Paroles » → 4. Choisissez « Music Video » ou « Art & Motion » → 5. Touche R jusqu’au coup de cœur → 6. Exporter en MP4 1080p.' },
          { num: 'Parcours 2', title: 'Karaoké ultra précis', desc: '1. Importez l’audio → 2. Cliquez « Détecter les paroles par IA » → 3. Vérifiez les rares mots orange → 4. Ajustez Chant↔Affichage (±10 ms) → 5. Exporter MP4 + Enhanced LRC.' },
          { num: 'Parcours 3', title: 'Montage Reel / TikTok / Chanteur', desc: '1. Format 9:16 → 2. Cochez « Libérer le centre » ou « Fond vert » (ou PNG transparent) → 3. Passez à 60 fps → 4. Posez directement sur votre vidéo dans CapCut ou Premiere.' },
        ],
      },
    ],
  };
}

function renderNotice(filterQuery = '') {
  const dlg = $('noticeDlg');
  const nav = $('noticeNav');
  const body = $('noticeBody');
  const titleEl = $('noticeTitle');
  const subEl = $('noticeSubtitle');
  const searchEl = $('noticeSearch');
  const countEl = $('noticeSearchCount');
  const tourBtn = $('btnNoticeTour');
  const closeBtn = $('btnNoticeClose');
  const prevLb = $('btnNoticeLbPrev');
  const nextLb = $('btnNoticeLbNext');
  const closeLb = $('btnNoticeLbClose');
  if (!dlg || !nav || !body) return;

  const data = getNoticeContent();
  if (titleEl) titleEl.textContent = data.title;
  if (subEl) subEl.textContent = data.subtitle;
  if (searchEl) searchEl.placeholder = data.searchPh;
  if (tourBtn) { tourBtn.textContent = data.tourBtn; tourBtn.title = data.tourTitle; }
  if (closeBtn) closeBtn.setAttribute('aria-label', data.closeLabel);
  if (prevLb) prevLb.textContent = data.prevPhoto;
  if (nextLb) nextLb.textContent = data.nextPhoto;
  if (closeLb) closeLb.textContent = data.closePhoto;

  const q = String(filterQuery || '').trim().toLowerCase();
  const matchesText = txt => !q || String(txt || '').toLowerCase().includes(q);
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  noticePhotoList = [];
  const registerPhoto = (photoObj) => {
    if (!photoObj || !photoObj.src) return -1;
    const idx = noticePhotoList.length;
    noticePhotoList.push({
      src: photoObj.src,
      alt: photoObj.alt || photoObj.title || '',
      title: photoObj.title || photoObj.fallbackTitle || '',
      caption: photoObj.caption || '',
    });
    return idx;
  };

  const renderFigureCard = (fig) => {
    const idx = registerPhoto(fig);
    const titleStr = fig.title || fig.fallbackTitle || '';
    return (
      '<figure class="notice-figure">' +
        '<button type="button" class="notice-photo-btn" data-notice-photo="' + idx + '">' +
          '<div class="notice-figure-media">' +
            '<img src="' + esc(fig.src) + '" alt="' + esc(fig.alt || titleStr) + '" referrerpolicy="no-referrer" loading="lazy" onerror="this.parentElement.classList.add(\'is-fallback\')">' +
            '<div class="notice-fig-fallback"><strong>' + esc(titleStr) + '</strong><span>' + esc(fig.caption) + '</span></div>' +
            '<span class="notice-zoom-hint">' + esc(data.zoomHint) + '</span>' +
          '</div>' +
        '</button>' +
        '<figcaption>' +
          (titleStr ? '<strong>' + esc(titleStr) + '</strong>' : '') +
          '<span>' + esc(fig.caption) + '</span>' +
        '</figcaption>' +
      '</figure>'
    );
  };

  const renderItem = it => {
    let photoHtml = '';
    if (it.photo && it.photo.src) {
      const pIdx = registerPhoto(it.photo);
      photoHtml =
        '<button type="button" class="notice-item-photo" data-notice-photo="' + pIdx + '">' +
          '<div class="notice-item-photo-thumb">' +
            '<img src="' + esc(it.photo.src) + '" alt="' + esc(it.photo.title || it.label) + '" referrerpolicy="no-referrer" loading="lazy">' +
          '</div>' +
          '<div class="notice-item-photo-text">' +
            '<span class="notice-item-photo-title">' + esc(it.photo.title) + '</span>' +
            '<span class="notice-item-photo-cap">' + esc(it.photo.caption) + '</span>' +
            '<span class="notice-item-photo-action">↗ ' + esc(data.zoomHint) + '</span>' +
          '</div>' +
        '</button>';
    }
    return (
      '<div class="notice-item">' +
        '<div class="notice-key">' +
          '<span class="notice-btn-label">' + esc(it.label) + '</span>' +
          '<span class="notice-key-zone">' + esc(it.zone) + '</span>' +
        '</div>' +
        '<div class="notice-desc">' +
          '<div>' + it.desc + '</div>' +
          (it.example ? '<div class="notice-ex">' + it.example + '</div>' : '') +
          photoHtml +
        '</div>' +
      '</div>'
    );
  };

  let navHtml = '';
  let bodyHtml = '';
  let totalMatches = 0;

  data.sections.forEach((sec, idx) => {
    const itemMatches = it =>
      matchesText(sec.title) || matchesText(sec.lead) ||
      matchesText(it.label) || matchesText(it.zone) || matchesText(it.desc) || matchesText(it.example) ||
      (it.photo && (matchesText(it.photo.title) || matchesText(it.photo.caption)));
    const items1 = (sec.items || []).filter(itemMatches);
    const items2 = (sec.items2 || []).filter(itemMatches);
    const steps = (sec.steps || []).filter(st => matchesText(sec.title) || matchesText(sec.lead) || matchesText(st.title) || matchesText(st.desc));
    const galleryMatches = (sec.gallery || []).some(g => matchesText(g.title) || matchesText(g.caption));
    const secMatches = items1.length + items2.length + steps.length + (galleryMatches && q ? 1 : 0);
    if (q && secMatches === 0) return;
    totalMatches += secMatches;

    navHtml += '<button type="button" class="notice-nav-btn' + (idx === 0 || (q && totalMatches === secMatches) ? ' is-active' : '') + '" data-notice-target="notice-sec-' + sec.id + '">' +
      '<span class="notice-nav-num">' + esc(sec.num) + '</span>' +
      '<span class="notice-nav-title">' + esc(sec.nav) + '</span>' +
    '</button>';

    bodyHtml += '<section class="notice-sec" id="notice-sec-' + sec.id + '">' +
      '<div class="notice-sec-kicker">' + (isEn() ? 'Chapter ' : 'Chapitre ') + esc(sec.num) + ' · Alexura Motion Studio</div>' +
      '<h3>' + esc(sec.title) + '</h3>' +
      '<p class="notice-lead">' + esc(sec.lead) + '</p>';

    if (sec.gallery && sec.gallery.length && (!q || galleryMatches)) {
      const cls3 = sec.gallery.length >= 3 ? ' is-3' : '';
      bodyHtml += '<div class="notice-gallery' + cls3 + '">' + sec.gallery.map(renderFigureCard).join('') + '</div>';
    } else if (sec.figure && !q) {
      bodyHtml += renderFigureCard(sec.figure);
    }

    if (steps.length) {
      bodyHtml += '<div class="notice-steps">' + steps.map(st =>
        '<div class="notice-step-card">' +
          '<div class="notice-step-num">' + esc(st.num) + '</div>' +
          '<h4>' + esc(st.title) + '</h4>' +
          '<p>' + esc(st.desc) + '</p>' +
        '</div>'
      ).join('') + '</div>';
    }

    if (items1.length) {
      if (sec.subh) bodyHtml += '<h4 class="notice-subh">' + esc(sec.subh) + '</h4>';
      bodyHtml += '<div class="notice-list">' + items1.map(renderItem).join('') + '</div>';
    }

    if (items2.length) {
      if (sec.subh2) bodyHtml += '<h4 class="notice-subh">' + esc(sec.subh2) + '</h4>';
      bodyHtml += '<div class="notice-list">' + items2.map(renderItem).join('') + '</div>';
    }

    bodyHtml += '</section>';
  });

  if (!bodyHtml) {
    bodyHtml = '<div class="notice-empty"><p><strong>' + esc(data.emptyTitle) + '</strong></p><p>' + esc(data.emptyHint) + '</p><button type="button" id="btnNoticeResetSearch" class="ghost small" style="margin-top:10px">' + esc(data.clearSearch) + '</button></div>';
  }

  nav.innerHTML = navHtml;
  body.innerHTML = bodyHtml;

  if (countEl) {
    if (q) {
      countEl.textContent = data.matchesFmt(totalMatches);
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }

  nav.querySelectorAll('.notice-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.noticeTarget);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      nav.querySelectorAll('.notice-nav-btn').forEach(b => b.classList.toggle('is-active', b === btn));
    });
  });

  body.querySelectorAll('[data-notice-photo]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.getAttribute('data-notice-photo'), 10);
      if (!isNaN(idx) && idx >= 0) openNoticeLightbox(idx);
    });
  });

  const resetBtn = $('btnNoticeResetSearch');
  if (resetBtn && searchEl) {
    resetBtn.addEventListener('click', () => {
      searchEl.value = '';
      renderNotice('');
      searchEl.focus();
    });
  }
}

function openNotice(sectionId = null) {
  const dlg = $('noticeDlg');
  if (!dlg) return;
  closeNoticeLightbox();
  if ($('app') && $('app').classList.contains('menu-open')) {
    $('app').classList.remove('menu-open');
    if ($('btnMenu')) $('btnMenu').setAttribute('aria-expanded', 'false');
  }
  const searchEl = $('noticeSearch');
  renderNotice(searchEl ? searchEl.value : '');
  if (dlg.showModal) { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  if (sectionId) {
    const target = document.getElementById('notice-sec-' + sectionId);
    if (target) requestAnimationFrame(() => target.scrollIntoView({ block: 'start' }));
  } else if ($('noticeBody')) {
    $('noticeBody').scrollTop = 0;
  }
}

function closeNotice() {
  closeNoticeLightbox();
  const dlg = $('noticeDlg');
  if (!dlg) return;
  if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
}

function initNotice() {
  const dlg = $('noticeDlg');
  if (!dlg) return;
  document.querySelectorAll('.notice-open').forEach(b => b.addEventListener('click', () => openNotice()));
  if ($('btnNoticeClose')) $('btnNoticeClose').addEventListener('click', closeNotice);
  dlg.addEventListener('click', e => { if (e.target === dlg) closeNotice(); });
  dlg.addEventListener('cancel', e => {
    const lb = $('noticeLightbox');
    if (lb && !lb.hidden) {
      e.preventDefault();
      closeNoticeLightbox();
    }
  });
  dlg.addEventListener('keydown', e => {
    const lb = $('noticeLightbox');
    if (!lb || lb.hidden) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); openNoticeLightbox(noticeLightboxIdx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); openNoticeLightbox(noticeLightboxIdx + 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeNoticeLightbox(); }
  });
  if ($('btnNoticeLbPrev')) $('btnNoticeLbPrev').addEventListener('click', () => openNoticeLightbox(noticeLightboxIdx - 1));
  if ($('btnNoticeLbNext')) $('btnNoticeLbNext').addEventListener('click', () => openNoticeLightbox(noticeLightboxIdx + 1));
  if ($('btnNoticeLbClose')) $('btnNoticeLbClose').addEventListener('click', closeNoticeLightbox);
  const lbEl = $('noticeLightbox');
  if (lbEl) lbEl.addEventListener('click', e => { if (e.target === lbEl || e.target.classList.contains('notice-lb-stage')) closeNoticeLightbox(); });

  if ($('btnNoticeTour')) {
    $('btnNoticeTour').addEventListener('click', () => {
      closeNotice();
      setTimeout(() => tourStart(), 80);
    });
  }
  const searchEl = $('noticeSearch');
  if (searchEl) {
    searchEl.addEventListener('input', () => renderNotice(searchEl.value));
  }
  const body = $('noticeBody');
  const nav = $('noticeNav');
  if (body && nav) {
    body.addEventListener('scroll', () => {
      const secs = body.querySelectorAll('.notice-sec');
      if (!secs.length) return;
      const top = body.scrollTop + 48;
      let activeId = secs[0].id;
      secs.forEach(sec => { if (sec.offsetTop <= top) activeId = sec.id; });
      nav.querySelectorAll('.notice-nav-btn').forEach(b => {
        b.classList.toggle('is-active', b.dataset.noticeTarget === activeId);
      });
    }, { passive: true });
  }
}

const WX_STORAGE_KEY = 'alexura_wx_loc_v1';
const WX = {
  data: null,
  coords: null,
  accuracyM: null,
  isOpen: false,
  hideTimer: null,
  tickTimer: null,
  closeAt: 0,
  pausedForInput: false,
  loading: false,
  reqSeq: 0,
  DURATION_MS: 6000,
};

function wxNum(v) {
  if (v === null || v === undefined || v === '') return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function wxWindToKmH(speedObj) {
  if (!speedObj) return NaN;
  const raw = wxNum(speedObj.value);
  if (!Number.isFinite(raw)) return NaN;
  const unit = String(speedObj.unit || '').toUpperCase();
  if (unit === 'METERS_PER_SECOND') return raw * 3.6;
  if (unit === 'MILES_PER_HOUR') return raw * 1.60934;
  return raw;
}

function wxClassifyAqi(score, code) {
  const n = wxNum(score);
  if (!Number.isFinite(n)) return 'is-good';
  const c = String(code || '').toLowerCase();
  if (c === 'uaqi') {
    // Google Universal AQI: higher is cleaner (80-100 Excellent, 60-79 Good, 40-59 Moderate, <40 Poor)
    if (n >= 60) return 'is-good';
    if (n >= 40) return 'is-mod';
    return 'is-poor';
  }
  // European AQI / US EPA: lower is cleaner
  if (n <= 40) return 'is-good';
  if (n <= 75) return 'is-mod';
  return 'is-poor';
}

function wxSaveLoc(lat, lng, label) {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    localStorage.setItem(WX_STORAGE_KEY, JSON.stringify({ lat, lng, label: label || '', ts: Date.now() }));
  } catch {}
}

function wxLoadSavedLoc() {
  try {
    const raw = localStorage.getItem(WX_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    const lat = wxNum(p?.lat);
    const lng = wxNum(p?.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng, label: String(p.label || '') };
  } catch {}
  return null;
}

function wxClassifyUvRisk(uv) {
  const n = wxNum(uv);
  const en = isEn();
  if (!Number.isFinite(n)) {
    return { cls: 'is-low', label: en ? '—' : '—', explain: '' };
  }
  const rounded = Math.round(n);
  if (rounded <= 2) {
    return {
      cls: 'is-low',
      label: en ? 'No risk' : 'Pas de risque',
      explain: en
        ? `UV ${rounded} (Low): Minimal solar intensity today — no special protection needed.`
        : `UV ${rounded} (Pas de risque) : intensité du soleil faible aujourd’hui, aucune protection particulière requise.`,
    };
  }
  if (rounded <= 5) {
    return {
      cls: 'is-med',
      label: en ? 'Medium risk' : 'Moyen risque',
      explain: en
        ? `UV ${rounded} (Moderate): Moderate sun intensity — sunglasses and SPF 30+ sunscreen advised.`
        : `UV ${rounded} (Moyen risque) : intensité du soleil modérée, lunettes de soleil et protection solaire conseillées.`,
    };
  }
  return {
    cls: 'is-high',
    label: en ? 'Very risky' : 'Très risqué',
    explain: en
      ? `UV ${rounded} (Very risky): Strong sun intensity — wear SPF 50+, hat and seek shade around midday.`
      : `UV ${rounded} (Très risqué) : forte intensité du soleil aujourd’hui — crème FPS 50+, chapeau et ombre recommandés.`,
  };
}

function wxConditionLabel(cond, isDaytime = true) {
  const type = String(cond?.type || '').toUpperCase();
  const raw = String(cond?.description?.text || '').trim();
  const en = isEn();
  const frMap = {
    CLEAR: isDaytime ? 'Ensoleillé' : 'Ciel dégagé',
    MOSTLY_CLEAR: isDaytime ? 'Majoritairement ensoleillé' : 'Ciel peu nuageux',
    PARTLY_CLOUDY: 'Partiellement nuageux',
    MOSTLY_CLOUDY: 'Très nuageux',
    CLOUDY: 'Nuageux',
    OVERCAST: 'Couvert',
    WINDY: 'Venteux',
    WIND_AND_RAIN: 'Vent et pluie',
    LIGHT_RAIN_SHOWERS: 'Averses légères',
    CHANCE_OF_SHOWERS: 'Risque d’averses',
    SCATTERED_SHOWERS: 'Averses éparses',
    RAIN_SHOWERS: 'Averses de pluie',
    HEAVY_RAIN_SHOWERS: 'Fortes averses',
    LIGHT_TO_MODERATE_RAIN: 'Pluie légère à modérée',
    MODERATE_TO_HEAVY_RAIN: 'Pluie modérée à forte',
    RAIN: 'Pluie',
    LIGHT_RAIN: 'Pluie légère',
    HEAVY_RAIN: 'Forte pluie',
    RAIN_PERIODICALLY_HEAVY: 'Pluie parfois forte',
    LIGHT_SNOW_SHOWERS: 'Averses de neige légères',
    CHANCE_OF_SNOW_SHOWERS: 'Risque de neige',
    SCATTERED_SNOW_SHOWERS: 'Averses de neige éparses',
    SNOW_SHOWERS: 'Averses de neige',
    HEAVY_SNOW_SHOWERS: 'Fortes averses de neige',
    LIGHT_TO_MODERATE_SNOW: 'Neige légère à modérée',
    MODERATE_TO_HEAVY_SNOW: 'Neige modérée à forte',
    SNOW: 'Neige',
    LIGHT_SNOW: 'Neige légère',
    HEAVY_SNOW: 'Forte neige',
    SNOWSTORM: 'Tempête de neige',
    SNOW_PERIODICALLY_HEAVY: 'Neige parfois forte',
    HEAVY_SNOW_STORM: 'Forte tempête de neige',
    BLOWING_SNOW: 'Poudrerie / Neige soufflée',
    RAIN_AND_SNOW: 'Pluie et neige mêlées',
    HAIL: 'Grêle',
    HAIL_SHOWERS: 'Averses de grêle',
    THUNDERSTORM: 'Orage',
    THUNDERSHOWER: 'Averse orageuse',
    LIGHT_THUNDERSTORM_RAIN: 'Orage avec pluie légère',
    SCATTERED_THUNDERSTORMS: 'Orages épars',
    HEAVY_THUNDERSTORM: 'Orage violent',
    FOG: 'Brouillard',
    MIST: 'Brume',
    HAZE: 'Brume sèche',
  };
  const enMap = {
    CLEAR: isDaytime ? 'Sunny' : 'Clear night',
    MOSTLY_CLEAR: isDaytime ? 'Mostly sunny' : 'Mostly clear',
    PARTLY_CLOUDY: 'Partly cloudy',
    MOSTLY_CLOUDY: 'Mostly cloudy',
    CLOUDY: 'Cloudy',
    OVERCAST: 'Overcast',
    RAIN: 'Rain',
    LIGHT_RAIN: 'Light rain',
    HEAVY_RAIN: 'Heavy rain',
    RAIN_SHOWERS: 'Rain showers',
    SNOW: 'Snow',
    LIGHT_SNOW: 'Light snow',
    HEAVY_SNOW: 'Heavy snow',
    THUNDERSTORM: 'Thunderstorm',
    FOG: 'Fog',
  };
  if (en) return enMap[type] || raw || 'Weather';
  return frMap[type] || raw || 'Temps variable';
}

function wxConditionSvg(cond, isDaytime = true) {
  const type = String(cond?.type || '').toUpperCase();
  if (/THUNDER/.test(type)) {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 15.5h11.2a3.8 3.8 0 0 0 .5-7.5A5.5 5.5 0 0 0 7.2 6.8 4 4 0 0 0 6 15.5z" fill="#94a3b8" fill-opacity=".35" stroke="#cbd5e1" stroke-width="1.6" stroke-linejoin="round"/><path d="M13 11.5l-2.8 4.6h2.6l-1.4 4.4 4.4-5.4h-2.7l1.3-3.6z" fill="#fbbf24"/></svg>';
  }
  if (/SNOW|SLEET|HAIL|BLOWING/.test(type)) {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 14.5h11.2a3.8 3.8 0 0 0 .5-7.5A5.5 5.5 0 0 0 7.2 5.8 4 4 0 0 0 6 14.5z" fill="#cbd5e1" fill-opacity=".28" stroke="#e2e8f0" stroke-width="1.6"/><circle cx="8.5" cy="18.2" r="1.2" fill="#e0f2fe"/><circle cx="12.5" cy="19.8" r="1.2" fill="#e0f2fe"/><circle cx="16.2" cy="18.2" r="1.2" fill="#e0f2fe"/></svg>';
  }
  if (/RAIN|SHOWER|DRIZZLE/.test(type)) {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6 14.5h11.2a3.8 3.8 0 0 0 .5-7.5A5.5 5.5 0 0 0 7.2 5.8 4 4 0 0 0 6 14.5z" fill="#60a5fa" fill-opacity=".24" stroke="#bae6fd" stroke-width="1.6"/><path d="M8.5 17.5l-1 3M12.5 17.5l-1 3M16.5 17.5l-1 3" stroke="#38bdf8" stroke-width="1.7" stroke-linecap="round"/></svg>';
  }
  if (/PARTLY_CLOUDY|MOSTLY_CLEAR/.test(type)) {
    return '<svg viewBox="0 0 24 24" fill="none"><circle cx="9.2" cy="8.8" r="3.4" fill="#fbbf24"/><path d="M8.2 18h9.2a3.3 3.3 0 0 0 .4-6.5A4.7 4.7 0 0 0 9 10.6a3.4 3.4 0 0 0-.8 7.4z" fill="#e2e8f0" fill-opacity=".28" stroke="#f8fafc" stroke-width="1.55"/></svg>';
  }
  if (/CLOUDY|OVERCAST|FOG|MIST|HAZE/.test(type)) {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M6.2 16.5h11.4a3.9 3.9 0 0 0 .5-7.7A5.6 5.6 0 0 0 7.3 7.4a4.1 4.1 0 0 0-1.1 9.1z" fill="#94a3b8" fill-opacity=".30" stroke="#cbd5e1" stroke-width="1.6"/></svg>';
  }
  if (!isDaytime) {
    return '<svg viewBox="0 0 24 24" fill="none"><path d="M16.5 14.5A6.5 6.5 0 0 1 9.5 5.2a6.6 6.6 0 1 0 9.3 9.3c-.7.1-1.5 0-2.3 0z" fill="#fde68a" fill-opacity=".85" stroke="#fde68a" stroke-width="1.3"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4.4" fill="#fbbf24"/><path d="M12 2.8v2.1M12 19.1v2.1M4.8 4.8l1.5 1.5M17.7 17.7l1.5 1.5M2.8 12h2.1M19.1 12h2.1M4.8 19.2l1.5-1.5M17.7 6.3l1.5-1.5" stroke="#fbbf24" stroke-width="1.7" stroke-linecap="round"/></svg>';
}

function wxWindDirLabel(cardinal) {
  const c = String(cardinal || '').toUpperCase();
  const en = isEn();
  const map = {
    NORTH: 'N',
    NORTH_NORTHEAST: 'NNE',
    NORTHEAST: 'NE',
    EAST_NORTHEAST: 'ENE',
    EAST: 'E',
    EAST_SOUTHEAST: 'ESE',
    SOUTHEAST: 'SE',
    SOUTH_SOUTHEAST: 'SSE',
    SOUTH: 'S',
    SOUTH_SOUTHWEST: en ? 'SSW' : 'SSO',
    SOUTHWEST: en ? 'SW' : 'SO',
    WEST_SOUTHWEST: en ? 'WSW' : 'OSO',
    WEST: en ? 'W' : 'O',
    WEST_NORTHWEST: en ? 'WNW' : 'ONO',
    NORTHWEST: en ? 'NW' : 'NO',
    NORTH_NORTHWEST: 'NNW',
  };
  return map[c] || '';
}

function wxFormatDateParts(dObj, idx) {
  const en = isEn();
  if (!dObj || !dObj.year) return { name: en ? `Day ${idx + 1}` : `Jour ${idx + 1}`, date: '' };
  const dt = new Date(dObj.year, (dObj.month || 1) - 1, dObj.day || 1);
  if (idx === 0) return { name: en ? 'Today' : 'Auj.', date: dt.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: '2-digit' }) };
  if (idx === 1) return { name: en ? 'Tomorrow' : 'Demain', date: dt.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: '2-digit' }) };
  const name = dt.toLocaleDateString(en ? 'en-US' : 'fr-FR', { weekday: 'short' }).replace(/\.$/, '');
  const cap = name.charAt(0).toUpperCase() + name.slice(1);
  const date = dt.toLocaleDateString(en ? 'en-US' : 'fr-FR', { day: '2-digit', month: '2-digit' });
  return { name: cap, date };
}

function wxClearTimers() {
  if (WX.hideTimer) { clearTimeout(WX.hideTimer); WX.hideTimer = null; }
  if (WX.tickTimer) { clearInterval(WX.tickTimer); WX.tickTimer = null; }
}

function wxRestartAutoCloseTimer() {
  wxClearTimers();
  if (!WX.isOpen || WX.pausedForInput) return;
  const fill = $('wxAutoTimerFill');
  if (fill) {
    fill.classList.remove('is-running');
    void fill.offsetWidth;
    fill.classList.add('is-running');
  }
  WX.closeAt = Date.now() + WX.DURATION_MS;
  const updateCount = () => {
    const rem = Math.max(0, Math.ceil((WX.closeAt - Date.now()) / 1000));
    const chip = $('wxTimerChip');
    const badge = $('wxCountdownBadge');
    const en = isEn();
    if (chip) {
      chip.textContent = `${rem}s`;
      chip.hidden = !WX.isOpen;
    }
    if (badge) {
      badge.textContent = en ? `Auto-hide ${rem}s` : `Fermeture auto ${rem}s`;
    }
  };
  updateCount();
  WX.tickTimer = setInterval(updateCount, 250);
  WX.hideTimer = setTimeout(() => {
    closeWeatherDrawer();
  }, WX.DURATION_MS);
}

function openWeatherDrawer() {
  const drawer = $('weatherDetailDrawer');
  const bar = $('weatherTopBar');
  if (!drawer || !bar) return;
  WX.isOpen = true;
  drawer.hidden = false;
  bar.setAttribute('aria-expanded', 'true');
  setT('wxExpandHint', isEn() ? 'Hide' : 'Masquer');
  wxRestartAutoCloseTimer();
}

function closeWeatherDrawer() {
  wxClearTimers();
  const drawer = $('weatherDetailDrawer');
  const bar = $('weatherTopBar');
  const fill = $('wxAutoTimerFill');
  const chip = $('wxTimerChip');
  WX.isOpen = false;
  WX.pausedForInput = false;
  if (drawer) drawer.hidden = true;
  if (bar) bar.setAttribute('aria-expanded', 'false');
  if (fill) fill.classList.remove('is-running');
  if (chip) chip.hidden = true;
  setT('wxExpandHint', isEn() ? '7 days' : '7 jours');
}

function toggleWeatherDrawer() {
  if (WX.isOpen) closeWeatherDrawer();
  else openWeatherDrawer();
}

function renderWeatherData(payload, opts = {}) {
  WX.data = payload;
  const en = isEn();
  const cur = payload?.current || null;
  const loc = payload?.location || {};
  const aqiData = payload?.airQuality || null;
  const pollenData = payload?.pollen || null;
  const days = Array.isArray(payload?.forecastDays) ? payload.forecastDays : [];

  const placeLabel = loc.shortName || loc.locality || (en ? 'Current location' : 'Position actuelle');
  setT('wxLocLabel', placeLabel);
  setT('wxFullPlace', placeLabel);
  setT('wxFullAddr', loc.formattedAddress || `${payload?.coordinates?.lat ?? ''}, ${payload?.coordinates?.lng ?? ''}`);
  if (WX.accuracyM != null) {
    setT('wxGpsAccuracy', en ? `GPS ±${Math.round(WX.accuracyM)}m` : `GPS temps réel ±${Math.round(WX.accuracyM)}m`);
  } else {
    setT('wxGpsAccuracy', en ? 'Live weather coordinates' : 'Météo géolocalisée en direct');
  }

  if (payload?.coordinates?.lat != null && payload?.coordinates?.lng != null) {
    wxSaveLoc(payload.coordinates.lat, payload.coordinates.lng, placeLabel);
  }

  const notice = $('wxPermissionNotice');
  if (notice && !opts.keepNotice) notice.hidden = true;

  // Current weather (safe null checks so null never becomes 0)
  const isDay = cur?.isDaytime !== false;
  const tempNum = wxNum(cur?.temperature?.degrees);
  const feelsNum = wxNum(cur?.feelsLikeTemperature?.degrees);
  const condLabel = cur?.weatherCondition ? wxConditionLabel(cur.weatherCondition, isDay) : (en ? 'Unavailable' : 'Indisponible');
  const condSvg = wxConditionSvg(cur?.weatherCondition, isDay);
  const windKm = wxWindToKmH(cur?.wind?.speed);
  const gustKm = wxWindToKmH(cur?.wind?.gust);
  const windDir = wxWindDirLabel(cur?.wind?.direction?.cardinal);
  const humPct = wxNum(cur?.relativeHumidity);
  const rainPct = wxNum(cur?.precipitation?.probability?.percent);
  const cloudPct = wxNum(cur?.cloudCover);
  const dewNum = wxNum(cur?.dewPoint?.degrees);
  const uvNum = wxNum(cur?.uvIndex);
  const uvInfo = wxClassifyUvRisk(uvNum);

  const icoEl = $('wxCondIcon');
  const heroIcoEl = $('wxHeroIcon');
  if (icoEl) icoEl.innerHTML = condSvg;
  if (heroIcoEl) heroIcoEl.innerHTML = condSvg;

  const tempStr = Number.isFinite(tempNum) ? `${Math.round(tempNum)}°C` : '--°C';
  const windStr = Number.isFinite(windKm) ? `${Math.round(windKm)} km/h` : '-- km/h';
  const humStr = Number.isFinite(humPct) ? `${Math.round(humPct)}%` : '--%';
  const uvBarStr = Number.isFinite(uvNum) ? `${Math.round(uvNum)} · ${uvInfo.label}` : '--';

  setT('wxWindLblTop', en ? 'Wind' : 'Vent');
  setT('wxHumLblTop', en ? 'Humidity' : 'Humidité');
  setT('wxUvLblTop', 'UV');
  setT('wxAqiLblTop', 'Air');
  setT('wxPollenLblTop', 'Pollen');

  setT('wxTempNow', tempStr);
  setT('wxCondText', condLabel);
  setT('wxWindShort', windStr);
  setT('wxHumShort', humStr);
  setT('wxUvShort', uvBarStr);
  const uvShortEl = $('wxUvShort');
  if (uvShortEl) uvShortEl.className = `wx-ch-val wx-uv-tag mono ${uvInfo.cls}`;

  setT('wxHeroTemp', tempStr);
  setT('wxHeroCond', condLabel);
  const feelsStr = Number.isFinite(feelsNum) ? `${Math.round(feelsNum)}°C` : '--°C';
  const cloudStr = Number.isFinite(cloudPct) ? `${Math.round(cloudPct)}%` : '--%';
  setT('wxHeroFeels', en ? `Feels like ${feelsStr} · Cloud ${cloudStr}` : `Ressentie ${feelsStr} · Nuages ${cloudStr}`);

  setT('wxUvVal', Number.isFinite(uvNum) ? `UV ${Math.round(uvNum)}` : 'UV --');
  const uvBadge = $('wxUvRiskBadge');
  if (uvBadge) {
    uvBadge.textContent = uvInfo.label;
    uvBadge.className = `wx-risk-label ${uvInfo.cls}`;
  }
  setT('wxUvExplain', uvInfo.explain || (en ? 'Solar intensity unavailable.' : 'Intensité solaire indisponible.'));

  setT('wxWindVal', windStr);
  const gustStr = Number.isFinite(gustKm) ? `${Math.round(gustKm)} km/h` : '-- km/h';
  setT('wxWindSub', (en ? `Gusts ${gustStr}` : `Rafales ${gustStr}`) + (windDir ? ` · ${windDir}` : ''));

  setT('wxHumVal', humStr);
  const rainStr = Number.isFinite(rainPct) ? `${Math.round(rainPct)}%` : '--%';
  const dewStr = Number.isFinite(dewNum) ? `${Math.round(dewNum)}°C` : '--°C';
  setT('wxHumSub', en ? `Rain ${rainStr} · Dew ${dewStr}` : `Pluie ${rainStr} · Rosée ${dewStr}`);

  // Air quality
  const indexes = Array.isArray(aqiData?.indexes) ? aqiData.indexes : [];
  const mainAqi = indexes.find(x => x.code === 'uaqi') || indexes.find(x => Number.isFinite(wxNum(x.aqi))) || indexes[0] || null;
  const aqiShortEl = $('wxAqiShort');
  if (mainAqi) {
    const rawDisplay = mainAqi.aqiDisplay != null && mainAqi.aqiDisplay !== '' ? String(mainAqi.aqiDisplay) : null;
    const rawNum = wxNum(mainAqi.aqi);
    const score = rawDisplay || (Number.isFinite(rawNum) ? String(Math.round(rawNum)) : '--');
    const cat = mainAqi.category || '—';
    const dom = mainAqi.dominantPollutant ? String(mainAqi.dominantPollutant).toUpperCase() : '';
    const advice = aqiData?.healthRecommendations?.generalPopulation || '';
    const aqiCls = wxClassifyAqi(Number.isFinite(rawNum) ? rawNum : score, mainAqi.code);
    const shortAqiTxt = aqiCls === 'is-good' ? (en ? 'Good' : 'Bon') : aqiCls === 'is-mod' ? (en ? 'Mod.' : 'Modéré') : (en ? 'Poor' : 'Médiocre');
    setT('wxAqiShort', `${score} · ${shortAqiTxt}`);
    if (aqiShortEl) aqiShortEl.className = `wx-ch-val wx-aqi-tag mono ${aqiCls}`;
    setT('wxAqiVal', `${score} AQI`);
    setT('wxAqiCat', cat);
    setT('wxAqiExplain', (dom ? `${en ? 'Dominant' : 'Polluant dominant'} : ${dom}. ` : '') + (advice || ''));
  } else {
    setT('wxAqiShort', en ? 'N/A' : 'N/D');
    if (aqiShortEl) aqiShortEl.className = 'wx-ch-val wx-aqi-tag mono';
    setT('wxAqiVal', '--');
    setT('wxAqiCat', en ? 'Unavailable' : 'Indisponible');
    setT('wxAqiExplain', en ? 'Air quality telemetry unavailable for this zone.' : 'Qualité de l’air non couverte sur cette zone.');
  }

  // Pollen & Allergy
  const pollenDays = Array.isArray(pollenData?.dailyInfo) ? pollenData.dailyInfo : [];
  const pollenByDate = new Map();
  pollenDays.forEach(pd => {
    const d = pd?.date;
    if (!d) return;
    const key = `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    const types = Array.isArray(pd.pollenTypeInfo) ? pd.pollenTypeInfo : [];
    let maxVal = -1;
    let maxCat = '';
    const breakdown = [];
    types.forEach(pt => {
      const val = wxNum(pt?.indexInfo?.value);
      const cat = pt?.indexInfo?.category;
      if (Number.isFinite(val)) {
        if (val > maxVal) {
          maxVal = val;
          maxCat = cat || '';
        }
        breakdown.push(`${pt.displayName || pt.code}: ${val}/5`);
      }
    });
    pollenByDate.set(key, { maxVal, maxCat, breakdown, pd });
  });

  const todayPollen = pollenDays[0] || null;
  if (todayPollen) {
    const todayKey = todayPollen.date
      ? `${todayPollen.date.year}-${String(todayPollen.date.month).padStart(2, '0')}-${String(todayPollen.date.day).padStart(2, '0')}`
      : '';
    const pEntry = pollenByDate.get(todayKey);
    const maxV = pEntry && pEntry.maxVal >= 0 ? pEntry.maxVal : 0;
    const cat = (pEntry && pEntry.maxCat) || (maxV <= 1 ? (en ? 'Low' : 'Faible') : maxV <= 3 ? (en ? 'Moderate' : 'Modéré') : (en ? 'High' : 'Élevé'));
    const rec = todayPollen.pollenTypeInfo?.find(pt => pt?.healthRecommendations?.length)?.healthRecommendations?.[0] || '';
    const activePlants = (Array.isArray(todayPollen.plantInfo) ? todayPollen.plantInfo : [])
      .filter(pl => pl?.inSeason && pl?.indexInfo)
      .slice(0, 3)
      .map(pl => pl.displayName || pl.code);
    setT('wxPollenShort', `${maxV}/5`);
    setT('wxPollenVal', `${maxV} / 5`);
    setT('wxPollenCat', cat);
    const parts = [];
    if (pEntry?.breakdown?.length) parts.push(pEntry.breakdown.join(' · '));
    if (activePlants.length) parts.push(`${en ? 'Plants' : 'Plantes'} : ${activePlants.join(', ')}`);
    if (rec) parts.push(rec);
    setT('wxPollenExplain', parts.join(' — ') || (en ? 'Low allergen risk.' : 'Risque allergène faible.'));
  } else {
    setT('wxPollenShort', en ? 'N/A' : 'N/D');
    setT('wxPollenVal', '-- / 5');
    setT('wxPollenCat', en ? 'Out of coverage' : 'Hors couverture');
    setT('wxPollenExplain', en ? 'Pollen telemetry unavailable for these coordinates.' : 'Données pollen non disponibles pour cette zone.');
  }

  // 7-day (1-week) forecast
  const weekGrid = $('wxWeekGrid');
  if (weekGrid) {
    if (!days.length) {
      weekGrid.innerHTML = `<div class="muted" style="font-size:11.5px">${en ? '7-day forecast unavailable.' : 'Prévisions sur 7 jours indisponibles.'}</div>`;
    } else {
      weekGrid.innerHTML = days.slice(0, 7).map((fd, idx) => {
        const dtParts = wxFormatDateParts(fd.displayDate, idx);
        const dayF = fd.daytimeForecast || {};
        const dCond = wxConditionLabel(dayF.weatherCondition, true);
        const dSvg = wxConditionSvg(dayF.weatherCondition, true);
        const tMaxNum = wxNum(fd.maxTemperature?.degrees);
        const tMinNum = wxNum(fd.minTemperature?.degrees);
        const tMax = Number.isFinite(tMaxNum) ? `${Math.round(tMaxNum)}°` : '--°';
        const tMin = Number.isFinite(tMinNum) ? `${Math.round(tMinNum)}°` : '--°';
        const dWindKm = wxWindToKmH(dayF.wind?.speed);
        const dWind = Number.isFinite(dWindKm) ? `${Math.round(dWindKm)} km/h` : '-- km/h';
        const dHumNum = wxNum(dayF.relativeHumidity);
        const dHum = Number.isFinite(dHumNum) ? `${Math.round(dHumNum)}%` : '--%';
        const dRainNum = wxNum(dayF.precipitation?.probability?.percent);
        const dRain = Number.isFinite(dRainNum) ? `${Math.round(dRainNum)}%` : '0%';
        const dUvNum = wxNum(dayF.uvIndex);
        const dUv = wxClassifyUvRisk(dUvNum);
        const uvDisp = Number.isFinite(dUvNum) ? `UV ${Math.round(dUvNum)} · ${dUv.label}` : 'UV --';
        const dKey = fd.displayDate
          ? `${fd.displayDate.year}-${String(fd.displayDate.month).padStart(2, '0')}-${String(fd.displayDate.day).padStart(2, '0')}`
          : '';
        const pInfo = dKey ? pollenByDate.get(dKey) : null;
        const pTxt = pInfo && pInfo.maxVal >= 0 ? `Pollen ${pInfo.maxVal}/5` : '';
        return (
          `<article class="wx-day-card${idx === 0 ? ' is-today' : ''}">` +
            `<div class="wx-day-top">` +
              `<span class="wx-day-name">${escapeHtml(dtParts.name)}</span>` +
              `<span class="wx-day-date mono">${escapeHtml(dtParts.date)}</span>` +
            `</div>` +
            `<div class="wx-day-mid">` +
              `<span class="wx-day-ico" aria-hidden="true">${dSvg}</span>` +
              `<div class="wx-day-temps mono">${tMax} <span>/ ${tMin}</span></div>` +
            `</div>` +
            `<div class="wx-day-cond" title="${escapeHtml(dCond)}">${escapeHtml(dCond)}</div>` +
            `<div class="wx-day-meta mono">` +
              `<span>${en ? 'Wind' : 'Vent'} <b>${escapeHtml(dWind)}</b> · ${en ? 'Rain' : 'Pluie'} ${escapeHtml(dRain)}</span>` +
              `<span>${en ? 'Hum.' : 'Humidité'} <b>${escapeHtml(dHum)}</b></span>` +
              `<span class="${dUv.cls}">${escapeHtml(uvDisp)}</span>` +
              (pTxt ? `<span>${escapeHtml(pTxt)}</span>` : '') +
            `</div>` +
          `</article>`
        );
      }).join('');
    }
  }
}

async function fetchWeatherByCoords(lat, lng, accuracyM = null, opts = {}) {
  const seq = ++WX.reqSeq;
  WX.loading = true;
  WX.coords = { lat, lng };
  WX.accuracyM = accuracyM;
  const lang = isEn() ? 'en' : 'fr';
  try {
    const resp = await fetch(`/api/weather?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&lang=${encodeURIComponent(lang)}`);
    let data = null;
    try { data = await resp.json(); } catch {}
    if (seq !== WX.reqSeq) return;
    if (resp.status === 429 || data?.quotaExceeded) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
    if (!data?.success) {
      const notice = $('wxPermissionNotice');
      if (notice) {
        notice.hidden = false;
        notice.textContent = isEn()
          ? 'Real-time weather service temporarily unavailable. Verify network or retry GPS.'
          : 'Service météo temps réel temporairement indisponible. Vérifiez la connexion ou réessayez ⌖ GPS.';
      }
      if (!WX.data) {
        setT('wxLocLabel', `${lat.toFixed(2)}, ${lng.toFixed(2)}`);
        setT('wxCondText', isEn() ? 'Weather unavailable' : 'Météo indisponible');
      }
      return;
    }
    renderWeatherData(data, opts);
  } catch {
    if (seq === WX.reqSeq && !WX.data) {
      setT('wxCondText', isEn() ? 'Network error' : 'Erreur réseau');
    }
  } finally {
    if (seq === WX.reqSeq) WX.loading = false;
  }
}

async function fetchWeatherAutoFallback(keepNotice = false) {
  try {
    const resp = await fetch('/api/weather/locate');
    let loc = null;
    try { loc = await resp.json(); } catch {}
    if (loc && Number.isFinite(Number(loc.lat)) && Number.isFinite(Number(loc.lng))) {
      await fetchWeatherByCoords(Number(loc.lat), Number(loc.lng), null, { keepNotice });
      return;
    }
  } catch {}
  await fetchWeatherByCoords(48.8566, 2.3522, null, { keepNotice });
}

async function searchWeatherLocation(query) {
  const q = String(query || '').trim();
  if (!q) return;
  const lang = isEn() ? 'en' : 'fr';
  try {
    const resp = await fetch(`/api/weather/search?q=${encodeURIComponent(q)}&lang=${encodeURIComponent(lang)}`);
    let data = null;
    try { data = await resp.json(); } catch {}
    if (resp.status === 429 || data?.quotaExceeded) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
      return;
    }
    if (!data?.success) {
      const notice = $('wxPermissionNotice');
      if (notice) {
        notice.hidden = false;
        notice.textContent = isEn() ? 'Location not found. Try a city or postal code.' : 'Lieu introuvable. Essayez une ville ou un code postal.';
      }
      return;
    }
    await fetchWeatherByCoords(data.lat, data.lng, null);
    if (WX.isOpen) wxRestartAutoCloseTimer();
  } catch {}
}

function refreshWeatherGps(userTriggered = false) {
  const en = isEn();
  const saved = !userTriggered ? wxLoadSavedLoc() : null;

  // On initial boot, immediately hydrate from saved location so metrics appear without delay
  if (!userTriggered && saved) {
    setT('wxLocLabel', saved.label || (en ? 'Loading weather…' : 'Chargement météo…'));
    fetchWeatherByCoords(saved.lat, saved.lng, null);
  }

  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
    if (userTriggered) {
      const notice = $('wxPermissionNotice');
      if (notice) {
        notice.hidden = false;
        notice.textContent = en
          ? 'Browser GPS unavailable. Showing approximate location — search a city above if needed.'
          : 'GPS navigateur indisponible. Position approximative affichée — saisissez votre ville ci-dessus si besoin.';
      }
    }
    if (!saved) fetchWeatherAutoFallback(userTriggered);
    return;
  }

  if (userTriggered || !saved) {
    setT('wxLocLabel', en ? 'Locating GPS…' : 'Localisation GPS…');
  }

  navigator.geolocation.getCurrentPosition(
    pos => {
      const c = pos?.coords;
      if (c && Number.isFinite(c.latitude) && Number.isFinite(c.longitude)) {
        fetchWeatherByCoords(c.latitude, c.longitude, Number.isFinite(c.accuracy) ? c.accuracy : null);
        if (userTriggered && WX.isOpen) wxRestartAutoCloseTimer();
      }
    },
    err => {
      const denied = err && err.code === 1;
      if (userTriggered) {
        const notice = $('wxPermissionNotice');
        if (notice) {
          notice.hidden = false;
          notice.textContent = denied
            ? (en
                ? 'GPS permission blocked in browser/frame. Search your city above to switch location.'
                : 'Géolocalisation bloquée par le navigateur. Recherchez votre ville ci-dessus pour changer de lieu.')
            : (en
                ? 'Unable to acquire GPS fix right now. Showing fallback location — search a city above.'
                : 'Signal GPS indisponible pour le moment. Météo affichée — recherchez votre ville ci-dessus.');
        }
      }
      if (!saved && !WX.data) {
        fetchWeatherAutoFallback(userTriggered);
      }
    },
    {
      enableHighAccuracy: Boolean(userTriggered),
      timeout: userTriggered ? 6000 : 4000,
      maximumAge: userTriggered ? 0 : 300000,
    },
  );
}

function initWeatherStudio() {
  window.addEventListener('gmp-quota-exceeded', () => {
    const banner = $('gmpQuotaBanner');
    if (banner) banner.hidden = false;
  });

  const bar = $('weatherTopBar');
  const wrap = $('weatherTopWrap');
  const btnClose = $('btnWxClose');
  const btnGps = $('btnWxGpsRefresh');
  const form = $('wxSearchForm');
  const input = $('wxSearchInput');

  if (isEn()) {
    setT('wxHeroKicker', 'CURRENT CONDITIONS');
    setT('wxUvKicker', 'UV INDEX & SUN INTENSITY');
    setT('wxWindHumKicker', 'WIND & HUMIDITY');
    setT('wxWindLbl', 'Wind');
    setT('wxHumLbl', 'Humidity');
    setT('wxAqiKicker', 'AIR QUALITY');
    setT('wxPollenKicker', 'POLLEN ALLERGY');
    setT('wxWeekTitle', '1-Week Detailed Forecast (7 Days)');
    setT('wxWeekMeta', 'Temp · Condition · Wind km/h · UV · Humidity · Pollen (D1–D5)');
    if (input) input.placeholder = 'Search city / address…';
  }

  if (bar) bar.addEventListener('click', toggleWeatherDrawer);
  if (btnClose) btnClose.addEventListener('click', closeWeatherDrawer);
  if (btnGps) btnGps.addEventListener('click', () => refreshWeatherGps(true));
  if (form && input) {
    input.addEventListener('focus', () => {
      WX.pausedForInput = true;
      wxClearTimers();
      const fill = $('wxAutoTimerFill');
      if (fill) fill.classList.remove('is-running');
    });
    input.addEventListener('blur', () => {
      WX.pausedForInput = false;
      if (WX.isOpen) wxRestartAutoCloseTimer();
    });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      WX.pausedForInput = false;
      searchWeatherLocation(input.value);
    });
  }

  document.addEventListener('click', ev => {
    if (WX.isOpen && wrap && !wrap.contains(ev.target)) {
      closeWeatherDrawer();
    }
  });
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && WX.isOpen) closeWeatherDrawer();
  });

  refreshWeatherGps(false);
}

/* ---------------- boot ---------------- */
function boot() {
  S.project = loadLocal();
  if (S.project && S.project.cloudSongId) S.cloudSongId = S.project.cloudSongId;
  bind(); initVolume(); syncUI(); syncLoopBtn(); replan();
  bindCloudStudio();
  initNotice();
  initWeatherStudio();
  initSlidingMenus();
  restoreFonts();
  // first visit on a phone: スマホ mode
  let mode = window.matchMedia && window.matchMedia('(max-width: 760px)').matches ? 'mobile' : 'easy';
  try { mode = localStorage.getItem('jizura.mode') || mode; } catch (e) {}
  setMode(mode); commit();
  syncSlidingMenus(false);
  bindTour();
  // Tour is accessible manually via the ? button (#btnTour), not auto-started
  let seen = false; try { seen = localStorage.getItem('jizura.tourDone') === '1'; } catch (e) {}
  // open on a representative frame (end of the first cut's entrance)
  const c0 = S.plan.cuts.find(c => c.line >= 0);
  if (c0) seek(c0.start + Math.min(c0.dur * 0.6, c0.inDur + 0.25));
  requestAnimationFrame(tick);
  // the song used last time (same name as the saved project's) comes back after a reload
  if (J.loadSong && S.project.audioName) J.loadSong().then(f => { if (f && f.name === S.project.audioName && !S.audio) loadAudioFile(f, true); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
J.ui = S;
// hooks for hosts that embed the app (the After Effects CEP panel)
J.uiApi = { toast, replan, syncUI, pause, seek, playRange, selectLyricWord, saveCorrectedLyrics, tlWHandleAt, tlDragWordTo, tlFocusWord, tlWordBoxAt, syncTimelineInspector, syncQualityControlPanel, reanalyzeLowConfidenceUI, autoOptimizeQcAndCoordinationUI, jumpToNextLowConfWord, translateAllLyrics, toggleTranslationLayer, clearTranslationLayer, syncTranslationControls, updateTransCfg, saveSyncedLyrics, syncSlidingMenus, nudgeGlobalSyncOffset, alignAllWordsAcousticallyUI, microAlignTapPhrase, shiftTapPhraseWords, toggleTapLoop, assistRemainingTapLines, kpQuickTapCurrentWord, startTap, tapNow, tapEndHold, tapSkip, tapBack, stopTap, openCloudHub, setCloudTab, saveCurrentSongToFirebase, loadCloudSongIntoStudio, downloadCloudSongArtifact, recordWork, testVercelBridge, syncSongToVercel, deployToVercel, flushSave, loadAudioFile, restartPreview, exportRange, exportRangeLines, openNotice, closeNotice, initWeatherStudio, openWeatherDrawer, closeWeatherDrawer, toggleWeatherDrawer, refreshWeatherGps, wxClassifyUvRisk };
J.S = S;
if (typeof window !== 'undefined') window.J = J;
const modBtn = $('btnModularStudio');
const bgJobPill = $('bgJobPill');
const bgJobText = $('bgJobText');
let bgJobFadeTimer = 0;

function updateBgJobPill(job) {
  if (!bgJobPill || !bgJobText || !job) return;
  clearTimeout(bgJobFadeTimer);
  bgJobPill.classList.remove('is-done', 'is-err');
  if (job.status === 'queued' || job.status === 'running') {
    const pct = Math.max(0, Math.min(100, Number(job.progress) || 0));
    bgJobText.textContent = `IA ${pct}%`;
    bgJobPill.hidden = false;
  } else if (job.status === 'completed') {
    bgJobText.textContent = job.cachedHit ? 'Cache 100%' : 'Prêt 100%';
    bgJobPill.classList.add('is-done');
    bgJobPill.hidden = false;
    bgJobFadeTimer = setTimeout(() => { bgJobPill.hidden = true; }, 12000);
  } else if (job.status === 'failed') {
    bgJobText.textContent = 'Échec IA';
    bgJobPill.classList.add('is-err');
    bgJobPill.hidden = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('alexura:bg-job', (ev) => {
    const job = ev && ev.detail;
    if (job) {
      updateBgJobPill(job);
      if (job.status === 'completed' && !job.cachedHit) {
        toast('Analyse vocale terminée en arrière-plan.');
      } else if (job.status === 'failed') {
        toast('Un traitement en arrière-plan a échoué — ouvrez le Studio IA pour relancer.');
      }
    }
  });
  // Light non-blocking startup check for any in-flight background jobs
  if (bgJobPill && typeof fetch === 'function') {
    fetch('/api/v2/jobs').then((r) => r.ok ? r.json() : null).then((d) => {
      const list = d && d.success && Array.isArray(d.jobs) ? d.jobs : [];
      const active = list.find((j) => j.status === 'queued' || j.status === 'running');
      if (active) {
        updateBgJobPill(active);
        if (typeof EventSource === 'function') {
          const es = new EventSource('/api/v2/jobs/events');
          es.onmessage = (m) => {
            try {
              const upd = JSON.parse(m.data);
              if (upd && upd.id) {
                updateBgJobPill(upd);
                if (upd.status === 'completed' || upd.status === 'failed') es.close();
              }
            } catch {}
          };
          es.onerror = () => es.close();
        }
      }
    }).catch(() => {});
  }
}

if (bgJobPill) {
  bgJobPill.addEventListener('click', () => {
    if (window.AlexuraReactStudio && typeof window.AlexuraReactStudio.open === 'function') {
      window.AlexuraReactStudio.open();
    }
  });
}

if (modBtn) {
  modBtn.addEventListener('click', () => {
    if (window.AlexuraReactStudio && typeof window.AlexuraReactStudio.open === 'function') {
      window.AlexuraReactStudio.open('upload');
    } else {
      toast('Module Studio React en cours de chargement…');
    }
  });
}

const skillsAdminBtn = $('btnSkillsAdmin');
if (skillsAdminBtn) {
  skillsAdminBtn.addEventListener('click', () => {
    if (window.AlexuraReactStudio && typeof window.AlexuraReactStudio.open === 'function') {
      window.AlexuraReactStudio.open('skills');
    } else {
      toast('Interface Skills IA en cours de chargement…');
    }
  });
}
})();
