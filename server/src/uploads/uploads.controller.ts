import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { UploadsService } from './uploads.service';

type AuthenticatedRequest = Request & { user?: AuthenticatedUser };

@Controller('uploads')
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('initiate')
  initiate(
    @Body() body: InitiateUploadDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.uploadsService.initiate(request.user!.sub, body);
  }

  @Post(':id/parts/:partNumber')
  uploadPart(
    @Param('id') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.uploadsService.savePart(
      request.user!.sub,
      sessionId,
      partNumber,
      request,
    );
  }

  @Get(':id')
  status(@Param('id') sessionId: string, @Req() request: AuthenticatedRequest) {
    return this.uploadsService.getStatus(request.user!.sub, sessionId);
  }

  @Get(':id/parts/:partNumber/presign')
  presignPart(
    @Param('id') sessionId: string,
    @Param('partNumber', ParseIntPipe) partNumber: number,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.uploadsService.presignPart(
      request.user!.sub,
      sessionId,
      partNumber,
    );
  }

  @Post(':id/complete')
  complete(
    @Param('id') sessionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.uploadsService
      .complete(request.user!.sub, sessionId)
      .then(
        ({
          objectKey: _objectKey,
          bucket: _bucket,
          ownerId: _ownerId,
          ...file
        }) => file,
      );
  }
}
