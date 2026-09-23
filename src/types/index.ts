export * from './engine';

/** Bitmask flags for tracked metrics (exercises.metric_flags). */
export const MetricFlag = {
  WEIGHT: 1 << 0,
  REPS: 1 << 1,
  DURATION: 1 << 2,
  DISTANCE: 1 << 3,
} as const;
export type MetricFlagValue = (typeof MetricFlag)[keyof typeof MetricFlag];

export interface ExerciseMeta {
  id: string;
  name: string;
  category: string;
  equipment: string;
  metricFlags: number;
}
