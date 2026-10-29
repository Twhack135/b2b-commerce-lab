import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Material as MaterialRecord, Prisma } from '../generated/prisma/client';
import {
  isPrismaError,
  RECORD_NOT_FOUND,
  UNIQUE_CONSTRAINT_FAILED,
} from '../prisma/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './material.interface';

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
      const material = await this.prisma.$transaction(async (tx) => {
        if (dto.currency !== undefined) {
          await assertCurrencyChangeAllowed(tx, materialNumber, dto.currency);
        }
        return tx.material.update({
          where: { materialNumber },
          data: {
            description: dto.description,
            price: dto.price,
            currency: dto.currency,
          },
        });
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

/**
 * Active price conditions must use the currency of their material, so the
 * currency cannot change while active conditions in another currency exist.
 * The material row is locked like in the price conditions service, so no
 * condition can be created or reactivated during the change.
 */
async function assertCurrencyChangeAllowed(
  db: Prisma.TransactionClient,
  materialNumber: string,
  currency: string,
) {
  await db.$queryRaw`
    SELECT material_number FROM materials
    WHERE material_number = ${materialNumber} FOR UPDATE`;
  const conflicting = await db.priceCondition.count({
    where: { materialNumber, isActive: true, currency: { not: currency } },
  });
  if (conflicting > 0) {
    throw new UnprocessableEntityException([
      `currency cannot be changed to ${currency}: material ${materialNumber} has ${conflicting} active price condition(s) in another currency`,
    ]);
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
