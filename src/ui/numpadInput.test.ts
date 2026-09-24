import {
  allNumpadValuesValid,
  applyNumpadKey,
  applyNumpadModifier,
  compatibleModifiers,
  durationStringToMs,
  emptyNumpadInput,
  intStringToNonNegative,
  isValidNumpadValue,
  isCompatibleModifier,
  normalizeNumpadInput,
  readNumpadField,
  weightKgStringToGrams,
  writeNumpadField,
} from './numpadInput';
import { dispatch } from '../engine';
import { initialCursor } from '../engine/cursor';
import type { EngineEvent, RoutineDefinition, SetPayload, StepDef } from '../types/engine';
import { kgToGrams, secondsToMs } from '../utils/units';

const def: RoutineDefinition = {
  id: 'r1',
  name: 'Test',
  blocks: [
    {
      id: 'b1',
      name: 'Main',
      kind: 'normal',
      rounds: 1,
      steps: [
        {
          id: 's1',
          role: 'work',
          exerciseId: null,
          exerciseName: 'Squat',
          prescription: {
            targetSets: 3,
            targetRepsMin: 5,
            targetRepsMax: 8,
            targetDurationMs: null,
            targetWeightGrams: 60000,
            targetRir: 2,
            tempo: {
              eccentricMs: null,
              pauseBottomMs: null,
              concentricMs: null,
              pauseTopMs: null,
            },
          },
        },
      ],
      transitions: [],
    },
  ],
};

describe('athlete numpad input', () => {
  describe('weight field entry', () => {
    it('appends digits for weight', () => {
      expect(applyNumpadKey('', '7', 'weight')).toBe('7');
      expect(applyNumpadKey('7', '0', 'weight')).toBe('70');
      expect(applyNumpadKey('70', '0', 'weight')).toBe('700');
    });

    it('keeps leading zero only until another digit', () => {
      expect(applyNumpadKey('', '0', 'weight')).toBe('0');
      expect(applyNumpadKey('0', '0', 'weight')).toBe('0');
      expect(applyNumpadKey('0', '5', 'weight')).toBe('5');
    });

    it('strips non-numeric noise via normalize', () => {
      expect(normalizeNumpadInput('12a3')).toBe('123');
      expect(normalizeNumpadInput('007')).toBe('7');
    });
  });

  describe('decimal separator', () => {
    it('allows a single decimal on weight', () => {
      expect(applyNumpadKey('', '.', 'weight')).toBe('0.');
      expect(applyNumpadKey('12', '.', 'weight')).toBe('12.');
      expect(applyNumpadKey('12.', '.', 'weight')).toBe('12.');
      expect(applyNumpadKey('12.5', '.', 'weight')).toBe('12.5');
    });

    it('rejects decimal on integer fields', () => {
      expect(applyNumpadKey('5', '.', 'reps')).toBe('5');
      expect(applyNumpadKey('30', '.', 'duration')).toBe('30');
      expect(applyNumpadKey('2', '.', 'rir')).toBe('2');
    });

    it('limits weight fraction to 3 digits (gram precision)', () => {
      let v = applyNumpadKey('12.', '3', 'weight');
      v = applyNumpadKey(v, '4', 'weight');
      expect(v).toBe('12.34');
      v = applyNumpadKey(v, '5', 'weight');
      expect(v).toBe('12.345');
      v = applyNumpadKey(v, '6', 'weight');
      expect(v).toBe('12.345');
    });

    it('locale-independent: only period accepted', () => {
      expect(applyNumpadKey('12', '.', 'weight')).toBe('12.');
      expect(normalizeNumpadInput('12,5')).toBe('125');
    });
  });

  describe('reps and duration fields', () => {
    it('appends integer digits for reps', () => {
      expect(applyNumpadKey('', '1', 'reps')).toBe('1');
      expect(applyNumpadKey('1', '2', 'reps')).toBe('12');
    });

    it('appends integer digits for duration', () => {
      expect(applyNumpadKey('4', '5', 'duration')).toBe('45');
      expect(applyNumpadKey('', '0', 'duration')).toBe('0');
      expect(applyNumpadKey('0', '0', 'duration')).toBe('0');
      expect(applyNumpadKey('0', '9', 'duration')).toBe('9');
    });
  });

  describe('backspace', () => {
    it('removes last character', () => {
      expect(applyNumpadKey('123', 'backspace', 'weight')).toBe('12');
      expect(applyNumpadKey('12.', 'backspace', 'weight')).toBe('12');
      expect(applyNumpadKey('12.3', 'backspace', 'weight')).toBe('12.');
      expect(applyNumpadKey('', 'backspace', 'weight')).toBe('');
      expect(applyNumpadKey('5', 'backspace', 'reps')).toBe('');
    });
  });

  describe('clear', () => {
    it('empties the active value only', () => {
      expect(applyNumpadKey('80.5', 'clear', 'weight')).toBe('');
      expect(applyNumpadKey('12', 'clear', 'reps')).toBe('');
    });

    it('clear via writeNumpadField only touches one field', () => {
      const input = { ...emptyNumpadInput(), weightKg: '80', reps: '5' };
      const next = writeNumpadField(input, 'weight', '');
      expect(next.weightKg).toBe('');
      expect(next.reps).toBe('5');
      expect(readNumpadField(next, 'reps')).toBe('5');
    });
  });

  describe('quick modifiers', () => {
    it('lists kg modifiers only for weight', () => {
      expect(compatibleModifiers('weight')).toEqual(['kg+1.25', 'kg+2.5', 'kg+5']);
      expect(compatibleModifiers('reps')).toEqual(['reps+1', 'reps-1']);
      expect(compatibleModifiers('duration')).toEqual([]);
      expect(compatibleModifiers('rir')).toEqual([]);
      expect(isCompatibleModifier('reps', 'kg+5')).toBe(false);
      expect(isCompatibleModifier('weight', 'reps+1')).toBe(false);
    });

    it('adds kg plate increments to weight', () => {
      expect(applyNumpadModifier('20', 'weight', 'kg+1.25')).toBe('21.25');
      expect(applyNumpadModifier('21.25', 'weight', 'kg+1.25')).toBe('22.5');
      expect(applyNumpadModifier('20', 'weight', 'kg+2.5')).toBe('22.5');
      expect(applyNumpadModifier('20', 'weight', 'kg+5')).toBe('25');
      expect(applyNumpadModifier('', 'weight', 'kg+5')).toBe('5');
    });

    it('does not produce float drift strings', () => {
      expect(applyNumpadModifier('0.1', 'weight', 'kg+1.25')).toBe('1.35');
      expect(applyNumpadModifier('100.005', 'weight', 'kg+1.25')).toBe('101.255');
    });

    it('increments and decrements reps, clamping at zero', () => {
      expect(applyNumpadModifier('5', 'reps', 'reps+1')).toBe('6');
      expect(applyNumpadModifier('5', 'reps', 'reps-1')).toBe('4');
      expect(applyNumpadModifier('0', 'reps', 'reps-1')).toBe('0');
      expect(applyNumpadModifier('', 'reps', 'reps+1')).toBe('1');
      expect(applyNumpadModifier('', 'reps', 'reps-1')).toBe('0');
    });

    it('is a no-op on incompatible fields', () => {
      expect(applyNumpadModifier('30', 'duration', 'kg+5')).toBe('30');
      expect(applyNumpadModifier('2', 'rir', 'reps+1')).toBe('2');
      expect(applyNumpadModifier('80', 'weight', 'reps+1')).toBe('80');
    });
  });

  describe('invalid values', () => {
    it('treats empty as allowed (prescription fallback)', () => {
      expect(isValidNumpadValue('')).toBe(true);
      expect(isValidNumpadValue('   ')).toBe(true);
    });

    it('rejects malformed and negative strings', () => {
      expect(isValidNumpadValue('.')).toBe(false);
      expect(isValidNumpadValue('-5')).toBe(false);
      expect(isValidNumpadValue('abc')).toBe(false);
      expect(isValidNumpadValue('1..2')).toBe(false);
      expect(allNumpadValuesValid({ ...emptyNumpadInput(), weightKg: 'abc' })).toBe(false);
      expect(allNumpadValuesValid(emptyNumpadInput())).toBe(true);
    });

    it('allows trailing decimal point while typing', () => {
      expect(isValidNumpadValue('80.')).toBe(true);
      expect(isValidNumpadValue('80.5')).toBe(true);
      expect(isValidNumpadValue('')).toBe(true);
    });
  });

  describe('switching field', () => {
    it('writes only the targeted field', () => {
      let input = emptyNumpadInput();
      input = writeNumpadField(input, 'weight', applyNumpadKey(readNumpadField(input, 'weight'), '8', 'weight'));
      input = writeNumpadField(input, 'reps', applyNumpadKey(readNumpadField(input, 'reps'), '5', 'reps'));
      expect(input.weightKg).toBe('8');
      expect(input.reps).toBe('5');
      expect(input.durationS).toBe('');
      input = writeNumpadField(input, 'weight', applyNumpadKey(readNumpadField(input, 'weight'), 'backspace', 'weight'));
      expect(input.weightKg).toBe('');
      expect(input.reps).toBe('5');
    });
  });

  describe('integer unit conversion at boundary', () => {
    it('converts display kg string to integer grams', () => {
      expect(weightKgStringToGrams('60')).toBe(60000);
      expect(weightKgStringToGrams('22.5')).toBe(22500);
      expect(weightKgStringToGrams('0.001')).toBe(1);
      expect(weightKgStringToGrams('')).toBeNull();
      expect(weightKgStringToGrams('.')).toBeNull();
      expect(weightKgStringToGrams('abc')).toBeNull();
      expect(Number.isInteger(weightKgStringToGrams('12.345'))).toBe(true);
    });

    it('converts duration seconds string to integer ms', () => {
      expect(durationStringToMs('45')).toBe(45000);
      expect(durationStringToMs('1.5')).toBe(1500);
      expect(durationStringToMs('')).toBeNull();
      expect(durationStringToMs('x')).toBeNull();
      expect(Number.isInteger(durationStringToMs('2.2'))).toBe(true);
    });

    it('parses non-negative integers for reps/rir', () => {
      expect(intStringToNonNegative('8')).toBe(8);
      expect(intStringToNonNegative('0')).toBe(0);
      expect(intStringToNonNegative('3.7')).toBe(4);
      expect(intStringToNonNegative('')).toBeNull();
      expect(intStringToNonNegative('-1')).toBeNull();
    });
  });

  describe('COMPLETE_SET integration with numpad display strings', () => {
    const step = def.blocks[0].steps[0] as StepDef;

    const toPayloadLike = (stepDef: StepDef, input: ReturnType<typeof emptyNumpadInput>): SetPayload => {
      const p = step.prescription;
      const w = input.weightKg.trim();
      const r = input.reps.trim();
      const d = input.durationS.trim();
      const rir = input.rir.trim();
      return {
        weightGrams: w ? kgToGrams(Number(w)) : p.targetWeightGrams,
        reps: r ? Math.max(0, Math.round(Number(r))) : p.targetRepsMin,
        durationMs: d ? secondsToMs(Math.max(0, Number(d))) : p.targetDurationMs,
        distanceMm: null,
        rir: rir ? Math.max(0, Math.round(Number(rir))) : p.targetRir,
      };
    };

    it('persists numpad-entered values as integers through COMPLETE_SET', () => {
      let input = emptyNumpadInput();
      for (const k of ['7', '2', '.', '5'] as const) {
        input = writeNumpadField(input, 'weight', applyNumpadKey(readNumpadField(input, 'weight'), k, 'weight'));
      }
      for (const k of ['6'] as const) {
        input = writeNumpadField(input, 'reps', applyNumpadKey(readNumpadField(input, 'reps'), k, 'reps'));
      }
      input = writeNumpadField(input, 'weight', applyNumpadModifier(readNumpadField(input, 'weight'), 'weight', 'kg+2.5'));

      expect(input.weightKg).toBe('75');
      expect(input.reps).toBe('6');

      const set = toPayloadLike(step, input);
      expect(set.weightGrams).toBe(75000);
      expect(set.reps).toBe(6);
      expect(set.durationMs).toBe(step.prescription.targetDurationMs);
      expect(Number.isInteger(set.weightGrams)).toBe(true);
      expect(Number.isInteger(set.reps)).toBe(true);

      const event: EngineEvent = { type: 'COMPLETE_SET', now: 1, set };
      const { cursor, effects } = dispatch(def, initialCursor(def, 0), event);
      expect(cursor.setIndex).toBe(2);
      expect(cursor.lastReversible).toMatchObject({ kind: 'set', setIndex: 1, setLogId: null });
      expect(effects[0]).toMatchObject({ kind: 'LOG_SET', setIndex: 1, set });
    });

    it('falls back to prescription when a field is left empty', () => {
      const input = emptyNumpadInput();
      const set = toPayloadLike(step, input);
      expect(set.weightGrams).toBe(60000);
      expect(set.reps).toBe(5);
      expect(set.rir).toBe(2);
    });
  });
});
