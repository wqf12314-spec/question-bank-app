import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PracticeRecordsService } from './practice-records.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { UpdatePracticeRecordDto } from './dto/update-practice-record.dto';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
@Controller('practice-records')
@UseGuards(JwtAuthGuard)
export class PracticeRecordsController {
  constructor(
    private readonly practiceRecordsService: PracticeRecordsService,
  ) {}
  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.practiceRecordsService.findAllOwned(request.user!.sub);
  }
  @Post()
  create(
    @Body() body: CreatePracticeRecordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.practiceRecordsService.createIdempotent(
      request.user!.sub,
      body,
    );
  }

  @Get('summary')
  getSummary(@Req() request: AuthenticatedRequest) {
    return this.practiceRecordsService.getSummary(request.user!.sub);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    // 用户 ID 来自已验证的 Token，不能相信请求体或查询参数中的 userId。
    return this.practiceRecordsService.findOwned(id, request.user!.sub);
  }
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdatePracticeRecordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.practiceRecordsService.updateOwned(id, request.user!.sub, body);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.practiceRecordsService.removeOwned(id, request.user!.sub);
  }
}
