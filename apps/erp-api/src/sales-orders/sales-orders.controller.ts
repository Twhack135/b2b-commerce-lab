import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreateSalesOrderDto } from './dto/create-sales-order.dto';
import { SimulateSalesOrderDto } from './dto/simulate-sales-order.dto';
import { SalesOrder } from './sales-order.interface';
import { SalesOrderSimulation } from './sales-order-simulation.interface';
import { SalesOrdersService } from './sales-orders.service';

/** 10 digits, e.g. 1000000001 */
const SALES_ORDER_NUMBER = /^\d{10}$/;

@Controller('sales-orders')
export class SalesOrdersController {
  constructor(private readonly salesOrdersService: SalesOrdersService) {}

  // 200 for every business result, also INVALID: the simulation reports all
  // problems of the order at once. Malformed requests are answered with 400.
  @Post('simulate')
  @HttpCode(200)
  simulate(@Body() dto: SimulateSalesOrderDto): Promise<SalesOrderSimulation> {
    return this.salesOrdersService.simulate(dto);
  }

  // 201 for a new order, 200 if the request was already processed (same
  // requestId and data). 422 ORDER_INVALID, 409 PRICE_CHANGED,
  // 409 IDEMPOTENCY_KEY_REUSED and 409 CONCURRENT_UPDATE store nothing.
  @Post()
  async create(
    @Body() dto: CreateSalesOrderDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SalesOrder> {
    const { order, created } = await this.salesOrdersService.create(dto);
    response.status(created ? 201 : 200);
    response.location(`/sales-orders/${order.salesOrderNumber}`);
    return order;
  }

  // Anything but a 10-digit number cannot be a sales order: 404, as before
  // this route existed (e.g. GET /sales-orders/simulate)
  @Get(':salesOrderNumber')
  findOne(
    @Param('salesOrderNumber') salesOrderNumber: string,
  ): Promise<SalesOrder> {
    if (!SALES_ORDER_NUMBER.test(salesOrderNumber)) {
      throw new NotFoundException(`Sales order ${salesOrderNumber} not found`);
    }
    return this.salesOrdersService.findOne(salesOrderNumber);
  }
}
