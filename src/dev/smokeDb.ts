import { database } from '../data';
import { makeDbActions } from '../data/actions';
import { dispatch } from '../engine';
import { initialCursor } from '../engine/cursor';
import type { RoutineDefinition } from '../types/engine';

/**
 * Day 1 on-device smoke (real native SQLite + JSI, NOT LokiJS):
 * create → write → read → engine dispatch → applyEffects → reopen roundtrip.
 * One-shot per launch: cleans up its own artifacts, reruns, logs [SMOKE] lines
 * and returns a structured result for the UI.
 */

export interface SmokeResult {
  ok: boolean;
  lines: string[];
}

function log(lines: string[], msg: string, extra?: unknown) {
  const text = extra === undefined ? msg : `${msg} ${JSON.stringify(extra)}`;
  lines.push(text);
  console.log(`[SMOKE] ${text}`);
}

export async function runDbSmoke(): Promise<SmokeResult> {
  const lines: string[] = [];
  let smokeRoutineId: string | null = null;
  log(lines, 'start');
  try {
    // JSI proof: the native binding registers this global into the JS runtime.
    const jsiInstalled = Boolean((globalThis as any).nativeWatermelonCreateAdapter);
    log(lines, 'jsi global installed ->', jsiInstalled);
    if (!jsiInstalled) throw new Error('JSI binding NOT installed (async fallback in use)');

    const actions = makeDbActions(database);

    // 0) seed exercises (inserts real rows on first launch)
    const seeded = await actions.seedExercisesIfEmpty();
    log(lines, 'seedExercisesIfEmpty ->', seeded);

    // 1) create exercise
    const exId = await actions.createExercise({
      name: 'SMOKE Exercise',
      category: 'smoke',
      equipment: 'barbell',
      metricFlags: 0b101,
    });
    log(lines, 'createExercise ->', exId);

    // 2) write (update)
    await actions.updateExercise(exId, {
      name: 'SMOKE Exercise v2',
      category: 'smoke',
      equipment: 'barbell',
      metricFlags: 0b101,
    });
    log(lines, 'updateExercise ok');

    // 3) read back
    const all = await actions.listExercises();
    const ex = all.find((e) => e.id === exId);
    log(lines, 'listExercises count', all.length);
    log(lines, 'read back', ex ? { name: ex.name, equipment: ex.equipment, metricFlags: ex.metricFlags } : null);
    if (!ex || ex.name !== 'SMOKE Exercise v2' || ex.metricFlags !== 0b101) {
      throw new Error('create/update/read roundtrip FAILED');
    }

    // 4) session + engine dispatch + applyEffects (real cursor persistence)
    smokeRoutineId = await actions.createRoutine('SMOKE Routine');
    const routine = { id: smokeRoutineId, name: 'SMOKE Routine' };
    const definition: RoutineDefinition = {
      id: 'smoke-def',
      name: 'SMOKE Routine',
      blocks: [
        {
          id: 'smoke-block-1',
          name: 'SMOKE Block',
          kind: 'normal',
          rounds: 2,
          steps: [
            {
              id: 'smoke-step-1',
              role: 'work',
              exerciseId: exId,
              exerciseName: 'SMOKE Exercise v2',
              prescription: {
                targetSets: 2,
                targetRepsMin: 8,
                targetRepsMax: 10,
                targetDurationMs: null,
                targetWeightGrams: 40000,
                targetRir: 2,
                tempo: { eccentricMs: null, pauseBottomMs: null, concentricMs: null, pauseTopMs: null },
              },
            },
          ],
          transitions: [],
        },
      ],
    };
    const sessionId = await actions.startSession(routine as any, definition);
    log(lines, 'startSession ->', sessionId);

    const session = await actions.getActiveSession();
    if (!session || session.id !== sessionId) throw new Error('getActiveSession FAILED');
    log(lines, 'getActiveSession ok');

    let cursor = initialCursor(definition);
    const first = dispatch(definition, cursor, {
      type: 'COMPLETE_SET',
      now: Date.now(),
      set: { weightGrams: 40500, reps: 9, durationMs: null, distanceMm: null, rir: 1 },
    });
    cursor = first.cursor;
    log(lines, 'engine effects', first.effects.map((e) => e.kind));

    await actions.applyEffects(session, cursor, first.effects);
    await actions.persistCursor(session, cursor);
    log(lines, 'applyEffects + persistCursor ok');

    // 5) read set_logs back through a fresh query
    const sesExs = await (database as any).get('session_exercises').query().fetch();
    log(lines, 'session_exercises rows', sesExs.length);
    if (sesExs.length !== 1) throw new Error('expected exactly 1 session_exercise');
    const setLogs = await (database as any).get('set_logs').query().fetch();
    log(lines, 'set_logs rows', setLogs.length);
    if (setLogs.length !== 1) throw new Error('expected exactly 1 set_log');
    const logRow = setLogs[0];
    log(lines, 'set_log', { weight: logRow.weightGrams, reps: logRow.reps, round: logRow.round });

    // 6) reopen roundtrip: re-fetch the session and confirm cursor_json won
    const reopened = await actions.getActiveSession();
    const reopenedCursor = reopened?.cursorJson ? JSON.parse(reopened.cursorJson) : null;
    log(lines, 'reopened cursor status', reopenedCursor?.status ?? null);
    if (!reopenedCursor || reopenedCursor.status !== 'active') throw new Error('cursor_json roundtrip FAILED');

    // 7) engine-driven completion + cleanup of smoke artifacts
    const done = dispatch(definition, cursor, { type: 'COMPLETE_SESSION', now: Date.now() });
    await actions.applyEffects(reopened!, done.cursor, done.effects);
    await actions.persistCursor(reopened!, done.cursor);
    const finalSession = await actions.getActiveSession();
    log(lines, 'after COMPLETE_SESSION ->', finalSession ? 'STILL ACTIVE (unexpected)' : 'none (completed)');

    await actions.discardSession(reopened!);
    const afterDiscard = await actions.getActiveSession();
    log(lines, 'after discardSession ->', afterDiscard ? 'STILL THERE (unexpected)' : 'none');

    await actions.deleteExercise(exId);
    log(lines, 'cleanup ok');

    log(lines, 'RESULT: ALL PASS');
    return { ok: true, lines };
  } catch (e) {
    log(lines, 'RESULT: FAILED', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
    return { ok: false, lines };
  }
}
