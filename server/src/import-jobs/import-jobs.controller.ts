import {
  Body,
  Controller,
  Get,
  Headers,
  MessageEvent,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { Observable, from, merge, of } from 'rxjs';
import { concatMap, map } from 'rxjs/operators';
import { JwtAuthGuard, AuthenticatedUser } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateImportJobDto } from './dto/create-import-job.dto';
import { ImportJobsService } from './import-jobs.service';
import type { RequestWithId } from '../common/middleware/request-id.middleware';

type AuthenticatedRequest = RequestWithId & { user?: AuthenticatedUser };

@Controller('import-jobs')
@Roles('EDITOR', 'ADMIN')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImportJobsController {
  constructor(private readonly importJobsService: ImportJobsService) {}

  @Post()
  create(
    @Body() body: CreateImportJobDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.importJobsService.create(
      request.user!.sub,
      body.fileObjectId,
      body.idempotencyKey,
      body.pipelineVersion,
      request.requestId,
    );
  }

  @Get(':id')
  get(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.get(request.user!.sub, id);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.cancel(request.user!.sub, id);
  }

  @Post(':id/retry')
  retry(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.retry(
      request.user!.sub,
      id,
      request.requestId,
    );
  }

  @Post(':id/publish')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  publish(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.publishReview(request.user!.sub, id);
  }

  @Get(':id/review')
  review(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.getReview(
      request.user!.sub,
      id,
      request.user!.role,
    );
  }

  @Post(':id/rollback')
  @Roles('ADMIN')
  @UseGuards(JwtAuthGuard, RolesGuard)
  rollback(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.importJobsService.rollbackReview(request.user!.sub, id);
  }

  @Sse(':id/events')
  events(
    @Param('id') id: string,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Req() request: AuthenticatedRequest,
  ): Observable<MessageEvent> {
    return from(
      this.importJobsService.getEvents(
        request.user!.sub,
        id,
        Number(lastEventId || 0),
      ),
    ).pipe(
      concatMap(({ events, job }) =>
        merge(
          // 快照不占用事件游标，否则浏览器重连会把 UUID 当成 Last-Event-ID。
          of({ type: 'snapshot', data: job }),
          from(events).pipe(
            map((event): MessageEvent => ({
              id: String(event.id),
              type: event.event,
              data: event.data as object,
            })),
          ),
        ),
      ),
    );
  }
}
