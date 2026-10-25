import { randomUUID } from "node:crypto";
import type { ChallengeRepository } from "../challenges/challengeRepository.js";
import { awardablePoints, evaluate } from "../scoring/scoringService.js";
import type { LabSession, CheckpointState } from "../types.js";
import type { ProgressRepository } from "./sessionStore.js";

export class NotFoundError extends Error {}
export class ForbiddenError extends Error {}
export class ConflictError extends Error {}
export class ValidationError extends Error {}

export interface SubmitOutcome {
  checkpointId: string;
  correct: boolean;
  pointsAwarded: number;
  score: number;
  completed: boolean;
}

export interface HintOutcome {
  checkpointId: string;
  hintLevel: number;
  hint: string;
  score: number;
}

export class SessionService {
  constructor(
    private readonly repo: ProgressRepository,
    private readonly challenge: ChallengeRepository,
    private readonly opts: { ttlSeconds: number },
  ) {}

  private freshCheckpoints(): Record<string, CheckpointState> {
    const out: Record<string, CheckpointState> = {};
    for (const o of this.challenge.manifest.objectives) {
      out[o.id] = { correct: false, pointsAwarded: 0, attempts: 0, hintLevel: 0 };
    }
    return out;
  }

  create(userId: string): LabSession {
    const now = Date.now();
    const session: LabSession = {
      id: randomUUID(),
      platformUserId: userId,
      challengeId: this.challenge.manifest.id,
      challengeVersion: this.challenge.manifest.version,
      status: "active",
      score: 0,
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + this.opts.ttlSeconds * 1000).toISOString(),
      resetCount: 0,
      checkpoints: this.freshCheckpoints(),
      seenIdempotencyKeys: new Set(),
    };
    this.repo.create(session);
    return session;
  }

  /** Ambil sesi dengan ownership check & lazy-expiry. */
  getOwned(sessionId: string, userId: string): LabSession {
    const s = this.repo.get(sessionId);
    if (!s) throw new NotFoundError("sesi tidak ditemukan");
    // IDOR guard: kepemilikan harus cocok. Jangan andalkan ID sesi saja.
    if (s.platformUserId !== userId) throw new ForbiddenError("bukan pemilik sesi");
    if (s.status === "active" && Date.parse(s.expiresAt) < Date.now()) {
      s.status = "expired";
      this.repo.save(s);
    }
    return s;
  }

  submit(
    sessionId: string,
    userId: string,
    checkpointId: string,
    answer: unknown,
    idempotencyKey?: string,
  ): SubmitOutcome {
    const session = this.getOwned(sessionId, userId);
    if (session.status !== "active") {
      throw new ConflictError(`sesi tidak aktif (status=${session.status})`);
    }
    const objective = this.challenge.getObjective(checkpointId);
    const answerKey = this.challenge.getAnswer(checkpointId);
    const cp = session.checkpoints[checkpointId];
    if (!objective || !answerKey || !cp) throw new ValidationError("checkpoint tidak dikenal");

    // Idempotency: key yang sama tidak diproses dua kali.
    if (idempotencyKey && session.seenIdempotencyKeys.has(idempotencyKey)) {
      return this.outcome(session, checkpointId, cp.correct, 0);
    }

    // Sudah benar sebelumnya: jangan tambah poin lagi (idempotent pada hasil).
    if (cp.correct) {
      if (idempotencyKey) session.seenIdempotencyKeys.add(idempotencyKey);
      this.repo.save(session);
      return this.outcome(session, checkpointId, true, 0);
    }

    cp.attempts += 1;
    const { correct } = evaluate(answerKey, answer);

    let awarded = 0;
    if (correct) {
      awarded = awardablePoints(
        objective.points,
        cp.hintLevel,
        this.challenge.manifest.scoring.hint_penalty_per_level,
      );
      cp.correct = true;
      cp.pointsAwarded = awarded;
      session.score += awarded;
    }

    if (idempotencyKey) session.seenIdempotencyKeys.add(idempotencyKey);

    // Completion: seluruh objective benar.
    const completed = this.challenge.manifest.objectives.every((o) => session.checkpoints[o.id]?.correct);
    if (completed && session.status === "active") {
      session.status = "completed";
      session.completedAt = new Date().toISOString();
    }

    this.repo.save(session);
    return this.outcome(session, checkpointId, correct, awarded);
  }

  revealHint(sessionId: string, userId: string, checkpointId: string): HintOutcome {
    const session = this.getOwned(sessionId, userId);
    if (session.status !== "active") {
      throw new ConflictError(`sesi tidak aktif (status=${session.status})`);
    }
    const answerKey = this.challenge.getAnswer(checkpointId);
    const cp = session.checkpoints[checkpointId];
    if (!answerKey || !cp) throw new ValidationError("checkpoint tidak dikenal");

    const maxLevel = Math.min(this.challenge.manifest.hints.max_level, answerKey.hints.length);
    if (cp.hintLevel >= maxLevel) {
      throw new ConflictError("semua hint untuk checkpoint ini sudah dibuka");
    }
    const hintText = answerKey.hints[cp.hintLevel];
    if (hintText === undefined) throw new ConflictError("tidak ada hint tambahan");
    cp.hintLevel += 1;
    this.repo.save(session);
    return { checkpointId, hintLevel: cp.hintLevel, hint: hintText, score: session.score };
  }

  /** Reset HANYA sesi ini; buat sesi baru untuk user yang sama. */
  reset(sessionId: string, userId: string): LabSession {
    const old = this.getOwned(sessionId, userId);
    old.status = "reset";
    this.repo.save(old);

    const next = this.create(userId);
    next.resetCount = old.resetCount + 1;
    this.repo.save(next);
    return next;
  }

  walkthrough(sessionId: string, userId: string): string {
    const session = this.getOwned(sessionId, userId);
    // Terkunci sampai syarat penyelesaian terpenuhi.
    if (session.status !== "completed") {
      throw new ForbiddenError("walkthrough terkunci sampai challenge selesai");
    }
    return this.challenge.readWalkthrough();
  }

  private outcome(session: LabSession, checkpointId: string, correct: boolean, awarded: number): SubmitOutcome {
    return {
      checkpointId,
      correct,
      pointsAwarded: awarded,
      score: session.score,
      completed: session.status === "completed",
    };
  }
}

/** Ringkasan sesi yang AMAN dikirim ke client (tanpa jawaban). */
export function toPublicSession(session: LabSession, maxScore: number) {
  return {
    session_id: session.id,
    challenge_id: session.challengeId,
    challenge_version: session.challengeVersion,
    status: session.status,
    score: session.score,
    max_score: maxScore,
    started_at: session.startedAt,
    completed_at: session.completedAt ?? null,
    expires_at: session.expiresAt,
    reset_count: session.resetCount,
    checkpoints: Object.fromEntries(
      Object.entries(session.checkpoints).map(([id, c]) => [
        id,
        { correct: c.correct, points_awarded: c.pointsAwarded, attempts: c.attempts, hint_level: c.hintLevel },
      ]),
    ),
  };
}
