import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import type { ChallengeRepository } from "../challenges/challengeRepository.js";
import {
  SessionService,
  toPublicSession,
  NotFoundError,
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../sessions/sessionService.js";
import type { IdentityProvider } from "../auth/identity.js";
import { RateLimiter } from "./rateLimit.js";
import { audit, logger } from "../observability/logger.js";
import { config } from "../config.js";

interface Deps {
  challenge: ChallengeRepository;
  sessions: SessionService;
  identity: IdentityProvider;
}

const submissionSchema = z.object({
  checkpoint_id: z.string().min(1).max(16),
  answer: z.unknown(),
  idempotency_key: z.string().min(1).max(128).optional(),
});

const hintSchema = z.object({ checkpoint_id: z.string().min(1).max(16) });

export function buildRouter(deps: Deps): Router {
  const router = Router();
  const submitLimiter = new RateLimiter(config.rateLimitMax, config.rateLimitWindowSeconds * 1000);

  // --- Auth middleware ------------------------------------------------------
  function requireUser(req: Request, res: Response, next: NextFunction): void {
    const user = deps.identity.authenticate(req);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    (req as Request & { userId: string }).userId = user.id;
    next();
  }
  const uid = (req: Request): string => (req as Request & { userId: string }).userId;
  const p = (req: Request, name: string): string => req.params[name] ?? "";

  // --- Challenge detail (publik, butuh auth) --------------------------------
  router.get(`/challenges/${config.challengeId}`, requireUser, (_req, res) => {
    // Hanya metadata aman dari manifest; tidak ada jawaban/flag.
    res.json({ challenge: deps.challenge.manifest });
  });

  // --- Buat sesi ------------------------------------------------------------
  router.post("/sessions", requireUser, (req, res) => {
    const body = z.object({ challenge_id: z.string() }).safeParse(req.body);
    if (!body.success || body.data.challenge_id !== config.challengeId) {
      res.status(400).json({ error: "challenge_id tidak valid" });
      return;
    }
    const session = deps.sessions.create(uid(req));
    audit("session_started", { session_id: session.id, challenge_id: session.challengeId });
    res.status(201).json(toPublicSession(session, deps.challenge.manifest.scoring.max_score));
  });

  // --- Status sesi ----------------------------------------------------------
  router.get("/sessions/:id", requireUser, (req, res) => {
    const s = deps.sessions.getOwned(p(req, "id"), uid(req));
    res.json(toPublicSession(s, deps.challenge.manifest.scoring.max_score));
  });

  // --- Ambil artefak (allowlist) --------------------------------------------
  router.get("/sessions/:id/artifacts/:artifactId", requireUser, (req, res) => {
    const s = deps.sessions.getOwned(p(req, "id"), uid(req));
    if (s.status !== "active" && s.status !== "completed") {
      res.status(409).json({ error: `sesi tidak aktif (status=${s.status})` });
      return;
    }
    const result = deps.challenge.readArtifact(p(req, "artifactId"));
    if (!result) {
      res.status(404).json({ error: "artefak tidak ditemukan / tidak diizinkan" });
      return;
    }
    audit("artifact_viewed", { session_id: s.id, artifact_id: result.meta.id });
    // Selalu text/plain + nosniff: EML/JSON tidak dieksekusi sebagai HTML aktif.
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(result.meta.title)}"`);
    res.send(result.content);
  });

  // --- Submit checkpoint ----------------------------------------------------
  router.post("/sessions/:id/submissions", requireUser, (req, res) => {
    if (!submitLimiter.take(`${uid(req)}:${p(req, "id")}`)) {
      res.status(429).json({ error: "terlalu banyak percobaan, coba lagi nanti" });
      return;
    }
    const parsed = submissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "payload tidak valid" });
      return;
    }
    const { checkpoint_id, answer, idempotency_key } = parsed.data;
    audit("submission_received", { session_id: p(req, "id"), checkpoint_id });
    const outcome = deps.sessions.submit(p(req, "id"), uid(req), checkpoint_id, answer, idempotency_key);
    audit(outcome.correct ? "submission_correct" : "submission_incorrect", {
      session_id: p(req, "id"),
      checkpoint_id,
    });
    if (outcome.completed) {
      audit("challenge_completed", { session_id: p(req, "id"), score: outcome.score });
    }
    // Jangan pernah mengembalikan expected answer / flag pada response.
    res.json({
      checkpoint_id: outcome.checkpointId,
      correct: outcome.correct,
      points_awarded: outcome.pointsAwarded,
      score: outcome.score,
      completed: outcome.completed,
    });
  });

  // --- Hint -----------------------------------------------------------------
  router.post("/sessions/:id/hints", requireUser, (req, res) => {
    if (!submitLimiter.take(`${uid(req)}:${p(req, "id")}:hint`)) {
      res.status(429).json({ error: "terlalu banyak permintaan" });
      return;
    }
    const parsed = hintSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "payload tidak valid" });
      return;
    }
    const outcome = deps.sessions.revealHint(p(req, "id"), uid(req), parsed.data.checkpoint_id);
    audit("hint_revealed", {
      session_id: p(req, "id"),
      checkpoint_id: outcome.checkpointId,
      hint_level: outcome.hintLevel,
    });
    res.json({
      checkpoint_id: outcome.checkpointId,
      hint_level: outcome.hintLevel,
      hint: outcome.hint,
      score: outcome.score,
    });
  });

  // --- Reset ----------------------------------------------------------------
  router.post("/sessions/:id/reset", requireUser, (req, res) => {
    const next = deps.sessions.reset(p(req, "id"), uid(req));
    audit("session_reset", { old_session_id: p(req, "id"), new_session_id: next.id });
    res.status(201).json(toPublicSession(next, deps.challenge.manifest.scoring.max_score));
  });

  // --- Walkthrough (terkunci sampai selesai) --------------------------------
  router.get("/sessions/:id/walkthrough", requireUser, (req, res) => {
    const md = deps.sessions.walkthrough(p(req, "id"), uid(req));
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(md);
  });

  // --- Error handler --------------------------------------------------------
  router.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof NotFoundError) return void res.status(404).json({ error: err.message });
    if (err instanceof ForbiddenError) return void res.status(403).json({ error: err.message });
    if (err instanceof ConflictError) return void res.status(409).json({ error: err.message });
    if (err instanceof ValidationError) return void res.status(400).json({ error: err.message });
    logger.error("unhandled_error", { message: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ error: "internal error" });
  });

  return router;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
}
