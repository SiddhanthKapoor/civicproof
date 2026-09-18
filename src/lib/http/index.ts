import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorMessage, log } from "@/lib/log";
import { NotFoundError } from "@/lib/store";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function problem(status: number, message: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Wraps a route handler: validation errors → 400 with field messages, not-found → 404, else 500 without internals. */
export function handle<A extends unknown[]>(name: string, fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ZodError) {
        return problem(400, "Some fields need attention.", {
          fields: Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "_", i.message])),
        });
      }
      if (e instanceof NotFoundError) return problem(404, "Case not found.");
      log.error("api.error", { route: name, error: errorMessage(e) });
      return problem(500, "Something went wrong on our side. The error has been logged.");
    }
  };
}

/** Best-effort client IP for rate limiting (Lambda Function URL / proxies set x-forwarded-for). */
export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";
}

const buckets = new Map<string, { n: number; reset: number }>();
/**
 * Fixed-window, in-memory rate limit. Per instance only — a first line of defence in front of
 * the per-day DynamoDB budget and Cedar policy that actually cap Bedrock spend.
 */
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  // Off in development and tests (every request comes from localhost) unless explicitly enabled.
  if (process.env.NODE_ENV !== "production" && process.env.CIVICPROOF_RATE_LIMIT !== "on") return false;
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  b.n++;
  return b.n > limit;
}

export function ownerKeyFrom(req: Request): string | null {
  return req.headers.get("x-owner-key");
}
