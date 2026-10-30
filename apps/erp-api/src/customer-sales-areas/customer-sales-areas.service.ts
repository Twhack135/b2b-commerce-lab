import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  isPrismaError,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import {
  checkSalesArea,
  formatSalesArea,
  isSalesAreaKey,
  SalesAreaKey,
  salesAreaKeyOf,
} from '../sales-areas/sales-area-key';
import { findDependentUnits } from './assignment-rules';
import { CustomerSalesArea } from './customer-sales-area.interface';
import { CreateCustomerSalesAreaDto } from './dto/create-customer-sales-area.dto';
import { UpdateCustomerSalesAreaDto } from './dto/update-customer-sales-area.dto';

/**
 * Sales area assignments of customers (comparable to extending a customer
 * to a sales area in SAP, table KNVV). Assignments are never deleted.
 */
@Injectable()
export class CustomerSalesAreasService {
  constructor(private readonly prisma: PrismaService) {}

  /** Assigns the customer to an active sales area */
  async create(
    customerNumber: string,
    dto: CreateCustomerSalesAreaDto,
  ): Promise<CustomerSalesArea> {
    const key = salesAreaKeyOf(dto);
    try {
      await this.prisma.$transaction(async (tx) => {
        await assertCustomerExists(tx, customerNumber);
        const violations = await checkSalesArea(tx, key);
        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }
        const existing = await tx.customerSalesArea.findUnique({
          where: assignmentId(customerNumber, key),
        });
        if (existing) {
          throw alreadyAssigned(customerNumber, key);
        }
        await tx.customerSalesArea.create({
          data: { customerNumber, ...key, isActive: true },
        });
      });
    } catch (error) {
      // The same assignment was created between our check and insert
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw alreadyAssigned(customerNumber, key);
      }
      throw error;
    }
    return this.findOne(customerNumber, key);
  }

  /**
   * Activates or deactivates an assignment. An assignment cannot be
   * deactivated while active B2B units in the sales area use the customer
   * as a partner, because those units would no longer be valid.
   */
  async update(
    customerNumber: string,
    key: SalesAreaKey,
    dto: UpdateCustomerSalesAreaDto,
  ): Promise<CustomerSalesArea> {
    if (!isSalesAreaKey(key)) {
      throw notAssigned(customerNumber, key);
    }
    await this.prisma.$transaction(async (tx) => {
      // Lock the assignment first: units that rely on it lock it FOR SHARE
      // (see assignment-rules.ts), so they cannot be created or reactivated
      // while this change is checked.
      const locked = await tx.$queryRaw<{ is_active: boolean }[]>`
        SELECT is_active FROM customer_sales_areas
        WHERE customer_number = ${customerNumber}
          AND sales_organization = ${key.salesOrganization}
          AND distribution_channel = ${key.distributionChannel}
          AND division = ${key.division}
        FOR UPDATE`;
      if (locked.length === 0) {
        await assertCustomerExists(tx, customerNumber);
        throw notAssigned(customerNumber, key);
      }
      if (locked[0].is_active === dto.isActive) return;

      if (dto.isActive) {
        const violations = await checkSalesArea(tx, key);
        if (violations.length > 0) {
          throw new UnprocessableEntityException(violations);
        }
      } else {
        const unitIds = await findDependentUnits(tx, customerNumber, key);
        if (unitIds.length > 0) {
          throw new ConflictException(
            `Customer ${customerNumber} cannot be deactivated in sales area ${formatSalesArea(key)}: it is a partner of the active B2B unit(s) ${unitIds.join(', ')}. Deactivate these units or replace the partner first.`,
          );
        }
      }

      await tx.customerSalesArea.update({
        where: assignmentId(customerNumber, key),
        data: { isActive: dto.isActive },
      });
    });
    return this.findOne(customerNumber, key);
  }

  private async findOne(
    customerNumber: string,
    key: SalesAreaKey,
  ): Promise<CustomerSalesArea> {
    const assignment = await this.prisma.customerSalesArea.findUnique({
      where: assignmentId(customerNumber, key),
    });
    if (!assignment) {
      throw notAssigned(customerNumber, key);
    }
    return {
      customerNumber: assignment.customerNumber,
      ...salesAreaKeyOf(assignment),
      isActive: assignment.isActive,
    };
  }
}

function assignmentId(customerNumber: string, key: SalesAreaKey) {
  return {
    customerNumber_salesOrganization_distributionChannel_division: {
      customerNumber,
      ...key,
    },
  };
}

async function assertCustomerExists(
  db: Prisma.TransactionClient,
  customerNumber: string,
) {
  const customer = await db.customer.findUnique({ where: { customerNumber } });
  if (!customer) {
    throw new NotFoundException(`Customer ${customerNumber} not found`);
  }
}

function notAssigned(customerNumber: string, key: SalesAreaKey) {
  return new NotFoundException(
    `Customer ${customerNumber} is not assigned to sales area ${formatSalesArea(key)}`,
  );
}

function alreadyAssigned(customerNumber: string, key: SalesAreaKey) {
  return new ConflictException(
    `Customer ${customerNumber} is already assigned to sales area ${formatSalesArea(key)}`,
  );
}
