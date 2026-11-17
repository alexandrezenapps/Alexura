// Security verification test specification matching security_spec.md "Dirty Dozen"
import assert from 'node:assert';
import fs from 'node:fs';

const rules = fs.readFileSync('firestore.rules', 'utf8');

// Structural invariants covering every Dirty Dozen vector
assert.ok(rules.includes("rules_version = '2';"), 'Rules must use rules_version 2');
assert.ok(rules.includes('allow read, write: if false;'), 'Global default-deny safety net required');
assert.ok(rules.includes('request.auth.token.email_verified == true'), 'Verified email gate required');
assert.ok(rules.includes('function isValidId(id)'), 'ID poisoning regex guard required');
assert.ok(rules.includes('isValidSongRecord(incoming(), songId)'), 'Validation blueprint required on SongRecord writes');
assert.ok(rules.includes('isValidAudioChunk(incoming(), chunkId, songId)'), 'Validation blueprint required on AudioChunk writes');
assert.ok(rules.includes('parentSongOwned()'), 'Master Gate parent check required on AudioChunk subcollection');
assert.ok(rules.includes('incoming().ownerId == existing().ownerId'), 'Immutable ownerId check required');
assert.ok(rules.includes('incoming().createdAt == existing().createdAt'), 'Immutable createdAt check required');
assert.ok(rules.includes('incoming().createdAt == request.time'), 'Server timestamp enforcement on create required');
assert.ok(rules.includes('incoming().updatedAt == request.time'), 'Server timestamp enforcement on update required');
assert.ok(!/allow list:\s*if\s*isSignedIn\(\)\s*;/.test(rules), 'No client-delegated list rules allowed');
assert.ok(rules.includes('allow list: if isVerified() && existing().ownerId == request.auth.uid;'), 'Server-enforced query filter on songs list');
assert.ok(rules.includes('(resource == null || existing().ownerId == request.auth.uid)'), 'Existence checks on allow get must handle resource == null safely');
assert.ok(rules.includes('isValidWorkHistoryEntry(incoming(), historyId)'), 'Validation blueprint required on WorkHistoryEntry');

console.log('FIRESTORE_RULES_SECURITY_INVARIANTS_VERIFIED');
