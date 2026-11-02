import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import {
  configuredKeyDigest,
  isValidServiceKey,
  SHOP_SERVICE_KEY_HEADER,
} from './shop-service-key';

/**
 * Service authentication of the shop API: only the shop BFF may call it.
 * This is NOT user authorization; a valid key gives no access to customer
 * data (see shop-service-key.ts). Answers never say why a key was rejected.
 *
 * Registered globally (ShopModule), so every route whose path starts with
 * "shop" is protected, also routes added later; there are no exemptions.
 * The decision uses the path the matched handler was declared with, not the
 * request URL, so other spellings of a URL cannot avoid it.
 */
@Injectable()
export class ShopServiceGuard implements CanActivate {
  // Read once at startup; a missing or weak key closes the shop API
  private readonly expected = configuredKeyDigest(process.env);

  canActivate(context: ExecutionContext): boolean {
    if (!isShopRoute(context)) return true;
    if (!this.expected) {
      throw new ServiceUnavailableException('The shop API is not available.');
    }
    const request = context.switchToHttp().getRequest<Request>();
    if (
      !isValidServiceKey(
        request.headers[SHOP_SERVICE_KEY_HEADER],
        this.expected,
      )
    ) {
      throw new UnauthorizedException('Service authentication required.');
    }
    return true;
  }
}

/** True if the controller and handler paths together start with "shop" */
export function isShopRoute(context: ExecutionContext): boolean {
  const paths = (target: object): string[] => {
    const path: unknown = Reflect.getMetadata(PATH_METADATA, target);
    return (Array.isArray(path) ? path : [path]).filter(
      (p): p is string => typeof p === 'string',
    );
  };
  const controllerPaths = paths(context.getClass());
  const handlerPaths = paths(context.getHandler());
  return (controllerPaths.length > 0 ? controllerPaths : ['']).some((base) =>
    (handlerPaths.length > 0 ? handlerPaths : ['']).some((path) =>
      /^shop(\/|$)/i.test(
        `${base}/${path}`.replace(/\/+/g, '/').replace(/^\//, ''),
      ),
    ),
  );
}
