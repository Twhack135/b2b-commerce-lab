import { Body, Controller, Param, Patch, Post } from '@nestjs/common';
import { CustomerSalesArea } from './customer-sales-area.interface';
import { CustomerSalesAreasService } from './customer-sales-areas.service';
import { CreateCustomerSalesAreaDto } from './dto/create-customer-sales-area.dto';
import { UpdateCustomerSalesAreaDto } from './dto/update-customer-sales-area.dto';

// The assignments of a customer are listed with the customer
// (GET /customers/:customerNumber). There is deliberately no DELETE:
// assignments are deactivated via isActive.
@Controller('customers/:customerNumber/sales-areas')
export class CustomerSalesAreasController {
  constructor(private readonly service: CustomerSalesAreasService) {}

  // NestJS answers POST requests with 201 Created by default
  @Post()
  create(
    @Param('customerNumber') customerNumber: string,
    @Body() dto: CreateCustomerSalesAreaDto,
  ): Promise<CustomerSalesArea> {
    return this.service.create(customerNumber, dto);
  }

  @Patch(':salesOrganization/:distributionChannel/:division')
  update(
    @Param('customerNumber') customerNumber: string,
    @Param('salesOrganization') salesOrganization: string,
    @Param('distributionChannel') distributionChannel: string,
    @Param('division') division: string,
    @Body() dto: UpdateCustomerSalesAreaDto,
  ): Promise<CustomerSalesArea> {
    return this.service.update(
      customerNumber,
      { salesOrganization, distributionChannel, division },
      dto,
    );
  }
}
