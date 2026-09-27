import { Database, Q } from '@nozbe/watermelondb';
import type {
  ApexBackup,
  BackupData,
  BackupEquipmentItem,
  BackupGoal,
  BackupMesocycle,
  BackupReadinessTest,
  BackupRoutine,
  BackupSession,
  BackupSessionExercise,
  BackupSetLog,
  PortableExercise,
  PortableProgram,
  PortableRoutine,
} from './types';
import { BACKUP_FORMAT, MAX_BACKUP_JSON_BYTES, BACKUP_FORMAT_VERSION, PortabilityError } from './types';
import { canonicalJson, semanticChecksum, utf8ByteLength } from './canonical';
import { schemaVersion } from '../data/schema';
import { NOTE_MAX_LENGTH } from '../data/notes';

const APP_VERSION = '0.1.0';

export interface RestoreHooks {
  onRowCreated?: (table: string, count: number) => void;
}

/**
 * Build a logical backup from the live database.
 * Reads tables in one consistent read flow (same tick — no interleaved writes expected for MVP).
 * Does NOT dump Watermelon internal metadata (no _status, no raw ids as semantic keys).
 */
export async function createBackup(db: Database): Promise<ApexBackup> {
  const exerciseRows = await db.get<any>('exercises').query().fetch();
  const routineRows = await db.get<any>('routines').query(Q.sortBy('created_at', 'asc')).fetch();
  const blockRows = await db.get<any>('routine_blocks').query().fetch();
  const stepRows = await db.get<any>('routine_block_steps').query().fetch();
  const prescRows = await db.get<any>('routine_exercise_prescriptions').query().fetch();
  const transRows = await db.get<any>('block_transitions').query().fetch();
  const sessionRows = await db.get<any>('workout_sessions').query().fetch();
  const sessionExRows = await db.get<any>('session_exercises').query().fetch();
  const setLogRows = await db.get<any>('set_logs').query().fetch();
  const readinessRows = await db.get<any>('readiness_tests').query(Q.sortBy('tested_at', 'asc')).fetch();
  const equipmentRows = await db.get<any>('equipment_items').query(Q.sortBy('created_at', 'asc')).fetch();
  const programRows = await db.get<any>('programs').query(Q.sortBy('created_at', 'asc')).fetch();
  const mesoRows = await db.get<any>('mesocycles').query().fetch();
  const goalRows = await db.get<any>('goals').query(Q.sortBy('created_at', 'asc')).fetch();

  // Programs (schema v8): name-only containers; membership lives on routines.
  const programs: PortableProgram[] = programRows.map((p) => ({ name: p.name }));
  const programIndexById = new Map<string, number>(programRows.map((p, i) => [p.id, i]));

  // Mesocycles (schema v9): ordered by (program creation order, sort_order).
  const mesoIndexById = new Map<string, number>();
  const mesocycles: BackupMesocycle[] = [];
  const orderedMeso = mesoRows.slice().sort((a, b) => {
    const pa = programIndexById.get(a.programId) ?? Number.MAX_SAFE_INTEGER;
    const pb = programIndexById.get(b.programId) ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || a.sortOrder - b.sortOrder || String(a.id).localeCompare(String(b.id));
  });
  for (const m of orderedMeso) {
    const pi = programIndexById.get(m.programId);
    if (pi == null) continue; // orphan phase — not representable in backup
    mesoIndexById.set(m.id, mesocycles.length);
    mesocycles.push({ name: m.name, programIndex: pi, sortOrder: m.sortOrder });
  }

  // Package-local exercise keys (stable by first-use across routines, then leftover sorted by name).
  const localIdToKey = new Map<string, string>();
  const exercises: PortableExercise[] = [];
  const ensureEx = (localId: string | null, nameHint = ''): string | null => {
    if (!localId) return null;
    const hit = localIdToKey.get(localId);
    if (hit) return hit;
    const row = exerciseRows.find((e) => e.id === localId);
    const key = `e${exercises.length + 1}`;
    exercises.push({
      key,
      name: row?.name ?? nameHint,
      category: row?.category ?? '',
      equipment: row?.equipment ?? '',
      metricFlags: row?.metricFlags ?? 0,
    });
    localIdToKey.set(localId, key);
    return key;
  };

  const blocksByRoutine = new Map<string, typeof blockRows>();
  for (const b of blockRows) {
    if (!blocksByRoutine.has(b.routineId)) blocksByRoutine.set(b.routineId, []);
    blocksByRoutine.get(b.routineId)!.push(b);
  }
  const stepsByBlock = new Map<string, typeof stepRows>();
  for (const s of stepRows) {
    if (!stepsByBlock.has(s.blockId)) stepsByBlock.set(s.blockId, []);
    stepsByBlock.get(s.blockId)!.push(s);
  }
  const prescByStep = new Map<string, any>();
  for (const p of prescRows) prescByStep.set(p.stepId, p);
  const transByFrom = new Map<string, any>();
  for (const t of transRows) transByFrom.set(t.fromStepId, t);

  // First-use order: walk routines → blocks → steps to assign exercise keys.
  const routines: BackupRoutine[] = [];
  const routineIndexById = new Map<string, number>();
  for (const r of routineRows) {
    const blocks = (blocksByRoutine.get(r.id) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const portableBlocks: PortableRoutine['blocks'][number][] = blocks.map((b) => {
      const steps = (stepsByBlock.get(b.id) ?? []).slice().sort((a, b2) => a.sortOrder - b2.sortOrder);
      return {
        name: b.name,
        kind: b.blockKind,
        rounds: b.rounds,
        interval: b.blockKind === 'interval' && b.intervalJson ? JSON.parse(b.intervalJson) : null,
        steps: steps.map((s) => {
          const key = ensureEx(s.exerciseId, '');
          const p = prescByStep.get(s.id);
          const t = transByFrom.get(s.id);
          return {
            role: 'work' as const,
            exerciseKey: key,
            exerciseName: '',
            prescription: {
              targetSets: p?.targetSets ?? null,
              targetRepsMin: p?.targetRepsMin ?? null,
              targetRepsMax: p?.targetRepsMax ?? null,
              targetDurationMs: p?.targetDurationMs ?? null,
              targetWeightGrams: p?.targetWeightGrams ?? null,
              targetRir: p?.targetRir ?? null,
              tempo: {
                eccentricMs: p?.tempoEccentricMs ?? null,
                pauseBottomMs: p?.tempoPauseBottomMs ?? null,
                concentricMs: p?.tempoConcentricMs ?? null,
                pauseTopMs: p?.tempoPauseTopMs ?? null,
              },
            },
            transition: {
              type: t?.transitionType ?? 'immediate',
              delayMs: t?.delayMs ?? 0,
            },
          };
        }),
      };
    });
    // Fill exerciseName from package exercises for readability.
    for (const b of portableBlocks) {
      for (const s of b.steps) {
        const ex = exercises.find((e) => e.key === s.exerciseKey);
        s.exerciseName = ex?.name ?? '';
      }
    }
    routineIndexById.set(r.id, routines.length);
    routines.push({
      name: r.name,
      blocks: portableBlocks,
      programIndex: r.programId != null ? (programIndexById.get(r.programId) ?? null) : null,
      programOrder: r.programOrder ?? null,
      mesocycleIndex: r.mesocycleId != null ? (mesoIndexById.get(r.mesocycleId) ?? null) : null,
    });
  }

  // Orphan exercises (not referenced) still included.
  for (const row of exerciseRows) {
    ensureEx(row.id, row.name);
  }

  const sessions: BackupSession[] = [];
  const sessionIndexById = new Map<string, number>();
  const sortedSessions = sessionRows.slice().sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
  for (const s of sortedSessions) {
    sessionIndexById.set(s.id, sessions.length);
    sessions.push({
      routineIndex: s.routineId != null && routineIndexById.has(s.routineId) ? routineIndexById.get(s.routineId)! : null,
      name: s.name,
      startedAt: s.startedAt,
      endedAt: s.endedAt ?? null,
      status: s.sessionStatus,
      note: s.note ?? null,
      definitionJson: s.definitionJson,
      cursorJson: s.cursorJson,
      currentBlockIndex: s.currentBlockIndex,
      currentStepId: s.currentStepId ?? null,
      currentRound: s.currentRound,
      currentSetIndex: s.currentSetIndex,
      timerExpiresAt: s.timerExpiresAt ?? null,
    });
  }

  const sessionExercises: BackupSessionExercise[] = [];
  const seIndexById = new Map<string, number>();
  const sortedSe = sessionExRows.slice().sort((a, b) => {
    const sa = sessionIndexById.get(a.sessionId) ?? 0;
    const sb = sessionIndexById.get(b.sessionId) ?? 0;
    if (sa !== sb) return sa - sb;
    if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
    return a.orderIndex - b.orderIndex;
  });
  for (const se of sortedSe) {
    const sessionIndex = sessionIndexById.get(se.sessionId);
    if (sessionIndex === undefined) continue;
    seIndexById.set(se.id, sessionExercises.length);
    sessionExercises.push({
      sessionIndex,
      exerciseKey: ensureEx(se.exerciseId, se.exerciseName),
      exerciseName: se.exerciseName,
      blockIndex: se.blockIndex,
      orderIndex: se.orderIndex,
    });
  }

  const setLogs: BackupSetLog[] = [];
  const sortedLogs = setLogRows.slice().sort((a, b) => {
    const ia = seIndexById.get(a.sessionExerciseId);
    const ib = seIndexById.get(b.sessionExerciseId);
    if (ia !== ib) return (ia ?? 0) - (ib ?? 0);
    if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
    if (a.stepIndex !== b.stepIndex) return a.stepIndex - b.stepIndex;
    if (a.round !== b.round) return a.round - b.round;
    return a.setIndex - b.setIndex;
  });
  for (const log of sortedLogs) {
    const seIdx = seIndexById.get(log.sessionExerciseId);
    if (seIdx === undefined) continue;
    setLogs.push({
      sessionExerciseIndex: seIdx,
      blockIndex: log.blockIndex,
      stepIndex: log.stepIndex,
      round: log.round,
      setIndex: log.setIndex,
      weightGrams: log.weightGrams ?? null,
      reps: log.reps ?? null,
      durationMs: log.durationMs ?? null,
      distanceMm: log.distanceMm ?? null,
      rir: log.rir ?? null,
      isCompleted: log.isCompleted,
      completedAt: log.completedAt ?? null,
      executionType: log.executionType ?? null,
      overrideReason: log.overrideReason ?? null,
    });
  }

  // Fill session exercise names from exercise table via key.
  for (const se of sessionExercises) {
    const ex = exercises.find((e) => e.key === se.exerciseKey);
    if (!se.exerciseName && ex) se.exerciseName = ex.name;
  }

  const readinessTests: BackupReadinessTest[] = readinessRows.map((r: any) => ({
    testedAt: r.testedAt,
    durationMs: r.durationMs,
    tapCount: r.tapCount,
  }));

  const equipmentItems: BackupEquipmentItem[] = equipmentRows.map((e: any) => ({
    name: e.name,
    weightGrams: e.weightGrams,
    quantity: e.quantity,
    perSide: e.perSide === true || e.perSide === 1,
  }));

  // Goals (schema v10): exercise by package key — ensureEx also exports
  // exercises used only by goals.
  const goals: BackupGoal[] = goalRows.map((g: any) => ({
    exerciseKey: ensureEx(g.exerciseId, '') ?? '',
    targetWeightGrams: g.targetWeightGrams,
  }));

  const data: BackupData = {
    exercises,
    routines,
    sessions,
    sessionExercises,
    setLogs,
    readinessTests,
    equipmentItems,
    programs,
    mesocycles,
    goals,
  };
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    schemaVersion,
    exportedAt: Date.now(),
    checksum: semanticChecksum(data),
    data,
  };
}

export function serializeBackup(backup: ApexBackup): string {
  return canonicalJson(backup);
}

export function parseBackup(json: string): ApexBackup {
  if (utf8ByteLength(json) > MAX_BACKUP_JSON_BYTES) {
    throw new PortabilityError('too_large');
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new PortabilityError('invalid_json');
  }
  return validateBackup(raw);
}

export function validateBackup(raw: unknown): ApexBackup {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new PortabilityError('missing_field', 'root');
  }
  const b = raw as Record<string, unknown>;
  if (b.format !== BACKUP_FORMAT) throw new PortabilityError('wrong_format');
  if (b.formatVersion !== BACKUP_FORMAT_VERSION) throw new PortabilityError('unsupported_backup_version');
  if (typeof b.schemaVersion !== 'number' || !Number.isInteger(b.schemaVersion) || b.schemaVersion < 1) {
    throw new PortabilityError('invalid_integer', 'schemaVersion');
  }
  if (b.schemaVersion > schemaVersion) throw new PortabilityError('schema_mismatch', 'schemaVersion');
  if (typeof b.appVersion !== 'string' || b.appVersion.length === 0 || b.appVersion.length > 32) {
    throw new PortabilityError('invalid_string', 'appVersion');
  }
  if (typeof b.exportedAt !== 'number' || !Number.isInteger(b.exportedAt) || b.exportedAt < 0) {
    throw new PortabilityError('invalid_integer', 'exportedAt');
  }
  if (typeof b.checksum !== 'string' || !/^[0-9a-f]{64}$/.test(b.checksum)) {
    throw new PortabilityError('checksum_mismatch', 'format');
  }
  const data = b.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new PortabilityError('missing_field', 'data');
  }
  const d = data as Record<string, unknown>;
  const exercises = d.exercises;
  const routines = d.routines;
  const sessions = d.sessions;
  const sessionExercises = d.sessionExercises;
  const setLogs = d.setLogs;
  if (!Array.isArray(exercises) || !Array.isArray(routines) || !Array.isArray(sessions) ||
      !Array.isArray(sessionExercises) || !Array.isArray(setLogs)) {
    throw new PortabilityError('missing_field', 'data.*');
  }
  const readinessTestsRaw = d.readinessTests;
  if (readinessTestsRaw !== undefined && !Array.isArray(readinessTestsRaw)) {
    throw new PortabilityError('missing_field', 'data.readinessTests');
  }
  const equipmentItemsRaw = d.equipmentItems;
  if (equipmentItemsRaw !== undefined && !Array.isArray(equipmentItemsRaw)) {
    throw new PortabilityError('missing_field', 'data.equipmentItems');
  }
  const programsRaw = d.programs;
  if (programsRaw !== undefined && !Array.isArray(programsRaw)) {
    throw new PortabilityError('missing_field', 'data.programs');
  }
  const programsList: unknown[] = Array.isArray(programsRaw) ? programsRaw : [];
  for (const [i, p] of programsList.entries()) {
    if (typeof p !== 'object' || p === null) throw new PortabilityError('missing_field', `programs[${i}]`);
    const pp = p as Record<string, unknown>;
    if (typeof pp.name !== 'string' || !pp.name) throw new PortabilityError('invalid_string', `programs[${i}].name`);
  }
  const mesocyclesRaw = d.mesocycles;
  if (mesocyclesRaw !== undefined && !Array.isArray(mesocyclesRaw)) {
    throw new PortabilityError('missing_field', 'data.mesocycles');
  }
  const mesocyclesList: unknown[] = Array.isArray(mesocyclesRaw) ? mesocyclesRaw : [];
  for (const [i, m] of mesocyclesList.entries()) {
    if (typeof m !== 'object' || m === null) throw new PortabilityError('missing_field', `mesocycles[${i}]`);
    const mm = m as Record<string, unknown>;
    if (typeof mm.name !== 'string' || !mm.name) throw new PortabilityError('invalid_string', `mesocycles[${i}].name`);
    if (
      typeof mm.programIndex !== 'number' ||
      !Number.isInteger(mm.programIndex) ||
      mm.programIndex < 0 ||
      mm.programIndex >= programsList.length
    ) {
      throw new PortabilityError('invalid_reference', `mesocycles[${i}].programIndex`);
    }
    if (typeof mm.sortOrder !== 'number' || !Number.isInteger(mm.sortOrder) || mm.sortOrder < 0) {
      throw new PortabilityError('invalid_integer', `mesocycles[${i}].sortOrder`);
    }
  }

  const exerciseKeys = new Set<string>();
  for (const [i, e] of exercises.entries()) {
    if (typeof e !== 'object' || e === null) throw new PortabilityError('missing_field', `exercises[${i}]`);
    const ex = e as Record<string, unknown>;
    if (typeof ex.key !== 'string' || !/^e[1-9][0-9]{0,7}$/.test(ex.key)) {
      throw new PortabilityError('duplicate_identity', `exercises[${i}].key`);
    }
    if (exerciseKeys.has(ex.key)) throw new PortabilityError('duplicate_identity', ex.key);
    if (typeof ex.name !== 'string' || !ex.name) throw new PortabilityError('invalid_string', `exercises[${i}].name`);
    if (typeof ex.metricFlags !== 'number' || !Number.isInteger(ex.metricFlags) || ex.metricFlags < 0 || ex.metricFlags > 15) {
      throw new PortabilityError('invalid_integer', `exercises[${i}].metricFlags`);
    }
    exerciseKeys.add(ex.key);
  }

  const goalsRaw = d.goals;
  if (goalsRaw !== undefined && !Array.isArray(goalsRaw)) {
    throw new PortabilityError('missing_field', 'data.goals');
  }
  const goalsList: unknown[] = Array.isArray(goalsRaw) ? goalsRaw : [];
  for (const [i, g] of goalsList.entries()) {
    if (typeof g !== 'object' || g === null) throw new PortabilityError('missing_field', `goals[${i}]`);
    const gg = g as Record<string, unknown>;
    if (typeof gg.exerciseKey !== 'string' || !exerciseKeys.has(gg.exerciseKey)) {
      throw new PortabilityError('dangling_exercise', `goals[${i}].exerciseKey`);
    }
    if (
      typeof gg.targetWeightGrams !== 'number' ||
      !Number.isInteger(gg.targetWeightGrams) ||
      gg.targetWeightGrams <= 0
    ) {
      throw new PortabilityError('invalid_integer', `goals[${i}].targetWeightGrams`);
    }
  }

  // Validate each routine's structure (reuse portable block/step rules without package checksum).
  for (const [i, r] of routines.entries()) {
    if (typeof r !== 'object' || r === null) throw new PortabilityError('missing_field', `routines[${i}]`);
    const rr = r as Record<string, unknown>;
    if (!Array.isArray(rr.blocks)) throw new PortabilityError('missing_field', `routines[${i}].blocks`);
    // Empty blocks allowed in backup (routine may be unconfigured); non-empty must be valid.
    if (typeof rr.name !== 'string' || !rr.name) throw new PortabilityError('invalid_string', `routines[${i}].name`);
    if (rr.programIndex !== undefined && rr.programIndex !== null) {
      const idx = rr.programIndex;
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= programsList.length) {
        throw new PortabilityError('invalid_reference', `routines[${i}].programIndex`);
      }
    }
    if (
      rr.programOrder !== undefined &&
      rr.programOrder !== null &&
      (typeof rr.programOrder !== 'number' || !Number.isInteger(rr.programOrder) || rr.programOrder < 0)
    ) {
      throw new PortabilityError('invalid_integer', `routines[${i}].programOrder`);
    }
    if (rr.mesocycleIndex !== undefined && rr.mesocycleIndex !== null) {
      const mi = rr.mesocycleIndex;
      if (typeof mi !== 'number' || !Number.isInteger(mi) || mi < 0 || mi >= mesocyclesList.length) {
        throw new PortabilityError('invalid_reference', `routines[${i}].mesocycleIndex`);
      }
    }
    for (const [j, block] of (rr.blocks as unknown[]).entries()) {
      if (typeof block !== 'object' || block === null) throw new PortabilityError('missing_field', `routines[${i}].blocks[${j}]`);
      const b = block as Record<string, unknown>;
      if (!Array.isArray(b.steps) || b.steps.length === 0) throw new PortabilityError('empty_routine', 'blocks.steps');
      for (const [k, step] of (b.steps as unknown[]).entries()) {
        if (typeof step !== 'object' || step === null) throw new PortabilityError('missing_field', 'step');
        const s = step as Record<string, unknown>;
        if (s.exerciseKey != null && !exerciseKeys.has(s.exerciseKey as string)) {
          throw new PortabilityError('dangling_exercise', `routines[${i}].blocks[${j}].steps[${k}]`);
        }
        if (typeof s.prescription !== 'object' || s.prescription === null) {
          throw new PortabilityError('invalid_prescription', 'step.prescription');
        }
        if (typeof s.transition !== 'object' || s.transition === null) {
          throw new PortabilityError('invalid_transition', 'step.transition');
        }
      }
    }
  }

  for (const [i, s] of sessions.entries()) {
    if (typeof s !== 'object' || s === null) throw new PortabilityError('invalid_session', `[${i}]`);
    const ss = s as Record<string, unknown>;
    if (typeof ss.name !== 'string') throw new PortabilityError('invalid_string', `sessions[${i}].name`);
    if (typeof ss.startedAt !== 'number' || !Number.isInteger(ss.startedAt) || ss.startedAt < 0) {
      throw new PortabilityError('invalid_integer', `sessions[${i}].startedAt`);
    }
    if (typeof ss.status !== 'string') throw new PortabilityError('invalid_session', `sessions[${i}].status`);
    if (ss.note !== undefined && ss.note !== null &&
        (typeof ss.note !== 'string' || ss.note.length > NOTE_MAX_LENGTH)) {
      throw new PortabilityError('invalid_string', `sessions[${i}].note`);
    }
    if (typeof ss.definitionJson !== 'string' || typeof ss.cursorJson !== 'string') {
      throw new PortabilityError('invalid_session', `sessions[${i}].json`);
    }
    if (ss.routineIndex !== null && (typeof ss.routineIndex !== 'number' || ss.routineIndex < 0 || ss.routineIndex >= routines.length || !Number.isInteger(ss.routineIndex))) {
      throw new PortabilityError('invalid_reference', `sessions[${i}].routineIndex`);
    }
  }

  for (const [i, se] of sessionExercises.entries()) {
    if (typeof se !== 'object' || se === null) throw new PortabilityError('invalid_reference', `sessionExercises[${i}]`);
    const s = se as Record<string, unknown>;
    if (typeof s.sessionIndex !== 'number' || !Number.isInteger(s.sessionIndex) || s.sessionIndex < 0 || s.sessionIndex >= sessions.length) {
      throw new PortabilityError('invalid_reference', `sessionExercises[${i}].sessionIndex`);
    }
    if (s.exerciseKey != null && !exerciseKeys.has(s.exerciseKey as string)) {
      throw new PortabilityError('dangling_exercise', `sessionExercises[${i}]`);
    }
  }

  for (const [i, log] of setLogs.entries()) {
    if (typeof log !== 'object' || log === null) throw new PortabilityError('invalid_reference', `setLogs[${i}]`);
    const l = log as Record<string, unknown>;
    if (typeof l.sessionExerciseIndex !== 'number' || !Number.isInteger(l.sessionExerciseIndex) ||
        l.sessionExerciseIndex < 0 || l.sessionExerciseIndex >= sessionExercises.length) {
      throw new PortabilityError('invalid_reference', `setLogs[${i}].sessionExerciseIndex`);
    }
    // Phase 3C execution metadata: optional (absent on older backups → legacy semantics).
    if (l.executionType !== undefined && l.executionType !== null &&
        (typeof l.executionType !== 'string' ||
          !['normal', 'modified', 'extra', 'drop', 'skipped'].includes(l.executionType))) {
      throw new PortabilityError('invalid_string', `setLogs[${i}].executionType`);
    }
    if (l.overrideReason !== undefined && l.overrideReason !== null &&
        (typeof l.overrideReason !== 'string' ||
          !['load_reduced', 'load_increased', 'reps_reduced', 'reps_increased', 'fatigue',
            'pain_discomfort', 'equipment_unavailable', 'time_constraint', 'other'].includes(l.overrideReason))) {
      throw new PortabilityError('invalid_string', `setLogs[${i}].overrideReason`);
    }
  }

  if (Array.isArray(readinessTestsRaw)) {
    for (const [i, rt] of readinessTestsRaw.entries()) {
      if (typeof rt !== 'object' || rt === null) throw new PortabilityError('invalid_reference', `readinessTests[${i}]`);
      const r = rt as Record<string, unknown>;
      if (typeof r.testedAt !== 'number' || !Number.isInteger(r.testedAt) || r.testedAt < 0) {
        throw new PortabilityError('invalid_integer', `readinessTests[${i}].testedAt`);
      }
      if (typeof r.durationMs !== 'number' || !Number.isInteger(r.durationMs) || r.durationMs <= 0) {
        throw new PortabilityError('invalid_integer', `readinessTests[${i}].durationMs`);
      }
      if (typeof r.tapCount !== 'number' || !Number.isInteger(r.tapCount) || r.tapCount < 0) {
        throw new PortabilityError('invalid_integer', `readinessTests[${i}].tapCount`);
      }
    }
  }

  if (Array.isArray(equipmentItemsRaw)) {
    for (const [i, ei] of equipmentItemsRaw.entries()) {
      if (typeof ei !== 'object' || ei === null) throw new PortabilityError('invalid_reference', `equipmentItems[${i}]`);
      const e = ei as Record<string, unknown>;
      if (typeof e.name !== 'string') throw new PortabilityError('invalid_string', `equipmentItems[${i}].name`);
      if (typeof e.weightGrams !== 'number' || !Number.isInteger(e.weightGrams) || e.weightGrams <= 0) {
        throw new PortabilityError('invalid_integer', `equipmentItems[${i}].weightGrams`);
      }
      if (typeof e.quantity !== 'number' || !Number.isInteger(e.quantity) || e.quantity < 1) {
        throw new PortabilityError('invalid_integer', `equipmentItems[${i}].quantity`);
      }
      if (typeof e.perSide !== 'boolean') {
        throw new PortabilityError('invalid_boolean', `equipmentItems[${i}].perSide`);
      }
    }
  }

  const checksum = semanticChecksum(d as unknown as BackupData);
  if (checksum !== b.checksum) throw new PortabilityError('checksum_mismatch');

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: b.appVersion,
    schemaVersion: b.schemaVersion,
    exportedAt: b.exportedAt,
    checksum,
    data: d as unknown as BackupData,
  };
}

/**
 * Restore policy (explicit): FULL REPLACE of exercises, routines, sessions,
 * session_exercises, and set_logs after complete validation.
 * Never runs without the UI confirmation layer.
 *
 * Atomicity: snapshot logical rows before clear; on any failure mid-restore,
 * compensating restore of the snapshot (works on LokiJS tests and SQLite).
 */
export async function restoreBackup(db: Database, raw: unknown | string, hooks: RestoreHooks = {}): Promise<void> {
  const backup: ApexBackup =
    typeof raw === 'string' ? parseBackup(raw) : validateBackup(raw);

  // Snapshot raw rows (pre-restore) for compensating rollback.
  const snap = {
    exercises: ((await db.get('exercises').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    routines: ((await db.get('routines').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    blocks: ((await db.get('routine_blocks').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    steps: ((await db.get('routine_block_steps').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    prescriptions: ((await db.get('routine_exercise_prescriptions').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    transitions: ((await db.get('block_transitions').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    sessions: ((await db.get('workout_sessions').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    sessionExercises: ((await db.get('session_exercises').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    setLogs: ((await db.get('set_logs').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    readinessTests: ((await db.get('readiness_tests').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    equipmentItems: ((await db.get('equipment_items').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    programs: ((await db.get('programs').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    mesocycles: ((await db.get('mesocycles').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
    goals: ((await db.get('goals').query().fetch()) as unknown as any[]).map((r) => ({ ...r._raw ?? r })),
  };

  try {
    await db.write(async () => {
      // Clear existing logical data (sessions → logs cascade manually).
      const oldLogs = await db.get('set_logs').query().fetch();
      for (const l of oldLogs) await l.markAsDeleted();
      hooks.onRowCreated?.('set_logs_deleted', oldLogs.length);
      const oldSe = await db.get('session_exercises').query().fetch();
      for (const s of oldSe) await s.markAsDeleted();
      const oldSessions = await db.get('workout_sessions').query().fetch();
      for (const s of oldSessions) await s.markAsDeleted();
      const oldRoutines = await db.get('routines').query().fetch();
      for (const r of oldRoutines) {
        const blocks = await db.get('routine_blocks').query(Q.where('routine_id', r.id)).fetch();
        for (const b of blocks) {
          const steps = await db.get('routine_block_steps').query(Q.where('block_id', b.id)).fetch();
          for (const st of steps) {
            const ps = await db.get('routine_exercise_prescriptions').query(Q.where('step_id', st.id)).fetch();
            for (const p of ps) await p.markAsDeleted();
            await st.markAsDeleted();
          }
          const ts = await db.get('block_transitions').query(Q.where('block_id', b.id)).fetch();
          for (const t of ts) await t.markAsDeleted();
          await b.markAsDeleted();
        }
        await r.markAsDeleted();
      }
      const oldEx = await db.get('exercises').query().fetch();
      for (const e of oldEx) await e.markAsDeleted();
      const oldReadiness = await db.get('readiness_tests').query().fetch();
      for (const r of oldReadiness) await r.markAsDeleted();
      const oldEquipment = await db.get('equipment_items').query().fetch();
      for (const e of oldEquipment) await e.markAsDeleted();
      const oldPrograms = await db.get('programs').query().fetch();
      for (const p of oldPrograms) await p.markAsDeleted();
      const oldMesos = await db.get('mesocycles').query().fetch();
      for (const m of oldMesos) await m.markAsDeleted();
      const oldGoals = await db.get('goals').query().fetch();
      for (const g of oldGoals) await g.markAsDeleted();

      // Insert backup content. Map package keys → new local exercise ids.
      const keyToId = new Map<string, string>();
      let exCount = 0;
      let routineCreated = false;
      for (const ex of backup.data.exercises) {
        const row = await db.get<any>('exercises').create((rec: any) => {
          rec.name = ex.name;
          rec.category = ex.category;
          rec.equipment = ex.equipment;
          rec.metricFlags = ex.metricFlags;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        keyToId.set(ex.key, row.id);
        exCount += 1;
        hooks.onRowCreated?.('exercises', exCount);
      }

      // Goals after exercises: remap package exercise keys to new local ids.
      let goalN = 0;
      for (const g of backup.data.goals ?? []) {
        const targetId = keyToId.get(g.exerciseKey);
        if (targetId == null) throw new PortabilityError('dangling_exercise', 'goals.exerciseKey');
        await db.get<any>('goals').create((rec: any) => {
          rec.exerciseId = targetId;
          rec.targetWeightGrams = g.targetWeightGrams;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        goalN += 1;
        hooks.onRowCreated?.('goals', goalN);
      }

      // Programs first so routine membership can reference them by index.
      const programIds: string[] = [];
      let programN = 0;
      for (const p of backup.data.programs ?? []) {
        const row = await db.get<any>('programs').create((rec: any) => {
          rec.name = p.name;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        programIds.push(row.id);
        programN += 1;
        hooks.onRowCreated?.('programs', programN);
      }

      // Mesocycles next: phases belong to programs, routines to phases.
      const mesoIds: string[] = [];
      let mesoN = 0;
      for (const m of backup.data.mesocycles ?? []) {
        const row = await db.get<any>('mesocycles').create((rec: any) => {
          rec.name = m.name;
          rec.programId = programIds[m.programIndex] ?? null;
          rec.sortOrder = m.sortOrder;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        mesoIds.push(row.id);
        mesoN += 1;
        hooks.onRowCreated?.('mesocycles', mesoN);
      }

      const routineIds: string[] = [];
      let blockN = 0;
      for (const r of backup.data.routines) {
        const routine = await db.get<any>('routines').create((rec: any) => {
          rec.name = r.name;
          rec.programId = r.programIndex != null ? programIds[r.programIndex] ?? null : null;
          rec.programOrder = r.programOrder ?? null;
          rec.mesocycleId = r.mesocycleIndex != null ? mesoIds[r.mesocycleIndex] ?? null : null;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        routineCreated = true;
        routineIds.push(routine.id);
        hooks.onRowCreated?.('routines', routineIds.length);
        for (const [bi, b] of r.blocks.entries()) {
          const block = await db.get<any>('routine_blocks').create((rec: any) => {
            rec.routineId = routine.id;
            rec.name = b.name;
            rec.blockKind = b.kind;
            rec.sortOrder = bi;
            rec.rounds = b.kind === 'interval' ? 1 : b.rounds;
            rec.intervalJson = b.kind === 'interval' && b.interval ? JSON.stringify(b.interval) : null;
            rec.createdAt = Date.now();
            rec.updatedAt = Date.now();
          });
          blockN += 1;
          hooks.onRowCreated?.('routine_blocks', blockN);
          void routineCreated;
          for (const [si, s] of b.steps.entries()) {
            const step = await db.get<any>('routine_block_steps').create((rec: any) => {
              rec.blockId = block.id;
              rec.sortOrder = si;
              rec.stepRole = s.role;
              rec.exerciseId = s.exerciseKey ? keyToId.get(s.exerciseKey) ?? null : null;
              rec.createdAt = Date.now();
              rec.updatedAt = Date.now();
            });
            await db.get<any>('routine_exercise_prescriptions').create((rec: any) => {
              rec.stepId = step.id;
              rec.targetSets = s.prescription.targetSets;
              rec.targetRepsMin = s.prescription.targetRepsMin;
              rec.targetRepsMax = s.prescription.targetRepsMax;
              rec.targetDurationMs = s.prescription.targetDurationMs;
              rec.targetWeightGrams = s.prescription.targetWeightGrams;
              rec.targetRir = s.prescription.targetRir;
              rec.tempoEccentricMs = s.prescription.tempo.eccentricMs;
              rec.tempoPauseBottomMs = s.prescription.tempo.pauseBottomMs;
              rec.tempoConcentricMs = s.prescription.tempo.concentricMs;
              rec.tempoPauseTopMs = s.prescription.tempo.pauseTopMs;
              rec.createdAt = Date.now();
              rec.updatedAt = Date.now();
            });
            await db.get<any>('block_transitions').create((rec: any) => {
              rec.blockId = block.id;
              rec.fromStepId = step.id;
              rec.toStepId = null;
              rec.delayMs = s.transition.type === 'immediate' ? 0 : s.transition.delayMs;
              rec.transitionType = s.transition.type;
              rec.createdAt = Date.now();
              rec.updatedAt = Date.now();
            });
          }
        }
      }

      const sessionIds: string[] = [];
      let sesN = 0;
      for (const s of backup.data.sessions) {
        const routineId = s.routineIndex != null ? routineIds[s.routineIndex] ?? null : null;
        const row = await db.get<any>('workout_sessions').create((rec: any) => {
          rec.routineId = routineId;
          rec.name = s.name;
          rec.startedAt = s.startedAt;
          rec.endedAt = s.endedAt;
          rec.sessionStatus = s.status;
          rec.note = s.note ?? null;
          rec.definitionJson = s.definitionJson;
          rec.cursorJson = s.cursorJson;
          rec.currentBlockIndex = s.currentBlockIndex;
          rec.currentStepId = s.currentStepId;
          rec.currentRound = s.currentRound;
          rec.currentSetIndex = s.currentSetIndex;
          rec.timerExpiresAt = s.timerExpiresAt;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        sessionIds.push(row.id);
        sesN += 1;
        hooks.onRowCreated?.('workout_sessions', sesN);
      }

      const seIds: string[] = [];
      for (const se of backup.data.sessionExercises) {
        const row = await db.get<any>('session_exercises').create((rec: any) => {
          rec.sessionId = sessionIds[se.sessionIndex];
          rec.exerciseId = se.exerciseKey ? keyToId.get(se.exerciseKey) ?? null : null;
          rec.exerciseName = se.exerciseName;
          rec.blockIndex = se.blockIndex;
          rec.orderIndex = se.orderIndex;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        seIds.push(row.id);
      }

      let logN = 0;
      for (const log of backup.data.setLogs) {
        await db.get<any>('set_logs').create((rec: any) => {
          rec.sessionExerciseId = seIds[log.sessionExerciseIndex];
          rec.blockIndex = log.blockIndex;
          rec.stepIndex = log.stepIndex;
          rec.round = log.round;
          rec.setIndex = log.setIndex;
          rec.weightGrams = log.weightGrams;
          rec.reps = log.reps;
          rec.durationMs = log.durationMs;
          rec.distanceMm = log.distanceMm;
          rec.rir = log.rir;
          rec.isCompleted = log.isCompleted;
          rec.completedAt = log.completedAt;
          rec.executionType = log.executionType ?? null;
          rec.overrideReason = log.overrideReason ?? null;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        logN += 1;
        hooks.onRowCreated?.('set_logs', logN);
      }

      const readinessList = backup.data.readinessTests ?? [];
      let rtN = 0;
      for (const rt of readinessList) {
        await db.get<any>('readiness_tests').create((rec: any) => {
          rec.testedAt = rt.testedAt;
          rec.durationMs = rt.durationMs;
          rec.tapCount = rt.tapCount;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        rtN += 1;
        hooks.onRowCreated?.('readiness_tests', rtN);
      }

      const equipmentList = backup.data.equipmentItems ?? [];
      let eqN = 0;
      for (const item of equipmentList) {
        await db.get<any>('equipment_items').create((rec: any) => {
          rec.name = item.name;
          rec.weightGrams = item.weightGrams;
          rec.quantity = item.quantity;
          rec.perSide = item.perSide ? 1 : 0;
          rec.createdAt = Date.now();
          rec.updatedAt = Date.now();
        });
        eqN += 1;
        hooks.onRowCreated?.('equipment_items', eqN);
      }
    });
  } catch (e) {
    // Compensating rollback: wipe whatever was written this call, restore snapshot.
    try {
      await db.write(async () => {
        for (const l of await db.get('set_logs').query().fetch()) await l.markAsDeleted();
        for (const s of await db.get('session_exercises').query().fetch()) await s.markAsDeleted();
        for (const s of await db.get('workout_sessions').query().fetch()) await s.markAsDeleted();
        for (const r of await db.get('routines').query().fetch()) {
          for (const b of await db.get('routine_blocks').query(Q.where('routine_id', r.id)).fetch()) {
            for (const st of await db.get('routine_block_steps').query(Q.where('block_id', b.id)).fetch()) {
              for (const p of await db.get('routine_exercise_prescriptions').query(Q.where('step_id', st.id)).fetch()) {
                await p.markAsDeleted();
              }
              await st.markAsDeleted();
            }
            for (const t of await db.get('block_transitions').query(Q.where('block_id', b.id)).fetch()) {
              await t.markAsDeleted();
            }
            await b.markAsDeleted();
          }
          await r.markAsDeleted();
        }
        for (const e of await db.get('exercises').query().fetch()) await e.markAsDeleted();
        for (const r of await db.get('readiness_tests').query().fetch()) await r.markAsDeleted();
        for (const e of await db.get('equipment_items').query().fetch()) await e.markAsDeleted();
        for (const p of await db.get('programs').query().fetch()) await p.markAsDeleted();
        for (const m of await db.get('mesocycles').query().fetch()) await m.markAsDeleted();
        for (const g of await db.get('goals').query().fetch()) await g.markAsDeleted();

        // Re-insert snapshot rows (raw create with original ids where possible).
        const idMap = new Map<string, string>();
        for (const raw of snap.exercises) {
          const row = await db.get('exercises').create((rec: any) => {
            rec.name = raw.name;
            rec.category = raw.category;
            rec.equipment = raw.equipment;
            rec.metricFlags = raw.metricFlags;
            rec.createdAt = raw.created_at ?? raw.createdAt ?? Date.now();
            rec.updatedAt = raw.updated_at ?? raw.updatedAt ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        // Goals after exercises so exercise_id remaps via idMap.
        for (const raw of snap.goals ?? []) {
          await db.get('goals').create((rec: any) => {
            rec.exerciseId = idMap.get(raw.exercise_id) ?? raw.exercise_id;
            rec.targetWeightGrams = raw.target_weight_grams;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
        }
        // Programs before routines so program_id remaps via idMap.
        for (const raw of snap.programs) {
          const row = await db.get('programs').create((rec: any) => {
            rec.name = raw.name;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        // Mesocycles before routines so mesocycle_id remaps via idMap.
        for (const raw of snap.mesocycles) {
          const row = await db.get('mesocycles').create((rec: any) => {
            rec.name = raw.name;
            rec.programId = idMap.get(raw.program_id) ?? raw.program_id;
            rec.sortOrder = raw.sort_order;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        for (const raw of snap.routines) {
          const row = await db.get('routines').create((rec: any) => {
            rec.name = raw.name;
            rec.programId = raw.program_id ? idMap.get(raw.program_id) ?? null : null;
            rec.programOrder = raw.program_order ?? null;
            rec.mesocycleId = raw.mesocycle_id ? idMap.get(raw.mesocycle_id) ?? null : null;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        const routineIdOf = (oldId: string) => idMap.get(oldId) ?? oldId;
        for (const raw of snap.blocks) {
          const row = await db.get('routine_blocks').create((rec: any) => {
            rec.routineId = routineIdOf(raw.routine_id);
            rec.name = raw.name;
            rec.blockKind = raw.block_kind;
            rec.sortOrder = raw.sort_order;
            rec.rounds = raw.rounds;
            rec.intervalJson = raw.interval_json ?? null;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        const blockIdOf = (oldId: string) => idMap.get(oldId) ?? oldId;
        for (const raw of snap.steps) {
          const row = await db.get('routine_block_steps').create((rec: any) => {
            rec.blockId = blockIdOf(raw.block_id);
            rec.sortOrder = raw.sort_order;
            rec.stepRole = raw.step_role;
            rec.exerciseId = raw.exercise_id ? idMap.get(raw.exercise_id) ?? null : null;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        const stepIdOf = (oldId: string) => idMap.get(oldId) ?? oldId;
        for (const raw of snap.prescriptions) {
          const row = await db.get('routine_exercise_prescriptions').create((rec: any) => {
            rec.stepId = stepIdOf(raw.step_id);
            rec.targetSets = raw.target_sets;
            rec.targetRepsMin = raw.target_reps_min;
            rec.targetRepsMax = raw.target_reps_max;
            rec.targetDurationMs = raw.target_duration_ms;
            rec.targetWeightGrams = raw.target_weight_grams;
            rec.targetRir = raw.target_rir;
            rec.tempoEccentricMs = raw.tempo_eccentric_ms;
            rec.tempoPauseBottomMs = raw.tempo_pause_bottom_ms;
            rec.tempoConcentricMs = raw.tempo_concentric_ms;
            rec.tempoPauseTopMs = raw.tempo_pause_top_ms;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        for (const raw of snap.transitions) {
          const row = await db.get('block_transitions').create((rec: any) => {
            rec.blockId = blockIdOf(raw.block_id);
            rec.fromStepId = stepIdOf(raw.from_step_id);
            rec.toStepId = raw.to_step_id ? stepIdOf(raw.to_step_id) : null;
            rec.delayMs = raw.delay_ms;
            rec.transitionType = raw.transition_type;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        for (const raw of snap.sessions) {
          const row = await db.get('workout_sessions').create((rec: any) => {
            rec.routineId = raw.routine_id ? idMap.get(raw.routine_id) ?? null : null;
            rec.name = raw.name;
            rec.startedAt = raw.started_at;
            rec.endedAt = raw.ended_at;
            rec.sessionStatus = raw.session_status;
            rec.note = raw.note ?? null;
            rec.definitionJson = raw.definition_json;
            rec.cursorJson = raw.cursor_json;
            rec.currentBlockIndex = raw.current_block_index;
            rec.currentStepId = raw.current_step_id;
            rec.currentRound = raw.current_round;
            rec.currentSetIndex = raw.current_set_index;
            rec.timerExpiresAt = raw.timer_expires_at;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        const sessionIdOf = (oldId: string) => idMap.get(oldId) ?? oldId;
        for (const raw of snap.sessionExercises) {
          const row = await db.get('session_exercises').create((rec: any) => {
            rec.sessionId = sessionIdOf(raw.session_id);
            rec.exerciseId = raw.exercise_id ? idMap.get(raw.exercise_id) ?? null : null;
            rec.exerciseName = raw.exercise_name;
            rec.blockIndex = raw.block_index;
            rec.orderIndex = raw.order_index;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        const seIdOf = (oldId: string) => idMap.get(oldId) ?? oldId;
        for (const raw of snap.setLogs) {
          const row = await db.get('set_logs').create((rec: any) => {
            rec.sessionExerciseId = seIdOf(raw.session_exercise_id);
            rec.blockIndex = raw.block_index;
            rec.stepIndex = raw.step_index;
            rec.round = raw.round;
            rec.setIndex = raw.set_index;
            rec.weightGrams = raw.weight_grams;
            rec.reps = raw.reps;
            rec.durationMs = raw.duration_ms;
            rec.distanceMm = raw.distance_mm;
            rec.rir = raw.rir;
            rec.isCompleted = raw.is_completed;
            rec.completedAt = raw.completed_at;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
          idMap.set(raw.id, row.id);
        }
        for (const raw of snap.readinessTests ?? []) {
          await db.get('readiness_tests').create((rec: any) => {
            rec.testedAt = raw.tested_at;
            rec.durationMs = raw.duration_ms;
            rec.tapCount = raw.tap_count;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
        }
        for (const raw of snap.equipmentItems ?? []) {
          await db.get('equipment_items').create((rec: any) => {
            rec.name = raw.name;
            rec.weightGrams = raw.weight_grams;
            rec.quantity = raw.quantity;
            rec.perSide = raw.per_side;
            rec.createdAt = raw.created_at ?? Date.now();
            rec.updatedAt = raw.updated_at ?? Date.now();
          });
        }
      });
    } catch {
      // Best-effort — original error still thrown below.
    }
    throw e;
  }
}

/** Human-facing summary for restore confirmation. */
export function backupSummary(backup: ApexBackup): {
  exercises: number;
  routines: number;
  sessions: number;
  setLogs: number;
  readinessTests: number;
  equipmentItems: number;
  programs: number;
  mesocycles: number;
  goals: number;
} {
  return {
    exercises: backup.data.exercises.length,
    routines: backup.data.routines.length,
    sessions: backup.data.sessions.length,
    setLogs: backup.data.setLogs.length,
    readinessTests: backup.data.readinessTests?.length ?? 0,
    equipmentItems: backup.data.equipmentItems?.length ?? 0,
    programs: backup.data.programs?.length ?? 0,
    mesocycles: backup.data.mesocycles?.length ?? 0,
    goals: backup.data.goals?.length ?? 0,
  };
}
