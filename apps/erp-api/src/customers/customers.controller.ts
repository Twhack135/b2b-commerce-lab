import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Customer } from './customer.interface';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

// There is deliberately no DELETE: customers are deactivated via isActive
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  findAll(): Promise<Customer[]> {
    return this.customersService.findAll();
  }

  @Get(':customerNumber')
  findOne(@Param('customerNumber') customerNumber: string): Promise<Customer> {
    return this.customersService.findOne(customerNumber);
  }

  // NestJS answers POST requests with 201 Created by default
  @Post()
  create(@Body() dto: CreateCustomerDto): Promise<Customer> {
    return this.customersService.create(dto);
  }

  @Patch(':customerNumber')
  update(
    @Param('customerNumber') customerNumber: string,
    @Body() dto: UpdateCustomerDto,
  ): Promise<Customer> {
    return this.customersService.update(customerNumber, dto);
  }
}
