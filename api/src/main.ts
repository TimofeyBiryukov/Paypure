import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./app.module";
import { env } from "./env";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024, trustProxy: true }),
    { logger: ["warn", "error"], bodyParser: false },
  );
  // Single-button mutations (Stop timer, Void…) post an empty body; treat it as {}.
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      const err = new Error("Invalid JSON") as Error & { statusCode: number };
      err.statusCode = 400;
      done(err, undefined);
    }
  });
  app.enableShutdownHooks();
  await app.listen(env.PORT, "0.0.0.0");
}

void bootstrap();
