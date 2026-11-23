import {
  containsHanzi,
  detectMandarinScript,
  fixMandarinCollocationsAndPunctuation,
  evaluateMandarinVoiceRepair,
} from './mandarinTools.ts';

export interface OrthographyChange {
  lineIdx: number;
  wordIdx: number;
  original: string;
  corrected: string;
  source: 'orthography' | 'voice_phonetic' | 'punctuation';
  start?: number;
}

export interface VoiceDivergence {
  lineIdx: number;
  type: 'spelling_fixed' | 'word_replaced_by_voice' | 'missing_from_lyrics' | 'divergent_phrase';
  userText: string;
  heardText: string;
  start: number;
  end: number;
}

export interface PreAnalysisReport {
  originalLines: string[];
  correctedLines: string[];
  correctedText: string;
  changes: OrthographyChange[];
  detectedLanguage: string;
  spellingFixCount: number;
}

const FR_UNAMBIGUOUS_FIXES: Record<string, string> = {
  // Contractions & elisions
  jai: "j'ai",
  taime: "t'aime",
  maime: "m'aime",
  saime: "s'aime",
  laime: "l'aime",
  naime: "n'aime",
  jetaime: "je t'aime",
  cest: "c'est",
  nest: "n'est",
  sest: "s'est",
  quil: "qu'il",
  quils: "qu'ils",
  quon: "qu'on",
  dun: "d'un",
  dune: "d'une",
  aujourdhui: "aujourd'hui",
  jusqua: "jusqu'à",
  lavenir: "l'avenir",
  lamour: "l'amour",
  lespoir: "l'espoir",
  lhistoire: "l'histoire",
  linstant: "l'instant",
  lombre: "l'ombre",
  letoile: "l'étoile",
  lunivers: "l'univers",
  lhorizon: "l'horizon",
  lorizon: "l'horizon",
  parceque: 'parce que',
  parsque: 'parce que',
  biensur: 'bien sûr',
  peutetre: 'peut-être',
  beaucoups: 'beaucoup',
  daccord: "d'accord",
  quelquun: "quelqu'un",
  quelqun: "quelqu'un",
  questce: "qu'est-ce",
  jen: "j'en",
  ten: "t'en",
  sen: "s'en",
  nen: "n'en",
  lenfer: "l'enfer",
  lautre: "l'autre",

  // Ligatures & unambiguous French diacritics / common typos
  coeur: 'cœur',
  coeurs: 'cœurs',
  soeur: 'sœur',
  soeurs: 'sœurs',
  voeu: 'vœu',
  voeux: 'vœux',
  oeuvre: 'œuvre',
  oeuvres: 'œuvres',
  etre: 'être',
  ete: 'été',
  etait: 'était',
  etaient: 'étaient',
  etais: 'étais',
  reves: 'rêves',
  rever: 'rêver',
  revee: 'rêvée',
  reverie: 'rêverie',
  fenetre: 'fenêtre',
  fenetres: 'fenêtres',
  tempete: 'tempête',
  tempetes: 'tempêtes',
  arreter: 'arrêter',
  arrete: 'arrête',
  bientot: 'bientôt',
  plutot: 'plutôt',
  chateau: 'château',
  lumiere: 'lumière',
  lumieres: 'lumières',
  riviere: 'rivière',
  rivieres: 'rivières',
  priere: 'prière',
  prieres: 'prières',
  poussiere: 'poussière',
  premiere: 'première',
  premieres: 'premières',
  derniere: 'dernière',
  dernieres: 'dernières',
  entiere: 'entière',
  entieres: 'entières',
  mystere: 'mystère',
  mysteres: 'mystères',
  planete: 'planète',
  planetes: 'planètes',
  probleme: 'problème',
  problemes: 'problèmes',
  systeme: 'système',
  poeme: 'poème',
  poemes: 'poèmes',
  chaine: 'chaîne',
  chaines: 'chaînes',
  colere: 'colère',
  misere: 'misère',
  galere: 'galère',
  fievre: 'fièvre',
  levre: 'lèvre',
  levres: 'lèvres',
  deja: 'déjà',
  voila: 'voilà',
  etoile: 'étoile',
  etoiles: 'étoiles',
  ephemere: 'éphémère',
  melodie: 'mélodie',
  melodies: 'mélodies',
  poesie: 'poésie',
  verite: 'vérité',
  liberte: 'liberté',
  beaute: 'beauté',
  eternite: 'éternité',
  realite: 'réalité',
  clarte: 'clarté',
  obscurite: 'obscurité',
  fierte: 'fierté',
  pensee: 'pensée',
  pensees: 'pensées',
  annee: 'année',
  annees: 'années',
  soiree: 'soirée',
  soirees: 'soirées',
  journee: 'journée',
  journees: 'journées',
  matinee: 'matinée',
  destinee: 'destinée',
  memoire: 'mémoire',
  memoires: 'mémoires',
  emotion: 'émotion',
  emotions: 'émotions',
  ecrire: 'écrire',
  ecoute: 'écoute',
  ecoutes: 'écoutes',
  ecouter: 'écouter',
  echappe: 'échappe',
  echapper: 'échapper',
  egare: 'égaré',
  egaree: 'égarée',
  efface: 'effacé',
  effacer: 'effacer',
  eclat: 'éclat',
  eclats: 'éclats',
  esperer: 'espérer',
  espere: 'espère',
  esperance: 'espérance',
  eternel: 'éternel',
  eternelle: 'éternelle',
  etincelle: 'étincelle',
  etincelles: 'étincelles',
  eveille: 'éveille',
  eveiller: 'éveiller',
  toujour: 'toujours',
  jamai: 'jamais',
  parol: 'parole',
  parols: 'paroles',
  musike: 'musique',
  musik: 'musique',
  silance: 'silence',
  douceure: 'douceur',
  douleure: 'douleur',
  bonheure: 'bonheur',
  malheure: 'malheur',
  amoure: 'amour',
  soleile: 'soleil',
  magnific: 'magnifique',
  magnifik: 'magnifique',
  incroiab: 'incroyable',
  incroiable: 'incroyable',
  orthografe: 'orthographe',
  ortographe: 'orthographe',
  sincro: 'synchro',
  syncro: 'synchro',
  recois: 'reçois',
  recoit: 'reçoit',
  garcon: 'garçon',
  francais: 'français',
  francaise: 'française',
  ca: 'ça',
  brule: 'brûle',
  bruler: 'brûler',
  derriere: 'derrière',
  reveille: 'réveille',
  reveiller: 'réveiller',
  repond: 'répond',
  reponds: 'réponds',
  reponse: 'réponse',
  desole: 'désolé',
  desolee: 'désolée',
  malgre: 'malgré',
  etrange: 'étrange',
  etranger: 'étranger',
  ecris: 'écris',
  ecrit: 'écrit',
  separe: 'sépare',
  separee: 'séparée',
  dechirer: 'déchirer',
  dechire: 'déchire',
  desir: 'désir',
  desirs: 'désirs',
  tresor: 'trésor',
  tresors: 'trésors',
  celeste: 'céleste',
  legere: 'légère',
  leger: 'léger',
  fidele: 'fidèle',
  connaitre: 'connaître',
  paraitre: 'paraître',
  disparaitre: 'disparaître',
  apparaitre: 'apparaître',
};

// French context-only words (avoid touching valid English words like "mere", "scene", "fate", "creation")
const FR_CONTEXT_ONLY_FIXES: Record<string, string> = {
  reve: 'rêve',
  fete: 'fête',
  fetes: 'fêtes',
  tete: 'tête',
  tetes: 'têtes',
  meme: 'même',
  memes: 'mêmes',
  ame: 'âme',
  ames: 'âmes',
  grace: 'grâce',
  mere: 'mère',
  pere: 'père',
  frere: 'frère',
  freres: 'frères',
  tres: 'très',
  apres: 'après',
  pres: 'près',
  aupres: 'auprès',
  scene: 'scène',
  scenes: 'scènes',
  creation: 'création',
  generation: 'génération',
  foret: 'forêt',
  forets: 'forêts',
  sil: "s'il",
  ny: "n'y",
  ou: 'où',
  desire: 'désire',
  presence: 'présence',
  experience: 'expérience',
  different: 'différent',
  difference: 'différence',
  sincere: 'sincère',
  severe: 'sévère',
  role: 'rôle',
};

const EN_FIXES: Record<string, string> = {
  dont: "don't",
  cant: "can't",
  wont: "won't",
  didnt: "didn't",
  isnt: "isn't",
  arent: "aren't",
  wasnt: "wasn't",
  werent: "weren't",
  wouldnt: "wouldn't",
  couldnt: "couldn't",
  shouldnt: "shouldn't",
  havent: "haven't",
  hasnt: "hasn't",
  youre: "you're",
  youve: "you've",
  youll: "you'll",
  youd: "you'd",
  theyre: "they're",
  theyve: "they've",
  theyll: "they'll",
  thats: "that's",
  whats: "what's",
  wheres: "where's",
  whos: "who's",
  theres: "there's",
  heres: "here's",
  ive: "I've",
  tonite: 'tonight',
  throu: 'through',
  throught: 'thought',
  beutiful: 'beautiful',
  beautifull: 'beautiful',
  forevr: 'forever',
  forver: 'forever',
  togehter: 'together',
  togther: 'together',
  recieve: 'receive',
  beleive: 'believe',
  seperate: 'separate',
  definately: 'definitely',
  untill: 'until',
  teh: 'the',
  adn: 'and',
  becuase: 'because',
  beacuse: 'because',
  becuz: 'because',
  rythm: 'rhythm',
  rythms: 'rhythms',
  melodi: 'melody',
  felo: 'fellow',
  hartbeat: 'heartbeat',
  heartbeatt: 'heartbeat',
  tommorow: 'tomorrow',
  tomorow: 'tomorrow',
  realy: 'really',
  alon: 'alone',
  alwys: 'always',
  doesnt: "doesn't",
  shes: "she's",
  wat: 'what',
  thnk: 'thank',
  thnks: 'thanks',
  freind: 'friend',
  freinds: 'friends',
  thier: 'their',
  wiht: 'with',
  nite: 'night',
  amerika: 'America',
};

const EN_CONTEXT_ONLY_FIXES: Record<string, string> = {
  im: "I'm",
};

function applyCasePattern(template: string, replacement: string): string {
  if (!template) return replacement;
  // Preserve apostrophe lowercase after single-char French/English elision like "J'ai" vs "j'ai"
  const letters = template.replace(/[^A-Za-zÀ-ÿ]/g, '');
  if (letters.length > 1 && letters === letters.toUpperCase()) {
    return replacement.toUpperCase();
  }
  if (/^[A-ZÀ-ÖØ-Þ]/.test(template) && /^[a-zà-öø-ÿ]/.test(replacement)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function looksFrenchLine(line: string, langHint = 'auto'): boolean {
  const h = String(langHint || 'auto').toLowerCase();
  if (h.startsWith('fr')) return true;
  const s = ` ${String(line || '').toLowerCase()} `;
  if (/[éèêëàâçùûüîïôœ]/.test(s)) return true;
  if (/\b(?:je|tu|il|elle|nous|vous|ils|elles|mon|ton|son|ma|ta|sa|mes|tes|ses|le|la|les|un|une|des|dans|avec|pour|sur|sous|sans|mais|comme|quand|tout|tous|est|suis|etre|cest|jai|coeur|lumiere|amour|chanson|voix|nuit|jour|rien|toujours|jamais)\b/.test(s)) {
    return true;
  }
  return false;
}

function looksEnglishLine(line: string, langHint = 'auto'): boolean {
  const h = String(langHint || 'auto').toLowerCase();
  if (h.startsWith('en')) return true;
  const s = ` ${String(line || '').toLowerCase()} `;
  if (/\b(?:i|you|we|they|the|and|with|for|from|this|that|your|my|our|love|night|heart|song|voice|feel|know|never|always|when|where|what|dont|cant|wont|youre|thats|im)\b/.test(s)) {
    return true;
  }
  return false;
}

export function detectLyricsLanguage(lines: string[], hintLang = 'auto'): string {
  const h = String(hintLang || 'auto').trim();
  if (h && h !== 'auto' && h !== 'multi') return h;
  const joined = lines.join('\n');
  if (containsHanzi(joined)) return detectMandarinScript(joined);
  if (/[\u3040-\u30ff]/.test(joined)) return 'ja';
  if (/[\uac00-\ud7af]/.test(joined)) return 'ko';
  const frHits = lines.filter(l => looksFrenchLine(l, 'auto')).length;
  const enHits = lines.filter(l => looksEnglishLine(l, 'auto')).length;
  if (frHits > 0 && enHits > 0 && Math.abs(frHits - enHits) <= 1) return 'multi';
  if (frHits >= enHits && frHits > 0) return 'fr';
  if (enHits > 0) return 'en';
  return 'auto';
}

/* Stage A: Analyze integrated lyrics BEFORE/WITH alignment, detect language & fix spelling/diacritics/contractions */
export function analyzeAndFixOrthography(rawLines: string[], langHint = 'auto'): PreAnalysisReport {
  const originalLines = rawLines.map(l => String(l || ''));
  const detectedLanguage = detectLyricsLanguage(originalLines, langHint);
  const changes: OrthographyChange[] = [];
  const targetZhScript: 'zh-Hans' | 'zh-Hant' | 'auto' =
    langHint === 'zh-Hans' || langHint === 'zh'
      ? 'zh-Hans'
      : langHint === 'zh-Hant'
        ? 'zh-Hant'
        : 'auto';

  const correctedLines = originalLines.map((line, lineIdx) => {
    let trimmed = line.trim();
    if (!trimmed) return '';
    if (/^\[[^\]]+\]$/.test(trimmed)) return trimmed;

    if (containsHanzi(trimmed)) {
      const zhAudit = fixMandarinCollocationsAndPunctuation(trimmed, targetZhScript);
      if (zhAudit.correctedLine !== trimmed) {
        trimmed = zhAudit.correctedLine;
        zhAudit.changes.forEach((zc, zi) => {
          changes.push({
            lineIdx,
            wordIdx: zi,
            original: zc.original,
            corrected: zc.corrected,
            source: zc.source,
          });
        });
      }
    }

    const isFr = looksFrenchLine(trimmed, detectedLanguage);
    const isEn = looksEnglishLine(trimmed, detectedLanguage);

    // Split preserving whitespace & punctuation tokens cleanly
    const parts = trimmed.split(/(\s+)/);
    let wordIdx = 0;

    for (let pi = 0; pi < parts.length; pi++) {
      const part = parts[pi];
      if (!part || /^\s+$/.test(part)) continue;

      const m = part.match(/^([¿¡"«'(\[]*)([A-Za-zÀ-ÿ\u0100-\u024f0-9'’\-]+)([.,!?;:…»"')\]♪♫]*)$/);
      if (!m) {
        wordIdx++;
        continue;
      }
      const [, prefix, core, suffix] = m;
      const lower = core.toLowerCase();

      // Handle apostrophe-less or typo match strictly on alphabetic core
      let fixedCore: string | null = null;
      if (FR_UNAMBIGUOUS_FIXES[lower]) {
        fixedCore = FR_UNAMBIGUOUS_FIXES[lower];
      } else if (isFr && FR_CONTEXT_ONLY_FIXES[lower] && !(lower === 'ou' && !isFr)) {
        // Only change "ou" -> "où" if preceded/followed appropriately? Better keep "ou" untouched to avoid hurting "ou" ("or") vs "où" ("where")!
        if (lower !== 'ou') {
          fixedCore = FR_CONTEXT_ONLY_FIXES[lower];
        }
      } else if (EN_FIXES[lower]) {
        fixedCore = EN_FIXES[lower];
      } else if (isEn && EN_CONTEXT_ONLY_FIXES[lower]) {
        fixedCore = EN_CONTEXT_ONLY_FIXES[lower];
      }

      if (fixedCore && fixedCore.toLowerCase() !== core.toLowerCase()) {
        const cased = applyCasePattern(core, fixedCore);
        const replacement = `${prefix}${cased}${suffix}`;
        if (replacement !== part) {
          parts[pi] = replacement;
          changes.push({
            lineIdx,
            wordIdx,
            original: part,
            corrected: replacement,
            source: 'orthography',
          });
        }
      } else if (fixedCore && fixedCore !== core) {
        // Accent/diacritic fix where `.toLowerCase()` differs (e.g. `lumiere` vs `lumière`, `coeur` vs `cœur`)
        const cased = applyCasePattern(core, fixedCore);
        const replacement = `${prefix}${cased}${suffix}`;
        if (replacement !== part) {
          parts[pi] = replacement;
          changes.push({
            lineIdx,
            wordIdx,
            original: part,
            corrected: replacement,
            source: 'orthography',
          });
        }
      }
      wordIdx++;
    }

    let rebuilt = parts.join('')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\s+([.,])/g, '$1')
      .trim();

    // Capitalize first letter of the line cleanly if line begins with lowercase Latin char
    if (/^[a-zà-öø-ÿ]/.test(rebuilt)) {
      const cap = rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1);
      if (cap !== rebuilt) {
        rebuilt = cap;
      }
    }

    return rebuilt;
  });

  return {
    originalLines,
    correctedLines,
    correctedText: correctedLines.join('\n'),
    changes,
    detectedLanguage,
    spellingFixCount: changes.length,
  };
}

function normAlpha(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g, '');
}

function editDistance(a: string, b: string): number {
  const la = a.length, lb = b.length;
  const dp = Array.from({ length: la + 1 }, (_, i) => i);
  for (let j = 1; j <= lb; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= la; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[la];
}

/* Stage B: Evaluate DTW-paired user word vs neural Whisper vocal word.
   Fixes genuine phonetic typos & corrupted spellings while preserving authentic accented forms & valid words! */
export function evaluateVoiceWordRepair(
  userWordRaw: string,
  voiceWordRaw: string,
  phoneticSim: number,
  voiceRecConf: number,
  langHint = 'auto',
  prevToken = '',
  nextToken = '',
): { shouldReplace: boolean; finalWord: string; reason: 'none' | 'voice_phonetic' } {
  const uCore = String(userWordRaw || '').trim();
  const wRaw = String(voiceWordRaw || '').trim();
  if (!uCore || !wRaw) return { shouldReplace: false, finalWord: uCore, reason: 'none' };

  // Pre-normalize Whisper word through orthography rules too (e.g. if Whisper dropped apostrophe/accent)
  const wOrth = analyzeAndFixOrthography([wRaw], langHint).correctedLines[0] || wRaw;
  const wClean = wOrth.replace(/^[^A-Za-zÀ-ÿ0-9\u4e00-\u9fff]+|[^A-Za-zÀ-ÿ0-9\u4e00-\u9fff'’\-]+$/g, '');
  if (!wClean) return { shouldReplace: false, finalWord: uCore, reason: 'none' };

  const uPunctTail = (uCore.match(/[.,!?;:…，。！？、；：]+$/) || [''])[0];
  const uCoreNoPunct = uPunctTail ? uCore.slice(0, -uPunctTail.length) : uCore;

  // Mandarin Chinese Hanzi voice homophone repair (checks bigram context lexicon before replacing!)
  if (containsHanzi(uCoreNoPunct) && containsHanzi(wClean)) {
    const zhScript: 'zh-Hans' | 'zh-Hant' | 'auto' =
      langHint === 'zh-Hans' || langHint === 'zh'
        ? 'zh-Hans'
        : langHint === 'zh-Hant'
          ? 'zh-Hant'
          : 'auto';
    const zhRep = evaluateMandarinVoiceRepair(uCore, prevToken, nextToken, wClean, voiceRecConf, zhScript);
    if (zhRep.shouldReplace) {
      return { shouldReplace: true, finalWord: zhRep.finalChar, reason: 'voice_phonetic' };
    }
    return { shouldReplace: false, finalWord: uCore, reason: 'none' };
  }

  const nu = normAlpha(uCoreNoPunct);
  const nw = normAlpha(wClean);
  if (!nu || !nw) return { shouldReplace: false, finalWord: uCore, reason: 'none' };

  // Same normalized root (differs only by accents or apostrophes): preserve whichever has accents/apostrophe!
  if (nu === nw) {
    const uHasAccentOrApos = /[À-ÿ'’œæ]/.test(uCoreNoPunct);
    const wHasAccentOrApos = /[À-ÿ'’œæ]/.test(wClean);
    if (!uHasAccentOrApos && wHasAccentOrApos) {
      return {
        shouldReplace: true,
        finalWord: `${applyCasePattern(uCoreNoPunct, wClean)}${uPunctTail}`,
        reason: 'voice_phonetic',
      };
    }
    return { shouldReplace: false, finalWord: uCore, reason: 'none' };
  }

  // Genuine misspelling/phonetic repair: strong voice confidence + close phonetic / edit similarity
  const dist = editDistance(nu, nw);
  const maxLen = Math.max(nu.length, nw.length);
  const closeEdit = (maxLen >= 4 && dist <= 2) || (maxLen >= 7 && dist <= 3);
  const isCjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(nw);

  if (voiceRecConf >= 0.78 && !isCjk && phoneticSim >= 0.72 && closeEdit) {
    // Do not shorten a clearly valid inflected French/English plural/feminine word unless distance looks like a real typo (e.g. "felo" -> "fellow", "magifik" -> "magnifique")
    const onlySuffixDiff =
      (nu.startsWith(nw) && /^(?:s|e|es|ed|er|ing|ly|ent)$/.test(nu.slice(nw.length))) ||
      (nw.startsWith(nu) && /^(?:s|e|es)$/.test(nw.slice(nu.length)) && voiceRecConf < 0.90);
    if (onlySuffixDiff) {
      return { shouldReplace: false, finalWord: uCore, reason: 'none' };
    }
    return {
      shouldReplace: true,
      finalWord: `${applyCasePattern(uCoreNoPunct, wClean)}${uPunctTail}`,
      reason: 'voice_phonetic',
    };
  }

  return { shouldReplace: false, finalWord: uCore, reason: 'none' };
}
