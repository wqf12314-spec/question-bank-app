import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaNeon } from '@prisma/adapter-neon';
import { PrismaClient } from '../../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const isTest = process.env.NODE_ENV === 'test';
    const connectionString = isTest
      ? process.env.TEST_DATABASE_URL
      : process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        isTest ? 'TEST_DATABASE_URL is required' : 'DATABASE_URL is required',
      );
    }
    const adapter = isTest
      ? new PrismaPg({ connectionString })
      : new PrismaNeon({ connectionString });
    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
