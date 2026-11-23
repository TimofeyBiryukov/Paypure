import { createHash, randomBytes } from "node:crypto";
import {
  type CanActivate,
  createParamDecorator,
  type ExecutionContext,
  Injectable,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { isValidTimeZone } from "@paypure/domain";
import type { Member, Workspace } from "../generated/prisma/client";
import { PrismaService } from "../prisma.service";
import { ApiError, forbidden } from "./errors";

export interface Ctx {
  member: Member;
  workspace: Workspace;
  sessionId: string;
  isAdmin: boolean;
  /** display zone: the device's (X-Timezone, from the tz cookie), else the member's (06 §3.2) */
  tz: string;
}

export const IS_PUBLIC = "isPublic";
export const ADMIN_ONLY = "adminOnly";
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Admin-only route (Brief §6.1 permission table, D7). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export const SESSION_DAYS = 30;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
    if (!token) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { member: { include: { workspace: true } } },
    });
    if (!session || session.expiresAt < new Date() || session.member.status !== "active") {
      throw new ApiError(401, "unauthenticated", "Your session has ended. Sign in again.");
    }
    const { workspace, ...member } = session.member;
    const headerTz = req.headers["x-timezone"];
    const tz =
      typeof headerTz === "string" && isValidTimeZone(headerTz) ? headerTz : member.timeZone;
    const ctx: Ctx = {
      member: member as Member,
      workspace,
      sessionId: session.id,
      isAdmin: member.role === "admin",
      tz,
    };
    req.ctx = ctx;
    if (this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, targets) && !ctx.isAdmin) {
      throw forbidden();
    }
    return true;
  }
}

export const C = createParamDecorator((_: unknown, context: ExecutionContext): Ctx => {
  return context.switchToHttp().getRequest().ctx;
});
