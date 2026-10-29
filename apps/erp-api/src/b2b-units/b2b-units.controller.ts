import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { B2bUnit } from './b2b-unit.interface';
import { B2bUnitsService } from './b2b-units.service';
import { CreateB2bUnitDto } from './dto/create-b2b-unit.dto';
import { UpdateB2bUnitDto } from './dto/update-b2b-unit.dto';

// There is deliberately no DELETE: units are deactivated via isActive
@Controller('b2b-units')
export class B2bUnitsController {
  constructor(private readonly b2bUnitsService: B2bUnitsService) {}

  @Get()
  findAll(): Promise<B2bUnit[]> {
    return this.b2bUnitsService.findAll();
  }

  @Get(':unitId')
  findOne(@Param('unitId') unitId: string): Promise<B2bUnit> {
    return this.b2bUnitsService.findOne(unitId);
  }

  // NestJS answers POST requests with 201 Created by default
  @Post()
  create(@Body() dto: CreateB2bUnitDto): Promise<B2bUnit> {
    return this.b2bUnitsService.create(dto);
  }

  @Patch(':unitId')
  update(
    @Param('unitId') unitId: string,
    @Body() dto: UpdateB2bUnitDto,
  ): Promise<B2bUnit> {
    return this.b2bUnitsService.update(unitId, dto);
  }
}
