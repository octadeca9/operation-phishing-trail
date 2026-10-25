import path from "node:path";

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env var: ${name}`);
  }
  return v;
}

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Invalid integer for ${name}: ${v}`);
  return n;
}

const appEnv = env("APP_ENV", "development");

export const config = {
  appEnv,
  isProduction: appEnv === "production",
  port: intEnv("PORT", 8080),
  logLevel: env("LOG_LEVEL", "info"),

  // Direktori konten challenge (mount read-only di container).
  challengeDir: path.resolve(env("CHALLENGE_DIR", path.resolve(process.cwd(), "../challenge"))),
  challengeId: env("CHALLENGE_ID", "operation-phishing-trail"),

  // Mode identitas. "mock" HANYA untuk local/dev; dilarang di production.
  authMode: env("AUTH_MODE", "mock") as "mock" | "platform",

  // Masa berlaku sesi (detik).
  sessionTtlSeconds: intEnv("SESSION_TTL_SECONDS", 60 * 60 * 2),

  // Rate limiting endpoint submit/hint: N request per window (detik) per sesi.
  rateLimitMax: intEnv("RATE_LIMIT_MAX", 30),
  rateLimitWindowSeconds: intEnv("RATE_LIMIT_WINDOW_SECONDS", 60),

  // Batas ukuran body JSON.
  maxBodyBytes: intEnv("MAX_BODY_BYTES", 16 * 1024),
} as const;

export function assertSafeForPublic(): void {
  if (config.isProduction && config.authMode === "mock") {
    throw new Error(
      "AUTH_MODE=mock dilarang saat APP_ENV=production. Integrasikan identitas platform induk sebelum rilis publik.",
    );
  }
}
