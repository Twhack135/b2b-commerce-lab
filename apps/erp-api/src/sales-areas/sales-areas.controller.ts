import { Controller, Get } from '@nestjs/common';
import {
  Currency,
  OrganizationalUnit,
  SalesArea,
  SalesOrganization,
} from './sales-area.interface';
import { SalesAreasService } from './sales-areas.service';

// Read-only: currencies and the organizational structure are configuration
// from the migration (comparable to SAP Customizing). Administration needs
// its own rules later.
@Controller()
export class SalesAreasController {
  constructor(private readonly salesAreasService: SalesAreasService) {}

  @Get('currencies')
  findCurrencies(): Promise<Currency[]> {
    return this.salesAreasService.findCurrencies();
  }

  @Get('sales-organizations')
  findSalesOrganizations(): Promise<SalesOrganization[]> {
    return this.salesAreasService.findSalesOrganizations();
  }

  @Get('distribution-channels')
  findDistributionChannels(): Promise<OrganizationalUnit[]> {
    return this.salesAreasService.findDistributionChannels();
  }

  @Get('divisions')
  findDivisions(): Promise<OrganizationalUnit[]> {
    return this.salesAreasService.findDivisions();
  }

  @Get('sales-areas')
  findSalesAreas(): Promise<SalesArea[]> {
    return this.salesAreasService.findSalesAreas();
  }
}
