import {
  Controller,
  ExecutionContext,
  Get,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { loopbackHost } from '../common/network-binding';
import { ShopServiceGuard } from './shop-service.guard';
import {
  configuredKeyDigest,
  isValidServiceKey,
  SHOP_SERVICE_KEY_HEADER,
} from './shop-service-key';

const KEY = 'k'.repeat(31) + 'X';

@Controller('shop/v1')
class ShopController {
  @Get('health')
  health() {}
}

@Controller('materials')
class AdminController {
  @Get()
  list() {}
}

/** A shop route declared on a controller without base path */
@Controller()
class RootController {
  @Get('shop/v1/hidden')
  hidden() {}

  @Get('shopping-list')
  notShop() {}
}

type Handler = (...args: unknown[]) => unknown;

/** The method of a controller, as Nest passes it to a guard */
const handlerOf = (controller: { prototype: object }, name: string) =>
  Object.getOwnPropertyDescriptor(controller.prototype, name)!.value as Handler;

function contextWith(
  headers: Record<string, string | string[] | undefined>,
  controller: object = ShopController,
  handler: Handler = handlerOf(ShopController, 'health'),
) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getClass: () => controller,
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function guardWith(key: string | undefined) {
  const previous = process.env.SHOP_SERVICE_KEY;
  if (key === undefined) delete process.env.SHOP_SERVICE_KEY;
  else process.env.SHOP_SERVICE_KEY = key;
  try {
    return new ShopServiceGuard();
  } finally {
    if (previous === undefined) delete process.env.SHOP_SERVICE_KEY;
    else process.env.SHOP_SERVICE_KEY = previous;
  }
}

describe('shop service key', () => {
  it('requires at least 32 visible characters', () => {
    expect(configuredKeyDigest({ SHOP_SERVICE_KEY: KEY })).not.toBeNull();
    for (const key of [
      undefined,
      '',
      'short',
      'k'.repeat(31),
      `${KEY} `,
      `${'k'.repeat(30)} ab`,
    ]) {
      expect(configuredKeyDigest({ SHOP_SERVICE_KEY: key })).toBeNull();
    }
  });

  it('accepts exactly the configured key', () => {
    const expected = configuredKeyDigest({ SHOP_SERVICE_KEY: KEY })!;
    expect(isValidServiceKey(KEY, expected)).toBe(true);
    for (const presented of [
      undefined,
      '',
      KEY.slice(0, -1),
      `${KEY}X`,
      KEY.toLowerCase(),
      [KEY, KEY],
    ]) {
      expect(isValidServiceKey(presented, expected)).toBe(false);
    }
  });
});

describe('ShopServiceGuard', () => {
  it('lets the shop BFF with the configured key through', () => {
    expect(
      guardWith(KEY).canActivate(
        contextWith({ [SHOP_SERVICE_KEY_HEADER]: KEY }),
      ),
    ).toBe(true);
  });

  it('rejects a missing or wrong key with 401 and the same message', () => {
    const guard = guardWith(KEY);
    for (const headers of [
      {},
      { [SHOP_SERVICE_KEY_HEADER]: 'wrong' },
      // A service key is no user credential: Authorization is not read
      { authorization: `Bearer ${KEY}` },
    ]) {
      expect(() => guard.canActivate(contextWith(headers))).toThrow(
        new UnauthorizedException('Service authentication required.'),
      );
    }
  });

  it('protects every route whose path starts with "shop", wherever it is declared', () => {
    const guard = guardWith(KEY);
    expect(() =>
      guard.canActivate(
        contextWith({}, RootController, handlerOf(RootController, 'hidden')),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('leaves the admin API alone, also without a configured key', () => {
    for (const guard of [guardWith(KEY), guardWith(undefined)]) {
      expect(
        guard.canActivate(
          contextWith({}, AdminController, handlerOf(AdminController, 'list')),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(
          contextWith({}, RootController, handlerOf(RootController, 'notShop')),
        ),
      ).toBe(true);
    }
  });

  it('closes the shop API without a usable key (fail closed)', () => {
    for (const key of [undefined, 'short']) {
      const guard = guardWith(key);
      expect(() =>
        guard.canActivate(contextWith({ [SHOP_SERVICE_KEY_HEADER]: 'short' })),
      ).toThrow(ServiceUnavailableException);
    }
  });
});

describe('loopbackHost', () => {
  it('listens on 127.0.0.1 by default and accepts loopback only', () => {
    expect(loopbackHost(undefined)).toBe('127.0.0.1');
    for (const host of ['127.0.0.1', '::1', 'localhost']) {
      expect(loopbackHost(host)).toBe(host);
    }
  });

  it('refuses every other interface, without an override', () => {
    for (const host of [
      '0.0.0.0',
      '::',
      '192.168.1.10',
      'erp.example.com',
      '',
      '127.0.0.2',
    ]) {
      expect(() => loopbackHost(host)).toThrow(/may only listen on 127.0.0.1/);
    }
  });
});
