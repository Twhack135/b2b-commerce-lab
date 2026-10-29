import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Customer as CustomerRecord } from '../generated/prisma/client';
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { Customer } from './customer.interface';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Customer[]> {
    const customers = await this.prisma.customer.findMany({
      orderBy: { customerNumber: 'asc' },
    });
    return customers.map(toCustomer);
  }

  async findOne(customerNumber: string): Promise<Customer> {
    const customer = await this.prisma.customer.findUnique({
      where: { customerNumber },
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
  };
}

function notFound(customerNumber: string): NotFoundException {
  return new NotFoundException(`Customer ${customerNumber} not found`);
}
