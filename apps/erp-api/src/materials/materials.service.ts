import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Material } from './material.interface';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Material[]> {
    const materials = await this.prisma.material.findMany({
      orderBy: { materialNumber: 'asc' },
    });

    // Prisma returns prices as Decimal objects; our API returns plain numbers
    return materials.map((material) => ({
      materialNumber: material.materialNumber,
      description: material.description,
      price: material.price.toNumber(),
      currency: material.currency,
    }));
  }
}
