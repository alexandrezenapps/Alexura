/* JIZURA pack: genreMotions — Audio-reactive bespoke motions for Trap Soul, R&B, Hip-Hop & Pop (enter, hold, exit, cam, bg, fx, trans, treat, decor) */
(() => {
'use strict';
const E = J.E;
const PK = 'genreMotions';
const reg = (g, k, d) => J.register(g, k, d, PK);
const DEG = J.DEG, TAU = J.TAU, PI = Math.PI;
const clamp = J.clamp, lerp = J.lerp;
const HIDE = Object.freeze({ hide: true });

/* ---------------- Song-reactive beat & energy helpers ---------------- */
function beatState(env, fallbackHz = 1.65) {
  const b = env && env.beat;
  if (b && b.len > 0.14) {
    const phase = clamp(b.since / b.len);
    const hit = Math.exp(-b.since * 9.5);
    const beatIdx = b.index | 0;
    return { phase, hit, idx: beatIdx, len: b.len, synced: true };
  }
  const t = Math.max(0, (env && env.t) || 0);
  const len = 1 / Math.max(0.5, fallbackHz);
  const pos = t * fallbackHz;
  const beatIdx = Math.floor(pos);
  const phase = pos - beatIdx;
  const since = phase * len;
  const hit = Math.exp(-since * 9.5);
  return { phase, hit, idx: beatIdx, len, synced: false };
}

function songEnergy(env, fb = 0.52) {
  const e = env && env.energy;
  if (typeof e === 'number' && Number.isFinite(e)) return clamp(e);
  const bs = beatState(env, 1.5);
  return clamp(fb * 0.72 + 0.28 * bs.hit);
}

const isHex = c => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
const rgbaCol = (c, a) => J.rgba(isHex(c) ? c : '#ffffff', Math.round(clamp(a) * 1000) / 1000);
const motionK = env => clamp(((env.fx && env.fx.motion != null ? env.fx.motion : 0.75) / 0.75), 0.15, 1.6);
const pop = sc => [sc.accent, sc.accent2, sc.fg].find(c => c && J.contrast(c, sc.bg) > 1.45) || sc.fg;
const pop2 = sc => [sc.accent2, sc.ghostA, sc.ghostB, sc.fg].find(c => c && c !== pop(sc) && J.contrast(c, sc.bg) > 1.35) || sc.fg;
const bell = k => Math.sin(PI * clamp(k));

function pushChar(it, fn) {
  if (!it.charFns) it.charFns = [];
  it.charFns.push(fn);
}
function addPre(it, fn) { const p = it.pre; it.pre = p ? (e, x) => { p(e, x); fn(e, x); } : fn; }
function addPost(it, fn) { const p = it.post; it.post = p ? (e, x, bb) => { p(e, x, bb); fn(e, x, bb); } : fn; }

/* =====================================================================
   ENTRANCES (8 — 2 per genre)
   ===================================================================== */

/* 1. Trap Soul — 808 Sub Drop */
reg('enter', 'mvTrap808Drop', {
  name: '808 Sub Drop', en: '808 Sub Drop', tags: ['emotional', 'glitch', 'pop'], w: 1.45,
  apply(env, it, p) {
    const e = E.outExpo(clamp(p));
    const impact = Math.exp(-clamp(p) * 6.5) * Math.sin(clamp(p) * PI * 3.2);
    const dropY = (1 - e) * it.size * 0.65 - impact * it.size * 0.14;
    it.y += dropY;
    it.sy = (it.sy || 1) * (1 + Math.max(0, impact) * 0.18 + (1 - e) * 0.22);
    it.sx = (it.sx || 1) * (1 - (1 - e) * 0.08);
    it.blur = (it.blur || 0) + (1 - e) * 14;
    it.alpha = (it.alpha ?? 1) * clamp(p * 3.6);
    if (p < 0.85) {
      it.echo = it.echo || { n: 2, dx: 0, dy: -it.size * 0.18 * (1 - e), a: 0.28 * (1 - e) };
    }
  },
});

/* 2. Trap Soul — Nocturne Glide */
reg('enter', 'mvTrapGlide', {
  name: 'Glissée Nocturne 2AM', en: 'Midnight Glide', tags: ['emotional', 'calm', 'editorial'], w: 1.4,
  apply(env, it, p) {
    const dir = (it.seed | 0) % 2 ? 1 : -1;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.38 : 0;
      const q = clamp((p - d) / 0.62);
      if (q <= 0.01) return HIDE;
      const e = E.outCubic(q);
      return {
        dx: dir * (1 - e) * it.size * 0.85,
        dy: (1 - e) * it.size * 0.25,
        blur: (1 - e) * 9,
        a: Math.pow(e, 0.8),
      };
    });
  },
});

/* 3. R&B — Soie Glissée */
reg('enter', 'mvRnbSilkSweep', {
  name: 'Soie Glissée', en: 'Silk Sweep', tags: ['calm', 'emotional', 'editorial'], w: 1.45,
  apply(env, it, p) {
    const e = E.inOutCubic(clamp(p));
    const m = it._m || (it._m = J.measure(it));
    const x0 = it.x - m.w / 2 - it.size * 0.35, x1 = it.x + m.w / 2 + it.size * 0.35;
    const edge = lerp(x0, x1, e);
    it.clip = [x0 - 3000, edge];
    it.size *= lerp(0.94, 1.0, E.outQuad(clamp(p)));
    it.blur = (it.blur || 0) + (1 - e) * 6;
    it.alpha = (it.alpha ?? 1) * clamp(p * 2.4);
  },
});

/* 4. R&B — Élévation Velours */
reg('enter', 'mvRnbVelvetRise', {
  name: 'Élévation Velours', en: 'Velvet Rise', tags: ['calm', 'emotional', 'editorial'], w: 1.4,
  apply(env, it, p) {
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.42 : 0;
      const q = clamp((p - d) / 0.58);
      if (q <= 0.01) return HIDE;
      const e = E.outCubic(q);
      return {
        dy: (1 - e) * it.size * 0.55,
        s: lerp(0.88, 1.0, e),
        blur: (1 - e) * 7,
        a: e,
      };
    });
  },
});

/* 5. Hip-Hop — Punch Kick 808 */
reg('enter', 'mvHhSlamPunch', {
  name: 'Punch Kick 808', en: '808 Snare Slam', tags: ['pop', 'glitch', 'graphic'], w: 1.5,
  apply(env, it, p) {
    const seed = it.seed | 0;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.36 : 0;
      const q = clamp((p - d) / 0.42);
      if (q <= 0.005) return HIDE;
      const s = E.outBack(q, 2.2);
      const kick = Math.exp(-q * 7) * Math.sin(q * PI * 2.5);
      return {
        s: lerp(1.55, 1.0, clamp(s * 0.92 + 0.08)) + kick * 0.14,
        dy: kick * it.size * 0.15 * (J.rs(seed, i, 7) > 0 ? 1 : -1),
        rot: (1 - q) * J.rs(seed, i, 9) * 14,
        a: clamp(q * 5),
      };
    });
  },
});

/* 6. Hip-Hop — Coupe Street */
reg('enter', 'mvHhSliceCut', {
  name: 'Coupe Street', en: 'Street Slice', tags: ['glitch', 'graphic', 'pop'], w: 1.4,
  apply(env, it, p) {
    const e = E.outExpo(clamp(p));
    it.bands = J.itemBands(env, it, 6, (i) => (1 - clamp(e * 1.25 - i * 0.04)) * (i % 2 ? 1 : -1) * env.W * 0.55);
    it.sx = (it.sx || 1) * lerp(1.32, 1.0, e);
    it.alpha = (it.alpha ?? 1) * clamp(p * 4.2);
  },
});

/* 7. Pop — Éclat Élastique */
reg('enter', 'mvPopElasticStar', {
  name: 'Éclat Élastique Pop', en: 'Elastic Pop Star', tags: ['pop', 'graphic'], w: 1.5,
  apply(env, it, p) {
    const seed = it.seed | 0;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.4 : 0;
      const q = clamp((p - d) / 0.56);
      if (q <= 0.005) return HIDE;
      const spring = 1 - Math.exp(-q * 7.5) * Math.cos(q * 15);
      return {
        s: Math.max(0.05, spring),
        dy: -(1 - E.outQuad(q)) * it.size * 0.45,
        rot: (1 - E.outCubic(q)) * J.rs(seed, i, 3) * 22,
        a: clamp(q * 4),
      };
    });
  },
});

/* 8. Pop — Flash Scène */
reg('enter', 'mvPopCurtainFlash', {
  name: 'Flash Scène Pop', en: 'Stage Curtain Flash', tags: ['pop', 'emotional'], w: 1.4,
  apply(env, it, p) {
    const e = E.outExpo(clamp(p));
    const bs = beatState(env, 1.85);
    it.size *= lerp(0.84, 1.0 + 0.04 * bs.hit, e);
    it.streak = p < 0.72 ? { n: 3, dx: (1 - e) * it.size * 0.45, a: 0.32 * (1 - e) } : null;
    it.alpha = (it.alpha ?? 1) * clamp(p * 3.5);
  },
});

/* =====================================================================
   HOLDS (8 — 2 per genre, beat & song-energy synchronized)
   ===================================================================== */

/* 1. Trap Soul — Sub-Bass 808 Pulse */
reg('hold', 'mvTrap808Pump', {
  name: 'Pulse 808 Sub-Bass', en: '808 Sub-Bass Pulse', tags: ['emotional', 'glitch', 'pop'], w: 1.5,
  apply(env, it, amt) {
    const bs = beatState(env, 1.25);
    const en = songEnergy(env, 0.58);
    const k = motionK(env) * amt * (0.65 + 0.65 * en);
    const bump = bs.hit * k;
    it.size *= 1 + 0.075 * bump;
    it.y += it.size * 0.045 * bump;
    it.track = (it.track || 0) + 0.032 * bump;
  },
});

/* 2. Trap Soul — Brume Flottante */
reg('hold', 'mvTrapFloatDrift', {
  name: 'Brume Flottante 808', en: '808 Haze Float', tags: ['calm', 'emotional'], w: 1.4,
  apply(env, it, amt) {
    const bs = beatState(env, 1.2);
    const k = motionK(env) * amt;
    const t = env.lt || 0;
    it.y += Math.sin(t * 2.1) * it.size * 0.06 * k + bs.hit * it.size * 0.025 * k;
    it.rot = (it.rot || 0) + Math.sin(t * 1.1) * 0.9 * k;
    it.blur = (it.blur || 0) + Math.max(0, Math.sin(t * 2.4)) * 0.8 * k;
  },
});

/* 3. R&B — Onde de Soie */
reg('hold', 'mvRnbSilkSway', {
  name: 'Onde de Soie R&B', en: 'R&B Silk Wave', tags: ['calm', 'emotional', 'editorial'], w: 1.5,
  apply(env, it, amt) {
    const bs = beatState(env, 1.35);
    const en = songEnergy(env, 0.5);
    const k = motionK(env) * amt * (0.75 + 0.45 * en);
    const t = env.lt || 0;
    pushChar(it, (i) => ({
      dy: Math.sin(t * 3.4 - i * 0.42) * it.size * 0.048 * k,
      dx: Math.cos(t * 1.9 - i * 0.3) * it.size * 0.016 * k,
      s: 1 + 0.022 * bs.hit * k,
    }));
  },
});

/* 4. R&B — Respiration Bougie */
reg('hold', 'mvRnbCandleBreathe', {
  name: 'Respiration Bougie', en: 'Candlelight Breathe', tags: ['calm', 'editorial', 'emotional'], w: 1.45,
  apply(env, it, amt) {
    const bs = beatState(env, 1.25);
    const en = songEnergy(env, 0.48);
    const k = motionK(env) * amt;
    const wave = 0.5 - 0.5 * Math.cos(bs.phase * TAU);
    it.size *= 1 + (0.026 * wave + 0.032 * en) * k;
    it.track = (it.track || 0) + 0.028 * wave * k;
  },
});

/* 5. Hip-Hop — Groove Head-Nod */
reg('hold', 'mvHhHeadNod', {
  name: 'Groove Head-Nod', en: 'Head-Nod Bounce', tags: ['pop', 'graphic', 'glitch'], w: 1.55,
  apply(env, it, amt) {
    const bs = beatState(env, 1.55);
    const en = songEnergy(env, 0.65);
    const k = motionK(env) * amt * (0.75 + 0.5 * en);
    const nod = bs.hit * k;
    const dir = (bs.idx % 2 === 0 ? 1 : -1);
    it.y += it.size * 0.085 * nod;
    it.rot = (it.rot || 0) + dir * 1.6 * nod;
    it.sx = (it.sx || 1) * (1 + 0.045 * nod);
    it.sy = (it.sy || 1) * (1 - 0.025 * nod);
  },
});

/* 6. Hip-Hop — Flex Rythmique */
reg('hold', 'mvHhBarFlex', {
  name: 'Flex Rythmique Street', en: 'Beat Bar Flex', tags: ['pop', 'glitch', 'graphic'], w: 1.45,
  apply(env, it, amt) {
    const bs = beatState(env, 1.6);
    const en = songEnergy(env, 0.62);
    const k = motionK(env) * amt * (0.7 + 0.55 * en);
    pushChar(it, (i) => {
      const pulse = Math.exp(-Math.max(0, bs.phase - (i % 4) * 0.04) * 10);
      return {
        s: 1 + 0.065 * pulse * k,
        dy: -it.size * 0.035 * bs.hit * k,
      };
    });
  },
});

/* 7. Pop — Rebond Live Pop */
reg('hold', 'mvPopGrooveBounce', {
  name: 'Rebond Live Pop', en: 'Pop Live Bounce', tags: ['pop', 'graphic'], w: 1.55,
  apply(env, it, amt) {
    const bs = beatState(env, 1.9);
    const en = songEnergy(env, 0.65);
    const k = motionK(env) * amt * (0.75 + 0.45 * en);
    const t = env.lt || 0;
    pushChar(it, (i) => ({
      dy: (Math.sin(t * 6.2 + i * 0.65) * 0.042 + bs.hit * 0.05) * it.size * k,
      s: 1 + 0.045 * bs.hit * k,
      rot: Math.cos(t * 4.5 + i * 0.55) * 3.2 * k,
    }));
  },
});

/* 8. Pop — Reflet Scène Gloss */
reg('hold', 'mvPopGlossShimmer', {
  name: 'Reflet Scène Gloss', en: 'Stage Gloss Shimmer', tags: ['pop', 'emotional'], w: 1.45,
  apply(env, it, amt) {
    const bs = beatState(env, 1.85);
    const k = motionK(env) * amt;
    const t = env.lt || 0;
    it.size *= 1 + (0.04 * bs.hit + 0.015 * Math.sin(t * 4.2)) * k;
    const sc = env.sc;
    const hi = pop(sc);
    pushChar(it, (i, g, n) => {
      const pos = (t * 1.4) % 1.4;
      const dist = Math.abs((n > 1 ? i / (n - 1) : 0.5) - pos + 0.2);
      if (dist < 0.14 && isHex(hi)) return { color: hi, s: 1 + 0.05 * k };
      return null;
    });
  },
});

/* =====================================================================
   EXITS (4 — 1 per genre)
   ===================================================================== */

reg('exit', 'mvTrapSmokeOut', {
  name: 'Brume 2AM Dissolve', en: 'Midnight Haze Out', tags: ['emotional', 'calm'], w: 1.4,
  apply(env, it, p) {
    const e = E.inQuad(clamp(p));
    it.y -= it.size * 0.42 * e;
    it.blur = (it.blur || 0) + e * 24;
    it.track = (it.track || 0) + e * 0.25;
    it.alpha = (it.alpha ?? 1) * (1 - e);
  },
});

reg('exit', 'mvRnbSilkFade', {
  name: 'Voile de Soie', en: 'Silk Feather Fade', tags: ['calm', 'emotional', 'editorial'], w: 1.4,
  apply(env, it, p) {
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.35 : 0;
      const q = clamp((p - d) / 0.65);
      const e = E.inCubic(q);
      return {
        dy: -e * it.size * 0.36,
        blur: e * 10,
        s: lerp(1, 0.92, e),
        a: 1 - e,
      };
    });
  },
});

reg('exit', 'mvHhCutSnap', {
  name: 'Whip Coupe Sèche', en: 'Street Whip Snap', tags: ['pop', 'glitch', 'graphic'], w: 1.45,
  apply(env, it, p) {
    const e = E.inExpo(clamp(p));
    const dir = (it.seed | 0) % 2 ? 1 : -1;
    it.x += dir * env.W * 0.42 * e;
    it.sx = (it.sx || 1) * lerp(1, 2.4, e);
    it.alpha = (it.alpha ?? 1) * (1 - Math.pow(e, 0.8));
  },
});

reg('exit', 'mvPopSparkBurst', {
  name: 'Éclat Pop Confetti', en: 'Pop Spark Exit', tags: ['pop', 'graphic'], w: 1.45,
  apply(env, it, p) {
    const seed = it.seed | 0;
    const inBack = (x, s = 1.8) => { x = clamp(x); return x * x * ((s + 1) * x - s); };
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? J.r(seed, i, 2) * 0.3 : 0;
      const q = clamp((p - d) / 0.7);
      const e = inBack(q, 1.8);
      return {
        s: Math.max(0.01, 1 - Math.abs(e)),
        dy: J.rs(seed, i, 5) * it.size * 0.8 * Math.max(0, q),
        rot: J.rs(seed, i, 8) * 180 * q,
        a: 1 - q * q,
      };
    });
  },
});

/* =====================================================================
   CAMERAS (8 — 2 per genre, beat & song-energy synced)
   ===================================================================== */

reg('cam', 'mvCam808Kick', {
  name: 'Kick 808 Lourd', en: '808 Bass Kick Cam', tags: ['emotional', 'glitch', 'pop'], w: 1.5, ae: 'beatPunch',
  get(env) {
    const bs = beatState(env, 1.25), en = songEnergy(env, 0.58), K = motionK(env);
    const punch = bs.hit * (0.65 + 0.55 * en) * K;
    return { s: 1.015 + 0.045 * punch, y: env.H * 0.014 * punch, rot: (bs.idx % 2 ? 0.55 : -0.55) * punch };
  },
});

reg('cam', 'mvCamLateDrive', {
  name: 'Drive Nocturne Cruise', en: 'Midnight Cruise Cam', tags: ['calm', 'emotional'], w: 1.4, ae: 'driftDiag',
  get(env) {
    const bs = beatState(env, 1.2), K = motionK(env);
    const u = clamp(env.lt / Math.max(0.3, env.cut.dur));
    return {
      x: (u - 0.5) * env.W * 0.032 * K,
      y: Math.sin(env.lt * 1.4) * env.H * 0.01 * K,
      s: 1.02 + 0.018 * bs.hit * K,
    };
  },
});

reg('cam', 'mvCamRnbSilkDolly', {
  name: 'Travelling Soie R&B', en: 'R&B Silk Dolly', tags: ['calm', 'emotional', 'editorial'], w: 1.5, ae: 'dollyIn',
  get(env) {
    const bs = beatState(env, 1.3), K = motionK(env);
    const u = E.inOutSine(clamp(env.lt / Math.max(0.3, env.cut.dur)));
    const breathe = 0.5 - 0.5 * Math.cos(bs.phase * TAU);
    return { s: 1.0 + 0.055 * u * K + 0.012 * breathe * K, y: -env.H * 0.008 * u * K };
  },
});

reg('cam', 'mvCamRnbSway', {
  name: 'Balancement Velours', en: 'Velvet Pendulum Sway', tags: ['calm', 'emotional'], w: 1.4, ae: 'handheld',
  get(env) {
    const bs = beatState(env, 1.3), K = motionK(env);
    const ph = ((bs.idx % 2) + bs.phase) * PI;
    return { x: Math.sin(ph) * env.W * 0.014 * K, rot: Math.sin(ph) * 0.9 * K, s: 1.022 };
  },
});

reg('cam', 'mvCamHhBounce', {
  name: 'Bounce Cypher 808', en: 'Hip-Hop Cypher Bounce', tags: ['pop', 'glitch', 'graphic'], w: 1.55, ae: 'beatPunch',
  get(env) {
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.65), K = motionK(env);
    const p = bs.hit * (0.7 + 0.5 * en) * K;
    return { s: 1.01 + 0.052 * p, y: env.H * 0.018 * p, rot: (bs.idx % 2 ? -1 : 1) * 0.85 * p };
  },
});

reg('cam', 'mvCamHhSnapZoom', {
  name: 'Snap Zoom Street', en: 'Street Beat Snap Zoom', tags: ['glitch', 'pop', 'graphic'], w: 1.45, ae: 'stepZoom',
  get(env) {
    const bs = beatState(env, 1.6), K = motionK(env);
    const step = (bs.idx % 3) * 0.024 * K;
    return { s: 1.01 + step + 0.03 * bs.hit * K, rot: ((bs.idx % 2) ? 0.6 : -0.6) * K * 0.5 };
  },
});

reg('cam', 'mvCamPopStageHop', {
  name: 'Hop Scène Live', en: 'Pop Stage Hop', tags: ['pop', 'graphic'], w: 1.55, ae: 'bounce',
  get(env) {
    const bs = beatState(env, 1.9), en = songEnergy(env, 0.65), K = motionK(env);
    const hop = Math.abs(Math.sin(bs.phase * PI)) * K * (0.7 + 0.4 * en);
    return { s: 1.015 + 0.036 * bs.hit * K, y: -env.H * 0.014 * hop, rot: Math.sin(bs.phase * TAU) * 0.7 * K };
  },
});

reg('cam', 'mvCamPopChorusWide', {
  name: 'Refrain Grand Angle', en: 'Chorus Wide Bloom', tags: ['pop', 'emotional'], w: 1.45, ae: 'pullOut',
  get(env) {
    const en = songEnergy(env, 0.62), K = motionK(env);
    const u = E.outCubic(clamp(env.lt / Math.max(0.3, env.cut.dur)));
    return { s: lerp(1.07, 1.0, u) + 0.022 * en * K };
  },
});

/* =====================================================================
   BACKGROUNDS (4 — 1 per genre, song-energy & beat reactive)
   ===================================================================== */

reg('bg', 'mvBg808SubRing', {
  name: 'Ondes Sub-Bass 808', en: '808 Sub-Bass Rings', tags: ['emotional', 'glitch'], w: 1.45,
  plan: rng => ({ rings: rng.int(4, 7), spin: rng.range(0.15, 0.35) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.25), en = songEnergy(env, 0.55);
    const c1 = pop(sc), c2 = pop2(sc), cx = W * 0.5, cy = H * 0.5;
    const maxR = Math.hypot(W, H) * 0.52;
    ctx.save();
    // warm nocturnal ambient wash
    const g = ctx.createRadialGradient(cx, cy, maxR * 0.05, cx, cy, maxR * 0.85);
    g.addColorStop(0, rgbaCol(c1, 0.14 + 0.12 * bs.hit + 0.08 * en));
    g.addColorStop(0.55, rgbaCol(c2, 0.06 + 0.06 * en));
    g.addColorStop(1, rgbaCol(sc.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    const n = Q.rings || 5;
    for (let i = 0; i < n; i++) {
      const p = ((t * 0.32 + i / n) % 1);
      const r = maxR * (0.12 + 0.88 * p) * (1 + 0.05 * bs.hit);
      ctx.strokeStyle = rgbaCol(i % 2 ? c1 : c2, (1 - p) * (0.26 + 0.22 * bs.hit));
      ctx.lineWidth = Math.max(1.2, Math.min(W, H) * (0.002 + 0.004 * (1 - p)));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgRnbSilkWaves', {
  name: 'Vagues de Soie R&B', en: 'R&B Silk Waves', tags: ['calm', 'emotional', 'editorial'], w: 1.45,
  plan: rng => ({ layers: rng.int(4, 6), phase: rng.range(0, 6.28) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const en = songEnergy(env, 0.5), bs = beatState(env, 1.3);
    const c1 = pop(sc), c2 = pop2(sc);
    ctx.save();
    const layers = Q.layers || 5;
    for (let l = 0; l < layers; l++) {
      const yBase = H * (0.28 + 0.52 * (l / Math.max(1, layers - 1)));
      const amp = H * (0.045 + 0.03 * en + 0.015 * bs.hit);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += Math.max(24, W / 28)) {
        const y = yBase + Math.sin(x / W * 4.2 + t * (0.9 + l * 0.18) + (Q.phase || 0) + l) * amp;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fillStyle = rgbaCol(l % 2 ? c1 : c2, 0.055 + 0.035 * en);
      ctx.fill();
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgHhSubGrid', {
  name: 'Spectre Street 808', en: 'Hip-Hop Bass Grid', tags: ['pop', 'glitch', 'graphic'], w: 1.45,
  plan: rng => ({ bars: rng.int(16, 24), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.62);
    const c1 = pop(sc), c2 = pop2(sc);
    ctx.save();
    // subtle street frame lines
    const pad = Math.min(W, H) * 0.045;
    ctx.strokeStyle = rgbaCol(c1, 0.16 + 0.14 * bs.hit);
    ctx.lineWidth = Math.max(1.5, Math.min(W, H) * 0.0025);
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);
    // bass equalizer bars bottom & top mirror
    const n = Q.bars || 20, bw = (W - pad * 4) / n;
    for (let i = 0; i < n; i++) {
      const sym = 1 - Math.abs(i / (n - 1) - 0.5) * 1.3;
      const lvl = clamp(0.18 + 0.55 * sym * (0.45 * en + 0.55 * bs.hit) + 0.25 * Math.sin(t * 7 + i * 0.9));
      const bh = H * 0.16 * lvl;
      const x = pad * 2 + i * bw + bw * 0.18;
      ctx.fillStyle = rgbaCol(i % 3 === 0 ? c2 : c1, 0.14 + 0.16 * bs.hit);
      ctx.fillRect(x, H - pad - bh, bw * 0.64, bh);
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgPopMirrorLights', {
  name: 'Projecteurs Mirrorball', en: 'Pop Mirrorball Beams', tags: ['pop', 'graphic'], w: 1.5,
  plan: rng => ({ beams: rng.int(6, 9), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.9), en = songEnergy(env, 0.65);
    const c1 = pop(sc), c2 = pop2(sc);
    ctx.save();
    const beams = Q.beams || 7;
    const R = Math.hypot(W, H) * 1.1;
    for (let i = 0; i < beams; i++) {
      const topX = W * ((i + 0.5) / beams);
      const ang = Math.PI * 0.5 + Math.sin(t * 1.3 + i * 1.1) * 0.38;
      const spread = 0.065 + 0.03 * bs.hit;
      ctx.beginPath();
      ctx.moveTo(topX, -10);
      ctx.lineTo(topX + Math.cos(ang - spread) * R, Math.sin(ang - spread) * R);
      ctx.lineTo(topX + Math.cos(ang + spread) * R, Math.sin(ang + spread) * R);
      ctx.closePath();
      ctx.fillStyle = rgbaCol(i % 2 ? c1 : c2, 0.075 + 0.075 * bs.hit + 0.04 * en);
      ctx.fill();
    }
    // glittering sparkles
    const U = Math.min(W, H);
    for (let k = 0; k < 14; k++) {
      const px = J.r(Q.seed || 7, k, 1) * W;
      const py = J.r(Q.seed || 7, k, 2) * H;
      const tw = 0.5 + 0.5 * Math.sin(t * 4.5 + k * 2.1);
      const r = U * (0.005 + 0.008 * bs.hit) * tw;
      ctx.fillStyle = rgbaCol(k % 2 ? c2 : c1, 0.35 * tw);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  },
});

/* =====================================================================
   POST FX (4 — 1 per genre)
   ===================================================================== */

const fxWrap = (k, d) => reg('fx', k, Object.assign({}, d, {
  draw(ctx, ev, k2, I) { ctx.save(); try { d.draw(ctx, ev, clamp(Number.isFinite(k2) ? k2 : 1), I); } finally { ctx.restore(); } },
}));

fxWrap('mvFx808Shock', {
  name: 'Choc Sub-Bass 808', en: '808 Sub Shock', tags: ['emotional', 'glitch', 'pop'], w: 1.35, dur: 4, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I;
    if (!S) return;
    const pulse = Math.sin(PI * k);
    const dy = pulse * ch * 0.012;
    ctx.globalAlpha = 0.32 * pulse;
    ctx.drawImage(S, 0, -dy, cw, ch);
    const rad = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.1, cw / 2, ch / 2, cw * 0.72);
    rad.addColorStop(0, rgbaCol(pop(sc), 0.14 * pulse));
    rad.addColorStop(1, rgbaCol(sc.bg, 0));
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, cw, ch);
  },
});

fxWrap('mvFxRnbWarmBloom', {
  name: 'Halo Soie Chaud', en: 'R&B Warm Bloom', tags: ['calm', 'emotional', 'editorial'], w: 1.35, dur: 5, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I;
    const a = bell(k) * 0.24;
    const g = ctx.createRadialGradient(cw * 0.5, ch * 0.5, cw * 0.04, cw * 0.5, ch * 0.5, cw * 0.65);
    g.addColorStop(0, rgbaCol(pop(sc), a));
    g.addColorStop(0.55, rgbaCol(pop2(sc), a * 0.45));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  },
});

fxWrap('mvFxHhImpactCut', {
  name: 'Flash Impact Street', en: 'Street Impact Flash', tags: ['pop', 'glitch', 'graphic'], w: 1.4, dur: 3, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I;
    const a = (1 - E.outQuad(k)) * 0.26;
    ctx.fillStyle = rgbaCol(pop(sc), a);
    ctx.fillRect(0, 0, cw, ch);
    if (S && k < 0.65) {
      const sh = cw * 0.015 * (1 - k);
      ctx.globalAlpha = 0.35 * (1 - k);
      ctx.drawImage(S, 0, ch * 0.35, cw, ch * 0.3, sh, ch * 0.35, cw, ch * 0.3);
    }
  },
});

fxWrap('mvFxPopSparkFlash', {
  name: 'Éclat Scène Pop', en: 'Pop Stage Spark', tags: ['pop', 'graphic'], w: 1.4, dur: 4, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I;
    const a = bell(k) * 0.28;
    const g = ctx.createLinearGradient(0, 0, cw, ch);
    g.addColorStop(0, rgbaCol(pop(sc), a));
    g.addColorStop(0.5, rgbaCol('#ffffff', a * 0.55));
    g.addColorStop(1, rgbaCol(pop2(sc), a));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
  },
});

/* =====================================================================
   TRANSITIONS (2)
   ===================================================================== */

reg('trans', 'mvTransSilkBlend', {
  name: 'Fondu Soie Nocturne', en: 'Silk Horizon Blend', tags: ['calm', 'emotional', 'editorial'], w: 1.4, dur: 0.42,
  plan: rng => ({ dir: rng.pick([1, -1]) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch, sc } = I, e = E.inOutCubic(p), d = (P && P.dir) || 1;
    ctx.drawImage(A, 0, 0);
    const x = d > 0 ? cw * e : cw * (1 - e);
    ctx.save();
    ctx.beginPath();
    if (d > 0) ctx.rect(0, 0, x, ch); else ctx.rect(x, 0, cw - x, ch);
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    const lw = Math.max(2, Math.min(cw, ch) * 0.014);
    ctx.globalAlpha = bell(p) * 0.72;
    ctx.fillStyle = pop(sc);
    ctx.fillRect(x - lw / 2, 0, lw, ch);
  },
});

reg('trans', 'mvTransPopFlashWipe', {
  name: 'Coupe Flash Rythmée', en: 'Beat Flash Wipe', tags: ['pop', 'glitch', 'graphic'], w: 1.45, dur: 0.34,
  plan: rng => ({ dir: rng.pick([1, -1]) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch, sc } = I, e = E.inOutExpo(p), d = (P && P.dir) || 1;
    ctx.drawImage(A, 0, 0);
    const band = Math.min(cw, ch) * 0.065 * bell(p);
    const sl = ch * 0.25 * d;
    const x = lerp(-Math.abs(sl) - band, cw + Math.abs(sl) + band, e);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-cw, 0); ctx.lineTo(x - sl * 0.5, 0); ctx.lineTo(x + sl * 0.5, ch); ctx.lineTo(-cw, ch); ctx.closePath();
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    ctx.fillStyle = pop(sc);
    ctx.globalAlpha = 0.85 * bell(p);
    ctx.beginPath();
    ctx.moveTo(x - sl * 0.5, 0); ctx.lineTo(x - sl * 0.5 + band, 0);
    ctx.lineTo(x + sl * 0.5 + band, ch); ctx.lineTo(x + sl * 0.5, ch);
    ctx.closePath();
    ctx.fill();
  },
});

/* =====================================================================
   TREATMENTS (2) & DECOR (2)
   ===================================================================== */

reg('treat', 'mvTreatRnbAura', {
  name: 'Aura Velours Soie', en: 'Velvet Aura Glow', tags: ['calm', 'emotional', 'pop'], w: 1.4,
  apply(env, it) {
    const bs = beatState(env, 1.3);
    const ac = pop(env.sc);
    if (!it.shadow) {
      it.shadow = { color: rgbaCol(ac, 0.55 + 0.25 * bs.hit), blur: it.size * 0.24, x: 0, y: it.size * 0.04 };
    }
    if (env.sc.fg && isHex(ac)) {
      it.gradient = it.gradient || [env.sc.fg, ac];
    }
  },
});

reg('treat', 'mvTreatHhChrome', {
  name: 'Chrome Impact Scène', en: 'Stage Chrome Impact', tags: ['pop', 'graphic', 'glitch'], w: 1.45,
  apply(env, it) {
    const ac = pop(env.sc), ac2 = pop2(env.sc);
    it.gradient = it.gradient || [env.sc.fg, ac, ac2 || env.sc.fg];
    if (!it.shadow) {
      it.shadow = { color: rgbaCol(ac, 0.42), blur: 0, x: it.size * 0.045, y: it.size * 0.045 };
    }
  },
});

reg('decor', 'mvDecoHhBars', {
  name: 'Barres 808 Live', en: 'Live 808 Meter Bars', tags: ['pop', 'glitch', 'graphic'], w: 1.45,
  plan: rng => ({ bars: rng.int(5, 8) }),
  draw(env, bb) {
    if (!bb) return;
    const { ctx, sc, t } = env;
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.6);
    const ac = pop(sc), n = 6, w = Math.max(3, Math.min(env.W, env.H) * 0.005);
    const cy = (bb.y0 + bb.y1) * 0.5;
    ctx.save();
    ctx.fillStyle = rgbaCol(ac, 0.72);
    for (let i = 0; i < n; i++) {
      const h = (10 + 26 * clamp(0.35 + 0.45 * bs.hit + 0.35 * en + 0.25 * Math.sin(t * 8 + i * 1.1)));
      ctx.fillRect(bb.x0 - (n - i) * (w * 2.1) - 10, cy - h * 0.5, w, h);
      ctx.fillRect(bb.x1 + i * (w * 2.1) + 10, cy - h * 0.5, w, h);
    }
    ctx.restore();
  },
});

reg('decor', 'mvDecoPopSparks', {
  name: 'Étoiles & Lueur Pop', en: 'Pop Stage Sparks', tags: ['pop', 'emotional'], w: 1.45,
  plan: rng => ({ seed: rng.int(1, 9999) }),
  draw(env, bb, Q) {
    if (!bb) return;
    const { ctx, sc, t } = env;
    const bs = beatState(env, 1.9);
    const c1 = pop(sc), c2 = pop2(sc);
    const pts = [
      [bb.x0 - 18, bb.y0 - 12],
      [bb.x1 + 18, bb.y0 - 8],
      [bb.x0 - 14, bb.y1 + 12],
      [bb.x1 + 16, bb.y1 + 14],
    ];
    ctx.save();
    pts.forEach(([px, py], i) => {
      const r = (6 + 7 * bs.hit) * (0.65 + 0.35 * Math.sin(t * 5 + i + (Q.seed || 1)));
      ctx.strokeStyle = rgbaCol(i % 2 ? c1 : c2, 0.78);
      ctx.lineWidth = Math.max(1.4, Math.min(env.W, env.H) * 0.0025);
      ctx.beginPath();
      ctx.moveTo(px - r, py); ctx.lineTo(px + r, py);
      ctx.moveTo(px, py - r); ctx.lineTo(px, py + r);
      ctx.stroke();
    });
    ctx.restore();
  },
});
})();
