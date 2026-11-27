import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export type SkillCategoryId =
  | 'cadrage-produit'
  | 'design'
  | 'developpement'
  | 'ia-medias'
  | 'qualite-livraison';

export interface SkillCategoryDefinition {
  id: SkillCategoryId;
  label: string;
  order: number;
  description: string;
}

export interface MasterSkillEntry {
  id: string;
  order: string;
  name: string;
  title: string;
  categoryId: SkillCategoryId;
  category: string;
  description: string;
  canonicalPath: string;
  sourceFile: string;
  sha256Prefix?: string;
  bytes?: number;
  type: 'instruction';
  enabled: boolean;
  keywords: string[];
  triggers: string[];
  deliverables: string[];
}

export interface SkillsRegistryFile {
  version: string;
  name: string;
  sourceReadme: string;
  sourceIndex: string;
  honestyRule: string;
  categories: SkillCategoryDefinition[];
  skills: MasterSkillEntry[];
}

export interface SkillSelectionMatch {
  skill: MasterSkillEntry;
  score: number;
  matchedTerms: string[];
}

export interface SkillSelectionResult {
  task: string;
  selectedSkills: SkillSelectionMatch[];
  skippedDisabledSkills: SkillSelectionMatch[];
  totalEvaluated: number;
  maxSkills: number;
  instructionsLoaded: false;
  note: string;
}

export interface LoadedSkillInstruction {
  skillId: string;
  name: string;
  title: string;
  category: string;
  canonicalPath: string;
  sourceFile: string;
  enabled: boolean;
  loaded: boolean;
  reason: 'loaded_from_disk' | 'skill_disabled' | 'not_found' | 'file_missing' | 'path_violation';
  bytesRead: number;
  sha256: string | null;
  frontmatter: {
    name?: string;
    description?: string;
  } | null;
  instructions: string | null;
  rawContent: string | null;
}

export interface AgentWorkingContextResult {
  task: string;
  selectionMode: 'auto' | 'explicit';
  selectedSkills: SkillSelectionMatch[];
  skippedDisabledSkills: SkillSelectionMatch[];
  loadedContexts: LoadedSkillInstruction[];
  workingContextPrompt: string;
  verification: {
    realFilesReadCount: number;
    skippedDisabledCount: number;
    notLoadedCount: number;
    simulated: false;
    honestyRule: string;
  };
}

export interface SkillPreviewResult {
  skill: MasterSkillEntry;
  loadedIntoAgentContext: boolean;
  fileExists: boolean;
  bytesRead: number;
  sha256: string | null;
  frontmatter: {
    name?: string;
    description?: string;
  } | null;
  instructions: string | null;
  rawContent: string | null;
}

const DEFAULT_WORKSPACE_ROOT = process.cwd();
const VALID_SKILL_ID_RE = /^[a-z0-9-]+$/;

export function getDefaultRegistryPath(workspaceRoot = DEFAULT_WORKSPACE_ROOT): string {
  return path.resolve(workspaceRoot, 'skills', 'index.json');
}

export function getDefaultAssetsRoot(workspaceRoot = DEFAULT_WORKSPACE_ROOT): string {
  return path.resolve(workspaceRoot, 'public', 'assets', 'aistudio');
}

function normalizeText(input: string): string {
  return String(input || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+.#/\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const norm = normalizeText(input);
  if (!norm) return [];
  const rawTokens = norm.split(/[\s/]+/).filter(Boolean);
  const stopWords = new Set([
    'le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'ou', 'a', 'au', 'aux',
    'pour', 'par', 'sur', 'dans', 'avec', 'sans', 'en', 'est', 'sont', 'qui', 'que',
    'ce', 'cette', 'mon', 'ma', 'mes', 'ton', 'son', 'the', 'and', 'for', 'with',
    'into', 'from', 'to', 'of', 'in', 'on', 'is', 'are', 'je', 'tu', 'il', 'nous',
    'vous', 'merci', 'faire', 'creer', 'ameliorer', 'ajouter', 'systeme', 'projet',
  ]);
  const set = new Set<string>();
  for (const tok of rawTokens) {
    if (tok.length >= 2 && !stopWords.has(tok)) {
      set.add(tok);
    }
  }
  return Array.from(set);
}

export function assertValidSkillId(skillId: string): string {
  if (typeof skillId !== 'string' || !VALID_SKILL_ID_RE.test(skillId.trim())) {
    throw new Error('Identifiant de skill invalide.');
  }
  return skillId.trim();
}

function resolveConfinedAssetPath(
  relativeAssetPath: string,
  workspaceRoot = DEFAULT_WORKSPACE_ROOT,
  assetsRootOverride?: string,
): string | null {
  if (typeof relativeAssetPath !== 'string' || !relativeAssetPath.trim()) {
    return null;
  }
  const assetsRoot = path.resolve(assetsRootOverride || getDefaultAssetsRoot(workspaceRoot));
  const resolved = path.resolve(workspaceRoot, relativeAssetPath);
  if (resolved !== assetsRoot && !resolved.startsWith(assetsRoot + path.sep)) {
    return null;
  }
  return resolved;
}

export function parseSkillMarkdown(rawContent: string): {
  frontmatter: { name?: string; description?: string };
  instructions: string;
} {
  const trimmed = rawContent.replace(/^\uFEFF/, '');
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!fmMatch) {
    return {
      frontmatter: {},
      instructions: trimmed.trim(),
    };
  }

  const fmBlock = fmMatch[1];
  const body = fmMatch[2].trim();
  const frontmatter: { name?: string; description?: string } = {};

  for (const line of fmBlock.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key === 'name') frontmatter.name = val;
    if (key === 'description') frontmatter.description = val;
  }

  return { frontmatter, instructions: body };
}

export function loadSkillsRegistry(registryPath = getDefaultRegistryPath()): SkillsRegistryFile {
  const resolved = path.resolve(registryPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Registre introuvable : ${resolved}`);
  }
  const raw = fs.readFileSync(resolved, 'utf8');
  const parsed = JSON.parse(raw) as SkillsRegistryFile;
  if (!parsed || !Array.isArray(parsed.skills) || !Array.isArray(parsed.categories)) {
    throw new Error('Structure du registre skills/index.json invalide.');
  }
  return parsed;
}

export function saveSkillsRegistry(
  registry: SkillsRegistryFile,
  registryPath = getDefaultRegistryPath(),
): void {
  const resolved = path.resolve(registryPath);
  const dir = path.dirname(resolved);
  fs.mkdirSync(dir, { recursive: true });
  const tempPath = `${resolved}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');
  fs.renameSync(tempPath, resolved);
}

export function getSkillById(
  skillId: string,
  registryPath = getDefaultRegistryPath(),
): MasterSkillEntry | null {
  const cleanId = assertValidSkillId(skillId);
  const registry = loadSkillsRegistry(registryPath);
  return registry.skills.find((s) => s.id === cleanId) || null;
}

export function setSkillEnabled(
  skillId: string,
  enabled: boolean,
  registryPath = getDefaultRegistryPath(),
): {
  skill: MasterSkillEntry;
  enabledCount: number;
  disabledCount: number;
  totalCount: number;
} {
  if (typeof enabled !== 'boolean') {
    throw new Error('Le statut enabled doit être un booléen.');
  }
  const cleanId = assertValidSkillId(skillId);
  const registry = loadSkillsRegistry(registryPath);
  const idx = registry.skills.findIndex((s) => s.id === cleanId);
  if (idx === -1) {
    throw new Error(`Compétence introuvable : ${cleanId}`);
  }
  registry.skills[idx] = {
    ...registry.skills[idx],
    enabled,
  };
  saveSkillsRegistry(registry, registryPath);

  const enabledCount = registry.skills.filter((s) => s.enabled).length;
  return {
    skill: registry.skills[idx],
    enabledCount,
    disabledCount: registry.skills.length - enabledCount,
    totalCount: registry.skills.length,
  };
}

function scoreSkillAgainstTask(
  skill: MasterSkillEntry,
  normalizedTask: string,
  taskTokens: string[],
): { score: number; matchedTerms: string[] } {
  if (!normalizedTask || taskTokens.length === 0) {
    return { score: 0, matchedTerms: [] };
  }

  let score = 0;
  const matched = new Set<string>();

  const normId = normalizeText(skill.id.replace(/-/g, ' '));
  const normTitle = normalizeText(skill.title);
  const normDesc = normalizeText(skill.description);
  const normTriggers = skill.triggers.map((t) => normalizeText(t)).join(' ');
  const normCategory = normalizeText(skill.category);

  // Explicit mention of skill slug or title
  if (normalizedTask.includes(normalizeText(skill.id)) || normalizedTask.includes(normId)) {
    score += 18;
    matched.add(skill.id);
  }
  if (normTitle.length >= 4 && normalizedTask.includes(normTitle)) {
    score += 14;
    matched.add(skill.title);
  }

  // Exact keyword phrase or token match
  for (const kw of skill.keywords) {
    const normKw = normalizeText(kw);
    if (!normKw) continue;
    if (normKw.includes(' ')) {
      if (normalizedTask.includes(normKw)) {
        score += 9;
        matched.add(kw);
      }
    } else {
      const exactTokenHit = taskTokens.includes(normKw);
      const prefixHit =
        !exactTokenHit &&
        normKw.length >= 4 &&
        taskTokens.some((t) => (t.length >= 4 && (t.startsWith(normKw) || normKw.startsWith(t))));
      if (exactTokenHit) {
        score += 7;
        matched.add(kw);
      } else if (prefixHit) {
        score += 4;
        matched.add(kw);
      }
    }
  }

  // Token hits inside description, triggers, and category
  for (const tok of taskTokens) {
    if (tok.length < 3) continue;
    if (normDesc.includes(tok)) {
      score += 2.5;
      matched.add(tok);
    }
    if (normTriggers.includes(tok)) {
      score += 2;
      matched.add(tok);
    }
    if (normCategory.includes(tok)) {
      score += 1.5;
      matched.add(skill.category);
    }
  }

  return {
    score: Math.round(score * 10) / 10,
    matchedTerms: Array.from(matched).slice(0, 8),
  };
}

export function selectRelevantSkills(
  task: string,
  options: {
    maxSkills?: number;
    categoryId?: string;
    registryPath?: string;
  } = {},
): SkillSelectionResult {
  const cleanTask = String(task || '').trim();
  const maxSkills = Math.max(1, Math.min(10, Number(options.maxSkills) || 4));
  const registry = loadSkillsRegistry(options.registryPath);

  const normalizedTask = normalizeText(cleanTask);
  const taskTokens = tokenize(cleanTask);

  const candidates = options.categoryId
    ? registry.skills.filter((s) => s.categoryId === options.categoryId)
    : registry.skills;

  const scoredEnabled: SkillSelectionMatch[] = [];
  const scoredDisabled: SkillSelectionMatch[] = [];
  const MIN_RELEVANCE_SCORE = 4;

  for (const skill of candidates) {
    const { score, matchedTerms } = scoreSkillAgainstTask(skill, normalizedTask, taskTokens);
    if (score >= MIN_RELEVANCE_SCORE) {
      const item: SkillSelectionMatch = { skill, score, matchedTerms };
      if (skill.enabled) {
        scoredEnabled.push(item);
      } else {
        scoredDisabled.push(item);
      }
    }
  }

  const sortMatches = (a: SkillSelectionMatch, b: SkillSelectionMatch) =>
    b.score - a.score || Number(a.skill.order) - Number(b.skill.order);

  scoredEnabled.sort(sortMatches);
  scoredDisabled.sort(sortMatches);

  return {
    task: cleanTask,
    selectedSkills: scoredEnabled.slice(0, maxSkills),
    skippedDisabledSkills: scoredDisabled,
    totalEvaluated: candidates.length,
    maxSkills,
    instructionsLoaded: false,
    note: 'Sélection calculée uniquement : aucune instruction SKILL.md n’est injectée tant que loadSkillInstructions() n’a pas lu les fichiers sur disque.',
  };
}

export function loadSkillInstructions(
  skillIds: string[],
  options: {
    registryPath?: string;
    workspaceRoot?: string;
    assetsRoot?: string;
  } = {},
): LoadedSkillInstruction[] {
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  const registry = loadSkillsRegistry(options.registryPath || getDefaultRegistryPath(workspaceRoot));
  const results: LoadedSkillInstruction[] = [];
  const seen = new Set<string>();

  for (const rawId of skillIds) {
    const id = typeof rawId === 'string' ? rawId.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);

    if (!VALID_SKILL_ID_RE.test(id)) {
      results.push({
        skillId: id,
        name: id,
        title: id,
        category: '',
        canonicalPath: '',
        sourceFile: '',
        enabled: false,
        loaded: false,
        reason: 'not_found',
        bytesRead: 0,
        sha256: null,
        frontmatter: null,
        instructions: null,
        rawContent: null,
      });
      continue;
    }

    const entry = registry.skills.find((s) => s.id === id);
    if (!entry) {
      results.push({
        skillId: id,
        name: id,
        title: id,
        category: '',
        canonicalPath: '',
        sourceFile: '',
        enabled: false,
        loaded: false,
        reason: 'not_found',
        bytesRead: 0,
        sha256: null,
        frontmatter: null,
        instructions: null,
        rawContent: null,
      });
      continue;
    }

    // Strict honesty rule: NEVER load or simulate instructions for a disabled skill
    if (!entry.enabled) {
      results.push({
        skillId: entry.id,
        name: entry.name,
        title: entry.title,
        category: entry.category,
        canonicalPath: entry.canonicalPath,
        sourceFile: entry.sourceFile,
        enabled: false,
        loaded: false,
        reason: 'skill_disabled',
        bytesRead: 0,
        sha256: null,
        frontmatter: null,
        instructions: null,
        rawContent: null,
      });
      continue;
    }

    const confinedPath = resolveConfinedAssetPath(
      entry.sourceFile,
      workspaceRoot,
      options.assetsRoot,
    );
    if (!confinedPath) {
      results.push({
        skillId: entry.id,
        name: entry.name,
        title: entry.title,
        category: entry.category,
        canonicalPath: entry.canonicalPath,
        sourceFile: entry.sourceFile,
        enabled: true,
        loaded: false,
        reason: 'path_violation',
        bytesRead: 0,
        sha256: null,
        frontmatter: null,
        instructions: null,
        rawContent: null,
      });
      continue;
    }

    if (!fs.existsSync(confinedPath)) {
      results.push({
        skillId: entry.id,
        name: entry.name,
        title: entry.title,
        category: entry.category,
        canonicalPath: entry.canonicalPath,
        sourceFile: entry.sourceFile,
        enabled: true,
        loaded: false,
        reason: 'file_missing',
        bytesRead: 0,
        sha256: null,
        frontmatter: null,
        instructions: null,
        rawContent: null,
      });
      continue;
    }

    const rawContent = fs.readFileSync(confinedPath, 'utf8');
    const bytesRead = Buffer.byteLength(rawContent, 'utf8');
    const sha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
    const parsed = parseSkillMarkdown(rawContent);

    results.push({
      skillId: entry.id,
      name: entry.name,
      title: entry.title,
      category: entry.category,
      canonicalPath: entry.canonicalPath,
      sourceFile: entry.sourceFile,
      enabled: true,
      loaded: true,
      reason: 'loaded_from_disk',
      bytesRead,
      sha256,
      frontmatter: parsed.frontmatter,
      instructions: parsed.instructions,
      rawContent,
    });
  }

  return results;
}

export function readRawSkillPreview(
  skillId: string,
  options: {
    registryPath?: string;
    workspaceRoot?: string;
    assetsRoot?: string;
  } = {},
): SkillPreviewResult | null {
  const cleanId = assertValidSkillId(skillId);
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  const registry = loadSkillsRegistry(options.registryPath || getDefaultRegistryPath(workspaceRoot));
  const skill = registry.skills.find((s) => s.id === cleanId);
  if (!skill) return null;

  const confinedPath = resolveConfinedAssetPath(
    skill.sourceFile,
    workspaceRoot,
    options.assetsRoot,
  );
  if (!confinedPath || !fs.existsSync(confinedPath)) {
    return {
      skill,
      loadedIntoAgentContext: false,
      fileExists: false,
      bytesRead: 0,
      sha256: null,
      frontmatter: null,
      instructions: null,
      rawContent: null,
    };
  }

  const rawContent = fs.readFileSync(confinedPath, 'utf8');
  const bytesRead = Buffer.byteLength(rawContent, 'utf8');
  const sha256 = crypto.createHash('sha256').update(rawContent).digest('hex');
  const parsed = parseSkillMarkdown(rawContent);

  return {
    skill,
    loadedIntoAgentContext: skill.enabled,
    fileExists: true,
    bytesRead,
    sha256,
    frontmatter: parsed.frontmatter,
    instructions: parsed.instructions,
    rawContent,
  };
}

export function buildAgentWorkingContext(
  task: string,
  options: {
    skillIds?: string[];
    maxSkills?: number;
    categoryId?: string;
    registryPath?: string;
    workspaceRoot?: string;
    assetsRoot?: string;
  } = {},
): AgentWorkingContextResult {
  const workspaceRoot = options.workspaceRoot || DEFAULT_WORKSPACE_ROOT;
  const registryPath = options.registryPath || getDefaultRegistryPath(workspaceRoot);
  const registry = loadSkillsRegistry(registryPath);

  const explicitIds = Array.isArray(options.skillIds)
    ? options.skillIds.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const selectionMode: 'auto' | 'explicit' = explicitIds.length > 0 ? 'explicit' : 'auto';

  let selectedSkills: SkillSelectionMatch[] = [];
  let skippedDisabledSkills: SkillSelectionMatch[] = [];
  let targetIds: string[] = [];

  if (selectionMode === 'explicit') {
    targetIds = explicitIds;
    for (const id of explicitIds) {
      const entry = registry.skills.find((s) => s.id === id);
      if (entry) {
        const item: SkillSelectionMatch = {
          skill: entry,
          score: 100,
          matchedTerms: ['selection-manuelle'],
        };
        if (entry.enabled) {
          selectedSkills.push(item);
        } else {
          skippedDisabledSkills.push(item);
        }
      }
    }
  } else {
    const selection = selectRelevantSkills(task, {
      maxSkills: options.maxSkills,
      categoryId: options.categoryId,
      registryPath,
    });
    selectedSkills = selection.selectedSkills;
    skippedDisabledSkills = selection.skippedDisabledSkills;
    targetIds = selectedSkills.map((m) => m.skill.id);
  }

  // Load actual SKILL.md files from disk ONLY for targetIds (explicit mode passes all IDs so disabled ones are explicitly reported as not loaded)
  const loadedContexts = loadSkillInstructions(
    selectionMode === 'explicit' ? explicitIds : targetIds,
    {
      registryPath,
      workspaceRoot,
      assetsRoot: options.assetsRoot,
    },
  );

  const actuallyLoaded = loadedContexts.filter((c) => c.loaded && c.instructions);
  const blocks: string[] = [];

  blocks.push(
    [
      '=== CONTEXTE DE TRAVAIL AGENT : INSTRUCTIONS SKILLS CHARGÉES DEPUIS LE DISQUE ===',
      `Tâche demandée : ${String(task || '').trim() || '(aucune description fournie)'}`,
      'Statut : Guides d’instructions textuelles uniquement (aucun outil exécutable implicite).',
      `Fichiers SKILL.md réellement lus : ${actuallyLoaded.length}`,
    ].join('\n'),
  );

  if (actuallyLoaded.length === 0) {
    blocks.push(
      'Aucune instruction SKILL.md n’a été chargée dans le contexte (aucune compétence active ne correspond ou toutes les cibles sont désactivées).',
    );
  } else {
    for (const item of actuallyLoaded) {
      blocks.push(
        [
          `--- [${item.name}] (${item.canonicalPath} · ${item.sourceFile} · ${item.bytesRead} octets · sha256:${item.sha256?.slice(0, 12)}) ---`,
          item.frontmatter?.description ? `Objectif : ${item.frontmatter.description}` : '',
          item.instructions || '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }

  if (skippedDisabledSkills.length > 0) {
    blocks.push(
      `Compétences pertinentes IGNORÉES car désactivées (non chargées, non simulées) : ${skippedDisabledSkills
        .map((m) => m.skill.id)
        .join(', ')}`,
    );
  }

  return {
    task: String(task || '').trim(),
    selectionMode,
    selectedSkills,
    skippedDisabledSkills,
    loadedContexts,
    workingContextPrompt: blocks.join('\n\n'),
    verification: {
      realFilesReadCount: actuallyLoaded.length,
      skippedDisabledCount: skippedDisabledSkills.length,
      notLoadedCount: loadedContexts.filter((c) => !c.loaded).length,
      simulated: false,
      honestyRule: registry.honestyRule,
    },
  };
}
