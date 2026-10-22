import assert from 'assert';
import {
  generateConflictId,
  isConflictDeleted,
  deleteConflictId,
  deleteConflictIds,
  resetDeletedConflicts,
} from '../src/services/conflictHistoryService.js';

console.log('--- Testing Conflict History Service ---');

const dummyConflict = {
  engineer_id: 'eng_123',
  engineer_name: 'Test Engineer',
  commitment_a: { id: 'job_001', checklist_number: 'EE-INST-20261022-0001', type: 'JOB' },
  commitment_b: { id: 'travel_002', checklist_number: 'EE-INST-20261022-0002', type: 'TRAVEL' },
  overlap_start: '2026-10-22',
  overlap_end: '2026-10-24',
};

// 1. Generate Conflict ID
const conflictId = generateConflictId(dummyConflict);
console.log('1. Generated stable conflict ID:', conflictId);
assert(conflictId.startsWith('conf_'), 'Conflict ID should start with conf_');

// 2. Initial state - not deleted
assert.strictEqual(isConflictDeleted(conflictId), false, 'Initially should not be deleted');

// 3. Delete single conflict
deleteConflictId(conflictId);
assert.strictEqual(isConflictDeleted(conflictId), true, 'Conflict should now be marked deleted');

// 4. Test with raw identifier string fallback
const rawDummyConflict = {
  engineer_id: 'eng_456',
  commitment_a: { id: 'job_456' },
  commitment_b: { id: 'job_789' },
  overlap_start: '2026-11-01',
  overlap_end: '2026-11-03',
};
const rawConflictId = generateConflictId(rawDummyConflict);
const rawFallbackKey = `${rawDummyConflict.engineer_id}_${rawDummyConflict.commitment_a.id}_${rawDummyConflict.commitment_b.id}_${rawDummyConflict.overlap_start}_${rawDummyConflict.overlap_end}`;

deleteConflictId(rawFallbackKey);
assert.strictEqual(isConflictDeleted(rawConflictId), true, 'Should match decoded conf_ id when raw key was passed');

// 5. Bulk deletion
const dummyConflicts = [
  { engineer_id: 'eng_a', commitment_a: { id: 'a1' }, commitment_b: { id: 'b1' }, overlap_start: '2026-10-01', overlap_end: '2026-10-02' },
  { engineer_id: 'eng_b', commitment_a: { id: 'a2' }, commitment_b: { id: 'b2' }, overlap_start: '2026-10-03', overlap_end: '2026-10-04' },
];
const ids = dummyConflicts.map((c) => generateConflictId(c));
const deletedCount = deleteConflictIds(ids);
assert.strictEqual(deletedCount, 2, 'Should delete 2 conflicts');
assert.strictEqual(isConflictDeleted(ids[0]), true);
assert.strictEqual(isConflictDeleted(ids[1]), true);

console.log('All conflict history service tests passed successfully!');
