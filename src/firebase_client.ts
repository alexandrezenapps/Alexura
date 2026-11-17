import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDocFromServer,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
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
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
      console.error('Please check your Firebase configuration.');
      return { ok: false, offline: true };
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

async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await setDoc(
        ref,
        {
          uid: user.uid,
          displayName: clampStr(user.displayName || user.email || 'Creator', 160),
          email: clampStr(user.email || '', 254),
          photoURL: clampStr(user.photoURL || '', 500),
          createdAt: snap.data().createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
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
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function signInGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  await ensureUserProfile(cred.user);
  return cred.user;
}

export async function signOutGoogle(): Promise<void> {
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
  const songId = sanitizeId(
    input.songId || `song_${rawSlug}_${Date.now().toString(36)}`
  );
  const path = `songs/${songId}`;
  const songRef = doc(db, 'songs', songId);

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
        existingCreatedAt = ed.createdAt || null;
        prevChunkCount = Number(ed.chunkCount || 0);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }
  }

  const finalChunkCount = audioChunks.length > 0 ? audioChunks.length : prevChunkCount;
  const hasAudioChunks = finalChunkCount > 0;
  const cleanProject = toFirestoreClean(input.project || {}) as Record<string, unknown>;

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
  testConnection,
  signInGoogle,
  signOutGoogle,
  getUser: () => auth.currentUser,
  subscribeAuth,
  subscribeUserSongs,
  subscribeWorkHistory,
  saveSongToCloud,
  loadSongFromCloud,
  deleteSongFromCloud,
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
