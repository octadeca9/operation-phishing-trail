import { describe, it, expect } from "vitest";
import { evaluate, awardablePoints } from "../src/scoring/scoringService.js";
import type { CheckpointAnswer } from "../src/types.js";

describe("scoring.evaluate", () => {
  it("structured: cocok dengan normalisasi case/trim", () => {
    const key: CheckpointAnswer = {
      type: "structured",
      expected: { sender_address: "payroll@nusantara-dynamics-hr.example", sender_domain: "nusantara-dynamics-hr.example" },
      normalize: { lowercase: true, trim: true },
      hints: ["x"],
    };
    expect(evaluate(key, { sender_address: "  Payroll@Nusantara-Dynamics-HR.example ", sender_domain: "NUSANTARA-DYNAMICS-HR.EXAMPLE" }).correct).toBe(true);
    expect(evaluate(key, { sender_address: "wrong@x.example", sender_domain: "x.example" }).correct).toBe(false);
    expect(evaluate(key, { sender_address: "payroll@nusantara-dynamics-hr.example" }).correct).toBe(false);
  });

  it("exact_match: menerima string atau {url}, normalisasi lowercase/trim", () => {
    const key: CheckpointAnswer = {
      type: "exact_match",
      expected: "hxxps://account-verify[.]nusantara-dynamics-hr[.]example-payroll[.]review/secure/login?ref=PR-8842",
      normalize: { lowercase: true, trim: true },
      hints: ["x"],
    };
    expect(evaluate(key, { url: "  HXXPS://account-verify[.]nusantara-dynamics-hr[.]example-payroll[.]review/secure/login?ref=PR-8842 " }).correct).toBe(true);
    expect(evaluate(key, "hxxps://wrong[.]example/login").correct).toBe(false);
  });

  it("multi_select exact_set: himpunan harus persis", () => {
    const key: CheckpointAnswer = {
      type: "multi_select",
      policy: "exact_set",
      expected: ["a", "b", "c"],
      hints: ["x"],
    };
    expect(evaluate(key, ["c", "a", "b"]).correct).toBe(true);
    expect(evaluate(key, ["a", "b"]).correct).toBe(false); // kurang
    expect(evaluate(key, ["a", "b", "c", "d"]).correct).toBe(false); // ada salah
    expect(evaluate(key, "notarray").correct).toBe(false);
  });

  it("single_select: menerima string atau {option}", () => {
    const key: CheckpointAnswer = { type: "single_select", expected: "mismatch_executable", hints: ["x"] };
    expect(evaluate(key, { option: "mismatch_executable" }).correct).toBe(true);
    expect(evaluate(key, "match").correct).toBe(false);
  });

  it("awardablePoints: penalti hint tidak negatif", () => {
    expect(awardablePoints(200, 0, 25)).toBe(200);
    expect(awardablePoints(200, 2, 25)).toBe(150);
    expect(awardablePoints(50, 3, 25)).toBe(0);
  });
});
