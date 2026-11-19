/* JIZURA pack: x2art3d — Bauhaus Kinetic, Pop Art Comic Halftone, 3D Isometric Depth & Compositing Framing visuals (bg, treat, fx, trans, decor) */
(() => {
'use strict';
const E = J.E;
const P = 'x2art3d';
const DEG = J.DEG, TAU = J.TAU, clamp = J.clamp, lerp = J.lerp;

/* ---------------- shared helpers ---------------- */
const rgbaCol = (c, a) => J.rgba(c, Math.round(clamp(a) * 1000) / 1000);
const Umin = env => Math.min(env.W, env.H);
const pop = sc => [sc.accent, sc.accent2, sc.fg].find(c => c && J.contrast(c, sc.bg) > 1.45) || sc.fg;
const pop2 = sc => [sc.accent2, sc.ghostA, sc.ghostB, sc.fg].find(c => c && c !== pop(sc) && J.contrast(c, sc.bg) > 1.35) || sc.fg;
const bell = k => Math.sin(Math.PI * clamp(k));
const inOut = env => E.outCubic(clamp(env.lt / 0.34)) * (1 - E.inCubic(env.pOut));
const bgWrap = (k, d) => J.register('bg', k, Object.assign({}, d, {
  draw(env, Q) { const ctx = env.ctx; ctx.save(); try { d.draw(env, Q || {}, ctx); } finally { ctx.restore(); } },
}), P);
const fxWrap = (k, d) => J.register('fx', k, Object.assign({}, d, {
  draw(ctx, ev, k2, I) { ctx.save(); try { d.draw(ctx, ev, clamp(Number.isFinite(k2) ? k2 : 1), I); } finally { ctx.restore(); } },
}), P);
const decorWrap = (k, d) => J.register('decor', k, Object.assign({}, d, {
  draw(env, bb, Q) { const ctx = env.ctx; ctx.save(); try { d.draw(env, bb, Q || {}, ctx); } finally { ctx.restore(); } },
}), P);
const addPre = (it, f) => { const p = it.pre; it.pre = p ? (e, i) => { p(e, i); f(e, i); } : f; };
const addPost = (it, f) => { const p = it.post; it.post = p ? (e, i, b) => { p(e, i, b); f(e, i, b); } : f; };
const bare = (i, extra) => Object.assign({}, i, {
  pre: null, post: null, echo: null, streak: null, shadow: null, extrude: null, pattern: null, patternBg: null,
  gradient: null, pieceFn: null, strokeDash: null, strokeUnder: false, wipeBar: null, cursorAt: null,
  bands: null, vbands: null, clip: null, clipY: null, clipFn: null, blend: null, _lay: null,
}, extra || {});
const alive = it => it.fill !== false && (it.alpha ?? 1) >= 0.15 && !!it.text && it.size > 1;
const tracing = i => i.dash != null && i.dash < 1;

function drawHatchSquare(ctx, x, y, sz, col, lw, step) {
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, sz, sz); ctx.clip();
  ctx.strokeStyle = col; ctx.lineWidth = lw;
  ctx.beginPath();
  for (let d = -sz; d <= sz * 2; d += step) {
    ctx.moveTo(x + d, y);
    ctx.lineTo(x + d - sz, y + sz);
  }
  ctx.stroke();
  ctx.restore();
}

function drawStarburstPoly(ctx, cx, cy, outerR, innerR, spikes, rot) {
  ctx.beginPath();
  const step = Math.PI / spikes;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = i * step + rot;
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

/* ================================================================
   BACKGROUNDS (8)
   ================================================================ */

/* 1. 3D Isometric Wireframe & Shaded Prisms drifting across the viewport */
bgWrap('amBgIsoPrism', {
  name: '3D等角キューブ空間', en: '3D Iso Wireframe Prisms', tags: ['graphic', 'pop', 'glitch'], w: 1.35,
  plan: rng => ({ seed: rng.int(1, 1e9), n: rng.int(8, 12), speed: rng.range(0.18, 0.34), k: rng.range(0.16, 0.24) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, s = Q.seed || 1, n = Q.n || 9, U = Umin(env), k = Q.k || 0.18;
    const c1 = pop(sc), c2 = pop2(sc);
    const iso = 0.8660254;
    // subtle diagonal isometric baseline lattice
    const gridSp = Math.max(48, U * 0.14);
    ctx.strokeStyle = rgbaCol(sc.fg, 0.05);
    ctx.lineWidth = Math.max(1, U * 0.0016);
    ctx.beginPath();
    const driftX = (t * 14) % gridSp;
    for (let x = -H * 1.75 + driftX; x < W + H * 1.75; x += gridSp) {
      ctx.moveTo(x, 0); ctx.lineTo(x + H * 1.732, H);
      ctx.moveTo(x + H * 1.732, 0); ctx.lineTo(x, H);
    }
    ctx.stroke();

    for (let i = 0; i < n; i++) {
      const sz = U * (0.068 + 0.085 * J.r(s, i, 1));
      const px = ((J.r(s, i, 2) * 1.35 - 0.18 + t * (Q.speed || 0.24) * (0.04 + 0.05 * J.r(s, i, 3)) * (i % 2 ? 1 : -1)) % 1.3 + 1.3) % 1.3 - 0.15;
      const py = J.r(s, i, 4) * 0.84 + 0.08 + Math.sin(t * (0.85 + 0.45 * J.r(s, i, 5)) + i) * 0.035;
      const cx = px * W, cy = py * H;
      const bob = 1 + 0.11 * Math.sin(t * 1.7 + i * 1.3);
      const r = sz * bob;
      const dx = r * iso, dy = r * 0.5;
      // translucent top & side facets
      ctx.fillStyle = rgbaCol(i % 2 ? c1 : c2, k * 0.45);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + dx, cy - dy); ctx.lineTo(cx, cy); ctx.lineTo(cx - dx, cy - dy); ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgbaCol(sc.fg, k * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - dx, cy + dy); ctx.closePath();
      ctx.fill();
      // crisp 3D wireframe silhouette
      ctx.strokeStyle = rgbaCol(i % 2 ? c2 : c1, Math.min(0.65, k * 1.75));
      ctx.lineWidth = Math.max(1.2, U * 0.0026);
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - dx, cy + dy); ctx.lineTo(cx - dx, cy - dy); ctx.closePath();
      ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx, cy - dy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + r);
      ctx.stroke();
      // glowing inner wireframe vertex node
      ctx.fillStyle = rgbaCol(sc.fg, 0.35);
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(1.5, U * 0.0038), 0, TAU); ctx.fill();
    }
  },
});

/* 1b. Deep 3D Isometric Wireframe Spatial Lattice */
bgWrap('amBgIsoLattice', {
  name: '3D空間ワイヤーフレーム深度', en: '3D Wireframe Depth Lattice', tags: ['graphic', 'glitch', 'editorial'], w: 1.25,
  plan: rng => ({ seed: rng.int(1, 1e9), tilt: rng.range(-12, 12) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const rot = ((Q.tilt || 0) + Math.sin(t * 0.35) * 4) * DEG;
    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    ctx.rotate(rot);
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      const p = ((l / layers) + t * 0.12) % 1;
      const scf = 0.28 + p * 1.15;
      const alpha = Math.sin(Math.PI * p) * 0.24;
      const rw = W * 0.54 * scf, rh = H * 0.54 * scf;
      ctx.strokeStyle = rgbaCol(l % 2 ? c1 : c2, alpha);
      ctx.lineWidth = Math.max(1.1, U * 0.0022);
      ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
      // perspective corner tethers
      const off = U * 0.055 * scf;
      ctx.strokeStyle = rgbaCol(sc.fg, alpha * 0.72);
      ctx.beginPath();
      ctx.rect(-rw / 2 + off, -rh / 2 - off, rw, rh);
      ctx.moveTo(-rw / 2, -rh / 2); ctx.lineTo(-rw / 2 + off, -rh / 2 - off);
      ctx.moveTo(rw / 2, -rh / 2); ctx.lineTo(rw / 2 + off, -rh / 2 - off);
      ctx.moveTo(-rw / 2, rh / 2); ctx.lineTo(-rw / 2 + off, rh / 2 - off);
      ctx.moveTo(rw / 2, rh / 2); ctx.lineTo(rw / 2 + off, rh / 2 - off);
      ctx.stroke();
    }
    ctx.restore();
  },
});

/* 2. Pop Art Ben-Day Comic Matrix + Radial Comic Flash */
bgWrap('amBgPopBenDay', {
  name: 'ポップ網点コミック', en: 'Pop Art Ben-Day', tags: ['pop', 'graphic'], w: 1.35,
  plan: rng => ({ seed: rng.int(1, 1e9), angle: rng.pick([-16, -10, 12, 18]), burst: rng.chance(0.85) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    if (Q.burst !== false) {
      const rays = 20, R = Math.hypot(W, H), rot = t * 0.14;
      ctx.save(); ctx.translate(W * 0.5, H * 0.5); ctx.rotate(rot);
      ctx.fillStyle = rgbaCol(c2, 0.09);
      for (let i = 0; i < rays; i += 2) {
        const a0 = (i / rays) * TAU, a1 = ((i + 0.68) / rays) * TAU;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    const step = Math.max(22, U * 0.046), diag = Math.hypot(W, H);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate((Q.angle || 14) * DEG);
    const cols = Math.ceil(diag / step) + 2;
    for (let j = -cols; j <= cols; j++) {
      for (let i = -cols; i <= cols; i++) {
        const x = (i + (j % 2 ? 0.5 : 0)) * step, y = j * step * 0.866;
        const wave = 0.5 + 0.5 * Math.sin((i * 0.36 + j * 0.24) - t * 2.2);
        const rad = step * (0.09 + 0.23 * wave);
        ctx.fillStyle = (i + j) % 3 === 0 ? rgbaCol(c1, 0.18) : rgbaCol(sc.fg, 0.09);
        ctx.beginPath(); ctx.arc(x, y, rad, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  },
});

/* 2b. Pop Art Split Comic Panels with Gutters & Starburst Halo */
bgWrap('amBgComicPanels', {
  name: 'コミック分割パネル', en: 'Pop Comic Panels', tags: ['pop', 'graphic'], w: 1.25,
  plan: rng => ({ seed: rng.int(1, 1e9), tilt: rng.pick([-6, -4, 4, 6]) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const drift = Math.sin(t * 0.8) * U * 0.025;
    const tilt = (Q.tilt || -5) * DEG;
    ctx.save();
    // four dynamic comic panels separated by bold angled gutters
    ctx.fillStyle = rgbaCol(c1, 0.10);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W * 0.52 + drift, 0); ctx.lineTo(W * 0.45 - drift, H * 0.52); ctx.lineTo(0, H * 0.48 + drift); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbaCol(c2, 0.11);
    ctx.beginPath(); ctx.moveTo(W * 0.52 + drift, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H * 0.55 - drift); ctx.lineTo(W * 0.45 - drift, H * 0.52); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbaCol(sc.fg, 0.06);
    ctx.beginPath(); ctx.moveTo(0, H * 0.48 + drift); ctx.lineTo(W * 0.45 - drift, H * 0.52); ctx.lineTo(W * 0.54 + drift, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    // halftone dot overlay on diagonal corners
    const step = Math.max(20, U * 0.04);
    ctx.fillStyle = rgbaCol(sc.fg, 0.11);
    ctx.beginPath();
    for (let x = step; x < W; x += step) {
      for (let y = step; y < H; y += step) {
        const edge = Math.max(Math.abs(x / W - 0.5), Math.abs(y / H - 0.5)) * 2;
        if (edge < 0.55) continue;
        const r = step * 0.24 * (edge - 0.45);
        ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU);
      }
    }
    ctx.fill();
    // bold black/ink comic divider crossbars
    ctx.strokeStyle = rgbaCol(sc.ink || sc.fg, 0.36);
    ctx.lineWidth = Math.max(3, U * 0.008);
    ctx.beginPath();
    ctx.moveTo(W * 0.52 + drift, -10); ctx.lineTo(W * 0.44 - drift, H + 10);
    ctx.moveTo(-10, H * 0.47 + drift); ctx.lineTo(W + 10, H * 0.54 - drift);
    ctx.stroke();
    // subtle rotating central burst frame behind text
    ctx.save(); ctx.translate(W * 0.5, H * 0.5); ctx.rotate(tilt + Math.sin(t * 1.1) * 0.05);
    ctx.strokeStyle = rgbaCol(c1, 0.22); ctx.lineWidth = Math.max(2, U * 0.004);
    drawStarburstPoly(ctx, 0, 0, U * 0.42, U * 0.31, 14, 0);
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  },
});

/* 3. Bauhaus Kinetic Geometry — circles, arches, hatched squares & triangles */
bgWrap('amBgBauhausGeo', {
  name: 'バウハウス幾何動態', en: 'Bauhaus Kinetic', tags: ['graphic', 'pop', 'editorial'], w: 1.35,
  plan: rng => ({ seed: rng.int(1, 1e9), phase: rng.range(0, TAU) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), ph = Q.phase || 0;
    const slide = Math.sin(t * 0.72 + ph), sway = Math.cos(t * 0.55 + ph);
    // crisp hairline Swiss margin frame
    const pad = U * 0.055;
    ctx.strokeStyle = rgbaCol(sc.fg, 0.14);
    ctx.lineWidth = Math.max(1.2, U * 0.0022);
    ctx.strokeRect(pad, pad, W - pad * 2, H - pad * 2);

    // left lower half-disc + red/primary quadrant arch (like top-left of reference image)
    ctx.fillStyle = rgbaCol(c1, 0.17);
    ctx.beginPath(); ctx.arc(W * (0.12 + 0.03 * slide), H * 0.82, U * 0.24, 0, TAU); ctx.fill();
    // diagonal hatched square overlapping circle
    drawHatchSquare(ctx, W * 0.10, H * (0.62 + 0.02 * sway), U * 0.16, rgbaCol(c2, 0.26), Math.max(1.5, U * 0.003), Math.max(7, U * 0.015));

    // top-right split semi-circle (cobalt / red duality)
    const rx = W * (0.84 - 0.03 * slide), ry = H * 0.24, rr = U * 0.17;
    ctx.fillStyle = rgbaCol(c1, 0.19);
    ctx.beginPath(); ctx.arc(rx, ry, rr, Math.PI * 0.5, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.fillStyle = rgbaCol(c2, 0.19);
    ctx.beginPath(); ctx.arc(rx, ry, rr, -Math.PI * 0.5, Math.PI * 0.5); ctx.closePath(); ctx.fill();

    // top-left dual circles + orbiting dot
    ctx.fillStyle = rgbaCol(c2, 0.18);
    ctx.beginPath(); ctx.arc(W * 0.13, H * 0.24, U * 0.09, 0, TAU); ctx.fill();
    ctx.fillStyle = rgbaCol(c1, 0.22);
    ctx.beginPath(); ctx.arc(W * 0.19, H * (0.18 + 0.02 * sway), U * 0.065, 0, TAU); ctx.fill();

    // Swiss kinetic horizontal crossbars
    ctx.fillStyle = rgbaCol(c1, 0.20);
    const barH = Math.max(4, U * 0.012);
    ctx.fillRect(W * 0.54, H * (0.17 + 0.025 * sway), W * 0.18, barH);
    ctx.fillRect(W * 0.56, H * (0.82 - 0.025 * slide), W * 0.22, barH);
    ctx.fillStyle = rgbaCol(c2, 0.22);
    ctx.fillRect(W * 0.14, H * 0.78, W * 0.16, Math.max(2, barH * 0.4));

    // rotating Bauhaus right triangle near lower-right corner
    ctx.save(); ctx.translate(W * 0.85, H * 0.78); ctx.rotate(t * 0.28 + ph);
    const tr = U * 0.11;
    ctx.fillStyle = rgbaCol(c2, 0.18);
    ctx.beginPath();
    ctx.moveTo(-tr * 0.7, tr * 0.7); ctx.lineTo(tr * 0.85, tr * 0.7); ctx.lineTo(-tr * 0.7, -tr * 0.85); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgbaCol(sc.fg, 0.22); ctx.lineWidth = Math.max(1.5, U * 0.003); ctx.stroke();
    ctx.restore();
  },
});

/* 3b. Swiss Modular Bauhaus Grid */
bgWrap('amBgBauhausGrid', {
  name: 'バウハウス格子モジュール', en: 'Bauhaus Modular Grid', tags: ['graphic', 'editorial'], w: 1.2,
  plan: rng => ({ seed: rng.int(1, 1e9), cols: rng.pick([4, 5, 6]) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), n = Q.cols || 5;
    const cw = W / n, ch = H / 4;
    ctx.strokeStyle = rgbaCol(sc.sub, 0.12); ctx.lineWidth = Math.max(1, U * 0.0018);
    for (let i = 1; i < n; i++) { ctx.beginPath(); ctx.moveTo(i * cw, 0); ctx.lineTo(i * cw, H); ctx.stroke(); }
    for (let j = 1; j < 4; j++) { ctx.beginPath(); ctx.moveTo(0, j * ch); ctx.lineTo(W, j * ch); ctx.stroke(); }
    // smoothly sliding primary blocks aligned to grid cells
    const shift = Math.sin(t * 0.6) * cw * 0.35;
    ctx.fillStyle = rgbaCol(c1, 0.14);
    ctx.fillRect(cw * 0.5 + shift, ch * 0.5, cw * 1.1, ch * 0.45);
    ctx.fillStyle = rgbaCol(c2, 0.14);
    ctx.fillRect(W - cw * 1.6 - shift, ch * 2.9, cw * 1.1, ch * 0.45);
  },
});

/* 4. Op-Art Kinetic Moire Waves */
bgWrap('amBgOpMoire', {
  name: 'オプアート波紋', en: 'Op-Art Moire', tags: ['graphic', 'glitch', 'pop'], w: 1.1,
  plan: rng => ({ rings: rng.int(11, 16), spread: rng.range(0.08, 0.16) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const d = Math.sin(t * 0.95) * W * (Q.spread || 0.12), dy = Math.cos(t * 0.7) * H * 0.06;
    const n = Q.rings || 13, maxR = U * 0.78;
    ctx.lineWidth = Math.max(1.5, U * 0.0045);
    for (let set = 0; set < 2; set++) {
      const cx = W * 0.5 + (set ? d : -d), cy = H * 0.5 + (set ? -dy : dy);
      ctx.strokeStyle = rgbaCol(set ? c2 : c1, 0.16);
      ctx.beginPath();
      for (let i = 1; i <= n; i++) {
        const r = (i / n) * maxR;
        ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU);
      }
      ctx.stroke();
    }
  },
});

/* 5. Compositing & Keep-Centre-Free Studio Framing backdrop */
bgWrap('amBgCompositingStudio', {
  name: 'スタジオ切り抜き枠', en: 'Compositing Studio Frame', tags: ['editorial', 'graphic', 'calm'], w: 1.35,
  plan: rng => ({ mode: rng.pick(['centreFree', 'dualSplit', 'perimeter']), pulse: rng.range(0.02, 0.06) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const m = U * 0.045, tick = U * 0.032;
    const breathe = 1 + Math.sin(t * 1.4) * (Q.pulse || 0.03);

    // architectural perimeter guide lines & side lighting columns (leaving the central artist area open)
    ctx.strokeStyle = rgbaCol(sc.fg, 0.18);
    ctx.lineWidth = Math.max(1.4, U * 0.0024);
    ctx.beginPath();
    // 4 studio viewfinder corners
    ctx.moveTo(m, m + tick); ctx.lineTo(m, m); ctx.lineTo(m + tick, m);
    ctx.moveTo(W - m - tick, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + tick);
    ctx.moveTo(m, H - m - tick); ctx.lineTo(m, H - m); ctx.lineTo(m + tick, H - m);
    ctx.moveTo(W - m - tick, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - tick);
    ctx.stroke();

    if (Q.mode === 'dualSplit') {
      // side-by-side split hairline and matte luminance contrast tint
      ctx.fillStyle = rgbaCol(c1, 0.06);
      ctx.fillRect(W * 0.5, 0, W * 0.5, H);
      ctx.strokeStyle = rgbaCol(c2, 0.34);
      ctx.lineWidth = Math.max(2, U * 0.003);
      ctx.beginPath(); ctx.moveTo(W * 0.5, m); ctx.lineTo(W * 0.5, H - m); ctx.stroke();
    } else {
      // subtle keep-centre-free soft radial halo separating left/right lyric zones from central talent zone
      const g = ctx.createRadialGradient(W * 0.5, H * 0.5, U * 0.14 * breathe, W * 0.5, H * 0.5, U * 0.44 * breathe);
      g.addColorStop(0, rgbaCol(sc.fg, 0.04));
      g.addColorStop(0.65, rgbaCol(c1, 0.05));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // delicate vertical boundary framing guides
      ctx.setLineDash([U * 0.012, U * 0.012]);
      ctx.strokeStyle = rgbaCol(c1, 0.22);
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.52, U * 0.27 * breathe, -0.35 * Math.PI, 0.35 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.52, U * 0.27 * breathe, 0.65 * Math.PI, 1.35 * Math.PI);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },
});

/* ================================================================
   TEXT TREATMENTS (8)
   ================================================================ */

/* 1. 3D Anaglyph Stereoscopic Layers — crisp Cyan/Red 3D parallax extrusion */
J.register('treat', 'amTreat3DAnaglyph', {
  name: '3Dアナグリフ立体', en: '3D Anaglyph', tags: ['pop', 'glitch', 'graphic'], w: 1.35,
  plan: rng => ({ depth: rng.range(0.055, 0.095), ang: rng.pick([28, 35, 145]) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc;
    const cL = sc.ghostA && J.contrast(sc.ghostA, sc.bg) > 1.25 ? sc.ghostA : '#00F0FF';
    const cR = sc.ghostB && J.contrast(sc.ghostB, sc.bg) > 1.25 ? sc.ghostB : '#FF246B';
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const off = Math.max(2, i.size * (Pt.depth || 0.07) * (1 + 0.22 * Math.sin(e.t * 3.8)));
      const a = (Pt.ang || 32) * DEG, dx = Math.cos(a) * off, dy = Math.sin(a) * off;
      const colMain = i.color || sc.fg;
      for (let s = 2; s >= 1; s--) {
        const t = s / 2;
        J.drawItem(e, bare(i, { x: i.x - dx * t, y: i.y - dy * t, color: cL, strokeColor: cL, alpha: (i.alpha ?? 1) * 0.72 }));
        J.drawItem(e, bare(i, { x: i.x + dx * t, y: i.y + dy * t, color: cR, strokeColor: cR, alpha: (i.alpha ?? 1) * 0.72 }));
      }
      i.color = colMain;
    });
  },
}, P);

/* 1b. 3D Isometric Stepped Wireframe Extrusion */
J.register('treat', 'amTreatIsoDepth', {
  name: '3D等角押出し立体', en: '3D Iso Wire Extrude', tags: ['graphic', 'pop', 'editorial'], w: 1.3,
  plan: rng => ({ steps: rng.int(4, 6), ang: rng.pick([30, 150]) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, wire = pop(sc), shade = pop2(sc);
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const steps = Pt.steps || 5, a = (Pt.ang || 30) * DEG;
      const stepD = Math.max(1.5, i.size * 0.024);
      const dx = Math.cos(a) * stepD, dy = Math.sin(a) * stepD;
      for (let s = steps; s >= 1; s--) {
        const al = (i.alpha ?? 1) * lerp(0.18, 0.55, 1 - s / steps);
        J.drawItem(e, bare(i, {
          x: i.x + dx * s, y: i.y + dy * s,
          fill: s === steps ? false : undefined,
          color: s === 1 ? wire : shade,
          strokeColor: s === steps ? wire : shade,
          stroke: Math.max(1, i.size * 0.022),
          alpha: al,
        }));
      }
    });
  },
}, P);

/* 2. Pop Art 4-Plate CMYK Print Registration Offset */
J.register('treat', 'amTreatPopCMYK', {
  name: 'ポップCMYK版ズレ', en: 'Pop Art CMYK', tags: ['pop', 'graphic'], w: 1.3,
  plan: rng => ({ shift: rng.range(0.045, 0.08) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc;
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const d = Math.max(2, i.size * (Pt.shift || 0.06));
      const al = (i.alpha ?? 1) * 0.85;
      J.drawItem(e, bare(i, { x: i.x - d, y: i.y + d * 0.65, color: '#00D8FF', strokeColor: '#00D8FF', alpha: al }));
      J.drawItem(e, bare(i, { x: i.x + d * 0.85, y: i.y - d * 0.55, color: '#FF1493', strokeColor: '#FF1493', alpha: al }));
      J.drawItem(e, bare(i, { x: i.x + d * 0.25, y: i.y + d * 1.1, color: '#FFE600', strokeColor: '#FFE600', alpha: al }));
    });
    if (!it.strokeColor) {
      it.strokeColor = J.lum(sc.bg) < 0.4 ? '#08080A' : '#111116';
      it.stroke = Math.max(1.6, it.size * 0.032);
    }
  },
}, P);

/* 2b. Pop Art Comic Starburst & Bold Ink Outline */
J.register('treat', 'amTreatPopStarburst', {
  name: 'コミック爆裂囲み', en: 'Pop Comic Burst', tags: ['pop', 'graphic'], w: 1.25,
  plan: rng => ({ spikes: rng.int(12, 16) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, burstCol = pop(sc), rimCol = sc.ink || '#111111';
    if (!it.strokeColor) {
      it.strokeColor = rimCol;
      it.stroke = Math.max(2, it.size * 0.042);
    }
    addPre(it, (e, i) => {
      if (tracing(i) || i.pass !== 'main') return;
      const pulse = 1 + 0.04 * Math.sin(e.t * 6 + (i.mi || 0));
      const rx = Math.max(i.size * 1.4, (i.w || i.size * 2.6) * 0.62) * pulse;
      const ry = i.size * 0.92 * pulse;
      e.ctx.save();
      e.ctx.translate(i.x, i.y);
      e.ctx.globalAlpha = (i.alpha ?? 1) * 0.22;
      e.ctx.fillStyle = burstCol;
      drawStarburstPoly(e.ctx, 0, 0, Math.max(rx, ry), Math.min(rx, ry) * 0.68, Pt.spikes || 14, (i.mi || 0) * 0.3);
      e.ctx.fill();
      e.ctx.restore();
      J.drawItem(e, bare(i, { x: i.x + i.size * 0.06, y: i.y + i.size * 0.06, color: rimCol, strokeColor: rimCol, alpha: (i.alpha ?? 1) * 0.85 }));
    });
  },
}, P);

/* 3. Kinetic Velocity Slice — horizontal kinetic shear pulse per glyph */
J.register('treat', 'amTreatKineticSlice', {
  name: 'キネティック・スライス', en: 'Kinetic Slice', tags: ['graphic', 'glitch', 'pop'], w: 1.2,
  plan: rng => ({ amt: rng.range(0.18, 0.34) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, alt = pop(sc);
    it.charFns.push((gi, g, N) => {
      const wave = Math.sin(env.lt * 6.5 + gi * 0.9);
      const kick = Math.max(0, 1 - env.lt * 2.5);
      const dx = (gi % 2 ? 1 : -1) * it.size * (Pt.amt || 0.24) * (kick + 0.14 * wave);
      return {
        dx,
        rot: wave * 3.2 * kick,
        color: gi % 4 === 0 && J.contrast(alt, sc.bg) > 1.8 ? alt : undefined,
      };
    });
  },
}, P);

/* 3b. Bauhaus Architectural Offset Block & Precision Rule */
J.register('treat', 'amTreatBauhausBlock', {
  name: 'バウハウス建築ブロック', en: 'Bauhaus Architectural Block', tags: ['graphic', 'editorial'], w: 1.25,
  plan: rng => ({ bar: rng.chance(0.85) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, c1 = pop(sc), c2 = pop2(sc);
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const off = Math.max(2, i.size * 0.055);
      J.drawItem(e, bare(i, { x: i.x + off, y: i.y + off, color: c1, strokeColor: c1, alpha: (i.alpha ?? 1) * 0.45 }));
      if (Pt.bar && i.pass === 'main') {
        const w = (i.w || i.size * 2.2) * 1.04;
        const barH = Math.max(3, i.size * 0.11);
        e.ctx.save();
        e.ctx.globalAlpha = (i.alpha ?? 1) * 0.85;
        e.ctx.fillStyle = (i.mi || 0) % 2 ? c2 : c1;
        e.ctx.fillRect(i.x - w * 0.5, i.y + i.size * 0.52, w, barH);
        e.ctx.restore();
      }
    });
  },
}, P);

/* 4. Glitch Prism Chromatic Fracture */
J.register('treat', 'amTreatGlitchPrism', {
  name: 'グリッチ・プリズム', en: 'Glitch Prism', tags: ['glitch', 'graphic'], w: 1.2,
  plan: rng => ({ bands: rng.int(3, 6) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, cA = sc.ghostA || '#00F5D4', cB = sc.ghostB || '#FF2A85';
    addPost(it, (e, i) => {
      if (e.pass !== 'main' || tracing(i)) return;
      const pulse = Math.sin(e.t * 14 + (i.mi || 0) * 3.1);
      if (Math.abs(pulse) < 0.45) return;
      const off = Math.max(2, i.size * 0.09) * Math.sign(pulse);
      const hh = i.size * 1.4, n = Pt.bands || 4, bh = hh / n;
      for (let b = 0; b < n; b++) {
        if ((b + Math.floor(e.t * 12)) % 2 !== 0) continue;
        const y0 = i.y - hh / 2 + b * bh;
        e.ctx.save();
        e.ctx.beginPath(); e.ctx.rect(0, y0, e.W, bh * 0.85); e.ctx.clip();
        J.drawItem(e, bare(i, { x: i.x + off, color: b % 2 ? cA : cB, alpha: (i.alpha ?? 1) * 0.82 }));
        e.ctx.restore();
      }
    });
  },
}, P);

/* 5. Compositing High-Contrast Studio Edge Rim & Legibility Matte */
J.register('treat', 'amTreatCompositingEdge', {
  name: '合成用コントラスト縁', en: 'Compositing Studio Rim', tags: ['editorial', 'graphic', 'calm'], w: 1.3,
  plan: rng => ({ glass: rng.chance(0.75) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, darkBg = J.lum(sc.bg) < 0.5;
    it.strokeColor = darkBg ? '#06080C' : '#FFFFFF';
    it.stroke = Math.max(2.2, it.size * 0.048);
    if (Pt.glass) {
      addPre(it, (e, i) => {
        if (i.pass !== 'main' || tracing(i)) return;
        const padX = i.size * 0.36, padY = i.size * 0.22;
        const w = (i.w || i.size * Math.max(1.5, (i.text || '').length * 0.65)) + padX * 2;
        const h = i.size * 1.18 + padY * 2;
        e.ctx.save();
        e.ctx.globalAlpha = (i.alpha ?? 1) * 0.38;
        e.ctx.fillStyle = darkBg ? '#080B12' : '#FFFFFF';
        e.ctx.fillRect(i.x - w / 2, i.y - h / 2, w, h);
        e.ctx.strokeStyle = rgbaCol(pop(sc), 0.72);
        e.ctx.lineWidth = Math.max(1.5, i.size * 0.03);
        e.ctx.strokeRect(i.x - w / 2, i.y - h / 2, w, h);
        e.ctx.restore();
      });
    }
  },
}, P);

/* ================================================================
   SCREEN FX (6)
   ================================================================ */

/* 1. 3D Flip Cube Tile Sweep — divides canvas into 3D perspective flipping strips */
fxWrap('amFx3DFlipCube', {
  name: '3Dフリップ波', en: '3D Cube Flip', tags: ['pop', 'graphic', 'glitch'], w: 1.15, dur: 9, amp: 1, mid: true, scratch: true, ae: 'block',
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I; if (!S || k >= 1) return;
    const n = 7, e0 = bell(k), acc = pop(sc);
    ctx.fillStyle = sc.bg; ctx.fillRect(0, 0, cw, ch);
    for (let i = 0; i < n; i++) {
      const local = clamp((k * 1.35 - (i / n) * 0.35));
      const ang = Math.sin(local * Math.PI) * 0.48 * Math.PI;
      const scaleX = Math.max(0.08, Math.abs(Math.cos(ang)));
      const x0 = Math.round((i * cw) / n), x1 = Math.round(((i + 1) * cw) / n), sw = x1 - x0;
      const cx = x0 + sw / 2, dw = sw * scaleX;
      ctx.drawImage(S, x0, 0, sw, ch, cx - dw / 2, (1 - scaleX) * ch * 0.04, dw, ch * (1 - (1 - scaleX) * 0.08));
      if (scaleX < 0.88) {
        ctx.fillStyle = rgbaCol(acc, (1 - scaleX) * 0.22 * e0);
        ctx.fillRect(cx - dw / 2, 0, dw, ch);
      }
    }
  },
});

/* 2. Glitch RGB Tear Burst */
fxWrap('amFxGlitchTear', {
  name: 'グリッチ裂け', en: 'Glitch RGB Tear', tags: ['glitch', 'graphic', 'pop'], w: 1.25, dur: 6, amp: 1, mid: true, scratch: true, ae: 'slice',
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I; if (!S) return;
    const p = Math.sin(Math.PI * k), s = J.h(Math.round(ev.t * 1000), Math.floor(k * 14));
    const slices = 11;
    ctx.drawImage(S, 0, 0);
    for (let i = 0; i < slices; i++) {
      if (J.r(s, i, 1) > 0.55) continue;
      const y0 = Math.floor((i * ch) / slices), y1 = Math.floor(((i + 1) * ch) / slices), h = y1 - y0;
      const shift = Math.round(J.rs(s, i, 2) * cw * 0.075 * p * (ev.amp || 1));
      ctx.drawImage(S, 0, y0, cw, h, shift, y0, cw, h);
      ctx.fillStyle = rgbaCol(i % 2 ? (sc.ghostA || '#00F0FF') : (sc.ghostB || '#FF1E6E'), 0.2 * p);
      ctx.fillRect(shift > 0 ? 0 : cw + shift, y0, Math.abs(shift) + 18, h * 0.45);
    }
  },
});

/* 3. Pop Art Ben-Day Halftone Comic Flash */
fxWrap('amFxPopBenDayFlash', {
  name: 'ポップ網点フラッシュ', en: 'Pop Halftone Punch', tags: ['pop', 'graphic'], w: 1.2, dur: 7, amp: 1, mid: true, scratch: false, ae: 'flash',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), c1 = pop(sc), c2 = pop2(sc);
    const step = Math.max(18, Math.min(cw, ch) * 0.045);
    ctx.globalAlpha = 0.42 * p;
    ctx.fillStyle = c1;
    ctx.beginPath();
    for (let y = step * 0.5; y < ch; y += step) {
      const edge = Math.max(Math.abs(y / ch - 0.5) * 2, 0.25);
      for (let x = step * 0.5; x < cw; x += step) {
        const edgeX = Math.abs(x / cw - 0.5) * 2;
        const r = step * 0.34 * p * clamp((edge + edgeX) * 0.72);
        if (r > 1.2) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); }
      }
    }
    ctx.fill();
    const bw = Math.max(4, Math.min(cw, ch) * 0.022 * p);
    ctx.strokeStyle = c2; ctx.lineWidth = bw; ctx.strokeRect(bw / 2, bw / 2, cw - bw, ch - bw);
  },
});

/* 4. Kinetic Stepped Prism Zoom */
fxWrap('amFxKineticPrism', {
  name: 'キネティック残像枠', en: 'Kinetic Prism Echo', tags: ['pop', 'graphic', 'glitch'], w: 1.1, dur: 8, amp: 1, mid: true, scratch: true, ae: 'zoom',
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I; if (!S) return;
    const p = bell(k), acc = pop(sc), lw = Math.max(2, Math.min(cw, ch) * 0.005);
    ctx.drawImage(S, 0, 0);
    for (let i = 1; i <= 3; i++) {
      const scf = 1 - i * 0.11 * p;
      const w = cw * scf, h = ch * scf, x = (cw - w) / 2, y = (ch - h) / 2;
      ctx.globalAlpha = 0.32 * p * (1 - i * 0.22);
      ctx.drawImage(S, 0, 0, cw, ch, x, y, w, h);
      ctx.globalAlpha = 0.65 * p;
      ctx.strokeStyle = i % 2 ? acc : pop2(sc);
      ctx.lineWidth = lw;
      ctx.strokeRect(x, y, w, h);
    }
  },
});

/* 5. 3D Isometric Depth Parallax Stereo Pulse */
fxWrap('amFxIsoPulse', {
  name: '3D等角奥行きパルス', en: '3D Iso Stereo Pulse', tags: ['graphic', 'pop', 'glitch'], w: 1.2, dur: 8, amp: 1, mid: true, scratch: true, ae: 'zoom',
  draw(ctx, ev, k, I) {
    const { cw, ch, S, sc } = I; if (!S) return;
    const p = bell(k), d = Math.min(cw, ch) * 0.022 * p;
    ctx.drawImage(S, 0, 0);
    ctx.globalAlpha = 0.26 * p;
    ctx.drawImage(S, -d * 0.866, -d * 0.5);
    ctx.drawImage(S, d * 0.866, d * 0.5);
    ctx.globalAlpha = 0.55 * p;
    ctx.strokeStyle = pop(sc);
    ctx.lineWidth = Math.max(1.5, Math.min(cw, ch) * 0.003);
    ctx.strokeRect(d, d, cw - d * 2, ch - d * 2);
  },
});

/* 6. Compositing Viewfinder & Split Safe-Zone Flash */
fxWrap('amFxCompositingFrame', {
  name: '合成スタジオ・ファインダー枠', en: 'Compositing Safe Flash', tags: ['editorial', 'graphic'], w: 1.15, dur: 8, amp: 1, mid: true, scratch: false, ae: 'flash',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), m = Math.min(cw, ch) * 0.055;
    ctx.strokeStyle = rgbaCol(pop(sc), 0.72 * p);
    ctx.lineWidth = Math.max(2, Math.min(cw, ch) * 0.004);
    ctx.strokeRect(m, m, cw - m * 2, ch - m * 2);
    ctx.strokeStyle = rgbaCol(pop2(sc), 0.45 * p);
    ctx.beginPath(); ctx.moveTo(cw * 0.5, m); ctx.lineTo(cw * 0.5, ch - m); ctx.stroke();
  },
});

/* ================================================================
   TRANSITIONS (3)
   ================================================================ */

/* 1. 3D Geometric Prism Multi-Panel Fold */
J.register('trans', 'amTransPrismFold', {
  name: '3Dプリズム切替', en: '3D Prism Fold', tags: ['graphic', 'pop', 'glitch'], w: 1.25, dur: 0.44, ae: 'cubeTurn',
  plan: rng => ({ cols: rng.pick([4, 5, 6]), dir: rng.pick([1, -1]) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, n = Q.cols || 5, d = Q.dir || 1, { cw, ch, sc } = I;
    const e = E.inOutCubic(p), ac = pop(sc);
    ctx.save();
    try {
      ctx.fillStyle = sc.bg; ctx.fillRect(0, 0, cw, ch);
      for (let i = 0; i < n; i++) {
        const lag = (d > 0 ? i : n - 1 - i) / Math.max(1, n - 1) * 0.34;
        const u = clamp((e * 1.34 - lag) / 1.0);
        const x0 = Math.round((i * cw) / n), x1 = Math.round(((i + 1) * cw) / n), sw = x1 - x0;
        const showB = u >= 0.5;
        const flip = Math.abs(Math.cos(u * Math.PI));
        const dw = Math.max(1, sw * flip);
        const dx = x0 + (sw - dw) / 2;
        const dy = (1 - flip) * ch * 0.035;
        ctx.drawImage(showB ? B : A, x0, 0, sw, ch, dx, dy, dw, ch - dy * 2);
        if (flip < 0.92) {
          ctx.fillStyle = rgbaCol(ac, (1 - flip) * 0.25);
          ctx.fillRect(dx, dy, Math.max(2, sw * 0.04), ch - dy * 2);
        }
      }
    } finally { ctx.restore(); }
  },
}, P);

/* 2. Bauhaus Interlocking Geometric Block Slide */
J.register('trans', 'amTransBauhausSlide', {
  name: 'バウハウス幾何スライド', en: 'Bauhaus Block Slide', tags: ['graphic', 'editorial', 'pop'], w: 1.2, dur: 0.42, ae: 'wipe',
  plan: rng => ({ rows: rng.pick([3, 4]) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, rows = Q.rows || 4, { cw, ch, sc } = I;
    const e = E.inOutCubic(p), c1 = pop(sc), c2 = pop2(sc);
    ctx.save();
    try {
      ctx.drawImage(A, 0, 0);
      for (let r = 0; r < rows; r++) {
        const y0 = Math.round((r * ch) / rows), y1 = Math.round(((r + 1) * ch) / rows), sh = y1 - y0;
        const local = clamp((e * 1.25 - (r / rows) * 0.25));
        const dir = r % 2 ? 1 : -1;
        const curW = cw * local;
        const bx = dir > 0 ? 0 : cw - curW;
        ctx.save();
        ctx.beginPath(); ctx.rect(bx, y0, curW, sh); ctx.clip();
        ctx.drawImage(B, 0, y0, cw, sh, 0, y0, cw, sh);
        ctx.restore();
        if (local > 0.02 && local < 0.98) {
          ctx.fillStyle = r % 2 ? c1 : c2;
          ctx.fillRect(dir > 0 ? curW - 8 : bx, y0, 12, sh);
        }
      }
    } finally { ctx.restore(); }
  },
}, P);

/* 3. Pop Art Diagonal Comic Panel Slam */
J.register('trans', 'amTransComicWipe', {
  name: 'コミック斜めカット割', en: 'Comic Panel Slam', tags: ['pop', 'graphic'], w: 1.2, dur: 0.36, ae: 'diagonalWipe',
  plan: rng => ({ dir: rng.pick([1, -1]) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, { cw, ch, sc } = I, e = E.outExpo(p), d = Q.dir || 1;
    const slant = cw * 0.14 * d;
    const cutX = lerp(-slant, cw + Math.abs(slant), e);
    ctx.save();
    try {
      ctx.drawImage(A, 0, 0);
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(cutX, 0); ctx.lineTo(cutX - slant, ch); ctx.lineTo(0, ch); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.drawImage(B, 0, 0);
      ctx.restore();
      ctx.strokeStyle = sc.ink || '#111111';
      ctx.lineWidth = Math.max(4, Math.min(cw, ch) * 0.012);
      ctx.beginPath(); ctx.moveTo(cutX, -4); ctx.lineTo(cutX - slant, ch + 4); ctx.stroke();
    } finally { ctx.restore(); }
  },
}, P);

/* ================================================================
   DECORATIONS (4)
   ================================================================ */

/* 1. Bauhaus Floating Primitives (circles, triangles, hatch blocks) */
decorWrap('amDecoBauhaus', {
  name: 'バウハウス図形装飾', en: 'Bauhaus Shapes', layer: 'back', tags: ['graphic', 'editorial', 'pop'], w: 1.2,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), s = Q.seed || 7;
    const drift = Math.sin(t * 1.1 + s) * U * 0.02;
    ctx.globalAlpha = 0.38 * e;
    ctx.fillStyle = c1;
    ctx.beginPath(); ctx.arc(W * 0.14, H * 0.22 + drift, U * 0.042, 0, TAU); ctx.fill();
    ctx.fillStyle = c2;
    ctx.fillRect(W * 0.82 - U * 0.04, H * 0.72 - drift, U * 0.075, U * 0.075);
    drawHatchSquare(ctx, W * 0.80, H * 0.18 + drift, U * 0.065, c1, Math.max(1.2, U * 0.0022), Math.max(6, U * 0.012));
  },
});

/* 2. Pop Art Comic Starburst & Halftone Clusters */
decorWrap('amDecoComicBurst', {
  name: 'コミック爆裂スター', en: 'Comic Starburst', layer: 'back', tags: ['pop', 'graphic'], w: 1.2,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const rot = t * 0.45;
    ctx.globalAlpha = 0.28 * e;
    ctx.fillStyle = c1;
    drawStarburstPoly(ctx, W * 0.15, H * 0.24, U * 0.095 * e, U * 0.058 * e, 12, rot);
    ctx.fill();
    ctx.strokeStyle = sc.ink || '#111111'; ctx.lineWidth = Math.max(1.5, U * 0.0028); ctx.stroke();
    ctx.fillStyle = c2;
    drawStarburstPoly(ctx, W * 0.85, H * 0.76, U * 0.085 * e, U * 0.052 * e, 10, -rot);
    ctx.fill(); ctx.stroke();
  },
});

/* 3. 3D Isometric Mini Wireframe Cubes */
decorWrap('amDecoIsoCube', {
  name: '3D等角ワイヤー飾り', en: 'Iso Wire Cubes', layer: 'back', tags: ['graphic', 'glitch', 'editorial'], w: 1.2,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const pts = [[W * 0.14, H * 0.26, c1], [W * 0.86, H * 0.74, c2]];
    ctx.globalAlpha = 0.52 * e;
    ctx.lineWidth = Math.max(1.3, U * 0.0024);
    pts.forEach(([cx, cy, col], idx) => {
      const r = U * 0.055 * (1 + 0.08 * Math.sin(t * 2 + idx));
      const dx = r * 0.866, dy = r * 0.5;
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + dx, cy - dy); ctx.lineTo(cx + dx, cy + dy); ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - dx, cy + dy); ctx.lineTo(cx - dx, cy - dy); ctx.closePath();
      ctx.moveTo(cx - dx, cy - dy); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx, cy - dy);
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + r);
      ctx.stroke();
    });
  },
});

/* 4. Compositing Studio Safe-Frame Corner Brackets & Guides */
decorWrap('amDecoSafeFrame', {
  name: '合成セーフフレーム枠', en: 'Studio Safe Frame', layer: 'front', tags: ['editorial', 'calm', 'graphic'], w: 1.2,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc } = env, U = Umin(env), m = U * 0.04, arm = U * 0.03;
    ctx.globalAlpha = 0.48 * e;
    ctx.strokeStyle = pop(sc);
    ctx.lineWidth = Math.max(1.4, U * 0.0024);
    ctx.beginPath();
    ctx.moveTo(m, m + arm); ctx.lineTo(m, m); ctx.lineTo(m + arm, m);
    ctx.moveTo(W - m - arm, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + arm);
    ctx.moveTo(m, H - m - arm); ctx.lineTo(m, H - m); ctx.lineTo(m + arm, H - m);
    ctx.moveTo(W - m - arm, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - arm);
    ctx.stroke();
  },
});
})();
