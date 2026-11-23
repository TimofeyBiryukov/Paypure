import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "./env";
import { Prisma, PrismaClient } from "./generated/prisma/client";

export type Tx = Prisma.TransactionClient;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    // The app role can't disable triggers (08 §3.3); fall back to the owner only if unset.
    super({
      adapter: new PrismaPg({
        connectionString: env.APP_DATABASE_URL ?? env.DATABASE_URL,
        max: 10,
      }),
    });
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}

export { Prisma };
