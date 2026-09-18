/**
 * Structured JSON logs. On Lambda, stdout goes to CloudWatch Logs, where these lines
 * can be queried with Logs Insights, e.g.  fields event, caseId | filter level="error"
 */
type Level = "info" | "warn" | "error";

function write(level: Level, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...data });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};

type Unit = "Count" | "Seconds" | "Percent" | "None";

/**
 * Custom metrics in CloudWatch Embedded Metric Format: one JSON log line that CloudWatch turns into
 * metrics (namespace CivicProof) without an API call, so a Lambda can emit them for free.
 */
export function metrics(event: string, dimensions: Record<string, string>, values: Record<string, [number, Unit]>, extra?: Record<string, unknown>) {
  const line = {
    level: "info",
    event,
    at: new Date().toISOString(),
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: "CivicProof",
          Dimensions: [Object.keys(dimensions)],
          Metrics: Object.entries(values).map(([Name, [, Unit]]) => ({ Name, Unit })),
        },
      ],
    },
    ...dimensions,
    ...Object.fromEntries(Object.entries(values).map(([k, [v]]) => [k, v])),
    ...extra,
  };
  console.log(JSON.stringify(line));
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
