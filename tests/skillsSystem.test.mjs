import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import {
  loadSkillsRegistry,
  selectRelevantSkills,
  loadSkillInstructions,
  buildAgentWorkingContext,
  setSkillEnabled,
  readRawSkillPreview,
} from '../server/services/skillsManager.ts';
import { createSkillsRouter } from '../server/routes/skillsRoutes.ts';

test('Registry /skills/index.json contains all 20 unique skills across 5 categories with intact SKILL.md files', () => {
  const registry = loadSkillsRegistry();

  assert.equal(registry.skills.length, 20);
  assert.equal(registry.categories.length, 5);

  const expectedCategories = [
    'Cadrage produit',
    'Design',
    'Développement',
    'IA & Médias',
    'Qualité & Livraison',
  ];
  assert.deepEqual(
    registry.categories.map((c) => c.label),
    expectedCategories,
  );

  const uniqueIds = new Set(registry.skills.map((s) => s.id));
  assert.equal(uniqueIds.size, 20);

  for (const skill of registry.skills) {
    assert.equal(skill.type, 'instruction');
    const preview = readRawSkillPreview(skill.id);
    assert.ok(preview, `Missing preview for ${skill.id}`);
    assert.equal(preview.fileExists, true, `Missing source file ${skill.sourceFile}`);
    assert.ok(preview.bytesRead > 200, `Unexpected tiny SKILL.md for ${skill.id}`);
    assert.equal(preview.frontmatter?.name, skill.name);
    assert.equal(preview.frontmatter?.description, skill.description);
  }
});

test('selectRelevantSkills chooses a focused subset matching the task and does not load all 20 blindly', () => {
  const audioSelection = selectRelevantSkills(
    'Transcrire les paroles audio, aligner la voix karaoké mot à mot et exporter SRT',
    { maxSkills: 4 },
  );
  assert.equal(audioSelection.instructionsLoaded, false);
  assert.ok(audioSelection.selectedSkills.length >= 1 && audioSelection.selectedSkills.length <= 4);
  assert.equal(audioSelection.selectedSkills[0].skill.id, 'audio-music-intelligence');

  const securitySelection = selectRelevantSkills(
    'Auditer les vulnérabilités XSS, règles Firestore et secrets API côté serveur',
    { maxSkills: 4 },
  );
  const securityIds = securitySelection.selectedSkills.map((m) => m.skill.id);
  assert.ok(securityIds.includes('security-audit'));
  assert.ok(!securityIds.includes('flutter-mobile'));

  const flutterSelection = selectRelevantSkills(
    'Créer un écran Flutter Dart iOS et Android avec Cupertino et Material',
    { maxSkills: 3 },
  );
  assert.equal(flutterSelection.selectedSkills[0].skill.id, 'flutter-mobile');
});

test('buildAgentWorkingContext reads real SKILL.md instructions from disk and refuses disabled skills without simulation', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'alexura-skills-test-'));
  try {
    const tmpRegistryPath = path.join(tmpDir, 'index.json');
    fs.copyFileSync(path.resolve(process.cwd(), 'skills/index.json'), tmpRegistryPath);

    // Disable audio-music-intelligence in temp registry
    const toggled = setSkillEnabled('audio-music-intelligence', false, tmpRegistryPath);
    assert.equal(toggled.skill.enabled, false);
    assert.equal(toggled.enabledCount, 19);
    assert.equal(toggled.disabledCount, 1);

    // Task selection must NOT include disabled skill in selectedSkills, and MUST report it in skippedDisabledSkills
    const selection = selectRelevantSkills(
      'Synchronisation audio karaoké et transcription des paroles',
      { registryPath: tmpRegistryPath, maxSkills: 4 },
    );
    assert.ok(
      !selection.selectedSkills.some((m) => m.skill.id === 'audio-music-intelligence'),
      'Disabled skill should not be selected',
    );
    assert.ok(
      selection.skippedDisabledSkills.some((m) => m.skill.id === 'audio-music-intelligence'),
      'Disabled relevant skill should be reported as skipped',
    );

    // Direct load must refuse disabled skill and never simulate its instructions
    const directLoad = loadSkillInstructions(['audio-music-intelligence', 'qa-testing'], {
      registryPath: tmpRegistryPath,
    });
    const disabledLoaded = directLoad.find((x) => x.skillId === 'audio-music-intelligence');
    const enabledLoaded = directLoad.find((x) => x.skillId === 'qa-testing');

    assert.ok(disabledLoaded);
    assert.equal(disabledLoaded.loaded, false);
    assert.equal(disabledLoaded.reason, 'skill_disabled');
    assert.equal(disabledLoaded.instructions, null);
    assert.equal(disabledLoaded.rawContent, null);

    assert.ok(enabledLoaded);
    assert.equal(enabledLoaded.loaded, true);
    assert.equal(enabledLoaded.reason, 'loaded_from_disk');
    assert.ok(enabledLoaded.instructions && enabledLoaded.instructions.includes('ingénieur QA senior'));

    // Re-enable and verify full working context loads verbatim SKILL.md instructions
    setSkillEnabled('audio-music-intelligence', true, tmpRegistryPath);
    const ctx = buildAgentWorkingContext(
      'Synchronisation audio karaoké et transcription des paroles',
      { registryPath: tmpRegistryPath, maxSkills: 3 },
    );
    assert.equal(ctx.verification.simulated, false);
    assert.ok(ctx.verification.realFilesReadCount >= 1);
    assert.ok(ctx.workingContextPrompt.includes('audio-music-intelligence'));
    assert.ok(ctx.workingContextPrompt.includes('alignement mot-à-mot'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('loadSkillInstructions safely rejects unknown IDs and path traversal attempts', () => {
  const res = loadSkillInstructions(['../etc/passwd', 'non-existent-skill']);
  assert.equal(res.length, 2);
  assert.equal(res[0].loaded, false);
  assert.equal(res[0].reason, 'not_found');
  assert.equal(res[1].loaded, false);
  assert.equal(res[1].reason, 'not_found');
});

test('Express /api/skills router lists, inspects, selects, loads context, and toggles cleanly', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/skills', createSkillsRouter());

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}/api/skills`;

  try {
    // 1. GET /api/skills
    const listRes = await fetch(baseUrl);
    assert.equal(listRes.status, 200);
    const listJson = await listRes.json();
    assert.equal(listJson.success, true);
    assert.equal(listJson.totalCount, 20);

    // 2. POST /api/skills/select
    const selRes = await fetch(`${baseUrl}/select`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'Optimiser les performances web et le temps de rendu', maxSkills: 3 }),
    });
    assert.equal(selRes.status, 200);
    const selJson = await selRes.json();
    assert.equal(selJson.instructionsLoaded, false);
    assert.ok(selJson.selectedSkills.some((m) => m.skill.id === 'performance-optimization'));

    // 3. POST /api/skills/load-context
    const loadRes = await fetch(`${baseUrl}/load-context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ skillIds: ['debugging-code-review'] }),
    });
    assert.equal(loadRes.status, 200);
    const loadJson = await loadRes.json();
    assert.equal(loadJson.verification.simulated, false);
    assert.equal(loadJson.verification.realFilesReadCount, 1);
    assert.ok(loadJson.workingContextPrompt.includes('cause racine'));

    // 4. GET /api/skills/:id/content
    const contentRes = await fetch(`${baseUrl}/documentation-technical-writing/content`);
    assert.equal(contentRes.status, 200);
    const contentJson = await contentRes.json();
    assert.equal(contentJson.fileExists, true);
    assert.equal(contentJson.frontmatter.name, 'documentation-technical-writing');

    // 5. Validation check (invalid PATCH)
    const badPatch = await fetch(`${baseUrl}/documentation-technical-writing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });
    assert.equal(badPatch.status, 400);

    // 6. Toggle off and immediately restore original state
    const target = listJson.skills.find((s) => s.id === 'documentation-technical-writing');
    const origEnabled = Boolean(target?.enabled);
    const patchOff = await fetch(`${baseUrl}/documentation-technical-writing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !origEnabled }),
    });
    assert.equal(patchOff.status, 200);
    const patchOffJson = await patchOff.json();
    assert.equal(patchOffJson.skill.enabled, !origEnabled);

    const patchRestore = await fetch(`${baseUrl}/documentation-technical-writing`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: origEnabled }),
    });
    assert.equal(patchRestore.status, 200);
    const patchRestoreJson = await patchRestore.json();
    assert.equal(patchRestoreJson.skill.enabled, origEnabled);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
