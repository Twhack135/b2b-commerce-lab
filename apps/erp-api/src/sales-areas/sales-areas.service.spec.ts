import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { SalesAreasService } from './sales-areas.service';

const organization = (
  code: string,
  currencyCode: string,
  decimals: number,
  isActive = true,
) => ({
  code,
  name: `Organization ${code}`,
  country: 'DE',
  currencyCode,
  isActive,
  currency: {
    code: currencyCode,
    name: currencyCode,
    decimals,
    isActive: true,
  },
});

const area = (org: ReturnType<typeof organization>, isActive = true) => ({
  salesOrganization: org.code,
  distributionChannel: '10',
  division: '00',
  isActive,
  organization: org,
  channel: { code: '10', name: 'Direct Sales' },
  divisionRecord: { code: '00', name: 'Cross-Division' },
});

describe('SalesAreasService', () => {
  let service: SalesAreasService;

  const db = {
    currency: { findMany: jest.fn() },
    salesOrganization: { findMany: jest.fn() },
    distributionChannel: { findMany: jest.fn() },
    division: { findMany: jest.fn() },
    salesArea: { findMany: jest.fn() },
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [SalesAreasService, { provide: PrismaService, useValue: db }],
    }).compile();
    service = module.get(SalesAreasService);
  });

  it('should return a sales area with the currency and decimals of its organization', async () => {
    db.salesArea.findMany.mockResolvedValue([
      area(organization('3000', 'JPY', 0)),
    ]);

    await expect(service.findSalesAreas()).resolves.toEqual([
      {
        salesOrganization: '3000',
        distributionChannel: '10',
        division: '00',
        salesOrganizationName: 'Organization 3000',
        distributionChannelName: 'Direct Sales',
        divisionName: 'Cross-Division',
        country: 'DE',
        currency: 'JPY',
        currencyDecimals: 0,
        isActive: true,
      },
    ]);
  });

  it.each([
    ['an inactive sales area', area(organization('1000', 'EUR', 2), false)],
    [
      'an inactive sales organization',
      area(organization('1000', 'EUR', 2, false)),
    ],
  ])('should report %s as inactive', async (_case, record) => {
    db.salesArea.findMany.mockResolvedValue([record]);

    const [result] = await service.findSalesAreas();
    expect(result.isActive).toBe(false);
  });

  it('should list currencies with their decimal places only', async () => {
    db.currency.findMany.mockResolvedValue([
      {
        code: 'JPY',
        name: 'Japanese Yen',
        decimals: 0,
        isActive: true,
        extra: 1,
      },
    ]);

    await expect(service.findCurrencies()).resolves.toEqual([
      { code: 'JPY', name: 'Japanese Yen', decimals: 0, isActive: true },
    ]);
  });
});
