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
    styles: [
      'bladeCinema', 'noir', 'gold', 'hud', 'crimson', 'mono',
      'cinAnamorphic', 'cinSilverHalide', 'cinAmberNocturne', 'cinImaxTitle',
      'cinNordicMist', 'cinVelvetNoir', 'cinTealOrange', 'cinCriterionInk',
      'cinEclipseChrome', 'cinDuneOchre', 'cinRainySeoul', 'cinGrandPrix',
      'cinSaffronLens', 'cinMonolith',
    ],
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
    styles: [
      'stagePrism', 'synth80', 'magenta', 'crimson', 'transit', 'ocean',
      'mvTrapGold', 'mvKpopNeon', 'mvRnbVelvet', 'mvHipHopRaw',
      'mvClubStrobe', 'mvChromeDrip', 'mvHyperPop', 'mvVinylGroove',
      'mvDancefloor', 'mvDrillDark', 'mvFestivalSky', 'mvLatinHeat',
      'mvIndieStage', 'mvDiamondTour',
    ],
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
  trapsoul: {
    name: 'TRAP SOUL',
    moods: ['emotional', 'glitch', 'calm'],
    styles: [
      'ts808Velvet', 'tsLateNightDrive', 'tsAmethystHaze', 'tsLeanPurple', 'tsChromeTears',
      'tsSubBassGold', 'tsRainWindow', 'tsMoodySatin', 'tsNocturneEcho', 'tsGhostHotline',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.68, 0.90], glitch: [0.22, 0.48], chroma: [0.58, 0.90], decor: [0.46, 0.78], density: [0.42, 0.68], texture: [0.38, 0.65], bgSwitch: [0.35, 0.65] },
    prefers: {
      layout: ['equalizer', 'neon', 'huge', 'depthStack', 'rain', 'mirror', 'xdKaraoke', 'vinyl', 'vcols', 'lowerThird'],
      enter: ['mvTrap808Drop', 'mvTrapGlide', 'blurStagger', 'neonOn', 'echoIn', 'iris', 'backlight', 'xgPumpUp'],
      hold: ['mvTrap808Pump', 'mvTrapFloatDrift', 'heartbeat', 'beatHop', 'focusRack', 'xkBeatBump', 'xkLoudWeight', 'glowFlicker'],
      exit: ['mvTrapSmokeOut', 'dissolve', 'blurOutStagger', 'zoomThrough', 'echoOut'],
      cam: ['mvCam808Kick', 'mvCamLateDrive', 'beatPunch', 'xqBeatBreath', 'dollyIn', 'rackFocus', 'xqLoudZoom'],
      fx: ['mvFx808Shock', 'bloomFlash', 'radialChroma', 'anamorphic', 'rgbSplit', 'chroma'],
      trans: ['mvTransSilkBlend', 'xqLightLeak', 'xqSoftSweep', 'zoomThrough', 'irisOpen'],
      treat: ['mvTreatRnbAura', 'glow', 'neonOutline', 'gradientV', 'softShadow', 'karaoke'],
      bg: ['mvBg808SubRing', 'rainWindow', 'spotlight', 'bokehBg', 'horizonGlow', 'eqBars'],
      decor: ['mvDecoHhBars', 'beatRing', 'lightLeak', 'bokeh', 'waveform', 'spectrumRing'],
    },
    avoid: { bg: ['seigaiha', 'asanoha', 'wzBgShippo', 'polka', 'checker'] },
  },
  rnb: {
    name: 'R&B',
    moods: ['calm', 'emotional', 'editorial'],
    styles: [
      'rnbSilkCandle', 'rnbSilkRose', 'rnbMidnightBath', 'rnbGoldenHour', 'rnbNeoSoulTea',
      'rnbPearlMist', 'rnbVioletSmooth', 'rnbHoneyAmber', 'rnbDreamyBlue', 'rnbRubyIntimate',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.54, 0.78], glitch: [0.04, 0.18], chroma: [0.28, 0.56], decor: [0.42, 0.74], density: [0.34, 0.56], texture: [0.35, 0.65], bgSwitch: [0.3, 0.58] },
    prefers: {
      layout: ['gloss', 'lowerThird', 'frameBox', 'vcols', 'center', 'vinyl', 'quote', 'dropCap', 'xdKaraoke', 'credits'],
      enter: ['mvRnbSilkSweep', 'mvRnbVelvetRise', 'fadeStagger', 'blurStagger', 'lightLeak', 'glint', 'trackIn', 'riseMask'],
      hold: ['mvRnbSilkSway', 'mvRnbCandleBreathe', 'breathe', 'shimmer', 'glintSweep', 'xkFocusBreath', 'focusRack', 'drift'],
      exit: ['mvRnbSilkFade', 'dissolve', 'blurOutStagger', 'trackOutWide', 'drift', 'wipe'],
      cam: ['mvCamRnbSilkDolly', 'mvCamRnbSway', 'xqBeatBreath', 'dollyIn', 'xqArcSweep', 'pullOut', 'orbitDrift'],
      fx: ['mvFxRnbWarmBloom', 'lightSweep', 'filmBurn', 'defocus', 'bloomFlash', 'chroma'],
      trans: ['mvTransSilkBlend', 'xqSoftSweep', 'xqLightLeak', 'irisOpen', 'wipe'],
      treat: ['mvTreatRnbAura', 'softShadow', 'glow', 'gradientV', 'wide', 'karaoke'],
      bg: ['mvBgRnbSilkWaves', 'bokehBg', 'auroraRibbons', 'horizonGlow', 'spotlight', 'gradientSweep'],
      decor: ['mvDecoPopSparks', 'bokeh', 'lightLeak', 'twinkle', 'leaders', 'swatches', 'beatRing'],
    },
    avoid: { hold: ['jitter', 'glitchtick', 'glitchJump'], fx: ['block', 'mosaic', 'tvStatic', 'edgeDetect'], bg: ['seigaiha', 'asanoha', 'wzBgShippo'] },
  },
  hiphop: {
    name: 'HIP-HOP',
    moods: ['pop', 'glitch', 'graphic'],
    styles: [
      'hhConcreteRaw', 'hhChromeChain', 'hhBoomBap90', 'hhSubwayGraff', 'hhPlatinumFlex',
      'hhAlertRed', 'hhTapeDistort', 'hhNightCypher', 'hhStreetPoster', 'hhDrillSteel',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.80, 0.98], glitch: [0.28, 0.65], chroma: [0.55, 0.90], decor: [0.55, 0.88], density: [0.56, 0.84], texture: [0.35, 0.7], bgSwitch: [0.48, 0.85] },
    prefers: {
      layout: ['huge', 'equalizer', 'marquee', 'columnsBig', 'stickerBomb', 'diag', 'splitScreen', 'xdFourUp', 'mixed', 'zoomRepeat'],
      enter: ['mvHhSlamPunch', 'mvHhSliceCut', 'knWordSlam', 'whip', 'stamp', 'stretch', 'glitchIn', 'zoom', 'slice'],
      hold: ['mvHhHeadNod', 'mvHhBarFlex', 'eqBounce', 'xkBeatBump', 'beatHop', 'knWordPulse', 'stretchPulse', 'xkLoudWeight'],
      exit: ['mvHhCutSnap', 'whipOut', 'knWordKick', 'scatter', 'glitchDissolve', 'zoomThrough', 'spinOut'],
      cam: ['mvCamHhBounce', 'mvCamHhSnapZoom', 'beatPunch', 'crashZoom', 'stepZoom', 'whipIn', 'xqWhipSpring', 'knRushIn'],
      fx: ['mvFxHhImpactCut', 'zoomPunch', 'strobe', 'flash', 'rgbSplit', 'slice', 'xrBandZoom', 'shake', 'chroma'],
      trans: ['mvTransPopFlashWipe', 'whipPan', 'knStripSlam', 'flashCross', 'pushSlide', 'cubeTurn'],
      treat: ['mvTreatHhChrome', 'extrude', 'hardShadow', 'outlineFill', 'knWordPlate', 'knWordScale', 'chrome'],
      bg: ['mvBgHhSubGrid', 'eqBars', 'spotlight', 'squareTunnel', 'particlesBg', 'xpShiftRows'],
      decor: ['mvDecoHhBars', 'beatRing', 'barcode', 'speedCorner', 'bars', 'knSpeedTrail', 'waveform'],
    },
    avoid: { bg: ['seigaiha', 'asanoha', 'wzBgShippo'], decor: ['petals'] },
  },
  artmotion: {
    name: 'ART & MOTION',
    moods: ['graphic', 'glitch', 'pop'],
    styles: [
      'kineticPop', 'bauhausKinetic', 'popArtBenDay', 'stereo3D', 'glitchPrism', 'caution', 'acid', 'blueprint', 'candy', 'rouge',
      'amSwissKinetic', 'amBrutalistType', 'amOpArtWave', 'amMemphisGroove', 'amRisographInk',
      'amGalleryPoster', 'amNeonKinetic', 'amCollageCut', 'amFoldOrigami', 'amKineticBrass',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'artmotion', fontSwap: 0.92,
    fxPatch: { motion: [0.78, 0.98], glitch: [0.38, 0.78], chroma: [0.58, 0.92], decor: [0.64, 0.96], density: [0.55, 0.85], texture: [0.35, 0.65], bgSwitch: [0.5, 0.85] },
    prefers: {
      layout: ['xbIsoStack', 'perspective', 'diag', 'stickerBomb', 'flipBoard', 'crossBands', 'tunnel', 'xbTwistFrames', 'xbDonut', 'xbHoneycomb', 'xbCompGrid', 'xdHelix', 'xdPivotFan', 'cube', 'accordion'],
      enter: ['knWordSpin', 'knStretchOut', 'knHingeDrop', 'flipX', 'flipY', 'domino', 'fold', 'squashDrop', 'glitchIn', 'slice', 'vSlice', 'xePieceVortex', 'xeGearTick'],
      hold: ['skewWobble', 'rotateSlow', 'orbitSmall', 'xkZigzagFlip', 'xkSpinOne', 'xkParallax', 'kzSquashWave', 'kzSlinky', 'glitchtick', 'flipSwap'],
      exit: ['flipOutX', 'flipOutY', 'foldOut', 'shatterLite', 'vSliceDrop', 'glitchDissolve', 'explode', 'dominoOut', 'xjQuarterTurn', 'xhConcertina'],
      cam: ['barrelRoll', 'roll', 'dutch', 'knTiltKick', 'knCardFlip', 'knShearKick', 'xqTickRoll', 'xqDriftTurn', 'kzRecoil', 'knJumpCut'],
      fx: ['amFx3DFlipCube', 'amFxGlitchTear', 'amFxPopBenDayFlash', 'amFxKineticPrism', 'amFxIsoPulse', 'perspectiveTilt', 'kaleido', 'halftone', 'duotone', 'pixelSort', 'shatter', 'xrQuadCycle', 'xrFlipTiles', 'xrAccordion', 'xrRibbonTwist', 'kzCardSlam', 'slice', 'chroma'],
      trans: ['amTransPrismFold', 'amTransBauhausSlide', 'amTransComicWipe', 'cubeTurn', 'shatterTiles', 'sliceShift', 'diagonalWipe', 'spinOut', 'knCornerSwing', 'xqAccordion', 'xqFlipOver', 'xqPropeller'],
      treat: ['amTreat3DAnaglyph', 'amTreatIsoDepth', 'amTreatPopCMYK', 'amTreatPopStarburst', 'amTreatKineticSlice', 'amTreatBauhausBlock', 'amTreatGlitchPrism', 'extrude', 'longShadow', 'hardShadow', 'outlineFill', 'doubleOutline', 'halftone', 'stripes', 'splitColor', 'xoBandExtrude'],
      bg: ['amBgIsoPrism', 'amBgIsoLattice', 'amBgPopBenDay', 'amBgComicPanels', 'amBgBauhausGeo', 'amBgBauhausGrid', 'amBgOpMoire', 'isoCubes', 'triTess', 'moire', 'checker', 'polka', 'halftoneFade', 'xpFoldPlanes', 'xpLissajous', 'kzBigGears', 'xpShiftRows'],
      decor: ['amDecoBauhaus', 'amDecoComicBurst', 'amDecoIsoCube', 'xmMoire', 'xmSpiro', 'xmIsoCubes', 'xmGears', 'xmPendulum', 'glitchRects', 'shapes', 'stripes', 'triangleSpin', 'memphis'],
    },
  },
  futuristic: {
    name: 'FUTURISTIC',
    moods: ['glitch', 'graphic', 'pop'],
    styles: [
      'cyberAi', 'mint', 'synth80', 'hud', 'vapor', 'acid',
      'futNeuroHolo', 'futOrbitalHud', 'futQuantumGrid', 'futTokyoCyber',
      'futBiometric', 'futSolarisAi', 'futDeepSpace', 'futIonMatrix',
      'futHyperlink', 'futZeroGravity', 'futPlasmaArc', 'futMechaSpec',
      'futSynthWaveAI', 'futChronoGlass',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.7, 0.92], glitch: [0.45, 0.85], chroma: [0.68, 0.96], decor: [0.58, 0.88], density: [0.52, 0.8], texture: [0.55, 0.85], bgSwitch: [0.4, 0.72] },
    prefers: {
      layout: ['neon', 'tunnel', 'dotMatrix', 'labels', 'xcBrowser', 'xcGauge', 'xcLoading', 'xbCrosshair', 'xbDial', 'xdConstellation', 'ledScroll'],
      enter: ['neonOn', 'scramble', 'resolve', 'matrixRain', 'crtOn', 'interlace', 'loadingBar', 'odometer', 'dither', 'flicker', 'xfScanner', 'xfPrintHead'],
      hold: ['scanBand', 'glowFlicker', 'echoTrail', 'glitchtick', 'colorRun', 'xkMagnifier', 'tyReadCursor', 'xkDoubleVision', 'tyOutlineBlink'],
      exit: ['matrixOut', 'scanOut', 'glitch', 'glitchDissolve', 'scrambleOut', 'rgbSplitOut', 'xhBarcode', 'xiInverseBand'],
      cam: ['vertigo', 'spiralIn', 'focusIn', 'snapPan', 'push', 'xqArcSweep', 'xqFocusHunt', 'stepZoom', 'xqTripodNudge'],
      fx: ['chroma', 'radialChroma', 'rgbSplit', 'crtOff', 'vhsRoll', 'trackingNoise', 'edgeDetect', 'macroBlock', 'scanBar', 'ditherBit', 'xrScanBurst', 'xrCrosshair', 'xrMoire', 'amFxGlitchTear'],
      trans: ['irisOpen', 'xqBladeRun', 'xqPolyIris', 'pixelate', 'blockDissolve', 'flashCross', 'knStripSlam'],
      treat: ['neonOutline', 'glow', 'glitchSplit', 'monoGrid', 'chrome', 'echoOutline', 'inline', 'amTreatGlitchPrism', 'amTreatIsoDepth'],
      bg: ['retroGrid', 'hexGrid', 'squareTunnel', 'xpDepthGrid', 'xpRadar', 'xpScanner', 'xpPlexus', 'xpLoadBars', 'xpSevenSeg', 'starfield', 'scanBars', 'amBgIsoLattice'],
      decor: ['reticle', 'crosshair', 'barcode', 'qrBlock', 'xmGauge', 'xnLevelMeter', 'xnTimeline', 'xnAsciiGauge', 'radar', 'circuit', 'spinner', 'dataColumns', 'amDecoIsoCube'],
    },
    avoid: { decor: ['petals', 'tapePieces', 'paperClip', 'scribbleCircle'], bg: ['tornPaper', 'seigaiha', 'asanoha'] },
  },
  lifestyle: {
    name: 'LIFESTYLE',
    moods: ['editorial', 'calm', 'emotional'],
    styles: [
      'atelierLux', 'gold', 'specimen', 'paper', 'forest', 'newsprint',
      'luxMaisonIvory', 'luxNoirCashmere', 'luxRiviera', 'luxKyotoTea',
      'luxParisRunway', 'luxMilanTravel', 'luxMarbleGallery', 'luxEspressoDoc',
      'luxChampagneSilk', 'luxNordicLinen', 'luxTerracotta', 'luxSatinMidnight',
      'luxBotanicalVogue', 'luxMonochromeMag',
    ],
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
    styles: [
      'animePrism', 'sakura', 'candy', 'sunset', 'ocean', 'vapor',
      'aniCelStudio', 'aniMagicalGirl', 'aniCartoonBounce', 'aniFantasyForest',
      'aniSurrealDream', 'aniMechaAnime', 'aniGhibliMeadow', 'aniShonenFlame',
      'aniDreamyLofi', 'aniToonStudio', 'aniCrystalFairy', 'aniComicKawaii',
      'aniSunsetSakura', 'aniSurrealMirror',
    ],
    koma: [0],
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
  guofeng: {
    name: 'GUOFENG · 国风古典',
    moods: ['emotional', 'calm', 'editorial', 'pop', 'graphic'],
    styles: [
      'gfQianliShanShui', 'gfShuiMoJiangNan', 'gfZhuQiangZiJin', 'gfQingHuaCi', 'gfDunHuangFeiTian',
      'gfFeiCuiYu', 'gfJingTaiLan', 'gfShangYuanDeng', 'gfTangFengShengShi', 'gfSongCiWanYue',
      'gfHanFuJianXia', 'gfZhuLinQiXian', 'gfHanMeiAoXue', 'gfXiQuLianPu', 'gfSuXiuJinDuan',
      'gfChaDaoChanYi', 'gfShanHaiShenHua', 'gfDaQiJinBo', 'gfGuQinYaYun', 'gfMuDanGuoSe',
      'gfTaotieQingTong', 'gfPiYingJianZhi', 'gfHongLouMeng', 'gfMoKeSaiWai', 'gfRuYaoTianQing',
      'gfSiChouZhiLu', 'gfTaiChiYinYang', 'gfHuPoLiuLi', 'gfZiTengYunHai', 'gfChiBiFengHuo',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'guofeng', fontSwap: 0.72,
    fxPatch: { motion: [0.58, 0.86], glitch: [0.02, 0.14], chroma: [0.14, 0.38], decor: [0.55, 0.88], density: [0.38, 0.65], texture: [0.45, 0.78], bgSwitch: [0.35, 0.68] },
    prefers: {
      layout: ['vcols', 'kanjiFocus', 'columnsBig', 'frameBox', 'center', 'huge', 'quote', 'dropCap', 'lowerThird', 'depthStack', 'perspective', 'splitScreen'],
      enter: ['strokeDraw', 'inkBleed', 'unroll', 'fadeStagger', 'blurStagger', 'trackIn', 'riseMask', 'glint', 'fanOpen', 'windBlown', 'wipe'],
      hold: ['breathe', 'drift', 'focusRack', 'shimmer', 'glintSweep', 'xkParallax', 'xkFocusBreath', 'float', 'sway', 'windGust'],
      exit: ['trackOutWide', 'dissolve', 'drift', 'blurOutStagger', 'flutterOut', 'fanClose', 'undraw', 'wipe', 'sweepCover', 'sinkMask'],
      cam: ['dollyIn', 'pullOut', 'orbitDrift', 'panL', 'panR', 'tiltUp', 'xqLongLens', 'xqArcSweep', 'pendulumSway', 'xqLeafFall'],
      fx: ['gfFxInkMist', 'gfFxGoldLeafFloat', 'gfFxScrollEdge', 'gfFxCalligraphyFlick', 'lightSweep', 'lightRays', 'defocus', 'bloomFlash', 'starGlint', 'ripple'],
      trans: ['gfTransScrollUnroll', 'gfTransFoldingFan', 'gfTransInkWashDissolve', 'inkBlob', 'xqSoftSweep', 'xqPagePeel', 'xqLightLeak', 'irisOpen', 'wipe', 'xqWaveWipe'],
      treat: ['gfTreatCinnabarSeal', 'gfTreatGoldLacquer', 'gfTreatInkSplash', 'gfTreatPorcelainRim', 'gfTreatJadeCarving', 'softShadow', 'glow', 'gradientV', 'wide', 'emphasisDots', 'fadeChars', 'outline', 'kerningWide'],
      bg: ['gfBgShanShui', 'gfBgPalaceLattice', 'gfBgDunhuangRibbons', 'gfBgPorcelainWave', 'gfBgLanternNight', 'gfBgBambooInk', 'mountains', 'oceanWaves', 'horizonGlow', 'bokehBg', 'particlesBg', 'cloudLayers', 'borderFrame', 'spotlight'],
      decor: ['gfDecoSealStamp', 'gfDecoCloudMotif', 'gfDecoPlumInk', 'gfDecoLanternTag', 'seal', 'watermarkKanji', 'brushStroke', 'petals', 'twinkle', 'bokeh', 'lightLeak', 'leaders', 'cloudPuffs', 'fireflies', 'rings'],
    },
    avoid: {
      layout: ['xcBrowser', 'dotMatrix', 'stickerBomb'],
      hold: ['jitter', 'glitchtick'],
      fx: ['crtOff', 'vhsRoll', 'trackingNoise', 'macroBlock', 'invert', 'amFxGlitchTear'],
      treat: ['amTreatPopCMYK', 'amTreatGlitchPrism', 'amTreat3DAnaglyph'],
      bg: ['retroGrid', 'amBgPopBenDay', 'amBgComicPanels', 'seigaiha', 'asanoha', 'wzBgShippo', 'polka', 'checker'],
      decor: ['glitchRects', 'barcode', 'qrBlock', 'confetti'],
    },
  },
  bauhaus: {
    name: 'BAUHAUS',
    moods: ['graphic', 'editorial', 'pop'],
    styles: [
      'bauhausKinetic', 'bhDessauCream', 'bhWeimarObsidian', 'bhCobaltAxis', 'bhVermilionRule',
      'bhKandinskyArc', 'bhMoholyPrism', 'bhSwissIntl', 'bhGropiusSlate', 'bhAlbersNest',
      'bhBayerDiagonal', 'bhStijlPrimary', 'bhOchreBrass', 'bhConcreteHatch', 'bhMonoRotunda',
      'bhUlmModular', 'bhTschichold', 'bhVignelliJet', 'bhConstructRed', 'bhArchivalGold',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'artmotion', fontSwap: 0.9,
    fxPatch: { motion: [0.74, 0.96], glitch: [0.06, 0.25], chroma: [0.35, 0.65], decor: [0.68, 0.96], density: [0.5, 0.8], texture: [0.3, 0.6], bgSwitch: [0.5, 0.85] },
    prefers: {
      layout: ['diag', 'xbCompGrid', 'flipBoard', 'crossBands', 'perspective', 'splitScreen', 'frameBox', 'typeSpecimen', 'huge', 'vcols', 'xdPivotFan', 'accordion'],
      enter: ['knWordSpin', 'knHingeDrop', 'fold', 'domino', 'wipe', 'slice', 'trackIn', 'stretch', 'xeGearTick'],
      hold: ['rotateSlow', 'xkParallax', 'skewWobble', 'kzSlinky', 'drift', 'breathe'],
      exit: ['foldOut', 'xjQuarterTurn', 'xhConcertina', 'vSliceDrop', 'wipe', 'trackOutWide'],
      cam: ['dutch', 'xqTickRoll', 'knTiltKick', 'roll', 'orbitDrift', 'panL', 'panR'],
      fx: ['amFxKineticPrism', 'amFx3DFlipCube', 'xrQuadCycle', 'xrFlipTiles', 'xrAccordion', 'lightSweep'],
      trans: ['amTransBauhausSlide', 'amTransPrismFold', 'xqAccordion', 'diagonalWipe', 'sliceShift', 'wipe'],
      treat: ['amTreatBauhausBlock', 'amTreatKineticSlice', 'hardShadow', 'longShadow', 'outlineFill', 'stripes', 'xoFoldHalf'],
      bg: ['amBgBauhausGeo', 'amBgBauhausGrid', 'xpShiftRows', 'xpFoldPlanes', 'checker', 'moire', 'triTess'],
      decor: ['amDecoBauhaus', 'shapes', 'stripes', 'grid', 'xmGears', 'triangleSpin', 'cropMarks'],
    },
    avoid: { bg: ['seigaiha', 'asanoha'], fx: ['vhsRoll', 'crtOff', 'trackingNoise'], decor: ['petals', 'heartsStars'] },
  },
  popart: {
    name: 'POP ART',
    moods: ['pop', 'graphic', 'glitch'],
    styles: [
      'popArtBenDay', 'popRoyComic', 'popWarholSilk', 'popCyanMagenta', 'popSupernova',
      'popElectricLime', 'popStudioCandy', 'popCobaltZap', 'popNoirInk', 'popSunsetPunch',
      'popBubblegum', 'popBananaVelvet', 'popMintCherry', 'popNewsZine', 'popArcadePow',
      'popCoralJazz', 'popLaserBerry', 'popGoldenBoom', 'popSkyAction', 'popCrimsonInk',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'artmotion', fontSwap: 0.92,
    fxPatch: { motion: [0.8, 0.98], glitch: [0.18, 0.52], chroma: [0.55, 0.88], decor: [0.72, 1.0], density: [0.55, 0.85], texture: [0.22, 0.5], bgSwitch: [0.55, 0.88] },
    prefers: {
      layout: ['stickerBomb', 'splitScreen', 'diag', 'huge', 'wave', 'pill', 'scatter', 'mixed', 'xdFourUp', 'ring'],
      enter: ['squashDrop', 'pop', 'bounceBig', 'rubber', 'knWordSpin', 'knWordSlam', 'drop', 'spin'],
      exit: ['popOut', 'scatter', 'shatterLite', 'dominoOut', 'whipOut', 'shrink'],
      hold: ['kzSquashWave', 'beatHop', 'xkZigzagFlip', 'jelly', 'xkBeatBump', 'pulse'],
      treat: ['amTreatPopStarburst', 'amTreatPopCMYK', 'halftone', 'outlineFill', 'doubleOutline', 'hardShadow', 'sticker'],
      bg: ['amBgComicPanels', 'amBgPopBenDay', 'polka', 'halftoneFade', 'sunburst', 'checker'],
      cam: ['bounce', 'knCardFlip', 'xqWhipSpring', 'barrelRoll', 'beatPunch', 'crashZoom'],
      fx: ['amFxPopBenDayFlash', 'halftone', 'bloomFlash', 'kzCardSlam', 'zoomPunch', 'rgbSplit', 'flash'],
      trans: ['amTransComicWipe', 'xqHalftone', 'amTransPrismFold', 'cubeTurn', 'spinOut', 'whipPan'],
      decor: ['amDecoComicBurst', 'memphis', 'sparks', 'confetti', 'shapes', 'dots', 'lineBurst'],
    },
    avoid: { bg: ['seigaiha', 'asanoha', 'mountains'], decor: ['petals'] },
  },
  iso3d: {
    name: '3D ISOMETRIC',
    moods: ['graphic', 'glitch', 'pop'],
    styles: [
      'stereo3D', 'isoDeepCobalt', 'isoObsidianGlass', 'isoEmeraldDepth', 'isoAnaglyphRed',
      'isoPlatinumCad', 'isoRoyalAmethyst', 'isoAmberPrism', 'isoChalkArch', 'isoTitanium',
      'isoHoloMatrix', 'isoBronzeLat', 'isoFrostIce', 'isoRubinCut', 'isoMidnightAxis',
      'isoPaperRelief', 'isoJadeTower', 'isoNeonWire', 'isoIndigoParallax', 'isoSolarGold',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'artmotion', fontSwap: 0.88,
    fxPatch: { motion: [0.72, 0.95], glitch: [0.22, 0.58], chroma: [0.62, 0.92], decor: [0.58, 0.88], density: [0.5, 0.8], texture: [0.25, 0.55], bgSwitch: [0.48, 0.82] },
    prefers: {
      layout: ['xbIsoStack', 'perspective', 'cube', 'tunnel', 'depthStack', 'xbTwistFrames', 'xdHelix', 'xbDonut', 'xbHoneycomb'],
      enter: ['flipX', 'flipY', 'fold', 'knWordSpin', 'assemble', 'zoom', 'xePieceVortex'],
      hold: ['xkParallax', 'xkDepthRock', 'xkZigzagFlip', 'rotateSlow', 'focusRack', 'xkDoubleVision'],
      exit: ['flipOutX', 'flipOutY', 'foldOut', 'zoomThrough', 'shatterLite', 'zoomFar'],
      cam: ['barrelRoll', 'knCardFlip', 'orbitDrift', 'xqArcSweep', 'dollyIn', 'xqTruckAround', 'vertigo'],
      fx: ['amFxIsoPulse', 'amFx3DFlipCube', 'amFxKineticPrism', 'perspectiveTilt', 'xrFlipTiles', 'chroma', 'radialChroma'],
      trans: ['amTransPrismFold', 'cubeTurn', 'xqFlipOver', 'shatterTiles', 'zoomThrough', 'xqPolyIris'],
      treat: ['amTreatIsoDepth', 'amTreat3DAnaglyph', 'extrude', 'longShadow', 'doubleOutline', 'xoBandExtrude'],
      bg: ['amBgIsoLattice', 'amBgIsoPrism', 'isoCubes', 'xpFoldPlanes', 'squareTunnel', 'triTess', 'xpDepthGrid'],
      decor: ['amDecoIsoCube', 'xmIsoCubes', 'xmMoire', 'reticle', 'grid', 'concentricSquares'],
    },
    avoid: { bg: ['polka', 'seigaiha'], decor: ['confetti', 'petals', 'heartsStars'] },
  },
  compositing: {
    name: 'COMPOSITING',
    moods: ['editorial', 'emotional', 'graphic'],
    styles: [
      'compCentreSilk', 'compCentreObsidian', 'compChromaPure', 'compSideBySide', 'compBroadcastHUD',
      'compChampagneEdge', 'compStudioAlpha', 'compDuetSplit', 'compSpotlightCentre', 'compLowerEdgePro',
      'compPearlMatte', 'compCobaltKey', 'compLiveConcert', 'compPortraitMargin', 'compEditorialFrame',
      'compKeyPlateNeon', 'compCineOverlay', 'compVogueMargins', 'compCleanChromaPro', 'compStageMonitor',
    ],
    koma: [0],
    centerFree: true,
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fontTheme: 'artmotion', fontSwap: 0.72,
    fxPatch: { motion: [0.56, 0.82], glitch: [0.04, 0.22], chroma: [0.22, 0.52], decor: [0.42, 0.74], density: [0.35, 0.58], texture: [0.08, 0.3], bgSwitch: [0.3, 0.6] },
    prefers: {
      layout: ['splitScreen', 'vcols', 'splitHalves', 'halfVertical', 'lowerThird', 'frameBox', 'columnsBig', 'depthStack', 'edgeFrame', 'corners'],
      enter: ['trackIn', 'fadeStagger', 'blurStagger', 'wipe', 'riseMask', 'shutter', 'glint'],
      hold: ['breathe', 'drift', 'xkParallax', 'xkFocusBreath', 'shimmer', 'glintSweep', 'still'],
      exit: ['trackOutWide', 'dissolve', 'drift', 'wipe', 'sweepCover', 'sinkMask'],
      cam: ['dollyIn', 'panL', 'panR', 'tiltUp', 'xqLongLens', 'xqLevelOut', 'pullOut'],
      fx: ['amFxCompositingFrame', 'lightSweep', 'whiteFrame', 'defocus', 'bloomFlash', 'anamorphic'],
      trans: ['amTransBauhausSlide', 'xqSoftSweep', 'wipe', 'irisOpen', 'cover', 'uncover'],
      treat: ['amTreatCompositingEdge', 'softShadow', 'outlineFill', 'glow', 'gradientV', 'wide'],
      bg: ['amBgCompositingStudio', 'letterbox', 'borderFrame', 'vignettePulse', 'spotlight'],
      decor: ['amDecoSafeFrame', 'cropMarks', 'reticle', 'crosshair', 'timecodeBar', 'leaders'],
    },
    avoid: { layout: ['huge', 'center', 'stickerBomb'], fx: ['vhsRoll', 'trackingNoise', 'macroBlock', 'invert'] },
  },
  lyricpv: {
    name: '文字PV', moods: ['editorial', 'graphic', 'emotional'], set: 'typo', koma: [0],
    styles: ['noir', 'specimen', 'paper', 'newsprint', 'hud', 'crimson', 'mint', 'blueprint', 'mono', 'rouge', 'bhDessauCream', 'bhSwissIntl', 'amSwissKinetic', 'amGalleryPoster', 'cinSilverHalide', 'cinCriterionInk', 'luxMaisonIvory', 'luxParisRunway', 'compStudioAlpha', 'compEditorialFrame'],
  },
  kinetic: {
    name: 'キネティック', moods: ['pop', 'graphic', 'glitch'], set: 'kinetic', koma: [0],
    styles: ['kineticPop', 'bauhausKinetic', 'caution', 'transit', 'blueprint', 'acid', 'rouge', 'magenta', 'bhBayerDiagonal', 'bhConstructRed', 'popRoyComic', 'popSupernova', 'isoNeonWire', 'mvHipHopRaw', 'mvClubStrobe', 'amSwissKinetic', 'amBrutalistType', 'amOpArtWave', 'stagePrism', 'glitchPrism'],
  },
  wa: {
    name: '和風', moods: ['calm', 'emotional', 'editorial'], wa: true, koma: [0],
    styles: ['sakura', 'sumi', 'gold', 'paper', 'forest', 'luxKyotoTea', 'aniSunsetSakura', 'aniGhibliMeadow', 'aniDreamyLofi', 'noir', 'crimson', 'cinSilverHalide', 'cinCriterionInk', 'amFoldOrigami', 'amRisographInk', 'luxMaisonIvory', 'luxMarbleGallery', 'atelierLux', 'specimen', 'newsprint'],
  },
  horror: {
    name: 'ホラー', moods: ['horror'], set: 'horror',
    styles: ['hrRuin', 'hrNightRec', 'hrCurse', 'noir', 'crimson', 'mono', 'hud', 'sumi', 'acid', 'glitchPrism', 'cinVelvetNoir', 'cinMonolith', 'cinAmberNocturne', 'mvDrillDark', 'isoMidnightAxis', 'isoObsidianGlass', 'amBrutalistType', 'futTokyoCyber', 'futPlasmaArc', 'aniShonenFlame'],
  },
  pop: {
    name: 'POP',
    moods: ['pop', 'graphic', 'emotional'],
    styles: [
      'popStarlight', 'popBubblePink', 'popMirrorball', 'popSolarCitrus', 'popNeonArcade',
      'popCottonSky', 'popChromeHeart', 'popConfettiBoom', 'popLaserMint', 'popVelvetChart',
    ],
    koma: [0],
    extra: true, extra2: true, sets: ['typo', 'kinetic'], sprinkle: 0,
    fxPatch: { motion: [0.76, 0.96], glitch: [0.10, 0.34], chroma: [0.48, 0.82], decor: [0.62, 0.94], density: [0.52, 0.80], texture: [0.18, 0.45], bgSwitch: [0.50, 0.85] },
    prefers: {
      layout: ['mixed', 'pill', 'ring', 'bounceLine', 'wave', 'bubbles', 'stickerBomb', 'equalizer', 'xdKaraoke', 'marquee'],
      enter: ['mvPopElasticStar', 'mvPopCurtainFlash', 'pop', 'bounceBig', 'rubber', 'squashDrop', 'xgJelly', 'knPushIn'],
      hold: ['mvPopGrooveBounce', 'mvPopGlossShimmer', 'beatHop', 'jelly', 'wave', 'eqBounce', 'xkBeatBump', 'pulse'],
      exit: ['mvPopSparkBurst', 'popOut', 'scatter', 'spinOut', 'shrink', 'whipOut'],
      cam: ['mvCamPopStageHop', 'mvCamPopChorusWide', 'bounce', 'xqWhipSpring', 'beatPunch', 'dollyIn', 'xqBeatBreath'],
      fx: ['mvFxPopSparkFlash', 'bloomFlash', 'starGlint', 'zoomPunch', 'flash', 'xrSpotlight', 'chroma'],
      trans: ['mvTransPopFlashWipe', 'flashCross', 'xqRingRipple', 'irisOpen', 'clockWipe', 'whipPan'],
      treat: ['mvTreatHhChrome', 'rainbow', 'glow', 'sticker', 'outlineFill', 'neonOutline', 'karaoke'],
      bg: ['mvBgPopMirrorLights', 'auroraRibbons', 'sunburst', 'meshBlobs', 'fireworks', 'gradientSweep', 'eqBars'],
      decor: ['mvDecoPopSparks', 'sparks', 'confetti', 'twinkle', 'heartsStars', 'beatRing', 'lineBurst'],
    },
    avoid: { bg: ['seigaiha', 'asanoha', 'wzBgShippo'] },
  },
  ballad: {
    name: 'バラード', moods: ['calm', 'emotional'], koma: [0],
    styles: ['gold', 'sakura', 'ocean', 'sunset', 'forest', 'paper', 'specimen', 'atelierLux', 'noir', 'luxMaisonIvory', 'luxNoirCashmere', 'luxChampagneSilk', 'luxRiviera', 'cinAmberNocturne', 'cinNordicMist', 'mvRnbVelvet', 'aniDreamyLofi', 'aniSunsetSakura', 'aniCrystalFairy', 'compCentreSilk'],
  },
};
J.THEME_ORDER = Object.keys(J.THEMES);

J.omakase = (project, rnd = Math.random, themeId = null, audio = null) => {
  const T = themeId && J.THEMES[themeId] ? J.THEMES[themeId] : null;
  const switches = {};
  if (T && T.set) switches[T.set] = true;
  if (T && Array.isArray(T.sets)) for (const s of T.sets) switches[s] = true;
  if (T && T.extra) switches.extra = true;
  if (T && T.extra2) switches.extra2 = true;
  if (T && T.centerFree) switches.centerFree = true;
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
    const heroProb = tStyles.length >= 10 ? 0.16 : 0.55;
    if (hero && okStyle(hero) && project.style !== hero && rnd() < heroProb) pool = [hero];
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
  // Adapt motion, cut density & flash intensity dynamically to the loaded song's BPM & energy
  if (audio && (audio.bpm || (audio.energy && audio.energy.length))) {
    const bpm = Number(audio.bpm) || (project.timing && Number(project.timing.bpm)) || 108;
    let avgEn = 0.55;
    if (audio.energy && audio.energy.length) {
      let sum = 0; const step = Math.max(1, Math.floor(audio.energy.length / 120)); let cnt = 0;
      for (let i = 0; i < audio.energy.length; i += step) { sum += audio.energy[i]; cnt++; }
      avgEn = cnt ? sum / cnt : 0.55;
    }
    const tempoK = J.clamp((bpm - 72) / 72, 0, 1);     // 0 around 72 BPM -> 1 around 144+ BPM
    const enK = J.clamp((avgEn - 0.25) / 0.55, 0, 1);
    const dynBoost = (tempoK * 0.55 + enK * 0.45 - 0.45);
    const clampIn = (val, key) => {
      const r = fxRanges[key] || [0.2, 0.95];
      return +J.clamp(val, r[0], Math.min(1, r[1])).toFixed(2);
    };
    fx.motion = clampIn(fx.motion + dynBoost * 0.16, 'motion');
    fx.density = clampIn(fx.density + dynBoost * 0.18, 'density');
    if (fx.chroma != null) fx.chroma = clampIn(fx.chroma + dynBoost * 0.10, 'chroma');
    if (fx.bgSwitch != null) fx.bgSwitch = clampIn(fx.bgSwitch + dynBoost * 0.12, 'bgSwitch');
  }
  fx.koma = pick(T && T.koma ? T.koma : { horror: [12, 8, 0], glitch: [12, 12, 8], pop: [12, 12, 8, 0], calm: [0, 0, 12], editorial: [0, 12], emotional: [12, 0], graphic: [12, 12, 0] }[mood] || [12, 8, 0]);
  fx.onTwos = fx.koma > 0;
  fx.flash = audio && audio.bpm >= 112 ? rnd() < 0.78 : rnd() < 0.65;
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
  // fonts: prefer the style's own curated role fonts, or rich multi-font packs for theme-driven aesthetics (e.g. artmotion)
  const fonts = {};
  const sampleN = (list, n) => {
    if (!list.length) return [];
    const copy = list.slice(), out = [];
    while (copy.length && out.length < n) out.push(copy.splice(Math.floor(rnd() * copy.length), 1)[0]);
    return out;
  };
  if (T && T.fontTheme) {
    const tf = Object.entries(J.FONTS).filter(([k, f]) => !f.user && f.theme === T.fontTheme && (!J.randomOk || J.randomOk(project, 'font', k)));
    const dispPool = tf.filter(([, f]) => f.kind === 'display' || f.kind === 'round' || f.kind === 'pixel' || f.kind === 'brush').map(([k]) => k);
    const serifPool = tf.filter(([, f]) => f.kind === 'mincho' || f.kind === 'brush').map(([k]) => k);
    const bodyPool = tf.filter(([, f]) => f.kind === 'gothic' || f.kind === 'round' || f.kind === 'display' || f.kind === 'mincho').map(([k]) => k);
    const monoPool = tf.filter(([, f]) => f.kind === 'mono' || f.kind === 'pixel').map(([k]) => k);
    if (rnd() < (T.fontSwap ?? 0.9) && dispPool.length) fonts.display = sampleN(dispPool, Math.min(6, dispPool.length));
    if (rnd() < 0.85 && serifPool.length) fonts.serif = sampleN(serifPool, Math.min(3, serifPool.length));
    if (rnd() < 0.85 && bodyPool.length) fonts.body = sampleN(bodyPool, Math.min(4, bodyPool.length));
    if (rnd() < 0.85 && monoPool.length) fonts.mono = sampleN(monoPool, Math.min(3, monoPool.length));
  } else {
    const faces = Object.entries(J.FONTS).filter(([k, f]) => !f.user && !['mono', 'pixel'].includes(f.kind) && (!J.randomOk || J.randomOk(project, 'font', k)));
    const swapP = T && T.styles ? 0.25 : 0.4;
    if (rnd() < swapP) fonts.display = pick(faces.filter(([k, f]) => f.weight >= 700 || f.kind === 'display' || f.kind === 'round'))[0];
    if (rnd() < 0.25) fonts.serif = pick(faces.filter(([k, f]) => f.kind === 'mincho' || f.kind === 'brush'))[0];
    if (mood === 'chaos' && rnd() < 0.2) fonts.display = 'dot';
  }
  // colours: style palette most of the time (with scheme rotation for rich styles), fresh accent / ghost pair otherwise
  const colors = Object.assign({}, project.colors, { enabled: false, accentOn: false });
  const scLen = (J.STYLES[style] && J.STYLES[style].schemes && J.STYLES[style].schemes.length) || 1;
  if (T && T.fontTheme && scLen > 1) colors.schemeShift = Math.floor(rnd() * scLen);
  else delete colors.schemeShift;
  if (rnd() < (T && T.styles ? (T.fontTheme ? 0.34 : 0.24) : 0.38)) {
    const baseScheme = J.STYLES[style].schemes[(colors.schemeShift || 0) % scLen];
    Object.assign(colors, J.randomPalette(baseScheme.bg, rnd), { accentOn: true });
    delete colors.mode;
  }
  // keep locked lines, drop other per-line picks
  const overrides = {};
  for (const [i, o] of Object.entries(project.overrides || {})) if (o.lock) overrides[i] = o; else if (o.cutTime) overrides[i] = { cutTime: o.cutTime };   // cut times are timing, not the look
  return Object.assign({ mood, style, fx, enabled, fonts, colors, overrides, seed: Math.floor(rnd() * 1e9) }, switches);
};
})();
