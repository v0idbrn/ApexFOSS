import { MetricFlag } from '../src/types';

export interface SeedExercise {
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}

/** ~20 basic starter exercises seeded on first launch (edit later in Exercises). */
export const SEED_EXERCISES: SeedExercise[] = [
  { name: 'Back Squat', category: 'legs', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Front Squat', category: 'legs', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Deadlift', category: 'legs', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Romanian Deadlift', category: 'legs', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Bench Press', category: 'push', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Incline Bench Press', category: 'push', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Overhead Press', category: 'push', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Barbell Row', category: 'pull', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Pull-up', category: 'pull', equipment: 'bodyweight', metricFlags: MetricFlag.REPS | MetricFlag.WEIGHT },
  { name: 'Box Jump', category: 'power', equipment: 'box', metricFlags: MetricFlag.REPS },
  { name: 'Push-up', category: 'push', equipment: 'bodyweight', metricFlags: MetricFlag.REPS },
  { name: 'Dip', category: 'push', equipment: 'bodyweight', metricFlags: MetricFlag.REPS | MetricFlag.WEIGHT },
  { name: 'Lunge', category: 'legs', equipment: 'dumbbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Hip Thrust', category: 'legs', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Plank', category: 'core', equipment: 'bodyweight', metricFlags: MetricFlag.DURATION },
  { name: 'Hang Clean', category: 'power', equipment: 'barbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS },
  { name: 'Sled Push', category: 'power', equipment: 'sled', metricFlags: MetricFlag.WEIGHT | MetricFlag.DISTANCE },
  { name: 'Rowing Interval', category: 'conditioning', equipment: 'machine', metricFlags: MetricFlag.DURATION | MetricFlag.DISTANCE },
  { name: 'Farmer Carry', category: 'carry', equipment: 'dumbbell', metricFlags: MetricFlag.WEIGHT | MetricFlag.DISTANCE },
  { name: 'Wall Sit', category: 'isometrics', equipment: 'bodyweight', metricFlags: MetricFlag.DURATION },
];
