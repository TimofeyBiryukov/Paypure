import { HttpException } from "@nestjs/common";

/** Errors carry a stable `code` the client can branch on, plus a human message. */
export class ApiError extends HttpException {
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super({ code, message, ...extra }, status);
  }
}

export const notFound = (what = "Not found") => new ApiError(404, "not_found", what);
export const forbidden = (msg = "Admins only") => new ApiError(403, "forbidden", msg);
export const conflict = (code: string, msg: string, extra: Record<string, unknown> = {}) =>
  new ApiError(409, code, msg, extra);
export const invalid = (msg: string, extra: Record<string, unknown> = {}) =>
  new ApiError(422, "invalid", msg, extra);
