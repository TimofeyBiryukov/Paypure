import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { Prisma } from "../generated/prisma/client";

/** Errors leave the API as { code, message }. Database rule violations become 409s. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger("http");

  catch(exception: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    if (reply.sent) return;
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const payload = typeof body === "string" ? { code: "error", message: body } : body;
      reply.status(exception.getStatus()).send(payload);
      return;
    }
    const msg = String((exception as Error)?.message ?? exception);
    if (exception instanceof Prisma.PrismaClientKnownRequestError && exception.code === "P2002") {
      reply.status(409).send({
        code: "conflict",
        message: "That already exists or was changed at the same time.",
      });
      return;
    }
    if (msg.includes("invalid input syntax for type uuid")) {
      reply.status(404).send({ code: "not_found", message: "Not found" });
      return;
    }
    // Raised by our triggers and check constraints (08 §3.3): a rule held at the database level.
    const rule = msg.match(
      /(?:frozen|write-once|billed|status can't|only draft|fixed once|propose a correction|violates check constraint "([a-z_]+)"|one_live_timer)[^\n]*/,
    );
    if (rule) {
      reply.status(409).send({ code: "rule", message: rule[0] });
      return;
    }
    this.log.error(msg, (exception as Error)?.stack);
    reply.status(500).send({ code: "internal", message: "Something went wrong on our side." });
  }
}
