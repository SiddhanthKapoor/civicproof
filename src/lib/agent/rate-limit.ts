/**
 * Retry for rate-limited or temporarily overloaded model calls.
 *
 * Gemini's free tier allows a handful of requests per minute, and an investigation makes one model
 * call per turn. Newer @google/genai versions wrap the 429 so the SDK's own classifier doesn't see
 * RESOURCE_EXHAUSTED, which would end the run on the first throttle. This strategy recognises the
 * throttle, waits as long as the server asks ("retry in 10s"), and gives up at once on a daily
 * quota, where waiting a minute cannot help.
 */
import { ModelRetryStrategy, ModelThrottledError, type AfterModelCallEvent, type RetryDecision } from "@strands-agents/sdk";

export class RateLimitExhaustedError extends Error {}

export function classifyThrottle(message: string): { throttled: boolean; daily: boolean; overloaded: boolean; retryAfterMs?: number } {
  // 429s (quota) and 503s (model overloaded, "high demand") are both worth waiting out.
  const throttled = /RESOURCE_EXHAUSTED|Too Many Requests|"code":\s*(429|503)|UNAVAILABLE|high demand|overloaded|ThrottlingException|rate limit|timed? ?out|aborted/i.test(message);
  const daily = /PerDay|per day|daily/i.test(message);
  const overloaded = /"code":\s*503|UNAVAILABLE|high demand|overloaded/i.test(message);
  const hint = /retry in ([\d.]+)\s*s/i.exec(message) ?? /retryDelay\\*"?:\s*\\*"(\d+(?:\.\d+)?)s/.exec(message);
  return { throttled, daily, overloaded, retryAfterMs: hint ? Math.ceil(Number(hint[1]) * 1000) : undefined };
}

export class RateLimitRetry extends ModelRetryStrategy {
  readonly name = "civicproof:rate-limit-retry";

  constructor(
    private readonly onWait: (waitMs: number, attempt: number, reason: "overloaded" | "rate_limited") => void,
    private readonly maxAttempts = 8,
  ) {
    super();
  }

  protected computeRetryDecision(event: AfterModelCallEvent): RetryDecision {
    const error = event.error;
    if (!error || event.attemptCount >= this.maxAttempts) return { retry: false };
    const t = classifyThrottle(error.message ?? "");
    if (!(error instanceof ModelThrottledError) && !t.throttled) return { retry: false };
    if (t.daily) return { retry: false };
    // The server's hint plus a margin; otherwise back off exponentially from 5 s. Never more than a minute.
    const waitMs = Math.min(65_000, (t.retryAfterMs ?? 5_000 * 2 ** (event.attemptCount - 1)) + 750);
    this.onWait(waitMs, event.attemptCount, t.overloaded ? "overloaded" : "rate_limited");
    return { retry: true, waitMs };
  }
}

/** A short, human explanation of a model error for the case page. */
export function describeModelError(message: string, engineName: string): string | undefined {
  const t = classifyThrottle(message);
  if (!t.throttled) return undefined;
  if (t.daily) return `${engineName} daily quota is used up for this API key. Try again tomorrow, or enable billing on the key's Google Cloud project.`;
  if (t.overloaded) return `${engineName} was overloaded ("high demand") for several minutes. Try again shortly, or switch GEMINI_MODEL_ID to a less busy model.`;
  return `${engineName} kept rate-limiting the requests. Wait a minute and run the investigation again.`;
}
