import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { UpdateUserRoleDto } from './dto/update-user-role.dto';
import { UsersService } from './users.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Patch(':id/role')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  updateRole(
    @Param('id', ParseIntPipe) userId: number,
    @Body() body: UpdateUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.usersService.updateRole(userId, body.role, request.user!.sub);
  }
}

@Controller('audit-logs')
export class AuditLogsController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  list(@Query('limit') limit?: string) {
    return this.usersService.listAuditLogs(limit ? Number(limit) : 50);
  }
}
