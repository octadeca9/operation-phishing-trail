import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { AnswerKey, ManifestArtifact, PublicManifest } from "../types.js";

const fieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  placeholder: z.string().optional(),
});

const optionSchema = z.object({ id: z.string().min(1), label: z.string().min(1) });

const objectiveSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["structured", "exact_match", "multi_select", "single_select"]),
  points: z.number().int().nonnegative(),
  title: z.string().min(1),
  prompt: z.string().min(1),
  fields: z.array(fieldSchema).optional(),
  field: fieldSchema.optional(),
  options: z.array(optionSchema).optional(),
});

const manifestSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  difficulty: z.string().min(1),
  estimated_minutes: z.number().int().positive(),
  description: z.string().min(1),
  artifacts: z
    .array(
      z.object({
        id: z.string().min(1),
        path: z.string().min(1),
        title: z.string().min(1),
        display_mode: z.enum(["plain_text", "structured_json"]),
      }),
    )
    .min(1),
  hints: z.object({ max_level: z.number().int().nonnegative() }),
  scoring: z.object({
    max_score: z.number().int().positive(),
    hint_penalty_per_level: z.number().int().nonnegative(),
  }),
  objectives: z.array(objectiveSchema).min(1),
});

const answerSchema = z.object({
  challenge_id: z.string().min(1),
  version: z.number().int().positive(),
  final_flag: z.string().min(1),
  checkpoints: z.record(
    z.object({
      type: z.enum(["structured", "exact_match", "multi_select", "single_select"]),
      expected: z.unknown(),
      policy: z.literal("exact_set").optional(),
      normalize: z.object({ lowercase: z.boolean().optional(), trim: z.boolean().optional() }).optional(),
      hints: z.array(z.string()).min(1),
    }),
  ),
});

export class ChallengeRepository {
  readonly manifest: PublicManifest;
  private readonly answers: AnswerKey;
  private readonly baseDir: string;

  private constructor(manifest: PublicManifest, answers: AnswerKey, baseDir: string) {
    this.manifest = manifest;
    this.answers = answers;
    this.baseDir = baseDir;
  }

  static load(challengeDir: string, challengeId: string): ChallengeRepository {
    const baseDir = path.join(challengeDir, challengeId);
    const manifestRaw = yaml.load(fs.readFileSync(path.join(baseDir, "manifest.yaml"), "utf8"));
    const manifest = manifestSchema.parse(manifestRaw) as PublicManifest;

    const answersRaw = yaml.load(fs.readFileSync(path.join(baseDir, "private", "answers.yaml"), "utf8"));
    const answers = answerSchema.parse(answersRaw) as AnswerKey;

    // Konsistensi silang manifest <-> answers.
    if (manifest.id !== answers.challenge_id) {
      throw new Error("challenge_id manifest tidak cocok dengan answers.");
    }
    if (manifest.version !== answers.version) {
      throw new Error("version manifest tidak cocok dengan answers.");
    }
    for (const obj of manifest.objectives) {
      const ans = answers.checkpoints[obj.id];
      if (!ans) throw new Error(`Jawaban untuk checkpoint ${obj.id} tidak ditemukan.`);
      if (ans.type !== obj.type) {
        throw new Error(`Tipe checkpoint ${obj.id} tidak konsisten antara manifest & answers.`);
      }
      if (ans.hints.length > manifest.hints.max_level) {
        throw new Error(`Jumlah hint ${obj.id} melebihi max_level.`);
      }
    }

    // Validasi: setiap artefak ada di disk.
    for (const a of manifest.artifacts) {
      const p = ChallengeRepository.resolveArtifact(baseDir, a);
      if (!fs.existsSync(p)) throw new Error(`Artefak hilang: ${a.id} (${a.path})`);
    }

    return new ChallengeRepository(manifest, answers, baseDir);
  }

  get finalFlag(): string {
    return this.answers.final_flag;
  }

  getAnswer(checkpointId: string) {
    return this.answers.checkpoints[checkpointId];
  }

  getObjective(checkpointId: string) {
    return this.manifest.objectives.find((o) => o.id === checkpointId);
  }

  getArtifactMeta(artifactId: string): ManifestArtifact | undefined {
    return this.manifest.artifacts.find((a) => a.id === artifactId);
  }

  /** Allowlist read — tidak pernah menggabungkan input user ke path. */
  readArtifact(artifactId: string): { meta: ManifestArtifact; content: string } | null {
    const meta = this.getArtifactMeta(artifactId);
    if (!meta) return null;
    const resolved = ChallengeRepository.resolveArtifact(this.baseDir, meta);
    // Pertahanan berlapis: pastikan path tetap di dalam baseDir.
    const rel = path.relative(this.baseDir, resolved);
    if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
    const content = fs.readFileSync(resolved, "utf8");
    return { meta, content };
  }

  readWalkthrough(): string {
    return fs.readFileSync(path.join(this.baseDir, "walkthrough.md"), "utf8");
  }

  private static resolveArtifact(baseDir: string, meta: ManifestArtifact): string {
    // meta.path berasal dari manifest tepercaya, bukan input user; tetap
    // di-normalisasi & dikurung ke baseDir.
    return path.resolve(baseDir, meta.path);
  }
}
