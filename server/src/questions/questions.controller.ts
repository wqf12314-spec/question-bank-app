import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Body,
  Post,
  Patch,
  Delete,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ImportQuestionsDto } from './dto/import-questions.dto';
import { FindQuestionsDto } from './dto/find-questions.dto';
import { Roles } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateQuestionDto } from './dto/update-question.dto';
import type { AuthenticatedUser } from '../auth/jwt-auth.guard';
import { TransitionQuestionDto } from './dto/transition-question.dto';
import { RollbackQuestionDto } from './dto/rollback-question.dto';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };
@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  findAll(@Query() query: FindQuestionsDto) {
    return this.questionsService.findAll(query);
  }

  @Get('count')
  async getCount() {
    const count = await this.questionsService.getCount();
    return {
      count,
    };
  }

  @Get(':id/revisions')
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  revisions(@Param('id', ParseIntPipe) id: number) {
    return this.questionsService.listRevisions(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.questionsService.findOne(id);
  }

  @Post()
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  create(@Body() body: CreateQuestionDto) {
    return this.questionsService.create(body);
  }

  @Post('import')
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  importMany(@Body() body: ImportQuestionsDto) {
    return this.questionsService.importMany(body.questions);
  }

  @Patch(':id')
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    // 更新必须携带数据库主键，避免按标题误改多条题目。
    return this.questionsService.update(id, body, request.user!.sub);
  }

  @Post(':id/status')
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  transitionStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: TransitionQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    // 状态迁移必须经过 Service 白名单，不能借 PATCH 任意写入 status。
    return this.questionsService.transitionStatus(
      id,
      body.status,
      request.user!.sub,
      request.user!.role,
    );
  }

  @Post(':id/rollback/:revisionId')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  rollback(
    @Param('id', ParseIntPipe) id: number,
    @Param('revisionId', ParseIntPipe) revisionId: number,
    @Body() body: RollbackQuestionDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questionsService.rollback(
      id,
      revisionId,
      body.version,
      request.user!.sub,
    );
  }

  @Delete()
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  clear() {
    // 清空是高风险操作，Service 返回实际删除数量供前端确认结果。
    return this.questionsService.clear();
  }

  @Delete(':id')
  @Roles('EDITOR', 'ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.questionsService.remove(id, request.user!.sub);
  }
}
