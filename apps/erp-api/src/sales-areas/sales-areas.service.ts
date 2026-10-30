import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  Currency,
  OrganizationalUnit,
  SalesArea,
  SalesOrganization,
} from './sales-area.interface';

/** Read-only access to currencies and the organizational structure */
@Injectable()
export class SalesAreasService {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrencies(): Promise<Currency[]> {
    const currencies = await this.prisma.currency.findMany({
      orderBy: { code: 'asc' },
    });
    return currencies.map((currency) => ({
      code: currency.code,
      name: currency.name,
      decimals: currency.decimals,
      isActive: currency.isActive,
    }));
  }

  async findSalesOrganizations(): Promise<SalesOrganization[]> {
    const organizations = await this.prisma.salesOrganization.findMany({
      orderBy: { code: 'asc' },
    });
    return organizations.map((organization) => ({
      code: organization.code,
      name: organization.name,
      country: organization.country,
      currency: organization.currencyCode,
      isActive: organization.isActive,
    }));
  }

  async findDistributionChannels(): Promise<OrganizationalUnit[]> {
    const channels = await this.prisma.distributionChannel.findMany({
      orderBy: { code: 'asc' },
    });
    return channels.map(({ code, name }) => ({ code, name }));
  }

  async findDivisions(): Promise<OrganizationalUnit[]> {
    const divisions = await this.prisma.division.findMany({
      orderBy: { code: 'asc' },
    });
    return divisions.map(({ code, name }) => ({ code, name }));
  }

  async findSalesAreas(): Promise<SalesArea[]> {
    const areas = await this.prisma.salesArea.findMany({
      include: {
        organization: { include: { currency: true } },
        channel: true,
        divisionRecord: true,
      },
      orderBy: [
        { salesOrganization: 'asc' },
        { distributionChannel: 'asc' },
        { division: 'asc' },
      ],
    });
    return areas.map((area) => ({
      salesOrganization: area.salesOrganization,
      distributionChannel: area.distributionChannel,
      division: area.division,
      salesOrganizationName: area.organization.name,
      distributionChannelName: area.channel.name,
      divisionName: area.divisionRecord.name,
      country: area.organization.country,
      currency: area.organization.currencyCode,
      currencyDecimals: area.organization.currency.decimals,
      isActive: area.isActive && area.organization.isActive,
    }));
  }
}
