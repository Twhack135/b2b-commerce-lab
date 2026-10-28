import { Controller, Get } from '@nestjs/common';
import { Material } from './material.interface';
import { MaterialsService } from './materials.service';

@Controller('materials')
export class MaterialsController {
  constructor(private readonly materialsService: MaterialsService) {}

  @Get()
  findAll(): Material[] {
    return this.materialsService.findAll();
  }
}
