import { Injectable } from '@nestjs/common';
import { Material } from './material.interface';

@Injectable()
export class MaterialsService {
  // Demo data until we connect a database
  private readonly materials: Material[] = [
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
  ];

  findAll(): Material[] {
    return this.materials;
  }
}
