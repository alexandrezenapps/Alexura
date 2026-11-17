# Security Specification — Alexura Firebase Cloud Storage

## 1. Data Invariants
1. **Strict Single-Owner Isolation**: Every `SongRecord`, `AudioChunk`, `UserProfile`, `VercelSettings`, and `WorkHistoryEntry` document belongs strictly to a single verified Firebase Auth UID (`request.auth.uid`), with `request.auth.token.email_verified == true`.
2. **Master Gate on Subcollections**: An `AudioChunk` at `/songs/{songId}/audioChunks/{chunkId}` can ONLY be read or written if the parent `/songs/{songId}` document exists and its `ownerId == request.auth.uid`, and both `songId` and `ownerId` match. `WorkHistoryEntry` at `/users/{userId}/history/{historyId}` is strictly isolated to `userId == request.auth.uid`, immutable once written (`allow update: if false`), and bounded (`details <= 500`, `songTitle <= 200`).
3. **Immutable Ownership & Temporal Integrity**: `ownerId`, `songId` (on songs/chunks), and `createdAt` are immutable once created. `createdAt == request.time` on create; `updatedAt == request.time` on create and update.
4. **Volumetric Boundaries**:
   - Path IDs strictly match `^[a-zA-Z0-9_\-]+$` (`size() <= 128`).
   - `title <= 200`, `artist <= 200`, `lyrics <= 60000`, `audioName <= 260`, `audioMime <= 100`.
   - Audio chunk payload `data <= 500000`, `index` bounded `[0, 63]`.
   - Vercel `appUrl` / `deployHookUrl <= 500`, `projectName <= 120`.
5. **No Blanket Reads & No Shadow Fields**: All `list` rules evaluate `resource.data.ownerId == request.auth.uid` (no `get()`/`exists()` inside `list`). All creates enforce exact `keys().hasAll(...)` + `keys().hasOnly(...)`; updates use `diff().affectedKeys().hasOnly(...)` + `isValid[Entity]()`.

## 2. The "Dirty Dozen" Payloads (Adversarial Red Team Cases)
1. **Unauthenticated song create**: `request.auth == null` creating `/songs/s1` -> `PERMISSION_DENIED`.
2. **Unverified email create**: `email_verified == false` creating `/songs/s1` -> `PERMISSION_DENIED`.
3. **Identity spoofing (`ownerId` hijack)**: User `alice` creating `/songs/s1` with `ownerId: "bob"` -> `PERMISSION_DENIED`.
4. **Ghost/Shadow field injection**: Creating `/songs/s1` with extra `isAdmin: true` -> `PERMISSION_DENIED`.
5. **1MB Denial-of-Wallet lyrics string**: Creating `/songs/s1` with `lyrics` length > 60,000 -> `PERMISSION_DENIED`.
6. **Oversized/Poisoned Document ID**: Creating `/songs/` + `'a'.repeat(300)` or `/songs/bad$id` -> `PERMISSION_DENIED`.
7. **Timestamp forgery**: Creating `/songs/s1` with `createdAt: "2020-01-01"` instead of `request.time` -> `PERMISSION_DENIED`.
8. **Cross-user song read (`get` / `list`)**: User `bob` reading or listing `/songs` where `ownerId == "alice"` -> `PERMISSION_DENIED`.
9. **OwnerId reassignment on update**: User `alice` updating `/songs/s1` to set `ownerId: "bob"` -> `PERMISSION_DENIED`.
10. **CreatedAt mutation on update**: User `alice` updating `/songs/s1` and altering `createdAt` -> `PERMISSION_DENIED`.
11. **Orphaned / Cross-tenant AudioChunk write**: User `bob` creating `/songs/alice_song/audioChunks/c0` with `ownerId: "bob"` -> `PERMISSION_DENIED` (Master Gate checks parent `songs/{songId}`).
12. **PII / Vercel Secrets leak**: User `bob` reading `/users/alice` or `/users/alice/integrations/vercel` -> `PERMISSION_DENIED`.
