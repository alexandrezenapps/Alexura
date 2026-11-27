import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = process.cwd();
const readText = (relPath) => fs.readFileSync(path.join(ROOT, relPath), 'utf8');

function loadAudioModule() {
  const ctx = {
    J: {
      clamp: (v, lo, hi) => Math.max(lo, Math.min(hi, v)),
    },
    window: {},
    Math,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Promise,
    Set,
    Map,
    Float32Array,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    setTimeout,
    clearTimeout,
    console,
  };
  const code = readText('src/10_audio.js');
  vm.runInNewContext(code, ctx, { filename: 'src/10_audio.js' });
  return ctx.J;
}

test('Master Skills registry remains intact with all 20 skills active', () => {
  const raw = readText('skills/index.json');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.skills), 'skills array must exist');
  assert.equal(parsed.skills.length, 20);
});

test('Server sync & transcription pipelines enforce payload validation, timeouts, anchors, and official Gemini models', () => {
  const srv = readText('server.ts');
  assert.match(srv, /const MAX_AUDIO_BASE64_CHARS\s*=\s*28_000_000/);
  assert.match(srv, /const MAX_ALIGN_LINES\s*=\s*500/);
  assert.match(srv, /function normalizeBase64Audio\(/);
  assert.match(srv, /function withApiTimeout</);
  assert.match(srv, /gemini-3\.5-transcribe/);
  assert.match(srv, /gemini-4-hydrogen/);
  assert.doesNotMatch(srv, /gemini-1\.5|gemini-2\.0|gemini-2\.5/);
  assert.match(srv, /lockedStart/);
});

test('Built HTML localized editions include coordinated 3-button markup and clean French copy', () => {
  const indexHtml = readText('index.html');
  const frHtml = readText('fr/index.html');
  const enHtml = readText('en/index.html');

  for (const html of [indexHtml, frHtml]) {
    assert.match(html, /id="btnAiTranscribe"[^>]*aria-busy="false"/);
    assert.match(html, /id="btnAiTranscribeLbl"[^>]*>Détecter les paroles par IA</);
    assert.match(html, /id="btnVocalSync"[^>]*aria-busy="false"/);
    assert.match(html, /id="btnVocalSyncLbl"[^>]*>Synchro Voix &amp; Paroles</);
    assert.match(html, /id="btnTap"[^>]*aria-pressed="false"/);
    assert.match(html, /id="btnTapLbl"[^>]*>Synchro au Tap</);
    assert.doesNotMatch(html, /SYNCRO VOIX ET PAROLE/);
  }

  assert.match(enHtml, /id="btnAiTranscribeLbl"[^>]*>AI Transcribe Lyrics</);
  assert.match(enHtml, /id="btnVocalSyncLbl"[^>]*>Voice Sync</);
  assert.match(enHtml, /id="btnTapLbl"[^>]*>Tap to sync</);
});

test('UI orchestration shares S.syncTask lock, preserves SVG label nodes, and coordinates tap readiness', () => {
  const ui = readText('src/12_ui.js');
  assert.match(ui, /function syncAiActionButtonsState\(\)/);
  assert.match(ui, /S\.syncTask\s*=\s*\{\s*kind:\s*'ai_transcribe'/);
  assert.match(ui, /S\.syncTask\s*=\s*\{\s*kind:\s*'vocal_sync'/);
  assert.match(ui, /\$?\('btnAiTranscribeLbl'\)/);
  assert.match(ui, /\$?\('btnVocalSyncLbl'\)/);
  assert.match(ui, /\$?\('btnTapLbl'\)/);
  assert.match(ui, /existingWordTimes:\s*S\.project\.timing\s*&&\s*S\.project\.timing\.wordTimes/);
});

test('Audio DSP alignment handles duplicate lines, snaps vocal onsets at 100Hz, and coordinates word timings', () => {
  const J = loadAudioModule();

  // Build synthetic 10-second 100Hz vocal envelope with 2 clear vocal attacks at 1.20s and 4.60s
  const envRate = 100;
  const totalFrames = 1000;
  const vocalEnv100 = new Float32Array(totalFrames);
  const wordAttack100 = new Float32Array(totalFrames);

  for (let i = 120; i < 360; i += 1) vocalEnv100[i] = 0.72;
  for (let i = 460; i < 820; i += 1) vocalEnv100[i] = 0.78;
  wordAttack100[120] = 0.92;
  wordAttack100[210] = 0.80;
  wordAttack100[460] = 0.95;
  wordAttack100[600] = 0.85;

  const energyRate = 25;
  const vocalOnset = new Float32Array(10 * energyRate);
  vocalOnset[Math.round(1.2 * energyRate)] = 0.92;
  vocalOnset[Math.round(4.6 * energyRate)] = 0.95;

  const syntheticAudio = {
    duration: 10.0,
    energyRate,
    vocalOnset,
    envRate,
    vocalEnv: vocalEnv100,
    vocalEnv100,
    wordAttack100,
    flux: new Float32Array(totalFrames),
    beats: [0.5, 1.0, 1.5, 2.0, 4.5, 5.0],
    vocalSegments: [
      { start: 1.2, end: 3.6, energy: 0.72 },
      { start: 4.6, end: 8.2, energy: 0.78 },
    ],
  };

  // Identical repeated chorus lines used to break lines.indexOf(l) — verify monotonic alignment
  const duplicateLines = [
    { text: 'Je chante dans la nuit', interlude: false },
    { text: 'Je chante dans la nuit', interlude: false },
  ];
  const lineTimes = J.alignLinesToVocals(syntheticAudio, duplicateLines);
  assert.ok(Math.abs(lineTimes[0] - 1.2) <= 0.15, `line 0 aligned near 1.2s, got ${lineTimes[0]}`);
  assert.ok(lineTimes[1] > lineTimes[0] + 1.0, `duplicate line 1 must strictly follow line 0, got ${lineTimes[1]}`);
  assert.ok(Math.abs(lineTimes[1] - 4.6) <= 0.25, `line 1 aligned near 4.6s, got ${lineTimes[1]}`);

  // Verify word acoustic coordination keeps monotonicity within segment
  const words = J.optimizeLineVocalCoordination(
    syntheticAudio,
    [
      { text: 'Je', start: 1.15, end: 1.55, confidence: 0.8 },
      { text: 'chante', start: 1.65, end: 2.35, confidence: 0.8 },
    ],
    1.2,
    3.5,
    'fr',
    'Lead',
  );
  assert.equal(words.length, 2);
  assert.ok(words[0].start >= 1.0 && words[0].end <= words[1].start);
  assert.ok(words[1].end <= 3.5);
});

test('About button (#btnTerms) and modal (#termsDlg) render clean informative UI and localization', () => {
  const indexHtml = readText('index.html');
  const frHtml = readText('fr/index.html');
  const enHtml = readText('en/index.html');
  const ui = readText('src/12_ui.js');

  for (const html of [indexHtml, frHtml]) {
    assert.match(html, /id="btnTerms"[^>]*aria-haspopup="dialog"[^>]*aria-controls="termsDlg"/);
    assert.match(html, /id="btnTermsLbl"[^>]*>À propos</);
    assert.doesNotMatch(html, /À propos \/ Droits/);
    assert.match(html, /id="termsTitle"[^>]*>À propos d’Alexura Motion Studio</);
    assert.match(html, /id="termsMetaLine"[^>]*>Version \d+\.\d+\.\d+ · Studio vidéo &amp; synchronisation vocale · Licence MIT</);
    assert.match(html, /id="termsRightsTitle"[^>]*>Droits de création &amp; export</);
    assert.match(html, /id="termsPrivacyTitle"[^>]*>Confidentialité &amp; traitement</);
    assert.match(html, /id="termsTechTitle"[^>]*>Synchronisation &amp; moteur artistique</);
    assert.match(html, /id="termsCompatTitle"[^>]*>Formats &amp; flux professionnels</);
    assert.match(html, /id="btnTermsNotice"[^>]*>Consulter la Notice</);
    assert.doesNotMatch(html, /© 2026 hakoniwa/);
  }

  assert.match(enHtml, /id="btnTermsLbl"[^>]*>About</);
  assert.doesNotMatch(enHtml, /About \/ rights/);

  assert.match(ui, /function applyTermsCopy\(\)|const applyTermsCopy = \(\) =>/);
  assert.match(ui, /const openTerms = \(\) => \{\s*\n\s*applyTermsCopy\(\);\s*\n\s*if \(dlg\.showModal\)/);
  assert.match(ui, /\$?\('btnTermsNotice'\)\.addEventListener\('click'[\s\S]*?openNotice\(\)/);
});

