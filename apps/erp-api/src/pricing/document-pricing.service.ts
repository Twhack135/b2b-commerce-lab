import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Decimal, formatInCurrency } from '../common/money';
import { PricingProcedureDetail } from '../pricing-procedures/pricing-procedure.interface';
import { PricingProceduresService } from '../pricing-procedures/pricing-procedures.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  findSalesArea,
  formatSalesArea,
  salesAreaKeyOf,
} from '../sales-areas/sales-area-key';
import { ITEM_NUMBER_STEP } from '../sales-orders/simulation-rules';
import { CalculateDocumentDto } from './dto/calculate-document.dto';
import { DocumentPricingResult } from './document-pricing.interface';
import { calculateDocument, ProcedureDefinition } from './engine/procedure';
import { loadCandidates, unitPricingViolations } from './pricing.service';

/**
 * Prices a whole document with the pricing procedure of its sales area
 * (Sprint 13A, POST /pricing/calculate). Runs next to the released price
 * determination: it stores nothing, and the order simulation and creation
 * do not use it yet. The unit, its Sold-to and the sales area are checked
 * exactly as for POST /pricing/price.
 */
@Injectable()
export class DocumentPricingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly procedures: PricingProceduresService,
  ) {}

  async calculate(dto: CalculateDocumentDto): Promise<DocumentPricingResult> {
    const key = salesAreaKeyOf(dto);
    const materialNumbers = [
      ...new Set(dto.items.map((i) => i.materialNumber)),
    ];
    const [unit, salesArea, materials] = await Promise.all([
      this.prisma.b2bUnit.findUnique({
        where: { unitId: dto.unitId },
        include: { soldTo: { include: { customer: true } } },
      }),
      findSalesArea(this.prisma, key),
      this.prisma.material.findMany({
        where: { materialNumber: { in: materialNumbers } },
      }),
    ]);

    const violations = materialNumbers
      .filter(
        (m) => !materials.some((material) => material.materialNumber === m),
      )
      .map((m) => `materialNumber ${m} does not exist`);
    violations.push(...unitPricingViolations(key, salesArea, dto.unitId, unit));
    if (!unit || !salesArea || violations.length > 0) {
      throw new UnprocessableEntityException(violations);
    }
    const procedure = await this.procedures.determine(key);
    if (!procedure) {
      throw new UnprocessableEntityException([
        `No pricing procedure is determined for sales area ${formatSalesArea(key)}`,
      ]);
    }

    const candidates = await loadCandidates(
      this.prisma,
      key,
      materialNumbers,
      unit,
    );
    const currency = salesArea.currency;
    const document = calculateDocument({
      procedure: toDefinition(procedure),
      salesArea: key,
      currency,
      pricingDate: dto.pricingDate,
      items: dto.items.map((item, index) => ({
        itemNumber: (index + 1) * ITEM_NUMBER_STEP,
        materialNumber: item.materialNumber,
        quantity: item.quantity,
        candidates: candidates.get(item.materialNumber) ?? [],
      })),
    });

    const amount = (value: Decimal | null) =>
      value && formatInCurrency(value, currency);
    return {
      status: document.status,
      procedure: {
        code: procedure.code,
        name: procedure.name,
        revision: procedure.revision,
      },
      salesArea: key,
      unitId: unit.unitId,
      soldToCustomerNumber: unit.soldToCustomerNumber,
      pricingDate: dto.pricingDate,
      currency: { code: currency.code, decimals: currency.decimals },
      items: document.items.map((item) => ({
        itemNumber: item.itemNumber,
        materialNumber: item.materialNumber,
        materialDescription: materials.find(
          (m) => m.materialNumber === item.materialNumber,
        )!.description,
        quantity: item.quantity,
        status: item.status,
        lines: item.lines.map((line) =>
          line.kind === 'SUBTOTAL'
            ? { ...line, value: amount(line.value) }
            : {
                step: line.step,
                kind: line.kind,
                label: line.label,
                statistical: line.statistical,
                mandatory: line.mandatory,
                conditionId: line.conditionId,
                conditionType: line.conditionType,
                scope: line.scope,
                validFrom: line.validFrom,
                validTo: line.validTo,
                rate: amount(line.rate),
                quantity: line.quantity,
                value: amount(line.value),
                accessSequence: line.accessSequenceCode,
                accesses: line.accesses,
              },
        ),
        netValue: amount(item.netValue),
        messages: item.messages,
      })),
      totals: { netValue: amount(document.netValue) },
      messages: document.messages,
    };
  }
}

/** The configuration as the pure calculation needs it */
function toDefinition(procedure: PricingProcedureDetail): ProcedureDefinition {
  return {
    code: procedure.code,
    name: procedure.name,
    revision: procedure.revision,
    steps: procedure.steps.map((step) => ({
      stepNumber: step.stepNumber,
      kind: step.kind,
      label: step.label,
      accessSequenceCode: step.accessSequence?.code ?? null,
      accesses: (step.accessSequence?.accesses ?? []).map((access) => ({
        accessNumber: access.accessNumber,
        scope: access.scope,
        conditionTypeCode: access.conditionType.code,
        conditionType: access.conditionType,
        materialSpecific: access.materialSpecific,
      })),
      fromStep: step.fromStep,
      toStep: step.toStep,
      statistical: step.statistical,
      mandatory: step.mandatory,
      subtotalKey: step.subtotalKey,
    })),
  };
}
