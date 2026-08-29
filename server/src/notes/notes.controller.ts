import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Put,
  Req,
  Body,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpsertNoteDto } from './dto/upsert-note.dto';
import { NotesService } from './notes.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Controller('notes')
@UseGuards(JwtAuthGuard)
export class NotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get()
  findAll(@Req() request: AuthenticatedRequest) {
    return this.notesService.findAll(request.user!.sub);
  }

  @Get(':questionId')
  findOne(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notesService.findOne(questionId, request.user!.sub);
  }

  @Put(':questionId')
  upsert(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Body() body: UpsertNoteDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notesService.upsert(
      questionId,
      request.user!.sub,
      body.content,
    );
  }

  @Delete(':questionId')
  remove(
    @Param('questionId', ParseIntPipe) questionId: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.notesService.remove(questionId, request.user!.sub);
  }
}
