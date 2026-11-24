import { initializeApp } from 'firebase/app';
import {
  getAuth,
  initializeAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  setPersistence,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  enableNetwork,
  doc,
  getDocFromServer,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  type Firestore,
  type FirestoreSettings,
  type Unsubscribe,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Strict Error Handling Types (matching references/error-handling-and-sdk.md)
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Initialize Firebase App & Named Firestore Database
// Force XHR long-polling in browsers to avoid WebChannel fetch-stream stalls behind proxies/iframes
const app = initializeApp(firebaseConfig);
function createFirestoreClient(): Firestore {
  if (typeof window !== 'undefined') {
    try {
      const settings = Object.assign(
        {
          experimentalForceLongPolling: true,
          ignoreUndefinedProperties: true,
        } as FirestoreSettings,
        { useFetchStreams: false }
      );
      return initializeFirestore(app, settings, firebaseConfig.firestoreDatabaseId);
    } catch {
      // Fallback if Firestore was already initialized on this app instance
    }
  }
  return getFirestore(app, firebaseConfig.firestoreDatabaseId);
}
function createAuthClient(): Auth {
  if (typeof window !== 'undefined') {
    try {
      return initializeAuth(app, {
        persistence: [
          indexedDBLocalPersistence,
          browserLocalPersistence,
          browserSessionPersistence,
          inMemoryPersistence,
        ],
        popupRedirectResolver: browserPopupRedirectResolver,
      });
    } catch {
      // Fallback if Auth was already initialized on this app instance
    }
  }
  return getAuth(app);
}
export const db = createFirestoreClient();
export const auth = createAuthClient();

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const user = auth.currentUser;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: user?.uid ?? null,
      email: user?.email ?? null,
      emailVerified: user?.emailVerified ?? null,
      isAnonymous: user?.isAnonymous ?? null,
      tenantId: user?.tenantId ?? null,
      providerInfo:
        user?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Startup connectivity test (getDocFromServer)
export async function testConnection(): Promise<{ ok: boolean; offline?: boolean }> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return { ok: true };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('the client is offline')) {
      try {
        await enableNetwork(db);
        await getDocFromServer(doc(db, 'test', 'connection'));
        return { ok: true };
      } catch (retryErr) {
        const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
        if (retryMsg.includes('the client is offline')) {
          console.error('Please check your Firebase configuration.');
          return { ok: false, offline: true };
        }
        return { ok: true };
      }
    }
    // Permission denied before sign-in still confirms network reachability
    return { ok: true };
  }
}

testConnection();

// Blueprint Volumetric Limits & Sanitization Helpers
const CHUNK_CHAR_LIMIT = 420000;
const MAX_CHUNKS = 64;

function sanitizeId(raw: string, fallback = 'song_default'): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 120);
  return cleaned || fallback;
}

function clampStr(raw: unknown, maxLen: number): string {
  return String(raw ?? '').slice(0, maxLen);
}

// Strip undefined/functions/NaN cleanly so Firestore native Maps never reject payload
function toFirestoreClean(value: unknown, depth = 0): unknown {
  if (depth > 14) return null;
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') return value.slice(0, 60000);
  if (Array.isArray(value)) {
    return value.slice(0, 2000).map((item) => toFirestoreClean(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
      const cleanKey = String(k).slice(0, 128);
      if (!cleanKey) continue;
      out[cleanKey] = toFirestoreClean(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    parts.push(String.fromCharCode.apply(null, Array.from(slice)));
  }
  return btoa(parts.join(''));
}

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export interface VercelConfig {
  projectName: string;
  appUrl: string;
  deployHookUrl: string;
  autoSync: boolean;
  lastSyncedAt?: string;
  lastDeployedAt?: string;
}

export interface SongSaveInput {
  songId?: string;
  title?: string;
  artist?: string;
  lyrics?: string;
  lang?: string;
  audioName?: string;
  audioMime?: string;
  audioSize?: number;
  duration?: number;
  bpm?: number;
  vercelSyncedUrl?: string;
  project: Record<string, unknown>;
}

export interface FormattedAuthError {
  code: string;
  message: string;
  canRetryRedirect: boolean;
  shouldOpenNewTab: boolean;
  isCancelled: boolean;
}

function extractAuthErrorCode(err: unknown): string {
  if (!err || typeof err !== 'object') {
    const s = String(err || '');
    if (s.includes('AUTH_EMAIL_NOT_VERIFIED')) return 'auth/email-not-verified';
    if (s.includes('AUTH_REQUIRED')) return 'auth/required';
    if (s.includes('access_denied')) return 'auth/access-denied';
    return '';
  }
  const code = String((err as { code?: unknown }).code || '').trim();
  if (code) return code;
  const msg = String((err as { message?: unknown }).message || '');
  const m = msg.match(/\((auth\/[a-z0-9-]+)\)/i);
  if (m) return m[1].toLowerCase();
  if (msg.includes('AUTH_EMAIL_NOT_VERIFIED')) return 'auth/email-not-verified';
  if (msg.includes('AUTH_REQUIRED')) return 'auth/required';
  if (msg.toLowerCase().includes('access_denied')) return 'auth/access-denied';
  if (msg.toLowerCase().includes('missing or insufficient permissions')) return 'firestore/permission-denied';
  if (msg.toLowerCase().includes('the client is offline')) return 'firestore/offline';
  return '';
}

function isEmbeddedIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function formatAuthError(err: unknown, lang = 'fr'): FormattedAuthError {
  const l = String(lang || 'fr').toLowerCase().startsWith('en')
    ? 'en'
    : String(lang || 'fr').toLowerCase().startsWith('ja')
      ? 'ja'
      : 'fr';
  const code = extractAuthErrorCode(err);
  let rawMsg = err instanceof Error ? err.message : String(err || '');
  try {
    const parsed = JSON.parse(rawMsg);
    if (parsed && parsed.error) {
      rawMsg = `${parsed.error}${parsed.path ? ` (${parsed.path})` : ''}`;
    }
  } catch {
    // Keep raw message when not JSON
  }

  const host = typeof window !== 'undefined' ? window.location.hostname : '';
  const inIframe = isEmbeddedIframe();

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return {
      code,
      isCancelled: true,
      canRetryRedirect: false,
      shouldOpenNewTab: false,
      message:
        l === 'en'
          ? 'Google sign-in window was closed before completing login.'
          : l === 'ja'
            ? 'ログイン完了前に Google ウィンドウが閉じられました。'
            : 'La fenêtre de connexion Google a été fermée avant la fin de l’authentification.',
    };
  }

  if (
    code === 'auth/popup-blocked' ||
    code === 'auth/popup-blocked-iframe' ||
    code === 'auth/operation-not-supported-in-this-environment'
  ) {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: !inIframe,
      shouldOpenNewTab: inIframe,
      message:
        l === 'en'
          ? inIframe
            ? 'Popup blocked inside preview frame. Allow popups for this site or open Alexura in a new tab to sign in with any Google account.'
            : 'Popup blocked by your browser. Allow popups or use Redirect Sign-In below.'
          : l === 'ja'
            ? inIframe
              ? 'プレビュー枠内でポップアップがブロックされました。ポップアップを許可するか、新しいタブで開いて Google ログインしてください。'
              : 'ブラウザがポップアップをブロックしました。ポップアップを許可するか、リダイレクトログインをお試しください。'
            : inIframe
              ? 'La fenêtre Google a été bloquée dans le cadre d’aperçu. Autorisez les pop-ups pour ce site ou ouvrez Alexura dans un nouvel onglet pour connecter n’importe quel compte Google.'
              : 'La fenêtre pop-up a été bloquée par votre navigateur. Autorisez les pop-ups ou utilisez la connexion par redirection ci-dessous.',
    };
  }

  if (code === 'auth/unauthorized-domain') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: false,
      shouldOpenNewTab: false,
      message:
        l === 'en'
          ? `Domain "${host}" is not authorized in Firebase Authentication > Settings > Authorized domains.`
          : l === 'ja'
            ? `ドメイン「${host}」が Firebase Authentication の承認済みドメインに登録されていません。`
            : `Le domaine « ${host} » n’est pas encore autorisé dans Firebase Authentication (Paramètres > Domaines autorisés).`,
    };
  }

  if (code === 'auth/web-storage-unsupported') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: false,
      shouldOpenNewTab: inIframe,
      message:
        l === 'en'
          ? 'Browser storage/cookies are blocked (third-party cookie restriction or strict private mode). Open Alexura in a new normal browser tab.'
          : l === 'ja'
            ? 'ブラウザのストレージ／Cookieがブロックされています。通常の新しいタブで開いてお試しください。'
            : 'Le stockage ou les cookies tiers sont bloqués par le navigateur. Ouvrez Alexura dans un nouvel onglet normal pour vous connecter.',
    };
  }

  if (code === 'auth/email-not-verified') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: false,
      shouldOpenNewTab: false,
      message:
        l === 'en'
          ? 'This Google account email is not marked as verified yet. Verify the email in your Google account security settings to unlock cloud saves.'
          : l === 'ja'
            ? 'この Google アカウントのメールが未確認のためクラウド保存できません。Google アカウント側でメール確認を完了してください。'
            : 'L’adresse e-mail de ce compte Google n’est pas encore vérifiée. Validez votre e-mail Google pour enregistrer sur Firebase.',
    };
  }

  if (code === 'auth/access-denied' || code === 'auth/operation-not-allowed' || code === 'auth/internal-error') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: !inIframe && code === 'auth/internal-error',
      shouldOpenNewTab: inIframe,
      message:
        l === 'en'
          ? 'Google OAuth refused sign-in for this account. If external accounts are blocked (403 access_denied), set the Google Cloud OAuth Consent Screen from "Testing" to "In Production" (or add the account as a Test User).'
          : l === 'ja'
            ? 'このアカウントの Google OAuth ログインが拒否されました。他のアカウントが 403 access_denied で弾かれる場合は、Google Cloud の OAuth 同意画面を「テスト」から「本番（公開）」へ切り替えてください。'
            : 'Google OAuth a refusé la connexion pour ce compte. Si les autres comptes sont bloqués (erreur 403 access_denied), passez l’écran de consentement OAuth Google Cloud de « En phase de test » à « En production » (ou ajoutez le joueur en testeur).',
    };
  }

  if (code === 'auth/network-request-failed' || code === 'firestore/offline') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: false,
      shouldOpenNewTab: false,
      message:
        l === 'en'
          ? 'Network connection to Google/Firebase failed. Check your internet connection or VPN and retry.'
          : l === 'ja'
            ? 'Google / Firebase への接続に失敗しました。ネットワーク接続を確認して再試行してください。'
            : 'Impossible de joindre Google / Firebase. Vérifiez votre connexion Internet (ou bloqueur/VPN) puis réessayez.',
    };
  }

  if (code === 'firestore/permission-denied') {
    return {
      code,
      isCancelled: false,
      canRetryRedirect: false,
      shouldOpenNewTab: false,
      message:
        l === 'en'
          ? `Firestore permission denied (${rawMsg}). Verify you are signed in with a verified Google account.`
          : l === 'ja'
            ? `Firestore の権限エラー (${rawMsg})。Google ログイン状態をご確認ください。`
            : `Accès Firestore refusé (${rawMsg}). Reconnectez votre compte Google puis réessayez.`,
    };
  }

  return {
    code: code || 'auth/unknown',
    isCancelled: false,
    canRetryRedirect: false,
    shouldOpenNewTab: false,
    message: rawMsg || (l === 'en' ? 'Google authentication error.' : 'Erreur lors de l’authentification Google.'),
  };
}

const beforeAuthChangeListeners = new Set<() => void>();
const authErrorListeners = new Set<(err: Error) => void>();
let authInFlight: Promise<User> | null = null;

export function subscribeBeforeAuthChange(cb: () => void): Unsubscribe {
  beforeAuthChangeListeners.add(cb);
  return () => {
    beforeAuthChangeListeners.delete(cb);
  };
}

export function subscribeAuthError(cb: (err: Error) => void): Unsubscribe {
  authErrorListeners.add(cb);
  return () => {
    authErrorListeners.delete(cb);
  };
}

function notifyBeforeAuthChange(): void {
  for (const cb of beforeAuthChangeListeners) {
    try {
      cb();
    } catch {
      // Ignore listener teardown errors
    }
  }
}

function notifyAuthError(err: Error): void {
  for (const cb of authErrorListeners) {
    try {
      cb(err);
    } catch {
      // Ignore listener notification errors
    }
  }
}

function buildGoogleProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope('email');
  provider.addScope('profile');
  provider.setCustomParameters({ prompt: 'select_account' });
  return provider;
}

async function ensureAuthPersistence(): Promise<void> {
  const candidates = [
    indexedDBLocalPersistence,
    browserLocalPersistence,
    browserSessionPersistence,
    inMemoryPersistence,
  ];
  for (const p of candidates) {
    try {
      await setPersistence(auth, p);
      return;
    } catch {
      // Try next less-restrictive persistence tier
    }
  }
}

async function ensureUserProfile(user: User, throwOnError = true): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const writeProfile = async () => {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        displayName: clampStr(user.displayName || user.email || 'Creator', 160),
        email: clampStr(user.email || '', 254),
        photoURL: clampStr(user.photoURL || '', 500),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        uid: user.uid,
        displayName: clampStr(user.displayName || user.email || 'Creator', 160),
        email: clampStr(user.email || '', 254),
        photoURL: clampStr(user.photoURL || '', 500),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  };

  try {
    await writeProfile();
  } catch (firstErr) {
    const firstMsg = firstErr instanceof Error ? firstErr.message : String(firstErr);
    if (
      firstMsg.includes('offline') ||
      firstMsg.includes('unavailable') ||
      firstMsg.includes('Missing or insufficient permissions')
    ) {
      try {
        await user.getIdToken(true).catch(() => {});
        await enableNetwork(db).catch(() => {});
        await new Promise((r) => setTimeout(r, 240));
        await writeProfile();
        return;
      } catch (retryErr) {
        if (!throwOnError) {
          console.warn('User profile sync deferred after login:', retryErr);
          return;
        }
        handleFirestoreError(retryErr, OperationType.WRITE, path);
      }
    }
    if (!throwOnError) {
      console.warn('User profile sync deferred after login:', firstErr);
      return;
    }
    handleFirestoreError(firstErr, OperationType.WRITE, path);
  }
}

async function finalizeAuthenticatedUser(user: User): Promise<User> {
  try {
    await user.reload();
  } catch {
    // Non-fatal if user reload skips offline
  }
  try {
    await user.getIdToken(true);
  } catch {
    // Non-fatal token refresh guard
  }
  if (user.emailVerified === false) {
    throw new Error('AUTH_EMAIL_NOT_VERIFIED');
  }
  // Keep login resilient even if initial cold profile write hits offline lag
  await ensureUserProfile(user, false);
  return user;
}

if (typeof window !== 'undefined') {
  getRedirectResult(auth, browserPopupRedirectResolver)
    .then(async (cred) => {
      if (cred?.user) {
        await finalizeAuthenticatedUser(cred.user);
      }
    })
    .catch((err) => {
      const code = extractAuthErrorCode(err);
      if (code && code !== 'auth/no-current-user') {
        notifyAuthError(err instanceof Error ? err : new Error(String(err)));
      }
    });
}

export async function signInGoogleRedirect(): Promise<void> {
  await ensureAuthPersistence();
  if (auth.currentUser) {
    notifyBeforeAuthChange();
  }
  const provider = buildGoogleProvider();
  await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
}

export async function signInGoogle(_options?: { forceAccountSelect?: boolean; preferRedirect?: boolean }): Promise<User> {
  if (authInFlight) {
    return authInFlight;
  }
  const run = async (): Promise<User> => {
    await ensureAuthPersistence();
    if (_options?.preferRedirect && !isEmbeddedIframe()) {
      await signInGoogleRedirect();
      // signInWithRedirect navigates away; keep type contract satisfied if mocked
      if (auth.currentUser) return auth.currentUser;
      throw new Error('AUTH_REDIRECT_STARTED');
    }

    const hadUser = Boolean(auth.currentUser);
    if (hadUser) {
      // Unsubscribe previous account's Firestore snapshot queries cleanly BEFORE swapping Firebase Auth UID
      notifyBeforeAuthChange();
    }

    const provider = buildGoogleProvider();
    try {
      const cred = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      return await finalizeAuthenticatedUser(cred.user);
    } catch (err) {
      const code = extractAuthErrorCode(err);
      if (
        (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') &&
        !isEmbeddedIframe()
      ) {
        await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
        throw new Error('AUTH_REDIRECT_STARTED');
      }
      if (code === 'auth/popup-blocked' && isEmbeddedIframe()) {
        const e = new Error('auth/popup-blocked-iframe') as Error & { code?: string };
        e.code = 'auth/popup-blocked-iframe';
        throw e;
      }
      throw err;
    }
  };

  authInFlight = run().finally(() => {
    authInFlight = null;
  });
  return authInFlight;
}

export async function switchAccountGoogle(): Promise<User> {
  return signInGoogle({ forceAccountSelect: true });
}

export async function signOutGoogle(): Promise<void> {
  notifyBeforeAuthChange();
  await signOut(auth);
}

export async function saveSongToCloud(
  input: SongSaveInput,
  audioFile?: File | Blob | null
): Promise<{ songId: string; chunkCount: number; audioSaved: boolean; audioTooLarge?: boolean }> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const isNewSongId = !input.songId;
  const rawSlug = String(input.title || input.audioName || 'track')
    .toLowerCase()
    .replace(/[^a-zA-Z0-9-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60) || 'track';
  let songId = sanitizeId(
    input.songId || `song_${rawSlug}_${Date.now().toString(36)}`
  );
  let path = `songs/${songId}`;
  let songRef = doc(db, 'songs', songId);

  let audioChunks: string[] = [];
  let audioTooLarge = false;
  const rawAudioSize = audioFile ? Number(audioFile.size || 0) : Number(input.audioSize || 0);
  const safeAudioMime = clampStr(
    (audioFile && 'type' in audioFile && audioFile.type) || input.audioMime || 'audio/mpeg',
    100
  );

  if (audioFile && rawAudioSize > 0) {
    const estimatedB64Len = Math.ceil((rawAudioSize * 4) / 3);
    if (estimatedB64Len <= CHUNK_CHAR_LIMIT * MAX_CHUNKS) {
      const buf = await audioFile.arrayBuffer();
      const b64 = arrayBufferToBase64(buf);
      for (let i = 0; i < b64.length; i += CHUNK_CHAR_LIMIT) {
        audioChunks.push(b64.slice(i, i + CHUNK_CHAR_LIMIT));
      }
      if (audioChunks.length > MAX_CHUNKS) {
        audioChunks = [];
        audioTooLarge = true;
      }
    } else {
      audioTooLarge = true;
    }
  }

  let existingCreatedAt: unknown = null;
  let prevChunkCount = 0;
  if (!isNewSongId) {
    try {
      const existingSnap = await getDoc(songRef);
      if (existingSnap.exists()) {
        const ed = existingSnap.data();
        if (ed.ownerId && ed.ownerId !== user.uid) {
          songId = sanitizeId(`song_${rawSlug}_${Date.now().toString(36)}`);
          path = `songs/${songId}`;
          songRef = doc(db, 'songs', songId);
        } else {
          existingCreatedAt = ed.createdAt || null;
          prevChunkCount = Number(ed.chunkCount || 0);
        }
      }
    } catch {
      // Stale ID owned by another account: fork cleanly into a fresh song document for the signed-in user
      songId = sanitizeId(`song_${rawSlug}_${Date.now().toString(36)}`);
      path = `songs/${songId}`;
      songRef = doc(db, 'songs', songId);
    }
  }

  const finalChunkCount = audioChunks.length > 0 ? audioChunks.length : prevChunkCount;
  const hasAudioChunks = finalChunkCount > 0;
  const cleanProject = toFirestoreClean(input.project || {}) as Record<string, unknown>;

  // Guard against Firestore 1 MiB document size ceiling on large word/char-level projects
  const estimateBytes = (val: unknown): number => {
    try {
      const json = JSON.stringify(val);
      return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length * 2;
    } catch {
      return 0;
    }
  };
  if (estimateBytes(cleanProject) > 850000 && cleanProject.timing && typeof cleanProject.timing === 'object') {
    const timing = { ...(cleanProject.timing as Record<string, unknown>) };
    delete timing.charTimings;
    delete timing.debugFrames;
    delete timing.phonemeFrames;
    if (timing.wordTimes && typeof timing.wordTimes === 'object') {
      const compactWords: Record<string, unknown> = {};
      for (const [k, arr] of Object.entries(timing.wordTimes as Record<string, unknown>)) {
        if (Array.isArray(arr)) {
          compactWords[k] = arr.map((w: unknown) => {
            if (!w || typeof w !== 'object') return w;
            const wo = w as Record<string, unknown>;
            return { text: wo.text, start: wo.start, end: wo.end };
          });
        }
      }
      timing.wordTimes = compactWords;
    }
    cleanProject.timing = timing;
  }

  const songPayload: Record<string, unknown> = {
    songId,
    ownerId: user.uid,
    title: clampStr(input.title || 'Sans titre', 200),
    artist: clampStr(input.artist || '', 200),
    lyrics: clampStr(input.lyrics || '', 60000),
    lang: clampStr(input.lang || 'auto', 32),
    audioName: clampStr(
      (audioFile && 'name' in audioFile && (audioFile as File).name) || input.audioName || '',
      260
    ),
    audioMime: safeAudioMime,
    audioSize: Math.max(0, Math.min(104857600, Math.round(rawAudioSize || 0))),
    duration: Math.max(0, Math.min(7200, Number(input.duration) || 0)),
    bpm: Math.max(0, Math.min(400, Number(input.bpm) || 0)),
    hasAudioChunks,
    chunkCount: Math.max(0, Math.min(MAX_CHUNKS, finalChunkCount)),
    project: cleanProject,
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.vercelSyncedUrl) {
    songPayload.vercelSyncedUrl = clampStr(input.vercelSyncedUrl, 500);
  }

  try {
    await setDoc(songRef, songPayload);
  } catch (error) {
    handleFirestoreError(error, existingCreatedAt ? OperationType.UPDATE : OperationType.CREATE, path);
  }

  // Write audio chunks after parent document exists (Master Gate security compliance)
  if (audioChunks.length > 0) {
    for (let idx = 0; idx < audioChunks.length; idx++) {
      const chunkId = `c_${idx}`;
      const cPath = `${path}/audioChunks/${chunkId}`;
      const cRef = doc(db, 'songs', songId, 'audioChunks', chunkId);
      let chunkCreatedAt: unknown = null;
      if (existingCreatedAt && idx < prevChunkCount) {
        try {
          const prevChunkSnap = await getDoc(cRef);
          if (prevChunkSnap.exists()) chunkCreatedAt = prevChunkSnap.data().createdAt || null;
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, cPath);
        }
      }
      try {
        await setDoc(cRef, {
          chunkId,
          songId,
          ownerId: user.uid,
          index: idx,
          data: audioChunks[idx],
          createdAt: chunkCreatedAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, chunkCreatedAt ? OperationType.UPDATE : OperationType.CREATE, cPath);
      }
    }
    // Remove leftover trailing chunks if replaced by shorter song
    for (let idx = audioChunks.length; idx < prevChunkCount; idx++) {
      const chunkId = `c_${idx}`;
      const cPath = `${path}/audioChunks/${chunkId}`;
      try {
        await deleteDoc(doc(db, 'songs', songId, 'audioChunks', chunkId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, cPath);
      }
    }
  }

  return {
    songId,
    chunkCount: finalChunkCount,
    audioSaved: audioChunks.length > 0,
    audioTooLarge,
  };
}

export async function loadSongFromCloud(songId: string): Promise<{
  song: Record<string, unknown>;
  audioFile: File | null;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const cleanId = sanitizeId(songId);
  const path = `songs/${cleanId}`;
  const songRef = doc(db, 'songs', cleanId);
  let songData: Record<string, unknown> | null = null;
  try {
    const snap = await getDoc(songRef);
    if (!snap.exists()) throw new Error('SONG_NOT_FOUND');
    songData = snap.data() as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message === 'SONG_NOT_FOUND') throw error;
    handleFirestoreError(error, OperationType.GET, path);
  }

  let audioFile: File | null = null;
  if (songData && songData.hasAudioChunks && Number(songData.chunkCount || 0) > 0) {
    const chunksPath = `${path}/audioChunks`;
    try {
      const q = query(
        collection(db, 'songs', cleanId, 'audioChunks'),
        where('ownerId', '==', user.uid),
        where('songId', '==', cleanId)
      );
      const qSnap = await getDocs(q);
      const list = qSnap.docs
        .map((d) => d.data() as { index: number; data: string })
        .sort((a, b) => a.index - b.index);
      if (list.length > 0) {
        const b64 = list.map((c) => c.data).join('');
        const bytes = base64ToUint8Array(b64);
        const name = String(songData.audioName || `${songData.title || 'song'}.mp3`);
        const mime = String(songData.audioMime || 'audio/mpeg');
        const ab = new ArrayBuffer(bytes.byteLength);
        new Uint8Array(ab).set(bytes);
        audioFile = new File([ab], name, { type: mime });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, chunksPath);
    }
  }

  return { song: songData!, audioFile };
}

export async function deleteSongFromCloud(songId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');

  const cleanId = sanitizeId(songId);
  const path = `songs/${cleanId}`;
  const chunksPath = `${path}/audioChunks`;
  try {
    const q = query(
      collection(db, 'songs', cleanId, 'audioChunks'),
      where('ownerId', '==', user.uid),
      where('songId', '==', cleanId)
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, chunksPath);
  }

  try {
    await deleteDoc(doc(db, 'songs', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeUserSongs(
  onUpdate: (songs: Record<string, unknown>[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const user = auth.currentUser;
  if (!user) return () => {};
  const path = 'songs';
  const q = query(collection(db, 'songs'), where('ownerId', '==', user.uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Record<string, unknown>[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return { ...data, id: d.id };
      });
      items.sort((a, b) => {
        const ta = (a.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
        const tb = (b.updatedAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
        return tb - ta;
      });
      onUpdate(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    }
  );
}

export async function saveVercelConfig(cfg: VercelConfig): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const path = `users/${user.uid}/integrations/vercel`;
  const ref = doc(db, 'users', user.uid, 'integrations', 'vercel');
  let createdAtVal: unknown = null;
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) createdAtVal = snap.data().createdAt || null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  const payload: Record<string, unknown> = {
    ownerId: user.uid,
    projectName: clampStr(cfg.projectName || 'alexura', 120),
    appUrl: clampStr(cfg.appUrl || '', 500),
    deployHookUrl: clampStr(cfg.deployHookUrl || '', 500),
    autoSync: Boolean(cfg.autoSync),
    lastSyncedAt: clampStr(cfg.lastSyncedAt || '', 64),
    lastDeployedAt: clampStr(cfg.lastDeployedAt || '', 64),
    createdAt: createdAtVal || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  try {
    await setDoc(ref, payload);
  } catch (error) {
    handleFirestoreError(error, createdAtVal ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function loadVercelConfig(): Promise<VercelConfig | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const path = `users/${user.uid}/integrations/vercel`;
  try {
    const snap = await getDoc(doc(db, 'users', user.uid, 'integrations', 'vercel'));
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      projectName: String(d.projectName || 'alexura'),
      appUrl: String(d.appUrl || ''),
      deployHookUrl: String(d.deployHookUrl || ''),
      autoSync: Boolean(d.autoSync),
      lastSyncedAt: String(d.lastSyncedAt || ''),
      lastDeployedAt: String(d.lastDeployedAt || ''),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export interface WorkHistoryInput {
  action: string;
  category?: string;
  songId?: string;
  songTitle?: string;
  artist?: string;
  details?: string;
}

export async function logWorkHistory(input: WorkHistoryInput): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  const historyId = sanitizeId(
    `hist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    `hist_${Date.now().toString(36)}`
  );
  const path = `users/${user.uid}/history/${historyId}`;
  const payload: Record<string, unknown> = {
    historyId,
    ownerId: user.uid,
    action: clampStr(input.action || 'work', 48),
    category: clampStr(input.category || 'save', 32),
    songId: input.songId ? sanitizeId(input.songId, '') : '',
    songTitle: clampStr(input.songTitle || 'Sans titre', 200),
    artist: clampStr(input.artist || '', 200),
    details: clampStr(input.details || '', 500),
    createdAt: serverTimestamp(),
  };
  try {
    await setDoc(doc(db, 'users', user.uid, 'history', historyId), payload);
    return historyId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeWorkHistory(
  onUpdate: (entries: Record<string, unknown>[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const user = auth.currentUser;
  if (!user) return () => {};
  const path = `users/${user.uid}/history`;
  const q = query(collection(db, 'users', user.uid, 'history'), where('ownerId', '==', user.uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const items: Record<string, unknown>[] = snapshot.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return { ...data, id: d.id };
      });
      items.sort((a, b) => {
        const ta = (a.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
        const tb = (b.createdAt as { toMillis?: () => number } | undefined)?.toMillis?.() || 0;
        return tb - ta;
      });
      onUpdate(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        if (onError) onError(wrapped);
      }
    }
  );
}

export async function deleteHistoryEntry(historyId: string): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const cleanId = sanitizeId(historyId, '');
  if (!cleanId) return;
  const path = `users/${user.uid}/history/${cleanId}`;
  try {
    await deleteDoc(doc(db, 'users', user.uid, 'history', cleanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function clearWorkHistory(): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const path = `users/${user.uid}/history`;
  try {
    const q = query(collection(db, 'users', user.uid, 'history'), where('ownerId', '==', user.uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export interface TimestampSnapshotInput {
  songId: string;
  versionId?: string;
  uploadId?: string;
  language?: string;
  provenanceSummary: string;
  validationSummary?: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
}

export async function saveTimestampSnapshot(input: TimestampSnapshotInput): Promise<{ versionId: string }> {
  const user = auth.currentUser;
  if (!user) throw new Error('AUTH_REQUIRED');
  const songId = sanitizeId(input.songId);
  const versionId = sanitizeId(input.versionId || `v_${Date.now().toString(36)}`, 'v_1').slice(0, 64);
  const path = `songs/${songId}/timestampVersions/${versionId}`;
  const ref = doc(db, 'songs', songId, 'timestampVersions', versionId);

  const cleanLines = (Array.isArray(input.lines) ? input.lines.slice(0, 1000) : []).map((ln) =>
    toFirestoreClean(ln)
  );
  const wordCount = cleanLines.reduce((acc: number, ln: unknown) => {
    const words = (ln as { words?: unknown[] })?.words;
    return acc + (Array.isArray(words) ? words.length : 0);
  }, 0);

  let existingCreatedAt: unknown = null;
  try {
    const prevSnap = await getDoc(ref);
    if (prevSnap.exists()) existingCreatedAt = prevSnap.data().createdAt || null;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  const payload: Record<string, unknown> = {
    versionId,
    songId,
    ownerId: user.uid,
    language: clampStr(input.language || 'auto', 32),
    provenanceSummary: clampStr(input.provenanceSummary || 'dsp_acoustic_viterbi', 160),
    lineCount: Math.max(0, Math.min(1000, cleanLines.length)),
    wordCount: Math.max(0, Math.min(20000, wordCount)),
    lines: cleanLines,
    createdAt: existingCreatedAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (input.uploadId) payload.uploadId = sanitizeId(input.uploadId, '').slice(0, 64);
  if (input.validationSummary) {
    payload.validationSummary = toFirestoreClean(input.validationSummary) as Record<string, unknown>;
  }

  try {
    await setDoc(ref, payload);
    return { versionId };
  } catch (error) {
    handleFirestoreError(error, existingCreatedAt ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function listTimestampSnapshots(songId: string): Promise<Record<string, unknown>[]> {
  const user = auth.currentUser;
  if (!user) return [];
  const cleanSongId = sanitizeId(songId);
  const path = `songs/${cleanSongId}/timestampVersions`;
  try {
    const q = query(
      collection(db, 'songs', cleanSongId, 'timestampVersions'),
      where('ownerId', '==', user.uid),
      where('songId', '==', cleanSongId)
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function subscribeAuth(cb: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, cb);
}

// Attach clean global bridge for browser UI integration
const AlexuraCloud = {
  config: {
    projectId: firebaseConfig.projectId,
    firestoreDatabaseId: firebaseConfig.firestoreDatabaseId,
    authDomain: firebaseConfig.authDomain,
  },
  OperationType,
  handleFirestoreError,
  formatAuthError,
  testConnection,
  signInGoogle,
  switchAccountGoogle,
  signInGoogleRedirect,
  signOutGoogle,
  getUser: () => auth.currentUser,
  subscribeAuth,
  subscribeBeforeAuthChange,
  subscribeAuthError,
  subscribeUserSongs,
  subscribeWorkHistory,
  saveSongToCloud,
  loadSongFromCloud,
  deleteSongFromCloud,
  saveTimestampSnapshot,
  listTimestampSnapshots,
  logWorkHistory,
  deleteHistoryEntry,
  clearWorkHistory,
  saveVercelConfig,
  loadVercelConfig,
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).AlexuraCloud = AlexuraCloud;
}

export default AlexuraCloud;
