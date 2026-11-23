import { GoogleGenAI, Type } from '@google/genai';
import type { OrthographyChange, VoiceDivergence } from './lyricSpellReconciler.ts';
import {
  containsHanzi,
  detectMandarinScript,
  mandarinCharSimilarity,
} from './mandarinTools.ts';

export type ReformulationDiffType =
  | 'orthography'
  | 'phonetic_mondegreen'
  | 'missing_words'
  | 'extra_words'
  | 'semantic_mismatch'
  | 'script_mismatch';

export interface LineReformulation {
  lineIdx: number;
  originalText: string;
  heardText: string;
  reformulatedText: string;
  differenceType: ReformulationDiffType;
  differenceSummary: string;
  confidence: number;
  start: number;
  end: number;
  engine: string;
}

export type UnresolvableCategory =
  | 'complete_text_audio_mismatch'
  | 'instrumental_gap_stretch'
  | 'low_vocal_clarity'
  | 'desynced_snippet_offset'
  | 'repeated_chorus_ambiguity'
  | 'empty_or_unvoiced';

export interface UnresolvableProblem {
  id: string;
  lineIdx: number;
  start: number;
  end: number;
  severity: 'high' | 'medium';
  category: UnresolvableCategory;
  title: string;
  description: string;
  suggestedFix: string;
  actionType: 'apply_reformulation' | 'reanalyze_segment' | 'mic_dictate' | 'seek_inspect';
}

export interface ReconcileSummary {
  totalLines: number;
  alignedLines: number;
  divergentLines: number;
  reformulatedCount: number;
  unresolvableCount: number;
  overallQuality: number;
  engineUsed: string;
}

export interface ReconcileInputLine {
  lineIdx: number;
  text: string;
  start?: number;
  end?: number;
  confidence?: number;
  matchRatio?: number;
  flags?: string[];
  interlude?: boolean;
}

export interface RecognizedWindow {
  text: string;
  start: number;
  end: number;
  recognitionConfidence?: number;
}

export interface ReconcileParams {
  ai?: GoogleGenAI | null;
  userLines: ReconcileInputLine[];
  recognizedLines: RecognizedWindow[];
  vocalSegments?: Array<{ start: number; end: number }>;
  divergences?: VoiceDivergence[];
  corrections?: OrthographyChange[];
  lang?: string;
  durationSec?: number;
  matchRatio?: number;
  lineMatchRatios?: Record<number, number>;
  stretchedLineIndices?: number[];
}

export interface ReconcileResult {
  success: boolean;
  engineUsed: string;
  reformulations: LineReformulation[];
  unresolvableProblems: UnresolvableProblem[];
  summary: ReconcileSummary;
}

function normComparison(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '');
}

function stripPunctEdge(s: string): string {
  return String(s || '')
    .trim()
    .replace(/^[.,!?;:…，。！？、；：\s]+|[.,!?;:…，。！？、；：\s]+$/g, '');
}

function overlappingHeardForLine(
  ln: ReconcileInputLine,
  recognizedLines: RecognizedWindow[],
  divergences: VoiceDivergence[] = [],
): { heardText: string; avgRecConf: number } {
  const divMatch = divergences.find(d => d.lineIdx === ln.lineIdx && d.heardText);
  const ls = Number(ln.start) || 0;
  const le = Math.max(ls + 0.3, Number(ln.end) || ls + 2.5);

  // Score by true positive temporal overlap so adjacent lines separated by <=0.4s never bleed together
  const positiveHits = recognizedLines
    .map(rl => {
      const ov = Math.min(le, rl.end) - Math.max(ls, rl.start);
      const minDur = Math.max(0.15, Math.min(le - ls, Math.max(0.2, rl.end - rl.start)));
      return { rl, ov, ratio: ov / minDur };
    })
    .filter(x => x.rl.text.trim() && (x.ov >= 0.15 || x.ratio >= 0.35))
    .sort((a, b) => a.rl.start - b.rl.start);

  const hits = positiveHits.length
    ? positiveHits.map(x => x.rl)
    : recognizedLines
        .filter(rl => rl.end >= ls - 0.25 && rl.start <= le + 0.25 && rl.text.trim())
        .sort((a, b) => {
          const mid = (ls + le) / 2;
          return Math.abs((a.start + a.end) / 2 - mid) - Math.abs((b.start + b.end) / 2 - mid);
        })
        .slice(0, 1);

  const heardText = hits.length
    ? hits.map(h => h.text.trim()).join(' ').trim()
    : (divMatch?.heardText || '').trim();
  const avgRecConf = hits.length
    ? hits.reduce((sum, h) => sum + (Number(h.recognitionConfidence) || 0.85), 0) / hits.length
    : 0.82;
  return { heardText, avgRecConf };
}

function buildDeterministicReformulation(
  ln: ReconcileInputLine,
  heardText: string,
  avgRecConf: number,
  lang: string,
): LineReformulation | null {
  const origClean = stripPunctEdge(ln.text);
  const heardClean = stripPunctEdge(heardText);
  if (!origClean || !heardClean) return null;

  const nOrig = normComparison(origClean);
  const nHeard = normComparison(heardClean);
  if (!nOrig || !nHeard || nOrig === nHeard) return null;

  const lineMatch = typeof ln.matchRatio === 'number' ? ln.matchRatio : 0.5;
  const lineStart = +(Number(ln.start) || 0).toFixed(3);
  const lineEnd = +(Math.max(lineStart + 0.3, Number(ln.end) || lineStart + 2.5)).toFixed(3);

  // If ASR heard multiple lines bleeding over into one long string, trim to closest clause if possible
  const clauses = heardClean.split(/[，。,.!?！？\n]+/).map(s => s.trim()).filter(Boolean);
  let bestClause = heardClean;
  if (clauses.length > 1) {
    let bestScore = -1;
    const origChars = Array.from(nOrig);
    for (const cl of clauses) {
      const nCl = normComparison(cl);
      if (!nCl) continue;
      let shared = 0;
      if (containsHanzi(origClean) && containsHanzi(cl)) {
        for (const ch of origChars) {
          for (const hc of Array.from(nCl)) {
            if (mandarinCharSimilarity(ch, hc) >= 0.8) { shared++; break; }
          }
        }
      } else {
        const setH = new Set(cl.toLowerCase().split(/\s+/));
        for (const w of origClean.toLowerCase().split(/\s+/)) {
          if (setH.has(w)) shared += 2;
        }
      }
      const lenRatio = 1 - Math.min(0.6, Math.abs(nCl.length - nOrig.length) / Math.max(4, nOrig.length));
      const score = shared + lenRatio * 2;
      if (score > bestScore) {
        bestScore = score;
        bestClause = cl;
      }
    }
  }

  const candidate = bestClause || heardClean;
  if (!candidate || normComparison(candidate) === nOrig) return null;

  // Estimate difference type
  const origToks = containsHanzi(origClean) ? Array.from(nOrig) : origClean.toLowerCase().split(/\s+/).filter(Boolean);
  const candToks = containsHanzi(candidate) ? Array.from(normComparison(candidate)) : candidate.toLowerCase().split(/\s+/).filter(Boolean);

  let differenceType: ReformulationDiffType = 'phonetic_mondegreen';
  let differenceSummary = 'Reformulé d’après la prononciation vocale entendue';
  if (lineMatch < 0.25) {
    differenceType = 'semantic_mismatch';
    differenceSummary = 'Paroles chantées différentes du texte d’origine';
  } else if (candToks.length > origToks.length + 1) {
    differenceType = 'missing_words';
    differenceSummary = 'Mots chantés manquants dans le texte original';
  } else if (origToks.length > candToks.length + 1) {
    differenceType = 'extra_words';
    differenceSummary = 'Mots en trop par rapport à la voix chantée';
  }

  const isZh = lang.toLowerCase().startsWith('zh') || containsHanzi(origClean);
  if (isZh && containsHanzi(candidate)) {
    const scriptOrig = detectMandarinScript(origClean);
    const scriptCand = detectMandarinScript(candidate);
    if (scriptOrig !== scriptCand) {
      differenceType = 'script_mismatch';
      differenceSummary = 'Script / homophones alignés sur la voix mandarin';
    }
  }

  // Require reasonable voice confidence before proposing full line rewrite deterministically
  if (avgRecConf < 0.62 && lineMatch >= 0.45) return null;

  return {
    lineIdx: ln.lineIdx,
    originalText: ln.text,
    heardText: candidate,
    reformulatedText: candidate,
    differenceType,
    differenceSummary,
    confidence: +Math.min(0.95, Math.max(0.55, avgRecConf)).toFixed(3),
    start: lineStart,
    end: lineEnd,
    engine: 'whisper+phonetic-reconciler',
  };
}

function detectUnresolvableProblems(
  userLines: ReconcileInputLine[],
  recognizedLines: RecognizedWindow[],
  vocalSegments: Array<{ start: number; end: number }>,
  reformulations: LineReformulation[],
  stretchedLineIndices: number[],
  overallMatchRatio: number,
  durationSec: number,
): UnresolvableProblem[] {
  const problems: UnresolvableProblem[] = [];
  const reformMap = new Map<number, LineReformulation>(reformulations.map(r => [r.lineIdx, r]));
  const stretchedSet = new Set<number>(stretchedLineIndices);
  const nonInterludes = userLines.filter(l => !l.interlude && l.text.trim());

  // 1. Check global offset / partial snippet mismatch (e.g. first 2+ or last 2+ lines completely unanchored while middle aligns)
  if (nonInterludes.length >= 4 && overallMatchRatio > 0.15 && overallMatchRatio < 0.72) {
    const lowStart = nonInterludes.slice(0, 2).every(l => (l.matchRatio ?? 1) < 0.25);
    const lowEnd = nonInterludes.slice(-2).every(l => (l.matchRatio ?? 1) < 0.25);
    if (lowStart || lowEnd) {
      const anchor = lowStart ? nonInterludes[0] : nonInterludes[nonInterludes.length - 1];
      problems.push({
        id: `prob_offset_${anchor.lineIdx}`,
        lineIdx: anchor.lineIdx,
        start: +(Number(anchor.start) || 0).toFixed(3),
        end: +(Number(anchor.end) || 2).toFixed(3),
        severity: 'high',
        category: 'desynced_snippet_offset',
        title: lowStart ? 'Intro ou couplet décalé au début' : 'Fin de paroles hors extrait audio',
        description: lowStart
          ? 'Les premières lignes collées ne correspondent pas au début de la voix dans l’audio (couplet sauté ou intro longue).'
          : 'Les dernières lignes dépassent la portion vocale reconnue dans la piste audio.',
        suggestedFix: 'Vérifiez si votre texte inclut un couplet absent de cet extrait ou appliquez les reformulations IA.',
        actionType: reformMap.has(anchor.lineIdx) ? 'apply_reformulation' : 'seek_inspect',
      });
    }
  }

  // 2. Empty or near-instrumental vocal track
  if (!recognizedLines.length && nonInterludes.length > 0) {
    problems.push({
      id: 'prob_unvoiced_track',
      lineIdx: nonInterludes[0].lineIdx,
      start: 0,
      end: Math.min(durationSec || 5, 5),
      severity: 'high',
      category: 'empty_or_unvoiced',
      title: 'Voix principale très faible ou piste instrumentale',
      description: 'Le modèle vocal n’a pas pu isoler de paroles intelligibles sur cette piste (mix trop dense ou instrumental).',
      suggestedFix: 'Utilisez la dictée micro en direct ou vérifiez que le fichier audio contient bien la piste chantée.',
      actionType: 'mic_dictate',
    });
    return problems;
  }

  // 3. Per-line unresolvable issues
  for (const ln of nonInterludes) {
    const ls = +(Number(ln.start) || 0).toFixed(3);
    const le = +(Math.max(ls + 0.25, Number(ln.end) || ls + 2)).toFixed(3);
    const dur = le - ls;
    const matchR = typeof ln.matchRatio === 'number' ? ln.matchRatio : 1;
    const conf = typeof ln.confidence === 'number' ? ln.confidence : 0.85;
    const flags = Array.isArray(ln.flags) ? ln.flags : [];
    const hasReform = reformMap.has(ln.lineIdx);

    if (stretchedSet.has(ln.lineIdx) || (dur > 7.5 && matchR < 0.35)) {
      problems.push({
        id: `prob_gap_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: 'medium',
        category: 'instrumental_gap_stretch',
        title: `Passage sur pause / instrumental (${dur.toFixed(1)}s)`,
        description: `Ligne #${ln.lineIdx + 1} (« ${ln.text.slice(0, 32)} ») non ancrée dans une zone instrumentale ou silencieuse : risque de dérive rythmique.`,
        suggestedFix: 'Ré-analysez ce segment ou ajustez le point d’entrée à l’oreille.',
        actionType: 'reanalyze_segment',
      });
      continue;
    }

    if (matchR < 0.25) {
      problems.push({
        id: `prob_mismatch_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: 'high',
        category: 'complete_text_audio_mismatch',
        title: `Écart important voix / texte (ligne #${ln.lineIdx + 1})`,
        description: hasReform
          ? `Le texte saisi (« ${ln.text.slice(0, 32)} ») diverge nettement de la voix entendue (« ${reformMap.get(ln.lineIdx)!.reformulatedText.slice(0, 32)} »).`
          : `Impossible de relier de façon fiable la ligne #${ln.lineIdx + 1} à la voix entendue à cet instant.`,
        suggestedFix: hasReform
          ? 'Appliquez la reformulation IA ou ré-écoutez ce passage.'
          : 'Ré-analysez ce segment ou corrigez cette phrase au micro.',
        actionType: hasReform ? 'apply_reformulation' : 'reanalyze_segment',
      });
      continue;
    }

    if (conf < 0.68 || flags.includes('uncertain_boundary') || flags.includes('uncertain_word')) {
      const hasVocalWindow = !vocalSegments.length || vocalSegments.some(vs => vs.end >= ls - 0.5 && vs.start <= le + 0.5);
      problems.push({
        id: `prob_clarity_${ln.lineIdx}`,
        lineIdx: ln.lineIdx,
        start: ls,
        end: le,
        severity: 'medium',
        category: hasVocalWindow ? 'low_vocal_clarity' : 'empty_or_unvoiced',
        title: `Confiance vocale faible sur ligne #${ln.lineIdx + 1}`,
        description: `Articulation masquée par l’accompagnement ou chevauchement de chœurs (indice ${Math.round(conf * 100)}%).`,
        suggestedFix: 'Lancez une ré-analyse ciblée haute précision sur ce segment.',
        actionType: 'reanalyze_segment',
      });
    }
  }

  return problems.slice(0, 24);
}

export async function reconcileAndReformulateLyrics(params: ReconcileParams): Promise<ReconcileResult> {
  const {
    ai = null,
    userLines = [],
    recognizedLines = [],
    vocalSegments = [],
    divergences = [],
    lang = 'auto',
    durationSec = 0,
    matchRatio = 1,
    lineMatchRatios = {},
    stretchedLineIndices = [],
  } = params;

  const enrichedLines: ReconcileInputLine[] = userLines.map(ln => ({
    ...ln,
    matchRatio: typeof ln.matchRatio === 'number'
      ? ln.matchRatio
      : (typeof lineMatchRatios[ln.lineIdx] === 'number' ? lineMatchRatios[ln.lineIdx] : 1),
  }));

  const candidatePairs: Array<{ line: ReconcileInputLine; heardText: string; avgRecConf: number }> = [];
  for (const ln of enrichedLines) {
    if (ln.interlude || !ln.text.trim() || /^\[[^\]]+\]$/.test(ln.text.trim())) continue;
    const { heardText, avgRecConf } = overlappingHeardForLine(ln, recognizedLines, divergences);
    const hasDivergence = divergences.some(d => d.lineIdx === ln.lineIdx && d.type !== 'spelling_fixed');
    const ratio = ln.matchRatio ?? 1;
    const differs = heardText && normComparison(heardText) !== normComparison(ln.text);
    if (differs && (ratio < 0.78 || hasDivergence || (ln.confidence ?? 1) < 0.78)) {
      candidatePairs.push({ line: ln, heardText, avgRecConf });
    }
  }

  let reformulations: LineReformulation[] = [];
  let engineUsed = 'whisper+phonetic-reconciler';

  // Use Gemini 4 Hydrogen for contextual semantic + phonetic lyric reformulation when candidates exist & AI is configured
  if (ai && candidatePairs.length > 0) {
    try {
      const payloadForAi = candidatePairs.slice(0, 30).map(cp => ({
        lineIdx: cp.line.lineIdx,
        originalText: cp.line.text,
        heardByVoiceASR: cp.heardText,
        startSec: +(Number(cp.line.start) || 0).toFixed(2),
        endSec: +(Number(cp.line.end) || 0).toFixed(2),
        matchRatio: +(cp.line.matchRatio ?? 0.5).toFixed(2),
      }));

      const prompt = `You are a bilingual/multilingual expert lyric editor & phonetician (French, English, Mandarin Chinese zh-Hans/zh-Hant, etc.).
Compare each ORIGINAL user lyric line with what was actually HEARD in the vocal track (heardByVoiceASR).
Language hint: ${lang || 'auto'}.

RULES:
1. Reformulate ONLY lines where there is a genuine audible difference, phonetic mondegreen, wrong homophone (e.g. Mandarin Pinyin confusion or French/English spelling error), missing/extra sung words, or phrasing mismatch between originalText and heardByVoiceASR.
2. Keep the authentic language & script of the song (Simplified vs Traditional Chinese, proper French accents & apostrophes, natural English contractions).
3. If originalText and heardByVoiceASR mean practically the same thing or heardByVoiceASR is clearly fragmentary/noisy noise, do NOT output a reformulation for that line.
4. Keep "differenceSummary" very concise (under 10 words, in French unless song language is clearly English or Mandarin, or in clear French studio terms).

Candidate divergent lines:
${JSON.stringify(payloadForAi, null, 2)}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reformulations: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    lineIdx: { type: Type.INTEGER },
                    reformulatedText: { type: Type.STRING },
                    differenceType: { type: Type.STRING },
                    differenceSummary: { type: Type.STRING },
                    confidence: { type: Type.NUMBER },
                  },
                  required: ['lineIdx', 'reformulatedText', 'differenceType', 'differenceSummary'],
                },
              },
            },
            required: ['reformulations'],
          },
        },
      });

      const parsed = JSON.parse(response.text || '{}');
      const items = Array.isArray(parsed?.reformulations) ? parsed.reformulations : [];
      const cpMap = new Map(candidatePairs.map(cp => [cp.line.lineIdx, cp]));

      for (const item of items) {
        const cp = cpMap.get(Number(item?.lineIdx));
        const nextTxt = String(item?.reformulatedText || '').trim();
        if (!cp || !nextTxt || normComparison(nextTxt) === normComparison(cp.line.text)) continue;
        const ls = +(Number(cp.line.start) || 0).toFixed(3);
        const le = +(Math.max(ls + 0.3, Number(cp.line.end) || ls + 2.5)).toFixed(3);
        const validTypes: ReformulationDiffType[] = [
          'orthography',
          'phonetic_mondegreen',
          'missing_words',
          'extra_words',
          'semantic_mismatch',
          'script_mismatch',
        ];
        const dType = validTypes.includes(item.differenceType) ? item.differenceType : 'semantic_mismatch';
        reformulations.push({
          lineIdx: cp.line.lineIdx,
          originalText: cp.line.text,
          heardText: cp.heardText,
          reformulatedText: nextTxt,
          differenceType: dType,
          differenceSummary: String(item.differenceSummary || 'Reformulation IA d’après la voix').slice(0, 140),
          confidence: +Math.min(0.97, Math.max(0.55, Number(item.confidence) || 0.86)).toFixed(3),
          start: ls,
          end: le,
          engine: 'gemini-4-hydrogen',
        });
      }
      engineUsed = 'gemini-4-hydrogen+whisper';
    } catch {
      // Fall back cleanly to deterministic phonetic reconciliation below
      reformulations = [];
    }
  }

  if (!reformulations.length && candidatePairs.length > 0) {
    for (const cp of candidatePairs) {
      const det = buildDeterministicReformulation(cp.line, cp.heardText, cp.avgRecConf, lang);
      if (det) reformulations.push(det);
    }
  }

  const unresolvableProblems = detectUnresolvableProblems(
    enrichedLines,
    recognizedLines,
    vocalSegments,
    reformulations,
    stretchedLineIndices,
    matchRatio,
    durationSec,
  );

  const nonInterludeTotal = enrichedLines.filter(l => !l.interlude && l.text.trim()).length;
  const alignedLines = enrichedLines.filter(l => !l.interlude && l.text.trim() && (l.matchRatio ?? 1) >= 0.45).length;
  const divergentLines = candidatePairs.length;
  const overallQuality = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (matchRatio * 75) +
        ((nonInterludeTotal ? alignedLines / nonInterludeTotal : 1) * 25) -
        (unresolvableProblems.filter(p => p.severity === 'high').length * 6),
      ),
    ),
  );

  return {
    success: true,
    engineUsed,
    reformulations,
    unresolvableProblems,
    summary: {
      totalLines: nonInterludeTotal,
      alignedLines,
      divergentLines,
      reformulatedCount: reformulations.length,
      unresolvableCount: unresolvableProblems.length,
      overallQuality,
      engineUsed,
    },
  };
}
