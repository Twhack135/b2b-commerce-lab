import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Material } from './material.interface';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll(): Promise<Material[]> {
    return this.materialsService.findAll();
  }

  @Get(':materialNumber')
  findOne(@Param('materialNumber') materialNumber: string): Promise<Material> {
    return this.materialsService.findOne(materialNumber);
  }

  // NestJS answers POST requests with 201 Created by default
  @Post()
  create(@Body() dto: CreateMaterialDto): Promise<Material> {
    return this.materialsService.create(dto);
  }

  @Patch(':materialNumber')
  update(
    @Param('materialNumber') materialNumber: string,
    @Body() dto: UpdateMaterialDto,
  ): Promise<Material> {
    return this.materialsService.update(materialNumber, dto);
  }
}
