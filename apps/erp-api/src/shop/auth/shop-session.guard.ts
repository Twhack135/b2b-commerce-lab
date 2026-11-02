import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ShopAuthService, ShopSessionContext } from './shop-auth.service';

/**
 * Header with the customer's session token, forwarded by the shop BFF from
 * its HttpOnly cookie. Deliberately separate from the service key: the key
 * identifies the shop, the session identifies the person.
 */
export const SHOP_SESSION_HEADER = 'x-shop-session';

/** The client address the BFF saw, only used for rate limits */
export const SHOP_CLIENT_ADDRESS_HEADER = 'x-shop-client-address';

type RequestWithSession = Request & { shopSession?: ShopSessionContext };

export function sessionTokenOf(request: Request): string | undefined {
  const value = request.headers[SHOP_SESSION_HEADER];
  return typeof value === 'string' ? value : undefined;
}

/** A plausible IPv4 or IPv6 address, or undefined */
export function clientAddressOf(request: Request): string | undefined {
  const value = request.headers[SHOP_CLIENT_ADDRESS_HEADER];
  return typeof value === 'string' && /^[0-9a-fA-F:.]{2,45}$/.test(value)
    ? value
    : undefined;
}

/**
 * Customer routes: a valid session of an active user of an active account.
 * Runs after the global ShopServiceGuard, so both layers are required.
 */
@Injectable()
export class ShopSessionGuard implements CanActivate {
  constructor(private readonly auth: ShopAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const session = await this.auth.session(sessionTokenOf(request));
    if (!session) throw new UnauthorizedException('Authentication required.');
    request.shopSession = session;
    return true;
  }
}

/** The session checked by ShopSessionGuard */
export const CurrentShopSession = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ShopSessionContext =>
    context.switchToHttp().getRequest<RequestWithSession>().shopSession!,
);
