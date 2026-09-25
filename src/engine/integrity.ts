import type { BlockDef, RoutineDefinition } from '../types/engine';

/**
 * Routine integrity checks (Phase 2J §15).
 * Pure diagnostics over a RoutineDefinition — runs on previews (draft-converted),
 * stored snapshots and anything else that produces a definition.
 * Never throws; returns an ordered, deterministic issue list.
 */

export type IntegrityCode =
  | 'empty_routine'
  | 'no_work_steps'
  | 'invalid_rounds'
  | 'missing_interval_spec'
  | 'orphan_transition'
  | 'transition_cycle'
  | 'zero_target_sets'
  | 'duplicate_step_id';

export type IntegritySeverity = 'error' | 'warning';

export interface IntegrityIssue {
  code: IntegrityCode;
  severity: IntegritySeverity;
  blockId?: string;
  blockName?: string;
  stepId?: string;
  stepName?: string;
}

/**
 * Unbounded-cycle detection over a block's step graph (Phase 2J §15).
 *
 * Engine rules (computeTarget, frozen):
 * - The LAST step's outgoing edge (explicit or implicit) increments the round
 *   with a cap at block.rounds — or ends the block. Bounded by construction.
 * - Non-last steps advance the index (implicit or forward jump), keeping the
 *   round; a backward/self explicit jump increments the round with NO cap.
 *
 * A cycle in the full graph must either contain the last step (bounded) or
 * live entirely among non-last steps — and there only a backward/self jump can
 * close the cycle, which the engine never caps. So: induce the subgraph on
 * non-last vertices and look for any cycle.
 */
function hasUnboundedCycle(block: BlockDef): boolean {
  const n = block.steps.length;
  if (n < 2) return false;

  const transByFrom = new Map<string, (typeof block.transitions)[number]>();
  for (const t of block.transitions) {
    if (!transByFrom.has(t.fromStepId)) transByFrom.set(t.fromStepId, t);
  }

  const edgeFrom = new Map<string, string>();
  block.steps.forEach((step, index) => {
    if (index >= n - 1) return; // last step — round-capped, excluded
    const t = transByFrom.get(step.id);
    let target = -1;
    if (t && t.toStepId) {
      target = block.steps.findIndex((s) => s.id === t.toStepId);
    }
    if (target < 0) target = index + 1; // implicit advance (engine line 58)
    if (target < n - 1) edgeFrom.set(step.id, block.steps[target].id); // targets of the last step leave the subgraph
  });

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();

  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    const next = edgeFrom.get(id);
    if (next != null) {
      const state = color.get(next) ?? WHITE;
      if (state === GRAY) return true;
      if (state === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };

  for (const step of block.steps.slice(0, n - 1)) {
    if ((color.get(step.id) ?? WHITE) === WHITE && visit(step.id)) return true;
  }
  return false;
}

function checkBlock(block: BlockDef, issues: IntegrityIssue[]): void {
  const blockRef = { blockId: block.id, blockName: block.name };

  if (block.steps.length === 0) {
    issues.push({ code: 'empty_routine', severity: 'error', ...blockRef });
    return;
  }

  if (!Number.isFinite(block.rounds) || block.rounds < 1) {
    issues.push({ code: 'invalid_rounds', severity: 'error', ...blockRef });
  }

  if (block.kind === 'interval') {
    const spec = block.interval;
    const valid =
      spec != null &&
      spec.rounds >= 1 &&
      spec.workMs >= 0 &&
      spec.restMs >= 0 &&
      Number.isFinite(spec.workMs) &&
      Number.isFinite(spec.restMs);
    if (!valid) {
      issues.push({ code: 'missing_interval_spec', severity: 'error', ...blockRef });
    }
  }

  const stepIds = new Set<string>();
  const seen = new Set<string>();
  for (const step of block.steps) {
    if (seen.has(step.id)) {
      issues.push({
        code: 'duplicate_step_id',
        severity: 'warning',
        ...blockRef,
        stepId: step.id,
        stepName: step.exerciseName,
      });
    }
    seen.add(step.id);
    stepIds.add(step.id);

    if (step.role === 'work') {
      const sets = step.prescription.targetSets;
      if (sets == null || sets < 1) {
        issues.push({
          code: 'zero_target_sets',
          severity: 'warning',
          ...blockRef,
          stepId: step.id,
          stepName: step.exerciseName,
        });
      }
    }
  }

  for (const t of block.transitions) {
    const knownFrom = stepIds.has(t.fromStepId);
    const validTo = t.toStepId == null || stepIds.has(t.toStepId);
    if (!knownFrom || !validTo) {
      issues.push({ code: 'orphan_transition', severity: 'error', ...blockRef });
      break; // one report per block keeps noisy malformed data readable
    }
  }

  if (hasUnboundedCycle(block)) {
    issues.push({ code: 'transition_cycle', severity: 'error', ...blockRef });
  }
}

export function checkIntegrity(def: RoutineDefinition): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  const anySteps = def.blocks.some((b) => b.steps.length > 0);
  if (def.blocks.length === 0) {
    issues.push({ code: 'empty_routine', severity: 'error' });
  }

  const hasWork = def.blocks.some((b) => b.steps.some((s) => s.role === 'work'));
  if (anySteps && !hasWork) {
    issues.push({ code: 'no_work_steps', severity: 'warning' });
  }

  def.blocks.forEach((block) => checkBlock(block, issues));
  return issues;
}

export function integrityErrors(issues: IntegrityIssue[]): number {
  return issues.filter((i) => i.severity === 'error').length;
}
