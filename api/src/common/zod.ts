import type { z } from "zod";
import { ApiError } from "./errors";

/** Validate a body with a schema from @paypure/domain. */
export function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join(".") || "_"] = issue.message;
    throw new ApiError(422, "invalid", "Some fields need attention.", { fields });
  }
  return r.data;
}
