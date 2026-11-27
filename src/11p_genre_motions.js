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
const inBack = (x, s = 1.8) => { x = clamp(x); return x * x * ((s + 1) * x - s); };

function pushChar(it, fn) {
  if (!it.charFns) it.charFns = [];
  it.charFns.push(fn);
}
function addPre(it, fn) { const p = it.pre; it.pre = p ? (e, x) => { p(e, x); fn(e, x); } : fn; }
function addPost(it, fn) { const p = it.post; it.post = p ? (e, x, bb) => { p(e, x, bb); fn(e, x, bb); } : fn; }

function drawStarGlint(ctx, cx, cy, r, col, alpha) {
  if (r <= 0.5 || alpha <= 0.01) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = col;
  ctx.beginPath();
  const ir = r * 0.18;
  for (let i = 0; i < 8; i++) {
    const ang = (i * PI) / 4;
    const rad = i % 2 === 0 ? r : ir;
    const x = Math.cos(ang) * rad, y = Math.sin(ang) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* =====================================================================
   ENTRANCES (8 — 2 per genre)
   ===================================================================== */

/* 1. Trap Soul — 808 Sub Drop */
reg('enter', 'mvTrap808Drop', {
  name: '808 Sub Drop', en: '808 Sub Drop', tags: ['emotional', 'glitch', 'pop'], w: 1.5,
  apply(env, it, p) {
    const q = clamp(p);
    const e = E.outExpo(q);
    const impact = Math.exp(-q * 6.2) * Math.sin(q * PI * 3.2);
    const dropY = (1 - e) * it.size * 0.72 - impact * it.size * 0.16;
    it.y += dropY;
    it.sy = (it.sy || 1) * (1 + Math.max(0, impact) * 0.20 + (1 - e) * 0.24);
    it.sx = (it.sx || 1) * (1 - (1 - e) * 0.09);
    it.blur = (it.blur || 0) + (1 - e) * 14;
    it.track = (it.track || 0) + (1 - e) * 0.12;
    it.alpha = (it.alpha ?? 1) * clamp(q * 3.8);
    if (q < 0.88 && !it.echo) {
      it.echo = { n: 3, dx: 0, dy: -it.size * 0.14 * (1 - e), scale: 1 + (1 - e) * 0.08, a: 0.32 * (1 - e), decay: 0.58 };
    }
  },
});

/* 2. Trap Soul — Glissée Nocturne 2AM */
reg('enter', 'mvTrapGlide', {
  name: 'Glissée Nocturne 2AM', en: 'Midnight Glide', tags: ['emotional', 'calm', 'editorial'], w: 1.45,
  apply(env, it, p) {
    const dir = (it.seed | 0) % 2 ? 1 : -1;
    const bs = beatState(env, 1.25);
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.38 : 0;
      const q = clamp((p - d) / 0.62);
      if (q <= 0.01) return HIDE;
      const e = E.outCubic(q);
      return {
        dx: dir * (1 - e) * it.size * 0.92,
        dy: (1 - e) * it.size * 0.28 - bs.hit * (1 - e) * it.size * 0.06,
        blur: (1 - e) * 9,
        s: lerp(0.92, 1.0, e),
        a: Math.pow(e, 0.78),
      };
    });
  },
});

/* 3. R&B — Soie Glissée */
reg('enter', 'mvRnbSilkSweep', {
  name: 'Soie Glissée', en: 'Silk Sweep', tags: ['calm', 'emotional', 'editorial'], w: 1.5, bar: true,
  apply(env, it, p) {
    const q = clamp(p);
    const e = E.inOutCubic(q);
    const m = it._m || (it._m = J.measure(it));
    const x0 = it.x - m.w / 2 - it.size * 0.38, x1 = it.x + m.w / 2 + it.size * 0.38;
    const edge = lerp(x0, x1, e);
    it.clip = [x0 - 3000, edge];
    it.wipeBar = q < 0.98 ? { x: edge, h: Math.max(m.h * 1.15, it.size * 1.2) } : null;
    it.size *= lerp(0.94, 1.0, E.outQuad(q));
    it.blur = (it.blur || 0) + (1 - e) * 5.5;
    it.alpha = (it.alpha ?? 1) * clamp(q * 2.6);
  },
});

/* 4. R&B — Élévation Velours */
reg('enter', 'mvRnbVelvetRise', {
  name: 'Élévation Velours', en: 'Velvet Rise', tags: ['calm', 'emotional', 'editorial'], w: 1.45,
  apply(env, it, p) {
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.42 : 0;
      const q = clamp((p - d) / 0.58);
      if (q <= 0.01) return HIDE;
      const e = E.outCubic(q);
      const lift = Math.sin(q * PI) * 0.05;
      return {
        dy: (1 - e) * it.size * 0.56 - lift * it.size,
        s: lerp(0.86, 1.0, e) + lift * 0.4,
        blur: (1 - e) * 7.5,
        a: Math.pow(e, 0.85),
      };
    });
  },
});

/* 5. Hip-Hop — Punch Kick 808 */
reg('enter', 'mvHhSlamPunch', {
  name: 'Punch Kick 808', en: '808 Snare Slam', tags: ['pop', 'glitch', 'graphic'], w: 1.55,
  apply(env, it, p) {
    const seed = it.seed | 0;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.34 : 0;
      const q = clamp((p - d) / 0.44);
      if (q <= 0.005) return HIDE;
      const s = E.outBack(q, 2.3);
      const kick = Math.exp(-q * 7.2) * Math.sin(q * PI * 2.6);
      return {
        s: lerp(1.62, 1.0, clamp(s * 0.92 + 0.08)) + kick * 0.16,
        dy: kick * it.size * 0.16 * (J.rs(seed, i, 7) > 0 ? 1 : -1),
        dx: kick * it.size * 0.05 * J.rs(seed, i, 5),
        rot: (1 - q) * J.rs(seed, i, 9) * 16,
        a: clamp(q * 5.2),
      };
    });
  },
});

/* 6. Hip-Hop — Coupe Street */
reg('enter', 'mvHhSliceCut', {
  name: 'Coupe Street', en: 'Street Slice', tags: ['glitch', 'graphic', 'pop'], w: 1.45,
  apply(env, it, p) {
    const q = clamp(p);
    const e = E.outExpo(q);
    it.bands = J.itemBands(env, it, 7, (i) => (1 - clamp(e * 1.28 - i * 0.04)) * (i % 2 ? 1 : -1) * env.W * 0.58);
    it.sx = (it.sx || 1) * lerp(1.36, 1.0, e);
    it.streak = q < 0.68 ? { n: 3, dx: (1 - e) * it.size * 0.42, a: 0.28 * (1 - e) } : null;
    it.alpha = (it.alpha ?? 1) * clamp(q * 4.5);
  },
});

/* 7. Pop — Éclat Élastique Pop */
reg('enter', 'mvPopElasticStar', {
  name: 'Éclat Élastique Pop', en: 'Elastic Pop Star', tags: ['pop', 'graphic'], w: 1.55,
  apply(env, it, p) {
    const seed = it.seed | 0;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.38 : 0;
      const q = clamp((p - d) / 0.58);
      if (q <= 0.005) return HIDE;
      const spring = 1 - Math.exp(-q * 7.4) * Math.cos(q * 15.5);
      return {
        s: Math.max(0.05, spring),
        dy: -(1 - E.outQuad(q)) * it.size * 0.48,
        rot: (1 - E.outCubic(q)) * J.rs(seed, i, 3) * 24,
        a: clamp(q * 4.2),
      };
    });
  },
});

/* 8. Pop — Flash Scène Pop */
reg('enter', 'mvPopCurtainFlash', {
  name: 'Flash Scène Pop', en: 'Stage Curtain Flash', tags: ['pop', 'emotional'], w: 1.45,
  apply(env, it, p) {
    const q = clamp(p);
    const e = E.outExpo(q);
    const bs = beatState(env, 1.85);
    it.size *= lerp(0.82, 1.0 + 0.045 * bs.hit, e);
    it.streak = q < 0.74 ? { n: 4, dx: (1 - e) * it.size * 0.52, a: 0.36 * (1 - e) } : null;
    it.alpha = (it.alpha ?? 1) * clamp(q * 3.6);
  },
});

/* =====================================================================
   HOLDS (8 — 2 per genre, beat & song-energy synchronized)
   ===================================================================== */

/* 1. Trap Soul — Pulse 808 Sub-Bass */
reg('hold', 'mvTrap808Pump', {
  name: 'Pulse 808 Sub-Bass', en: '808 Sub-Bass Pulse', tags: ['emotional', 'glitch', 'pop'], w: 1.55,
  apply(env, it, amt) {
    const bs = beatState(env, 1.25);
    const en = songEnergy(env, 0.58);
    const k = motionK(env) * amt * (0.65 + 0.65 * en);
    const bump = bs.hit * k;
    it.size *= 1 + 0.08 * bump;
    it.y += it.size * 0.048 * bump;
    it.track = (it.track || 0) + 0.036 * bump;
    if (bs.hit > 0.32 && !it.echo) {
      it.echo = { n: 2, dx: 0, dy: 0, scale: 1 + 0.075 * bump, a: 0.22 * bs.hit, decay: 0.55 };
    }
  },
});

/* 2. Trap Soul — Brume Flottante 808 */
reg('hold', 'mvTrapFloatDrift', {
  name: 'Brume Flottante 808', en: '808 Haze Float', tags: ['calm', 'emotional'], w: 1.45,
  apply(env, it, amt) {
    const bs = beatState(env, 1.2);
    const en = songEnergy(env, 0.5);
    const k = motionK(env) * amt;
    const t = env.lt || 0;
    it.y += Math.sin(t * 2.1) * it.size * 0.062 * k + bs.hit * it.size * 0.028 * k;
    it.x += Math.cos(t * 1.15) * it.size * 0.022 * k;
    it.rot = (it.rot || 0) + Math.sin(t * 1.1) * 1.0 * k;
    it.blur = (it.blur || 0) + Math.max(0, Math.sin(t * 2.4)) * (0.65 + 0.45 * en) * k;
  },
});

/* 3. R&B — Onde de Soie R&B */
reg('hold', 'mvRnbSilkSway', {
  name: 'Onde de Soie R&B', en: 'R&B Silk Wave', tags: ['calm', 'emotional', 'editorial'], w: 1.55,
  apply(env, it, amt) {
    const bs = beatState(env, 1.35);
    const en = songEnergy(env, 0.5);
    const k = motionK(env) * amt * (0.75 + 0.45 * en);
    const t = env.lt || 0;
    pushChar(it, (i) => ({
      dy: Math.sin(t * 3.4 - i * 0.44) * it.size * 0.052 * k,
      dx: Math.cos(t * 1.9 - i * 0.32) * it.size * 0.018 * k,
      s: 1 + 0.025 * bs.hit * k,
      rot: Math.sin(t * 2.2 - i * 0.35) * 1.4 * k,
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
    it.size *= 1 + (0.028 * wave + 0.032 * en) * k;
    it.track = (it.track || 0) + 0.032 * wave * k;
    it.alpha = (it.alpha ?? 1) * (0.94 + 0.06 * wave);
  },
});

/* 5. Hip-Hop — Groove Head-Nod */
reg('hold', 'mvHhHeadNod', {
  name: 'Groove Head-Nod', en: 'Head-Nod Bounce', tags: ['pop', 'graphic', 'glitch'], w: 1.6,
  apply(env, it, amt) {
    const bs = beatState(env, 1.55);
    const en = songEnergy(env, 0.65);
    const k = motionK(env) * amt * (0.75 + 0.52 * en);
    const nod = bs.hit * k;
    const dir = (bs.idx % 2 === 0 ? 1 : -1);
    it.y += it.size * 0.092 * nod;
    it.rot = (it.rot || 0) + dir * 1.8 * nod;
    it.sx = (it.sx || 1) * (1 + 0.052 * nod);
    it.sy = (it.sy || 1) * (1 - 0.028 * nod);
  },
});

/* 6. Hip-Hop — Flex Rythmique Street */
reg('hold', 'mvHhBarFlex', {
  name: 'Flex Rythmique Street', en: 'Beat Bar Flex', tags: ['pop', 'glitch', 'graphic'], w: 1.5,
  apply(env, it, amt) {
    const bs = beatState(env, 1.6);
    const en = songEnergy(env, 0.62);
    const k = motionK(env) * amt * (0.7 + 0.55 * en);
    pushChar(it, (i) => {
      const pulse = Math.exp(-Math.max(0, bs.phase - (i % 4) * 0.045) * 10);
      return {
        s: 1 + 0.072 * pulse * k,
        dy: -it.size * 0.038 * bs.hit * k,
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
      dy: (Math.sin(t * 6.2 + i * 0.65) * 0.045 + bs.hit * 0.055) * it.size * k,
      s: 1 + 0.05 * bs.hit * k,
      rot: Math.cos(t * 4.5 + i * 0.55) * 3.4 * k,
    }));
  },
});

/* 8. Pop — Reflet Scène Gloss */
reg('hold', 'mvPopGlossShimmer', {
  name: 'Reflet Scène Gloss', en: 'Stage Gloss Shimmer', tags: ['pop', 'emotional'], w: 1.5,
  apply(env, it, amt) {
    const bs = beatState(env, 1.85);
    const k = motionK(env) * amt;
    const t = env.lt || 0;
    it.size *= 1 + (0.042 * bs.hit + 0.016 * Math.sin(t * 4.2)) * k;
    const sc = env.sc;
    const hi = pop(sc);
    const hi2 = pop2(sc);
    pushChar(it, (i, g, n) => {
      const pos = (t * 1.45) % 1.45;
      const u = n > 1 ? i / (n - 1) : 0.5;
      const dist = Math.abs(u - pos + 0.22);
      if (dist < 0.14 && isHex(hi)) {
        const w = 1 - dist / 0.14;
        return { color: w > 0.5 ? hi : (isHex(hi2) ? hi2 : hi), s: 1 + 0.065 * w * k, dy: -it.size * 0.024 * w * k };
      }
      return null;
    });
  },
});

/* =====================================================================
   EXITS (4 — 1 per genre)
   ===================================================================== */

reg('exit', 'mvTrapSmokeOut', {
  name: 'Brume 2AM Dissolve', en: 'Midnight Haze Out', tags: ['emotional', 'calm'], w: 1.45,
  apply(env, it, p) {
    const e = E.inQuad(clamp(p));
    it.y -= it.size * 0.46 * e;
    it.blur = (it.blur || 0) + e * 24;
    it.track = (it.track || 0) + e * 0.28;
    it.alpha = (it.alpha ?? 1) * (1 - e);
  },
});

reg('exit', 'mvRnbSilkFade', {
  name: 'Voile de Soie', en: 'Silk Feather Fade', tags: ['calm', 'emotional', 'editorial'], w: 1.45,
  apply(env, it, p) {
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? (i / (n - 1)) * 0.35 : 0;
      const q = clamp((p - d) / 0.65);
      const e = E.inCubic(q);
      return {
        dy: -e * it.size * 0.38,
        blur: e * 11,
        s: lerp(1, 0.91, e),
        a: 1 - e,
      };
    });
  },
});

reg('exit', 'mvHhCutSnap', {
  name: 'Whip Coupe Sèche', en: 'Street Whip Snap', tags: ['pop', 'glitch', 'graphic'], w: 1.5,
  apply(env, it, p) {
    const q = clamp(p);
    const e = E.inExpo(q);
    const dir = (it.seed | 0) % 2 ? 1 : -1;
    it.x += dir * env.W * 0.44 * e;
    it.sx = (it.sx || 1) * lerp(1, 2.45, e);
    it.streak = q > 0.12 ? { n: 4, dx: -dir * it.size * 0.5 * e, a: 0.35 * (1 - e * 0.6) } : null;
    it.alpha = (it.alpha ?? 1) * (1 - Math.pow(e, 0.8));
  },
});

reg('exit', 'mvPopSparkBurst', {
  name: 'Éclat Pop Confetti', en: 'Pop Spark Exit', tags: ['pop', 'graphic'], w: 1.5,
  apply(env, it, p) {
    const seed = it.seed | 0;
    pushChar(it, (i, g, n) => {
      const d = n > 1 ? J.r(seed, i, 2) * 0.3 : 0;
      const q = clamp((p - d) / 0.7);
      const e = inBack(q, 1.8);
      return {
        s: Math.max(0.01, 1 - Math.abs(e)),
        dy: J.rs(seed, i, 5) * it.size * 0.85 * Math.max(0, q),
        dx: J.rs(seed, i, 6) * it.size * 0.42 * q,
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
  name: 'Kick 808 Lourd', en: '808 Bass Kick Cam', tags: ['emotional', 'glitch', 'pop'], w: 1.55, ae: 'beatPunch',
  get(env) {
    const bs = beatState(env, 1.25), en = songEnergy(env, 0.58), K = motionK(env);
    const punch = bs.hit * (0.65 + 0.55 * en) * K;
    return { s: 1.015 + 0.048 * punch, y: env.H * 0.015 * punch, rot: (bs.idx % 2 ? 0.62 : -0.62) * punch };
  },
});

reg('cam', 'mvCamLateDrive', {
  name: 'Drive Nocturne Cruise', en: 'Midnight Cruise Cam', tags: ['calm', 'emotional'], w: 1.45, ae: 'driftDiag',
  get(env) {
    const bs = beatState(env, 1.2), K = motionK(env);
    const u = clamp(env.lt / Math.max(0.3, env.cut.dur));
    return {
      x: (u - 0.5) * env.W * 0.036 * K,
      y: Math.sin(env.lt * 1.4) * env.H * 0.011 * K,
      s: 1.02 + 0.02 * bs.hit * K,
    };
  },
});

reg('cam', 'mvCamRnbSilkDolly', {
  name: 'Travelling Soie R&B', en: 'R&B Silk Dolly', tags: ['calm', 'emotional', 'editorial'], w: 1.55, ae: 'dollyIn',
  get(env) {
    const bs = beatState(env, 1.3), K = motionK(env);
    const u = E.inOutSine(clamp(env.lt / Math.max(0.3, env.cut.dur)));
    const breathe = 0.5 - 0.5 * Math.cos(bs.phase * TAU);
    return { s: 1.0 + 0.058 * u * K + 0.014 * breathe * K, y: -env.H * 0.009 * u * K };
  },
});

reg('cam', 'mvCamRnbSway', {
  name: 'Balancement Velours', en: 'Velvet Pendulum Sway', tags: ['calm', 'emotional'], w: 1.45, ae: 'handheld',
  get(env) {
    const bs = beatState(env, 1.3), K = motionK(env);
    const ph = ((bs.idx % 2) + bs.phase) * PI;
    return { x: Math.sin(ph) * env.W * 0.015 * K, rot: Math.sin(ph) * 0.95 * K, s: 1.024 };
  },
});

reg('cam', 'mvCamHhBounce', {
  name: 'Bounce Cypher 808', en: 'Hip-Hop Cypher Bounce', tags: ['pop', 'glitch', 'graphic'], w: 1.6, ae: 'beatPunch',
  get(env) {
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.65), K = motionK(env);
    const p = bs.hit * (0.7 + 0.5 * en) * K;
    return { s: 1.012 + 0.056 * p, y: env.H * 0.019 * p, rot: (bs.idx % 2 ? -1 : 1) * 0.92 * p };
  },
});

reg('cam', 'mvCamHhSnapZoom', {
  name: 'Snap Zoom Street', en: 'Street Beat Snap Zoom', tags: ['glitch', 'pop', 'graphic'], w: 1.5, ae: 'stepZoom',
  get(env) {
    const bs = beatState(env, 1.6), K = motionK(env);
    const step = (bs.idx % 3) * 0.026 * K;
    return { s: 1.01 + step + 0.032 * bs.hit * K, rot: ((bs.idx % 2) ? 0.65 : -0.65) * K * 0.5 };
  },
});

reg('cam', 'mvCamPopStageHop', {
  name: 'Hop Scène Live', en: 'Pop Stage Hop', tags: ['pop', 'graphic'], w: 1.55, ae: 'bounce',
  get(env) {
    const bs = beatState(env, 1.9), en = songEnergy(env, 0.65), K = motionK(env);
    const hop = Math.abs(Math.sin(bs.phase * PI)) * K * (0.7 + 0.4 * en);
    return { s: 1.015 + 0.038 * bs.hit * K, y: -env.H * 0.015 * hop, rot: Math.sin(bs.phase * TAU) * 0.72 * K };
  },
});

reg('cam', 'mvCamPopChorusWide', {
  name: 'Refrain Grand Angle', en: 'Chorus Wide Bloom', tags: ['pop', 'emotional'], w: 1.5, ae: 'pullOut',
  get(env) {
    const en = songEnergy(env, 0.62), K = motionK(env);
    const u = E.outCubic(clamp(env.lt / Math.max(0.3, env.cut.dur)));
    return { s: lerp(1.075, 1.0, u) + 0.024 * en * K };
  },
});

/* =====================================================================
   BACKGROUNDS (4 — 1 per genre, song-energy & beat reactive)
   ===================================================================== */

reg('bg', 'mvBg808SubRing', {
  name: 'Ondes Sub-Bass 808', en: '808 Sub-Bass Rings', tags: ['emotional', 'glitch'], w: 1.55,
  plan: rng => ({ rings: rng.int(5, 8), embers: rng.int(8, 14), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.25), en = songEnergy(env, 0.55);
    const c1 = pop(sc), c2 = pop2(sc), cx = W * 0.5, cy = H * 0.5;
    const maxR = Math.hypot(W, H) * 0.54, U = Math.min(W, H);
    ctx.save();
    // Deep nocturnal ambient radial wash
    const g = ctx.createRadialGradient(cx, cy, maxR * 0.04, cx, cy, maxR * 0.88);
    g.addColorStop(0, rgbaCol(c1, 0.16 + 0.14 * bs.hit + 0.09 * en));
    g.addColorStop(0.5, rgbaCol(c2, 0.08 + 0.06 * en));
    g.addColorStop(1, rgbaCol(sc.bg, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Concentric sub-bass shockwaves synced to beat hit
    const n = Q.rings || 6;
    for (let i = 0; i < n; i++) {
      const p = ((t * 0.34 + i / n) % 1);
      const r = maxR * (0.10 + 0.90 * p) * (1 + 0.06 * bs.hit);
      ctx.strokeStyle = rgbaCol(i % 2 ? c1 : c2, (1 - p) * (0.28 + 0.24 * bs.hit));
      ctx.lineWidth = Math.max(1.2, U * (0.002 + 0.0045 * (1 - p)));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, TAU);
      ctx.stroke();
    }
    // Floating 2AM bokeh embers
    const m = Q.embers || 10, seed = Q.seed || 7;
    for (let k = 0; k < m; k++) {
      const bx = (J.r(seed, k, 1) + Math.sin(t * 0.35 + k) * 0.04) * W;
      const by = ((J.r(seed, k, 2) - t * 0.05 + 10) % 1) * H;
      const br = U * (0.012 + 0.022 * J.r(seed, k, 3)) * (1 + 0.25 * bs.hit);
      const bg = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      const col = k % 2 ? c1 : c2;
      bg.addColorStop(0, rgbaCol(col, 0.26 + 0.16 * bs.hit));
      bg.addColorStop(1, rgbaCol(col, 0));
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgRnbSilkWaves', {
  name: 'Vagues de Soie R&B', en: 'R&B Silk Waves', tags: ['calm', 'emotional', 'editorial'], w: 1.55,
  plan: rng => ({ layers: rng.int(4, 6), phase: rng.range(0, 6.28), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const en = songEnergy(env, 0.5), bs = beatState(env, 1.3);
    const c1 = pop(sc), c2 = pop2(sc), U = Math.min(W, H);
    ctx.save();
    // Warm top-corner candle glow
    const cg = ctx.createRadialGradient(W * 0.82, H * 0.18, U * 0.02, W * 0.82, H * 0.18, U * 0.85);
    cg.addColorStop(0, rgbaCol(c1, 0.14 + 0.08 * bs.hit));
    cg.addColorStop(1, rgbaCol(sc.bg, 0));
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, W, H);

    const layers = Q.layers || 5;
    for (let l = 0; l < layers; l++) {
      const yBase = H * (0.30 + 0.52 * (l / Math.max(1, layers - 1)));
      const amp = H * (0.046 + 0.032 * en + 0.016 * bs.hit);
      const pts = [];
      for (let x = 0; x <= W; x += Math.max(20, W / 32)) {
        const y = yBase + Math.sin(x / W * 4.2 + t * (0.85 + l * 0.16) + (Q.phase || 0) + l) * amp;
        pts.push([x, y]);
      }
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.lineTo(W, H);
      ctx.closePath();
      const fillG = ctx.createLinearGradient(0, yBase - amp, 0, H);
      const col = l % 2 ? c1 : c2;
      fillG.addColorStop(0, rgbaCol(col, 0.09 + 0.045 * en));
      fillG.addColorStop(1, rgbaCol(col, 0.01));
      ctx.fillStyle = fillG;
      ctx.fill();
      // Delicate silk specular rim along wave crest
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.strokeStyle = rgbaCol(col, 0.22 + 0.12 * bs.hit);
      ctx.lineWidth = Math.max(1, U * 0.0018);
      ctx.stroke();
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgHhSubGrid', {
  name: 'Spectre Street 808', en: 'Hip-Hop Bass Grid', tags: ['pop', 'glitch', 'graphic'], w: 1.55,
  plan: rng => ({ bars: rng.int(18, 26), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.62);
    const c1 = pop(sc), c2 = pop2(sc), U = Math.min(W, H);
    ctx.save();
    // Subtle perspective grid on lower floor
    const horizonY = H * 0.62;
    ctx.strokeStyle = rgbaCol(c2, 0.09 + 0.07 * bs.hit);
    ctx.lineWidth = Math.max(1, U * 0.0015);
    for (let r = 1; r <= 5; r++) {
      const k = r / 5;
      const y = horizonY + (H - horizonY) * (k * k);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    for (let s = -4; s <= 4; s++) {
      ctx.beginPath();
      ctx.moveTo(W * 0.5 + s * W * 0.05, horizonY);
      ctx.lineTo(W * 0.5 + s * W * 0.26, H);
      ctx.stroke();
    }
    // Crisp street frame outline + corner crosshairs
    const pad = U * 0.045;
    ctx.strokeStyle = rgbaCol(c1, 0.18 + 0.14 * bs.hit);
    ctx.lineWidth = Math.max(1.5, U * 0.0025);
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

    // Symmetrical bass spectrum bars + floating peak-hold caps
    const n = Q.bars || 22, bw = (W - pad * 4) / n;
    for (let i = 0; i < n; i++) {
      const sym = 1 - Math.abs(i / (n - 1) - 0.5) * 1.3;
      const lvl = clamp(0.18 + 0.58 * sym * (0.45 * en + 0.55 * bs.hit) + 0.24 * Math.sin(t * 7.2 + i * 0.9));
      const bh = H * 0.17 * lvl;
      const x = pad * 2 + i * bw + bw * 0.18;
      const barW = bw * 0.64;
      ctx.fillStyle = rgbaCol(i % 3 === 0 ? c2 : c1, 0.16 + 0.18 * bs.hit);
      ctx.fillRect(x, H - pad - bh, barW, bh);
      // floating peak cap
      ctx.fillStyle = rgbaCol(i % 2 ? c1 : c2, 0.52 + 0.25 * bs.hit);
      ctx.fillRect(x, H - pad - bh - U * 0.009, barW, Math.max(2, U * 0.004));
    }
    ctx.restore();
  },
});

reg('bg', 'mvBgPopMirrorLights', {
  name: 'Projecteurs Mirrorball', en: 'Pop Mirrorball Beams', tags: ['pop', 'graphic'], w: 1.55,
  plan: rng => ({ beams: rng.int(6, 9), seed: rng.int(1, 9999) }),
  draw(env, Q) {
    const { ctx, W, H, sc, t } = env;
    const bs = beatState(env, 1.9), en = songEnergy(env, 0.65);
    const c1 = pop(sc), c2 = pop2(sc), U = Math.min(W, H);
    ctx.save();
    const beams = Q.beams || 7;
    const R = Math.hypot(W, H) * 1.1;
    for (let i = 0; i < beams; i++) {
      const topX = W * ((i + 0.5) / beams);
      const ang = PI * 0.5 + Math.sin(t * 1.3 + i * 1.1) * 0.38;
      const spread = 0.068 + 0.032 * bs.hit;
      ctx.beginPath();
      ctx.moveTo(topX, -10);
      ctx.lineTo(topX + Math.cos(ang - spread) * R, Math.sin(ang - spread) * R);
      ctx.lineTo(topX + Math.cos(ang + spread) * R, Math.sin(ang + spread) * R);
      ctx.closePath();
      const grad = ctx.createLinearGradient(topX, 0, topX, H);
      const col = i % 2 ? c1 : c2;
      grad.addColorStop(0, rgbaCol(col, 0.14 + 0.09 * bs.hit + 0.04 * en));
      grad.addColorStop(1, rgbaCol(col, 0));
      ctx.fillStyle = grad;
      ctx.fill();
    }
    // Crisp 4-point stage sparkles
    for (let k = 0; k < 14; k++) {
      const px = J.r(Q.seed || 7, k, 1) * W;
      const py = J.r(Q.seed || 7, k, 2) * H;
      const tw = 0.45 + 0.55 * Math.sin(t * 4.5 + k * 2.1);
      const r = U * (0.011 + 0.014 * bs.hit) * tw;
      drawStarGlint(ctx, px, py, r, k % 2 ? c2 : c1, 0.48 * tw);
    }
    ctx.restore();
  },
});

/* =====================================================================
   POST FX (4 — 1 per genre, properly tagged scratch when sampling S)
   ===================================================================== */

const fxWrap = (k, d) => reg('fx', k, Object.assign({}, d, {
  draw(ctx, ev, k2, I) { ctx.save(); try { d.draw(ctx, ev, clamp(Number.isFinite(k2) ? k2 : 1), I); } finally { ctx.restore(); } },
}));

fxWrap('mvFx808Shock', {
  name: 'Choc Sub-Bass 808', en: '808 Sub Shock', tags: ['emotional', 'glitch', 'pop'], w: 1.45, dur: 4, amp: 1, mid: true, scratch: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I;
    const pulse = Math.sin(PI * k);
    if (S) {
      const dy = pulse * ch * 0.014;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.28 * pulse;
      ctx.drawImage(S, 0, -dy, cw, ch);
      ctx.globalAlpha = 0.18 * pulse;
      ctx.drawImage(S, 0, dy * 0.8, cw, ch);
      ctx.globalCompositeOperation = 'source-over';
    }
    const rad = ctx.createRadialGradient(cw / 2, ch / 2, cw * 0.08, cw / 2, ch / 2, cw * 0.72);
    rad.addColorStop(0, rgbaCol(pop(sc), 0.16 * pulse));
    rad.addColorStop(0.55, rgbaCol(pop2(sc), 0.06 * pulse));
    rad.addColorStop(1, rgbaCol(sc.bg, 0));
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, cw, ch);
  },
});

fxWrap('mvFxRnbWarmBloom', {
  name: 'Halo Soie Chaud', en: 'R&B Warm Bloom', tags: ['calm', 'emotional', 'editorial'], w: 1.45, dur: 5, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I;
    const a = bell(k) * 0.26;
    const g = ctx.createRadialGradient(cw * 0.5, ch * 0.5, cw * 0.04, cw * 0.5, ch * 0.5, cw * 0.66);
    g.addColorStop(0, rgbaCol(pop(sc), a));
    g.addColorStop(0.55, rgbaCol(pop2(sc), a * 0.45));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    // Diagonal silk sheen sweep
    const sweepX = lerp(-cw * 0.25, cw * 1.25, E.inOutSine(k));
    const sw = ctx.createLinearGradient(sweepX - cw * 0.12, 0, sweepX + cw * 0.12, ch);
    sw.addColorStop(0, 'rgba(255,255,255,0)');
    sw.addColorStop(0.5, rgbaCol(pop(sc), 0.14 * bell(k)));
    sw.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sw;
    ctx.fillRect(0, 0, cw, ch);
  },
});

fxWrap('mvFxHhImpactCut', {
  name: 'Flash Impact Street', en: 'Street Impact Flash', tags: ['pop', 'glitch', 'graphic'], w: 1.5, dur: 3, amp: 1, mid: true, scratch: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I;
    const dec = 1 - E.outQuad(k);
    ctx.fillStyle = rgbaCol(pop(sc), dec * 0.22);
    ctx.fillRect(0, 0, cw, ch);
    if (S && k < 0.72) {
      const sh = cw * 0.018 * (1 - k);
      ctx.globalAlpha = 0.36 * (1 - k);
      ctx.drawImage(S, 0, ch * 0.32, cw, ch * 0.34, sh, ch * 0.32, cw, ch * 0.34);
      ctx.drawImage(S, 0, ch * 0.68, cw, ch * 0.16, -sh * 0.7, ch * 0.68, cw, ch * 0.16);
    }
  },
});

fxWrap('mvFxPopSparkFlash', {
  name: 'Éclat Scène Pop', en: 'Pop Stage Spark', tags: ['pop', 'graphic'], w: 1.45, dur: 4, amp: 1, mid: true,
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I;
    const a = bell(k) * 0.26;
    const g = ctx.createLinearGradient(0, 0, cw, ch);
    g.addColorStop(0, rgbaCol(pop(sc), a));
    g.addColorStop(0.5, rgbaCol('#ffffff', a * 0.55));
    g.addColorStop(1, rgbaCol(pop2(sc), a));
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cw, ch);
    // Corner star lens glints
    const r = Math.min(cw, ch) * 0.055 * bell(k);
    drawStarGlint(ctx, cw * 0.18, ch * 0.24, r, '#ffffff', 0.6 * bell(k));
    drawStarGlint(ctx, cw * 0.82, ch * 0.72, r * 0.85, pop(sc), 0.55 * bell(k));
  },
});

/* =====================================================================
   TRANSITIONS (2)
   ===================================================================== */

reg('trans', 'mvTransSilkBlend', {
  name: 'Fondu Soie Nocturne', en: 'Silk Horizon Blend', tags: ['calm', 'emotional', 'editorial'], w: 1.5, dur: 0.44,
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
    // Soft luminous silk ribbon edge
    const lw = Math.max(6, Math.min(cw, ch) * 0.045);
    const g = ctx.createLinearGradient(x - lw, 0, x + lw, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.5, rgbaCol(pop(sc), bell(p) * 0.78));
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - lw, 0, lw * 2, ch);
  },
});

reg('trans', 'mvTransPopFlashWipe', {
  name: 'Coupe Flash Rythmée', en: 'Beat Flash Wipe', tags: ['pop', 'glitch', 'graphic'], w: 1.5, dur: 0.34,
  plan: rng => ({ dir: rng.pick([1, -1]) }),
  draw(ctx, A, B, p, I, P) {
    const { cw, ch, sc } = I, e = E.inOutExpo(p), d = (P && P.dir) || 1;
    ctx.drawImage(A, 0, 0);
    const band = Math.min(cw, ch) * 0.068 * bell(p);
    const sl = ch * 0.25 * d;
    const x = lerp(-Math.abs(sl) - band, cw + Math.abs(sl) + band, e);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(-cw, 0); ctx.lineTo(x - sl * 0.5, 0); ctx.lineTo(x + sl * 0.5, ch); ctx.lineTo(-cw, ch); ctx.closePath();
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    // Dual chromatic prism ribbon
    ctx.fillStyle = pop(sc);
    ctx.globalAlpha = 0.85 * bell(p);
    ctx.beginPath();
    ctx.moveTo(x - sl * 0.5, 0); ctx.lineTo(x - sl * 0.5 + band, 0);
    ctx.lineTo(x + sl * 0.5 + band, ch); ctx.lineTo(x + sl * 0.5, ch);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = pop2(sc);
    ctx.globalAlpha = 0.55 * bell(p);
    ctx.beginPath();
    ctx.moveTo(x - sl * 0.5 - band * 0.45, 0); ctx.lineTo(x - sl * 0.5, 0);
    ctx.lineTo(x + sl * 0.5, ch); ctx.lineTo(x + sl * 0.5 - band * 0.45, ch);
    ctx.closePath();
    ctx.fill();
  },
});

/* =====================================================================
   TREATMENTS (2) & DECOR (2)
   ===================================================================== */

reg('treat', 'mvTreatRnbAura', {
  name: 'Aura Velours Soie', en: 'Velvet Aura Glow', tags: ['calm', 'emotional', 'pop'], w: 1.5,
  apply(env, it) {
    const bs = beatState(env, 1.3);
    const ac = pop(env.sc);
    const ac2 = pop2(env.sc);
    if (!it.shadow) {
      it.shadow = { color: rgbaCol(ac, 0.56 + 0.26 * bs.hit), blur: it.size * 0.24, dx: 0, dy: it.size * 0.045 };
    }
    if (env.sc.fg && isHex(ac)) {
      it.gradient = it.gradient || [env.sc.fg, ac];
    }
    addPost(it, (e, x, bb) => {
      if (!bb || e.pass !== 'main') return;
      const g = e.ctx.createLinearGradient(bb.x0, bb.y1 + it.size * 0.08, bb.x1, bb.y1 + it.size * 0.08);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.5, rgbaCol(ac2 || ac, 0.35 + 0.25 * bs.hit));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      e.ctx.save();
      e.ctx.fillStyle = g;
      e.ctx.fillRect(bb.x0, bb.y1 + it.size * 0.06, Math.max(8, bb.x1 - bb.x0), Math.max(1.5, it.size * 0.032));
      e.ctx.restore();
    });
  },
});

reg('treat', 'mvTreatHhChrome', {
  name: 'Chrome Impact Scène', en: 'Stage Chrome Impact', tags: ['pop', 'graphic', 'glitch'], w: 1.5,
  apply(env, it) {
    const ac = pop(env.sc), ac2 = pop2(env.sc);
    const cTop = isHex(env.sc.fg) ? env.sc.fg : '#ffffff';
    const cMid = isHex(ac) ? ac : '#e2e8f0';
    const cBot = isHex(ac2) ? ac2 : cTop;
    if (!it.gradient) {
      it.gradient = [[0, cTop], [0.48, cMid], [1, cBot]];
    }
    if (!it.shadow) {
      it.shadow = { color: rgbaCol(cMid, 0.48), blur: 0, dx: it.size * 0.045, dy: it.size * 0.045 };
    }
    if (!it.extrude) {
      it.extrude = { n: 4, dx: it.size * 0.032, dy: it.size * 0.032, color: rgbaCol(cBot, 0.32), fade: true };
    }
  },
});

reg('decor', 'mvDecoHhBars', {
  name: 'Barres 808 Live', en: 'Live 808 Meter Bars', tags: ['pop', 'glitch', 'graphic'], w: 1.55,
  plan: rng => ({ bars: rng.int(5, 7) }),
  draw(env, bb, Q) {
    if (!bb) return;
    const { ctx, sc, t } = env;
    const bs = beatState(env, 1.55), en = songEnergy(env, 0.6);
    const ac = pop(sc), ac2 = pop2(sc), n = (Q && Q.bars) || 6;
    const U = Math.min(env.W, env.H);
    const w = Math.max(3, U * 0.0052);
    const cy = (bb.y0 + bb.y1) * 0.5;
    ctx.save();
    for (let i = 0; i < n; i++) {
      const h = (12 + 28 * clamp(0.32 + 0.48 * bs.hit + 0.35 * en + 0.25 * Math.sin(t * 8.2 + i * 1.1)));
      const lx = bb.x0 - (n - i) * (w * 2.15) - 10;
      const rx = bb.x1 + i * (w * 2.15) + 10;
      ctx.fillStyle = rgbaCol(ac, 0.72);
      ctx.fillRect(lx, cy - h * 0.5, w, h);
      ctx.fillRect(rx, cy - h * 0.5, w, h);
      // Floating crisp peak caps
      ctx.fillStyle = rgbaCol(ac2, 0.85);
      ctx.fillRect(lx, cy - h * 0.5 - 4, w, 2.2);
      ctx.fillRect(rx, cy - h * 0.5 - 4, w, 2.2);
    }
    ctx.restore();
  },
});

reg('decor', 'mvDecoPopSparks', {
  name: 'Étoiles & Lueur Pop', en: 'Pop Stage Sparks', tags: ['pop', 'emotional'], w: 1.55,
  plan: rng => ({ seed: rng.int(1, 9999) }),
  draw(env, bb, Q) {
    if (!bb) return;
    const { ctx, sc, t } = env;
    const bs = beatState(env, 1.9);
    const c1 = pop(sc), c2 = pop2(sc);
    const pts = [
      [bb.x0 - 20, bb.y0 - 12],
      [bb.x1 + 20, bb.y0 - 10],
      [bb.x0 - 16, bb.y1 + 12],
      [bb.x1 + 18, bb.y1 + 14],
    ];
    ctx.save();
    pts.forEach(([px, py], i) => {
      const r = (9 + 9 * bs.hit) * (0.65 + 0.35 * Math.sin(t * 5 + i + (Q.seed || 1)));
      drawStarGlint(ctx, px, py, r, i % 2 ? c1 : c2, 0.84);
      drawStarGlint(ctx, px, py, r * 0.45, '#ffffff', 0.55);
    });
    ctx.restore();
  },
});
})();
