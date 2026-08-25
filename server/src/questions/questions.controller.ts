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
  UseGuards,
} from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ImportQuestionsDto } from './dto/import-questions.dto';
import { FindQuestionsDto } from './dto/find-questions.dto';
import { Roles } from '../auth/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
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

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.questionsService.findOne(id);
  }

  @Post()
  create(@Body() body: CreateQuestionDto) {
    return this.questionsService.create(body);
  }

  @Post('import')
  importMany(@Body() body: ImportQuestionsDto) {
    return this.questionsService.importMany(body.questions);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateQuestionDto,
  ) {
    // 更新必须携带数据库主键，避免按标题误改多条题目。
    return this.questionsService.update(id, body);
  }

  @Delete()
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  clear() {
    // 清空是高风险操作，Service 返回实际删除数量供前端确认结果。
    return this.questionsService.clear();
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.questionsService.remove(id);
  }
}
