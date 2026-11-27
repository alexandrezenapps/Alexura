/**
 * Typed REST Client for AI Studio Master Skills Registry (/api/skills/*).
 */

export type SkillCategoryId =
  | 'cadrage-produit'
  | 'design'
  | 'developpement'
  | 'ia-medias'
  | 'qualite-livraison';

export interface SkillCategoryInfo {
  id: SkillCategoryId;
  label: string;
  order: number;
  description: string;
}

export interface MasterSkillItem {
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

export interface SkillsRegistryResponse {
  success: boolean;
  version: string;
  name: string;
  honestyRule: string;
  sourceReadme: string;
  sourceIndex: string;
  totalCount: number;
  enabledCount: number;
  disabledCount: number;
  categories: SkillCategoryInfo[];
  skills: MasterSkillItem[];
}

export interface SkillSelectionMatchItem {
  skill: MasterSkillItem;
  score: number;
  matchedTerms: string[];
}

export interface LoadedSkillContextItem {
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
  frontmatter: { name?: string; description?: string } | null;
  instructions: string | null;
  rawContent: string | null;
}

export interface AgentContextLoadResponse {
  success: boolean;
  task: string;
  selectionMode: 'auto' | 'explicit';
  selectedSkills: SkillSelectionMatchItem[];
  skippedDisabledSkills: SkillSelectionMatchItem[];
  loadedContexts: LoadedSkillContextItem[];
  workingContextPrompt: string;
  verification: {
    realFilesReadCount: number;
    skippedDisabledCount: number;
    notLoadedCount: number;
    simulated: false;
    honestyRule: string;
  };
}

export interface SkillFilePreviewResponse {
  success: boolean;
  skill: MasterSkillItem;
  loadedIntoAgentContext: boolean;
  fileExists: boolean;
  bytesRead: number;
  sha256: string | null;
  frontmatter: { name?: string; description?: string } | null;
  instructions: string | null;
  rawContent: string | null;
}

const API_BASE =
  (typeof import.meta !== 'undefined' &&
    (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_BASE_URL) ||
  '';

function apiUrl(path: string): string {
  const base = API_BASE.replace(/\/$/, '');
  return `${base}${path}`;
}

async function parseJson<T>(resp: Response): Promise<T> {
  const text = await resp.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`Réponse JSON invalide (${resp.status})`);
  }
  if (!resp.ok || data.success === false) {
    throw new Error(String(data.error || data.detail || `HTTP ${resp.status}`));
  }
  return data as T;
}

export const skillsApi = {
  async listRegistry(): Promise<SkillsRegistryResponse> {
    const res = await fetch(apiUrl('/api/skills'));
    return parseJson<SkillsRegistryResponse>(res);
  },

  async setEnabled(
    skillId: string,
    enabled: boolean,
  ): Promise<{
    success: boolean;
    skill: MasterSkillItem;
    enabledCount: number;
    disabledCount: number;
    totalCount: number;
  }> {
    const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(skillId)}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    return parseJson(res);
  },

  async loadContext(payload: {
    task?: string;
    skillIds?: string[];
    maxSkills?: number;
    categoryId?: string;
  }): Promise<AgentContextLoadResponse> {
    const res = await fetch(apiUrl('/api/skills/load-context'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return parseJson<AgentContextLoadResponse>(res);
  },

  async getSkillContent(skillId: string): Promise<SkillFilePreviewResponse> {
    const res = await fetch(apiUrl(`/api/skills/${encodeURIComponent(skillId)}/content`));
    return parseJson<SkillFilePreviewResponse>(res);
  },
};
