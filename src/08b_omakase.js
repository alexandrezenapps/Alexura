/* ============================================================
   JIZURA — おまかせ (randomise everything into a coherent mood)
   Each call rolls a mood, a style, effect strengths, a technique
   subset, fonts, colours and a new seed. Lyrics / timing / output
   settings and locked lines are left untouched.
   ============================================================ */
(() => {
'use strict';

J.MOODS = {
  glitch:    { name: 'グリッチ', fx: { motion: [0.6, 0.9], glitch: [0.75, 1], chroma: [0.75, 1], decor: [0.3, 0.6], density: [0.6, 0.9], texture: [0.5, 0.9], bgSwitch: [0.3, 0.6] },
    layout: ['center', 'condensed', 'huge', 'tile', 'marquee', 'vcols', 'scatter', 'stack'], enter: ['slice', 'scramble', 'assemble', 'flicker', 'zoom', 'stretch'], exit: ['glitch', 'slice', 'explode', 'fall'], styles: ['noir', 'crimson', 'mint', 'mono', 'hud'] },
  calm:      { name: 'しっとり', fx: { motion: [0.3, 0.55], glitch: [0.05, 0.25], chroma: [0.2, 0.5], decor: [0.2, 0.5], density: [0.25, 0.45], texture: [0.5, 0.85], bgSwitch: [0.1, 0.3] },
    layout: ['center', 'vcols', 'gloss', 'stack', 'circle', 'type', 'mixed'], enter: ['blur', 'type', 'wipe', 'assemble'], exit: ['blur', 'drift', 'wipe', 'shrink'], styles: ['specimen', 'paper', 'hud', 'noir'], noHold: ['glitchtick', 'jitter'] },
  pop:       { name: 'ポップ', fx: { motion: [0.7, 1], glitch: [0.1, 0.35], chroma: [0.3, 0.6], decor: [0.6, 1], density: [0.5, 0.8], texture: [0.2, 0.5], bgSwitch: [0.4, 0.8] },
    layout: ['mixed', 'scatter', 'wave', 'labels', 'pill', 'ring', 'huge', 'diag', 'center'], enter: ['pop', 'drop', 'spin', 'stretch', 'zoom'], exit: ['scatter', 'shrink', 'stretch', 'blur'], styles: ['magenta', 'caution', 'transit', 'blueprint', 'rouge'] },
  graphic:   { name: 'グラフィック', fx: { motion: [0.5, 0.8], glitch: [0.2, 0.5], chroma: [0.4, 0.7], decor: [0.7, 1], density: [0.5, 0.8], texture: [0.4, 0.7], bgSwitch: [0.3, 0.7] },
    layout: ['diag', 'labels', 'marquee', 'tile', 'condensed', 'huge', 'circle', 'pill'], enter: ['wipe', 'slice', 'stretch', 'zoom'], exit: ['wipe', 'slice', 'stretch'], styles: ['blueprint', 'caution', 'rouge', 'mint', 'transit'] },
  editorial: { name: 'エディトリアル', fx: { motion: [0.4, 0.65], glitch: [0.1, 0.3], chroma: [0.2, 0.45], decor: [0.4, 0.7], density: [0.35, 0.6], texture: [0.6, 0.9], bgSwitch: [0.2, 0.4] },
    layout: ['gloss', 'vcols', 'mixed', 'stack', 'type', 'center', 'circle'], enter: ['type', 'blur', 'wipe', 'assemble'], exit: ['blur', 'drift', 'wipe'], styles: ['specimen', 'paper', 'noir', 'mono', 'hud'] },
  emotional: { name: 'エモーショナル', fx: { motion: [0.55, 0.85], glitch: [0.3, 0.6], chroma: [0.5, 0.85], decor: [0.3, 0.6], density: [0.4, 0.7], texture: [0.6, 1], bgSwitch: [0.2, 0.5] },
    layout: ['huge', 'center', 'vcols', 'stack', 'condensed', 'mixed', 'circle'], enter: ['assemble', 'blur', 'zoom', 'wipe', 'slice'], exit: ['drift', 'explode', 'fall', 'blur'], styles: ['noir', 'paper', 'hud', 'mono', 'crimson'] },
  // ホラー: only offered when the project's ホラー switch is on (the horror set's parts come with it)
  horror:    { name: 'ホラー', set: 'horror', fx: { motion: [0.35, 0.65], glitch: [0.3, 0.7], chroma: [0.2, 0.5], decor: [0.3, 0.6], density: [0.3, 0.55], texture: [0.7, 1], bgSwitch: [0.1, 0.3] },
    layout: ['center', 'vcols', 'stack', 'huge', 'type'], enter: ['flicker', 'blur', 'type', 'scramble'], exit: ['blur', 'glitch', 'fall', 'drift'], styles: ['noir', 'mono', 'crimson'], noHold: ['wave'], sprinkle: 0.1 },
  chaos:     { name: '全部入り', fx: { motion: [0.5, 1], glitch: [0.3, 1], chroma: [0.4, 1], decor: [0.4, 1], density: [0.45, 0.9], texture: [0.3, 1], bgSwitch: [0.3, 0.9] },
    layout: null, enter: null, exit: null, styles: null },
};

/* mood tags for the core (pre-pack) items */
(() => {
  const add = (g, k, m) => { const d = J.registry(g)[k]; if (!d) return; d.tags = d.tags || []; if (!d.tags.includes(m)) d.tags.push(m); };
  for (const [m, M] of Object.entries(J.MOODS)) for (const g of ['layout', 'enter', 'exit']) for (const k of (M[g] || [])) add(g, k, m);
  const extra = {
    hold: { still: ['calm', 'editorial', 'emotional', 'graphic'], drift: ['calm', 'emotional', 'editorial'], breathe: ['calm', 'emotional'], wave: ['pop'], jitter: ['glitch', 'pop'], glitchtick: ['glitch'] },
    decor: { brackets: ['graphic', 'editorial'], rings: ['graphic', 'emotional'], dots: ['pop', 'graphic'], arrows: ['pop', 'graphic'], slash: ['glitch', 'graphic'], sparks: ['pop'], leaders: ['editorial', 'calm'],
      waveform: ['emotional', 'calm'], barcode: ['glitch', 'graphic'], grid: ['graphic', 'editorial'], stripes: ['graphic', 'pop'], blobs: ['pop', 'emotional'], bars: ['graphic', 'glitch'], shapes: ['pop', 'graphic'], counter: ['graphic', 'editorial'] },
    fx: { chroma: ['glitch', 'emotional', 'pop', 'graphic'], shake: ['pop', 'glitch', 'emotional'], slice: ['glitch'], block: ['glitch'], invert: ['glitch', 'graphic'], flash: ['pop', 'emotional', 'glitch'], zoom: ['pop', 'emotional'], mosaic: ['glitch'] },
  };
  for (const [g, map] of Object.entries(extra)) for (const [k, ms] of Object.entries(map)) ms.forEach(m => add(g, k, m));
})();

/* テーマ: おまかせ within one direction. A theme picks among its moods, turns on the part switches it needs
   (returned with the result) and always keeps the parts of its set / 和風 as candidates. No theme = the usual おまかせ. */
J.THEMES = {
  cinematic: {
    name: 'CINEMATIC',
    moods: ['emotional', 'editorial'],
    styles: ['bladeCinema', 'noir', 'gold', 'hud', 'crimson', 'mono'],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.64, 0.88], glitch: [0.14, 0.38], chroma: [0.55, 0.85], decor: [0.42, 0.72], density: [0.38, 0.62], texture: [0.6, 0.9], bgSwitch: [0.35, 0.65] },
    prefers: {
      layout: ['credits', 'curtain', 'lowerThird', 'frameBox', 'depthStack', 'perspective', 'filmstrip', 'vcols', 'center', 'huge', 'rain', 'typeSpecimen', 'splitScreen'],
      enter: ['trackIn', 'blur', 'blurStagger', 'iris', 'shutter', 'backlight', 'lightLeak', 'fadeStagger', 'riseMask', 'zoom', 'glint', 'overexpose', 'filmFeed'],
      hold: ['focusRack', 'drift', 'breathe', 'glintSweep', 'xkParallax', 'xkFocusBreath', 'xkDepthRock', 'xkDoubleVision', 'zoomSlow'],
      exit: ['trackOutWide', 'dissolve', 'zoomThrough', 'zoomFar', 'blur', 'blurOutStagger', 'irisClose', 'drift', 'lampOff', 'xjFocusPull', 'xjThroughFocus', 'xjShadowStay'],
      cam: ['dollyIn', 'pullOut', 'rackFocus', 'focusIn', 'orbitDrift', 'panL', 'panR', 'tiltUp', 'tiltDown', 'xqArcSweep', 'xqCraneUp', 'xqLongLens', 'xqPushPull'],
      fx: ['anamorphic', 'lightRays', 'filmAdvance', 'dustScratches', 'lightSweep', 'filmBurn', 'defocus', 'bloomFlash', 'chroma', 'flash', 'zoom'],
      trans: ['irisOpen', 'xqBladeRun', 'xqLightLeak', 'xqSoftSweep', 'zoomThrough', 'doorsOpen', 'wipe'],
      treat: ['softShadow', 'glow', 'gradientV', 'wide', 'tall', 'focusPull', 'fadeChars', 'outline'],
      bg: ['letterbox', 'rainWindow', 'skyline', 'horizonGlow', 'godRays', 'spotlight', 'filmStrip', 'bokehBg', 'vignettePulse', 'noiseField'],
      decor: ['timecodeBar', 'lightLeak', 'bokeh', 'cropMarks', 'crosshair', 'reticle', 'starField', 'leaders'],
    },
    avoid: { hold: ['jitter', 'glitchtick', 'jelly', 'eqBounce'], decor: ['confetti', 'heartsStars', 'polkaPatch', 'memphis'], bg: ['polka', 'checker'] },
  },
  musicvideo: {
    name: 'MUSIC VIDEO',
    moods: ['pop', 'emotional', 'glitch'],
    styles: ['stagePrism', 'synth80', 'magenta', 'crimson', 'transit', 'ocean'],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.76, 0.96], glitch: [0.22, 0.55], chroma: [0.55, 0.88], decor: [0.55, 0.88], density: [0.5, 0.78], texture: [0.3, 0.6], bgSwitch: [0.45, 0.8] },
    prefers: {
      layout: ['equalizer', 'marquee', 'huge', 'neon', 'mirror', 'splitScreen', 'mixed', 'ring', 'pill', 'zoomRepeat', 'xdKaraoke', 'xdFourUp', 'xdSkyline', 'vinyl'],
      enter: ['whip', 'zoom', 'pop', 'bounceBig', 'rubber', 'neonOn', 'echoIn', 'knWordSlam', 'knPushIn', 'knDiveIn', 'xgPumpUp', 'xfEqualizer'],
      hold: ['beatHop', 'heartbeat', 'eqBounce', 'pulse', 'stretchPulse', 'xkBeatBump', 'xkLoudWeight', 'xkKaraoke', 'knWordPulse', 'knBeatLean'],
      exit: ['whipOut', 'zoomThrough', 'popOut', 'echoOut', 'scatter', 'knWordKick', 'knPushOut', 'xjPuckHit', 'xjCardToss', 'spinOut'],
      cam: ['beatPunch', 'whipIn', 'crashZoom', 'stepZoom', 'bounce', 'dollyIn', 'xqBeatBreath', 'xqHeartbeat', 'xqWhipSpring', 'xqLoudZoom', 'knRushIn'],
      fx: ['zoomPunch', 'bloomFlash', 'rgbSplit', 'flash', 'strobe', 'heartbeat', 'speedLines', 'focusLines', 'xrSpotlight', 'xrColorStrobe', 'xrBandZoom', 'chroma', 'shake'],
      trans: ['whipPan', 'flashCross', 'zoomThrough', 'cubeTurn', 'xqChevronPush', 'xqRingRipple', 'pushSlide', 'knStripSlam'],
      treat: ['glow', 'neonOutline', 'chrome', 'gradientSweep', 'extrude', 'knWordScale', 'knWordPlate', 'karaoke'],
      bg: ['eqBars', 'spotlight', 'auroraRibbons', 'sunburst', 'gradientSweep', 'duotoneSweep', 'particlesBg', 'xpPlexus'],
      decor: ['beatRing', 'sparks', 'lineBurst', 'knSpeedTrail', 'waveform', 'bars', 'rings', 'twinkle', 'spectrumRing', 'mediaControls'],
    },
    avoid: { bg: ['seigaiha', 'asanoha', 'wzBgShippo'] },
  },
  artmotion: {
    name: 'ART & MOTION',
    moods: ['graphic', 'glitch', 'pop'],
    styles: ['kineticPop', 'caution', 'acid', 'blueprint', 'candy', 'rouge'],
    koma: [0, 0, 12],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.76, 0.98], glitch: [0.38, 0.78], chroma: [0.55, 0.88], decor: [0.62, 0.95], density: [0.55, 0.85], texture: [0.35, 0.65], bgSwitch: [0.45, 0.8] },
    prefers: {
      layout: ['xbIsoStack', 'perspective', 'diag', 'stickerBomb', 'flipBoard', 'crossBands', 'tunnel', 'xbTwistFrames', 'xbDonut', 'xbHoneycomb', 'xbCompGrid', 'xdHelix', 'xdPivotFan', 'cube', 'accordion'],
      enter: ['knWordSpin', 'knStretchOut', 'knHingeDrop', 'flipX', 'flipY', 'domino', 'fold', 'squashDrop', 'glitchIn', 'slice', 'vSlice', 'xePieceVortex', 'xeGearTick'],
      hold: ['skewWobble', 'rotateSlow', 'orbitSmall', 'xkZigzagFlip', 'xkSpinOne', 'xkParallax', 'kzSquashWave', 'kzSlinky', 'glitchtick', 'flipSwap'],
      exit: ['flipOutX', 'flipOutY', 'foldOut', 'shatterLite', 'vSliceDrop', 'glitchDissolve', 'explode', 'dominoOut', 'xjQuarterTurn', 'xhConcertina'],
      cam: ['barrelRoll', 'roll', 'dutch', 'knTiltKick', 'knCardFlip', 'knShearKick', 'xqTickRoll', 'xqDriftTurn', 'kzRecoil', 'knJumpCut'],
      fx: ['perspectiveTilt', 'kaleido', 'halftone', 'duotone', 'pixelSort', 'shatter', 'xrQuadCycle', 'xrFlipTiles', 'xrAccordion', 'xrRibbonTwist', 'kzCardSlam', 'slice', 'chroma'],
      trans: ['cubeTurn', 'shatterTiles', 'sliceShift', 'diagonalWipe', 'spinOut', 'knCornerSwing', 'xqAccordion', 'xqFlipOver', 'xqPropeller'],
      treat: ['extrude', 'longShadow', 'hardShadow', 'outlineFill', 'doubleOutline', 'halftone', 'stripes', 'splitColor', 'xoBandExtrude'],
      bg: ['isoCubes', 'triTess', 'moire', 'checker', 'polka', 'halftoneFade', 'xpFoldPlanes', 'xpLissajous', 'kzBigGears', 'xpShiftRows'],
      decor: ['xmMoire', 'xmSpiro', 'xmIsoCubes', 'xmGears', 'xmPendulum', 'glitchRects', 'shapes', 'stripes', 'triangleSpin', 'memphis'],
    },
  },
  futuristic: {
    name: 'FUTURISTIC',
    moods: ['glitch', 'graphic', 'pop'],
    styles: ['cyberAi', 'mint', 'synth80', 'hud', 'vapor', 'acid'],
    koma: [0, 0, 12],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.7, 0.92], glitch: [0.45, 0.85], chroma: [0.68, 0.96], decor: [0.58, 0.88], density: [0.52, 0.8], texture: [0.55, 0.85], bgSwitch: [0.4, 0.72] },
    prefers: {
      layout: ['neon', 'tunnel', 'dotMatrix', 'labels', 'xcBrowser', 'xcGauge', 'xcLoading', 'xbCrosshair', 'xbDial', 'xdConstellation', 'ledScroll'],
      enter: ['neonOn', 'scramble', 'resolve', 'matrixRain', 'crtOn', 'interlace', 'loadingBar', 'odometer', 'dither', 'flicker', 'xfScanner', 'xfPrintHead'],
      hold: ['scanBand', 'glowFlicker', 'echoTrail', 'glitchtick', 'colorRun', 'xkMagnifier', 'tyReadCursor', 'xkDoubleVision', 'tyOutlineBlink'],
      exit: ['matrixOut', 'scanOut', 'glitch', 'glitchDissolve', 'scrambleOut', 'rgbSplitOut', 'xhBarcode', 'xiInverseBand'],
      cam: ['vertigo', 'spiralIn', 'focusIn', 'snapPan', 'push', 'xqArcSweep', 'xqFocusHunt', 'stepZoom', 'xqTripodNudge'],
      fx: ['chroma', 'radialChroma', 'rgbSplit', 'crtOff', 'vhsRoll', 'trackingNoise', 'edgeDetect', 'macroBlock', 'scanBar', 'ditherBit', 'xrScanBurst', 'xrCrosshair', 'xrMoire'],
      trans: ['irisOpen', 'xqBladeRun', 'xqPolyIris', 'pixelate', 'blockDissolve', 'flashCross', 'knStripSlam'],
      treat: ['neonOutline', 'glow', 'glitchSplit', 'monoGrid', 'chrome', 'echoOutline', 'inline'],
      bg: ['retroGrid', 'hexGrid', 'squareTunnel', 'xpDepthGrid', 'xpRadar', 'xpScanner', 'xpPlexus', 'xpLoadBars', 'xpSevenSeg', 'starfield', 'scanBars'],
      decor: ['reticle', 'crosshair', 'barcode', 'qrBlock', 'xmGauge', 'xnLevelMeter', 'xnTimeline', 'xnAsciiGauge', 'radar', 'circuit', 'spinner', 'dataColumns'],
    },
    avoid: { decor: ['petals', 'tapePieces', 'paperClip', 'scribbleCircle'], bg: ['tornPaper', 'seigaiha', 'asanoha'] },
  },
  lifestyle: {
    name: 'LIFESTYLE',
    moods: ['editorial', 'calm', 'emotional'],
    styles: ['atelierLux', 'gold', 'specimen', 'paper', 'forest', 'newsprint'],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.46, 0.72], glitch: [0.02, 0.16], chroma: [0.15, 0.42], decor: [0.35, 0.65], density: [0.28, 0.5], texture: [0.5, 0.8], bgSwitch: [0.22, 0.45] },
    prefers: {
      layout: ['gloss', 'columnsBig', 'justified', 'quote', 'dropCap', 'lowerThird', 'vcols', 'frameBox', 'center', 'arcTop', 'typeSpecimen', 'filmstrip', 'magazine'],
      enter: ['trackIn', 'fadeStagger', 'blurStagger', 'wipe', 'unroll', 'lightLeak', 'glint', 'riseMask', 'cursorSweep', 'strokeDraw', 'tyLineWipe'],
      hold: ['breathe', 'drift', 'shimmer', 'glintSweep', 'shadowSway', 'focusRack', 'xkFocusBreath', 'xkTallBreath'],
      exit: ['trackOutWide', 'dissolve', 'drift', 'blurOutStagger', 'sweepCover', 'sinkMask', 'wipe', 'undraw'],
      cam: ['dollyIn', 'pullOut', 'driftDiag', 'panL', 'panR', 'tiltUp', 'handheld', 'xqWalkCam', 'xqLongLens', 'xqLevelOut'],
      fx: ['lightSweep', 'filmBurn', 'whiteFrame', 'defocus', 'lightRays', 'dustScratches', 'chroma'],
      trans: ['xqSoftSweep', 'xqLightLeak', 'xqPagePeel', 'wipe', 'cover', 'uncover', 'irisOpen'],
      treat: ['softShadow', 'gradientV', 'wide', 'emphasisDots', 'underline', 'fadeChars', 'kerningWide', 'toneShadow'],
      bg: ['marble', 'oceanWaves', 'mountains', 'horizonGlow', 'bokehBg', 'particlesBg', 'gradientSweep', 'spotlight', 'borderFrame'],
      decor: ['leaders', 'cropMarks', 'rulerEdge', 'lightLeak', 'bokeh', 'twinkle', 'constellation', 'dateStamp', 'swatches'],
    },
    avoid: { hold: ['jitter', 'glitchtick', 'glitchJump', 'jelly'], fx: ['block', 'mosaic', 'invert', 'tvStatic', 'edgeDetect'], decor: ['glitchRects', 'barcode', 'qrBlock', 'confetti'] },
  },
  animation: {
    name: 'ANIMATION',
    moods: ['pop', 'emotional', 'calm'],
    styles: ['animePrism', 'sakura', 'candy', 'sunset', 'ocean', 'vapor'],
    koma: [0, 0, 12],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.72, 0.95], glitch: [0.06, 0.28], chroma: [0.4, 0.72], decor: [0.62, 0.92], density: [0.45, 0.72], texture: [0.25, 0.55], bgSwitch: [0.45, 0.8] },
    prefers: {
      layout: ['bubbles', 'bounceLine', 'elastic', 'wave', 'orbit', 'arcTop', 'rain', 'stickerBomb', 'xdWindSway', 'xdSpiralEcho', 'xdRipple', 'xdHelix', 'balloons'],
      enter: ['squashDrop', 'rubber', 'bounceBig', 'waveIn', 'spiralIn', 'inkBleed', 'strokeDraw', 'fanOpen', 'windBlown', 'bubbles', 'xgJelly', 'xeLeapfrog', 'xeArcToss'],
      hold: ['jelly', 'float', 'sway', 'wave', 'hWave', 'windGust', 'dangle', 'xkBuoy', 'xkCradle', 'xkDoubleVision', 'kzSquashWave'],
      exit: ['popOut', 'melt', 'balloonOff', 'deflateOut', 'flutterOut', 'tornadoOut', 'fanClose', 'xjRubberSnap', 'xjSpringHop', 'riseOut'],
      cam: ['bounce', 'floatNoise', 'jelly', 'spiralIn', 'orbitDrift', 'pendulumSway', 'xqLeafFall', 'xqSquashRelax', 'xqWhipSpring'],
      fx: ['kaleido', 'waveWarp', 'ripple', 'starGlint', 'focusLines', 'speedLines', 'hueShift', 'bloomFlash', 'xrWaterMirror', 'xrSwingEcho', 'kzShockArcs', 'wzHanafubuki'],
      trans: ['inkBlob', 'xqWaveWipe', 'xqRingRipple', 'xqStretchSmear', 'spinOut', 'clockWipe'],
      treat: ['rainbow', 'outlineFill', 'doubleOutline', 'sticker', 'circled', 'waterline', 'sizeWave', 'glow'],
      bg: ['auroraRibbons', 'meshBlobs', 'starfield', 'cloudLayers', 'fireworks', 'snowLayers', 'kaleidoscope', 'spiralArms', 'sunburst', 'oceanWaves'],
      decor: ['petals', 'twinkle', 'sparks', 'confetti', 'heartsStars', 'risingParticles', 'bokeh', 'lineBurst', 'constellation', 'fireflies', 'cloudPuffs'],
    },
  },
  lyricpv: { name: '文字PV', moods: ['editorial', 'graphic', 'emotional'], set: 'typo' },
  kinetic: { name: 'キネティック', moods: ['pop', 'graphic', 'glitch'], set: 'kinetic' },
  wa:      { name: '和風', moods: ['calm', 'emotional', 'editorial'], wa: true },
  horror:  { name: 'ホラー', moods: ['horror'], set: 'horror' },
  pop:     { name: 'ポップ', moods: ['pop'] },
  ballad:  { name: 'バラード', moods: ['calm', 'emotional'], koma: [0, 0, 12] },
};
J.THEME_ORDER = Object.keys(J.THEMES);

J.omakase = (project, rnd = Math.random, themeId = null) => {
  const T = themeId && J.THEMES[themeId] ? J.THEMES[themeId] : null;
  const switches = {};
  if (T && T.set) switches[T.set] = true;
  if (T && Array.isArray(T.sets)) for (const s of T.sets) switches[s] = true;
  if (T && T.extra) switches.extra = true;
  if (T && T.extra2) switches.extra2 = true;
  if (T && T.wa) { switches.wa = true; switches.extra = true; }     // most 和風 parts belong to 追加分
  if (T) project = Object.assign({}, project, switches);
  const themePart = d => !!(T && d && ((T.set && d.set === T.set) || (Array.isArray(T.sets) && T.sets.includes(d.set)) || (T.wa && d.wa)));
  const pick = a => a[Math.floor(rnd() * a.length) % a.length];
  const range = r => +(r[0] + (r[1] - r[0]) * rnd()).toFixed(2);
  const moodOk = k => !J.MOODS[k].set || (J.setOn && J.setOn(project, J.MOODS[k].set));
  let moods = Object.keys(J.MOODS).filter(k => k !== project.mood && moodOk(k));
  if (T) { const tm = T.moods.filter(k => J.MOODS[k] && moodOk(k)); moods = tm.filter(k => k !== project.mood); if (!moods.length) moods = tm.length ? tm : Object.keys(J.MOODS).filter(moodOk); }
  // with the ホラー switch on, おまかせ leans to the ホラー mood (it may repeat)
  const mood = !T && moodOk('horror') && rnd() < 0.55 ? 'horror' : pick(moods), M = J.MOODS[mood];
  // a set tied to a mood (ホラー) is only used in that mood
  const moodSetOk = d => !(d && d.set) || !Object.values(J.MOODS).some(m => m.set === d.set) || M.set === d.set;
  // style: curated theme styles first, otherwise mood-compatible styles; never repeat twice in a row unless only one exists
  const okStyle = k => J.STYLES[k] && (!J.randomOk || J.randomOk(project, 'style', k)) && moodSetOk(J.STYLES[k]);
  const moodStyles = [...new Set([...(M.styles || []), ...J.STYLE_ORDER.filter(k => (J.STYLES[k].moods || []).includes(mood))])].filter(okStyle);
  let pool = (moodStyles.length && rnd() < 0.72 ? moodStyles : J.STYLE_ORDER.filter(okStyle)).filter(k => k !== project.style);
  if (T && Array.isArray(T.styles) && T.styles.length) {
    const hero = T.styles[0];
    const tStyles = T.styles.filter(okStyle);
    const nonRepeat = tStyles.filter(k => k !== project.style);
    if (hero && okStyle(hero) && project.style !== hero && rnd() < 0.65) pool = [hero];
    else if (nonRepeat.length) pool = nonRepeat;
    else if (tStyles.length) pool = tStyles;
  } else if (T) {
    const ts = J.STYLE_ORDER.filter(k => okStyle(k) && themePart(J.STYLES[k]) && k !== project.style);
    if (ts.length && rnd() < 0.8) pool = ts;
  }
  if (!pool.length) pool = J.STYLE_ORDER.filter(k => k !== project.style && okStyle(k));
  if (!pool.length) pool = J.STYLE_ORDER.filter(k => k !== project.style);
  const style = pick(pool);
  const fx = Object.assign({}, project.fx);
  const fxRanges = T && T.fxPatch ? Object.assign({}, M.fx, T.fxPatch) : M.fx;
  for (const k of Object.keys(fxRanges)) fx[k] = range(fxRanges[k]);
  fx.koma = pick(T && T.koma ? T.koma : { horror: [12, 8, 0], glitch: [12, 12, 8], pop: [12, 12, 8, 0], calm: [0, 0, 12], editorial: [0, 12], emotional: [12, 0], graphic: [12, 12, 0] }[mood] || [12, 8, 0]);
  fx.onTwos = fx.koma > 0; fx.flash = rnd() < 0.65;
  fx.hud = J.STYLES[style] && J.STYLES[style].hud ? 'on' : pick(['auto', 'auto', 'on', 'off']);
  // technique subset per group: curated theme parts + mood-tagged parts + small sprinkle
  const enabled = {};
  const MIN = { layout: 6, enter: 5, exit: 5, hold: 3, decor: 6, treat: 4, bg: 4, cam: 3, fx: 4, trans: 3 };
  const sprinkleRate = T && T.sprinkle != null ? T.sprinkle : (M.sprinkle || 0.22);
  for (const g of J.GROUP_KEYS) {
    const order = J.order(g).filter(k => !(J.registry(g)[k] || {}).special && (!J.randomOk || J.randomOk(project, g, k)) && moodSetOk(J.registry(g)[k]));
    const hand = ['layout', 'enter', 'exit'].includes(g) && Array.isArray(M[g]) ? M[g] : [];   // (M.fx holds slider ranges, not a list)
    const tPrefer = T && T.prefers && Array.isArray(T.prefers[g]) ? T.prefers[g] : null;
    const tAvoid = new Set(T && T.avoid && Array.isArray(T.avoid[g]) ? T.avoid[g] : []);
    const prefer = mood === 'chaos' && !tPrefer ? null : new Set([...(tPrefer || hand), ...(tPrefer ? [] : J.taggedWith(g, mood))]);
    if (prefer && T && !tPrefer) for (const k of order) if (themePart(J.registry(g)[k])) prefer.add(k);   // the theme's own parts stay in
    const on = {};
    // entries of a set tied to another mood are switched off explicitly (a missing key would count as enabled)
    for (const k of J.order(g)) if (!moodSetOk(J.registry(g)[k]) || tAvoid.has(k)) on[k] = false;
    for (const k of order) {
      if (tAvoid.has(k)) { on[k] = false; continue; }
      on[k] = prefer ? (prefer.has(k) || rnd() < sprinkleRate) : rnd() < 0.8;
    }
    const offs = order.filter(k => !on[k] && !tAvoid.has(k));
    let n = order.length - offs.length;
    while (n < Math.min(MIN[g] || 3, order.length) && offs.length) { const k = offs.splice(Math.floor(rnd() * offs.length), 1)[0]; on[k] = true; n++; }
    enabled[g] = on;
  }
  enabled.enter.cut = true; enabled.exit.cut = true;
  if (enabled.treat) enabled.treat.none = true;
  if (enabled.bg) enabled.bg.none = true;
  if (enabled.cam) enabled.cam.push = true;
  for (const k of (M.noHold || [])) if (enabled.hold[k] !== undefined) enabled.hold[k] = false;
  if (T && T.avoid && Array.isArray(T.avoid.hold)) for (const k of T.avoid.hold) if (enabled.hold[k] !== undefined) enabled.hold[k] = false;
  enabled.hold.still = true;
  // fonts: prefer the style's own curated role fonts (keep them most of the time on themed looks)
  const fonts = {};
  const faces = Object.entries(J.FONTS).filter(([k, f]) => !f.user && !['mono', 'pixel'].includes(f.kind) && (!J.randomOk || J.randomOk(project, 'font', k)));
  const swapP = T && T.styles ? 0.25 : 0.4;
  if (rnd() < swapP) fonts.display = pick(faces.filter(([k, f]) => f.weight >= 700 || f.kind === 'display' || f.kind === 'round'))[0];
  if (rnd() < 0.25) fonts.serif = pick(faces.filter(([k, f]) => f.kind === 'mincho' || f.kind === 'brush'))[0];
  if (mood === 'chaos' && rnd() < 0.2) fonts.display = 'dot';
  // colours: style palette most of the time, a fresh accent / ghost pair otherwise
  const colors = Object.assign({}, project.colors, { enabled: false, accentOn: false });
  if (rnd() < (T && T.styles ? 0.24 : 0.38)) {
    const bg = J.STYLES[style].schemes[0].bg;
    Object.assign(colors, J.randomPalette(bg, rnd), { accentOn: true });
    delete colors.mode;
  }
  // keep locked lines, drop other per-line picks
  const overrides = {};
  for (const [i, o] of Object.entries(project.overrides || {})) if (o.lock) overrides[i] = o; else if (o.cutTime) overrides[i] = { cutTime: o.cutTime };   // cut times are timing, not the look
  return Object.assign({ mood, style, fx, enabled, fonts, colors, overrides, seed: Math.floor(rnd() * 1e9) }, switches);
};
})();
