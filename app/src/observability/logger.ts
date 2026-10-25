import { config } from "../config.js";

type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// Field yang tidak boleh pernah di-log (redaction best-effort).
const REDACT_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "token",
  "secret",
  "flag",
  "final_flag",
  "answer",
  "expected",
]);

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

const threshold = order[(config.logLevel as Level)] ?? order.info;

function emit(level: Level, event: string, meta: Record<string, unknown> = {}): void {
  if (order[level] < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redact(meta),
  };
  const out = JSON.stringify(line);
  if (level === "error") process.stderr.write(out + "\n");
  else process.stdout.write(out + "\n");
}

export const logger = {
  debug: (event: string, meta?: Record<string, unknown>) => emit("debug", event, meta),
  info: (event: string, meta?: Record<string, unknown>) => emit("info", event, meta),
  warn: (event: string, meta?: Record<string, unknown>) => emit("warn", event, meta),
  error: (event: string, meta?: Record<string, unknown>) => emit("error", event, meta),
};

// Daftar event audit yang dikenal (lihat PRD §17 / Blueprint §13).
export type AuditEventType =
  | "session_started"
  | "artifact_viewed"
  | "submission_received"
  | "submission_correct"
  | "submission_incorrect"
  | "hint_revealed"
  | "session_reset"
  | "challenge_completed"
  | "platform_sync_failed"
  | "integration_error";

export function audit(event: AuditEventType, meta: Record<string, unknown> = {}): void {
  emit("info", event, { audit: true, ...meta });
}
