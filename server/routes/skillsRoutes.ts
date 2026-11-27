import { Router, type Request, type Response } from 'express';
import {
  assertValidSkillId,
  buildAgentWorkingContext,
  loadSkillsRegistry,
  readRawSkillPreview,
  selectRelevantSkills,
  setSkillEnabled,
} from '../services/skillsManager.ts';

export function createSkillsRouter(): Router {
  const router = Router();

  // GET /api/skills — Registry + categories + activation counts
  router.get('/', (_req: Request, res: Response) => {
    try {
      const registry = loadSkillsRegistry();
      const enabledCount = registry.skills.filter((s) => s.enabled).length;
      return res.json({
        success: true,
        version: registry.version,
        name: registry.name,
        honestyRule: registry.honestyRule,
        sourceReadme: registry.sourceReadme,
        sourceIndex: registry.sourceIndex,
        totalCount: registry.skills.length,
        enabledCount,
        disabledCount: registry.skills.length - enabledCount,
        categories: registry.categories,
        skills: registry.skills,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err instanceof Error ? err.message : 'Erreur lecture registre skills.',
      });
    }
  });

  // POST /api/skills/select — Task-based skill relevance selection (without loading files yet)
  router.post('/select', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const task = typeof body.task === 'string' ? body.task.trim() : '';
      if (!task || task.length > 2000) {
        return res.status(400).json({
          success: false,
          error: 'Le champ "task" est requis (1 à 2000 caractères).',
        });
      }

      const maxSkills =
        typeof body.maxSkills === 'number' && Number.isFinite(body.maxSkills)
          ? Math.max(1, Math.min(10, Math.floor(body.maxSkills)))
          : 4;
      const categoryId =
        typeof body.categoryId === 'string' && body.categoryId.trim()
          ? body.categoryId.trim()
          : undefined;

      const result = selectRelevantSkills(task, { maxSkills, categoryId });
      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Erreur lors de la sélection des skills.',
      });
    }
  });

  // POST /api/skills/load-context — Load real SKILL.md instructions from disk into agent context
  router.post('/load-context', (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as Record<string, unknown>;
      const task = typeof body.task === 'string' ? body.task.trim() : '';
      const rawIds = Array.isArray(body.skillIds)
        ? body.skillIds
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter(Boolean)
            .slice(0, 20)
        : undefined;

      if (!task && (!rawIds || rawIds.length === 0)) {
        return res.status(400).json({
          success: false,
          error: 'Fournissez une description "task" ou une liste "skillIds".',
        });
      }
      if (task.length > 2000) {
        return res.status(400).json({
          success: false,
          error: 'La tâche dépasse la limite de 2000 caractères.',
        });
      }

      const maxSkills =
        typeof body.maxSkills === 'number' && Number.isFinite(body.maxSkills)
          ? Math.max(1, Math.min(10, Math.floor(body.maxSkills)))
          : 4;
      const categoryId =
        typeof body.categoryId === 'string' && body.categoryId.trim()
          ? body.categoryId.trim()
          : undefined;

      const result = buildAgentWorkingContext(task, {
        skillIds: rawIds,
        maxSkills,
        categoryId,
      });

      return res.json({
        success: true,
        ...result,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Erreur chargement contexte skills.',
      });
    }
  });

  // GET /api/skills/:id/content — Read actual SKILL.md content from disk for Admin UI preview
  router.get('/:id/content', (req: Request, res: Response) => {
    try {
      const id = assertValidSkillId(String(req.params.id || ''));
      const preview = readRawSkillPreview(id);
      if (!preview) {
        return res.status(404).json({
          success: false,
          error: `Compétence introuvable : ${id}`,
        });
      }
      return res.json({
        success: true,
        ...preview,
      });
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: err instanceof Error ? err.message : 'Identifiant skill invalide.',
      });
    }
  });

  // PATCH /api/skills/:id — Enable or disable a skill persistently in /skills/index.json
  router.patch('/:id', (req: Request, res: Response) => {
    try {
      const id = assertValidSkillId(String(req.params.id || ''));
      const body = (req.body || {}) as Record<string, unknown>;
      if (typeof body.enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: 'Le champ booléen "enabled" est requis.',
        });
      }

      const updated = setSkillEnabled(id, body.enabled);
      return res.json({
        success: true,
        ...updated,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur mise à jour skill.';
      const status = message.includes('introuvable') ? 404 : 400;
      return res.status(status).json({
        success: false,
        error: message,
      });
    }
  });

  return router;
}
