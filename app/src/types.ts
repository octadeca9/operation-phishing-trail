// Tipe domain bersama.

export type CheckpointType =
  | "structured"
  | "exact_match"
  | "multi_select"
  | "single_select";

export interface ManifestField {
  id: string;
  label: string;
  placeholder?: string;
}

export interface ManifestOption {
  id: string;
  label: string;
}

export interface ManifestObjective {
  id: string;
  type: CheckpointType;
  points: number;
  title: string;
  prompt: string;
  fields?: ManifestField[]; // structured
  field?: ManifestField; // exact_match
  options?: ManifestOption[]; // *_select
}

export interface ManifestArtifact {
  id: string;
  path: string;
  title: string;
  display_mode: "plain_text" | "structured_json";
}

/** Manifest publik — AMAN dikirim ke client. Tidak memuat jawaban. */
export interface PublicManifest {
  id: string;
  version: number;
  title: string;
  difficulty: string;
  estimated_minutes: number;
  description: string;
  artifacts: ManifestArtifact[];
  hints: { max_level: number };
  scoring: { max_score: number; hint_penalty_per_level: number };
  objectives: ManifestObjective[];
}

/** Rubric rahasia — server-side only. */
export interface AnswerKey {
  challenge_id: string;
  version: number;
  final_flag: string;
  checkpoints: Record<string, CheckpointAnswer>;
}

export interface NormalizeRule {
  lowercase?: boolean;
  trim?: boolean;
}

export interface CheckpointAnswer {
  type: CheckpointType;
  expected: unknown;
  policy?: "exact_set";
  normalize?: NormalizeRule;
  hints: string[];
}

export type SessionStatus = "active" | "completed" | "expired" | "reset";

export interface CheckpointState {
  correct: boolean;
  pointsAwarded: number;
  attempts: number;
  hintLevel: number; // jumlah hint yang sudah dibuka (0..max_level)
}

export interface LabSession {
  id: string;
  platformUserId: string;
  challengeId: string;
  challengeVersion: number;
  status: SessionStatus;
  score: number;
  startedAt: string;
  completedAt?: string;
  expiresAt: string;
  resetCount: number;
  checkpoints: Record<string, CheckpointState>;
  // idempotency: key submission yang sudah diproses -> hasil correct
  seenIdempotencyKeys: Set<string>;
}

export interface AuthenticatedUser {
  id: string;
}
