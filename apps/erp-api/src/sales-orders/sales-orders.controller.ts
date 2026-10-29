import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { SimulateSalesOrderDto } from './dto/simulate-sales-order.dto';
import { SalesOrderSimulation } from './sales-order-simulation.interface';
import { SalesOrdersService } from './sales-orders.service';

// Sprint 8 only simulates orders; creating sales orders comes later
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
}
