import React from 'react';
import { Text } from 'react-native';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import {
  SessionProgressionSummary,
  progressionStateLabel,
  progressionReasonLabel,
  progressionStateTone,
} from './ProgressionCard';
import { strings, setStringsLocale, getActiveStringsLocale, type Locale } from '../constants/strings';
import type { ProgressionEvidence, ProgressionReason, ProgressionState } from '../analytics/progression';

/**
 * Phase 3B UI contract: the card consumes the engine's ProgressionEvidence —
 * states distinguishable without color, reason codes localized EN/ES, and no
 * suggested weight unless the engine actually produced one.
 */

const NOW = 1_700_000_000_000;
const DAY = 86_400_000;

function evidence(overrides: Partial<ProgressionEvidence> = {}): ProgressionEvidence {
  return {
    state: 'progress',
    reason: 'REPS_RANGE_COMPLETED',
    explanation: 'test-only explanation',
    baseline: {
      exerciseName: 'Bench Press',
      exerciseId: 'ex1',
      timestampMs: NOW - DAY,
      sessionId: 's1',
      weightGrams: 50_000,
      reps: 10,
      actualRir: null,
      actualTempo: null,
      equipmentClass: 'barbell',
      isSubstitution: false,
      prescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
      estimated1rmGrams: null,
    },
    current: {
      exerciseName: 'Bench Press',
      exerciseId: 'ex1',
      timestampMs: NOW,
      sessionId: 's2',
      weightGrams: 50_000,
      reps: 12,
      actualRir: null,
      actualTempo: null,
      equipmentClass: 'barbell',
      isSubstitution: false,
      prescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
      estimated1rmGrams: null,
    },
    comparableCount: 2,
    currentPrescription: { targetRepsMin: 8, targetRepsMax: 12, targetWeightGrams: 50_000, targetRir: 2, tempo: null },
    comparability: {
      comparable: true,
      mismatches: [],
      identityMatch: 'seed_id',
      prescriptionMatch: true,
      equipmentMatch: true,
      rirAvailable: false,
      tempoAvailable: false,
    },
    atTargetWeight: true,
    repsVsRange: { achieved: 12, min: 8, max: 12 },
    weightIncrementSource: 'none',
    ...overrides,
  };
}

function flatten(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(flatten).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return '';
}

function textsOf(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => flatten(node.props.children));
}

async function renderCard(ev: ProgressionEvidence, testID = 'prog-card'): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SessionProgressionSummary evidence={ev} testID={testID} />);
  });
  return renderer;
}

// react-test-renderer act shim (match existing screen-test style).
const act = (require('react-test-renderer') as typeof import('react-test-renderer')).act;

describe('SessionProgressionSummary states', () => {
  it('renders the progress state with comparison evidence', async () => {
    const renderer = await renderCard(evidence());
    expect(textsOf(renderer)).toContain(strings.progression.stateProgress);
    expect(textsOf(renderer)).toContain(strings.progression.reason.REPS_RANGE_COMPLETED);
    expect(textsOf(renderer).join(' ')).toContain(strings.progression.sessionsCompared);
  });

  it('renders the maintain state from the engine verdict', async () => {
    const renderer = await renderCard(evidence({ state: 'maintain', reason: 'REPS_IN_RANGE', atTargetWeight: false }));
    expect(textsOf(renderer)).toContain(strings.progression.stateMaintain);
    expect(textsOf(renderer)).toContain(strings.progression.reason.REPS_IN_RANGE);
  });

  it('renders the insufficient state with the comparability hint and no fake facts', async () => {
    const renderer = await renderCard(
      evidence({
        state: 'insufficient_data',
        reason: 'INSUFFICIENT_HISTORY',
        baseline: undefined,
        current: undefined,
        comparability: undefined,
      }),
    );
    expect(textsOf(renderer)).toContain(strings.progression.stateInsufficient);
    expect(textsOf(renderer)).toContain(strings.progression.insufficientHint);
    expect(textsOf(renderer)).not.toContain(strings.progression.comparedAgainst);
  });

  it('does not show a weight suggestion when no source exists', async () => {
    const renderer = await renderCard(evidence({ suggestedWeightGrams: undefined, weightIncrementSource: 'none' }));
    expect(renderer.root.findAllByProps({ testID: 'prog-card-next-weight' })).toHaveLength(0);
    expect(textsOf(renderer)).not.toContain(strings.progression.nextWeight);
  });

  it('shows the inventory-backed suggestion exactly when the engine supplies it', async () => {
    const renderer = await renderCard(
      evidence({ suggestedWeightGrams: 55_000, weightIncrementSource: 'equipment_inventory' }),
    );
    expect(renderer.root.findAllByProps({ testID: 'prog-card-next-weight' }).length).toBeGreaterThanOrEqual(1);
    expect(textsOf(renderer)).toContain(strings.progression.nextWeight);
    expect(textsOf(renderer).join(' ')).toContain('55');
  });
});

describe('SessionProgressionSummary accessibility', () => {
  it('distinguishes the three states without relying on color alone', () => {
    const states: ProgressionState[] = ['progress', 'maintain', 'insufficient_data'];
    const labels = states.map(progressionStateLabel);
    expect(new Set(labels).size).toBe(3);
    const tones = states.map(progressionStateTone);
    expect(new Set(tones).size).toBe(3);
  });

  it('keeps reason labels distinct for every stable reason code', () => {
    const reasons: ProgressionReason[] = [
      'REPS_RANGE_COMPLETED',
      'REPS_EXCEEDED_RANGE',
      'REPS_BELOW_MIN',
      'REPS_IN_RANGE',
      'INSUFFICIENT_HISTORY',
      'NO_COMPARABLE_PERFORMANCE',
      'PRESCRIPTION_MISMATCH',
      'NO_REPS_RANGE',
      'NO_CURRENT_WEIGHT',
      'NO_RIR_DATA',
      'SUBSTITUTION_USED',
      'PREVIOUS_SUBSTITUTION',
      'EQUIPMENT_MISMATCH',
      'TEMPO_MISMATCH',
    ];
    const labels = reasons.map(progressionReasonLabel);
    expect(new Set(labels).size).toBe(reasons.length);
    for (const label of labels) expect(label).not.toBe('');
  });
});

describe('SessionProgressionSummary i18n (EN/ES)', () => {
  const original: Locale = getActiveStringsLocale();

  afterEach(() => {
    setStringsLocale(original);
  });

  it('renders Spanish labels under the es locale', async () => {
    setStringsLocale('es');
    const renderer = await renderCard(evidence());
    expect(textsOf(renderer)).toContain('Progresando');
    expect(textsOf(renderer)).toContain(
      strings.progression.reason.REPS_RANGE_COMPLETED,
    );
  });

  it('renders English labels under the en locale', async () => {
    setStringsLocale('en');
    const renderer = await renderCard(evidence({ state: 'maintain', reason: 'REPS_IN_RANGE' }));
    expect(textsOf(renderer)).toContain('Maintaining');
    expect(textsOf(renderer)).toContain(strings.progression.reason.REPS_IN_RANGE);
  });
});
