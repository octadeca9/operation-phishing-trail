import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { ChallengeRepository } from "./challenges/challengeRepository.js";
import { InMemoryProgressRepository } from "./sessions/sessionStore.js";
import { SessionService } from "./sessions/sessionService.js";
import { MockIdentityProvider, PlatformIdentityProvider, type IdentityProvider } from "./auth/identity.js";
import { buildRouter } from "./http/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(): Express {
  const challenge = ChallengeRepository.load(config.challengeDir, config.challengeId);
  const progress = new InMemoryProgressRepository();
  const sessions = new SessionService(progress, challenge, { ttlSeconds: config.sessionTtlSeconds });
  const identity: IdentityProvider =
    config.authMode === "platform" ? new PlatformIdentityProvider() : new MockIdentityProvider();

  const app = express();
  app.disable("x-powered-by");

  // Security headers (baseline; Nginx menambah lagi di depan).
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    next();
  });

  app.use(express.json({ limit: config.maxBodyBytes }));

  // Health check — tanpa informasi rahasia.
  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok", challenge: challenge.manifest.id, version: challenge.manifest.version });
  });

  app.use("/api/v1", buildRouter({ challenge, sessions, identity }));

  // Frontend statis (tanpa secret). Dilayani dari dist-relative ../public.
  const publicDir = path.resolve(__dirname, "../public");
  app.use(express.static(publicDir, { index: "index.html", extensions: ["html"] }));

  return app;
}
