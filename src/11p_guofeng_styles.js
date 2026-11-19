/* ============================================================================
   ALEXURA STUDIO — 11p_guofeng_styles.js
   国风古典美学馆：30 款独特中国风 / 中国古代风格，各有专属性格、配色、字体与精致国风技法
   ============================================================================ */
(() => {
'use strict';

if (!J || !J.STYLES) return;
if (!J.STYLE_CATS) J.STYLE_CATS = {};
if (!J.STYLE_CATS.guofeng) J.STYLE_CATS.guofeng = [];

const lum = hex => J.lum ? J.lum(hex) : 0.5;
const normBg = c => J.mix(c, '#0E0B0A', 0.14);

function buildSchemes(bg, fg, accent, accent2, altBg, altFg, paper, useGrad) {
  const dark = lum(bg) < 0.45;
  const ink = dark ? '#090707' : '#241812';
  const sub = J.mix(fg, bg, 0.42);
  const ghostA = accent;
  const ghostB = accent2;
  const s1 = { bg, fg, sub, accent, accent2, ghostA, ghostB, ink, lum: lum(bg), paper: !!paper };
  if (useGrad) s1.grad = [bg, J.mix(bg, accent, dark ? 0.24 : 0.12), dark ? normBg(bg) : J.mix(bg, accent2, 0.10)];

  const s2bg = altBg || (dark ? J.mix(bg, accent2, 0.16) : J.mix(bg, '#EBDAC2', 0.35));
  const s2Dark = lum(s2bg) < 0.45;
  const s2fg = altFg || (s2Dark === dark ? fg : (s2Dark ? '#F8F2E8' : '#1E1410'));
  const s2ac1 = J.contrast(accent2, s2bg) >= 2.2 ? accent2 : (s2Dark ? '#E8C56E' : '#B82A22');
  const s2ac2 = J.contrast(accent, s2bg) >= 2.2 ? accent : (s2Dark ? '#5CB8A8' : '#244A7C');
  const s2 = {
    bg: s2bg, fg: s2fg, sub: J.mix(s2fg, s2bg, 0.42),
    accent: s2ac1, accent2: s2ac2, ghostA: s2ac1, ghostB: s2ac2,
    ink: s2Dark ? '#0A0807' : '#1E1510', lum: lum(s2bg), paper: !s2Dark || !!paper,
  };
  if (useGrad) s2.grad = [s2bg, J.mix(s2bg, s2ac1, s2Dark ? 0.2 : 0.12), s2bg];

  // Authentic Xuan paper / lacquer companion variant
  const s3bg = dark ? '#F3EAE0' : J.mix(accent, '#0C0A09', 0.84);
  const s3Dark = lum(s3bg) < 0.45;
  const s3fg = s3Dark ? '#F8F2E8' : '#1E1410';
  const s3ac = J.contrast(accent, s3bg) >= 2.2 ? accent : (s3Dark ? '#E8C56E' : '#B82A22');
  const s3ac2 = J.contrast(accent2, s3bg) >= 2.2 ? accent2 : (s3Dark ? '#5CB8A8' : '#244A7C');
  const s3 = {
    bg: s3bg, fg: s3fg, sub: J.mix(s3fg, s3bg, 0.4),
    accent: s3ac, accent2: s3ac2, ghostA: s3ac, ghostB: s3ac2,
    ink: s3Dark ? '#080605' : '#1B110D', lum: lum(s3bg), paper: !s3Dark || !!paper,
  };
  return [s1, s2, s3];
}

/* 8 组古典技艺原型（每种风格再叠加专属倾向） */
const ARCH = {
  shanshui: {
    moods: ['calm', 'emotional', 'editorial'],
    texture: { grain: 0.42, paper: 0.72, scan: 0 },
    ghost: 0.38, glow: 0.55,
    fonts: { display: ['gf_mashanzheng', 'gf_noto_serif_sc', 'brush'], serif: ['gf_noto_serif_tc', 'tokumin', 'shippori'], body: ['gf_zhimangxing', 'klee', 'mincho'], mono: ['mono'] },
    bias: {
      layout: { vcols: 2.5, kanjiFocus: 2.3, columnsBig: 2.0, frameBox: 1.9, center: 1.8, lowerThird: 1.7 },
      enter: { inkBleed: 2.4, strokeDraw: 2.3, unroll: 2.2, blurStagger: 2.0, fadeStagger: 1.9, riseMask: 1.8 },
      exit: { dissolve: 2.3, drift: 2.2, undraw: 2.0, blurOutStagger: 1.9, trackOutWide: 1.8 },
      hold: { drift: 2.3, breathe: 2.2, xkFocusBreath: 2.0, focusRack: 1.9, xkParallax: 1.8 },
      treat: { gfTreatInkSplash: 2.8, gfTreatCinnabarSeal: 2.3, softShadow: 2.0, gradientV: 1.8, fadeChars: 1.8 },
      bg: { gfBgShanShui: 3.0, mountains: 2.2, cloudLayers: 1.9, horizonGlow: 1.7, oceanWaves: 1.6 },
      cam: { dollyIn: 2.1, panL: 2.0, panR: 2.0, orbitDrift: 1.9, xqLongLens: 1.9, pullOut: 1.8 },
      fx: { gfFxInkMist: 2.8, gfFxScrollEdge: 2.2, lightSweep: 1.9, defocus: 1.7 },
      trans: { gfTransScrollUnroll: 2.9, gfTransInkWashDissolve: 2.6, inkBlob: 2.1, xqSoftSweep: 1.9 },
    },
    decor: { gfDecoSealStamp: 2.8, gfDecoCloudMotif: 2.4, seal: 2.2, brushStroke: 2.1, watermarkKanji: 1.9, cloudPuffs: 1.6 },
  },
  palace: {
    moods: ['editorial', 'emotional', 'calm'],
    texture: { grain: 0.34, paper: 0.32, scan: 0 },
    ghost: 0.45, glow: 1.15,
    fonts: { display: ['gf_noto_serif_sc', 'gf_mashanzheng', 'mincho_black'], serif: ['gf_noto_serif_tc', 'tokumin', 'shippori'], body: ['gf_mashanzheng', 'mincho_bold'], mono: ['mono'] },
    bias: {
      layout: { frameBox: 2.5, columnsBig: 2.3, kanjiFocus: 2.2, vcols: 2.1, dropCap: 2.0, quote: 1.9, center: 1.8 },
      enter: { unroll: 2.4, trackIn: 2.2, glint: 2.1, riseMask: 2.0, fadeStagger: 1.9, strokeDraw: 1.9 },
      exit: { trackOutWide: 2.2, dissolve: 2.1, sweepCover: 2.0, blurOutStagger: 1.8, drift: 1.8 },
      hold: { glintSweep: 2.3, shimmer: 2.2, breathe: 2.0, xkParallax: 1.9, focusRack: 1.8 },
      treat: { gfTreatGoldLacquer: 2.9, gfTreatCinnabarSeal: 2.4, softShadow: 2.0, gradientV: 1.9, outline: 1.8 },
      bg: { gfBgPalaceLattice: 3.0, borderFrame: 2.1, spotlight: 1.9, horizonGlow: 1.8 },
      cam: { dollyIn: 2.2, tiltUp: 2.0, pullOut: 2.0, xqLongLens: 1.9, orbitDrift: 1.8 },
      fx: { gfFxScrollEdge: 2.8, gfFxGoldLeafFloat: 2.6, lightSweep: 2.2, lightRays: 2.0, bloomFlash: 1.8 },
      trans: { gfTransScrollUnroll: 2.9, gfTransFoldingFan: 2.5, xqSoftSweep: 2.0, irisOpen: 1.9 },
    },
    decor: { gfDecoLanternTag: 2.8, gfDecoSealStamp: 2.5, gfDecoCloudMotif: 2.4, seal: 2.0, twinkle: 1.8, lightLeak: 1.7 },
  },
  porcelain: {
    moods: ['calm', 'editorial', 'graphic'],
    texture: { grain: 0.22, paper: 0.45, scan: 0 },
    ghost: 0.32, glow: 0.72,
    fonts: { display: ['gf_noto_serif_tc', 'gf_noto_serif_sc', 'shippori'], serif: ['gf_noto_serif_sc', 'tokumin', 'mincho_bold'], body: ['klee', 'gf_mashanzheng', 'mincho'], mono: ['mono'] },
    bias: {
      layout: { center: 2.4, vcols: 2.3, frameBox: 2.2, quote: 2.1, lowerThird: 1.9, columnsBig: 1.9 },
      enter: { inkBleed: 2.3, strokeDraw: 2.3, blurStagger: 2.1, fadeStagger: 2.1, glint: 1.9 },
      exit: { dissolve: 2.3, undraw: 2.1, drift: 2.0, blurOutStagger: 1.9, sinkMask: 1.8 },
      hold: { breathe: 2.3, shimmer: 2.2, xkFocusBreath: 2.1, float: 2.0, glintSweep: 1.9 },
      treat: { gfTreatPorcelainRim: 3.0, gfTreatJadeCarving: 2.3, gradientV: 2.0, wide: 1.9, emphasisDots: 1.8 },
      bg: { gfBgPorcelainWave: 3.0, oceanWaves: 2.3, cloudLayers: 1.9, bokehBg: 1.8 },
      cam: { orbitDrift: 2.1, dollyIn: 2.0, xqArcSweep: 2.0, pullOut: 1.9, panL: 1.8 },
      fx: { gfFxScrollEdge: 2.4, gfFxInkMist: 2.2, ripple: 2.1, lightSweep: 1.9, defocus: 1.7 },
      trans: { gfTransInkWashDissolve: 2.8, xqWaveWipe: 2.3, xqSoftSweep: 2.1, gfTransScrollUnroll: 2.0 },
    },
    decor: { gfDecoCloudMotif: 2.9, gfDecoSealStamp: 2.3, cloudPuffs: 1.9, seal: 1.8, rings: 1.7 },
  },
  dunhuang: {
    moods: ['emotional', 'pop', 'editorial'],
    texture: { grain: 0.45, paper: 0.52, scan: 0 },
    ghost: 0.62, glow: 1.45,
    fonts: { display: ['gf_zhimangxing', 'gf_mashanzheng', 'gf_noto_serif_sc'], serif: ['gf_noto_serif_tc', 'tokumin'], body: ['gf_longcang', 'gf_mashanzheng'], mono: ['mono'] },
    bias: {
      layout: { huge: 2.4, kanjiFocus: 2.3, vcols: 2.2, depthStack: 2.0, perspective: 1.9, center: 1.9 },
      enter: { windBlown: 2.4, fanOpen: 2.3, glint: 2.2, strokeDraw: 2.0, inkBleed: 2.0, riseMask: 1.9 },
      exit: { flutterOut: 2.3, fanClose: 2.2, dissolve: 2.1, drift: 2.0, trackOutWide: 1.8 },
      hold: { sway: 2.3, float: 2.2, windGust: 2.1, shimmer: 2.1, glintSweep: 2.0 },
      treat: { gfTreatGoldLacquer: 2.8, gfTreatInkSplash: 2.2, glow: 2.1, gradientV: 2.0, wide: 1.8 },
      bg: { gfBgDunhuangRibbons: 3.0, horizonGlow: 2.2, cloudLayers: 2.0, particlesBg: 1.9 },
      cam: { xqArcSweep: 2.2, orbitDrift: 2.2, dollyIn: 2.0, pendulumSway: 1.9, tiltUp: 1.9 },
      fx: { gfFxGoldLeafFloat: 3.0, gfFxCalligraphyFlick: 2.3, lightRays: 2.2, starGlint: 2.0, bloomFlash: 1.9 },
      trans: { gfTransFoldingFan: 2.9, gfTransScrollUnroll: 2.4, xqLightLeak: 2.1, gfTransInkWashDissolve: 2.0 },
    },
    decor: { gfDecoCloudMotif: 2.8, gfDecoLanternTag: 2.3, petals: 2.1, fireflies: 2.0, lightLeak: 1.9, twinkle: 1.9 },
  },
  lantern: {
    moods: ['emotional', 'pop', 'calm'],
    texture: { grain: 0.28, paper: 0.18, scan: 0 },
    ghost: 0.58, glow: 1.65,
    fonts: { display: ['gf_mashanzheng', 'gf_noto_serif_sc', 'potta'], serif: ['gf_noto_serif_tc', 'shippori'], body: ['gf_zhimangxing', 'mincho_bold'], mono: ['mono'] },
    bias: {
      layout: { huge: 2.3, center: 2.2, kanjiFocus: 2.2, vcols: 2.0, frameBox: 2.0, splitScreen: 1.8 },
      enter: { glint: 2.4, fanOpen: 2.3, blurStagger: 2.1, riseMask: 2.1, unroll: 1.9 },
      exit: { fanClose: 2.2, dissolve: 2.2, drift: 2.1, flutterOut: 2.0, blurOutStagger: 1.9 },
      hold: { shimmer: 2.4, float: 2.2, breathe: 2.1, glintSweep: 2.1, xkFocusBreath: 1.9 },
      treat: { gfTreatGoldLacquer: 2.7, gfTreatCinnabarSeal: 2.4, glow: 2.3, softShadow: 1.9 },
      bg: { gfBgLanternNight: 3.0, bokehBg: 2.3, particlesBg: 2.1, horizonGlow: 2.0, spotlight: 1.9 },
      cam: { dollyIn: 2.1, orbitDrift: 2.0, tiltUp: 2.0, pullOut: 1.9, xqArcSweep: 1.9 },
      fx: { gfFxGoldLeafFloat: 2.9, gfFxScrollEdge: 2.2, bloomFlash: 2.1, starGlint: 2.0, lightSweep: 2.0 },
      trans: { gfTransFoldingFan: 2.9, xqLightLeak: 2.3, gfTransScrollUnroll: 2.2, irisOpen: 2.0 },
    },
    decor: { gfDecoLanternTag: 3.0, gfDecoCloudMotif: 2.3, fireflies: 2.2, bokeh: 2.1, twinkle: 2.0, petals: 1.9 },
  },
  bamboo: {
    moods: ['calm', 'emotional', 'editorial'],
    texture: { grain: 0.38, paper: 0.68, scan: 0 },
    ghost: 0.34, glow: 0.6,
    fonts: { display: ['gf_liujianmaocao', 'gf_zhimangxing', 'brush'], serif: ['gf_noto_serif_tc', 'shippori', 'klee'], body: ['gf_longcang', 'mincho'], mono: ['mono'] },
    bias: {
      layout: { vcols: 2.6, kanjiFocus: 2.4, quote: 2.2, columnsBig: 2.1, frameBox: 2.0, lowerThird: 1.8 },
      enter: { strokeDraw: 2.5, inkBleed: 2.4, windBlown: 2.2, unroll: 2.1, fadeStagger: 2.0 },
      exit: { undraw: 2.3, flutterOut: 2.2, drift: 2.2, dissolve: 2.1, blurOutStagger: 1.9 },
      hold: { sway: 2.4, windGust: 2.3, breathe: 2.2, drift: 2.1, xkFocusBreath: 2.0 },
      treat: { gfTreatInkSplash: 2.8, gfTreatCinnabarSeal: 2.5, gfTreatJadeCarving: 2.1, emphasisDots: 1.9 },
      bg: { gfBgBambooInk: 3.0, gfBgShanShui: 2.3, cloudLayers: 1.8, bokehBg: 1.7 },
      cam: { xqLeafFall: 2.3, pendulumSway: 2.1, panL: 2.0, panR: 2.0, dollyIn: 1.9 },
      fx: { gfFxInkMist: 2.9, gfFxCalligraphyFlick: 2.2, wzHanafubuki: 2.0, defocus: 1.8 },
      trans: { gfTransInkWashDissolve: 2.9, gfTransScrollUnroll: 2.5, inkBlob: 2.2, xqSoftSweep: 1.9 },
    },
    decor: { gfDecoPlumInk: 3.0, gfDecoSealStamp: 2.7, petals: 2.3, brushStroke: 2.2, seal: 2.0, watermarkKanji: 1.9 },
  },
  jade: {
    moods: ['calm', 'editorial', 'emotional'],
    texture: { grain: 0.24, paper: 0.28, scan: 0 },
    ghost: 0.42, glow: 1.1,
    fonts: { display: ['gf_noto_serif_sc', 'gf_noto_serif_tc', 'tokumin'], serif: ['gf_mashanzheng', 'shippori'], body: ['mincho_bold', 'klee'], mono: ['mono'] },
    bias: {
      layout: { frameBox: 2.4, center: 2.3, vcols: 2.2, dropCap: 2.0, quote: 2.0, columnsBig: 1.9 },
      enter: { glint: 2.4, trackIn: 2.2, blurStagger: 2.1, unroll: 2.0, riseMask: 1.9 },
      exit: { dissolve: 2.3, trackOutWide: 2.1, drift: 2.0, blurOutStagger: 1.9 },
      hold: { shimmer: 2.3, glintSweep: 2.2, breathe: 2.2, focusRack: 2.0, xkFocusBreath: 2.0 },
      treat: { gfTreatJadeCarving: 3.0, gfTreatPorcelainRim: 2.5, gfTreatGoldLacquer: 2.2, softShadow: 1.9 },
      bg: { gfBgPalaceLattice: 2.7, gfBgPorcelainWave: 2.5, bokehBg: 1.9, borderFrame: 1.9 },
      cam: { dollyIn: 2.1, orbitDrift: 2.1, xqLongLens: 2.0, pullOut: 1.9 },
      fx: { gfFxScrollEdge: 2.6, gfFxGoldLeafFloat: 2.4, lightSweep: 2.2, ripple: 1.9 },
      trans: { gfTransFoldingFan: 2.7, gfTransInkWashDissolve: 2.4, gfTransScrollUnroll: 2.3, xqSoftSweep: 2.0 },
    },
    decor: { gfDecoCloudMotif: 2.7, gfDecoLanternTag: 2.5, gfDecoSealStamp: 2.2, twinkle: 1.9, rings: 1.8 },
  },
  wuxia: {
    moods: ['emotional', 'graphic', 'pop'],
    texture: { grain: 0.55, paper: 0.42, scan: 0 },
    ghost: 0.78, glow: 1.25,
    fonts: { display: ['gf_liujianmaocao', 'gf_zhimangxing', 'gf_longcang', 'brush'], serif: ['gf_noto_serif_sc', 'mincho_black'], body: ['gf_mashanzheng', 'gothic_bold'], mono: ['mono'] },
    bias: {
      layout: { huge: 2.6, kanjiFocus: 2.5, vcols: 2.3, perspective: 2.1, depthStack: 2.0, center: 1.9 },
      enter: { strokeDraw: 2.6, fanOpen: 2.4, inkBleed: 2.3, windBlown: 2.2, glint: 2.1 },
      exit: { undraw: 2.3, fanClose: 2.2, trackOutWide: 2.1, flutterOut: 2.0, dissolve: 1.9 },
      hold: { windGust: 2.4, xkParallax: 2.2, sway: 2.0, focusRack: 2.0, glintSweep: 1.9 },
      treat: { gfTreatCinnabarSeal: 2.9, gfTreatInkSplash: 2.7, gfTreatGoldLacquer: 2.2, outline: 1.9 },
      bg: { gfBgBambooInk: 2.8, gfBgShanShui: 2.6, spotlight: 2.0, mountains: 2.0 },
      cam: { dollyIn: 2.3, xqArcSweep: 2.2, pullOut: 2.1, tiltUp: 2.0, orbitDrift: 1.9 },
      fx: { gfFxCalligraphyFlick: 3.0, gfFxInkMist: 2.5, gfFxGoldLeafFloat: 2.1, bloomFlash: 1.9, lightSweep: 1.9 },
      trans: { gfTransFoldingFan: 2.9, gfTransInkWashDissolve: 2.6, gfTransScrollUnroll: 2.3, inkBlob: 2.1 },
    },
    decor: { gfDecoSealStamp: 3.0, gfDecoPlumInk: 2.4, brushStroke: 2.5, seal: 2.4, watermarkKanji: 2.2, petals: 1.9 },
  },
};

/* ============================================================================
   30 个独具个性与历史意境的中国风元素（每款拥有独立命名、意境、色彩与技艺权重）
   [id, arch, name, desc, bg, fg, accent, accent2, altBg, paper, useGrad, overrides]
   ============================================================================ */
const GUOFENG_30 = [
  ['gfQianliShanShui', 'shanshui', '千里江山 · 青绿山水',
    '北宋王希孟青绿设色意境，石青石绿群山、泥金峰廓与烟雨留白',
    '#0E2326', '#F4EFE4', '#2EA89C', '#D8B25C', '#F2ECDF', true, true,
    { fonts: { display: ['gf_mashanzheng', 'gf_noto_serif_sc', 'brush'] } }],

  ['gfShuiMoJiangNan', 'shanshui', '水墨江南 · 烟雨徽州',
    '宣纸烟墨晕染，远山淡墨、雨丝微凉配一枚朱砂闲章',
    '#F2EDE4', '#1C1B19', '#C03228', '#5B6C72', '#17181A', true, false,
    { biasAdd: { treat: { gfTreatInkSplash: 3.1 }, fx: { gfFxInkMist: 3.1 } } }],

  ['gfZhuQiangZiJin', 'palace', '朱墙黛瓦 · 紫禁宫阙',
    '故宫红墙琉璃瓦金，玄黑檐影配宫灯窗棂与鎏金描绘',
    '#240B0C', '#F9F1E4', '#D93B2B', '#E8C05A', '#4A1214', false, true,
    { biasAdd: { bg: { gfBgPalaceLattice: 3.2 }, treat: { gfTreatGoldLacquer: 3.1 } } }],

  ['gfQingHuaCi', 'porcelain', '青花瓷韵 · 景德窑青',
    '元明青花釉色，瓷白胎底配苏麻离青钴蓝缠枝与海水江牙波纹',
    '#F5F7FA', '#162F66', '#2155B5', '#5C8FE0', '#0D1E45', true, false,
    { biasAdd: { bg: { gfBgPorcelainWave: 3.2 }, treat: { gfTreatPorcelainRim: 3.2 } } }],

  ['gfDunHuangFeiTian', 'dunhuang', '敦煌飞天 · 莫高壁画',
    '西域石窟赭红矿彩、青金石蓝、佛光泥金与灵动飞天丝绸飘带',
    '#221614', '#FCEFD9', '#E0923E', '#3A82B5', '#3B231E', true, true,
    { biasAdd: { bg: { gfBgDunhuangRibbons: 3.3 }, fx: { gfFxGoldLeafFloat: 3.1 } } }],

  ['gfFeiCuiYu', 'jade', '冰种翡翠 · 温润雕玉',
    '东方古玉温润透亮，帝王绿、月白丝绢与银丝雕琢浮光',
    '#0C201B', '#ECF7F1', '#38B88C', '#C8E6C9', '#E9F3EE', false, true,
    { biasAdd: { treat: { gfTreatJadeCarving: 3.2 } } }],

  ['gfJingTaiLan', 'jade', '景泰蓝釉 · 掐丝珐琅',
    '皇家御用铜胎掐丝珐琅，孔雀宝石蓝、鎏金铜丝与朱砂嵌宝',
    '#0D1D3B', '#FAF4E8', '#E2B448', '#22B5B5', '#1B2E59', false, true,
    { biasAdd: { treat: { gfTreatGoldLacquer: 2.9, gfTreatPorcelainRim: 2.8 } } }],

  ['gfShangYuanDeng', 'lantern', '上元灯会 · 东风夜放',
    '辛弃疾“一夜鱼龙舞”元宵灯市，漫天孔明暖灯映照玄夜碧水',
    '#140C1E', '#FFF3DD', '#FF8E3C', '#FF3B4E', '#26142C', false, true,
    { biasAdd: { bg: { gfBgLanternNight: 3.4 }, decor: { gfDecoLanternTag: 3.2 } } }],

  ['gfTangFengShengShi', 'palace', '大唐盛世 · 万国长安',
    '长安霓裳羽衣盛景，绛紫绯红锦缎配牡丹金箔与开合宝扇',
    '#2A0D20', '#FFF6EA', '#F0B642', '#E84A7A', '#1B0B1B', false, true,
    { moods: ['pop', 'emotional', 'editorial'], biasAdd: { trans: { gfTransFoldingFan: 3.1 }, fx: { gfFxGoldLeafFloat: 3.0 } } }],

  ['gfSongCiWanYue', 'porcelain', '宋词婉约 · 瘦金清雅',
    '汴京清雅文人美学，极简天水碧素缣、淡雅留白与朱红细章',
    '#ECEFE9', '#252B28', '#3E7A74', '#B83B32', '#1D2927', true, false,
    { fonts: { display: ['gf_noto_serif_tc', 'gf_mashanzheng', 'klee'] } }],

  ['gfHanFuJianXia', 'wuxia', '侠客江湖 · 醉里挑灯',
    '仗剑天涯水墨侠气，玄铁松烟、银锋剑影、草书狂墨与酒壶赤印',
    '#111417', '#F2EEE7', '#D63830', '#96B2C9', '#1D2429', true, false,
    { fonts: { display: ['gf_liujianmaocao', 'gf_zhimangxing', 'gf_longcang'] }, biasAdd: { fx: { gfFxCalligraphyFlick: 3.3 } } }],

  ['gfZhuLinQiXian', 'bamboo', '竹林七贤 · 月夜清啸',
    '魏晋名士风流，明月青竹飒飒迎风、松烟墨韵伴山涧清流',
    '#0E1B16', '#EBF3EC', '#6BC48D', '#D9CFAF', '#EEF3EA', true, false,
    { biasAdd: { bg: { gfBgBambooInk: 3.3 }, fx: { gfFxInkMist: 2.9 } } }],

  ['gfHanMeiAoXue', 'bamboo', '寒梅傲雪 · 暗香疏影',
    '冬雪皑皑映傲骨老梅，素白胜雪、焦墨铁枝与一点艳红梅萼',
    '#F5F6F8', '#1F1B1D', '#D42E3F', '#8E9BAA', '#171920', true, false,
    { biasAdd: { decor: { gfDecoPlumInk: 3.3 }, bg: { gfBgBambooInk: 3.0 } } }],

  ['gfXiQuLianPu', 'lantern', '梨园戏韵 · 京剧脸谱',
    '生旦净末丑戏台风华，胭脂水袖、明黄帝袍与靛青云肩交相辉映',
    '#1B0E14', '#FFF9F0', '#E82E3A', '#F2C138', '#131D38', false, true,
    { moods: ['pop', 'graphic', 'emotional'], biasAdd: { trans: { gfTransFoldingFan: 3.2 }, decor: { gfDecoLanternTag: 3.0 } } }],

  ['gfSuXiuJinDuan', 'palace', '苏绣锦缎 · 江南织锦',
    '姑苏丝绸细绣，藕荷绯粉底绢上孔雀羽蓝与捻金线柔和流动',
    '#F7ECE8', '#2C1D24', '#1F8A8C', '#C98A3A', '#261722', true, true,
    { biasAdd: { bg: { gfBgDunhuangRibbons: 2.8 }, fx: { gfFxScrollEdge: 2.9 } } }],

  ['gfChaDaoChanYi', 'bamboo', '茶道禅意 · 紫砂茗香',
    '一盏龙井配宜兴紫砂，暖陶褐、茶青雾气与静水流深的禅诗字组',
    '#1F1814', '#F3ECE2', '#7DA36B', '#C78A5B', '#EFE8DC', true, false,
    { moods: ['calm', 'editorial'], biasAdd: { bg: { gfBgBambooInk: 2.8 }, fx: { gfFxInkMist: 2.8 } } }],

  ['gfShanHaiShenHua', 'dunhuang', '山海神话 · 苍穹神兽',
    '《山海经》奇幻太古宇宙，玄冥深靛紫夜、青鸾神羽青与凤凰炽金',
    '#0E1128', '#F2F5FF', '#45D0D8', '#F5B84B', '#211338', false, true,
    { moods: ['emotional', 'pop', 'graphic'], biasAdd: { bg: { gfBgDunhuangRibbons: 3.1 }, fx: { gfFxGoldLeafFloat: 3.1 } } }],

  ['gfDaQiJinBo', 'palace', '战国大漆 · 黑朱金箔',
    '楚汉漆器经典绝配，墨黑犀皮大漆衬赤红朱漆龙凤配闪耀嵌金箔',
    '#0B090A', '#F7ECE1', '#D42620', '#E5B84B', '#260B0C', false, false,
    { biasAdd: { treat: { gfTreatGoldLacquer: 3.3, gfTreatCinnabarSeal: 2.8 }, fx: { gfFxGoldLeafFloat: 3.0 } } }],

  ['gfGuQinYaYun', 'shanshui', '古琴雅韵 · 高山流水',
    '伯牙子期知音意境，沉香檀木色调、水波琴弦纹与古卷字幅舒展',
    '#1A1512', '#F4EBDD', '#C49A5A', '#5C8F8B', '#F0E6D6', true, false,
    { biasAdd: { bg: { gfBgShanShui: 3.0 }, trans: { gfTransScrollUnroll: 3.1 } } }],

  ['gfMuDanGuoSe', 'lantern', '国色天香 · 洛阳牡丹',
    '盛唐洛阳富贵花王，魏紫姚黄绽放于御苑绫罗之间，华美而不俗',
    '#260E1F', '#FFF4F7', '#E6457C', '#F2C14E', '#FBF1F4', false, true,
    { biasAdd: { bg: { gfBgDunhuangRibbons: 2.7 }, decor: { gfDecoPlumInk: 2.8, gfDecoLanternTag: 2.8 } } }],

  ['gfTaotieQingTong', 'palace', '商周青铜 · 鼎铭铜绿',
    '吉金铭文厚重历史感，铜锈青绿、深邃玄铜底与甲骨金文刻痕',
    '#101916', '#EFEAD9', '#4EA88A', '#D1A44A', '#1E2A25', true, false,
    { fonts: { display: ['gf_noto_serif_sc', 'gf_noto_serif_tc', 'tokumin'] }, biasAdd: { treat: { gfTreatJadeCarving: 2.9, gfTreatGoldLacquer: 2.8 } } }],

  ['gfPiYingJianZhi', 'lantern', '皮影剪纸 · 民间民俗',
    '年画窗花剪纸与关中皮影戏，大红吉利纸彩、镂空光影与暖黄烛灯',
    '#7D1014', '#FFF5E6', '#FFD058', '#FF784E', '#FFF3EA', true, false,
    { moods: ['pop', 'graphic'], biasAdd: { bg: { gfBgPalaceLattice: 3.0 }, treat: { gfTreatCinnabarSeal: 3.0 } } }],

  ['gfHongLouMeng', 'bamboo', '红楼绮梦 · 潇湘竹影',
    '大观园诗社情韵，海棠柔粉、藕荷古绢与幽竹落花映照淡淡伤春',
    '#F5E9EC', '#2D1C24', '#C44569', '#6B8E78', '#22151C', true, false,
    { biasAdd: { decor: { gfDecoPlumInk: 3.0 }, trans: { gfTransInkWashDissolve: 2.9 } } }],

  ['gfMoKeSaiWai', 'wuxia', '大漠孤烟 · 长河落日',
    '王维边塞诗雄浑苍凉，大漠黄沙赭色、落日残阳赤红与豪迈狂草',
    '#231710', '#FBF0DC', '#DF6B2B', '#E5B248', '#3A2316', true, true,
    { fonts: { display: ['gf_longcang', 'gf_liujianmaocao', 'gf_mashanzheng'] }, biasAdd: { bg: { gfBgShanShui: 3.0 }, fx: { gfFxCalligraphyFlick: 3.0 } } }],

  ['gfRuYaoTianQing', 'porcelain', '汝窑天青 · 雨过天青',
    '宋徽宗“雨过天青云破处”至高瓷艺，冰裂蟹爪釉色与柔和铜口紫边',
    '#DDEAE8', '#1F3132', '#3F7D7B', '#B68A55', '#1B2D2E', true, false,
    { biasAdd: { bg: { gfBgPorcelainWave: 3.1 }, treat: { gfTreatPorcelainRim: 3.1 } } }],

  ['gfSiChouZhiLu', 'dunhuang', '丝绸之路 · 驼铃古道',
    '长安通向龟兹楼兰的千年古道，番红花金、波斯青金与夜幕星尘',
    '#141A2E', '#FBF2E3', '#E6A03C', '#469BD6', '#2A1D1B', true, true,
    { biasAdd: { bg: { gfBgDunhuangRibbons: 3.1 }, trans: { gfTransScrollUnroll: 2.9 } } }],

  ['gfTaiChiYinYang', 'wuxia', '太极两仪 · 黑白玄墨',
    '道法自然黑白虚实相生，极简墨玄与素白互文，一枚朱红道章破局',
    '#0C0C0E', '#F5F4F0', '#CE2E26', '#A0A4AB', '#F4F3EE', true, false,
    { moods: ['graphic', 'editorial', 'calm'], biasAdd: { treat: { gfTreatInkSplash: 3.0, gfTreatCinnabarSeal: 3.0 }, trans: { gfTransInkWashDissolve: 3.1 } } }],

  ['gfHuPoLiuLi', 'jade', '琥珀琉璃 · 宫灯剔透',
    '古代药玉琉璃与蜜蜡琥珀，温润透光焦糖金搭配靛蓝冷玉对比',
    '#1D130C', '#FFF6E8', '#E89B32', '#3B8DB0', '#2E1E12', false, true,
    { biasAdd: { treat: { gfTreatJadeCarving: 2.9 }, fx: { gfFxGoldLeafFloat: 2.9 } } }],

  ['gfZiTengYunHai', 'dunhuang', '紫藤云海 · 仙鹤蓬莱',
    '蓬莱仙境缥缈流岚，紫藤暮霭、银月鹤羽与浮空云海如意花纹',
    '#1C152B', '#F7F3FC', '#A982E2', '#7CD6D0', '#F1ECF9', true, true,
    { biasAdd: { bg: { gfBgShanShui: 2.8, gfBgDunhuangRibbons: 2.8 }, decor: { gfDecoCloudMotif: 3.1 } } }],

  ['gfChiBiFengHuo', 'wuxia', '赤壁烽火 · 大江东去',
    '东坡“大江东去”雄浑史诗，江涛乌金夜色、战火余烬赤红与狂飙飞白笔迹',
    '#160D0D', '#FAF0E6', '#E53E2B', '#E8A838', '#261412', true, true,
    { fonts: { display: ['gf_liujianmaocao', 'gf_noto_serif_sc', 'gf_zhimangxing'] }, biasAdd: { fx: { gfFxCalligraphyFlick: 3.3, gfFxGoldLeafFloat: 2.7 }, trans: { gfTransInkWashDissolve: 2.8 } } }],
];

for (const row of GUOFENG_30) {
  const [id, archKey, name, desc, bg, fg, accent, accent2, altBg, paper, useGrad, extraOpts = {}] = row;
  if (J.STYLES[id]) continue;
  const prof = ARCH[archKey] || ARCH.shanshui;
  const schemes = buildSchemes(bg, fg, accent, accent2, altBg, null, paper, useGrad);

  // Deep-clone archetype bias and merge any style-specific signature overrides
  const bias = {};
  for (const [grp, map] of Object.entries(prof.bias)) {
    bias[grp] = Object.assign({}, map, (extraOpts.biasAdd && extraOpts.biasAdd[grp]) || {});
  }
  const decor = Object.assign({}, prof.decor, (extraOpts.biasAdd && extraOpts.biasAdd.decor) || {});

  J.STYLES[id] = {
    name,
    desc,
    cat: 'guofeng',
    moods: (extraOpts.moods || prof.moods).slice(),
    schemes,
    fonts: Object.assign({}, prof.fonts, extraOpts.fonts || {}),
    texture: Object.assign({}, prof.texture, extraOpts.texture || {}),
    ghost: prof.ghost,
    glow: prof.glow,
    useGrad: !!useGrad,
    hud: false,
    bias,
    decor,
  };
  if (!J.STYLE_ORDER.includes(id)) J.STYLE_ORDER.push(id);
  if (!J.STYLE_CATS.guofeng.includes(id)) J.STYLE_CATS.guofeng.push(id);
}
})();
