import { Test, TestingModule } from '@nestjs/testing';
import { MaterialsService } from './materials.service';

describe('MaterialsService', () => {
  let service: MaterialsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MaterialsService],
    }).compile();

    service = module.get<MaterialsService>(MaterialsService);
  });

  it('should return the two demo materials', () => {
    expect(service.findAll()).toEqual([
      {
        materialNumber: 'MAT-001',
        description: 'Heat Pump',
        price: 4500,
        currency: 'EUR',
      },
      {
        materialNumber: 'MAT-002',
        description: 'Thermostat',
        price: 199,
        currency: 'EUR',
      },
    ]);
  });
});
