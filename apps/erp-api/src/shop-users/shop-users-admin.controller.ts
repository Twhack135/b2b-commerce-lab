import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CreateShopUserDto } from './dto/create-shop-user.dto';
import { UpdateShopUserDto } from './dto/update-shop-user.dto';
import {
  IssuedActivationLink,
  IssuedPasswordResetLink,
  ShopUserDetail,
  ShopUserSummary,
} from './shop-user-admin.interface';
import { ShopUsersAdminService } from './shop-users-admin.service';

/**
 * Shop user administration for the Backoffice (Sprint 12C). Admin API:
 * like every admin route it has NO administrator authentication and is only
 * reachable on this computer (loopback binding and Host check,
 * docs/adr/0006, 0007). The shop never calls it: the shop BFF only knows
 * fixed /shop/v1 paths. Answers contain personal data and are not cached.
 */
@Controller('shop-users')
export class ShopUsersAdminController {
  constructor(private readonly service: ShopUsersAdminService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  findAll(): Promise<ShopUserSummary[]> {
    return this.service.findAll();
  }

  @Get(':userId')
  @Header('Cache-Control', 'no-store')
  findOne(@Param('userId') userId: string): Promise<ShopUserDetail> {
    return this.service.findOne(userId);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() dto: CreateShopUserDto): Promise<ShopUserDetail> {
    return this.service.create(dto);
  }

  @Patch(':userId')
  @Header('Cache-Control', 'no-store')
  update(
    @Param('userId') userId: string,
    @Body() dto: UpdateShopUserDto,
  ): Promise<ShopUserDetail> {
    return this.service.update(userId, dto);
  }

  /** Assigns a unit of the user's account; assigning it again is no error */
  @Put(':userId/units/:unitId')
  @Header('Cache-Control', 'no-store')
  assignUnit(
    @Param('userId') userId: string,
    @Param('unitId') unitId: string,
  ): Promise<ShopUserDetail> {
    return this.service.assignUnit(userId, unitId);
  }

  /** Withdraws a unit; removing a unit that is not assigned is no error */
  @Delete(':userId/units/:unitId')
  @Header('Cache-Control', 'no-store')
  unassignUnit(
    @Param('userId') userId: string,
    @Param('unitId') unitId: string,
  ): Promise<ShopUserDetail> {
    return this.service.unassignUnit(userId, unitId);
  }

  /** The one-time link, shown exactly once; never logged or stored raw */
  @Post(':userId/activation-link')
  @Header('Cache-Control', 'no-store')
  issueActivationLink(
    @Param('userId') userId: string,
  ): Promise<IssuedActivationLink> {
    return this.service.issueActivationLink(userId);
  }

  /** A one-time password reset link, shown exactly once; never logged */
  @Post(':userId/password-reset-link')
  @Header('Cache-Control', 'no-store')
  issuePasswordResetLink(
    @Param('userId') userId: string,
  ): Promise<IssuedPasswordResetLink> {
    return this.service.issuePasswordResetLink(userId);
  }

  @Post(':userId/sessions/:sessionId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revokeSession(
    @Param('userId') userId: string,
    @Param('sessionId') sessionId: string,
  ): Promise<ShopUserDetail> {
    return this.service.revokeSession(userId, sessionId);
  }

  @Post(':userId/sessions/revoke-all')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revokeAllSessions(@Param('userId') userId: string): Promise<ShopUserDetail> {
    return this.service.revokeAllSessions(userId);
  }
}
