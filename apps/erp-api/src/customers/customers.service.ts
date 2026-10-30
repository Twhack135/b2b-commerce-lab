import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { Customer } from './customer.interface';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// Assignments are listed in a fixed order: by sales organization, channel, division
const WITH_SALES_AREAS = {
  salesAreas: {
    orderBy: [
      { salesOrganization: 'asc' },
      { distributionChannel: 'asc' },
      { division: 'asc' },
    ],
  },
} satisfies Prisma.CustomerInclude;

type CustomerRecord = Prisma.CustomerGetPayload<{
  include: typeof WITH_SALES_AREAS;
}>;

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    const customers = await this.prisma.customer.findMany({
      include: WITH_SALES_AREAS,
      orderBy: { customerNumber: 'asc' },
    });
    return customers.map(toCustomer);
  }

  async findOne(customerNumber: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { customerNumber },
      include: WITH_SALES_AREAS,
    });
    if (!customer) {
      throw notFound(customerNumber);
    }
    return toCustomer(customer);
  }

  async create(dto: CreateCustomerDto): Promise<Customer> {
    try {
      const customer = await this.prisma.customer.create({
        data: {
          customerNumber: dto.customerNumber,
          name: dto.name,
          street: dto.street,
          postalCode: dto.postalCode,
          city: dto.city,
          country: dto.country,
          isActive: dto.isActive ?? true,
        },
        include: WITH_SALES_AREAS,
      });
      return toCustomer(customer);
    } catch (error) {
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw new ConflictException(
          `Customer ${dto.customerNumber} already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    customerNumber: string,
    dto: UpdateCustomerDto,
  ): Promise<Customer> {
    try {
      const customer = await this.prisma.customer.update({
        where: { customerNumber },
        data: {
          name: dto.name,
          street: dto.street,
          postalCode: dto.postalCode,
          city: dto.city,
          country: dto.country,
          isActive: dto.isActive,
        },
        include: WITH_SALES_AREAS,
      });
      return toCustomer(customer);
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        throw notFound(customerNumber);
      }
      throw error;
    }
  }
}

// Only these fields are part of the API, even if the table grows later
function toCustomer(customer: CustomerRecord): Customer {
  return {
    customerNumber: customer.customerNumber,
    name: customer.name,
    street: customer.street,
    postalCode: customer.postalCode,
    city: customer.city,
    country: customer.country,
    isActive: customer.isActive,
    salesAreas: customer.salesAreas.map((assignment) => ({
      salesOrganization: assignment.salesOrganization,
      distributionChannel: assignment.distributionChannel,
      division: assignment.division,
      isActive: assignment.isActive,
    })),
  };
}

function notFound(customerNumber: string): NotFoundException {
  return new NotFoundException(`Customer ${customerNumber} not found`);
}
