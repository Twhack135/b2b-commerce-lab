// Local, server-side tool for shop users (Sprint 12B), until the Backoffice
// manages them (Sprint 12C). There is deliberately no HTTP endpoint that
// creates users or issues activation links.
//
//   npm run shop:user -- create --account CUST-1000 --email anna@example.com --name "Anna Weber" [--unit UNIT-STUTTGART ...]
//   npm run shop:user -- activation --email anna@example.com [--shop-url http://127.0.0.1:3002]
//
// The activation link is printed once to this terminal; it is valid for 24
// hours and only once. Treat it like a password: never paste it into
// tickets, chats or commits. With --json the result is printed as JSON.
// Only databases on this computer are accepted.

import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ShopAuthModule } from '../auth/shop-auth.module';
import { ShopAuthService } from '../auth/shop-auth.service';
import { ShopUsersModule } from '../users/shop-users.module';
import { ShopUsersService } from '../users/shop-users.service';

@Module({ imports: [ShopUsersModule, ShopAuthModule] })
class ShopUserCliModule {}

const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args: string[], name: string): string[] {
  return args.flatMap((arg, index) =>
    arg === `--${name}` && args[index + 1] ? [args[index + 1]] : [],
  );
}

function required(args: string[], name: string): string {
  const value = option(args, name);
  if (!value || value.startsWith('--')) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

function assertLocalDatabase(): void {
  let host = '';
  try {
    host = new URL(process.env.DATABASE_URL ?? '').hostname;
  } catch {
    // reported below
  }
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new Error(
      'The shop user tool only works with a database on this computer.',
    );
  }
}

function shopUrl(args: string[]): string {
  const url = new URL(option(args, 'shop-url') ?? 'http://127.0.0.1:3002');
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('--shop-url must be an http(s) address.');
  }
  return url.origin;
}

async function main(args: string[]): Promise<void> {
  const [command] = args;
  const json = args.includes('--json');
  if (command !== 'create' && command !== 'activation') {
    throw new Error(
      'Usage: shop:user -- create|activation [options] (see the header of shop-user.cli.ts)',
    );
  }
  assertLocalDatabase();
  const app = await NestFactory.createApplicationContext(ShopUserCliModule, {
    logger: ['error'],
  });
  try {
    const users = app.get(ShopUsersService);
    if (command === 'create') {
      const user = await users.createUser({
        accountCustomerNumber: required(args, 'account'),
        email: required(args, 'email'),
        displayName: required(args, 'name'),
      });
      const units = options(args, 'unit');
      for (const unitId of units) await users.assignUnit(user.id, unitId);
      const result = {
        id: user.id,
        email: user.email,
        account: user.accountCustomerNumber,
        units,
      };
      console.log(
        json
          ? JSON.stringify(result)
          : `Created shop user ${user.email} (${user.id}) of ${user.accountCustomerNumber}; units: ${units.join(', ') || 'none'}`,
      );
      return;
    }
    const user = await users.findUserByEmail(required(args, 'email'));
    if (!user) throw new Error('No shop user with this e-mail address.');
    const { token, expiresAt } = await app
      .get(ShopAuthService)
      .issueActivation(user.id);
    // The fragment (#) is never sent to a server or in a Referer header
    const link = `${shopUrl(args)}/activate#token=${token}`;
    console.log(
      json
        ? JSON.stringify({ link, expiresAt: expiresAt.toISOString() })
        : `Activation link for ${user.email} (valid once, until ${expiresAt.toISOString()}):\n${link}\nTreat it like a password.`,
    );
  } finally {
    await app.close();
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  // Rule violations have a readable message; nothing secret is printed
  new Logger('shop:user').error(
    error instanceof Error ? error.message : 'Failed.',
  );
  process.exitCode = 1;
});
