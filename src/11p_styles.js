/* JIZURA pack: styles — twelve more style packs (配色セット: colour schemes, font roles, texture, tendencies) */
(() => {
'use strict';

/* scheme: bg, fg, sub, accent, accent2, ink (sticker / plate colour — text on it is drawn in bg), dim (faint bg text),
   ghostA, ghostB (chromatic ghost passes: drawn source-over on dark backgrounds, multiplied on light ones), grad?, paper? */
const S = {
  /* ---------------------------------------------------------------- 桜 */
  sakura: {
    name: 'サクラ', desc: '淡い桜色・深い梅紫・夜桜・丸文字と明朝', moods: ['emotional', 'calm'],
    schemes: [
      { bg: '#F8E4EB', fg: '#4A1434', sub: '#8A4A69', accent: '#D93A74', accent2: '#6F8F4E', ink: '#4A1434', dim: '#F0D3DE', ghostA: '#EC6A9A', ghostB: '#9A8AE6', paper: true },
      { bg: '#26091B', fg: '#FCE8F0', sub: '#D69DB6', accent: '#FF86B0', accent2: '#B9E0A2', ink: '#FCE8F0', dim: '#351127', ghostA: '#FF5C95', ghostB: '#8A78FF' },
      { bg: '#E77FA3', fg: '#3A0B26', sub: '#65173F', accent: '#3A0B26', accent2: '#FFF3F7', ink: '#3A0B26', dim: '#DE7499', ghostA: '#B4205A', ghostB: '#6A4CC8' },
      { bg: '#FFFAF8', fg: '#A01E4A', sub: '#B45F7E', accent: '#E0457F', accent2: '#4A1434', ink: '#A01E4A', dim: '#F8ECEE', ghostA: '#F07AA4', ghostB: '#A898EA', paper: true },
    ],
    fonts: { display: ['kiwi', 'shippori'], serif: ['shippori', 'mincho_light'], body: ['kiwi'], mono: ['mono'] },
    texture: { grain: 0.35, paper: 0.35, scan: 0 }, ghost: 0.45,
    bias: {
      layout: { vcols: 1.8, columnsBig: 1.6, hanging: 1.5, center: 1.3, arcTop: 1.3, mirror: 1.2, circle: 1.2, kanjiFocus: 1.2, huge: 0.8, tile: 0.4, condensed: 0.5 },
      enter: { blurStagger: 1.8, fadeStagger: 1.6, blur: 1.4, trackIn: 1.3, inkBleed: 1.2, unroll: 1.1, slice: 0.5, scramble: 0.3 },
      exit: { dissolve: 1.8, riseOut: 1.5, drift: 1.5, blurOutStagger: 1.4, echoOut: 1.1, glitch: 0.3, explode: 0.5 },
      treat: { softShadow: 1.5, emphasisDots: 1.2, gradientV: 1.2, echoOutline: 0.4, hatch: 0.4 },
      bg: { bokehBg: 1.4, particlesBg: 1.3, gradientSweep: 1.2, spotlight: 1, tvBars: 0.2, bigStripes: 0.4, noiseField: 0.4 },
      cam: { driftDiag: 1.4, pullOut: 1.2, tiltUp: 1.2, shakeHard: 0.3 },
      fx: { lightSweep: 1.4, whiteFrame: 1.2, filmBurn: 1, pixelDrift: 0.3, posterize: 0.4 },
    },
    decor: { petals: 1.6, bokeh: 1, twinkle: 0.8, lightLeak: 0.7, waveLine: 0.6, glitchRects: 0.1, barcode: 0.1 }, hud: false, glow: 0.9,
  },

  /* ---------------------------------------------------------------- 深海 */
  ocean: {
    name: '深海', desc: '濃紺の深海・シアンの発光・泡と細いゴシック', moods: ['calm', 'emotional'],
    schemes: [
      { bg: '#031A2E', fg: '#E4FAFF', sub: '#7FB2C8', accent: '#1FD2E6', accent2: '#4C7DFF', ink: '#E4FAFF', dim: '#0A2842', ghostA: '#1FD2E6', ghostB: '#3B5BFF' },
      { bg: '#0B5566', fg: '#FFFFFF', sub: '#A9E3EA', accent: '#04182A', accent2: '#7FF3FF', ink: '#E4FAFF', dim: '#0E6173', ghostA: '#27E3F2', ghostB: '#031A2E' },
      { bg: '#DCF1F2', fg: '#06243A', sub: '#3E6A7C', accent: '#0A7F98', accent2: '#3B5BFF', ink: '#06243A', dim: '#CBE6E8', ghostA: '#16B4CC', ghostB: '#5A6BFF' },
      { bg: '#01060D', fg: '#7FF6FF', sub: '#3E9AAE', accent: '#FFFFFF', accent2: '#2E6BFF', ink: '#7FF6FF', dim: '#081521', ghostA: '#2E6BFF', ghostB: '#00FFC2' },
    ],
    fonts: { display: ['gothic_light', 'zenkaku'], serif: ['mincho_light', 'mincho'], body: ['sansui'], mono: ['mono'] },
    texture: { grain: 0.6, paper: 0, scan: 0 }, ghost: 0.75,
    bias: {
      layout: { bubbles: 1.8, depthStack: 1.5, tunnel: 1.3, rain: 1.2, wave: 1.3, center: 1.3, vcols: 1.2, perspective: 1.2, orbit: 1.1, labels: 0.5, stickerBomb: 0.3 },
      enter: { riseMask: 1.6, blur: 1.5, waveIn: 1.4, blurStagger: 1.3, zoom: 1.1, pop: 0.5, stamp: 0.4 },
      exit: { riseOut: 1.7, zoomFar: 1.5, dissolve: 1.3, melt: 1.2, blur: 1.2, popOut: 0.5 },
      treat: { glow: 1.6, softShadow: 1.2, gradientV: 1.1, marker: 0.4, boxed: 0.5 },
      bg: { ripples: 1.6, particlesBg: 1.4, gradientSweep: 1.2, concentric: 1, bokehBg: 1, checker: 0.3, polka: 0.4 },
      cam: { driftDiag: 1.4, dollyIn: 1.2, roll: 1.1, tiltUp: 1.1, bounce: 0.4 },
      fx: { waveWarp: 1.6, lightSweep: 1.1, rgbSplit: 0.8, strobe: 0.4 },
    },
    decor: { risingParticles: 1.6, bokeh: 1.1, waveLine: 1.2, orbitDots: 0.7, beatRing: 0.6, rings: 0.6, sparks: 0.2 }, hud: false, glow: 1.6,
  },

  /* ---------------------------------------------------------------- 夕焼け */
  sunset: {
    name: '夕焼けグラデ', desc: '橙から菫へのグラデーション・太い明朝・逆光', moods: ['emotional', 'pop'],
    schemes: [
      { bg: '#2A0F44', fg: '#FFF0DC', sub: '#E6A98F', accent: '#FF7A30', accent2: '#FF4A86', ink: '#FFB347', dim: '#361456', ghostA: '#FF7A30', ghostB: '#B84BFF', grad: ['#FFC15E', '#FF4A7A'] },
      { bg: '#FF8A3D', fg: '#2A0F44', sub: '#5A1F55', accent: '#2A0F44', accent2: '#FFF0DC', ink: '#2A0F44', dim: '#F57F32', ghostA: '#E0306A', ghostB: '#7A2BC0', grad: ['#6A1B9A', '#2A0F44'] },
      { bg: '#B8325F', fg: '#FFF3E4', sub: '#FFC7A8', accent: '#FFC15E', accent2: '#2A0F44', ink: '#FFF3E4', dim: '#A92C56', ghostA: '#FFC15E', ghostB: '#2A0F44', grad: ['#FFF0B8', '#FFC46E'] },
      { bg: '#FFE4CF', fg: '#3A1250', sub: '#8A4A6A', accent: '#F2562E', accent2: '#8A3FD1', ink: '#3A1250', dim: '#F7D6BE', ghostA: '#FF6A3D', ghostB: '#9A4BE0', grad: ['#E24A22', '#7A2BBF'] },
    ],
    fonts: { display: ['tokumin', 'mincho_black', 'dela'], serif: ['mincho_black', 'shippori'], body: ['gothic_med'], mono: ['mono'] },
    texture: { grain: 0.55, paper: 0, scan: 0 }, ghost: 0.6,
    bias: {
      layout: { huge: 1.8, pill: 1.5, arcTop: 1.5, center: 1.3, mixed: 1.3, curtain: 1.3, lowerThird: 1.2, depthStack: 1.1, tile: 0.5, dotMatrix: 0.3 },
      enter: { zoom: 1.5, riseMask: 1.4, blur: 1.3, echoIn: 1.2, wipe: 1.2, trackIn: 1.1, scramble: 0.4, glitchIn: 0.3 },
      exit: { zoomThrough: 1.4, blur: 1.4, drift: 1.3, riseOut: 1.2, shrink: 1.1, glitchDissolve: 0.3 },
      treat: { gradientV: 1.8, longShadow: 1.2, softShadow: 1.1, glow: 1, halftone: 0.5, hatch: 0.4 },
      bg: { gradientSweep: 1.8, sunburst: 1.2, spotlight: 1.2, letterbox: 1.1, halftoneFade: 0.8, tvBars: 0.3 },
      cam: { dollyIn: 1.3, pullOut: 1.2, tiltUp: 1.2, crashZoom: 0.8 },
      fx: { lightSweep: 1.6, filmBurn: 1.4, whiteFrame: 1, hueShift: 0.8, pixelDrift: 0.4 },
    },
    decor: { lightLeak: 1.4, lineBurst: 1, bokeh: 0.8, twinkle: 0.7, halftonePatch: 0.6, waveLine: 0.5 }, hud: false, glow: 1.3, useGrad: true,
  },

  /* ---------------------------------------------------------------- 森 */
  forest: {
    name: '森の手帖', desc: '苔と生成り・樹皮の茶・鉛筆の手書き文字', moods: ['calm', 'editorial', 'emotional'],
    schemes: [
      { bg: '#1D291B', fg: '#EFE9D6', sub: '#A8B08A', accent: '#B7C95A', accent2: '#C4833F', ink: '#EFE9D6', dim: '#263423', ghostA: '#8FB04A', ghostB: '#C4833F' },
      { bg: '#EDE6D1', fg: '#22301F', sub: '#5D6647', accent: '#4F7A35', accent2: '#8A5A32', ink: '#22301F', dim: '#E1D9C2', ghostA: '#6F9A45', ghostB: '#B0703A', paper: true },
      { bg: '#4A3526', fg: '#F2EAD3', sub: '#CDB894', accent: '#B7C95A', accent2: '#EFE9D6', ink: '#B7C95A', dim: '#55402F', ghostA: '#8FB04A', ghostB: '#D9A441', paper: true },
      { bg: '#A9BC96', fg: '#1A2618', sub: '#34482F', accent: '#1A2618', accent2: '#F2EAD3', ink: '#1A2618', dim: '#9FB38C', ghostA: '#4F7A35', ghostB: '#8A5A32' },
    ],
    fonts: { display: ['klee', 'shippori'], serif: ['shippori', 'mincho'], body: ['klee'], mono: ['mono'] },
    texture: { grain: 0.7, paper: 0.5, scan: 0 }, ghost: 0.45,
    bias: {
      layout: { columnsBig: 1.6, vcols: 1.5, hanging: 1.4, quote: 1.3, dropCap: 1.3, frameBox: 1.2, lowerThird: 1.2, justified: 1.1, marquee: 0.5, equalizer: 0.3 },
      enter: { strokeDraw: 1.7, inkBleed: 1.4, fadeStagger: 1.4, riseMask: 1.2, blur: 1.2, unroll: 1.1, scramble: 0.3, glitchIn: 0.2 },
      exit: { dissolve: 1.6, undraw: 1.5, drift: 1.4, sinkMask: 1.2, blurOutStagger: 1.1, glitch: 0.3 },
      treat: { underline: 1.3, emphasisDots: 1.2, dotted: 1.2, softShadow: 1, echoOutline: 0.3 },
      bg: { dotGrid: 1.3, particlesBg: 1.2, spotlight: 1, splitH: 0.8, noiseField: 0.6, retroGrid: 0.2, tvBars: 0.2 },
      cam: { handheld: 1.5, driftDiag: 1.2, tiltUp: 1.2, whipIn: 0.4 },
      fx: { filmBurn: 1.2, lightSweep: 1, strobe: 0.3, posterize: 0.3 },
    },
    decor: { scribbleUnder: 1.2, scribbleCircle: 1, waveLine: 1, risingParticles: 0.9, tapePieces: 0.7, constellation: 0.6, plusGrid: 0.5, guides: 0.4 }, hud: false,
  },

  /* ---------------------------------------------------------------- ヴェイパー */
  vapor: {
    name: 'ヴェイパー', desc: '薄紫とパステルのピンク/水色・明朝・VHSのにじみ', moods: ['pop', 'emotional', 'glitch'],
    schemes: [
      { bg: '#3A2A6E', fg: '#FFFFFF', sub: '#D6C8FF', accent: '#FF8FD8', accent2: '#7DF9FF', ink: '#7DF9FF', dim: '#45347C', ghostA: '#FF71CE', ghostB: '#01CDFE', grad: ['#FF8FD8', '#7DF9FF'] },
      { bg: '#FFC6EC', fg: '#3A2A6E', sub: '#74489A', accent: '#7A3BFF', accent2: '#0F9FC8', ink: '#3A2A6E', dim: '#F7B8E2', ghostA: '#2EC8F0', ghostB: '#B04BFF', grad: ['#7A3BFF', '#0B7FB0'] },
      { bg: '#8FEAF2', fg: '#35246A', sub: '#4A3C8A', accent: '#35246A', accent2: '#FF4FC0', ink: '#35246A', dim: '#82E0EA', ghostA: '#FF5CC8', ghostB: '#8A5CFF', grad: ['#D0249A', '#5A2BD0'] },
      { bg: '#1A1030', fg: '#FFFB96', sub: '#B9A6E0', accent: '#05FFA1', accent2: '#FF71CE', ink: '#FF71CE', dim: '#241840', ghostA: '#FF71CE', ghostB: '#01CDFE', grad: ['#FFFB96', '#FF71CE'] },
    ],
    fonts: { display: ['mincho', 'dot', 'mincho_black'], serif: ['mincho_light', 'mincho'], body: ['sansui'], mono: ['dot', 'mono'] },
    texture: { grain: 0.5, paper: 0, scan: 0.55 }, ghost: 0.95,
    bias: {
      layout: { mirror: 1.7, perspective: 1.5, sideways: 1.3, arcTop: 1.3, filmstrip: 1.2, wave: 1.2, center: 1.2, tile: 1.1, pill: 1.1, genkou: 0.3, justified: 0.4 },
      enter: { echoIn: 1.6, zoomOut: 1.3, flicker: 1.2, trackOut: 1.2, blur: 1.2, stretch: 1.1, strokeDraw: 0.4 },
      exit: { echoOut: 1.5, zoomFar: 1.4, stretch: 1.2, melt: 1.2, blur: 1.1, burn: 0.4 },
      treat: { gradientV: 1.6, echoOutline: 1.4, italic: 1.4, wide: 1.3, glow: 1.1, emphasisDots: 0.3 },
      bg: { retroGrid: 1.7, checker: 1.3, gradientSweep: 1.3, scanBars: 1.1, sunburst: 0.8, borderFrame: 0.5 },
      cam: { roll: 1.3, driftDiag: 1.2, dutch: 1.1, pullOut: 1 },
      fx: { vhsRoll: 1.7, trackingNoise: 1.5, hueShift: 1.3, rgbSplit: 1.2, smear: 1.1, blackFrame: 0.5 },
    },
    decor: { checkerStrip: 1.3, twinkle: 1.1, triangleSpin: 1, shapes: 0.9, lightLeak: 0.7, halftonePatch: 0.6, orbitDots: 0.5 }, hud: false, glow: 1.2, useGrad: true,
  },

  /* ---------------------------------------------------------------- 新聞 */
  newsprint: {
    name: '新聞', desc: '灰色の更紙・墨と赤・見出し明朝・CMYの版ズレと網点', moods: ['editorial', 'graphic'],
    schemes: [
      { bg: '#E6E5E0', fg: '#111111', sub: '#4E4E4C', accent: '#D8141B', accent2: '#0A82C8', ink: '#111111', dim: '#D8D7D1', ghostA: '#E4007F', ghostB: '#00A0E9', paper: true },
      { bg: '#111111', fg: '#F2F2EE', sub: '#A5A5A0', accent: '#F5D300', accent2: '#E4007F', ink: '#F2F2EE', dim: '#1F1F1F', ghostA: '#E4007F', ghostB: '#00A0E9', paper: true },
      { bg: '#D8141B', fg: '#FFFFFF', sub: '#FFD6D0', accent: '#111111', accent2: '#F5D300', ink: '#FFFFFF', dim: '#C71118', ghostA: '#111111', ghostB: '#F5D300', paper: true },
    ],
    fonts: { display: ['mincho_black', 'gothic_bold'], serif: ['mincho_bold', 'mincho'], body: ['mincho'], mono: ['mono'] },
    texture: { grain: 0.9, paper: 0.9, scan: 0 }, ghost: 0.45,
    bias: {
      layout: { justified: 2, columnsBig: 1.7, vcols: 1.6, dropCap: 1.5, quote: 1.4, splitScreen: 1.3, typeSpecimen: 1.2, genkou: 1.1, flipBoard: 1.1, lowerThird: 1, stack: 1, bubbles: 0.3, bounceLine: 0.3, neon: 0.3 },
      enter: { type: 1.5, cursorSweep: 1.4, riseMask: 1.3, shutter: 1.3, stamp: 1.2, wipe: 1.2, spin: 0.4, bounceBig: 0.4 },
      exit: { sweepCover: 1.6, sinkMask: 1.3, wipe: 1.3, backspace: 1.2, blindsClose: 1, spinOut: 0.3, popOut: 0.4 },
      treat: { underline: 1.5, boxed: 1.4, emphasisDots: 1.4, halftone: 1.3, marker: 1.1, glow: 0.3, gradientV: 0.3 },
      bg: { halftoneFade: 1.5, bigChar: 1.3, borderFrame: 1.2, splitH: 1.1, dotGrid: 0.8, bokehBg: 0.2, retroGrid: 0.2 },
      cam: { panL: 1.3, panR: 1.3, stepZoom: 1.1, roll: 0.3 },
      fx: { posterize: 1.2, blackFrame: 1.2, panelWipe: 1.1, hueShift: 0.3, vhsRoll: 0.3 },
    },
    decor: { halftonePatch: 1.4, indexNum: 1.2, rulerEdge: 1, verticalStrip: 1, cropMarks: 0.9, dateStamp: 0.8, crossOut: 0.6, highlightMark: 0.6, bokeh: 0.1, confetti: 0.1 }, hud: false,
  },

  /* ---------------------------------------------------------------- シンセ */
  synth80: {
    name: 'シンセ80s', desc: '黒地にネオンのマゼンタ/シアン・立体文字・走査線', moods: ['pop', 'glitch', 'emotional'],
    schemes: [
      { bg: '#0B0414', fg: '#FF4FD8', sub: '#A98BFF', accent: '#22E6FF', accent2: '#FFE45C', ink: '#22E6FF', dim: '#1A0B2E', ghostA: '#22E6FF', ghostB: '#6A3BFF' },
      { bg: '#0B0414', fg: '#22E6FF', sub: '#8FA8FF', accent: '#E62EBE', accent2: '#FFE45C', ink: '#FF4FD8', dim: '#140A28', ghostA: '#FF4FD8', ghostB: '#FFE45C' },
      { bg: '#1C0A3A', fg: '#FFFFFF', sub: '#FFB0E8', accent: '#E62EBE', accent2: '#22E6FF', ink: '#FFE45C', dim: '#26104C', ghostA: '#FF2E88', ghostB: '#22E6FF', grad: ['#FFE45C', '#FF2E88'] },
      { bg: '#FF2E88', fg: '#0B0414', sub: '#3A0A30', accent: '#0B0414', accent2: '#22E6FF', ink: '#0B0414', dim: '#F0287E', ghostA: '#22E6FF', ghostB: '#FFE45C' },
    ],
    fonts: { display: ['rampart', 'dela'], serif: ['mincho_bold'], body: ['gothic_bold'], mono: ['mono', 'dot'] },
    texture: { grain: 0.4, paper: 0, scan: 0.75 }, ghost: 1.0,
    bias: {
      layout: { neon: 2, perspective: 1.6, tunnel: 1.4, equalizer: 1.3, zoomRepeat: 1.3, marquee: 1.3, huge: 1.3, sideways: 1.1, crossBands: 1.1, genkou: 0.3, hanko: 0.3, quote: 0.4 },
      enter: { neonOn: 2, zoomOut: 1.4, echoIn: 1.3, whip: 1.2, stretch: 1.2, flicker: 1.1, inkBleed: 0.3, strokeDraw: 0.5 },
      exit: { zoomThrough: 1.5, echoOut: 1.3, stretch: 1.2, whipOut: 1.1, glitch: 1.1, dissolve: 0.4 },
      treat: { glow: 1.8, echoOutline: 1.3, extrude: 1.2, longShadow: 1.1, italic: 1, emphasisDots: 0.3, underline: 0.5 },
      bg: { retroGrid: 2, sunburst: 1.1, eqBars: 1.1, tvBars: 1, speedLines: 0.8, dotGrid: 0.4, halftoneFade: 0.5 },
      cam: { beatPunch: 1.4, stepZoom: 1.2, dollyIn: 1.1, whipIn: 1, handheld: 0.4 },
      fx: { crtOff: 1.5, strobe: 1.3, rgbSplit: 1.3, lightSweep: 1.2, zoomPunch: 1.2, filmBurn: 0.3 },
    },
    decor: { triangleSpin: 1.2, beatRing: 1.1, lineBurst: 1, twinkle: 0.8, speedCorner: 0.8, reticle: 0.6, petals: 0.1, tapePieces: 0.1 }, hud: true, glow: 1.9, glitchBoost: 1.15,
  },

  /* ---------------------------------------------------------------- クラフト紙 */
  kraft: {
    name: 'クラフト紙', desc: 'クラフト紙と生成り・スタンプの朱と藍・マステ', moods: ['pop', 'editorial', 'graphic'],
    schemes: [
      { bg: '#C49A6C', fg: '#1A1410', sub: '#46301E', accent: '#B8361B', accent2: '#F3E9D2', ink: '#1A1410', dim: '#B98F62', ghostA: '#C33A1F', ghostB: '#2E5E8C', paper: true },
      { bg: '#F1E6CF', fg: '#1A1410', sub: '#6A5540', accent: '#C33A1F', accent2: '#2E5E8C', ink: '#1A1410', dim: '#E6D8BC', ghostA: '#C33A1F', ghostB: '#2E5E8C', paper: true },
      { bg: '#1E1A17', fg: '#F1E6CF', sub: '#B8A68A', accent: '#D9642E', accent2: '#C49A6C', ink: '#C49A6C', dim: '#2A2521', ghostA: '#C49A6C', ghostB: '#C33A1F', paper: true },
      { bg: '#2E5E8C', fg: '#F6EEDD', sub: '#C9D6E2', accent: '#F1E6CF', accent2: '#C33A1F', ink: '#F1E6CF', dim: '#34669A', ghostA: '#C49A6C', ghostB: '#1A1410', paper: true },
    ],
    fonts: { display: ['dela', 'zenkaku'], serif: ['tokumin', 'mincho_bold'], body: ['klee'], mono: ['mono'] },
    texture: { grain: 0.7, paper: 1, scan: 0 }, ghost: 0.5,
    bias: {
      layout: { tape: 2, labels: 1.6, stickerBomb: 1.5, ticket: 1.4, hanko: 1.2, panels: 1.2, frameBox: 1.1, keycaps: 1, mixed: 1, neon: 0.3, tunnel: 0.3, rain: 0.4 },
      enter: { stamp: 1.8, dropMask: 1.3, squashDrop: 1.2, slideL: 1.1, pop: 1.1, flipX: 1, neonOn: 0.3, glitchIn: 0.3 },
      exit: { popOut: 1.2, flipOutY: 1.2, slideOutL: 1.1, sweepCover: 1.1, foldOut: 1.1, glitchDissolve: 0.3, scrambleOut: 0.4 },
      treat: { boxed: 1.4, hardShadow: 1.3, marker: 1.2, stripes: 1, outlineFill: 1, glow: 0.3 },
      bg: { borderFrame: 1.3, halftoneFade: 1.1, polka: 1, checker: 0.9, splitDiag: 0.8, retroGrid: 0.2, noiseField: 0.3 },
      cam: { handheld: 1.3, stepZoom: 1.1, bounce: 1, roll: 0.4 },
      fx: { panelWipe: 1.2, posterize: 1, whiteFrame: 0.8, vhsRoll: 0.3, crtOff: 0.2 },
    },
    decor: { tapePieces: 1.8, seal: 1.1, scribbleCircle: 1, dateStamp: 1, bracketsJP: 0.8, cropMarks: 0.6, qrBlock: 0.5, arrows: 0.6, glitchRects: 0.1 }, hud: false,
  },

  /* ---------------------------------------------------------------- キャンディ */
  candy: {
    name: 'キャンディ', desc: 'ミント/いちご/レモン/ぶどうのパステル・丸く弾む文字', moods: ['pop'],
    schemes: [
      { bg: '#BDF0E2', fg: '#3E2A8C', sub: '#5A4A9A', accent: '#EE3A88', accent2: '#FFB020', ink: '#3E2A8C', dim: '#AEE8D8', ghostA: '#FF5FA2', ghostB: '#8A6BFF' },
      { bg: '#FFDDEB', fg: '#7A2BB8', sub: '#A2468E', accent: '#EE3A88', accent2: '#2FC2B8', ink: '#7A2BB8', dim: '#FDD0E2', ghostA: '#FF5FA2', ghostB: '#3FB8FF' },
      { bg: '#FFF0A0', fg: '#B01E5E', sub: '#9A4A2A', accent: '#3F8FFF', accent2: '#FF5FA2', ink: '#B01E5E', dim: '#F8E68C', ghostA: '#FF5FA2', ghostB: '#3FB8FF' },
      { bg: '#6A33B0', fg: '#FFF3FA', sub: '#E3C8FF', accent: '#FF8FC8', accent2: '#7FF0E0', ink: '#7FF0E0', dim: '#7439BD', ghostA: '#FF8FC8', ghostB: '#7FF0E0' },
    ],
    fonts: { display: ['potta', 'pop', 'round'], serif: ['kiwi'], body: ['round', 'kiwi'], mono: ['mono'] },
    texture: { grain: 0.15, paper: 0, scan: 0 }, ghost: 0.4,
    bias: {
      layout: { bubbles: 1.8, bounceLine: 1.6, elastic: 1.4, stickerBomb: 1.4, bubble: 1.4, keycaps: 1.2, zigzag: 1.2, wave: 1.2, hanging: 1.1, slotMachine: 1, justified: 0.3, genkou: 0.3, tunnel: 0.3, rain: 0.3 },
      enter: { bounceBig: 1.6, squashDrop: 1.6, rubber: 1.5, pop: 1.4, waveIn: 1.2, spiralIn: 1.1, magnet: 1, glitchIn: 0.2, scramble: 0.3, inkBleed: 0.3 },
      exit: { popOut: 1.6, gravity: 1.3, collapse: 1.2, spinOut: 1.1, scatter: 1.1, burn: 0.2, glitchDissolve: 0.2, melt: 0.4 },
      treat: { outlineFill: 1.5, doubleOutline: 1.5, extrude: 1.2, hardShadow: 1.1, alternate: 1.1, strike: 0.2, hatch: 0.3 },
      bg: { polka: 1.7, sunburst: 1.2, checker: 1, bigStripes: 1, splitDiag: 0.9, tvBars: 0.2, noiseField: 0.2, scanBars: 0.3 },
      cam: { bounce: 1.4, beatPunch: 1.2, stepZoom: 1, dutch: 0.4, shakeHard: 0.4 },
      fx: { zoomPunch: 1.2, whiteFrame: 1.1, gridRepeat: 1.1, panelWipe: 1, pixelDrift: 0.3, crtOff: 0.2, trackingNoise: 0.2 },
    },
    decor: { confetti: 1.6, heartsStars: 1.6, dots: 1, twinkle: 1, shapes: 1, sparks: 0.8, bokeh: 0.5, glitchRects: 0.1, barcode: 0.1 }, hud: false, glow: 0.4,
  },

  /* ---------------------------------------------------------------- アシッド */
  acid: {
    name: 'アシッド', desc: '黒×酸性グリーン×マゼンタ・荒い書体と壊れた画面', moods: ['glitch', 'graphic'],
    schemes: [
      { bg: '#050505', fg: '#C6FF00', sub: '#86A800', accent: '#FF2BD6', accent2: '#FFFFFF', ink: '#C6FF00', dim: '#111A00', ghostA: '#FF2BD6', ghostB: '#3D5BFF' },
      { bg: '#C6FF00', fg: '#050505', sub: '#2A3A00', accent: '#050505', accent2: '#FF2BD6', ink: '#050505', dim: '#B8F000', ghostA: '#FF2BD6', ghostB: '#2B3DFF' },
      { bg: '#FF2BD6', fg: '#050505', sub: '#3A0030', accent: '#C6FF00', accent2: '#050505', ink: '#050505', dim: '#F024C8', ghostA: '#C6FF00', ghostB: '#2B3DFF' },
      { bg: '#0A0A0A', fg: '#FFFFFF', sub: '#9A9A9A', accent: '#C6FF00', accent2: '#FF2BD6', ink: '#FF2BD6', dim: '#171717', ghostA: '#C6FF00', ghostB: '#FF2BD6' },
    ],
    fonts: { display: ['reggae', 'dot', 'dela'], serif: ['mincho_black'], body: ['sansui'], mono: ['dot', 'mono'] },
    texture: { grain: 1, paper: 0, scan: 0.45 }, ghost: 1.25,
    bias: {
      layout: { dotMatrix: 1.6, rain: 1.5, crossBands: 1.4, zoomRepeat: 1.4, tile: 1.4, splitHalves: 1.3, huge: 1.3, slotMachine: 1.1, equalizer: 1.1, condensed: 1.1, hanging: 0.3, bubble: 0.3, quote: 0.3, credits: 0.4 },
      enter: { glitchIn: 1.8, resolve: 1.5, flicker: 1.4, checker: 1.3, vSlice: 1.3, scramble: 1.3, randomOrder: 1.2, slice: 1.2, fadeStagger: 0.3, unroll: 0.3 },
      exit: { glitchDissolve: 1.7, scrambleOut: 1.4, glitch: 1.4, checkerOut: 1.2, melt: 1.2, vSliceDrop: 1.1, dissolve: 0.3, riseOut: 0.4 },
      treat: { echoOutline: 1.5, hatch: 1.3, halftone: 1.2, hardShadow: 1.2, strike: 1.1, softShadow: 0.3, gradientV: 0.4 },
      bg: { noiseField: 1.5, tvBars: 1.3, eqBars: 1.1, bigStripes: 1, scanBars: 1, bokehBg: 0.2, gradientSweep: 0.4 },
      cam: { shakeHard: 1.4, whipIn: 1.2, stepZoom: 1.2, crashZoom: 1.1, handheld: 0.5, tiltUp: 0.5 },
      fx: { pixelDrift: 1.5, posterize: 1.4, tileShift: 1.4, smear: 1.2, invert: 1.2, strobe: 1.1, filmBurn: 0.2, lightSweep: 0.3 },
    },
    decor: { glitchRects: 1.6, qrBlock: 1.2, reticle: 1, barcode: 1, bars: 1, crosshair: 0.8, timecodeBar: 0.7, petals: 0.1, heartsStars: 0.1, confetti: 0.1 }, hud: true, glow: 0.8, glitchBoost: 1.6,
  },

  /* ---------------------------------------------------------------- 墨 */
  sumi: {
    name: '墨と朱', desc: '和紙の生成り・墨の筆文字・朱の落款', moods: ['calm', 'emotional', 'editorial'],
    schemes: [
      { bg: '#EFE5CF', fg: '#16130F', sub: '#5E574C', accent: '#B83A22', accent2: '#16130F', ink: '#16130F', dim: '#E3D8BF', ghostA: '#9A9284', ghostB: '#CC4A2E', paper: true },
      { bg: '#121110', fg: '#EFE8D8', sub: '#9A9286', accent: '#D9402A', accent2: '#EFE8D8', ink: '#EFE8D8', dim: '#1E1C1A', ghostA: '#5C5750', ghostB: '#D9402A', paper: true },
      { bg: '#B3301D', fg: '#FFF6E8', sub: '#FFD2C0', accent: '#16130F', accent2: '#FFF6E8', ink: '#FFF6E8', dim: '#A42B1A', ghostA: '#16130F', ghostB: '#E8A070', paper: true },
      { bg: '#BAB4A7', fg: '#16130F', sub: '#3E3A33', accent: '#A82A18', accent2: '#16130F', ink: '#16130F', dim: '#AFA99C', ghostA: '#6E685E', ghostB: '#B8321E', paper: true },
    ],
    fonts: { display: ['brush', 'mincho_black'], serif: ['brush', 'shippori'], body: ['klee'], mono: ['mono'] },
    texture: { grain: 0.6, paper: 0.8, scan: 0 }, ghost: 0.35,
    bias: {
      layout: { hanko: 2, vcols: 1.8, kanjiFocus: 1.6, columnsBig: 1.4, halfVertical: 1.2, genkou: 1.1, center: 1.2, huge: 1.1, mirror: 0.8, stickerBomb: 0.2, keycaps: 0.2, bubbles: 0.2, neon: 0.2, equalizer: 0.3 },
      enter: { inkBleed: 2, strokeDraw: 1.6, unroll: 1.3, blur: 1.2, fadeStagger: 1.2, stamp: 1, bounceBig: 0.2, rubber: 0.2, neonOn: 0.2 },
      exit: { dissolve: 1.5, drift: 1.4, undraw: 1.3, burn: 1.1, blurOutStagger: 1.2, popOut: 0.2, spinOut: 0.2 },
      treat: { emphasisDots: 1.3, softShadow: 1.1, tall: 1.1, glow: 0.2, extrude: 0.3, alternate: 0.3 },
      bg: { bigChar: 1.5, spotlight: 0.9, splitH: 0.9, ripples: 0.8, retroGrid: 0.1, polka: 0.1, eqBars: 0.1, tvBars: 0.1 },
      cam: { handheld: 1.3, tiltUp: 1.2, dollyIn: 1.2, bounce: 0.3, beatPunch: 0.4 },
      fx: { blackFrame: 1.2, filmBurn: 1.1, whiteFrame: 1, hueShift: 0.2, posterize: 0.3 },
    },
    decor: { brushStroke: 1.8, seal: 1.6, watermarkKanji: 1.2, verticalStrip: 1, blobs: 0.9, petals: 0.4, confetti: 0.1, heartsStars: 0.1, glitchRects: 0.1 }, hud: false, glow: 0.4,
  },

  /* ---------------------------------------------------------------- 金夜 */
  gold: {
    name: '金夜', desc: '漆黒と金箔・象牙の明朝・きらめく光', moods: ['emotional', 'calm', 'editorial'],
    schemes: [
      { bg: '#0A0907', fg: '#F3E7C4', sub: '#B39A62', accent: '#D4AF37', accent2: '#F3E7C4', ink: '#D4AF37', dim: '#17140E', ghostA: '#D4AF37', ghostB: '#7A5230', grad: ['#FFE9A8', '#B8862B'] },
      { bg: '#C9A24A', fg: '#0A0907', sub: '#3A2C12', accent: '#0A0907', accent2: '#FFF4D6', ink: '#0A0907', dim: '#BD9740', ghostA: '#8A5A1A', ghostB: '#3A2C12', grad: ['#2A1E08', '#0A0907'] },
      { bg: '#0B1024', fg: '#F3E7C4', sub: '#A89A78', accent: '#D4AF37', accent2: '#F3E7C4', ink: '#D4AF37', dim: '#141A33', ghostA: '#D4AF37', ghostB: '#3A5AA8', grad: ['#FFE9A8', '#B8862B'] },
      { bg: '#2B0A14', fg: '#F6EBD0', sub: '#C9A987', accent: '#D4AF37', accent2: '#F6EBD0', ink: '#D4AF37', dim: '#38101F', ghostA: '#D4AF37', ghostB: '#9A2A4E', grad: ['#FFE9A8', '#B8862B'] },
    ],
    fonts: { display: ['shippori', 'mincho_light'], serif: ['shippori', 'mincho_light'], body: ['mincho_light'], mono: ['mono'] },
    texture: { grain: 0.6, paper: 0, scan: 0 }, ghost: 0.5,
    bias: {
      layout: { frameBox: 1.6, center: 1.4, kanjiFocus: 1.4, curtain: 1.3, credits: 1.2, circle: 1.2, quote: 1.2, orbit: 1.1, justified: 1, stickerBomb: 0.2, bubbles: 0.3, keycaps: 0.2, slotMachine: 0.3 },
      enter: { trackIn: 1.6, blur: 1.4, blurStagger: 1.3, outlineFill: 1.2, iris: 1.1, riseMask: 1.1, squashDrop: 0.2, rubber: 0.2, glitchIn: 0.3 },
      exit: { trackOutWide: 1.5, blur: 1.4, echoOut: 1.2, zoomFar: 1.1, dissolve: 1.1, popOut: 0.3, gravity: 0.3 },
      treat: { gradientV: 1.6, glow: 1.5, doubleOutline: 1, softShadow: 1, tall: 1, halftone: 0.3, stripes: 0.3 },
      bg: { spotlight: 1.5, bokehBg: 1.3, letterbox: 1.2, particlesBg: 1.1, concentric: 0.9, polka: 0.1, checker: 0.2, eqBars: 0.2 },
      cam: { dollyIn: 1.4, pullOut: 1.2, driftDiag: 1.1, shakeHard: 0.2, bounce: 0.3 },
      fx: { lightSweep: 1.7, filmBurn: 1.1, whiteFrame: 0.8, pixelDrift: 0.2, posterize: 0.2 },
    },
    decor: { twinkle: 1.4, bokeh: 1.2, lightLeak: 1, constellation: 1, concentricSquares: 0.8, cropMarks: 0.5, glitchRects: 0.1, qrBlock: 0.1 }, hud: false, glow: 1.7, useGrad: true,
  },

  /* ---------------------------------------------------------------- CINEMATIC (Blade Cinema) */
  bladeCinema: {
    name: 'シネマティック', desc: '映画の暗部・アンバーとシアンの光学光条・アナモルフィック描写', moods: ['emotional', 'editorial'],
    schemes: [
      { bg: '#070B12', fg: '#F4EFE6', sub: '#9AB0C4', accent: '#FF7B2E', accent2: '#2BE0E8', ink: '#FF7B2E', dim: '#111927', ghostA: '#2BE0E8', ghostB: '#FF5E2B', grad: ['#FFB36B', '#2BE0E8'] },
      { bg: '#0A1318', fg: '#EBF4F6', sub: '#7CA3B2', accent: '#FFB038', accent2: '#32D2E2', ink: '#FFB038', dim: '#14232B', ghostA: '#32D2E2', ghostB: '#FF8A2B' },
      { bg: '#0D0D10', fg: '#F5F2EA', sub: '#99958C', accent: '#E63B2E', accent2: '#C8B288', ink: '#E63B2E', dim: '#19191E', ghostA: '#4BB8D8', ghostB: '#E65B3A' },
      { bg: '#1D120C', fg: '#FFF0D6', sub: '#C79B74', accent: '#FF8828', accent2: '#46CBD8', ink: '#FF8828', dim: '#2B1B12', ghostA: '#46CBD8', ghostB: '#FF6A1A' },
    ],
    fonts: { display: ['mincho_black', 'gothic_bold', 'tokumin'], serif: ['shippori', 'mincho'], body: ['gothic_med'], mono: ['mono'] },
    texture: { grain: 0.65, paper: 0, scan: 0.15 }, ghost: 0.72,
    bias: {
      layout: { credits: 2.0, curtain: 1.9, lowerThird: 1.8, frameBox: 1.7, depthStack: 1.6, perspective: 1.5, filmstrip: 1.5, vcols: 1.4, center: 1.4, huge: 1.3, rain: 1.2 },
      enter: { trackIn: 2.0, blurStagger: 1.8, blur: 1.7, iris: 1.6, shutter: 1.6, backlight: 1.6, lightLeak: 1.5, fadeStagger: 1.5, riseMask: 1.4, zoom: 1.3, glint: 1.3 },
      exit: { trackOutWide: 2.0, dissolve: 1.8, zoomThrough: 1.6, zoomFar: 1.6, blurOutStagger: 1.6, irisClose: 1.5, drift: 1.5, lampOff: 1.3, xjFocusPull: 1.5 },
      hold: { focusRack: 2.0, xkFocusBreath: 1.8, xkParallax: 1.8, xkDepthRock: 1.6, drift: 1.6, breathe: 1.5, glintSweep: 1.4, zoomSlow: 1.4, jitter: 0.2, glitchtick: 0.2 },
      treat: { softShadow: 1.7, glow: 1.6, gradientV: 1.5, wide: 1.4, tall: 1.3, focusPull: 1.5, fadeChars: 1.3 },
      bg: { letterbox: 2.0, rainWindow: 1.8, skyline: 1.7, horizonGlow: 1.6, godRays: 1.7, spotlight: 1.6, filmStrip: 1.5, bokehBg: 1.4, vignettePulse: 1.4, noiseField: 1.1 },
      cam: { dollyIn: 1.9, pullOut: 1.8, rackFocus: 1.9, orbitDrift: 1.7, panL: 1.5, panR: 1.5, tiltUp: 1.5, xqArcSweep: 1.7, xqCraneUp: 1.7, xqLongLens: 1.6, xqPushPull: 1.6 },
      fx: { anamorphic: 2.0, lightRays: 1.9, filmAdvance: 1.7, dustScratches: 1.6, lightSweep: 1.7, filmBurn: 1.5, defocus: 1.5, bloomFlash: 1.4, chroma: 1.4 },
      trans: { irisOpen: 1.9, xqBladeRun: 2.0, xqLightLeak: 1.8, xqSoftSweep: 1.7, zoomThrough: 1.6, doorsOpen: 1.4, wipe: 1.2 },
    },
    decor: { timecodeBar: 1.7, lightLeak: 1.6, bokeh: 1.5, cropMarks: 1.3, crosshair: 1.1, reticle: 1.1, starField: 0.8, confetti: 0.1 }, hud: false, glow: 1.55, useGrad: true,
  },

  /* ---------------------------------------------------------------- MUSIC VIDEO (Stage Prism) */
  stagePrism: {
    name: 'ミュージックMV', desc: 'ステージの照明・重低音パンチ・高速キネティック・ネオンの残像', moods: ['pop', 'emotional', 'glitch'],
    schemes: [
      { bg: '#090614', fg: '#FFFFFF', sub: '#C6B4E8', accent: '#FF2D8F', accent2: '#2CF2FF', ink: '#FF2D8F', dim: '#160F2E', ghostA: '#2CF2FF', ghostB: '#FF2D8F', grad: ['#FF4AA8', '#3BE8FF'] },
      { bg: '#0C0C0E', fg: '#F7F7F7', sub: '#9C9CA8', accent: '#FFCC29', accent2: '#9E6BFF', ink: '#FFCC29', dim: '#1A1A20', ghostA: '#9E6BFF', ghostB: '#FFCC29', grad: ['#FFE36E', '#FF8E2B'] },
      { bg: '#1B0B2E', fg: '#FFF2FA', sub: '#CFA8E8', accent: '#FF6B9D', accent2: '#75F0FF', ink: '#FF6B9D', dim: '#281242', ghostA: '#75F0FF', ghostB: '#FF4B82', grad: ['#FF80B5', '#7F5CFF'] },
      { bg: '#0D26D4', fg: '#FFFFFF', sub: '#B8C6FF', accent: '#E8FF3B', accent2: '#FF4FC3', ink: '#E8FF3B', dim: '#1532F0', ghostA: '#FF4FC3', ghostB: '#3BFFEA' },
    ],
    fonts: { display: ['dela', 'gothic_black', 'zenkaku'], serif: ['tokumin', 'mincho_black'], body: ['gothic_bold'], mono: ['mono'] },
    texture: { grain: 0.35, paper: 0, scan: 0.1 }, ghost: 0.85,
    bias: {
      layout: { equalizer: 2.0, marquee: 1.9, huge: 1.8, neon: 1.8, mirror: 1.7, splitScreen: 1.6, ring: 1.5, pill: 1.5, zoomRepeat: 1.6, xdKaraoke: 1.8, xdFourUp: 1.6, xdSkyline: 1.5 },
      enter: { whip: 2.0, zoom: 1.9, pop: 1.8, bounceBig: 1.7, rubber: 1.6, neonOn: 1.8, echoIn: 1.7, knWordSlam: 1.9, knPushIn: 1.8, knDiveIn: 1.7, xgPumpUp: 1.8, xfEqualizer: 1.8 },
      exit: { whipOut: 1.9, zoomThrough: 1.9, popOut: 1.7, echoOut: 1.7, scatter: 1.6, knWordKick: 1.8, knPushOut: 1.7, xjPuckHit: 1.6, spinOut: 1.5 },
      hold: { beatHop: 2.0, heartbeat: 1.9, eqBounce: 1.9, pulse: 1.8, stretchPulse: 1.7, xkBeatBump: 2.0, xkLoudWeight: 1.8, xkKaraoke: 1.9, knWordPulse: 1.8, knBeatLean: 1.7 },
      treat: { glow: 1.9, neonOutline: 1.8, chrome: 1.7, gradientSweep: 1.7, extrude: 1.5, knWordScale: 1.8, knWordPlate: 1.6, karaoke: 1.7 },
      bg: { eqBars: 2.0, spotlight: 1.9, auroraRibbons: 1.7, sunburst: 1.6, gradientSweep: 1.6, duotoneSweep: 1.6, particlesBg: 1.5, xpPlexus: 1.5 },
      cam: { beatPunch: 2.0, whipIn: 1.9, crashZoom: 1.8, stepZoom: 1.7, bounce: 1.7, xqBeatBreath: 1.9, xqHeartbeat: 1.8, xqWhipSpring: 1.9, xqLoudZoom: 1.8, knRushIn: 1.7 },
      fx: { zoomPunch: 2.0, bloomFlash: 1.8, rgbSplit: 1.7, flash: 1.7, strobe: 1.6, heartbeat: 1.7, speedLines: 1.6, xrSpotlight: 1.8, xrColorStrobe: 1.7, xrBandZoom: 1.7 },
      trans: { whipPan: 2.0, flashCross: 1.9, zoomThrough: 1.8, cubeTurn: 1.7, xqChevronPush: 1.8, xqRingRipple: 1.7, pushSlide: 1.6, knStripSlam: 1.7 },
    },
    decor: { beatRing: 1.9, sparks: 1.7, lineBurst: 1.6, knSpeedTrail: 1.6, waveform: 1.6, bars: 1.5, spectrumRing: 1.6, twinkle: 1.2 }, hud: true, glow: 1.65, glitchBoost: 1.15, useGrad: true,
  },

  /* ---------------------------------------------------------------- ART & MOTION (Kinetic Pop 3D) */
  kineticPop: {
    name: 'アート＆モーション', desc: 'キネティック・ポップアート・3D立体タイル・鮮やかなグリッチ演出', moods: ['graphic', 'glitch', 'pop'],
    schemes: [
      { bg: '#F4F1EA', fg: '#121318', sub: '#565965', accent: '#FF3621', accent2: '#1D4ED8', ink: '#121318', dim: '#E5E0D5', ghostA: '#1D4ED8', ghostB: '#FF3621', paper: true },
      { bg: '#111216', fg: '#F7F5EE', sub: '#9FA3B0', accent: '#FFCF24', accent2: '#FF3D7F', ink: '#FFCF24', dim: '#1E2028', ghostA: '#2CE0FF', ghostB: '#FF3D7F' },
      { bg: '#1238B8', fg: '#FFFDF5', sub: '#B8CAFF', accent: '#FFE628', accent2: '#FF3B7F', ink: '#121318', dim: '#1A44CC', ghostA: '#FFE628', ghostB: '#FF3B7F' },
      { bg: '#ECEAE4', fg: '#0E0F12', sub: '#585A62', accent: '#6B21FF', accent2: '#00C2A8', ink: '#0E0F12', dim: '#DFDCD4', ghostA: '#00C2A8', ghostB: '#6B21FF', paper: true },
    ],
    fonts: { display: ['dela', 'rampart', 'gothic_black'], serif: ['mincho_black'], body: ['gothic_bold'], mono: ['mono', 'dot'] },
    texture: { grain: 0.4, paper: 0.35, scan: 0 }, ghost: 0.78,
    bias: {
      layout: { xbIsoStack: 2.0, perspective: 1.9, diag: 1.8, stickerBomb: 1.8, flipBoard: 1.7, crossBands: 1.7, tunnel: 1.6, xbTwistFrames: 1.8, xbDonut: 1.7, xbHoneycomb: 1.7, xbCompGrid: 1.7, xdHelix: 1.8, xdPivotFan: 1.7, cube: 1.7 },
      enter: { knWordSpin: 2.0, knStretchOut: 1.9, knHingeDrop: 1.8, flipX: 1.8, flipY: 1.8, domino: 1.8, fold: 1.7, squashDrop: 1.7, glitchIn: 1.7, slice: 1.6, vSlice: 1.6, xePieceVortex: 1.8, xeGearTick: 1.8 },
      exit: { flipOutX: 1.8, flipOutY: 1.8, foldOut: 1.8, shatterLite: 1.8, vSliceDrop: 1.7, glitchDissolve: 1.7, explode: 1.6, dominoOut: 1.7, xjQuarterTurn: 1.8, xhConcertina: 1.7 },
      hold: { skewWobble: 1.9, rotateSlow: 1.8, orbitSmall: 1.7, xkZigzagFlip: 1.9, xkSpinOne: 1.8, xkParallax: 1.7, kzSquashWave: 1.8, kzSlinky: 1.8, flipSwap: 1.7, glitchtick: 1.5 },
      treat: { extrude: 1.9, longShadow: 1.8, hardShadow: 1.8, outlineFill: 1.7, doubleOutline: 1.7, halftone: 1.6, stripes: 1.6, splitColor: 1.6, xoBandExtrude: 1.7 },
      bg: { isoCubes: 2.0, triTess: 1.9, moire: 1.8, checker: 1.7, polka: 1.6, halftoneFade: 1.6, xpFoldPlanes: 1.8, xpLissajous: 1.8, kzBigGears: 1.8, xpShiftRows: 1.7 },
      cam: { barrelRoll: 1.9, roll: 1.8, dutch: 1.7, knTiltKick: 1.9, knCardFlip: 1.8, knShearKick: 1.8, xqTickRoll: 1.8, xqDriftTurn: 1.7, kzRecoil: 1.7 },
      fx: { perspectiveTilt: 2.0, kaleido: 1.8, halftone: 1.7, duotone: 1.7, pixelSort: 1.7, shatter: 1.7, xrQuadCycle: 1.9, xrFlipTiles: 1.8, xrAccordion: 1.8, xrRibbonTwist: 1.8, kzCardSlam: 1.7 },
      trans: { cubeTurn: 2.0, shatterTiles: 1.9, sliceShift: 1.8, diagonalWipe: 1.7, spinOut: 1.7, knCornerSwing: 1.8, xqAccordion: 1.9, xqFlipOver: 1.9, xqPropeller: 1.8 },
    },
    decor: { xmMoire: 1.8, xmSpiro: 1.8, xmIsoCubes: 1.8, xmGears: 1.7, xmPendulum: 1.6, glitchRects: 1.5, shapes: 1.6, triangleSpin: 1.5, memphis: 1.5 }, hud: false, glow: 0.85, glitchBoost: 1.25,
  },

  /* ---------------------------------------------------------------- FUTURISTIC (Cyber AI) */
  cyberAi: {
    name: 'フューチャリスティック', desc: 'サイバーパンク・SF・ホログラフィックAI・高精度HUDとスキャン演出', moods: ['glitch', 'graphic', 'pop'],
    schemes: [
      { bg: '#040812', fg: '#E6FAFF', sub: '#6BA7C4', accent: '#00F0FF', accent2: '#9D4EDD', ink: '#00F0FF', dim: '#0B1426', ghostA: '#00F0FF', ghostB: '#FF2A9D', grad: ['#00F0FF', '#9D4EDD'] },
      { bg: '#080510', fg: '#F4FFE8', sub: '#92A89C', accent: '#39FF88', accent2: '#FF2496', ink: '#39FF88', dim: '#120C22', ghostA: '#39FF88', ghostB: '#FF2496' },
      { bg: '#07111C', fg: '#FFFFFF', sub: '#7EAAC7', accent: '#3B9EFF', accent2: '#42FFE0', ink: '#42FFE0', dim: '#0E1E30', ghostA: '#42FFE0', ghostB: '#5B6EFF' },
      { bg: '#0A061A', fg: '#F3EEFF', sub: '#9B89CE', accent: '#B86BFF', accent2: '#00F5D4', ink: '#00F5D4', dim: '#140E30', ghostA: '#00F5D4', ghostB: '#B86BFF' },
    ],
    fonts: { display: ['dot', 'gothic_bold', 'zenkaku'], serif: ['mincho_bold'], body: ['sansui'], mono: ['mono', 'dot'] },
    texture: { grain: 0.45, paper: 0, scan: 0.65 }, ghost: 1.0,
    bias: {
      layout: { neon: 2.0, tunnel: 1.9, dotMatrix: 1.9, labels: 1.7, xcBrowser: 1.7, xcGauge: 1.8, xcLoading: 1.8, xbCrosshair: 1.9, xbDial: 1.8, xdConstellation: 1.8, ledScroll: 1.7 },
      enter: { neonOn: 2.0, scramble: 1.9, resolve: 1.9, matrixRain: 1.9, crtOn: 1.8, interlace: 1.7, loadingBar: 1.8, odometer: 1.7, dither: 1.6, flicker: 1.6, xfScanner: 1.9, xfPrintHead: 1.7 },
      exit: { matrixOut: 1.9, scanOut: 1.9, glitch: 1.8, glitchDissolve: 1.8, scrambleOut: 1.8, rgbSplitOut: 1.8, xhBarcode: 1.7, xiInverseBand: 1.7 },
      hold: { scanBand: 2.0, glowFlicker: 1.8, echoTrail: 1.8, glitchtick: 1.7, colorRun: 1.7, xkMagnifier: 1.8, tyReadCursor: 1.7, xkDoubleVision: 1.8, tyOutlineBlink: 1.6 },
      treat: { neonOutline: 2.0, glow: 1.9, glitchSplit: 1.8, monoGrid: 1.8, chrome: 1.7, echoOutline: 1.6, inline: 1.5 },
      bg: { retroGrid: 2.0, hexGrid: 1.9, squareTunnel: 1.9, xpDepthGrid: 1.9, xpRadar: 1.9, xpScanner: 1.9, xpPlexus: 1.8, xpLoadBars: 1.8, xpSevenSeg: 1.7, starfield: 1.6, scanBars: 1.6 },
      cam: { vertigo: 1.8, spiralIn: 1.8, focusIn: 1.8, snapPan: 1.7, push: 1.4, xqArcSweep: 1.8, xqFocusHunt: 1.9, stepZoom: 1.7, xqTripodNudge: 1.6 },
      fx: { chroma: 2.0, radialChroma: 1.9, rgbSplit: 1.9, crtOff: 1.8, vhsRoll: 1.7, trackingNoise: 1.6, edgeDetect: 1.7, macroBlock: 1.7, scanBar: 1.8, ditherBit: 1.6, xrScanBurst: 1.9, xrCrosshair: 1.8, xrMoire: 1.7 },
      trans: { irisOpen: 1.8, xqBladeRun: 2.0, xqPolyIris: 1.9, pixelate: 1.8, blockDissolve: 1.8, flashCross: 1.7, knStripSlam: 1.7 },
    },
    decor: { reticle: 1.9, crosshair: 1.8, barcode: 1.7, qrBlock: 1.6, xmGauge: 1.8, xnLevelMeter: 1.8, xnTimeline: 1.7, xnAsciiGauge: 1.7, radar: 1.8, circuit: 1.8, spinner: 1.6, dataColumns: 1.6 }, hud: true, glow: 1.85, glitchBoost: 1.3, useGrad: true,
  },

  /* ---------------------------------------------------------------- LIFESTYLE (Atelier Lux) */
  atelierLux: {
    name: 'ライフスタイル', desc: 'ラグジュアリー・ファッション・旅とドキュメンタリーのための洗練された余白と光', moods: ['editorial', 'calm', 'emotional'],
    schemes: [
      { bg: '#0E0D0B', fg: '#F7F1E3', sub: '#B8AA90', accent: '#D8B467', accent2: '#F7F1E3', ink: '#D8B467', dim: '#1A1814', ghostA: '#D8B467', ghostB: '#9E8564', grad: ['#F2D99A', '#B89146'] },
      { bg: '#F6F2EA', fg: '#1B1917', sub: '#787166', accent: '#9E7340', accent2: '#2E4C4A', ink: '#1B1917', dim: '#EAE4D8', ghostA: '#C29B6B', ghostB: '#5B7C79', paper: true },
      { bg: '#EAE3D6', fg: '#1F2A26', sub: '#5E6D66', accent: '#B66038', accent2: '#2C5C68', ink: '#1F2A26', dim: '#DFD7C8', ghostA: '#B66038', ghostB: '#2C5C68', paper: true },
      { bg: '#101420', fg: '#F5EFE6', sub: '#9AA3B5', accent: '#E2C088', accent2: '#7CA5B8', ink: '#E2C088', dim: '#192032', ghostA: '#E2C088', ghostB: '#7CA5B8' },
    ],
    fonts: { display: ['shippori', 'mincho_light', 'gothic_light'], serif: ['shippori', 'mincho'], body: ['mincho_light'], mono: ['mono'] },
    texture: { grain: 0.4, paper: 0.4, scan: 0 }, ghost: 0.38,
    bias: {
      layout: { gloss: 2.0, columnsBig: 1.9, justified: 1.8, quote: 1.8, dropCap: 1.7, lowerThird: 1.7, vcols: 1.6, frameBox: 1.7, center: 1.5, arcTop: 1.4, typeSpecimen: 1.6, filmstrip: 1.4, magazine: 1.7 },
      enter: { trackIn: 2.0, fadeStagger: 1.9, blurStagger: 1.8, wipe: 1.7, unroll: 1.6, lightLeak: 1.6, glint: 1.6, riseMask: 1.5, cursorSweep: 1.5, strokeDraw: 1.4, tyLineWipe: 1.6 },
      exit: { trackOutWide: 2.0, dissolve: 1.9, drift: 1.8, blurOutStagger: 1.7, sweepCover: 1.6, sinkMask: 1.5, wipe: 1.5, undraw: 1.4 },
      hold: { breathe: 2.0, drift: 1.9, shimmer: 1.8, glintSweep: 1.8, shadowSway: 1.6, focusRack: 1.7, xkFocusBreath: 1.9, xkTallBreath: 1.7, still: 1.3, jitter: 0.1, glitchtick: 0.1 },
      treat: { softShadow: 1.9, gradientV: 1.8, wide: 1.7, emphasisDots: 1.5, underline: 1.5, fadeChars: 1.4, kerningWide: 1.6, toneShadow: 1.5 },
      bg: { marble: 1.9, oceanWaves: 1.7, mountains: 1.6, horizonGlow: 1.8, bokehBg: 1.8, particlesBg: 1.5, gradientSweep: 1.7, spotlight: 1.6, borderFrame: 1.5 },
      cam: { dollyIn: 1.9, pullOut: 1.8, driftDiag: 1.8, panL: 1.6, panR: 1.6, tiltUp: 1.6, handheld: 1.5, xqWalkCam: 1.7, xqLongLens: 1.7, xqLevelOut: 1.6 },
      fx: { lightSweep: 2.0, filmBurn: 1.6, whiteFrame: 1.7, defocus: 1.6, lightRays: 1.6, dustScratches: 1.3 },
      trans: { xqSoftSweep: 2.0, xqLightLeak: 1.9, xqPagePeel: 1.8, wipe: 1.6, cover: 1.5, uncover: 1.5, irisOpen: 1.4 },
    },
    decor: { leaders: 1.8, cropMarks: 1.7, rulerEdge: 1.5, lightLeak: 1.7, bokeh: 1.6, twinkle: 1.3, constellation: 1.3, dateStamp: 1.4, swatches: 1.5 }, hud: false, glow: 1.25, useGrad: true,
  },

  /* ---------------------------------------------------------------- ANIMATION (Anime Prism) */
  animePrism: {
    name: 'アニメーション', desc: 'アニメ・カートゥーン・ファンタジー・シュールレアリスムの流麗なモーション', moods: ['pop', 'emotional', 'calm'],
    schemes: [
      { bg: '#161436', fg: '#FFF9FF', sub: '#C4BAF0', accent: '#FF70A6', accent2: '#4CE8E0', ink: '#FF70A6', dim: '#221F4E', ghostA: '#4CE8E0', ghostB: '#FF70A6', grad: ['#FF92C2', '#5EEAD4'] },
      { bg: '#FDF4F8', fg: '#2F1D52', sub: '#79609E', accent: '#E84388', accent2: '#2BB3D6', ink: '#2F1D52', dim: '#F5E6EE', ghostA: '#FF74AD', ghostB: '#48C9E8', paper: true },
      { bg: '#2068C8', fg: '#FFFFFF', sub: '#C8E2FF', accent: '#FFE047', accent2: '#FF5B6E', ink: '#1B2850', dim: '#2874D6', ghostA: '#FFE047', ghostB: '#FF5B6E' },
      { bg: '#0D1E2B', fg: '#F2FFF9', sub: '#8EC4B8', accent: '#7DFF9E', accent2: '#FF8CE0', ink: '#7DFF9E', dim: '#152C3D', ghostA: '#7DFF9E', ghostB: '#FF8CE0', grad: ['#7DFF9E', '#FF8CE0'] },
    ],
    fonts: { display: ['kiwi', 'potta', 'pop'], serif: ['shippori'], body: ['round'], mono: ['mono'] },
    texture: { grain: 0.25, paper: 0.15, scan: 0 }, ghost: 0.65,
    bias: {
      layout: { bubbles: 2.0, bounceLine: 1.9, elastic: 1.9, wave: 1.8, orbit: 1.8, arcTop: 1.7, rain: 1.6, stickerBomb: 1.6, xdWindSway: 1.9, xdSpiralEcho: 1.8, xdRipple: 1.8, xdHelix: 1.7, balloons: 1.7 },
      enter: { squashDrop: 2.0, rubber: 1.9, bounceBig: 1.9, waveIn: 1.9, spiralIn: 1.8, inkBleed: 1.7, strokeDraw: 1.7, fanOpen: 1.6, windBlown: 1.8, bubbles: 1.8, xgJelly: 1.9, xeLeapfrog: 1.8, xeArcToss: 1.8 },
      exit: { popOut: 1.9, melt: 1.8, balloonOff: 1.8, deflateOut: 1.7, flutterOut: 1.8, tornadoOut: 1.7, fanClose: 1.6, xjRubberSnap: 1.9, xjSpringHop: 1.8, riseOut: 1.7 },
      hold: { jelly: 2.0, float: 1.9, sway: 1.9, wave: 1.9, hWave: 1.8, windGust: 1.8, dangle: 1.7, xkBuoy: 1.9, xkCradle: 1.8, xkDoubleVision: 1.7, kzSquashWave: 1.8 },
      treat: { rainbow: 1.9, outlineFill: 1.8, doubleOutline: 1.8, sticker: 1.7, circled: 1.7, waterline: 1.6, sizeWave: 1.7, glow: 1.6 },
      bg: { auroraRibbons: 2.0, meshBlobs: 1.9, starfield: 1.8, cloudLayers: 1.8, fireworks: 1.7, snowLayers: 1.6, kaleidoscope: 1.7, spiralArms: 1.7, sunburst: 1.6, oceanWaves: 1.6 },
      cam: { bounce: 1.9, floatNoise: 1.9, jelly: 1.9, spiralIn: 1.8, orbitDrift: 1.8, pendulumSway: 1.8, xqLeafFall: 1.9, xqSquashRelax: 1.9, xqWhipSpring: 1.8 },
      fx: { kaleido: 1.9, waveWarp: 1.9, ripple: 1.9, starGlint: 1.8, focusLines: 1.8, speedLines: 1.8, hueShift: 1.7, bloomFlash: 1.7, xrWaterMirror: 1.8, xrSwingEcho: 1.8, kzShockArcs: 1.7 },
      trans: { inkBlob: 1.9, xqWaveWipe: 2.0, xqRingRipple: 1.9, xqStretchSmear: 1.9, spinOut: 1.7, clockWipe: 1.6 },
    },
    decor: { petals: 1.8, twinkle: 1.9, sparks: 1.7, confetti: 1.6, heartsStars: 1.7, risingParticles: 1.7, bokeh: 1.6, lineBurst: 1.6, constellation: 1.5, fireflies: 1.8, cloudPuffs: 1.6 }, hud: false, glow: 1.5, useGrad: true,
  },
};

for (const [k, v] of Object.entries(S)) {
  if (J.STYLES[k]) continue;              // never overwrite a core style
  J.STYLES[k] = v;
  if (!J.STYLE_ORDER.includes(k)) J.STYLE_ORDER.push(k);
}
})();
