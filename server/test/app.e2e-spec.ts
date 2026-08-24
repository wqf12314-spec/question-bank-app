import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import { PrismaService } from './../src/prisma/prisma.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterEach(async () => {
    // 每个用例结束后清理测试数据，避免下次运行被上次结果影响。
    await app.get(PrismaService).refreshSession.deleteMany();
    await app.get(PrismaService).user.deleteMany();
    await app.get(PrismaService).question.deleteMany();
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ success: true, data: 'Hello World!' });
  });

  it('GET/questions返回测试库中的题目列表', () => {
    return request(app.getHttpServer())
      .get('/questions')
      .expect(200)
      .expect({ success: true, data: [] });
  });

  it('POST/questions/import导入题目', () => {
    return request(app.getHttpServer())
      .post('/questions/import')
      .send({
        schemaVersion: 1,
        questions: [
          {
            title: '__e2e_normal_import__',
            category: 'E2E测试',
            tags: ['integration'],
          },
        ],
      })
      .expect(201)
      .expect({
        success: true,
        data: {
          importedCount: 1,
          skippedCount: 0,
        },
      });
  });
  it('同一次批量导入会跳过规范化标题重复的题目', async () => {
    const questions = [
      {
        title: '__e2e_batch_duplicate__',
        category: 'E2E测试',
      },
      {
        // 前后空格不同，但规范化后应该视为同一道题。
        title: '  __e2e_batch_duplicate__  ',
        category: 'E2E测试',
      },
    ];
    const response = await request(app.getHttpServer())
      .post('/questions/import')
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      data: {
        importedCount: 1,
        skippedCount: 1,
      },
    });
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_batch_duplicate__',
      },
    });

    // 响应统计和数据库真实结果必须一致。
    expect(savedCount).toBe(1);
  });
  it('再次导入数据库已有题目时会跳过', async () => {
    const questions = [
      {
        title: '__e2e_existing_duplicate__',
        category: 'E2E测试',
      },
    ];
    const firstResponse = await request(app.getHttpServer())
      .post('/questions/import')
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(firstResponse.body.data).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    const secondResponse = await request(app.getHttpServer())
      .post('/questions/import')
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(secondResponse.body.data).toEqual({
      importedCount: 0,
      skippedCount: 1,
    });
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_existing_duplicate__',
      },
    });

    // 重复请求不能让数据库产生第二条记录。
    expect(savedCount).toBe(1);
  });
  it('并发导入相同标题时数据库最终只保存一条', async () => {
    const payload = {
      schemaVersion: 1,
      questions: [
        {
          title: '__e2e_concurrent_duplicate__',
          category: 'E2E测试',
        },
      ],
    };
    const requests = Array.from({ length: 10 }, () =>
      request(app.getHttpServer())
        .post('/questions/import')
        .send(payload)
        .expect(201),
    );

    const responses = await Promise.all(requests);

    const importedTotal = responses.reduce(
      (total, response) => total + response.body.data.importedCount,
      0,
    );
    expect(importedTotal).toBe(1);

    const skippedTotal = responses.reduce(
      (total, response) => total + response.body.data.skippedCount,
      0,
    );
    expect(skippedTotal).toBe(9);
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_concurrent_duplicate__',
      },
    });
    // 并发请求的最终数据库状态必须只有一条。
    expect(savedCount).toBe(1);
  });
  it('单题新增会由后端生成规范化标题', async () => {
    const response = await request(app.getHttpServer())
      .post('/questions')
      .send({
        title: '  __e2e_single_create__  ',
        category: 'E2E测试',
      })
      .expect(201);
    expect(response.body.data.normalizedTitle).toBe('__e2e_single_create__');

    const saved = await app.get(PrismaService).question.findFirst({
      where: { normalizedTitle: '__e2e_single_create__' },
    });

    expect(saved?.title).toBe('__e2e_single_create__');
  });
  it('单题修改会同步更新规范化标题', async () => {
    const created = await request(app.getHttpServer())
      .post('/questions')
      .send({
        title: '__e2e_update_before__',
        category: 'E2E测试',
      })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/questions/${created.body.data.id}`)
      .send({
        title: '  __e2e_update_after__  ',
        category: 'E2E测试',
      })
      .expect(200);

    expect(updated.body.data.normalizedTitle).toBe('__e2e_update_after__');

    const saved = await app.get(PrismaService).question.findUnique({
      where: { id: created.body.data.id },
    });

    expect(saved?.title).toBe('__e2e_update_after__');
    expect(saved?.normalizedTitle).toBe('__e2e_update_after__');
  });
  it('拒绝非法 schemaVersion', async () => {
    const response = await request(app.getHttpServer())
      .post('/questions/import')
      .send({
        schemaVersion: 2,
        questions: [
          {
            title: '__e2e_invalid_schema__',
            category: 'E2E测试',
          },
        ],
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('拒绝超长标题', async () => {
    const response = await request(app.getHttpServer())
      .post('/questions')
      .send({
        title: 'a'.repeat(201),
        category: 'E2E测试',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('拒绝错误 tags 类型', async () => {
    const response = await request(app.getHttpServer())
      .post('/questions')
      .send({
        title: '__e2e_invalid_tags__',
        category: 'E2E测试',
        tags: 'not-an-array',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('注册用户默认是 LEARNER 且不返回密码', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'register-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      email: 'register-e2e@example.test',
      role: 'LEARNER',
    });

    expect(response.body.data.password).toBeUndefined();
    expect(response.body.data.passwordHash).toBeUndefined();

    const saved = await app.get(PrismaService).user.findUnique({
      where: { email: 'register-e2e@example.test' },
    });

    expect(saved?.passwordHash).not.toBe('correct-password-123');
  });

  it('重复邮箱注册返回 409', async () => {
    const payload = {
      email: 'duplicate-e2e@example.test',
      password: 'correct-password-123',
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...payload,
        email: 'DUPLICATE-e2e@example.test',
      })
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('拒绝过短密码', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'short-password@example.test',
        password: '1234567',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
