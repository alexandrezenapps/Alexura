/* ============================================================================
   ALEXURA STUDIO — 11p_styles_collection.js
   Collection Luxe & Professionnelle : 20 styles fluides et distincts par thème
   (Bauhaus Kinetic, Pop Art Halftone, 3D Isometric Wireframe, Compositing,
    Cinematic, Music Video, Art & Motion, Futuristic, Lifestyle, Animation)
   ============================================================================ */
(() => {
'use strict';

if (!J || !J.STYLES) return;

/* Profiles de biais (bias) ultra-fluides par catégorie de thème */
const PROFILES = {
  bauhaus: {
    moods: ['graphic', 'editorial', 'pop'],
    texture: { grain: 0.38, paper: 0.42, scan: 0 },
    ghost: 0.62,
    glow: 0.45,
    fonts: {
      display: ['am_bricolage', 'am_krona', 'am_syncopate', 'am_archivo_black', 'am_baumans', 'am_staatliches', 'dela'],
      serif: ['am_bodoni', 'am_dm_serif', 'mincho_black'],
      body: ['am_josefin', 'am_space_grotesk', 'am_barlow_cond', 'gothic_bold'],
      mono: ['am_major_mono', 'am_space_mono', 'mono'],
    },
    bias: {
      layout: { diag: 2.2, xbCompGrid: 2.1, flipBoard: 2.0, crossBands: 1.9, perspective: 1.8, splitScreen: 1.8, frameBox: 1.7, typeSpecimen: 1.7, huge: 1.6 },
      enter: { knWordSpin: 2.1, knHingeDrop: 2.0, fold: 1.9, domino: 1.9, wipe: 1.8, slice: 1.7, trackIn: 1.6 },
      exit: { foldOut: 2.0, xjQuarterTurn: 2.0, xhConcertina: 1.9, vSliceDrop: 1.8, wipe: 1.7 },
      hold: { rotateSlow: 1.9, xkParallax: 1.9, skewWobble: 1.8, kzSlinky: 1.8, drift: 1.5 },
      treat: { amTreatBauhausBlock: 2.5, amTreatKineticSlice: 2.2, hardShadow: 2.0, longShadow: 1.9, outlineFill: 1.8 },
      bg: { amBgBauhausGeo: 2.6, amBgBauhausGrid: 2.4, xpShiftRows: 1.9, xpFoldPlanes: 1.8, checker: 1.6 },
      cam: { dutch: 2.0, xqTickRoll: 2.0, knTiltKick: 1.9, roll: 1.8, orbitDrift: 1.6 },
      fx: { amFxKineticPrism: 2.1, amFx3DFlipCube: 2.0, xrQuadCycle: 1.9, xrFlipTiles: 1.8 },
      trans: { amTransBauhausSlide: 2.6, amTransPrismFold: 2.2, xqAccordion: 2.0, diagonalWipe: 1.9, sliceShift: 1.8 },
    },
    decor: { amDecoBauhaus: 2.5, shapes: 2.0, stripes: 1.9, grid: 1.7, xmGears: 1.7, triangleSpin: 1.6 },
  },

  popart: {
    moods: ['pop', 'graphic', 'glitch'],
    texture: { grain: 0.25, paper: 0.28, scan: 0 },
    ghost: 0.85,
    glow: 0.65,
    fonts: {
      display: ['am_bangers', 'am_luckiest', 'am_honk', 'am_titan', 'am_shrikhand', 'am_oi', 'pop'],
      serif: ['am_ultra', 'am_alfa_slab', 'am_abril'],
      body: ['am_fredoka', 'am_coiny', 'am_chewy', 'round'],
      mono: ['am_space_mono', 'am_pixelify', 'mono'],
    },
    bias: {
      layout: { stickerBomb: 2.4, splitScreen: 2.0, diag: 1.9, huge: 1.9, wave: 1.8, pill: 1.8, scatter: 1.8, mixed: 1.9 },
      enter: { squashDrop: 2.2, pop: 2.1, bounceBig: 2.1, rubber: 2.0, knWordSpin: 1.9, knWordSlam: 1.9 },
      exit: { popOut: 2.1, scatter: 2.0, shatterLite: 1.9, dominoOut: 1.8, whipOut: 1.7 },
      hold: { kzSquashWave: 2.1, beatHop: 2.0, xkZigzagFlip: 1.9, jelly: 1.9, xkBeatBump: 1.8 },
      treat: { amTreatPopStarburst: 2.6, amTreatPopCMYK: 2.5, halftone: 2.1, outlineFill: 2.0, doubleOutline: 2.0, hardShadow: 1.9 },
      bg: { amBgComicPanels: 2.7, amBgPopBenDay: 2.5, polka: 2.1, halftoneFade: 2.0, sunburst: 1.9 },
      cam: { bounce: 2.0, knCardFlip: 1.9, xqWhipSpring: 1.9, barrelRoll: 1.8, beatPunch: 1.8 },
      fx: { amFxPopBenDayFlash: 2.5, halftone: 2.1, bloomFlash: 1.9, kzCardSlam: 1.9, zoomPunch: 1.8 },
      trans: { amTransComicWipe: 2.6, xqHalftone: 2.2, amTransPrismFold: 2.0, cubeTurn: 1.9, spinOut: 1.8 },
    },
    decor: { amDecoComicBurst: 2.6, memphis: 2.1, sparks: 2.0, confetti: 1.8, shapes: 1.8, dots: 1.8 },
  },

  iso3d: {
    moods: ['graphic', 'futuristic', 'glitch'],
    texture: { grain: 0.3, paper: 0, scan: 0.14 },
    ghost: 1.15,
    glow: 1.35,
    fonts: {
      display: ['am_nabla', 'am_bungee_shade', 'am_rubik_iso', 'am_foldit', 'am_monoton', 'am_orbitron', 'rampart'],
      serif: ['am_vast_shadow', 'am_cinzel', 'mincho_black'],
      body: ['am_chakra', 'am_oxanium', 'am_space_grotesk', 'gothic_bold'],
      mono: ['am_rubik_mono', 'am_major_mono', 'mono'],
    },
    bias: {
      layout: { xbIsoStack: 2.5, perspective: 2.4, cube: 2.3, tunnel: 2.2, depthStack: 2.1, xbTwistFrames: 2.0, xdHelix: 1.9 },
      enter: { flipX: 2.2, flipY: 2.2, fold: 2.1, knWordSpin: 2.0, assemble: 1.9, zoom: 1.8 },
      exit: { flipOutX: 2.1, flipOutY: 2.1, foldOut: 2.0, zoomThrough: 2.0, shatterLite: 1.9 },
      hold: { xkParallax: 2.3, xkDepthRock: 2.1, xkZigzagFlip: 2.0, rotateSlow: 1.9, focusRack: 1.7 },
      treat: { amTreatIsoDepth: 2.6, amTreat3DAnaglyph: 2.4, extrude: 2.2, longShadow: 1.9, doubleOutline: 1.9 },
      bg: { amBgIsoLattice: 2.7, amBgIsoPrism: 2.5, isoCubes: 2.2, xpFoldPlanes: 2.1, squareTunnel: 2.0, triTess: 1.9 },
      cam: { barrelRoll: 2.1, knCardFlip: 2.1, orbitDrift: 2.0, xqArcSweep: 1.9, dollyIn: 1.8 },
      fx: { amFxIsoPulse: 2.5, amFx3DFlipCube: 2.4, perspectiveTilt: 2.1, xrFlipTiles: 2.0, chroma: 1.8 },
      trans: { amTransPrismFold: 2.6, cubeTurn: 2.3, xqFlipOver: 2.2, shatterTiles: 2.0 },
    },
    decor: { amDecoIsoCube: 2.6, xmIsoCubes: 2.3, xmMoire: 1.8, reticle: 1.5, grid: 1.5 },
  },

  compositing: {
    moods: ['editorial', 'emotional', 'graphic'],
    texture: { grain: 0.12, paper: 0, scan: 0 },
    ghost: 0.4,
    glow: 1.1,
    fonts: {
      display: ['am_space_grotesk', 'am_syne', 'am_unbounded', 'am_outfit', 'gothic_black', 'zenkaku'],
      serif: ['am_playfair', 'am_cinzel', 'shippori', 'mincho_black'],
      body: ['am_montserrat', 'am_urbanist', 'gothic_bold'],
      mono: ['am_space_mono', 'am_share_tech', 'mono'],
    },
    bias: {
      layout: { splitScreen: 2.5, vcols: 2.3, splitHalves: 2.3, halfVertical: 2.2, lowerThird: 2.2, frameBox: 2.0, columnsBig: 2.0, depthStack: 1.8 },
      enter: { trackIn: 2.1, fadeStagger: 2.0, blurStagger: 1.9, wipe: 1.9, riseMask: 1.8, shutter: 1.8 },
      exit: { trackOutWide: 2.0, dissolve: 1.9, drift: 1.9, wipe: 1.8, sweepCover: 1.8 },
      hold: { breathe: 2.0, drift: 2.0, xkParallax: 1.9, xkFocusBreath: 1.8, shimmer: 1.7, still: 1.5 },
      treat: { amTreatCompositingEdge: 2.6, softShadow: 2.0, outlineFill: 1.9, glow: 1.7, gradientV: 1.7, wide: 1.6 },
      bg: { amBgCompositingStudio: 2.7, letterbox: 2.0, borderFrame: 1.9, vignettePulse: 1.7, spotlight: 1.7 },
      cam: { dollyIn: 1.8, panL: 1.7, panR: 1.7, tiltUp: 1.7, xqLongLens: 1.8, xqLevelOut: 1.7 },
      fx: { amFxCompositingFrame: 2.5, lightSweep: 1.8, whiteFrame: 1.7, defocus: 1.5, bloomFlash: 1.5 },
      trans: { amTransBauhausSlide: 2.0, xqSoftSweep: 2.1, wipe: 1.9, irisOpen: 1.8, cover: 1.7 },
    },
    decor: { amDecoSafeFrame: 2.6, cropMarks: 2.0, reticle: 1.7, crosshair: 1.6, timecodeBar: 1.6, leaders: 1.5 },
  },

  cinematic: {
    moods: ['emotional', 'editorial'],
    texture: { grain: 0.65, paper: 0, scan: 0.14 },
    ghost: 0.68,
    glow: 1.55,
    fonts: {
      display: ['am_cinzel', 'am_bodoni', 'am_playfair', 'mincho_black', 'tokumin'],
      serif: ['am_dm_serif', 'am_abril', 'shippori', 'mincho'],
      body: ['am_montserrat', 'am_josefin', 'gothic_med'],
      mono: ['am_space_mono', 'mono'],
    },
    bias: {
      layout: { credits: 2.1, curtain: 2.0, lowerThird: 1.9, frameBox: 1.8, depthStack: 1.7, perspective: 1.6, filmstrip: 1.6, vcols: 1.5, center: 1.5 },
      enter: { trackIn: 2.1, blurStagger: 1.9, blur: 1.8, iris: 1.7, shutter: 1.7, backlight: 1.7, lightLeak: 1.6, riseMask: 1.5 },
      exit: { trackOutWide: 2.1, dissolve: 1.9, zoomThrough: 1.7, zoomFar: 1.7, blurOutStagger: 1.7, irisClose: 1.6, drift: 1.6 },
      hold: { focusRack: 2.1, xkFocusBreath: 1.9, xkParallax: 1.9, xkDepthRock: 1.7, drift: 1.7, breathe: 1.6, glintSweep: 1.5 },
      treat: { softShadow: 1.8, glow: 1.7, gradientV: 1.6, wide: 1.5, focusPull: 1.6, fadeChars: 1.4 },
      bg: { letterbox: 2.1, rainWindow: 1.9, skyline: 1.8, horizonGlow: 1.7, godRays: 1.8, spotlight: 1.7, filmStrip: 1.6, bokehBg: 1.5 },
      cam: { dollyIn: 2.0, pullOut: 1.9, rackFocus: 2.0, orbitDrift: 1.8, xqArcSweep: 1.8, xqCraneUp: 1.8, xqLongLens: 1.7, xqPushPull: 1.7 },
      fx: { anamorphic: 2.1, lightRays: 2.0, filmAdvance: 1.8, dustScratches: 1.7, lightSweep: 1.8, filmBurn: 1.6, defocus: 1.6 },
      trans: { xqBladeRun: 2.1, irisOpen: 2.0, xqLightLeak: 1.9, xqSoftSweep: 1.8, zoomThrough: 1.7, doorsOpen: 1.5 },
    },
    decor: { timecodeBar: 1.8, lightLeak: 1.7, bokeh: 1.6, cropMarks: 1.4, crosshair: 1.2 },
  },

  musicvideo: {
    moods: ['pop', 'emotional', 'glitch'],
    texture: { grain: 0.35, paper: 0, scan: 0.1 },
    ghost: 0.85,
    glow: 1.65,
    fonts: {
      display: ['am_syne', 'am_unbounded', 'am_archivo_black', 'am_anton', 'dela', 'gothic_black'],
      serif: ['am_abril', 'am_bodoni', 'tokumin', 'mincho_black'],
      body: ['am_outfit', 'am_space_grotesk', 'gothic_bold'],
      mono: ['am_space_mono', 'mono'],
    },
    bias: {
      layout: { equalizer: 2.1, marquee: 2.0, huge: 1.9, neon: 1.9, mirror: 1.8, splitScreen: 1.7, ring: 1.6, pill: 1.6, zoomRepeat: 1.7, xdKaraoke: 1.9 },
      enter: { whip: 2.1, zoom: 2.0, pop: 1.9, bounceBig: 1.8, rubber: 1.7, neonOn: 1.9, echoIn: 1.8, knWordSlam: 2.0, knPushIn: 1.9 },
      exit: { whipOut: 2.0, zoomThrough: 2.0, popOut: 1.8, echoOut: 1.8, scatter: 1.7, knWordKick: 1.9, knPushOut: 1.8, spinOut: 1.6 },
      hold: { beatHop: 2.1, heartbeat: 2.0, eqBounce: 2.0, pulse: 1.9, stretchPulse: 1.8, xkBeatBump: 2.1, xkKaraoke: 2.0, knWordPulse: 1.9 },
      treat: { glow: 2.0, neonOutline: 1.9, chrome: 1.8, extrude: 1.6, knWordScale: 1.9, knWordPlate: 1.7, karaoke: 1.8 },
      bg: { eqBars: 2.1, spotlight: 2.0, auroraRibbons: 1.8, sunburst: 1.7, gradientSweep: 1.7, particlesBg: 1.6, xpPlexus: 1.6 },
      cam: { beatPunch: 2.1, whipIn: 2.0, crashZoom: 1.9, stepZoom: 1.8, bounce: 1.8, xqBeatBreath: 2.0, xqWhipSpring: 2.0, xqLoudZoom: 1.9 },
      fx: { zoomPunch: 2.1, bloomFlash: 1.9, rgbSplit: 1.8, flash: 1.8, strobe: 1.7, speedLines: 1.7, xrSpotlight: 1.9, xrBandZoom: 1.8 },
      trans: { whipPan: 2.1, flashCross: 2.0, zoomThrough: 1.9, cubeTurn: 1.8, xqChevronPush: 1.9, xqRingRipple: 1.8, knStripSlam: 1.8 },
    },
    decor: { beatRing: 2.0, sparks: 1.8, lineBurst: 1.7, knSpeedTrail: 1.7, waveform: 1.7, bars: 1.6 },
  },

  artmotion: {
    moods: ['graphic', 'glitch', 'pop'],
    texture: { grain: 0.42, paper: 0.3, scan: 0.12 },
    ghost: 0.9,
    glow: 0.9,
    fonts: {
      display: ['am_syne', 'am_unbounded', 'am_bricolage', 'am_bungee_shade', 'am_rubik_glitch', 'am_honk', 'dela'],
      serif: ['am_abril', 'am_bodoni', 'am_playfair', 'mincho_black'],
      body: ['am_space_grotesk', 'am_outfit', 'am_chakra', 'gothic_bold'],
      mono: ['am_rubik_mono', 'am_space_mono', 'mono'],
    },
    bias: {
      layout: { xbIsoStack: 2.2, perspective: 2.1, diag: 1.9, stickerBomb: 2.0, flipBoard: 1.9, crossBands: 1.8, xbTwistFrames: 1.9, xdHelix: 1.9, cube: 1.9 },
      enter: { knWordSpin: 2.1, knStretchOut: 2.0, knHingeDrop: 1.9, flipX: 1.9, flipY: 1.9, domino: 1.9, fold: 1.8, slice: 1.8, glitchIn: 1.8 },
      exit: { flipOutX: 1.9, flipOutY: 1.9, foldOut: 1.9, shatterLite: 1.9, vSliceDrop: 1.8, glitchDissolve: 1.9, xjQuarterTurn: 1.9, xhConcertina: 1.8 },
      hold: { skewWobble: 2.0, rotateSlow: 1.9, xkZigzagFlip: 2.0, xkSpinOne: 1.9, xkParallax: 1.8, kzSquashWave: 1.9, kzSlinky: 1.9 },
      treat: { amTreatKineticSlice: 2.2, amTreat3DAnaglyph: 2.1, amTreatPopCMYK: 2.1, amTreatGlitchPrism: 2.0, amTreatBauhausBlock: 2.0, extrude: 1.9, longShadow: 1.9 },
      bg: { amBgBauhausGrid: 2.2, amBgOpMoire: 2.1, amBgIsoPrism: 2.1, amBgPopBenDay: 2.0, triTess: 1.9, moire: 1.8, xpFoldPlanes: 1.9, xpLissajous: 1.8 },
      cam: { barrelRoll: 2.0, roll: 1.9, dutch: 1.8, knTiltKick: 2.0, knCardFlip: 1.9, knShearKick: 1.9, xqTickRoll: 1.9 },
      fx: { amFx3DFlipCube: 2.2, amFxGlitchTear: 2.1, amFxPopBenDayFlash: 2.0, amFxKineticPrism: 2.1, perspectiveTilt: 2.0, kaleido: 1.9, xrQuadCycle: 2.0 },
      trans: { amTransPrismFold: 2.3, amTransBauhausSlide: 2.1, cubeTurn: 2.1, shatterTiles: 2.0, sliceShift: 1.9, xqAccordion: 2.0, xqFlipOver: 2.0 },
    },
    decor: { xmMoire: 1.9, xmSpiro: 1.9, xmIsoCubes: 1.9, xmGears: 1.8, amDecoBauhaus: 1.8, glitchRects: 1.7, memphis: 1.7 },
  },

  futuristic: {
    moods: ['glitch', 'graphic', 'pop'],
    texture: { grain: 0.35, paper: 0, scan: 0.6 },
    ghost: 1.05,
    glow: 1.85,
    fonts: {
      display: ['am_orbitron', 'am_audiowide', 'am_michroma', 'am_chakra', 'dot', 'gothic_black'],
      serif: ['am_cinzel', 'mincho_bold'],
      body: ['am_oxanium', 'am_tektur', 'am_space_grotesk', 'sansui'],
      mono: ['am_share_tech', 'am_space_mono', 'mono', 'dot'],
    },
    bias: {
      layout: { neon: 2.1, tunnel: 2.0, dotMatrix: 2.0, labels: 1.8, xcBrowser: 1.8, xcGauge: 1.9, xcLoading: 1.9, xbCrosshair: 2.0, xbDial: 1.9, xdConstellation: 1.9 },
      enter: { neonOn: 2.1, scramble: 2.0, matrixRain: 2.0, crtOn: 1.9, loadingBar: 1.9, flicker: 1.7, slice: 1.6 },
      exit: { matrixOut: 2.0, scanOut: 2.0, glitch: 1.9, glitchDissolve: 1.9, scrambleOut: 1.9, rgbSplitOut: 1.9 },
      hold: { scanBand: 2.1, glowFlicker: 1.9, echoTrail: 1.9, glitchtick: 1.8, colorRun: 1.8, xkMagnifier: 1.9, xkDoubleVision: 1.9 },
      treat: { neonOutline: 2.1, glow: 2.0, glitchSplit: 1.9, monoGrid: 1.9, chrome: 1.8, amTreatGlitchPrism: 1.9, amTreatIsoDepth: 1.8 },
      bg: { retroGrid: 2.1, hexGrid: 2.0, squareTunnel: 2.0, xpDepthGrid: 2.0, xpRadar: 2.0, xpScanner: 2.0, xpPlexus: 1.9, amBgIsoLattice: 1.9 },
      cam: { vertigo: 1.9, spiralIn: 1.9, focusIn: 1.9, snapPan: 1.8, xqArcSweep: 1.9, xqFocusHunt: 2.0, stepZoom: 1.8 },
      fx: { chroma: 2.1, radialChroma: 2.0, rgbSplit: 2.0, crtOff: 1.9, vhsRoll: 1.8, edgeDetect: 1.8, macroBlock: 1.8, scanBar: 1.9, amFxGlitchTear: 1.9 },
      trans: { xqBladeRun: 2.1, xqPolyIris: 2.0, irisOpen: 1.9, pixelate: 1.9, blockDissolve: 1.9, flashCross: 1.8, knStripSlam: 1.8 },
    },
    decor: { reticle: 2.0, crosshair: 1.9, barcode: 1.8, qrBlock: 1.7, xmGauge: 1.9, xnLevelMeter: 1.9, radar: 1.9, circuit: 1.9 },
  },

  lifestyle: {
    moods: ['editorial', 'calm', 'emotional'],
    texture: { grain: 0.32, paper: 0.35, scan: 0 },
    ghost: 0.34,
    glow: 1.2,
    fonts: {
      display: ['am_playfair', 'am_bodoni', 'am_cinzel', 'shippori', 'mincho_light'],
      serif: ['am_dm_serif', 'am_abril', 'shippori', 'mincho'],
      body: ['am_montserrat', 'am_josefin', 'am_urbanist', 'mincho_light'],
      mono: ['am_space_mono', 'mono'],
    },
    bias: {
      layout: { gloss: 2.1, columnsBig: 2.0, justified: 1.9, quote: 1.9, dropCap: 1.8, lowerThird: 1.8, vcols: 1.7, frameBox: 1.8, center: 1.6, magazine: 1.8 },
      enter: { trackIn: 2.1, fadeStagger: 2.0, blurStagger: 1.9, wipe: 1.8, unroll: 1.7, lightLeak: 1.7, glint: 1.7, riseMask: 1.6, strokeDraw: 1.5 },
      exit: { trackOutWide: 2.1, dissolve: 2.0, drift: 1.9, blurOutStagger: 1.8, sweepCover: 1.7, sinkMask: 1.6, wipe: 1.6 },
      hold: { breathe: 2.1, drift: 2.0, shimmer: 1.9, glintSweep: 1.9, shadowSway: 1.7, focusRack: 1.8, xkFocusBreath: 2.0, xkTallBreath: 1.8 },
      treat: { softShadow: 2.0, gradientV: 1.9, wide: 1.8, emphasisDots: 1.6, underline: 1.6, fadeChars: 1.5 },
      bg: { marble: 2.0, oceanWaves: 1.8, mountains: 1.7, horizonGlow: 1.9, bokehBg: 1.9, particlesBg: 1.6, gradientSweep: 1.8, spotlight: 1.7, borderFrame: 1.6 },
      cam: { dollyIn: 2.0, pullOut: 1.9, driftDiag: 1.9, panL: 1.7, panR: 1.7, tiltUp: 1.7, handheld: 1.6, xqWalkCam: 1.8, xqLongLens: 1.8, xqLevelOut: 1.7 },
      fx: { lightSweep: 2.1, filmBurn: 1.7, whiteFrame: 1.8, defocus: 1.7, lightRays: 1.7, dustScratches: 1.4 },
      trans: { xqSoftSweep: 2.1, xqLightLeak: 2.0, xqPagePeel: 1.9, wipe: 1.7, cover: 1.6, uncover: 1.6, irisOpen: 1.5 },
    },
    decor: { leaders: 1.9, cropMarks: 1.8, rulerEdge: 1.6, lightLeak: 1.8, bokeh: 1.7, twinkle: 1.4, constellation: 1.4, dateStamp: 1.5 },
  },

  animation: {
    moods: ['pop', 'emotional', 'calm'],
    texture: { grain: 0.22, paper: 0.14, scan: 0 },
    ghost: 0.65,
    glow: 1.5,
    fonts: {
      display: ['am_fredoka', 'am_shrikhand', 'am_comfortaa', 'kiwi', 'potta', 'pop'],
      serif: ['am_abril', 'shippori'],
      body: ['am_chewy', 'am_coiny', 'round'],
      mono: ['am_space_mono', 'mono'],
    },
    bias: {
      layout: { bubbles: 2.1, bounceLine: 2.0, elastic: 2.0, wave: 1.9, orbit: 1.9, arcTop: 1.8, rain: 1.7, stickerBomb: 1.7, xdWindSway: 2.0, xdSpiralEcho: 1.9, xdRipple: 1.9 },
      enter: { squashDrop: 2.1, rubber: 2.0, bounceBig: 2.0, waveIn: 2.0, spiralIn: 1.9, inkBleed: 1.8, strokeDraw: 1.8, windBlown: 1.9 },
      exit: { popOut: 2.0, melt: 1.9, balloonOff: 1.9, flutterOut: 1.9, tornadoOut: 1.8, riseOut: 1.8 },
      hold: { jelly: 2.1, float: 2.0, sway: 2.0, wave: 2.0, xkBuoy: 2.0, xkCradle: 1.9, xkDoubleVision: 1.8, kzSquashWave: 1.9 },
      treat: { rainbow: 2.0, outlineFill: 1.9, doubleOutline: 1.9, sticker: 1.8, glow: 1.7 },
      bg: { auroraRibbons: 2.1, meshBlobs: 2.0, starfield: 1.9, cloudLayers: 1.9, fireworks: 1.8, snowLayers: 1.7, kaleidoscope: 1.8, spiralArms: 1.8, sunburst: 1.7, oceanWaves: 1.7 },
      cam: { bounce: 2.0, floatNoise: 2.0, jelly: 2.0, spiralIn: 1.9, orbitDrift: 1.9, pendulumSway: 1.9, xqLeafFall: 2.0, xqSquashRelax: 2.0, xqWhipSpring: 1.9 },
      fx: { kaleido: 2.0, waveWarp: 2.0, ripple: 2.0, starGlint: 1.9, focusLines: 1.9, speedLines: 1.9, hueShift: 1.8, bloomFlash: 1.8, xrWaterMirror: 1.9, xrSwingEcho: 1.9 },
      trans: { inkBlob: 2.0, xqWaveWipe: 2.1, xqRingRipple: 2.0, xqStretchSmear: 2.0, spinOut: 1.8, clockWipe: 1.7 },
    },
    decor: { petals: 1.9, twinkle: 2.0, sparks: 1.8, confetti: 1.7, heartsStars: 1.8, risingParticles: 1.8, bokeh: 1.7, lineBurst: 1.7, fireflies: 1.9, cloudPuffs: 1.7 },
  },
};

/* Marquer les styles existants avec leur catégorie principale */
const EXISTING_CATS = {
  bauhausKinetic: 'bauhaus',
  popArtBenDay: 'popart',
  stereo3D: 'iso3d',
  bladeCinema: 'cinematic', noir: 'cinematic', gold: 'cinematic', hud: 'cinematic', crimson: 'cinematic', mono: 'cinematic',
  stagePrism: 'musicvideo', synth80: 'musicvideo', magenta: 'musicvideo', transit: 'musicvideo', ocean: 'musicvideo',
  kineticPop: 'artmotion', glitchPrism: 'artmotion', caution: 'artmotion', acid: 'artmotion', blueprint: 'artmotion', candy: 'artmotion', rouge: 'artmotion',
  cyberAi: 'futuristic', mint: 'futuristic', vapor: 'futuristic',
  atelierLux: 'lifestyle', specimen: 'lifestyle', paper: 'lifestyle', forest: 'lifestyle', newsprint: 'lifestyle',
  animePrism: 'animation', sakura: 'animation', sunset: 'animation',
};
for (const [k, c] of Object.entries(EXISTING_CATS)) {
  if (J.STYLES[k] && !J.STYLES[k].cat) J.STYLES[k].cat = c;
}

/* Utilitaire de contraste luminance rapide pour générer 3 palettes alternées cohérentes */
function isLightHex(hex) {
  const h = String(hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 152;
}
function dimColor(bg, light) {
  return light ? J.mix(bg, '#000000', 0.08) : J.mix(bg, '#FFFFFF', 0.07);
}
function subColor(bg, fg) {
  return J.mix(fg, bg, 0.34);
}
function makeSchemes(bg, fg, accent, accent2, paper = false, useGrad = false) {
  const l0 = isLightHex(bg);
  const s0 = {
    bg, fg, sub: subColor(bg, fg),
    accent, accent2: accent2 || accent,
    ink: l0 ? fg : accent,
    dim: dimColor(bg, l0),
    ghostA: accent,
    ghostB: accent2 || accent,
    paper: paper && l0 ? true : undefined,
    grad: useGrad ? [accent, accent2 || fg] : undefined,
  };
  // Variante 2 : Inversion contraste avec accent dominant
  const l1 = isLightHex(accent);
  const s1 = {
    bg: accent, fg: l1 ? '#111115' : '#FFFFFF',
    sub: subColor(accent, l1 ? '#111115' : '#FFFFFF'),
    accent: l1 ? '#111115' : '#FFFFFF',
    accent2: bg,
    ink: l1 ? '#111115' : '#FFFFFF',
    dim: dimColor(accent, l1),
    ghostA: bg,
    ghostB: accent2 || (l1 ? '#111115' : '#FFFFFF'),
    paper: paper && l1 ? true : undefined,
    grad: useGrad ? [bg, accent2 || fg] : undefined,
  };
  // Variante 3 : Nuit d'atelier / Papier clair opposé
  const bg2 = l0 ? '#0D1017' : '#F4EFE6';
  const fg2 = l0 ? '#F7F5EE' : '#111216';
  const l2 = isLightHex(bg2);
  const s2 = {
    bg: bg2, fg: fg2,
    sub: subColor(bg2, fg2),
    accent: J.fitContrast ? J.fitContrast(accent, bg2, 2.8) : accent,
    accent2: J.fitContrast ? J.fitContrast(accent2 || accent, bg2, 2.5) : (accent2 || accent),
    ink: fg2,
    dim: dimColor(bg2, l2),
    ghostA: accent,
    ghostB: accent2 || accent,
    paper: paper && l2 ? true : undefined,
    grad: useGrad ? [accent, fg2] : undefined,
  };
  return [s0, s1, s2];
}

/* Définitions des 157 nouveaux styles de luxe : [id, cat, name, desc, bg, fg, accent, accent2, opts] */
const CATALOG = [
  /* ===================== BAUHAUS (19 nouveaux + bauhausKinetic = 20) ===================== */
  ['bhDessauCream', 'bauhaus', 'Bauhaus Dessau Ivoire', 'Cercles primaires, hachures obliques & grille suisse sur papier ivoire', '#F3EFE6', '#111215', '#E02819', '#1847B8', { paper: true }],
  ['bhWeimarObsidian', 'bauhaus', 'Weimar Obsidienne Or', 'Architecture modulaire sombre, or solaire & rouge géométrique', '#111216', '#F5F0E6', '#F2B800', '#E02819'],
  ['bhCobaltAxis', 'bauhaus', 'Axe Cobalt Bauhaus', 'Bleu cobalt architectural, lignes croisées & typographie inclinée', '#153EA8', '#FFFDF6', '#F2B800', '#E02819'],
  ['bhVermilionRule', 'bauhaus', 'Règle Vermillon', 'Fond vermillon manifeste, noir profond & blocs modulaires', '#D9291C', '#F7F4EB', '#141414', '#F2B800'],
  ['bhKandinskyArc', 'bauhaus', 'Kandinsky Cinétique', 'Arcs géométriques, triangles flottants & hachures cobalt', '#F5F1E8', '#14161D', '#1E3A8A', '#D97706', { paper: true }],
  ['bhMoholyPrism', 'bauhaus', 'Moholy-Nagy Modulateur', 'Ombres architecturales, grilles métalliques & signal rouge', '#0E1014', '#E2E8F0', '#EF4444', '#3B82F6'],
  ['bhSwissIntl', 'bauhaus', 'Grille Suisse Internationale', 'Blanc pur, noir Helvetica-style & filet vermillon chirurgical', '#FFFFFF', '#111111', '#FF2E00', '#111111', { paper: true }],
  ['bhGropiusSlate', 'bauhaus', 'Gropius Béton & Ambre', 'Béton architectural ardoise, ambre & bleu acier', '#22262B', '#F5F2EB', '#D97706', '#2563EB'],
  ['bhAlbersNest', 'bauhaus', 'Albers Carrés Imbriqués', 'Hommage au carré, teintes terre cuite & marine profonde', '#EBE5D8', '#141414', '#C84B31', '#2D4263', { paper: true }],
  ['bhBayerDiagonal', 'bauhaus', 'Bayer Diagonale 45°', 'Rythme diagonal à 45°, contrastes nets & typographie dynamique', '#161616', '#F4EFE6', '#FF331F', '#0057E7'],
  ['bhStijlPrimary', 'bauhaus', 'De Stijl Primaire', 'Grille orthogonale Mondrian, rouge/bleu/jaune pur sur ivoire', '#FAF9F5', '#101010', '#D40000', '#0046AA', { paper: true }],
  ['bhOchreBrass', 'bauhaus', 'Atelier Ocre & Laiton', 'Noir mat galerie, parchemin & laiton géométrique', '#1A1815', '#F4ECD8', '#D4A024', '#C83E2B'],
  ['bhConcreteHatch', 'bauhaus', 'Hachures & Bleu Acier', 'Rayures obliques d’atelier, bleu prusse & cramoisi', '#ECE8DD', '#1B263B', '#E63946', '#457B9D', { paper: true }],
  ['bhMonoRotunda', 'bauhaus', 'Rotonde Monochrome', 'Grille rationnelle noir/ivoire avec point focal écarlate', '#F2F0EC', '#0A0A0B', '#E02424', '#0A0A0B', { paper: true }],
  ['bhUlmModular', 'bauhaus', 'Système Modulaire Ulm', 'Proportioned grid, ambre & vert émeraude rationnel', '#12151C', '#EAE6DD', '#F59E0B', '#10B981'],
  ['bhTschichold', 'bauhaus', 'Typographie Nouvelle', 'Asymétrie éditoriale dynamique, filets rouges & marine', '#F6F2E9', '#141413', '#C92A2A', '#1864AB', { paper: true }],
  ['bhVignelliJet', 'bauhaus', 'Vignelli Transit Noir', 'Signalétique musée noir absolu, rubis & jaune vif', '#0B0B0D', '#FFFFFF', '#E11D48', '#FACC15'],
  ['bhConstructRed', 'bauhaus', 'Constructiviste Acier', 'Diagonales constructivistes, rouge puissant & cuivre', '#1D1A18', '#F3EDE2', '#D62828', '#F77F00'],
  ['bhArchivalGold', 'bauhaus', 'Archive Bauhaus Or', 'Édition limitée musée, noir charbon, or & bleu outremer', '#151412', '#F7F2E7', '#C9A227', '#2563EB'],

  /* ===================== POP ART (19 nouveaux + popArtBenDay = 20) ===================== */
  ['popRoyComic', 'popart', 'Lichtenstein Split Comic', 'Panneaux obliques à gouttières noires, trames Ben-Day & starburst', '#FFFDF5', '#111111', '#FF1E38', '#00A6ED', { paper: true }],
  ['popWarholSilk', 'popart', 'Warhol Sérigraphie', 'Sérigraphie fluorescente rose, jaune citron & cyan électrique', '#FF1493', '#FFFFFF', '#FFE600', '#00F5D4'],
  ['popCyanMagenta', 'popart', 'Presse CMYK Halftone', 'Séparation quadricoloriste cyan/magenta/jaune sur papier blanc', '#F8F9FA', '#111111', '#00B4D8', '#FF007F', { paper: true }],
  ['popSupernova', 'popart', 'Supernova Impact Burst', 'Étoiles d’impact jaunes, contour d’encre noire & flash rouge', '#FFE600', '#111111', '#E60023', '#0057FF'],
  ['popElectricLime', 'popart', 'Acide Ben-Day Splash', 'Fond violet nuit, points citron néon & éclats magenta', '#120826', '#D9FF00', '#FF2A85', '#00F0FF'],
  ['popStudioCandy', 'popart', 'Atelier Pop Pastel', 'Trame comic rose poudré, fuchsia & turquoise éclatant', '#FFD6E8', '#1B0B3B', '#FF1E6E', '#00B4D8'],
  ['popCobaltZap', 'popart', 'Cobalt Zap Panels', 'Panneaux bleus électriques, jaunes explosifs & bulles d’impact', '#0047AB', '#FFFFFF', '#FFE600', '#FF2A54'],
  ['popNoirInk', 'popart', 'Roman Graphique Noir', 'Encrage noir intense, gouttières blanches & vermillon', '#121214', '#FFFDF5', '#FF2E00', '#FFE100'],
  ['popSunsetPunch', 'popart', 'Zine Halftone Orange', 'Orange mandarine saturé, trame Ben-Day noire & jaune vif', '#FF5400', '#FFFFFF', '#FFE600', '#111111'],
  ['popBubblegum', 'popart', 'Bubblegum Comic Dots', 'Rose bubble-gum, points cyan & titrage rebondissant', '#FF4D8D', '#FFFFFF', '#00E5FF', '#FFE600'],
  ['popBananaVelvet', 'popart', 'Velvet Pop Jaune', 'Nuit velours, jaune banane iconique & rose néon', '#18121E', '#FFE600', '#FF3377', '#38BDF8'],
  ['popMintCherry', 'popart', 'Menthe & Cerise Pop', 'Menthe pop fraîche, rouge cerise & trames rétro', '#8AF3DF', '#160D28', '#FF1744', '#FFE100'],
  ['popNewsZine', 'popart', 'Fanzine Rétro Encre', 'Papier journal crème, encre rouge carmin & bleu cobalt', '#F2ECE1', '#141414', '#FF2E4C', '#1E6091', { paper: true }],
  ['popArcadePow', 'popart', 'Arcade Comic Pow', 'Indigo profond, éclairs jaunes & explosion cyan', '#140A2E', '#FFFFFF', '#FFE600', '#00F5D4'],
  ['popCoralJazz', 'popart', 'Corail Ben-Day Groove', 'Corail vibrant, jaune pastel & points turquoise', '#FF6B4A', '#141013', '#FFE66D', '#2EC4B6'],
  ['popLaserBerry', 'popart', 'Laser Berry Comic', 'Pourpre pop vibrant, or citron & fuchsia saturé', '#7B2CBF', '#FFFFFF', '#FFE600', '#FF006E'],
  ['popGoldenBoom', 'popart', 'Comic Or & Fuchsia', 'Noir galerie, éclats or métallisé & rose électrique', '#111115', '#FFD43B', '#FF2A6D', '#00F0FF'],
  ['popSkyAction', 'popart', 'Panneaux Action Azur', 'Bleu ciel comic pur, bulles d’action jaunes & magenta', '#00A8E8', '#FFFFFF', '#FFBE0B', '#FF006E'],
  ['popCrimsonInk', 'popart', 'Manga Encre Cramoisi', 'Blanc papier, cramoisi tranchant & trame cyan', '#FFF8F2', '#141414', '#DC143C', '#0096C7', { paper: true }],

  /* ===================== 3D ISOMETRIC WIREFRAME (19 nouveaux + stereo3D = 20) ===================== */
  ['isoDeepCobalt', 'iso3d', '3D Cobalt Filaire', 'Tunnels de cubes isométriques bleu profond & arêtes lumineuses', '#0B1F3F', '#F8FBFF', '#5CA4FF', '#38BDF8', { useGrad: true }],
  ['isoObsidianGlass', 'iso3d', 'Cubes Verre Obsidienne', 'Structure axonométrique noire, reflets glace cyan & indigo', '#070A12', '#F1F5F9', '#38BDF8', '#818CF8', { useGrad: true }],
  ['isoEmeraldDepth', 'iso3d', 'Matrice Émeraude 3D', 'Profondeur spatiale émeraude & treillis vectoriel cyan', '#041A18', '#ECFDF5', '#10B981', '#22D3EE'],
  ['isoAnaglyphRed', 'iso3d', 'Stéréo Anaglyphe 3D', 'Double passe stéréoscopique cyan/rouge & extrusion profonde', '#0C0D14', '#FFFFFF', '#00F0FF', '#FF2A55'],
  ['isoPlatinumCad', 'iso3d', 'CAD Platine Technique', 'Fines lignes d’ingénierie, maillage 3D & points nodaux brillants', '#111622', '#F8FAFC', '#93C5FD', '#F472B6'],
  ['isoRoyalAmethyst', 'iso3d', 'Polyèdres Améthyste', 'Volume isométrique violet royal & parallaxe cristalline', '#120926', '#FAF5FF', '#C084FC', '#38BDF8', { useGrad: true }],
  ['isoAmberPrism', 'iso3d', 'Prisme Ambre Spatial', 'Cubes filaires dorés dans l’obscurité & reflets cyan', '#120E08', '#FFFBEB', '#F59E0B', '#38BDF8'],
  ['isoChalkArch', 'iso3d', 'Blueprint Spatial Blanc', 'Fond bleu nuit technique & arêtes isométriques blanches pures', '#1C2B48', '#FFFFFF', '#93C5FD', '#FDE047'],
  ['isoTitanium', 'iso3d', 'Grille Titane 3D', 'Ardoise profonde, extrusions 4 couches & géométrie nette', '#0F172A', '#F8FAFC', '#60A5FA', '#E2E8F0'],
  ['isoHoloMatrix', 'iso3d', 'Hologramme Vectoriel 3D', 'Treillis holographique turquoise & violet quantique', '#050E17', '#E0F2FE', '#00F5D4', '#7C3AED'],
  ['isoBronzeLat', 'iso3d', 'Treillis Bronze Atelier', 'Fond brun sombre luxueux, fils d’or & contraste azur', '#1A1410', '#FBF7EE', '#D4AF37', '#60A5FA'],
  ['isoFrostIce', 'iso3d', 'Cristal Polaire 3D', 'Bleu polaire profond, facettes givrées & reflets rose', '#082032', '#F0F9FF', '#7DD3FC', '#F472B6'],
  ['isoRubinCut', 'iso3d', 'Rubis Polyédrique', 'Rouge rubis sombre, arêtes rosées & profondeur stéréo cyan', '#1E0A16', '#FFF1F2', '#FB7185', '#38BDF8'],
  ['isoMidnightAxis', 'iso3d', 'Tunnel Axe Minuit', 'Perspective infinie, lignes de fuite bleues & sarcelle', '#050811', '#E2E8F0', '#3B82F6', '#14B8A6'],
  ['isoPaperRelief', 'iso3d', 'Bas-Relief Papier 3D', 'Blanc architectural mat, ombres isométriques bleu/rouge', '#EDEFF2', '#0F172A', '#1D4ED8', '#EF4444', { paper: true }],
  ['isoJadeTower', 'iso3d', 'Tours Isométriques Jade', 'Empilements 3D émeraude, reflets menthe & lavande', '#061812', '#F0FDF4', '#34D399', '#A78BFA'],
  ['isoNeonWire', 'iso3d', 'Filaire Laser Stéréo', 'Cubes néon cyan/magenta à grande vitesse angulaire', '#080614', '#FFFFFF', '#00F0FF', '#FF3CAC'],
  ['isoIndigoParallax', 'iso3d', 'Parallaxe Indigo 3D', 'Multiples plans isométriques décalés & lueur turquoise', '#131738', '#F8FAFC', '#818CF8', '#2DD4BF'],
  ['isoSolarGold', 'iso3d', 'Or Solaire Axonométrique', 'Noir abyssal, maillage or brillant & rayonnement azur', '#0A0D16', '#FEF9C3', '#FACC15', '#38BDF8'],

  /* ===================== COMPOSITING MODES (20 styles dédiés) ===================== */
  ['compCentreSilk', 'compositing', 'Centre Libre · Soie', 'Cadrage latéral pour laisser le chanteur libre au centre · halo or', '#0D1117', '#F8FAFC', '#D4AF37', '#38BDF8'],
  ['compCentreObsidian', 'compositing', 'Halo Scène Chanteur', 'Paroles déportées gauche/droite autour de la silhouette centrale', '#080A0F', '#FFFFFF', '#22D3EE', '#F472B6'],
  ['compChromaPure', 'compositing', 'Chroma Vert Studio', 'Contraste maximal & bords nets calibrés pour incrustation Chroma Key', '#041A08', '#FFFFFF', '#00FF55', '#A7F3D0'],
  ['compSideBySide', 'compositing', 'Split Studio Côte-à-Côte', 'Composition double zone artiste / keyer avec guides d’alignement', '#0E1219', '#F8FAFC', '#10B981', '#F59E0B'],
  ['compBroadcastHUD', 'compositing', 'Cadre Broadcast Antenne', 'Cartouches latérales nettes & repères d’antenne 16:9 professionnels', '#0B101B', '#F1F5F9', '#38BDF8', '#F43F5E'],
  ['compChampagneEdge', 'compositing', 'Marges Champagne Luxe', 'Typographie éditoriale sur les bords, halo doré sur le sujet central', '#12100E', '#FAF6EE', '#D8B467', '#FFFFFF'],
  ['compStudioAlpha', 'compositing', 'Incrustation Alpha Pro', 'Bords ultra-propres sans grain pour export PNG transparent & Premiere', '#111318', '#FFFFFF', '#60A5FA', '#E2E8F0'],
  ['compDuetSplit', 'compositing', 'Split Duo Chanteurs', 'Alternance gauche/droite précise pour duos & clips face caméra', '#0D141F', '#FFFFFF', '#FF6B9D', '#38BDF8'],
  ['compSpotlightCentre', 'compositing', 'Projecteur Central', 'Vignette d’éclairage centrale encadrant le performeur', '#07090E', '#F8FAFC', '#FBBF24', '#38BDF8'],
  ['compLowerEdgePro', 'compositing', 'Tiers-Inférieur Cinéma', 'Sous-titrage cinématographique épuré laissant tout le buste libre', '#0A0E14', '#FFFFFF', '#00F5D4', '#818CF8'],
  ['compPearlMatte', 'compositing', 'Matte Perle Clair', 'Fond clair neutre & cartouches haute lisibilité pour plans lumineux', '#E8ECEF', '#0F172A', '#0B57D0', '#059669'],
  ['compCobaltKey', 'compositing', 'Incrustation Fond Bleu', 'Optimisé pour incrustation Blue-Screen & étalonnage froid', '#061638', '#FFFFFF', '#00E5FF', '#FACC15'],
  ['compLiveConcert', 'compositing', 'Live Concert Bords', 'Marges énergiques gauche/droite pour concerts filmés en live', '#09090D', '#FFFFFF', '#F43F5E', '#38BDF8'],
  ['compPortraitMargin', 'compositing', 'Marges Reels / Shorts 9:16', 'Zones sûres haut/bas & côtés adaptées au format vertical 9:16', '#0D111A', '#FAF8F5', '#D4AF37', '#2DD4BF'],
  ['compEditorialFrame', 'compositing', 'Verre Dépoli Éditorial', 'Plaques translucides élégantes lisibles sur n’importe quelle vidéo', '#141519', '#F3F0EA', '#C8A96A', '#94A3B8'],
  ['compKeyPlateNeon', 'compositing', 'Contours Néon Incrustés', 'Liserés lumineux haute séparation pour montage CapCut / DaVinci', '#06080E', '#FFFFFF', '#00F0FF', '#FF2E93'],
  ['compCineOverlay', 'compositing', 'Superposition 2.39:1', 'Repères Scope anamorphiques & titrage périmétrique discret', '#08080A', '#F5F2EB', '#E5A93C', '#38BDF8'],
  ['compVogueMargins', 'compositing', 'Défilé Vogue Bords', 'Serif couture sur les côtés sans jamais couvrir le mannequin', '#100E12', '#FFFDF9', '#E2C08D', '#E11D48'],
  ['compCleanChromaPro', 'compositing', 'Keying Pur Haute Définition', 'Blanc pur sur contraste absolu zéro bavure pour masque luma/chroma', '#050D07', '#FFFFFF', '#22C55E', '#FFFFFF'],
  ['compStageMonitor', 'compositing', 'Retour Scène Studio', 'Cadre moniteur professionnel avec timecode et zone libre centrale', '#0A0F1A', '#F8FAFC', '#38BDF8', '#A855F7'],

  /* ===================== CINEMATIC (14 nouveaux + 6 existants = 20) ===================== */
  ['cinAnamorphic', 'cinematic', 'Anamorphique 2049', 'Flares horizontaux cyan, ambre brûlé & profondeur Blade Runner', '#050B14', '#F3EFE6', '#FF772B', '#26E6F2', { useGrad: true }],
  ['cinSilverHalide', 'cinematic', '35mm Argentique', 'Grain fin Kodak, contrastes soyeux & typographie générique d’art', '#0C0C0E', '#F2F0EC', '#D4AF37', '#7EA8BE'],
  ['cinAmberNocturne', 'cinematic', 'Nocturne Pluie d’Ambre', 'Vitres ruisselantes nocturnes, lueurs sodium & mise au point lente', '#090706', '#FFF1DB', '#F59E0B', '#38BDF8'],
  ['cinImaxTitle', 'cinematic', 'Bande-Annonce IMAX Or', 'Grand écran noir obsidienne, or impérial & travellings lents', '#060709', '#FAF7EE', '#E0B857', '#FFFFFF', { useGrad: true }],
  ['cinNordicMist', 'cinematic', 'Brume Nordique Ardoise', 'Bleu ardoise mélancolique, sérifs fins & lumière diffuse', '#0F171E', '#ECF2F5', '#8DB4C7', '#D97757'],
  ['cinVelvetNoir', 'cinematic', 'Thriller Velours Rouge', 'Ombre carmin dramatique, titre découpé & tension cinématographique', '#11060A', '#F9EEF2', '#DC2626', '#D4AF37'],
  ['cinTealOrange', 'cinematic', 'Blockbuster Teal & Orange', 'Étalonnage cinéma contrasté sarcelle glaciale & cuivre', '#06171E', '#FFF5EB', '#FF6B2C', '#1BD8E6', { useGrad: true }],
  ['cinCriterionInk', 'cinematic', 'Collection Cinéma d’Auteur', 'Papier ivoire de festival, serif classique & accent rubis', '#F4F0E8', '#121212', '#B91C1C', '#4B5563', { paper: true }],
  ['cinEclipseChrome', 'cinematic', 'Éclipse Titane', 'Monolithe lunaire, halos solaires & précision optique', '#080A0D', '#F8FAFC', '#E2E8F0', '#F59E0B'],
  ['cinDuneOchre', 'cinematic', 'Dune Ocre Solaire', 'Brume de sable doré, lettrage monumental & grand angle', '#1A1109', '#FAF0DC', '#E09132', '#7FB3D5'],
  ['cinRainySeoul', 'cinematic', 'Néon Pluie Séoul', 'Reflets d’asphalte mouillé, rose néon & cyan cinématographique', '#070B16', '#F1F5F9', '#EC4899', '#22D3EE'],
  ['cinGrandPrix', 'cinematic', '70mm Saphir Nocturne', 'Pellicule grand format bleu nuit, feux or & vitesse fluide', '#071024', '#FFFFFF', '#FACC15', '#38BDF8'],
  ['cinSaffronLens', 'cinematic', 'Flare Safran Optique', 'Halos optiques chaleureux, ombres profondes & générique fluide', '#120B07', '#FFFBEB', '#FB923C', '#FDE047'],
  ['cinMonolith', 'cinematic', 'Monolithe Ombre Pure', 'Noir absolu, blancs lunaires & découpes lumineuses', '#050505', '#EAEAEA', '#FFFFFF', '#9CA3AF'],

  /* ===================== MUSIC VIDEO (14 nouveaux + 6 existants = 20) ===================== */
  ['mvTrapGold', 'musicvideo', 'Trap Platine & Or', 'Basses lourdes, flash platine/or & découpes punchy ultra-fluides', '#09080A', '#FFFFFF', '#FACC15', '#EF4444'],
  ['mvKpopNeon', 'musicvideo', 'K-Pop Laser Stage', 'Éclairages scéniques haute énergie, rose laser & cyan prisme', '#120624', '#FFFFFF', '#FF2E9F', '#00F0FF', { useGrad: true }],
  ['mvRnbVelvet', 'musicvideo', 'R&B Soie Nocturne', 'Atmosphère velours pourpre, néons doux & rythme sensuel', '#160918', '#FFF4FA', '#E879F9', '#F59E0B', { useGrad: true }],
  ['mvHipHopRaw', 'musicvideo', 'Hip-Hop Impact Brut', 'Titrage massif street, rouge urgence & zooms rythmés', '#111111', '#F9F5EA', '#FF3B1F', '#FACC15'],
  ['mvClubStrobe', 'musicvideo', 'Club Strobe Électro', 'Stroboscope millimétré, cyan acide & ondes égaliseur', '#050711', '#FFFFFF', '#00F5D4', '#FF006E'],
  ['mvChromeDrip', 'musicvideo', 'Chrome Liquide Pop', 'Reflets métalliques argent/lavande & transitions miroirs', '#0D1017', '#FFFFFF', '#A5B4FC', '#38BDF8', { useGrad: true }],
  ['mvHyperPop', 'musicvideo', 'Hyperpop Électrique', 'Couleurs saturées lime/rose & morphings rapides à 60fps', '#1B0638', '#FFFFFF', '#A3FF12', '#FF2BD6'],
  ['mvVinylGroove', 'musicvideo', 'Vinyle Soul Chaleureux', 'Ambre analogique, disques tournants & groove vintage', '#1E120C', '#FFF4E0', '#FF7A2F', '#FACC15'],
  ['mvDancefloor', 'musicvideo', 'Boule à Facettes Disco', 'Éclats dorés & roses, reflets miroir & cadence dansante', '#0D0A1E', '#FFFFFF', '#FDE047', '#F472B6'],
  ['mvDrillDark', 'musicvideo', 'Drill Sombre Urbain', 'Acier froid, alertes rouges & impacts caméra secs', '#07080A', '#F1F5F9', '#EF4444', '#38BDF8'],
  ['mvFestivalSky', 'musicvideo', 'Mainstage Festival', 'Grand angle scène ouverte, lasers bleus & feux d’artifice', '#07152E', '#FFFFFF', '#38BDF8', '#F43F5E', { useGrad: true }],
  ['mvLatinHeat', 'musicvideo', 'Caliente Or Tropical', 'Orange solaire, turquoise vibrant & ondulations rythmiques', '#1D0B09', '#FFF7ED', '#FF5400', '#2EC4B6'],
  ['mvIndieStage', 'musicvideo', 'Scène Indie Analog', 'Vert forêt sombre, projecteur ambre & grain de concert', '#141A18', '#F7F5EE', '#F59E0B', '#EC4899'],
  ['mvDiamondTour', 'musicvideo', 'Tournée Diamant Arena', 'Noir arena profond, reflets diamant blancs & éclairs bleus', '#080C18', '#FFFFFF', '#E2E8F0', '#38BDF8'],

  /* ===================== ART & MOTION (10 nouveaux + 10 existants = 20) ===================== */
  ['amSwissKinetic', 'artmotion', 'Affiche Suisse Cinétique', 'Typographie suisse inclinée, contrastes rouge rubis & cobalt', '#F5F2EA', '#101012', '#E11D48', '#1D4ED8', { paper: true }],
  ['amBrutalistType', 'artmotion', 'Brutalisme Typo Brut', 'Blocs massifs acides lime sur noir brut & trames vives', '#121212', '#F4F4F0', '#CCFF00', '#FF2A00'],
  ['amOpArtWave', 'artmotion', 'Op-Art Moiré Optique', 'Ondes d’interférences visuelles, noir profond & éclats bleus', '#F8FAFC', '#09090B', '#2563EB', '#EF4444'],
  ['amMemphisGroove', 'artmotion', 'Memphis Géométrique', 'Confettis géométriques, jaune crème, rose vif & cyan pop', '#FFF7D6', '#18122B', '#FF2E8B', '#00B4D8'],
  ['amRisographInk', 'artmotion', 'Risographie Fluorescente', 'Superposition d’encres rose fluo, vert menthe & bleu marine', '#F4EDE2', '#1D2D50', '#FF48B0', '#00A95C', { paper: true }],
  ['amGalleryPoster', 'artmotion', 'Catalogue Musée MoMA', 'Cartons d’exposition, rouge galériste & sérifs modernes', '#ECE9E2', '#141414', '#FF3B1F', '#1E3A8A', { paper: true }],
  ['amNeonKinetic', 'artmotion', 'Sculpture Néon Cinétique', 'Tubes lumineux tordus dans l’espace & perspective fluide', '#08080D', '#FFFFFF', '#00F5D4', '#FF2E88'],
  ['amCollageCut', 'artmotion', 'Collage Avant-Garde', 'Découpes papier contrastées, rouge sang & bleu prusse', '#EAE3D5', '#111111', '#D62828', '#003049', { paper: true }],
  ['amFoldOrigami', 'artmotion', 'Pliage Origami 3D', 'Plans pliés en mouvement perpétuel, bleu roi & ambre', '#F6F3EC', '#1A1A1F', '#2563EB', '#F59E0B', { paper: true }],
  ['amKineticBrass', 'artmotion', 'Sculpture Laiton Galerie', 'Noir velours d’exposition, or sculptural & rubis', '#141311', '#F7F2E8', '#D4AF37', '#EF4444'],

  /* ===================== FUTURISTIC (14 nouveaux + 6 existants = 20) ===================== */
  ['futNeuroHolo', 'futuristic', 'Hologramme Neural AI', 'Interfaces holographiques cyan/améthyste & balayage neuronal', '#040A14', '#E0F7FF', '#00F0FF', '#A855F7', { useGrad: true }],
  ['futOrbitalHud', 'futuristic', 'Télémétrie Orbitale HUD', 'Viseurs orbitaux haute précision, azur spatial & alertes ambre', '#060D18', '#F0F9FF', '#38BDF8', '#F59E0B'],
  ['futQuantumGrid', 'futuristic', 'Réseau Quantique Violet', 'Grille de profondeur violette, particules cyan & téléportation', '#070514', '#F5F3FF', '#C084FC', '#22D3EE', { useGrad: true }],
  ['futTokyoCyber', 'futuristic', 'Néo-Tokyo Cyberpunk', 'Pluie de données rose fluo, matrices néon & glitch urbain', '#090412', '#FFFFFF', '#FF007F', '#00F5D4'],
  ['futBiometric', 'futuristic', 'Scanner Biométrique', 'Vert émeraude médical du futur, grilles radar & décodage', '#03120E', '#E6FFF5', '#10B981', '#38BDF8'],
  ['futSolarisAi', 'futuristic', 'Noyau Solaris IA Or', 'Intelligence artificielle dorée sur noir abyssal & azur', '#090B10', '#FEF9E7', '#FACC15', '#38BDF8'],
  ['futDeepSpace', 'futuristic', 'Cockpit Espace Profond', 'Interface vaisseau spatial noir sidéral, bleu glacé & rouge', '#03060C', '#F8FAFC', '#60A5FA', '#F43F5E'],
  ['futIonMatrix', 'futuristic', 'Terminal Matrice Ion', 'Flux binaire émeraude, caractères décryptés & CRT propre', '#041008', '#D9FFE6', '#22C55E', '#06B6D4'],
  ['futHyperlink', 'futuristic', 'Flux Hyperlien Data', 'Lignes de données à haute vélocité bleu électrique & magenta', '#080B18', '#FFFFFF', '#3B82F6', '#EC4899', { useGrad: true }],
  ['futZeroGravity', 'futuristic', 'Interface Perle Zéro-G', 'Design spatial clair façon labo futuriste blanc, bleu & cyan', '#E8EEF5', '#0F172A', '#2563EB', '#06B6D4'],
  ['futPlasmaArc', 'futuristic', 'Cœur Arc Plasma', 'Décharges rose électrique & violet sur noir de confinement', '#0D0514', '#FFF5FA', '#F43F5E', '#8B5CF6'],
  ['futMechaSpec', 'futuristic', 'Avionique Mecha Spec', 'Indicateurs techniques orange fluo & gris acier militaire', '#0C1014', '#F1F5F9', '#F97316', '#38BDF8'],
  ['futSynthWaveAI', 'futuristic', 'Vecteur Synthwave AI', 'Grille perspective horizon néon rose/cyan & chrome laser', '#14072B', '#FFF8DC', '#FF2A9D', '#00E5FF', { useGrad: true }],
  ['futChronoGlass', 'futuristic', 'Optique Chrono Verre', 'Verre futuriste turquoise & indigo avec compteurs fluides', '#070F1C', '#F0FDFA', '#2DD4BF', '#818CF8'],

  /* ===================== LIFESTYLE (14 nouveaux + 6 existants = 20) ===================== */
  ['luxMaisonIvory', 'lifestyle', 'Maison Ivoire Couture', 'Papier d’édition ivoire, lettrage serif or vieilli & respirations lentes', '#F8F5EE', '#181614', '#B8862B', '#3E5641', { paper: true }],
  ['luxNoirCashmere', 'lifestyle', 'Cachemire Noir Or', 'Noir velouté haute couture, or champagne & mouvements soyeux', '#11100F', '#F6F1E6', '#D4AF37', '#A89F91', { useGrad: true }],
  ['luxRiviera', 'lifestyle', 'Riviera Côte d’Azur', 'Sable clair méditerranéen, bleu marin & cuivre ensoleillé', '#F4EFE6', '#14283C', '#C47D3B', '#1E6091', { paper: true }],
  ['luxKyotoTea', 'lifestyle', 'Salon Matcha & Cèdre', 'Harmonie zen pierre claire, vert matcha & bois de cèdre', '#EEE9DC', '#1E261C', '#5A7D4C', '#9E5A36', { paper: true }],
  ['luxParisRunway', 'lifestyle', 'Défilé Paris Serif', 'Noir galerie, blanc perle, or fin & élégance éditoriale', '#0F0E10', '#FAF8F5', '#E2C08D', '#C9184A'],
  ['luxMilanTravel', 'lifestyle', 'Carnet de Voyage Milan', 'Parchemin chaud, terre cuite & verts profonds de documentaire', '#ECE4D5', '#2B2118', '#B85A32', '#3D5A58', { paper: true }],
  ['luxMarbleGallery', 'lifestyle', 'Galerie Marbre Carrare', 'Marbre veiné clair, noir encre & touches dorées subtiles', '#F2F0EC', '#171717', '#9E7B46', '#52525B', { paper: true }],
  ['luxEspressoDoc', 'lifestyle', 'Documentaire Espresso', 'Brun torréfié profond, crème chaude & ambre doux', '#1C1511', '#F5EDE2', '#D99B52', '#8D99AE'],
  ['luxChampagneSilk', 'lifestyle', 'Soie Champagne Dorée', 'Noir bronze, reflets dorés lumineux & fondus fluides', '#16120D', '#FDF8EC', '#E5C158', '#F3E7C4', { useGrad: true }],
  ['luxNordicLinen', 'lifestyle', 'Journal Lin Nordique', 'Lin naturel clair, gris minéral & ocre doux minimaliste', '#F5F3EE', '#23272A', '#64748B', '#B08968', { paper: true }],
  ['luxTerracotta', 'lifestyle', 'Terracotta Solaire', 'Argile rosée, brun espresso & sarcelle méditerranéenne', '#EFE6DB', '#2A1A14', '#C85A32', '#2A6F6B', { paper: true }],
  ['luxSatinMidnight', 'lifestyle', 'Satin Bleu Minuit', 'Bleu yacht nocturne, ivoire nacré & accastillage or', '#09111E', '#F7F2E7', '#D4AF37', '#60A5FA'],
  ['luxBotanicalVogue', 'lifestyle', 'Vogue Botanique', 'Vert forêt profonde, crème botanique & sauge dorée', '#132219', '#F4F1EA', '#B8C97A', '#D4A373'],
  ['luxMonochromeMag', 'lifestyle', 'Magazine Harper Noir', 'Contraste pur noir et blanc de presse mode intemporelle', '#FFFFFF', '#0A0A0A', '#111111', '#9E7B46', { paper: true }],

  /* ===================== ANIMATION (14 nouveaux + 6 existants = 20) ===================== */
  ['aniCelStudio', 'animation', 'Studio Cel Lumineux', 'Bleu ciel d’animation japonaise, traits nets & rose dynamique', '#F0F7FF', '#1E293B', '#FF4B8B', '#2563EB'],
  ['aniMagicalGirl', 'animation', 'Magie Étoilée Pastel', 'Nuit magique améthyste, étincelles roses & rubans cyan', '#21124A', '#FFF7FE', '#FF74B8', '#7DF9FF', { useGrad: true }],
  ['aniCartoonBounce', 'animation', 'Cartoon Encre & Couleur', 'Jaune cartoon éclatant, rebonds élastiques & rouge vif', '#FFE94E', '#16141F', '#FF3366', '#00A8E8'],
  ['aniFantasyForest', 'animation', 'Forêt Enchantée', 'Lueurs de lucioles émeraude, or féerique & ondulations douces', '#0E1F1D', '#F4FFF8', '#7DFF9E', '#FACC15'],
  ['aniSurrealDream', 'animation', 'Rêve Surréaliste Pastel', 'Nuages lavande flottants, perspectives oniriques & corail', '#E6D9FF', '#2D1B4E', '#FF5C8D', '#00B4D8'],
  ['aniMechaAnime', 'animation', 'Super Robot Anime', 'Ciel spatial bleu nuit, lignes de vitesse rouges & jaune or', '#0C1326', '#FFFFFF', '#FF3838', '#FACC15'],
  ['aniGhibliMeadow', 'animation', 'Prairie Aquarelle', 'Vert tendre aquarelle, brise printanière & terre sienne', '#ECF5E4', '#263A29', '#D96B43', '#4B8FB8', { paper: true }],
  ['aniShonenFlame', 'animation', 'Shonen Impact Flamme', 'Énergie incandescente orange/or sur ombre rouge combat', '#1A0B0A', '#FFFFFF', '#FF5E1A', '#FFD60A'],
  ['aniDreamyLofi', 'animation', 'Lune Onirique Lo-Fi', 'Bleu nuit paisible, étoiles lavande & halos rose tendre', '#131633', '#F8F4FF', '#A78BFA', '#F472B6', { useGrad: true }],
  ['aniToonStudio', 'animation', 'Cartoon Vintage 1930', 'Sépia crème animé, encre noire souple & vermillon classique', '#EFE7D6', '#181615', '#C83E2B', '#2F4858', { paper: true }],
  ['aniCrystalFairy', 'animation', 'Féerie Cristal Aquatique', 'Abysses féeriques turquoise, bulles nacrées & reflets roses', '#0A1E2B', '#F2FFFF', '#5EEAD4', '#F9A8D4', { useGrad: true }],
  ['aniComicKawaii', 'animation', 'Kawaii Stickers Pop', 'Rose tendre sucré, gommettes rebondissantes & ciel bleu', '#FFF0F6', '#3D1A4D', '#FF4D94', '#38BDF8'],
  ['aniSunsetSakura', 'animation', 'Crépuscule Pétales Anime', 'Violet crépuscule, fleurs de cerisier & lueur dorée', '#2B1438', '#FFF5F9', '#FF7EB6', '#FFAE52', { useGrad: true }],
  ['aniSurrealMirror', 'animation', 'Miroir Surréaliste', 'Prune profonde, reflets symétriques cyan & étoiles jaunes', '#170D28', '#FFFFFF', '#38BDF8', '#FFE066'],
];

J.STYLE_CATS = Object.assign({
  bauhaus: [],
  popart: [],
  iso3d: [],
  compositing: [],
  cinematic: [],
  musicvideo: [],
  artmotion: [],
  futuristic: [],
  lifestyle: [],
  animation: [],
  guofeng: [],
}, J.STYLE_CATS || {});

/* Enregistrer les styles existants dans leurs catégories */
for (const k of J.STYLE_ORDER) {
  const c = J.STYLES[k] && J.STYLES[k].cat;
  if (c && J.STYLE_CATS[c] && !J.STYLE_CATS[c].includes(k)) J.STYLE_CATS[c].push(k);
}

/* Enregistrer les 157 nouveaux styles de luxe */
for (const entry of CATALOG) {
  const [id, cat, name, desc, bg, fg, accent, accent2, opts = {}] = entry;
  if (J.STYLES[id]) continue;
  const prof = PROFILES[cat] || PROFILES.cinematic;
  const schemes = makeSchemes(bg, fg, accent, accent2, !!opts.paper, !!opts.useGrad);
  J.STYLES[id] = {
    name,
    desc,
    cat,
    moods: prof.moods.slice(),
    schemes,
    fonts: Object.assign({}, prof.fonts),
    texture: Object.assign({}, prof.texture),
    ghost: prof.ghost,
    glow: prof.glow,
    useGrad: !!opts.useGrad,
    hud: cat === 'futuristic' || cat === 'compositing',
    bias: prof.bias,
    decor: prof.decor,
  };
  if (!J.STYLE_ORDER.includes(id)) J.STYLE_ORDER.push(id);
  if (J.STYLE_CATS[cat] && !J.STYLE_CATS[cat].includes(id)) J.STYLE_CATS[cat].push(id);
}
})();
