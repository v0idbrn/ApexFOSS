import { Model } from '@nozbe/watermelondb';
import { field, text, children } from '@nozbe/watermelondb/decorators';

export class Exercise extends Model {
  static table = 'exercises';
  static associations = {
    routine_block_steps: { type: 'has_many' as const, foreignKey: 'exercise_id' },
  };

  @text('name') name!: string;
  @text('category') category!: string;
  @text('equipment') equipment!: string;
  @field('metric_flags') metricFlags!: number;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export class Routine extends Model {
  static table = 'routines';
  static associations = {
    routine_blocks: { type: 'has_many' as const, foreignKey: 'routine_id' },
    workout_sessions: { type: 'has_many' as const, foreignKey: 'routine_id' },
  };

  @text('name') name!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
  @children('routine_blocks') blocks!: any;
}

export class RoutineBlock extends Model {
  static table = 'routine_blocks';
  static associations = {
    routine_block_steps: { type: 'has_many' as const, foreignKey: 'block_id' },
    block_transitions: { type: 'has_many' as const, foreignKey: 'block_id' },
  };

  @text('routine_id') routineId!: string;
  @text('name') name!: string;
  @text('block_kind') blockKind!: string;
  @field('sort_order') sortOrder!: number;
  @field('rounds') rounds!: number;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
  @children('routine_block_steps') steps!: any;
  @children('block_transitions') transitions!: any;
}

export class RoutineBlockStep extends Model {
  static table = 'routine_block_steps';
  static associations = {
    routine_exercise_prescriptions: { type: 'has_many' as const, foreignKey: 'step_id' },
  };

  @text('block_id') blockId!: string;
  @field('sort_order') sortOrder!: number;
  @text('step_role') stepRole!: string;
  @text('exercise_id') exerciseId!: string | null;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
  @children('routine_exercise_prescriptions') prescriptions!: any;
}

export class Prescription extends Model {
  static table = 'routine_exercise_prescriptions';

  @text('step_id') stepId!: string;
  @field('target_sets') targetSets!: number | null;
  @field('target_reps_min') targetRepsMin!: number | null;
  @field('target_reps_max') targetRepsMax!: number | null;
  @field('target_duration_ms') targetDurationMs!: number | null;
  @field('target_weight_grams') targetWeightGrams!: number | null;
  @field('target_rir') targetRir!: number | null;
  @field('tempo_eccentric_ms') tempoEccentricMs!: number | null;
  @field('tempo_pause_bottom_ms') tempoPauseBottomMs!: number | null;
  @field('tempo_concentric_ms') tempoConcentricMs!: number | null;
  @field('tempo_pause_top_ms') tempoPauseTopMs!: number | null;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export class BlockTransition extends Model {
  static table = 'block_transitions';

  @text('block_id') blockId!: string;
  @text('from_step_id') fromStepId!: string;
  @text('to_step_id') toStepId!: string | null;
  @field('delay_ms') delayMs!: number;
  @text('transition_type') transitionType!: string;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export class WorkoutSession extends Model {
  static table = 'workout_sessions';

  @text('routine_id') routineId!: string | null;
  @text('name') name!: string;
  @field('started_at') startedAt!: number;
  @field('ended_at') endedAt!: number | null;
  @text('session_status') sessionStatus!: string;
  @text('definition_json') definitionJson!: string;
  @text('cursor_json') cursorJson!: string;
  @field('current_block_index') currentBlockIndex!: number;
  @text('current_step_id') currentStepId!: string | null;
  @field('current_round') currentRound!: number;
  @field('current_set_index') currentSetIndex!: number;
  @field('timer_expires_at') timerExpiresAt!: number | null;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export class SessionExercise extends Model {
  static table = 'session_exercises';
  static associations = {
    set_logs: { type: 'has_many' as const, foreignKey: 'session_exercise_id' },
  };

  @text('session_id') sessionId!: string;
  @text('exercise_id') exerciseId!: string | null;
  @text('exercise_name') exerciseName!: string;
  @field('block_index') blockIndex!: number;
  @field('order_index') orderIndex!: number;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export class SetLog extends Model {
  static table = 'set_logs';

  @text('session_exercise_id') sessionExerciseId!: string;
  @field('block_index') blockIndex!: number;
  @field('step_index') stepIndex!: number;
  @field('round') round!: number;
  @field('set_index') setIndex!: number;
  @field('weight_grams') weightGrams!: number | null;
  @field('reps') reps!: number | null;
  @field('duration_ms') durationMs!: number | null;
  @field('distance_mm') distanceMm!: number | null;
  @field('rir') rir!: number | null;
  @field('is_completed') isCompleted!: number;
  @field('completed_at') completedAt!: number | null;
  @field('created_at') createdAt!: number;
  @field('updated_at') updatedAt!: number;
}

export const modelClasses = [
  Exercise,
  Routine,
  RoutineBlock,
  RoutineBlockStep,
  Prescription,
  BlockTransition,
  WorkoutSession,
  SessionExercise,
  SetLog,
];
