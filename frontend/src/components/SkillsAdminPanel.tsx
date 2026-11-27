import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  Filter,
  FolderTree,
  PauseCircle,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  skillsApi,
  type AgentContextLoadResponse,
  type MasterSkillItem,
  type SkillCategoryId,
  type SkillFilePreviewResponse,
  type SkillsRegistryResponse,
} from '@/services/skillsApi';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const SAMPLE_TASKS = [
  'Synchronisation audio karaoké, transcription Whisper et contrôle qualité paroles',
  'Audit sécurité authentification Google, règles Firestore et validation API backend',
  'Animations motion Trap Soul, interface responsive accessible FR/EN et tests QA',
];

export const SkillsAdminPanel: React.FC = () => {
  const [registry, setRegistry] = useState<SkillsRegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'all' | SkillCategoryId>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  const [taskInput, setTaskInput] = useState(SAMPLE_TASKS[0]);
  const [maxSkills, setMaxSkills] = useState<number>(4);
  const [loadingContext, setLoadingContext] = useState(false);
  const [contextResult, setContextResult] = useState<AgentContextLoadResponse | null>(null);
  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<SkillFilePreviewResponse | null>(null);

  const fetchRegistry = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await skillsApi.listRegistry();
      setRegistry(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de charger /skills/index.json');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchRegistry();
  }, []);

  const handleToggleSkill = async (skill: MasterSkillItem) => {
    setTogglingId(skill.id);
    setErrorMsg(null);
    try {
      const updated = await skillsApi.setEnabled(skill.id, !skill.enabled);
      setRegistry((prev) =>
        prev
          ? {
              ...prev,
              enabledCount: updated.enabledCount,
              disabledCount: updated.disabledCount,
              skills: prev.skills.map((item) =>
                item.id === skill.id ? updated.skill : item,
              ),
            }
          : prev,
      );
      if (previewData?.skill.id === skill.id) {
        setPreviewData((prev) =>
          prev
            ? {
                ...prev,
                skill: updated.skill,
                loadedIntoAgentContext: updated.skill.enabled,
              }
            : prev,
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Échec de mise à jour du statut.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleInspectSkill = async (skillId: string) => {
    setPreviewLoading(true);
    setErrorMsg(null);
    try {
      const data = await skillsApi.getSkillContent(skillId);
      setPreviewData(data);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Impossible de lire le fichier SKILL.md.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleRunContextLoader = async (customTask?: string) => {
    const task = (customTask ?? taskInput).trim();
    if (!task) return;
    setLoadingContext(true);
    setErrorMsg(null);
    try {
      const result = await skillsApi.loadContext({
        task,
        maxSkills,
      });
      setContextResult(result);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Erreur chargement contexte.');
    } finally {
      setLoadingContext(false);
    }
  };

  const handleCopyPrompt = async () => {
    if (!contextResult?.workingContextPrompt) return;
    try {
      await navigator.clipboard.writeText(contextResult.workingContextPrompt);
      setCopiedPrompt(true);
      window.setTimeout(() => setCopiedPrompt(false), 1800);
    } catch {
      // Clipboard fallback not fatal
    }
  };

  const filteredSkills = useMemo(() => {
    if (!registry) return [];
    const q = searchQuery.trim().toLowerCase();
    return registry.skills.filter((skill) => {
      if (selectedCategory !== 'all' && skill.categoryId !== selectedCategory) return false;
      if (statusFilter === 'enabled' && !skill.enabled) return false;
      if (statusFilter === 'disabled' && skill.enabled) return false;
      if (!q) return true;
      const haystack = [
        skill.order,
        skill.name,
        skill.title,
        skill.category,
        skill.description,
        ...skill.keywords,
        ...skill.triggers,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [registry, searchQuery, selectedCategory, statusFilter]);

  const groupedByCategory = useMemo(() => {
    if (!registry) return [];
    return registry.categories
      .map((cat) => ({
        category: cat,
        items: filteredSkills.filter((s) => s.categoryId === cat.id),
      }))
      .filter((group) => group.items.length > 0);
  }, [registry, filteredSkills]);

  return (
    <div className="space-y-5">
      {/* Honesty / Architecture Notice */}
      <Alert variant="default">
        <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5 text-[#e8c97a]" />
        <div className="space-y-1">
          <div className="font-semibold text-slate-50">
            Registre Central des 20 AI Studio Master Skills · Guides d’instructions non exécutables
          </div>
          <p className="text-[11px] leading-relaxed text-slate-400">
            {registry?.honestyRule ||
              "Les Skills sont des fichiers d'instructions textuelles (SKILL.md), pas des outils exécutables. Aucune compétence désactivée ou non lue depuis le disque n'est simulée."}
          </p>
        </div>
      </Alert>

      {errorMsg && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div>
            <div className="font-semibold">Erreur Administration Skills</div>
            <p className="text-[11px] mt-0.5">{errorMsg}</p>
          </div>
        </Alert>
      )}

      {/* Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-400">Compétences indexées</div>
            <div className="axr-tc mt-1 text-xl font-semibold text-slate-50">
              {registry?.totalCount ?? '—'}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-400">Activées</div>
            <div className="axr-tc mt-1 flex items-center gap-1.5 text-xl font-semibold text-emerald-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{registry?.enabledCount ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-400">Désactivées</div>
            <div className="axr-tc mt-1 flex items-center gap-1.5 text-xl font-semibold text-slate-300">
              <PauseCircle className="h-4 w-4 shrink-0 text-slate-400" />
              <span>{registry?.disabledCount ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3.5">
            <div className="text-[11px] font-medium text-slate-400">Catégories</div>
            <div className="axr-tc mt-1 flex items-center gap-1.5 text-xl font-semibold text-[#e8c97a]">
              <FolderTree className="h-4 w-4 shrink-0" />
              <span>{registry?.categories.length ?? '—'}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Real Task Selection & Context Loader */}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#e8c97a]" />
                <span>Sélection par tâche &amp; chargement réel du contexte SKILL.md</span>
              </CardTitle>
              <CardDescription>
                Sélectionne uniquement les compétences pertinentes et actives, puis lit leurs vrais fichiers sur disque.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="axrSkillMaxSelect" className="text-slate-400">
                Limite
              </label>
              <select
                id="axrSkillMaxSelect"
                value={maxSkills}
                onChange={(e) => setMaxSkills(Number(e.target.value))}
                className="h-8 rounded-md border border-slate-200/12 bg-[#080b12] px-2 text-xs text-slate-100 hover:border-slate-200/24 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70"
              >
                <option value={2}>2 skills</option>
                <option value={4}>4 skills</option>
                <option value={6}>6 skills</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="Décrivez la tâche demandée (ex: Audit sécurité Firebase, Synchro paroles audio...)"
              aria-label="Tâche à analyser pour sélectionner les Skills pertinentes"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  void handleRunContextLoader();
                }
              }}
            />
            <Button
              type="button"
              variant="champagne"
              onClick={() => void handleRunContextLoader()}
              disabled={loadingContext || !taskInput.trim()}
            >
              <Play className="h-3.5 w-3.5" />
              <span>
                {loadingContext
                  ? 'Lecture disque…'
                  : 'Sélectionner & Charger le contexte réel'}
              </span>
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            <span className="text-slate-400 mr-1">Exemples :</span>
            {SAMPLE_TASKS.map((sample, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setTaskInput(sample);
                  void handleRunContextLoader(sample);
                }}
                className="rounded-md border border-slate-200/10 bg-[#090d16] px-2.5 py-1 text-left text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[border-color,background-color,color] duration-150 hover:border-[#deb96c]/45 hover:bg-[#131a2b] hover:text-white cursor-pointer"
              >
                {sample}
              </button>
            ))}
          </div>

          {contextResult && (
            <div className="mt-3 space-y-3 rounded-xl border border-slate-200/12 bg-[#080b12]/90 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200/8 pb-2.5">
                <div className="axr-tc text-xs text-slate-200">
                  <span className="font-semibold text-emerald-400">
                    {contextResult.verification.realFilesReadCount} fichier(s) SKILL.md lu(s) depuis le disque
                  </span>
                  {' · '}
                  <span className="text-slate-400">
                    {contextResult.verification.skippedDisabledCount} ignorée(s) car désactivée(s)
                  </span>
                  {' · '}
                  <span className="text-slate-400">simulation: false</span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={copiedPrompt ? 'emerald' : 'secondary'}
                  onClick={() => void handleCopyPrompt()}
                >
                  {copiedPrompt ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Copié</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-sky-300" />
                      <span>Copier le contexte</span>
                    </>
                  )}
                </Button>
              </div>

              {contextResult.selectedSkills.length > 0 && (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {contextResult.selectedSkills.map((match) => {
                    const loadedItem = contextResult.loadedContexts.find(
                      (c) => c.skillId === match.skill.id,
                    );
                    return (
                      <div
                        key={match.skill.id}
                        className="rounded-lg border border-slate-200/10 bg-[#0e131e] p-2.5 text-xs space-y-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold text-slate-100">
                            {match.skill.order} · {match.skill.name}
                          </span>
                          <span className="axr-tc text-[11px] font-medium text-emerald-400">
                            Score {match.score} · {loadedItem?.bytesRead ?? 0} o
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400">
                          {match.skill.category} · Mots-clés : {match.matchedTerms.join(', ')}
                        </div>
                        <div className="axr-tc text-[10px] text-slate-500">
                          {match.skill.sourceFile}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {contextResult.skippedDisabledSkills.length > 0 && (
                <div className="rounded-lg border border-amber-400/28 bg-amber-500/8 p-2.5 text-[11px] text-amber-200">
                  Compétences pertinentes non chargées car désactivées (non simulées) :{' '}
                  <span className="axr-tc font-semibold">
                    {contextResult.skippedDisabledSkills.map((m) => m.skill.name).join(', ')}
                  </span>
                </div>
              )}

              <details className="rounded-lg border border-slate-200/10 bg-[#06080e] p-2.5">
                <summary className="cursor-pointer text-xs font-medium text-slate-200 select-none">
                  Voir le bloc d’instructions complet injecté dans le contexte de l’agent
                </summary>
                <pre className="mt-2.5 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-slate-300">
                  {contextResult.workingContextPrompt}
                </pre>
              </details>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters Toolbar */}
      <Card>
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative flex-1 max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer par nom, description, mot-clé ou déclencheur…"
                aria-label="Rechercher une compétence"
                className="pl-8"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1 text-[11px] text-slate-400 mr-1">
                <Filter className="h-3.5 w-3.5" />
                Statut
              </span>
              {(['all', 'enabled', 'disabled'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  aria-pressed={statusFilter === st}
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-[background,border-color,color] duration-150 cursor-pointer ${
                    statusFilter === st
                      ? 'border-sky-400/55 bg-gradient-to-b from-sky-500/22 to-sky-500/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                      : 'border-slate-200/10 bg-[#080b12] text-slate-400 hover:border-slate-200/20 hover:text-slate-100'
                  }`}
                >
                  {st === 'all' ? 'Toutes' : st === 'enabled' ? 'Activées' : 'Désactivées'}
                </button>
              ))}

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => void fetchRegistry()}
                disabled={loading}
              >
                <RefreshCw className={`h-3.5 w-3.5 text-sky-300 ${loading ? 'animate-spin' : ''}`} />
                <span>Actualiser</span>
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={selectedCategory === 'all'}
              onClick={() => setSelectedCategory('all')}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-[background,border-color,color] duration-150 cursor-pointer ${
                selectedCategory === 'all'
                  ? 'border-[#deb96c]/55 bg-gradient-to-b from-[#deb96c]/22 to-[#deb96c]/10 text-[#fff6df] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                  : 'border-slate-200/10 bg-[#080b12] text-slate-400 hover:border-slate-200/20 hover:text-slate-100'
              }`}
            >
              Toutes les catégories ({registry?.skills.length ?? 20})
            </button>
            {registry?.categories.map((cat) => {
              const count = registry.skills.filter((s) => s.categoryId === cat.id).length;
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={selectedCategory === cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-[background,border-color,color] duration-150 cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'border-sky-400/55 bg-gradient-to-b from-sky-500/22 to-sky-500/12 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                      : 'border-slate-200/10 bg-[#080b12] text-slate-400 hover:border-slate-200/20 hover:text-slate-100'
                  }`}
                >
                  {cat.label} ({count})
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Skills Inspector Drawer/Card if selected */}
      {(previewLoading || previewData) && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <FileText className="h-4 w-4 text-sky-400" />
                  <span>
                    {previewLoading
                      ? 'Lecture du fichier SKILL.md…'
                      : `${previewData?.skill.order} · ${previewData?.skill.name} — Contenu réel sur disque`}
                  </span>
                </CardTitle>
                {previewData && (
                  <CardDescription className="axr-tc mt-1 text-[11px]">
                    {previewData.skill.canonicalPath} · {previewData.skill.sourceFile} ·{' '}
                    {previewData.bytesRead} octets · sha256:{previewData.sha256?.slice(0, 12)} ·{' '}
                    {previewData.loadedIntoAgentContext
                      ? 'Activée (éligible au contexte)'
                      : 'Désactivée (bloquée du contexte)'}
                  </CardDescription>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="secondary"
                aria-label="Fermer l'inspecteur SKILL.md"
                onClick={() => setPreviewData(null)}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          {previewData && (
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-slate-200/12 bg-[#06080e] p-3">
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-200">
                  {previewData.rawContent || 'Fichier introuvable sur disque.'}
                </pre>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* Categorized Skills Grid */}
      {loading && !registry ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-slate-400">
            Chargement du registre des 20 AI Studio Master Skills…
          </CardContent>
        </Card>
      ) : groupedByCategory.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-xs text-slate-400">
            Aucune compétence ne correspond aux filtres actifs.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {groupedByCategory.map(({ category, items }) => (
            <section key={category.id} className="space-y-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-200/10 pb-1.5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">{category.label}</h2>
                  <p className="text-[11px] text-slate-400">{category.description}</p>
                </div>
                <span className="axr-tc text-[11px] font-medium text-[#e8c97a]">
                  {items.filter((i) => i.enabled).length}/{items.length} actives
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {items.map((skill) => {
                  const isBusy = togglingId === skill.id;
                  return (
                    <Card
                      key={skill.id}
                      className={
                        skill.enabled
                          ? 'transition-[border-color,background-color] duration-150 hover:border-sky-400/32'
                          : 'opacity-75 border-slate-200/7 bg-none bg-[#080b12]/80 transition-[border-color,background-color] duration-150'
                      }
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="axr-tc text-xs font-semibold text-sky-400">
                                {skill.order}
                              </span>
                              <h3 className="truncate text-sm font-semibold text-slate-50">
                                {skill.title}
                              </h3>
                            </div>
                            <div className="axr-tc text-[11px] text-slate-400 truncate">
                              {skill.name} · {skill.canonicalPath}
                            </div>
                          </div>

                          <button
                            type="button"
                            role="switch"
                            aria-checked={skill.enabled}
                            aria-label={`${skill.enabled ? 'Désactiver' : 'Activer'} ${skill.name}`}
                            disabled={isBusy}
                            onClick={() => void handleToggleSkill(skill)}
                            className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold transition-[background,border-color,color] duration-150 cursor-pointer disabled:opacity-50 ${
                              skill.enabled
                                ? 'border-emerald-400/40 bg-gradient-to-b from-emerald-500/20 to-emerald-500/10 text-emerald-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-emerald-300/65 hover:from-emerald-500/28 hover:to-emerald-500/16'
                                : 'border-slate-200/12 bg-[#111622] text-slate-400 hover:border-slate-200/22 hover:text-slate-200'
                            }`}
                          >
                            {skill.enabled ? (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                <span>Activée</span>
                              </>
                            ) : (
                              <>
                                <PauseCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>Désactivée</span>
                              </>
                            )}
                          </button>
                        </div>

                        <p className="text-xs leading-relaxed text-slate-300">
                          {skill.description}
                        </p>

                        <div className="text-[11px] text-slate-400">
                          <span className="text-slate-500">Déclencheur : </span>
                          {skill.triggers[0] || skill.keywords.slice(0, 4).join(', ')}
                        </div>

                        <div className="flex items-center justify-between gap-2 border-t border-slate-200/8 pt-2.5 text-[11px]">
                          <span className="axr-tc truncate text-slate-500">
                            {skill.sourceFile}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={() => void handleInspectSkill(skill.id)}
                          >
                            <FileText className="h-3.5 w-3.5 text-sky-300" />
                            <span>Lire SKILL.md</span>
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};
