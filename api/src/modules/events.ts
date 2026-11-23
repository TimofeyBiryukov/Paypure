import { Controller, Get, Injectable, Logger, type OnModuleDestroy, type OnModuleInit, Req, Res } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { Client as PgClient } from "pg";
import { C, type Ctx } from "../common/auth";
import { env } from "../env";
import type { Tx } from "../prisma.service";

/** Live sync (06 §4): transactional pg_notify → one LISTEN connection → internal SSE. */
export type Topic = "timer" | "time" | "catalog" | "invoice" | "session";

export interface AppEvent {
  ws: string;
  member?: string;
  topic: Topic;
  action: string;
  entity?: string;
  v?: number;
  timer?: unknown;
}

interface Stream {
  ws: string;
  member: string;
  isAdmin: boolean;
  sessionId: string;
  reply: FastifyReply;
}

const CHANNEL = "paypure_events";

@Injectable()
export class EventsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("events");
  private client?: PgClient;
  private readonly streams = new Set<Stream>();
  private readonly epoch = Date.now().toString(36);
  private counter = 0;
  private readonly buffer: { id: string; seq: number; event: AppEvent }[] = [];
  private heartbeat?: NodeJS.Timeout;
  private stopped = false;

  /** Called inside the mutation's transaction; NOTIFY is delivered only after COMMIT. */
  async emit(tx: Tx, event: AppEvent): Promise<void> {
    await tx.$executeRaw`SELECT pg_notify(${CHANNEL}, ${JSON.stringify(event)})`;
  }

  async onModuleInit() {
    await this.connect();
    this.heartbeat = setInterval(() => {
      for (const s of this.streams) s.reply.raw.write(": ping\n\n");
    }, 25_000);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    for (const s of this.streams) s.reply.raw.end();
    await this.client?.end().catch(() => undefined);
  }

  private async connect(attempt = 0): Promise<void> {
    if (this.stopped) return;
    const client = new PgClient({ connectionString: env.APP_DATABASE_URL ?? env.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        this.dispatch(JSON.parse(msg.payload) as AppEvent);
      } catch (e) {
        this.log.warn(`bad event payload: ${String(e)}`);
      }
    });
    client.on("error", (err) => {
      this.log.warn(`LISTEN connection lost: ${err.message}`);
      void client.end().catch(() => undefined);
      setTimeout(() => void this.connect(attempt + 1), Math.min(30_000, 500 * 2 ** attempt));
      // Notifications sent while we were down are lost: tell every stream to refetch.
      for (const s of this.streams) s.reply.raw.write("event: resync\ndata: {}\n\n");
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
    } catch (err) {
      this.log.warn(`LISTEN connect failed: ${String(err)}`);
      setTimeout(() => void this.connect(attempt + 1), Math.min(30_000, 500 * 2 ** attempt));
    }
  }

  private visible(s: Stream, e: AppEvent): boolean {
    if (s.ws !== e.ws) return false;
    switch (e.topic) {
      case "timer":
        return s.member === e.member;
      case "time":
        return s.member === e.member || s.isAdmin;
      case "catalog":
        return true;
      case "invoice":
        return s.isAdmin; // Members never receive invoice events (06 §4.3)
      case "session":
        return s.member === e.member;
    }
  }

  private dispatch(event: AppEvent) {
    const seq = ++this.counter;
    const id = `${this.epoch}-${seq}`;
    this.buffer.push({ id, seq, event });
    if (this.buffer.length > 1000) this.buffer.shift();
    for (const s of this.streams) {
      if (!this.visible(s, event)) continue;
      if (event.topic === "session") {
        s.reply.raw.write(`id: ${id}\nevent: session\ndata: ${JSON.stringify(event)}\n\n`);
        s.reply.raw.end();
        continue;
      }
      s.reply.raw.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
    }
  }

  open(ctx: Ctx, req: FastifyRequest, reply: FastifyReply) {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 3000\n\n");
    const stream: Stream = {
      ws: ctx.workspace.id,
      member: ctx.member.id,
      isAdmin: ctx.isAdmin,
      sessionId: ctx.sessionId,
      reply,
    };
    // Replay from Last-Event-ID when it is in this boot's buffer; otherwise resync (06 §4.5).
    const last = req.headers["last-event-id"];
    if (typeof last === "string" && last) {
      const [ep, n] = last.split("-");
      const seq = Number(n);
      if (ep === this.epoch && this.buffer.length && seq >= this.buffer[0].seq - 1) {
        for (const b of this.buffer) {
          if (b.seq > seq && this.visible(stream, b.event)) {
            reply.raw.write(`id: ${b.id}\ndata: ${JSON.stringify(b.event)}\n\n`);
          }
        }
      } else {
        reply.raw.write("event: resync\ndata: {}\n\n");
      }
    }
    // Cap streams per member at 10, closing the oldest (06 §4.7).
    const mine = [...this.streams].filter((s) => s.member === stream.member);
    if (mine.length >= 10) {
      mine[0].reply.raw.end();
      this.streams.delete(mine[0]);
    }
    this.streams.add(stream);
    req.raw.on("close", () => this.streams.delete(stream));
  }
}

@Controller("v1/events")
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  stream(@C() ctx: Ctx, @Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    this.events.open(ctx, req, reply);
  }
}
