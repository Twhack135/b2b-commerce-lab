import { Injectable } from '@nestjs/common';

/**
 * The current time. Services that need "now" (e.g. the order date of a
 * sales order) ask the clock instead of calling new Date(), so tests can
 * replace it and check exact moments such as midnight.
 */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
