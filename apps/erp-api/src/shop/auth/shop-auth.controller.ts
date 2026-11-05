import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthorizedUnit } from '../users/shop-user.interface';
import { ShopUsersService } from '../users/shop-users.service';
import { ActivateDto, LoginDto, ResetPasswordDto } from './dto/shop-auth.dto';
import {
  InvalidActivationError,
  InvalidCredentialsError,
  InvalidPasswordResetError,
  PasswordPolicyError,
  TooManyAttemptsError,
} from './shop-auth.errors';
import { ShopAuthService } from './shop-auth.service';
import type { ShopSessionContext, ShopSessionUser } from './shop-auth.service';
import {
  clientAddressOf,
  CurrentShopSession,
  sessionTokenOf,
  ShopSessionGuard,
} from './shop-session.guard';

/** Answer of a successful sign-in, for the shop BFF only */
export interface ShopLoginResponse {
  /** For the HttpOnly session cookie; never shown to the browser's scripts */
  sessionToken: string;
  expiresAt: string;
  user: ShopSessionUser;
}

/** The signed-in user with the units they may act for */
export interface ShopSessionResponse {
  user: ShopSessionUser;
  units: Pick<AuthorizedUnit, 'unitId' | 'name' | 'canOrder'>[];
  expiresAt: string;
}

function toHttpError(error: unknown): never {
  if (error instanceof TooManyAttemptsError) {
    throw new HttpException(
      { statusCode: 429, message: error.message, error: 'Too Many Requests' },
      429,
    );
  }
  if (error instanceof InvalidCredentialsError) {
    throw new UnauthorizedException(error.message);
  }
  if (error instanceof PasswordPolicyError) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'PASSWORD_POLICY',
      message: error.problems,
      error: 'Bad Request',
    });
  }
  if (error instanceof InvalidActivationError) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'ACTIVATION_INVALID',
      message: [error.message],
      error: 'Bad Request',
    });
  }
  if (error instanceof InvalidPasswordResetError) {
    throw new BadRequestException({
      statusCode: 400,
      code: 'RESET_INVALID',
      message: [error.message],
      error: 'Bad Request',
    });
  }
  throw error;
}

/**
 * Sign-in of shop users. Like every route under /shop it needs the shop
 * service key (global ShopServiceGuard); session and logout also need the
 * user's session. Nothing here takes a user, account or unit ID from the
 * caller: the session decides who is acting.
 */
@Controller('shop/v1/auth')
export class ShopAuthController {
  constructor(
    private readonly auth: ShopAuthService,
    private readonly users: ShopUsersService,
  ) {}

  @Post('activation')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async activate(
    @Body() dto: ActivateDto,
    @Req() request: Request,
  ): Promise<void> {
    try {
      await this.auth.activate(
        dto.token,
        dto.password,
        clientAddressOf(request),
      );
    } catch (error) {
      toHttpError(error);
    }
  }

  /**
   * A new password with a reset link from the administration (Sprint 12C).
   * Ends every session of the user; 400 RESET_INVALID for every link that
   * cannot be used, without saying why.
   */
  @Post('password-reset')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() request: Request,
  ): Promise<void> {
    try {
      await this.auth.resetPassword(
        dto.token,
        dto.password,
        clientAddressOf(request),
      );
    } catch (error) {
      toHttpError(error);
    }
  }

  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
  ): Promise<ShopLoginResponse> {
    try {
      const session = await this.auth.login({
        email: dto.email,
        password: dto.password,
        clientAddress: clientAddressOf(request),
        previousSessionToken: sessionTokenOf(request),
      });
      return {
        sessionToken: session.token,
        expiresAt: session.expiresAt.toISOString(),
        user: session.user,
      };
    } catch (error) {
      toHttpError(error);
    }
  }

  @Get('session')
  @UseGuards(ShopSessionGuard)
  @Header('Cache-Control', 'no-store')
  async session(
    @CurrentShopSession() session: ShopSessionContext,
  ): Promise<ShopSessionResponse> {
    const units = await this.users.authorizedUnits(session.userId);
    return {
      user: session.user,
      units: units.map(({ unitId, name, canOrder }) => ({
        unitId,
        name,
        canOrder,
      })),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  /** Always 204: signing out twice or with an unknown token is no error */
  @Post('logout')
  @HttpCode(204)
  @Header('Cache-Control', 'no-store')
  async logout(@Req() request: Request): Promise<void> {
    await this.auth.logout(sessionTokenOf(request));
  }
}
