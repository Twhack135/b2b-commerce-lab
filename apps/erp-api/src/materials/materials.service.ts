import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Material as MaterialRecord } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './material.interface';

// Prisma error codes, see https://www.prisma.io/docs/orm/reference/error-reference
const UNIQUE_CONSTRAINT_FAILED = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

@Injectable()
export class MaterialsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(): Promise<Material[]> {
    const materials = await this.prisma.material.findMany({
      orderBy: { materialNumber: 'asc' },
    });
    return materials.map(toMaterial);
  }

  async findOne(materialNumber: string): Promise<Material> {
    const material = await this.prisma.material.findUnique({
      where: { materialNumber },
    });
    if (!material) {
      throw notFound(materialNumber);
    }
    return toMaterial(material);
  }

  async create(dto: CreateMaterialDto): Promise<Material> {
    try {
      const material = await this.prisma.material.create({
        data: {
          materialNumber: dto.materialNumber,
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
        },
      });
      return toMaterial(material);
    } catch (error) {
      if (isPrismaError(error, UNIQUE_CONSTRAINT_FAILED)) {
        throw new ConflictException(
          `Material ${dto.materialNumber} already exists`,
        );
      }
      throw error;
    }
  }

  async update(
    materialNumber: string,
    dto: UpdateMaterialDto,
  ): Promise<Material> {
    try {
      const material = await this.prisma.material.update({
        where: { materialNumber },
        data: {
          description: dto.description,
          price: dto.price,
          currency: dto.currency,
        },
      });
      return toMaterial(material);
    } catch (error) {
      if (isPrismaError(error, RECORD_NOT_FOUND)) {
        throw notFound(materialNumber);
      }
      throw error;
    }
  }
}

// Prisma returns prices as Decimal objects; our API returns plain numbers
function toMaterial(material: MaterialRecord): Material {
  return {
    materialNumber: material.materialNumber,
    description: material.description,
    price: material.price.toNumber(),
    currency: material.currency,
  };
}

function notFound(materialNumber: string): NotFoundException {
  return new NotFoundException(`Material ${materialNumber} not found`);
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
