import { Database, Q } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import { schema } from './schema';
import { migrations } from './migrations';
import { modelClasses } from './models';
import { makeDbActions } from './actions';
import { serializeRoutine } from './serialize';
import { initialCursor } from '../engine/cursor';
import { dispatch } from '../engine';
import { emptyDraft, emptyPrescription, type RoutineDraft } from '../types/draft';
import { ENGINE_DEFAULTS } from '../types/engine';

function makeDb(): Database {
  const adapter = new LokiJSAdapter({
    dbName: `apexfoss-day2-${Math.random().toString(36).slice(2)}`,
    schema,
    migrations,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
  });
  return new Database({ adapter, modelClasses: modelClasses as any });
}

const T0 = 1_700_000_000_000;

/** Representative routine: 2 blocks, multiple steps, rounds, all transition kinds, tempo. */
function representativeDraft(): RoutineDraft {
  return {
    id: null,
    name: 'Day 2 Mixed',
    blocks: [
      {
        localId: 'b1',
        name: 'Block A',
        kind: 'normal',
        rounds: 2,
        steps: [
          {
            localId: 's1',
            exerciseId: null, // filled by caller after exercises exist
            exerciseName: 'Back Squat',
            prescription: {
              ...emptyPrescription(),
              targetSets: 3,
              targetRepsMin: 5,
              targetRepsMax: 8,
              targetWeightGrams: 140_000,
              targetRir: 2,
              tempo: { eccentricMs: 3000, pauseBottomMs: 1000, concentricMs: 1000, pauseTopMs: 0 },
            },
            transition: { type: 'immediate', delayMs: 0 },
          },
          {
            localId: 's2',
            exerciseId: null,
            exerciseName: 'Romanian Deadlift',
            prescription: {
              ...emptyPrescription(),
              targetSets: 3,
              targetRepsMin: 8,
              targetRepsMax: null,
              targetWeightGrams: 100_000,
              tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
            },
            transition: { type: 'rest', delayMs: 120_000 },
          },
        ],
      },
      {
        localId: 'b2',
        name: 'Finisher',
        kind: 'circuit',
        rounds: 2,
        steps: [
          {
            localId: 's3',
            exerciseId: null,
            exerciseName: 'Plank',
            prescription: {
              ...emptyPrescription(),
              targetSets: 1,
              targetDurationMs: 45_000,
              tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
            },
            transition: { type: 'auto_advance', delayMs: 15_000 },
          },
        ],
      },
    ],
  };
}

async function buildRepresentativeRoutine(db: Database) {
  const actions = makeDbActions(db);
  const squat = await actions.createExercise({
    name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: 3,
  });
  const rdl = await actions.createExercise({
    name: 'Romanian Deadlift', category: 'legs', equipment: 'barbell', metricFlags: 3,
  });
  const plank = await actions.createExercise({
    name: 'Plank', category: 'core', equipment: 'bodyweight', metricFlags: 4,
  });

  const draft = representativeDraft();
  draft.blocks[0].steps[0].exerciseId = squat;
  draft.blocks[0].steps[1].exerciseId = rdl;
  draft.blocks[1].steps[0].exerciseId = plank;

  const routineId = await actions.saveRoutineDraft(draft);
  return { routineId, exerciseIds: { squat, rdl, plank } };
}

describe('Day 2 — routine persistence (create/persist/reopen/edit/delete)', () => {
  it('creates a routine with blocks, steps, prescriptions and transitions; reopens identical', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId } = await buildRepresentativeRoutine(db);

    const draft = await actions.loadRoutineDraft(routineId);
    expect(draft.id).toBe(routineId);
    expect(draft.name).toBe('Day 2 Mixed');
    expect(draft.blocks).toHaveLength(2);
    expect(draft.blocks[0].steps).toHaveLength(2);
    expect(draft.blocks[1].steps).toHaveLength(1);

    const [b1, b2] = draft.blocks;
    expect(b1.kind).toBe('normal');
    expect(b1.rounds).toBe(2);
    expect(b2.kind).toBe('circuit');
    expect(b2.rounds).toBe(2);

    expect(b1.steps[0].exerciseName).toBe('Back Squat');
    expect(b1.steps[0].prescription.targetSets).toBe(3);
    expect(b1.steps[0].prescription.targetRepsMin).toBe(5);
    expect(b1.steps[0].prescription.targetRepsMax).toBe(8);
    expect(b1.steps[0].prescription.targetWeightGrams).toBe(140_000);
    expect(b1.steps[0].prescription.tempo).toEqual({
      eccentricMs: 3000, pauseBottomMs: 1000, concentricMs: 1000, pauseTopMs: 0,
    });
    expect(b1.steps[0].transition).toEqual({ type: 'immediate', delayMs: 0 });
    expect(b1.steps[1].transition).toEqual({ type: 'rest', delayMs: 120_000 });
    expect(b2.steps[0].transition).toEqual({ type: 'auto_advance', delayMs: 15_000 });
    expect(b2.steps[0].prescription.targetDurationMs).toBe(45_000);
  });

  it('edits persist: rename, rounds, prescription and transition changes survive reopen', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId } = await buildRepresentativeRoutine(db);

    const draft = await actions.loadRoutineDraft(routineId);
    draft.name = 'Renamed Routine';
    draft.blocks[0].rounds = 5;
    draft.blocks[0].steps[0].prescription.targetSets = 5;
    draft.blocks[0].steps[0].prescription.targetWeightGrams = 150_000;
    draft.blocks[0].steps[1].transition = { type: 'immediate', delayMs: 0 };
    await actions.saveRoutineDraft(draft);

    const again = await actions.loadRoutineDraft(routineId);
    expect(again.name).toBe('Renamed Routine');
    expect(again.blocks[0].rounds).toBe(5);
    expect(again.blocks[0].steps[0].prescription.targetSets).toBe(5);
    expect(again.blocks[0].steps[0].prescription.targetWeightGrams).toBe(150_000);
    expect(again.blocks[0].steps[1].transition).toEqual({ type: 'immediate', delayMs: 0 });
    // structure preserved after edit (no duplicate rows from replace strategy)
    expect(again.blocks).toHaveLength(2);
    expect(again.blocks[0].steps).toHaveLength(2);
    const allBlocks = await db.get<any>('routine_blocks').query(Q.where('routine_id', routineId)).fetch();
    expect(allBlocks).toHaveLength(2);
    const allTransitions = await db.get<any>('block_transitions').query().fetch();
    expect(allTransitions).toHaveLength(3);
  });

  it('deletes routine and cascades blocks/steps/prescriptions/transitions', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId } = await buildRepresentativeRoutine(db);

    await actions.deleteRoutine(routineId);

    const routines = await db.get<any>('routines').query().fetch();
    expect(routines.find((r) => r.id === routineId)).toBeUndefined();
    expect(await db.get<any>('routine_blocks').query().fetch()).toHaveLength(0);
    expect(await db.get<any>('routine_block_steps').query().fetch()).toHaveLength(0);
    expect(await db.get<any>('routine_exercise_prescriptions').query().fetch()).toHaveLength(0);
    expect(await db.get<any>('block_transitions').query().fetch()).toHaveLength(0);

    const list = await actions.listRoutinesWithCounts();
    expect(list.find((r) => r.id === routineId)).toBeUndefined();
  });

  it('lists routines with block/step counts', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const { routineId } = await buildRepresentativeRoutine(db);
    const list = await actions.listRoutinesWithCounts();
    const row = list.find((r) => r.id === routineId);
    expect(row).toBeDefined();
    expect(row!.blockCount).toBe(2);
    expect(row!.stepCount).toBe(3);
  });

  it('creates a brand-new draft (null id) and assigns an id on first save', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const draft = emptyDraft();
    draft.name = 'Fresh';
    draft.blocks.push({
      localId: 'b1', name: 'Block 1', kind: 'superset', rounds: 3, steps: [],
    });
    const id = await actions.saveRoutineDraft(draft);
    expect(typeof id).toBe('string');
    const loaded = await actions.loadRoutineDraft(id);
    expect(loaded.name).toBe('Fresh');
    expect(loaded.blocks[0].kind).toBe('superset');
    expect(loaded.blocks[0].rounds).toBe(3);
  });
});

describe('Day 2 — serializer', () => {
  it('serializes hierarchy, order, prescriptions, transitions and rounds deterministically', async () => {
    const db = makeDb();
    const { routineId } = await buildRepresentativeRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);

    const def = await serializeRoutine(db, routine);
    const def2 = await serializeRoutine(db, routine);
    expect(JSON.stringify(def)).toBe(JSON.stringify(def2)); // deterministic

    expect(def.name).toBe('Day 2 Mixed');
    expect(def.blocks.map((b) => b.name)).toEqual(['Block A', 'Finisher']);
    expect(def.blocks[0].rounds).toBe(2);
    expect(def.blocks[1].rounds).toBe(2);
    expect(def.blocks[0].steps.map((s) => s.exerciseName)).toEqual(['Back Squat', 'Romanian Deadlift']);
    expect(def.blocks[1].steps[0].exerciseName).toBe('Plank');

    // prescriptions preserved
    expect(def.blocks[0].steps[0].prescription).toEqual({
      targetSets: 3,
      targetRepsMin: 5,
      targetRepsMax: 8,
      targetDurationMs: null,
      targetWeightGrams: 140_000,
      targetRir: 2,
      tempo: { eccentricMs: 3000, pauseBottomMs: 1000, concentricMs: 1000, pauseTopMs: 0 },
    });

    // transitions preserved with step order
    expect(def.blocks[0].transitions).toEqual([
      { fromStepId: def.blocks[0].steps[0].id, toStepId: null, delayMs: 0, type: 'immediate' },
      { fromStepId: def.blocks[0].steps[1].id, toStepId: null, delayMs: 120_000, type: 'rest' },
    ]);
    expect(def.blocks[1].transitions).toEqual([
      { fromStepId: def.blocks[1].steps[0].id, toStepId: null, delayMs: 15_000, type: 'auto_advance' },
    ]);

    // no UI-only state leaked (localIds are not part of definition).
    // Quote-exact matches: record ids are random 16-char base62 strings, so bare
    // substrings like 'b1'/'s1' can occur inside them by chance (observed flake,
    // Phase 2I). A leaked localId always appears as a complete JSON string value.
    expect(JSON.stringify(def)).not.toContain('localId');
    expect(JSON.stringify(def)).not.toContain('"b1"');
    expect(JSON.stringify(def)).not.toContain('"s1"');
  });

  it('serializes empty prescription fields as null (complete, no undefined)', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const ex = await actions.createExercise({ name: 'Empty Pres', category: 'x', equipment: 'none', metricFlags: 0 });
    const routineId = await actions.saveRoutineDraft({
      id: null,
      name: 'Minimal',
      blocks: [
        {
          localId: 'b', name: 'B', kind: 'normal', rounds: 1,
          steps: [
            {
              localId: 's', exerciseId: ex, exerciseName: 'Empty Pres',
              prescription: emptyPrescription(),
              transition: { type: 'immediate', delayMs: 0 },
            },
          ],
        },
      ],
    });
    const routine = await db.get<any>('routines').find(routineId);
    const def = await serializeRoutine(db, routine);
    const json = JSON.stringify(def);
    expect(json).not.toContain('undefined');
    expect(def.blocks[0].steps[0].prescription.targetSets).toBeNull();
    expect(def.blocks[0].steps[0].prescription.tempo.eccentricMs).toBeNull();
  });
});

describe('Day 2 — engine compatibility (serialized definition accepted by engine)', () => {
  it('initialCursor + dispatch work on the representative serialized routine', async () => {
    const db = makeDb();
    const { routineId } = await buildRepresentativeRoutine(db);
    const routine = await db.get<any>('routines').find(routineId);
    const def = await serializeRoutine(db, routine);

    const cursor0 = initialCursor(def, T0);
    expect(cursor0.status).toBe('active');
    expect(cursor0.blockIndex).toBe(0);
    expect(cursor0.stepIndex).toBe(0);
    expect(cursor0.round).toBe(1);

    // Step A: 3 sets. Complete set 1 → rest between sets (default 90s), stays on set 2.
    const set1 = dispatch(def, cursor0, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: 140_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 },
    });
    expect(set1.cursor.setIndex).toBe(2);
    expect(set1.effects.some((e) => e.kind === 'START_TIMER')).toBe(true);

    // Skip through remaining sets of step A → IMMEDIATE transition → step B.
    let cur = set1.cursor;
    for (let i = 0; i < 2; i++) {
      const r = dispatch(def, cur, { type: 'SKIP_TIMER', now: T0 });
      cur = r.cursor;
      const done = dispatch(def, cur, {
        type: 'COMPLETE_SET', now: T0,
        set: { weightGrams: 140_000, reps: 5, durationMs: null, distanceMm: null, rir: 2 },
      });
      cur = done.cursor;
    }
    // After last set of step A (sets=3): immediate edge → step B, no timer.
    expect(cur.stepIndex).toBe(1);
    expect(cur.timer).toBeNull();

    // Step B: 3 sets; complete all → REST 120s edge (explicit transition).
    for (let s = 0; s < 3; s++) {
      const done = dispatch(def, cur, {
        type: 'COMPLETE_SET', now: T0,
        set: { weightGrams: 100_000, reps: 8, durationMs: null, distanceMm: null, rir: null },
      });
      cur = done.cursor;
      if (cur.timer) {
        const expired = dispatch(def, cur, { type: 'TIMER_EXPIRE', now: T0 + 200_000 });
        cur = expired.cursor;
      }
    }
    // REST edge after last set of last step of round 1 → timer rest 120s then round 2.
    expect(cur.timer === null || cur.round === 2).toBe(true);
    if (cur.timer) {
      expect(cur.timer.kind).toBe('rest');
      expect(cur.timer.durationMs).toBe(120_000);
      const expired = dispatch(def, cur, { type: 'TIMER_EXPIRE', now: T0 + 400_000 });
      cur = expired.cursor;
    }
    expect(cur.round).toBe(2);

    // AUTO_ADVANCE on block 2: reach it by finishing round 2 of block 1.
    while (cur.blockIndex === 0 && cur.status === 'active') {
      if (cur.timer) {
        cur = dispatch(def, cur, { type: 'TIMER_EXPIRE', now: T0 + 500_000 }).cursor;
        continue;
      }
      cur = dispatch(def, cur, {
        type: 'COMPLETE_SET', now: T0,
        set: { weightGrams: null, reps: 8, durationMs: null, distanceMm: null, rir: null },
      }).cursor;
    }
    expect(cur.blockIndex).toBe(1);
    expect(cur.stepIndex).toBe(0);

    // Plank: 1 set duration-based → AUTO_ADVANCE 15s mandatory timer (round 1 of 2,
    // so the target is not session-complete and the edge fires).
    const plankSet = dispatch(def, cur, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: null, durationMs: 45_000, distanceMm: null, rir: null },
    });
    expect(plankSet.cursor.timer).toMatchObject({ kind: 'auto', durationMs: 15_000 });
    expect(plankSet.effects.some((e) => e.kind === 'START_TIMER' && e.timerKind === 'auto')).toBe(true);
    expect(plankSet.effects.some((e) => e.kind === 'SCHEDULE_NOTIFICATION')).toBe(true);

    // Mandatory advance on expiry → round 2.
    const round2 = dispatch(def, plankSet.cursor, { type: 'TIMER_EXPIRE', now: T0 + 60_000 });
    expect(round2.cursor.round).toBe(2);
    expect(round2.cursor.status).toBe('active');

    // Final set of the session → COMPLETE_SESSION (frozen: completion wins over trailing rest).
    const finalSet = dispatch(def, round2.cursor, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: null, durationMs: 45_000, distanceMm: null, rir: null },
    });
    expect(finalSet.cursor.status).toBe('completed');
    expect(finalSet.cursor.timer).toBeNull();
    expect(finalSet.effects.some((e) => e.kind === 'COMPLETE_SESSION')).toBe(true);
  });

  it('engine defaults still apply when a step has no explicit transition row', async () => {
    const db = makeDb();
    const actions = makeDbActions(db);
    const ex = await actions.createExercise({ name: 'X', category: 'c', equipment: 'e', metricFlags: 0 });
    const routineId = await actions.saveRoutineDraft({
      id: null,
      name: 'Defaults',
      blocks: [
        {
          localId: 'b', name: 'B', kind: 'normal', rounds: 1,
          steps: [
            { localId: 's1', exerciseId: ex, exerciseName: 'X', prescription: emptyPrescription(), transition: { type: 'immediate', delayMs: 0 } },
            { localId: 's2', exerciseId: ex, exerciseName: 'X', prescription: emptyPrescription(), transition: { type: 'immediate', delayMs: 0 } },
          ],
        },
      ],
    });
    const routine = await db.get<any>('routines').find(routineId);
    const def = await serializeRoutine(db, routine);

    // Remove explicit transitions → implicit engine defaults (frozen semantics).
    def.blocks[0].transitions = [];
    const c0 = initialCursor(def, T0);
    const r = dispatch(def, c0, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: 1, durationMs: null, distanceMm: null, rir: null },
    });
    // Non-last step, no transition → immediate advance.
    expect(r.cursor.stepIndex).toBe(1);
    expect(r.cursor.timer).toBeNull();

    // Last step, no transition, rounds exhausted → frozen engine semantics: the final
    // set of the whole session completes immediately (trailing rest is not started).
    const r2 = dispatch(def, r.cursor, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: 1, durationMs: null, distanceMm: null, rir: null },
    });
    expect(r2.cursor.status).toBe('completed');
    expect(r2.cursor.timer).toBeNull();
    expect(r2.effects.some((e) => e.kind === 'COMPLETE_SESSION')).toBe(true);

    // Implicit rest defaults still exist for non-final round transitions:
    // block with rounds=2, no explicit transition → loop uses ENGINE_DEFAULTS.restLoopMs.
    def.blocks[0].rounds = 2;
    const c1 = initialCursor(def, T0);
    let cur = dispatch(def, c1, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: 1, durationMs: null, distanceMm: null, rir: null },
    }).cursor; // → step 1
    cur = dispatch(def, cur, {
      type: 'COMPLETE_SET', now: T0,
      set: { weightGrams: null, reps: 1, durationMs: null, distanceMm: null, rir: null },
    }).cursor; // last step, rounds remain → implicit REST loop default
    expect(cur.timer).toMatchObject({ kind: 'rest', durationMs: ENGINE_DEFAULTS.restLoopMs });
  });
});
