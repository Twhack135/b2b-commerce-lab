import { IsBoolean } from 'class-validator';

// The sales area itself is part of the URL and cannot be changed; the
// ValidationPipe rejects unknown properties.
export class UpdateCustomerSalesAreaDto {
  @IsBoolean()
  isActive: boolean;
}
