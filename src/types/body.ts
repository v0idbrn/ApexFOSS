/** Extensible body-measurement vocabulary (v1.0). Display labels live in i18n strings. */

export enum BodyMeasurementType {
  BodyWeight = 'body_weight',
  Waist = 'waist',
  Neck = 'neck',
  Chest = 'chest',
  Shoulders = 'shoulders',
  Hip = 'hip',
  UpperArm = 'upper_arm',
  Forearm = 'forearm',
  Thigh = 'thigh',
  Calf = 'calf',
}

export const BODY_MEASUREMENT_TYPES: BodyMeasurementType[] = [
  BodyMeasurementType.BodyWeight,
  BodyMeasurementType.Waist,
  BodyMeasurementType.Neck,
  BodyMeasurementType.Chest,
  BodyMeasurementType.Shoulders,
  BodyMeasurementType.Hip,
  BodyMeasurementType.UpperArm,
  BodyMeasurementType.Forearm,
  BodyMeasurementType.Thigh,
  BodyMeasurementType.Calf,
];

/** Canonical integer storage units: body weight in grams, circumferences in millimeters. */
export const BODY_STORAGE_UNITS: Record<BodyMeasurementType, 'g' | 'mm'> = {
  [BodyMeasurementType.BodyWeight]: 'g',
  [BodyMeasurementType.Waist]: 'mm',
  [BodyMeasurementType.Neck]: 'mm',
  [BodyMeasurementType.Chest]: 'mm',
  [BodyMeasurementType.Shoulders]: 'mm',
  [BodyMeasurementType.Hip]: 'mm',
  [BodyMeasurementType.UpperArm]: 'mm',
  [BodyMeasurementType.Forearm]: 'mm',
  [BodyMeasurementType.Thigh]: 'mm',
  [BodyMeasurementType.Calf]: 'mm',
};

export function isBilateralMeasurement(type: string): boolean {
  return (
    type === BodyMeasurementType.UpperArm ||
    type === BodyMeasurementType.Forearm ||
    type === BodyMeasurementType.Thigh ||
    type === BodyMeasurementType.Calf
  );
}
