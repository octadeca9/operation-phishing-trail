import type { CheckpointAnswer, NormalizeRule } from "../types.js";

export interface EvalResult {
  correct: boolean;
}

function normStr(value: unknown, rule?: NormalizeRule): string {
  let s = String(value ?? "");
  if (rule?.trim ?? true) s = s.trim();
  if (rule?.lowercase) s = s.toLowerCase();
  return s;
}

/**
 * Evaluasi jawaban terhadap rubric server-side. Murni & deterministik —
 * tidak ada side effect. Tidak pernah membocorkan expected ke pemanggil.
 */
export function evaluate(answerKey: CheckpointAnswer, submitted: unknown): EvalResult {
  switch (answerKey.type) {
    case "structured": {
      const expected = answerKey.expected as Record<string, string>;
      if (typeof submitted !== "object" || submitted === null || Array.isArray(submitted)) {
        return { correct: false };
      }
      const given = submitted as Record<string, unknown>;
      const keys = Object.keys(expected);
      for (const k of keys) {
        if (normStr(given[k], answerKey.normalize) !== normStr(expected[k], answerKey.normalize)) {
          return { correct: false };
        }
      }
      return { correct: true };
    }

    case "exact_match": {
      const expected = answerKey.expected as string;
      const given =
        typeof submitted === "object" && submitted !== null && !Array.isArray(submitted)
          ? (submitted as Record<string, unknown>).url
          : submitted;
      return { correct: normStr(given, answerKey.normalize) === normStr(expected, answerKey.normalize) };
    }

    case "single_select": {
      const expected = answerKey.expected as string;
      const given =
        typeof submitted === "object" && submitted !== null && !Array.isArray(submitted)
          ? (submitted as Record<string, unknown>).option
          : submitted;
      return { correct: String(given) === expected };
    }

    case "multi_select": {
      const expected = answerKey.expected as string[];
      if (!Array.isArray(submitted)) return { correct: false };
      const given = submitted.map((x) => String(x));
      // exact_set: himpunan harus persis sama (tanpa duplikat yang mengubah makna).
      const expectedSet = new Set(expected);
      const givenSet = new Set(given);
      if (givenSet.size !== expectedSet.size) return { correct: false };
      for (const v of givenSet) if (!expectedSet.has(v)) return { correct: false };
      return { correct: true };
    }

    default:
      return { correct: false };
  }
}

/** Poin yang bisa diperoleh setelah penalti hint; minimum 0. */
export function awardablePoints(basePoints: number, hintLevel: number, penaltyPerLevel: number): number {
  return Math.max(0, basePoints - hintLevel * penaltyPerLevel);
}
