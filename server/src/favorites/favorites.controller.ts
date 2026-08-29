import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FavoritesService } from './favorites.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Controller('favorites')
@UseGuards(JwtAuthGuard)
export class FavoritesController {
  constructor(private readonly favoritesService: FavoritesService) {}

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.favoritesService.findAll(request.user!.sub);
  }

  @Post(':questionId')
  add(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favoritesService.add(questionId, request.user!.sub);
  }

  @Delete(':questionId')
  remove(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.favoritesService.remove(questionId, request.user!.sub);
  }
}
