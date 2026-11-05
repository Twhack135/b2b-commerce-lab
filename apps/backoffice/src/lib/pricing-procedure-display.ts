// Texts of the pricing procedure viewer (Sprint 13A). Only type imports, so
// it can be tested directly with `node --test`.

import type { PricingProcedureStep, PricingProcedureSummary } from "./pricing-procedures.ts";

/** What a step does, in one line */
export function stepDescription(step: PricingProcedureStep): string {
  if (step.kind === "SUBTOTAL") {
    const to = step.toStep ?? step.fromStep;
    return to === step.fromStep ? `Value of step ${step.fromStep}` : `Sum of steps ${step.fromStep}–${to}`;
  }
  const sequence = step.accessSequence;
  if (!sequence) return "Condition";
  const types = [...new Set(sequence.accesses.map((a) => a.conditionType.code))];
  return `${sequence.code} ${sequence.name}: ${types.join(", ")}`;
}

/** The flags of a step as short labels, in a fixed order */
export function stepFlags(step: PricingProcedureStep): string[] {
  const flags: string[] = [];
  if (step.mandatory) flags.push("Mandatory");
  if (step.statistical) flags.push("Statistical");
  if (step.customerVisible) flags.push("Customer visible");
  return flags;
}

/** e.g. "1000/10/00" or "1000/10/00 (customer procedure A)" */
export function assignmentLabel(assignment: PricingProcedureSummary["assignments"][number]): string {
  const area = `${assignment.salesOrganization}/${assignment.distributionChannel}/${assignment.division}`;
  return assignment.customerProcedure === "*" ? area : `${area} (customer procedure ${assignment.customerProcedure})`;
}
