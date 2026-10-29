import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CreatePriceConditionDto } from './dto/create-price-condition.dto';
import { UpdatePriceConditionDto } from './dto/update-price-condition.dto';
import { PriceCondition } from './price-condition.interface';
import { PriceConditionsService } from './price-conditions.service';

// There is deliberately no DELETE: conditions are deactivated via isActive
@Controller('price-conditions')
export class PriceConditionsController {
  constructor(
    private readonly priceConditionsService: PriceConditionsService,
  ) {}

  @Get()
  findAll(): Promise<PriceCondition[]> {
    return this.priceConditionsService.findAll();
  }

  // A condition ID that is not a whole number is answered with 400
  @Get(':conditionId')
  findOne(
    @Param('conditionId', ParseIntPipe) conditionId: number,
  ): Promise<PriceCondition> {
    return this.priceConditionsService.findOne(conditionId);
  }

  // NestJS answers POST requests with 201 Created by default
  @Post()
  create(@Body() dto: CreatePriceConditionDto): Promise<PriceCondition> {
    return this.priceConditionsService.create(dto);
  }

  @Patch(':conditionId')
  update(
    @Param('conditionId', ParseIntPipe) conditionId: number,
    @Body() dto: UpdatePriceConditionDto,
  ): Promise<PriceCondition> {
    return this.priceConditionsService.update(conditionId, dto);
  }
}
