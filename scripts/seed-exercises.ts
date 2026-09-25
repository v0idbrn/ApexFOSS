import { MetricFlag } from '../src/types';
import type { Contributions } from '../src/analytics/muscles';

export interface SeedExercise {
  /** Deterministic identity — primary key for built-in muscle mapping (Phase 2F). */
  id: string;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
  /**
   * Product muscle contribution weights (integer basis points summing to 10000).
   * Training classification decided by the product — not science, not anatomy.
   */
  contributions: Contributions;
}

/** ~20 basic starter exercises seeded on first launch (edit later in Exercises). */
export const SEED_EXERCISES: SeedExercise[] = [
  {
    id: 'seed_back_squat',
    name: 'Back Squat',
    category: 'legs',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['quads', 5500], ['glutes', 3000], ['adductors', 500], ['lower_back', 500], ['hamstrings', 500]],
  },
  {
    id: 'seed_front_squat',
    name: 'Front Squat',
    category: 'legs',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['quads', 6500], ['glutes', 2000], ['lower_back', 500], ['adductors', 500], ['abs', 500]],
  },
  {
    id: 'seed_deadlift',
    name: 'Deadlift',
    category: 'legs',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['glutes', 3000], ['hamstrings', 2500], ['lower_back', 2500], ['lats', 1000], ['forearms', 500], ['upper_back', 500]],
  },
  {
    id: 'seed_romanian_deadlift',
    name: 'Romanian Deadlift',
    category: 'legs',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['hamstrings', 4000], ['glutes', 3500], ['lower_back', 1500], ['forearms', 500], ['upper_back', 500]],
  },
  {
    id: 'seed_bench_press',
    name: 'Bench Press',
    category: 'push',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['chest', 6000], ['triceps', 2500], ['front_delts', 1500]],
  },
  {
    id: 'seed_incline_bench_press',
    name: 'Incline Bench Press',
    category: 'push',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['chest', 5500], ['front_delts', 2500], ['triceps', 2000]],
  },
  {
    id: 'seed_overhead_press',
    name: 'Overhead Press',
    category: 'push',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['front_delts', 4000], ['side_delts', 2500], ['triceps', 2500], ['upper_back', 1000]],
  },
  {
    id: 'seed_barbell_row',
    name: 'Barbell Row',
    category: 'pull',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['lats', 3500], ['upper_back', 3000], ['rear_delts', 1500], ['biceps', 1500], ['forearms', 500]],
  },
  {
    id: 'seed_pull_up',
    name: 'Pull-up',
    category: 'pull',
    equipment: 'bodyweight',
    metricFlags: MetricFlag.REPS | MetricFlag.WEIGHT,
    contributions: [['lats', 5000], ['biceps', 2000], ['upper_back', 2000], ['forearms', 1000]],
  },
  {
    id: 'seed_box_jump',
    name: 'Box Jump',
    category: 'power',
    equipment: 'box',
    metricFlags: MetricFlag.REPS,
    contributions: [['quads', 4000], ['glutes', 3500], ['calves', 2000], ['hamstrings', 500]],
  },
  {
    id: 'seed_push_up',
    name: 'Push-up',
    category: 'push',
    equipment: 'bodyweight',
    metricFlags: MetricFlag.REPS,
    contributions: [['chest', 5500], ['triceps', 3000], ['front_delts', 1500]],
  },
  {
    id: 'seed_dip',
    name: 'Dip',
    category: 'push',
    equipment: 'bodyweight',
    metricFlags: MetricFlag.REPS | MetricFlag.WEIGHT,
    contributions: [['chest', 4500], ['triceps', 4000], ['front_delts', 1500]],
  },
  {
    id: 'seed_lunge',
    name: 'Lunge',
    category: 'legs',
    equipment: 'dumbbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['quads', 4500], ['glutes', 4000], ['hamstrings', 1000], ['calves', 500]],
  },
  {
    id: 'seed_hip_thrust',
    name: 'Hip Thrust',
    category: 'legs',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['glutes', 7000], ['hamstrings', 2000], ['quads', 1000]],
  },
  {
    id: 'seed_plank',
    name: 'Plank',
    category: 'core',
    equipment: 'bodyweight',
    metricFlags: MetricFlag.DURATION,
    contributions: [['abs', 7000], ['obliques', 2000], ['lower_back', 1000]],
  },
  {
    id: 'seed_hang_clean',
    name: 'Hang Clean',
    category: 'power',
    equipment: 'barbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.REPS,
    contributions: [['quads', 2500], ['glutes', 3000], ['hamstrings', 1500], ['upper_back', 1500], ['front_delts', 1000], ['forearms', 500]],
  },
  {
    id: 'seed_sled_push',
    name: 'Sled Push',
    category: 'power',
    equipment: 'sled',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.DISTANCE,
    contributions: [['quads', 4500], ['glutes', 3000], ['calves', 1500], ['hamstrings', 1000]],
  },
  {
    id: 'seed_rowing_interval',
    name: 'Rowing Interval',
    category: 'conditioning',
    equipment: 'machine',
    metricFlags: MetricFlag.DURATION | MetricFlag.DISTANCE,
    contributions: [['lats', 3500], ['upper_back', 2000], ['biceps', 1500], ['front_delts', 1000], ['hamstrings', 1000], ['glutes', 1000]],
  },
  {
    id: 'seed_farmer_carry',
    name: 'Farmer Carry',
    category: 'carry',
    equipment: 'dumbbell',
    metricFlags: MetricFlag.WEIGHT | MetricFlag.DISTANCE,
    contributions: [['forearms', 4000], ['upper_back', 2000], ['obliques', 1500], ['glutes', 1000], ['lats', 1000], ['abs', 500]],
  },
  {
    id: 'seed_wall_sit',
    name: 'Wall Sit',
    category: 'isometrics',
    equipment: 'bodyweight',
    metricFlags: MetricFlag.DURATION,
    contributions: [['quads', 7000], ['glutes', 2000], ['adductors', 500], ['calves', 500]],
  },
];
