/* ============================================================================
   ALEXURA STUDIO — pack: x2guofeng
   Classical Chinese (国风古典) procedural visual skills:
   6 Backgrounds · 5 Text Treatments · 4 Screen FX · 3 Transitions · 4 Decorations
   ============================================================================ */
(() => {
'use strict';
const E = J.E;
const P = 'x2guofeng';
const DEG = J.DEG, TAU = J.TAU, clamp = J.clamp, lerp = J.lerp;

/* ---------------- shared safe helpers ---------------- */
const rgbaCol = (c, a) => J.rgba(c || '#ffffff', Math.round(clamp(a) * 1000) / 1000);
const Umin = env => Math.min(env.W, env.H);
const pop = sc => [sc.accent, sc.accent2, sc.fg].find(c => c && J.contrast(c, sc.bg) > 1.45) || sc.fg;
const pop2 = sc => [sc.accent2, sc.ghostA, sc.ghostB, sc.fg].find(c => c && c !== pop(sc) && J.contrast(c, sc.bg) > 1.35) || sc.fg;
const bell = k => Math.sin(Math.PI * clamp(k));
const inOut = env => E.outCubic(clamp((env.lt || 0) / 0.36)) * (1 - E.inCubic(clamp(env.pOut || 0)));
const bgWrap = (k, d) => J.register('bg', k, Object.assign({}, d, {
  draw(env, Q) { const ctx = env.ctx; ctx.save(); try { d.draw(env, Q || {}, ctx); } finally { ctx.restore(); } },
}), P);
const fxWrap = (k, d) => J.register('fx', k, Object.assign({}, d, {
  draw(ctx, ev, k2, I) { ctx.save(); try { d.draw(ctx, ev, clamp(Number.isFinite(k2) ? k2 : 1), I); } finally { ctx.restore(); } },
}), P);
const decorWrap = (k, d) => J.register('decor', k, Object.assign({}, d, {
  draw(env, bb, Q) { const ctx = env.ctx; ctx.save(); try { d.draw(env, bb || { x: env.W * 0.5, y: env.H * 0.5, w: env.W * 0.4, h: env.H * 0.16 }, Q || {}, ctx); } finally { ctx.restore(); } },
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

function drawCloudScroll(ctx, cx, cy, size, col, lw, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = rgbaCol(col, alpha);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.beginPath();
  // Classical Ruyi cloud head + trailing spiral tail
  ctx.moveTo(-size * 0.9, size * 0.12);
  ctx.bezierCurveTo(-size * 0.55, -size * 0.42, -size * 0.08, -size * 0.44, size * 0.12, -size * 0.14);
  ctx.bezierCurveTo(size * 0.34, -size * 0.38, size * 0.72, -size * 0.24, size * 0.68, size * 0.08);
  ctx.bezierCurveTo(size * 0.65, size * 0.34, size * 0.32, size * 0.34, size * 0.30, size * 0.14);
  ctx.bezierCurveTo(size * 0.28, -0.02 * size, size * 0.46, -0.06 * size, size * 0.48, size * 0.06);
  ctx.moveTo(-size * 0.42, size * 0.22);
  ctx.quadraticCurveTo(size * 0.05, size * 0.36, size * 0.42, size * 0.24);
  ctx.stroke();
  ctx.restore();
}

function drawPlumBlossom(ctx, cx, cy, r, petalCol, coreCol, alpha, rot) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot || 0);
  ctx.globalAlpha = clamp(alpha);
  ctx.fillStyle = petalCol;
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * TAU - Math.PI / 2;
    const px = Math.cos(a) * r * 0.52, py = Math.sin(a) * r * 0.52;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.44, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = coreCol;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = coreCol;
  ctx.lineWidth = Math.max(0.8, r * 0.08);
  for (let p = 0; p < 5; p++) {
    const a = (p / 5) * TAU - Math.PI / 2 + 0.3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * r * 0.46, Math.sin(a) * r * 0.46);
    ctx.stroke();
  }
  ctx.restore();
}

/* ================================================================
   BACKGROUNDS (6) — Classical Chinese Scenery & Architectural Motifs
   ================================================================ */

/* 1. 千里江山 · 青绿水墨 — Layered Ink & Mineral Green/Gold Mountain Ridges + Mist */
bgWrap('gfBgShanShui', {
  name: '千里江山・青緑水墨', en: 'Shan-Shui Landscape Scroll', tags: ['calm', 'emotional', 'editorial'], w: 1.45,
  plan: rng => ({ seed: rng.int(1, 1e9), ridges: rng.int(3, 5), moon: rng.chance(0.72), birds: rng.chance(0.8) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), s = Q.seed || 7;
    const c1 = pop(sc), c2 = pop2(sc);
    const layers = Q.ridges || 4;

    // Optional soft halo moon / sun disk behind distant peaks
    if (Q.moon !== false) {
      const mx = W * (0.24 + 0.52 * J.r(s, 9, 1)), my = H * 0.26, mr = U * 0.14;
      const g = ctx.createRadialGradient(mx, my, mr * 0.15, mx, my, mr * 2.1);
      g.addColorStop(0, rgbaCol(c2, 0.22));
      g.addColorStop(0.55, rgbaCol(c1, 0.09));
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(mx, my, mr * 2.1, 0, TAU); ctx.fill();
      ctx.fillStyle = rgbaCol(sc.fg, 0.12);
      ctx.beginPath(); ctx.arc(mx, my, mr * 0.55, 0, TAU); ctx.fill();
    }

    // Layered receding mountain silhouettes + drifting cloud mist
    for (let l = 0; l < layers; l++) {
      const depth = l / Math.max(1, layers - 1);
      const baseH = H * lerp(0.52, 0.84, depth);
      const amp = H * lerp(0.14, 0.08, depth);
      const shift = Math.sin(t * (0.09 + 0.03 * l) + l * 1.4) * W * 0.035;
      const step = Math.max(18, W / 42);
      const col = l % 2 === 0 ? c1 : (l === layers - 1 ? sc.fg : c2);
      const alpha = lerp(0.10, 0.24, depth);

      const mg = ctx.createLinearGradient(0, baseH - amp, 0, H);
      mg.addColorStop(0, rgbaCol(col, alpha));
      mg.addColorStop(0.55, rgbaCol(col, alpha * 0.42));
      mg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = mg;

      ctx.beginPath();
      ctx.moveTo(-20, H);
      for (let x = -20; x <= W + 20; x += step) {
        const nx = (x + shift) / W;
        const h1 = Math.sin(nx * (4.2 + l * 1.1) + J.r(s, l, 1) * TAU);
        const h2 = Math.sin(nx * (9.5 + l * 1.9) + J.r(s, l, 2) * TAU) * 0.45;
        const h3 = Math.cos(nx * 17.3 + l * 2.1) * 0.18;
        const ridge = Math.abs(h1 + h2 + h3);
        ctx.lineTo(x, baseH - ridge * amp);
      }
      ctx.lineTo(W + 20, H);
      ctx.closePath();
      ctx.fill();

      // Delicate mineral-gold or pale ink rim stroke along crest
      ctx.strokeStyle = rgbaCol(l % 2 ? c2 : c1, alpha * 0.85);
      ctx.lineWidth = Math.max(1.0, U * 0.0018);
      ctx.beginPath();
      for (let x = -20; x <= W + 20; x += step) {
        const nx = (x + shift) / W;
        const ridge = Math.abs(Math.sin(nx * (4.2 + l * 1.1) + J.r(s, l, 1) * TAU)
          + Math.sin(nx * (9.5 + l * 1.9) + J.r(s, l, 2) * TAU) * 0.45
          + Math.cos(nx * 17.3 + l * 2.1) * 0.18);
        const yy = baseH - ridge * amp;
        if (x === -20) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();

      // Horizontal Silk Road valley mist veil between mid layers
      if (l < layers - 1) {
        const my = baseH + H * 0.03;
        const vg = ctx.createLinearGradient(0, my - U * 0.04, 0, my + U * 0.06);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(0.5, rgbaCol(sc.fg, 0.075));
        vg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, my - U * 0.04, W, U * 0.10);
      }
    }

    // Distant wild geese silhouettes gliding peacefully
    if (Q.birds !== false) {
      ctx.strokeStyle = rgbaCol(sc.fg, 0.28);
      ctx.lineWidth = Math.max(1.2, U * 0.0022);
      for (let b = 0; b < 5; b++) {
        const bx = ((0.18 + b * 0.045 + t * 0.018) % 1.15 - 0.08) * W;
        const by = H * (0.22 + (b % 3) * 0.035) + Math.sin(t * 2.2 + b) * U * 0.008;
        const ws = U * (0.014 - b * 0.0012);
        const flap = Math.sin(t * 4.5 + b * 1.1) * ws * 0.35;
        ctx.beginPath();
        ctx.moveTo(bx - ws, by - flap);
        ctx.quadraticCurveTo(bx - ws * 0.4, by - ws * 0.45, bx, by);
        ctx.quadraticCurveTo(bx + ws * 0.4, by - ws * 0.45, bx + ws, by - flap);
        ctx.stroke();
      }
    }
  },
});

/* 2. 雕梁画栋 · 宫廷窗棂 — Classical Palace Lattice Window Screen & Backlit Xuan Paper */
bgWrap('gfBgPalaceLattice', {
  name: '雕梁画棟・宮廷窓櫺', en: 'Palace Window Lattice', tags: ['editorial', 'calm', 'graphic'], w: 1.35,
  plan: rng => ({ seed: rng.int(1, 1e9), roundWindow: rng.chance(0.55) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const breathe = 1 + 0.035 * Math.sin(t * 0.9);

    // Warm Xuan-paper sanctuary light in center
    const rg = ctx.createRadialGradient(W * 0.5, H * 0.5, U * 0.08, W * 0.5, H * 0.5, U * 0.56 * breathe);
    rg.addColorStop(0, rgbaCol(c2, 0.14));
    rg.addColorStop(0.6, rgbaCol(c1, 0.06));
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    // Double palace wooden frame border
    const m = U * 0.045, m2 = U * 0.062;
    ctx.strokeStyle = rgbaCol(c1, 0.28);
    ctx.lineWidth = Math.max(2, U * 0.004);
    ctx.strokeRect(m, m, W - m * 2, H - m * 2);
    ctx.strokeStyle = rgbaCol(sc.fg, 0.14);
    ctx.lineWidth = Math.max(1.1, U * 0.002);
    ctx.strokeRect(m2, m2, W - m2 * 2, H - m2 * 2);

    // Corner Huiwen (回纹) classical Chinese fretwork keys
    const ks = U * 0.065;
    const drawCornerFret = (cx, cy, sx, sy) => {
      ctx.strokeStyle = rgbaCol(c1, 0.34);
      ctx.lineWidth = Math.max(1.4, U * 0.0026);
      ctx.beginPath();
      ctx.moveTo(cx, cy + sy * ks);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + sx * ks, cy);
      ctx.lineTo(cx + sx * ks, cy + sy * ks * 0.42);
      ctx.lineTo(cx + sx * ks * 0.42, cy + sy * ks * 0.42);
      ctx.lineTo(cx + sx * ks * 0.42, cy + sy * ks * 0.18);
      ctx.moveTo(cx + sx * ks * 0.18, cy + sy * ks * 0.18);
      ctx.lineTo(cx + sx * ks * 0.18, cy + sy * ks);
      ctx.stroke();
    };
    drawCornerFret(m2, m2, 1, 1);
    drawCornerFret(W - m2, m2, -1, 1);
    drawCornerFret(m2, H - m2, 1, -1);
    drawCornerFret(W - m2, H - m2, -1, -1);

    // Optional circular Moon Gate (月亮门) architectural mullion behind lyric
    if (Q.roundWindow) {
      const R = U * 0.36 * breathe;
      ctx.strokeStyle = rgbaCol(c2, 0.22);
      ctx.lineWidth = Math.max(1.8, U * 0.0032);
      ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, R, 0, TAU); ctx.stroke();
      ctx.strokeStyle = rgbaCol(sc.fg, 0.11);
      ctx.lineWidth = Math.max(1, U * 0.0018);
      ctx.beginPath(); ctx.arc(W * 0.5, H * 0.5, R * 0.92, 0, TAU); ctx.stroke();
      // Delicate lattice ribs near outer arcs
      ctx.beginPath();
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const x = W * 0.5 + i * R * 0.34;
        const dy = Math.sqrt(Math.max(0, R * R - (x - W * 0.5) ** 2));
        ctx.moveTo(x, H * 0.5 - dy); ctx.lineTo(x, H * 0.5 - dy * 0.72);
        ctx.moveTo(x, H * 0.5 + dy); ctx.lineTo(x, H * 0.5 + dy * 0.72);
      }
      ctx.stroke();
    }
  },
});

/* 3. 敦煌飞天 · 流彩飘带 — Silk Road Dunhuang Flowing Silk Ribbons & Lotus Aureole */
bgWrap('gfBgDunhuangRibbons', {
  name: '敦煌飛天・流彩飄帯', en: 'Dunhuang Silk Ribbons', tags: ['emotional', 'pop', 'editorial'], w: 1.4,
  plan: rng => ({ seed: rng.int(1, 1e9), bands: rng.int(3, 5) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const n = Q.bands || 4;

    // Sacred cave Lotus Mandorla aura behind center
    ctx.save();
    ctx.translate(W * 0.5, H * 0.5);
    const auraR = U * 0.34;
    const ag = ctx.createRadialGradient(0, 0, auraR * 0.1, 0, 0, auraR * 1.4);
    ag.addColorStop(0, rgbaCol(c2, 0.16));
    ag.addColorStop(0.5, rgbaCol(c1, 0.08));
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = ag;
    ctx.beginPath(); ctx.arc(0, 0, auraR * 1.4, 0, TAU); ctx.fill();

    // Lotus petal mandorla ring subtly rotating
    ctx.rotate(t * 0.06);
    ctx.strokeStyle = rgbaCol(c2, 0.16);
    ctx.lineWidth = Math.max(1.1, U * 0.002);
    for (let p = 0; p < 12; p++) {
      ctx.save();
      ctx.rotate((p / 12) * TAU);
      ctx.beginPath();
      ctx.moveTo(0, -auraR * 0.55);
      ctx.quadraticCurveTo(auraR * 0.16, -auraR * 0.82, 0, -auraR * 0.98);
      ctx.quadraticCurveTo(-auraR * 0.16, -auraR * 0.82, 0, -auraR * 0.55);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();

    // Flowing celestial Silk Road ribbons across canvas margins
    for (let i = 0; i < n; i++) {
      const col = i % 2 === 0 ? c1 : c2;
      const ph = i * 1.35;
      const yBase = H * lerp(0.18, 0.82, i / Math.max(1, n - 1));
      const sway1 = Math.sin(t * 1.15 + ph) * H * 0.14;
      const sway2 = Math.cos(t * 0.92 + ph * 1.3) * H * 0.15;
      ctx.strokeStyle = rgbaCol(col, 0.19);
      ctx.lineWidth = Math.max(3, U * (0.016 - i * 0.0018));
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-W * 0.06, yBase + sway1 * 0.5);
      ctx.bezierCurveTo(W * 0.28, yBase - sway1, W * 0.68, yBase + sway2, W * 1.06, yBase - sway2 * 0.5);
      ctx.stroke();
      // Fine gold silk edge thread
      ctx.strokeStyle = rgbaCol(sc.fg, 0.10);
      ctx.lineWidth = Math.max(1, U * 0.0022);
      ctx.beginPath();
      ctx.moveTo(-W * 0.06, yBase + sway1 * 0.5 + U * 0.012);
      ctx.bezierCurveTo(W * 0.28, yBase - sway1 + U * 0.012, W * 0.68, yBase + sway2 + U * 0.012, W * 1.06, yBase - sway2 * 0.5 + U * 0.012);
      ctx.stroke();
    }
  },
});

/* 4. 青花瓷韵 · 海水江牙 — Porcelain Crackle Glaze & Classical Sea-Cloud Waves */
bgWrap('gfBgPorcelainWave', {
  name: '青花瓷韻・海水江牙', en: 'Blue & White Porcelain Waves', tags: ['calm', 'graphic', 'editorial'], w: 1.35,
  plan: rng => ({ seed: rng.int(1, 1e9), clouds: rng.int(3, 5) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), s = Q.seed || 11;

    // Subtle porcelain Binglie (冰裂纹) crackle veins in soft opacity
    ctx.strokeStyle = rgbaCol(sc.fg, 0.065);
    ctx.lineWidth = Math.max(0.8, U * 0.0015);
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      let x = J.r(s, i, 1) * W, y = J.r(s, i, 2) * H;
      ctx.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (J.r(s, i, 10 + k) - 0.5) * U * 0.28;
        y += (J.r(s, i, 20 + k) - 0.5) * U * 0.28;
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Haishui Jiangya (海水江牙) traditional concentric scallop waves along lower margin
    const rad = Math.max(36, U * 0.085);
    const cols = Math.ceil(W / rad) + 3;
    for (let row = 0; row < 2; row++) {
      const yBase = H - (1 - row) * rad * 0.42;
      const drift = ((t * (row ? 18 : -14)) % (rad * 2) + rad * 2) % (rad * 2);
      for (let i = -2; i < cols; i++) {
        const cx = i * rad + drift - rad + (row % 2 ? rad * 0.5 : 0);
        for (let ring = 3; ring >= 1; ring--) {
          const rr = rad * (ring / 3) * 0.62;
          ctx.fillStyle = rgbaCol(row === 0 ? c1 : c2, 0.055 * ring);
          ctx.beginPath(); ctx.arc(cx, yBase, rr, Math.PI, TAU); ctx.fill();
          ctx.strokeStyle = rgbaCol(c1, 0.16);
          ctx.lineWidth = Math.max(1, U * 0.002);
          ctx.beginPath(); ctx.arc(cx, yBase, rr, Math.PI, TAU); ctx.stroke();
        }
      }
    }

    // Floating Porcelain Ruyi cloud motifs
    const cn = Q.clouds || 4;
    for (let i = 0; i < cn; i++) {
      const cx = ((J.r(s, i, 5) + t * 0.015 * (i % 2 ? 1 : -1)) % 1.2 + 1.2) % 1.2 * W - W * 0.1;
      const cy = H * (0.14 + 0.18 * J.r(s, i, 6)) + Math.sin(t * 0.8 + i) * U * 0.012;
      drawCloudScroll(ctx, cx, cy, U * (0.045 + 0.02 * J.r(s, i, 7)), i % 2 ? c2 : c1, Math.max(1.2, U * 0.0024), 0.24);
    }
  },
});

/* 5. 上元灯火 · 孔明流光 — Lantern Festival Rising Kongming Sky Lanterns */
bgWrap('gfBgLanternNight', {
  name: '上元灯火・孔明流光', en: 'Lantern Festival Night', tags: ['emotional', 'pop', 'calm'], w: 1.4,
  plan: rng => ({ seed: rng.int(1, 1e9), count: rng.int(12, 18) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), s = Q.seed || 29;
    const n = Q.count || 14;

    // Gentle festival water reflection horizon glow
    const wg = ctx.createLinearGradient(0, H * 0.72, 0, H);
    wg.addColorStop(0, 'rgba(0,0,0,0)');
    wg.addColorStop(1, rgbaCol(c1, 0.14));
    ctx.fillStyle = wg;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);

    for (let i = 0; i < n; i++) {
      const scale = 0.45 + 0.75 * J.r(s, i, 1);
      const sp = (0.025 + 0.03 * J.r(s, i, 2)) * scale;
      const prog = ((J.r(s, i, 3) + t * sp) % 1.28);
      const y = H * (1.12 - prog);
      const x = W * J.r(s, i, 4) + Math.sin(t * 0.9 + i * 2.1) * U * 0.03 * scale;
      const lw = U * 0.038 * scale, lh = lw * 1.32;
      const fade = Math.sin(Math.PI * clamp(prog / 1.25));
      if (fade <= 0.02) continue;

      const glow = ctx.createRadialGradient(x, y + lh * 0.15, lw * 0.1, x, y, lw * 2.4);
      glow.addColorStop(0, rgbaCol(c2, 0.28 * fade * scale));
      glow.addColorStop(0.5, rgbaCol(c1, 0.11 * fade * scale));
      glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, lw * 2.4, 0, TAU); ctx.fill();

      // Trapezoid lantern body
      ctx.fillStyle = rgbaCol(i % 2 ? c1 : c2, 0.44 * fade);
      ctx.beginPath();
      ctx.moveTo(x - lw * 0.55, y - lh * 0.5);
      ctx.lineTo(x + lw * 0.55, y - lh * 0.5);
      ctx.lineTo(x + lw * 0.36, y + lh * 0.5);
      ctx.lineTo(x - lw * 0.36, y + lh * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgbaCol(sc.fg, 0.28 * fade);
      ctx.lineWidth = Math.max(0.9, lw * 0.05);
      ctx.stroke();

      // Warm flame core at base
      ctx.fillStyle = rgbaCol(sc.fg, 0.72 * fade);
      ctx.beginPath(); ctx.arc(x, y + lh * 0.32, lw * 0.13, 0, TAU); ctx.fill();
    }
  },
});

/* 6. 竹影清风 · 梅月疏影 — Swaying Ink Bamboo Grove & Full Moon Halo */
bgWrap('gfBgBambooInk', {
  name: '竹影清風・梅月疏影', en: 'Moonlit Bamboo Ink', tags: ['calm', 'editorial', 'emotional'], w: 1.4,
  plan: rng => ({ seed: rng.int(1, 1e9), stalks: rng.int(4, 6), blossom: rng.chance(0.55) }),
  draw(env, Q, ctx) {
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc), s = Q.seed || 41;

    // Moon disc on right/left flank
    const mx = W * 0.78, my = H * 0.28, mr = U * 0.16;
    const mg = ctx.createRadialGradient(mx, my, mr * 0.4, mx, my, mr * 1.9);
    mg.addColorStop(0, rgbaCol(sc.fg, 0.14));
    mg.addColorStop(0.5, rgbaCol(c2, 0.07));
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.beginPath(); ctx.arc(mx, my, mr * 1.9, 0, TAU); ctx.fill();

    // Articulated ink bamboo stalks swaying along left and right edges
    const n = Q.stalks || 5;
    for (let b = 0; b < n; b++) {
      const side = b % 2 === 0 ? 0.07 + b * 0.032 : 0.93 - b * 0.025;
      const bx = W * side;
      const sway = Math.sin(t * 1.15 + b * 1.4) * U * 0.024;
      const segs = 5;
      const alpha = 0.16 + 0.08 * J.r(s, b, 1);
      ctx.strokeStyle = rgbaCol(b % 2 ? c1 : sc.fg, alpha);
      ctx.lineWidth = Math.max(2.5, U * (0.008 - b * 0.0006));
      ctx.lineCap = 'round';
      for (let g = 0; g < segs; g++) {
        const y0 = H - (g / segs) * H * 0.95;
        const y1 = H - ((g + 1) / segs) * H * 0.95 + U * 0.006;
        const x0 = bx + sway * (g / segs);
        const x1 = bx + sway * ((g + 1) / segs);
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        // Bamboo node ring & pointed leaf pairs
        ctx.strokeStyle = rgbaCol(sc.fg, alpha * 1.25);
        ctx.lineWidth = Math.max(1.4, U * 0.003);
        ctx.beginPath(); ctx.moveTo(x1 - U * 0.01, y1); ctx.lineTo(x1 + U * 0.01, y1); ctx.stroke();
        if (g >= 1 && g <= 3) {
          const dir = side < 0.5 ? 1 : -1;
          for (let lf = 0; lf < 3; lf++) {
            const ang = (dir > 0 ? 0.15 : Math.PI - 0.15) + (lf - 1) * 0.34 + Math.sin(t * 2 + b + lf) * 0.08;
            const len = U * (0.055 + 0.02 * J.r(s, b, g + lf));
            ctx.fillStyle = rgbaCol(b % 2 ? c2 : c1, alpha * 0.95);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.quadraticCurveTo(x1 + Math.cos(ang - 0.2) * len * 0.55, y1 + Math.sin(ang - 0.2) * len * 0.55, x1 + Math.cos(ang) * len, y1 + Math.sin(ang) * len);
            ctx.quadraticCurveTo(x1 + Math.cos(ang + 0.2) * len * 0.55, y1 + Math.sin(ang + 0.2) * len * 0.55, x1, y1);
            ctx.fill();
          }
        }
      }
    }

    // Optional drifting plum blossoms in wind
    if (Q.blossom) {
      for (let p = 0; p < 7; p++) {
        const px = ((J.r(s, p, 11) + t * 0.04) % 1.1 - 0.05) * W;
        const py = ((J.r(s, p, 12) + t * 0.03) % 1.1 - 0.05) * H;
        drawPlumBlossom(ctx, px, py, U * 0.011, c1, c2, 0.36, t * 0.8 + p);
      }
    }
  },
});

/* ================================================================
   TEXT TREATMENTS (5) — Calligraphic Seal, Lacquer, Ink, Porcelain, Jade
   ================================================================ */

/* 1. 朱砂篆印 · 名章落款 — Red Cinnabar Chop Seal Frame on Emphasis or Lead Glyph */
J.register('treat', 'gfTreatCinnabarSeal', {
  name: '朱砂篆印・落款', en: 'Cinnabar Chop Seal', tags: ['editorial', 'calm', 'emotional'], w: 1.4,
  plan: rng => ({ seed: rng.int(1, 1e9), doubleRim: rng.chance(0.75) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc;
    const sealCol = [sc.accent, sc.accent2, '#C82820'].find(c => c && J.contrast(c, sc.bg) > 1.35) || '#C82820';
    addPre(it, (e, i) => {
      if (tracing(i) || i.pass !== 'main') return;
      const bw = (i.w || i.size * Math.max(1.2, (i.text || '').length * 0.85)) + i.size * 0.36;
      const bh = i.size * 1.16;
      const lw = Math.max(2, i.size * 0.055);
      e.ctx.save();
      e.ctx.globalAlpha = (i.alpha ?? 1) * 0.72;
      e.ctx.strokeStyle = sealCol;
      e.ctx.lineWidth = lw;
      e.ctx.strokeRect(i.x - bw / 2, i.y - bh / 2, bw, bh);
      if (Pt.doubleRim) {
        const inset = lw * 1.45;
        e.ctx.lineWidth = Math.max(1, lw * 0.45);
        e.ctx.strokeRect(i.x - bw / 2 + inset, i.y - bh / 2 + inset, Math.max(4, bw - inset * 2), Math.max(4, bh - inset * 2));
      }
      e.ctx.restore();
    });
  },
}, P);

/* 2. 描金大漆 · 宫廷烫金 — Imperial Gold Leaf Rim + Deep Lacquer Relief Shadow */
J.register('treat', 'gfTreatGoldLacquer', {
  name: '描金大漆・宮廷燙金', en: 'Imperial Gold Lacquer', tags: ['editorial', 'emotional', 'calm'], w: 1.4,
  plan: rng => ({ depth: rng.range(0.035, 0.06) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, gold = pop(sc), rim = pop2(sc);
    if (!it.strokeColor) {
      it.strokeColor = gold;
      it.stroke = Math.max(1.6, it.size * 0.034);
    }
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const off = Math.max(2, i.size * (Pt.depth || 0.045));
      const darkLacquer = J.lum(sc.bg) < 0.45 ? '#070505' : rgbaCol(sc.ink || rim, 0.65);
      J.drawItem(e, bare(i, { x: i.x + off, y: i.y + off * 1.15, color: darkLacquer, strokeColor: darkLacquer, alpha: (i.alpha ?? 1) * 0.78 }));
      J.drawItem(e, bare(i, { x: i.x - off * 0.35, y: i.y - off * 0.35, color: rim, strokeColor: rim, alpha: (i.alpha ?? 1) * 0.32 }));
    });
  },
}, P);

/* 3. 泼墨晕染 · 飞白墨韵 — Organic Ink Wash Bloom + Dry Brush Layered Ghost */
J.register('treat', 'gfTreatInkSplash', {
  name: '潑墨暈染・飛白', en: 'Xuan-Paper Ink Bleed', tags: ['emotional', 'calm', 'editorial'], w: 1.4,
  plan: rng => ({ spread: rng.range(0.04, 0.07) }),
  apply(env, it, Pt) {
    if (!alive(it)) return;
    const sc = env.sc, mist = pop2(sc);
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const d = Math.max(2, i.size * (Pt.spread || 0.055));
      const breath = 1 + 0.14 * Math.sin(e.t * 1.8 + (i.mi || 0));
      J.drawItem(e, bare(i, { x: i.x - d * 0.5, y: i.y + d * 0.35, blur: Math.min(18, i.size * 0.09) * breath, color: mist, strokeColor: mist, alpha: (i.alpha ?? 1) * 0.42 }));
      J.drawItem(e, bare(i, { x: i.x + d * 0.45, y: i.y - d * 0.25, color: sc.ghostA || pop(sc), strokeColor: sc.ghostA || pop(sc), alpha: (i.alpha ?? 1) * 0.28 }));
    });
  },
}, P);

/* 4. 青花釉彩 · 冰裂莹润 — Cobalt Porcelain Double Glaze Rim */
J.register('treat', 'gfTreatPorcelainRim', {
  name: '青花釉彩・瑩潤', en: 'Porcelain Cobalt Glaze', tags: ['calm', 'editorial', 'graphic'], w: 1.35,
  plan: () => ({}),
  apply(env, it) {
    if (!alive(it)) return;
    const sc = env.sc, cobalt = pop(sc), pearl = sc.lum && sc.lum < 0.5 ? '#F6F9FC' : pop2(sc);
    it.strokeColor = cobalt;
    it.stroke = Math.max(1.8, it.size * 0.038);
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const d = Math.max(1.5, i.size * 0.028);
      J.drawItem(e, bare(i, { x: i.x + d, y: i.y + d, color: pearl, strokeColor: pearl, alpha: (i.alpha ?? 1) * 0.45 }));
    });
  },
}, P);

/* 5. 温润翡翠 · 浮雕玉润 — Carved Imperial Nephrite Jade Relief */
J.register('treat', 'gfTreatJadeCarving', {
  name: '温潤翡翠・玉雕', en: 'Imperial Jade Relief', tags: ['calm', 'editorial', 'emotional'], w: 1.35,
  plan: () => ({}),
  apply(env, it) {
    if (!alive(it)) return;
    const sc = env.sc, jade = pop(sc), sheen = pop2(sc);
    addPre(it, (e, i) => {
      if (tracing(i)) return;
      const d = Math.max(1.6, i.size * 0.032);
      J.drawItem(e, bare(i, { x: i.x - d * 0.6, y: i.y - d * 0.6, color: sheen, strokeColor: sheen, alpha: (i.alpha ?? 1) * 0.62 }));
      J.drawItem(e, bare(i, { x: i.x + d, y: i.y + d, blur: i.size * 0.06, color: jade, strokeColor: jade, alpha: (i.alpha ?? 1) * 0.48 }));
    });
  },
}, P);

/* ================================================================
   SCREEN FX (4) — Jiangnan Rain Mist, Gold Leaf, Mounted Scroll, Brush Flick
   ================================================================ */

/* 1. 水墨烟雨 · 江南雾岚 — Drifting Misty Veils & Fine Diagonal Raindrops */
fxWrap('gfFxInkMist', {
  name: '水墨煙雨・霧嵐', en: 'Jiangnan Ink Mist', tags: ['calm', 'emotional'], w: 1.25, dur: 12, amp: 1, mid: false, scratch: false, ae: 'fog',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), c1 = pop(sc), s = J.h(Math.round(ev.t * 1000), 91);
    const hg = ctx.createLinearGradient(0, ch * (0.3 + 0.2 * Math.sin(k * Math.PI)), 0, ch);
    hg.addColorStop(0, 'rgba(0,0,0,0)');
    hg.addColorStop(0.5, rgbaCol(sc.fg, 0.14 * p));
    hg.addColorStop(1, rgbaCol(c1, 0.12 * p));
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, cw, ch);
    // Fine diagonal misty raindrops
    ctx.strokeStyle = rgbaCol(sc.fg, 0.24 * p);
    ctx.lineWidth = Math.max(1, Math.min(cw, ch) * 0.0018);
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const rx = J.r(s, i, 1) * cw, ry = ((J.r(s, i, 2) + k * 0.9) % 1.1 - 0.05) * ch;
      const len = Math.min(cw, ch) * (0.04 + 0.03 * J.r(s, i, 3));
      ctx.moveTo(rx, ry); ctx.lineTo(rx - len * 0.28, ry + len);
    }
    ctx.stroke();
  },
});

/* 2. 金箔流光 · 烛影鎏金 — Drifting Gold Leaf Flakes + Candlelight Edge Bloom */
fxWrap('gfFxGoldLeafFloat', {
  name: '金箔流光・鎏金', en: 'Imperial Gold Leaf', tags: ['emotional', 'editorial', 'pop'], w: 1.3, dur: 11, amp: 1, mid: false, scratch: false, ae: 'sparkle',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), U = Math.min(cw, ch), c1 = pop(sc), c2 = pop2(sc);
    const s = J.h(Math.round(ev.t * 1000), 173);
    for (let i = 0; i < 22; i++) {
      const x = ((J.r(s, i, 1) + (k - 0.5) * 0.08 * J.rs(s, i, 2)) * cw + cw) % cw;
      const y = ((J.r(s, i, 3) - k * 0.16 * (0.5 + J.r(s, i, 4))) * ch + ch) % ch;
      const sz = U * (0.005 + 0.011 * J.r(s, i, 5));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(k * 2.4 + J.r(s, i, 6) * TAU);
      ctx.globalAlpha = 0.42 * p * (0.4 + 0.6 * Math.sin(k * 6 + i));
      ctx.fillStyle = i % 3 ? c1 : c2;
      ctx.beginPath();
      ctx.moveTo(-sz, -sz * 0.45); ctx.lineTo(sz * 0.7, -sz * 0.75);
      ctx.lineTo(sz, sz * 0.45); ctx.lineTo(-sz * 0.6, sz * 0.8);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  },
});

/* 3. 古卷轴框 · 绫罗装裱 — Mounted Silk-Brocade Hanging Scroll Frame Pulse */
fxWrap('gfFxScrollEdge', {
  name: '古巻軸框・綾羅', en: 'Mounted Scroll Brocade', tags: ['editorial', 'calm'], w: 1.2, dur: 10, amp: 1, mid: false, scratch: false, ae: 'frame',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), U = Math.min(cw, ch), c1 = pop(sc), c2 = pop2(sc);
    const bw = Math.max(10, U * 0.032);
    ctx.globalAlpha = 0.52 * p;
    ctx.strokeStyle = c1;
    ctx.lineWidth = Math.max(2, bw * 0.25);
    ctx.strokeRect(bw * 0.5, bw * 0.5, cw - bw, ch - bw);
    ctx.strokeStyle = c2;
    ctx.lineWidth = Math.max(1, bw * 0.12);
    ctx.strokeRect(bw * 1.1, bw * 1.1, cw - bw * 2.2, ch - bw * 2.2);
  },
});

/* 4. 飞白扫墨 · 剑气墨痕 — Expressive Wuxia Ink-Brush Slash & Cinnabar Sparks */
fxWrap('gfFxCalligraphyFlick', {
  name: '飛白掃墨・剣気', en: 'Ink Brush Slash', tags: ['pop', 'emotional', 'graphic'], w: 1.25, dur: 7, amp: 1, mid: true, scratch: false, ae: 'slice',
  draw(ctx, ev, k, I) {
    const { cw, ch, sc } = I, p = bell(k), U = Math.min(cw, ch), c1 = pop(sc), c2 = pop2(sc);
    const sweep = clamp(k * 1.35);
    ctx.globalAlpha = 0.48 * p;
    ctx.strokeStyle = c1;
    ctx.lineWidth = Math.max(3, U * 0.012 * p);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cw * 0.08, ch * 0.78);
    ctx.quadraticCurveTo(cw * lerp(0.25, 0.55, sweep), ch * 0.38, cw * lerp(0.2, 0.94, sweep), ch * 0.22);
    ctx.stroke();
    ctx.strokeStyle = c2;
    ctx.lineWidth = Math.max(1.5, U * 0.004 * p);
    ctx.beginPath();
    ctx.moveTo(cw * 0.14, ch * 0.84);
    ctx.quadraticCurveTo(cw * lerp(0.3, 0.58, sweep), ch * 0.44, cw * lerp(0.25, 0.88, sweep), ch * 0.28);
    ctx.stroke();
  },
});

/* ================================================================
   TRANSITIONS (3) — Poetic Chinese Scroll, Folding Fan & Ink Wash
   ================================================================ */

/* 1. 画卷舒展 — Ancient Painting Scroll Rollers Unrolling Scene B over A */
J.register('trans', 'gfTransScrollUnroll', {
  name: '画巻舒展', en: 'Scroll Unroll', tags: ['editorial', 'calm', 'emotional'], w: 1.4, dur: 0.48, ae: 'wipe',
  plan: rng => ({ fromCenter: rng.chance(0.55) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, { cw, ch, sc } = I, e = E.inOutCubic(p), U = Math.min(cw, ch);
    const wood = pop(sc), gold = pop2(sc);
    ctx.save();
    try {
      ctx.drawImage(A, 0, 0);
      const rw = Math.max(8, U * 0.022);
      if (Q.fromCenter) {
        const halfW = (cw * 0.5) * e;
        const x0 = cw * 0.5 - halfW;
        ctx.save();
        ctx.beginPath(); ctx.rect(x0, 0, halfW * 2, ch); ctx.clip();
        ctx.drawImage(B, 0, 0);
        ctx.restore();
        if (e > 0.02 && e < 0.98) {
          for (const rx of [x0 - rw * 0.5, cw * 0.5 + halfW - rw * 0.5]) {
            ctx.fillStyle = wood; ctx.fillRect(rx, 0, rw, ch);
            ctx.fillStyle = gold; ctx.fillRect(rx + rw * 0.25, 0, rw * 0.5, rw * 0.9);
            ctx.fillRect(rx + rw * 0.25, ch - rw * 0.9, rw * 0.5, rw * 0.9);
          }
        }
      } else {
        const curX = cw * e;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, curX, ch); ctx.clip();
        ctx.drawImage(B, 0, 0);
        ctx.restore();
        if (e > 0.02 && e < 0.98) {
          ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(curX, 0, rw * 0.7, ch);
          ctx.fillStyle = wood; ctx.fillRect(curX - rw * 0.5, 0, rw, ch);
          ctx.fillStyle = gold; ctx.fillRect(curX - rw * 0.25, 0, rw * 0.5, rw * 0.9);
          ctx.fillRect(curX - rw * 0.25, ch - rw * 0.9, rw * 0.5, rw * 0.9);
        }
      }
    } finally { ctx.restore(); }
  },
}, P);

/* 2. 折扇开合 — Classical Silk Folding Fan Sweeping Radially Across Cut */
J.register('trans', 'gfTransFoldingFan', {
  name: '折扇開合', en: 'Silk Folding Fan', tags: ['pop', 'editorial', 'emotional'], w: 1.35, dur: 0.46, ae: 'clockWipe',
  plan: rng => ({ fromTop: rng.chance(0.45) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, { cw, ch, sc } = I, e = E.inOutCubic(p), gold = pop(sc), rim = pop2(sc);
    const pivotX = cw * 0.5, pivotY = Q.fromTop ? 0 : ch;
    const R = Math.hypot(cw, ch) * 1.05;
    const baseA = Q.fromTop ? Math.PI * 0.5 : -Math.PI * 0.5;
    const spread = Math.PI * 0.65 * e;
    ctx.save();
    try {
      ctx.drawImage(A, 0, 0);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(pivotX, pivotY);
      ctx.arc(pivotX, pivotY, R, baseA - spread, baseA + spread);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(B, 0, 0);
      ctx.restore();
      if (e > 0.02 && e < 0.96) {
        ctx.strokeStyle = rgbaCol(gold, 0.78);
        ctx.lineWidth = Math.max(2.5, Math.min(cw, ch) * 0.005);
        for (const a of [baseA - spread, baseA + spread]) {
          ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX + Math.cos(a) * R, pivotY + Math.sin(a) * R); ctx.stroke();
        }
        ctx.strokeStyle = rgbaCol(rim, 0.35);
        ctx.lineWidth = Math.max(1.2, Math.min(cw, ch) * 0.0022);
        for (let r = -3; r <= 3; r++) {
          const ra = baseA + (r / 3.2) * spread;
          ctx.beginPath(); ctx.moveTo(pivotX, pivotY); ctx.lineTo(pivotX + Math.cos(ra) * R * 0.85, pivotY + Math.sin(ra) * R * 0.85); ctx.stroke();
        }
      }
    } finally { ctx.restore(); }
  },
}, P);

/* 3. 水墨晕散 — Poetic Multi-Lobe Ink Wash Dissolve Between Cuts */
J.register('trans', 'gfTransInkWashDissolve', {
  name: '水墨暈散', en: 'Ink Wash Dissolve', tags: ['calm', 'emotional', 'editorial'], w: 1.35, dur: 0.48, ae: 'inkBlob',
  plan: rng => ({ seed: rng.int(1, 1e9) }),
  draw(ctx, A, B, p, I) {
    const Q = I.P || {}, { cw, ch, sc } = I, e = E.inOutCubic(p), s = Q.seed || 7;
    const maxR = Math.hypot(cw, ch) * 0.62;
    ctx.save();
    try {
      ctx.drawImage(A, 0, 0);
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * TAU + J.r(s, i, 1) * 0.5;
        const dist = (0.04 + 0.14 * J.r(s, i, 2)) * maxR * (1 - e);
        const cx = cw * 0.5 + Math.cos(ang) * dist;
        const cy = ch * 0.5 + Math.sin(ang) * dist;
        const r = maxR * e * (0.78 + 0.32 * J.r(s, i, 3));
        if (r > 0.5) { ctx.moveTo(cx + r, cy); ctx.arc(cx, cy, r, 0, TAU); }
      }
      ctx.clip();
      ctx.drawImage(B, 0, 0);
      ctx.restore();
      if (e > 0.06 && e < 0.92) {
        ctx.strokeStyle = rgbaCol(pop(sc), 0.34 * Math.sin(e * Math.PI));
        ctx.lineWidth = Math.max(2, Math.min(cw, ch) * 0.008);
        ctx.beginPath();
        ctx.arc(cw * 0.5, ch * 0.5, maxR * e * 0.88, 0, TAU);
        ctx.stroke();
      }
    } finally { ctx.restore(); }
  },
}, P);

/* ================================================================
   DECORATIONS (4) — Seal Stamp, Auspicious Cloud, Plum Twig, Lantern Tassel
   ================================================================ */

/* 1. 名章闲印 · 朱文篆框 — Corner Carved Artist Chop Seal & Colophon Line */
decorWrap('gfDecoSealStamp', {
  name: '名章閑印・朱文篆枠', en: 'Artist Chop Seal', layer: 'front', tags: ['editorial', 'calm', 'emotional'], w: 1.35,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc } = env, U = Umin(env);
    const sealCol = [sc.accent, sc.accent2, '#C82820'].find(c => c && J.contrast(c, sc.bg) > 1.35) || '#C82820';
    const sz = U * 0.056;
    const sx = Math.min(W - sz - U * 0.05, bb.x + bb.w * 0.5 + U * 0.025);
    const sy = Math.min(H - sz - U * 0.05, bb.y + bb.h * 0.5 - sz * 0.35);

    ctx.globalAlpha = 0.82 * e;
    // Vermilion outer chop border
    ctx.strokeStyle = sealCol;
    ctx.lineWidth = Math.max(1.8, U * 0.0034);
    ctx.strokeRect(sx, sy, sz, sz);
    // Classical interior seal glyph fretwork (Zhuwen calligraphic abstraction)
    const p = sz * 0.22;
    ctx.lineWidth = Math.max(1.2, U * 0.0022);
    ctx.beginPath();
    ctx.moveTo(sx + p, sy + p); ctx.lineTo(sx + sz - p, sy + p);
    ctx.moveTo(sx + sz * 0.5, sy + p); ctx.lineTo(sx + sz * 0.5, sy + sz - p);
    ctx.moveTo(sx + p, sy + sz * 0.5); ctx.lineTo(sx + sz - p, sy + sz * 0.5);
    ctx.moveTo(sx + p, sy + sz - p); ctx.lineTo(sx + sz - p, sy + sz - p);
    ctx.moveTo(sx + p, sy + sz * 0.5); ctx.lineTo(sx + p, sy + sz - p);
    ctx.moveTo(sx + sz - p, sy + p); ctx.lineTo(sx + sz - p, sy + sz * 0.5);
    ctx.stroke();

    // Subtle vertical ink colophon rule beside seal
    ctx.strokeStyle = rgbaCol(sc.fg, 0.35);
    ctx.lineWidth = Math.max(1, U * 0.0018);
    ctx.beginPath();
    ctx.moveTo(sx + sz * 0.5, sy - U * 0.045 * e);
    ctx.lineTo(sx + sz * 0.5, sy - sz * 0.14);
    ctx.stroke();
  },
});

/* 2. 吉祥云纹 · 如意卷草 — Symmetrical Auspicious Ruyi Clouds Flanking Lyric Box */
decorWrap('gfDecoCloudMotif', {
  name: '吉祥雲紋・如意巻草', en: 'Auspicious Ruyi Clouds', layer: 'back', tags: ['editorial', 'calm', 'emotional'], w: 1.3,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const drift = Math.sin(t * 1.1) * U * 0.012;
    const span = U * 0.058 * e;
    const xL = Math.max(U * 0.08, bb.x - bb.w * 0.5 - U * 0.045);
    const xR = Math.min(env.W - U * 0.08, bb.x + bb.w * 0.5 + U * 0.045);
    drawCloudScroll(ctx, xL, bb.y + drift, span, c1, Math.max(1.5, U * 0.0028), 0.65 * e);
    ctx.save();
    ctx.translate(xR, bb.y - drift);
    ctx.scale(-1, 1);
    drawCloudScroll(ctx, 0, 0, span, c2, Math.max(1.5, U * 0.0028), 0.65 * e);
    ctx.restore();
  },
});

/* 3. 寒梅墨枝 · 疏影暗香 — Ink Plum Blossom Twig & Blooming Petals */
decorWrap('gfDecoPlumInk', {
  name: '寒梅墨枝・疏影暗香', en: 'Ink Plum Twig', layer: 'back', tags: ['calm', 'emotional', 'editorial'], w: 1.35,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, H, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const sway = Math.sin(t * 1.25) * U * 0.008;
    const x0 = W * 0.06, y0 = Math.max(H * 0.16, bb.y - bb.h * 0.35);
    const x1 = x0 + U * 0.14 * e, y1 = y0 - U * 0.04 + sway;
    const x2 = x0 + U * 0.22 * e, y2 = y0 + U * 0.025 + sway * 1.4;

    ctx.globalAlpha = 0.72 * e;
    ctx.strokeStyle = sc.fg;
    ctx.lineWidth = Math.max(2, U * 0.0042);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 - U * 0.03, y0 + U * 0.05);
    ctx.quadraticCurveTo(x0 + U * 0.06, y0 - U * 0.03, x1, y1);
    ctx.quadraticCurveTo(x0 + U * 0.17, y0 - U * 0.02, x2, y2);
    ctx.stroke();

    if (e > 0.25) {
      const petalC = c1;
      const coreC = c2;
      drawPlumBlossom(ctx, x1 - U * 0.02, y1 - U * 0.015, U * 0.022 * e, petalC, coreC, 0.85 * e, t * 0.2);
      drawPlumBlossom(ctx, x2, y2, U * 0.017 * e, petalC, coreC, 0.85 * e, -t * 0.2 + 0.6);
      drawPlumBlossom(ctx, x0 + U * 0.075 * e, y0 + U * 0.012, U * 0.015 * e, coreC, petalC, 0.75 * e, 1.1);
    }
  },
});

/* 4. 宫灯垂穗 · 锦囊玉佩 — Pendulum Palace Lantern & Silk Tassel Pendant */
decorWrap('gfDecoLanternTag', {
  name: '宮灯垂穂・玉佩', en: 'Palace Lantern Tassel', layer: 'front', tags: ['pop', 'editorial', 'emotional'], w: 1.3,
  draw(env, bb, Q, ctx) {
    const e = inOut(env); if (e <= 0) return;
    const { W, sc, t } = env, U = Umin(env), c1 = pop(sc), c2 = pop2(sc);
    const lx = Math.min(W - U * 0.08, bb.x + bb.w * 0.5 + U * 0.06);
    const ly = Math.max(U * 0.14, bb.y - bb.h * 0.45);
    const swing = Math.sin(t * 1.9) * 0.085;

    ctx.save();
    ctx.translate(lx, ly - U * 0.055);
    ctx.rotate(swing);
    ctx.globalAlpha = 0.82 * e;

    // Silk suspension cord
    ctx.strokeStyle = c2;
    ctx.lineWidth = Math.max(1.2, U * 0.0022);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, U * 0.042); ctx.stroke();

    // Hexagonal/oval palace lantern body
    const rx = U * 0.028 * e, ry = U * 0.036 * e;
    ctx.fillStyle = rgbaCol(c1, 0.48);
    ctx.beginPath(); ctx.ellipse(0, U * 0.042 + ry, rx, ry, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = c2; ctx.lineWidth = Math.max(1.4, U * 0.0026);
    ctx.stroke();
    // Top & bottom lantern wooden caps
    ctx.fillStyle = sc.fg;
    ctx.fillRect(-rx * 0.65, U * 0.038, rx * 1.3, U * 0.007);
    ctx.fillRect(-rx * 0.65, U * 0.042 + ry * 2 - U * 0.004, rx * 1.3, U * 0.007);
    // Flowing red/gold silk tassel underneath
    ctx.strokeStyle = c1;
    ctx.lineWidth = Math.max(1.2, U * 0.0024);
    for (let s2 = -1; s2 <= 1; s2++) {
      ctx.beginPath();
      ctx.moveTo(s2 * rx * 0.22, U * 0.046 + ry * 2);
      ctx.lineTo(s2 * rx * 0.32, U * 0.095 + ry * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
});
})();
