import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type {
  ShopSessionContext,
  ShopSessionUser,
} from '../auth/shop-auth.service';
import {
  CurrentShopSession,
  ShopSessionGuard,
} from '../auth/shop-session.guard';
import { ShopUsersService } from '../users/shop-users.service';
import { SHOP_UNIT_HEADER, selectUnit } from './unit-selection';

/** A unit as the customer sees it (allow list, docs/adr/0005) */
export interface ShopUnit {
  unitId: string;
  name: string;
  /** false while the unit is inactive: its data can only be viewed */
  canOrder: boolean;
}

/** The signed-in user's working context in the shop */
export interface ShopAccountResponse {
  user: ShopSessionUser;
  units: ShopUnit[];
  /** The unit to work with: the user's choice if authorized, else null */
  selectedUnit: ShopUnit | null;
  /** The shop sent a unit the user is not (or no longer) authorized for */
  requestedUnitRejected: boolean;
  expiresAt: string;
}

function requestedUnit(request: Request): string | undefined {
  const value = request.headers[SHOP_UNIT_HEADER];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The account context of the signed-in user (Sprint 12C). Behind the
 * service key (global ShopServiceGuard) and the user's session. The units
 * are read from the assignments on every request, so a withdrawn unit,
 * a disabled user or an inactive account take effect immediately.
 */
@Controller('shop/v1')
export class ShopAccountController {
  constructor(private readonly users: ShopUsersService) {}

  @Get('account')
  @UseGuards(ShopSessionGuard)
  @Header('Cache-Control', 'no-store')
  async account(
    @CurrentShopSession() session: ShopSessionContext,
    @Req() request: Request,
  ): Promise<ShopAccountResponse> {
    const units: ShopUnit[] = (
      await this.users.authorizedUnits(session.userId)
    ).map(({ unitId, name, canOrder }) => ({ unitId, name, canOrder }));
    const selection = selectUnit(units, requestedUnit(request));
    return {
      user: session.user,
      units,
      selectedUnit: selection.unit,
      requestedUnitRejected: selection.requestedRejected,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
}
