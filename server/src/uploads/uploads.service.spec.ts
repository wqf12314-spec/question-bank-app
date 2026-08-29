import { BadRequestException } from '@nestjs/common';
jest.mock('../prisma/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));
import { UploadsService } from './uploads.service';

function createPrismaMock({
  fileCount = 0,
  fileBytes = 0,
  activeCount = 0,
  activeBytes = 0,
} = {}) {
  return {
    fileObject: {
      findUnique: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(fileCount),
      aggregate: jest.fn().mockResolvedValue({ _sum: { size: fileBytes } }),
      create: jest.fn(),
    },
    uploadSession: {
      aggregate: jest.fn().mockResolvedValue({
        _count: { _all: activeCount },
        _sum: { size: activeBytes },
      }),
      create: jest.fn().mockResolvedValue({
        id: 'session-1',
        objectKey: '1/session-1',
        partSize: 8 * 1024 * 1024,
        expiresAt: new Date(),
      }),
    },
  };
}

const dto = {
  fileName: 'questions.json',
  size: 1024,
  mime: 'application/json',
};

describe('UploadsService quota checks', () => {
  it('allows an upload when file and byte quotas are available', async () => {
    const prisma = createPrismaMock();
    const service = new UploadsService(prisma as any);

    await expect(service.initiate(1, dto)).resolves.toMatchObject({
      sessionId: 'session-1',
    });
    expect(prisma.uploadSession.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a new upload when the user has reached the file quota', async () => {
    const prisma = createPrismaMock({ fileCount: 100 });
    const service = new UploadsService(prisma as any);

    await expect(service.initiate(1, dto)).rejects.toMatchObject({
      response: { error: { code: 'UPLOAD_QUOTA_EXCEEDED' } },
    });
    expect(prisma.uploadSession.create).not.toHaveBeenCalled();
  });

  it('rejects a new upload when reserved bytes would exceed the quota', async () => {
    const prisma = createPrismaMock({
      fileBytes: 2 * 1024 * 1024 * 1024 - 512,
    });
    const service = new UploadsService(prisma as any);

    await expect(
      service.initiate(1, { ...dto, size: 1024 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.uploadSession.create).not.toHaveBeenCalled();
  });
});
