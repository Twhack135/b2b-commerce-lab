import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CustomerAccount } from './customer-account.interface';
import { CustomerAccountsService } from './customer-accounts.service';
import { ReplaceAccountMembersDto } from './dto/replace-account-members.dto';

@Controller('customer-accounts')
export class CustomerAccountsController {
  constructor(
    private readonly customerAccountsService: CustomerAccountsService,
  ) {}

  @Get()
  findAll(): Promise<CustomerAccount[]> {
    return this.customerAccountsService.findAll();
  }

  @Get(':accountCustomerNumber')
  findOne(
    @Param('accountCustomerNumber') accountCustomerNumber: string,
  ): Promise<CustomerAccount> {
    return this.customerAccountsService.findOne(accountCustomerNumber);
  }

  // PUT replaces the complete member list; it creates the account if needed
  @Put(':accountCustomerNumber/members')
  replaceMembers(
    @Param('accountCustomerNumber') accountCustomerNumber: string,
    @Body() dto: ReplaceAccountMembersDto,
  ): Promise<CustomerAccount> {
    return this.customerAccountsService.replaceMembers(
      accountCustomerNumber,
      dto,
    );
  }
}
