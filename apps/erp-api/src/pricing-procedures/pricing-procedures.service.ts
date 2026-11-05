import { Injectable, NotFoundException } from '@nestjs/common';
import { toConditionTypeSummary } from '../condition-types/condition-type-rules';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesAreaKey } from '../sales-areas/sales-area-key';
import {
  PricingProcedureDetail,
  PricingProcedureSummary,
} from './pricing-procedure.interface';

/** The customer procedure key that applies to every customer */
export const ANY_CUSTOMER = '*';

const PROCEDURE_INCLUDE = {
  determinations: {
    orderBy: [
      { salesOrganization: 'asc' },
      { distributionChannel: 'asc' },
      { division: 'asc' },
      { customerProcedure: 'asc' },
    ],
  },
  steps: {
    orderBy: { stepNumber: 'asc' },
    include: {
      accessSequence: {
        include: {
          accesses: {
            orderBy: { accessNumber: 'asc' },
            include: {
              conditionTypeScope: { include: { conditionType: true } },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.PricingProcedureInclude;

type ProcedureRecord = Prisma.PricingProcedureGetPayload<{
  include: typeof PROCEDURE_INCLUDE;
}>;

type Db = Prisma.TransactionClient | PrismaService;

/**
 * The pricing configuration (Sprint 13A, docs/adr/0008): read-only, it is
 * versioned through migrations. Also determines the procedure of a sales
 * area for the pricing calculation.
 */
@Injectable()
export class PricingProceduresService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<PricingProcedureSummary[]> {
    const procedures = await this.prisma.pricingProcedure.findMany({
      orderBy: { code: 'asc' },
      include: PROCEDURE_INCLUDE,
    });
    return procedures.map((procedure) => toSummary(toDetail(procedure)));
  }

  async findOne(code: string): Promise<PricingProcedureDetail> {
    const procedure = await this.prisma.pricingProcedure.findUnique({
      where: { code },
      include: PROCEDURE_INCLUDE,
    });
    if (!procedure) {
      throw new NotFoundException(`Pricing procedure ${code} not found`);
    }
    return toDetail(procedure);
  }

  /**
   * The active procedure of a sales area: a customer-specific determination
   * first (not used yet), else the one for every customer; null if none.
   */
  async determine(
    key: SalesAreaKey,
    customerProcedure: string = ANY_CUSTOMER,
    db: Db = this.prisma,
  ): Promise<PricingProcedureDetail | null> {
    const keys = [...new Set([customerProcedure, ANY_CUSTOMER])];
    const determinations = await db.pricingProcedureDetermination.findMany({
      where: { ...key, customerProcedure: { in: keys } },
      include: { procedure: { include: PROCEDURE_INCLUDE } },
    });
    const match =
      determinations.find((d) => d.customerProcedure === customerProcedure) ??
      determinations.find((d) => d.customerProcedure === ANY_CUSTOMER);
    return match && match.procedure.isActive ? toDetail(match.procedure) : null;
  }
}

function toDetail(procedure: ProcedureRecord): PricingProcedureDetail {
  return {
    code: procedure.code,
    name: procedure.name,
    revision: procedure.revision,
    isActive: procedure.isActive,
    assignments: procedure.determinations.map((d) => ({
      salesOrganization: d.salesOrganization,
      distributionChannel: d.distributionChannel,
      division: d.division,
      customerProcedure: d.customerProcedure,
    })),
    stepCount: procedure.steps.length,
    steps: procedure.steps.map((step) => ({
      stepNumber: step.stepNumber,
      kind: step.kind,
      label: step.label,
      accessSequence: step.accessSequence && {
        code: step.accessSequence.code,
        name: step.accessSequence.name,
        accesses: step.accessSequence.accesses.map((access) => ({
          accessNumber: access.accessNumber,
          conditionType: toConditionTypeSummary(
            access.conditionTypeScope.conditionType,
          ),
          scope: access.scope,
          materialSpecific: access.materialSpecific,
        })),
      },
      fromStep: step.fromStep,
      toStep: step.toStep,
      statistical: step.isStatistical,
      mandatory: step.isMandatory,
      subtotalKey: step.subtotalKey,
      customerVisible: step.customerVisible,
    })),
  };
}

function toSummary(detail: PricingProcedureDetail): PricingProcedureSummary {
  return {
    code: detail.code,
    name: detail.name,
    revision: detail.revision,
    isActive: detail.isActive,
    assignments: detail.assignments,
    stepCount: detail.stepCount,
  };
}
