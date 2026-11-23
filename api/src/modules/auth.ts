import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { AcceptInviteInput, isValidTimeZone, LoginInput } from "@paypure/domain";
import * as argon2 from "argon2";
import { C, type Ctx, hashToken, newToken, Public, SESSION_DAYS } from "../common/auth";
import { ApiError } from "../common/errors";
import { parse } from "../common/zod";
import { PrismaService } from "../prisma.service";
import { EventsService } from "./events";

/** Email + password (argon2id) and opaque, hashed DB sessions (Tech §5.3, T6). */
@Controller("v1/auth")
export class AuthController {
  private attempts = new Map<string, { n: number; until: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  /** Simple in-memory throttle: 10 tries per email per 10 minutes (enough for one instance). */
  private throttle(key: string) {
    const now = Date.now();
    const a = this.attempts.get(key);
    if (a && a.until > now && a.n >= 10) {
      throw new ApiError(
        429,
        "too_many_attempts",
        "Too many attempts. Try again in a few minutes.",
      );
    }
    if (!a || a.until <= now) this.attempts.set(key, { n: 1, until: now + 600_000 });
    else a.n++;
  }

  private async createSession(memberId: string) {
    const token = newToken();
    await this.prisma.session.create({
      data: {
        memberId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000),
      },
    });
    return token;
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  async login(@Body() body: unknown) {
    const input = parse(LoginInput, body);
    const email = input.email.toLowerCase();
    this.throttle(email);
    const member = await this.prisma.member.findFirst({ where: { email, status: "active" } });
    const ok = member?.passwordHash
      ? await argon2.verify(member.passwordHash, input.password)
      : false;
    if (!member || !ok)
      throw new ApiError(401, "bad_credentials", "That email and password don't match.");
    this.attempts.delete(email);
    // Seed the member zone from the device on first login (06 §3.4).
    if (input.tz && isValidTimeZone(input.tz) && member.timeZone === "UTC") {
      await this.prisma.member.update({ where: { id: member.id }, data: { timeZone: input.tz } });
    }
    return { token: await this.createSession(member.id) };
  }

  @Public()
  @Post("accept-invite")
  @HttpCode(200)
  async acceptInvite(@Body() body: unknown) {
    const input = parse(AcceptInviteInput, body);
    const member = await this.prisma.member.findUnique({
      where: { inviteToken: hashToken(input.token) },
    });
    if (!member || member.status === "deactivated") {
      throw new ApiError(
        404,
        "invite_invalid",
        "This invite link is no longer valid. Ask an admin for a new one.",
      );
    }
    await this.prisma.member.update({
      where: { id: member.id },
      data: {
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
        status: "active",
        inviteToken: null,
        ...(input.tz && isValidTimeZone(input.tz) ? { timeZone: input.tz } : {}),
      },
    });
    return { token: await this.createSession(member.id) };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@C() ctx: Ctx) {
    await this.prisma.$transaction(async (tx) => {
      await tx.session.delete({ where: { id: ctx.sessionId } });
      await this.events.emit(tx, {
        ws: ctx.workspace.id,
        member: ctx.member.id,
        topic: "session",
        action: "logout",
      });
    });
    return { ok: true };
  }

  @Get("me")
  me(@C() ctx: Ctx) {
    const { passwordHash: _p, inviteToken: _i, ...member } = ctx.member;
    const w = ctx.workspace;
    return {
      member,
      isAdmin: ctx.isAdmin,
      tz: ctx.tz,
      workspace: {
        id: w.id,
        name: w.name,
        currency: w.currency,
        timeZone: w.timeZone,
        businessName: w.businessName,
      },
    };
  }
}
