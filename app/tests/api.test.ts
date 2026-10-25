import { describe, it, expect, beforeAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import type { Express } from "express";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Set env SEBELUM import app (config dibaca saat import).
process.env.CHALLENGE_DIR = path.resolve(__dirname, "../../challenge");
process.env.APP_ENV = "development";
process.env.AUTH_MODE = "mock";

let app: Express;

// Jawaban benar (hanya untuk test end-to-end; bukan dari client biasa).
const CORRECT = {
  C1: { sender_address: "payroll@nusantara-dynamics-hr.example", sender_domain: "nusantara-dynamics-hr.example" },
  C2: { url: "hxxps://account-verify[.]nusantara-dynamics-hr[.]example-payroll[.]review/secure/login?ref=PR-8842" },
  C3: ["display_name_mismatch", "sender_domain_mismatch", "reply_to_mismatch", "url_lookalike_domain", "auth_spf_dmarc_fail", "urgency_pressure"],
  C4: { option: "mismatch_executable" },
  C5: { option: "phishing_escalate" },
};

beforeAll(async () => {
  const mod = await import("../src/app.js");
  app = mod.createApp();
});

function as(user: string) {
  return { "X-Lab-User": user };
}

async function newSession(user: string) {
  const res = await request(app).post("/api/v1/sessions").set(as(user)).send({ challenge_id: "operation-phishing-trail" });
  expect(res.status).toBe(201);
  return res.body.session_id as string;
}

describe("health & challenge", () => {
  it("healthz ok tanpa secret", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(JSON.stringify(res.body)).not.toContain("RL{");
  });

  it("challenge detail tidak memuat jawaban/flag", async () => {
    const res = await request(app).get("/api/v1/challenges/operation-phishing-trail").set(as("u1"));
    expect(res.status).toBe(200);
    const text = JSON.stringify(res.body);
    // Manifest publik boleh memuat id opsi (untuk render), TIDAK boleh memuat
    // rubric jawaban atau flag final.
    expect(text).not.toContain("expected");
    expect(text).not.toContain("RL{");
    expect(text).not.toContain("hints\":[\""); // teks hint tidak ikut terkirim
  });

  it("menolak tanpa identitas (user id invalid)", async () => {
    const res = await request(app).post("/api/v1/sessions").set("X-Lab-User", "bad user!!").send({ challenge_id: "operation-phishing-trail" });
    expect(res.status).toBe(401);
  });
});

describe("end-to-end completion", () => {
  it("menyelesaikan seluruh checkpoint dan membuka walkthrough", async () => {
    const sid = await newSession("alice");

    // Walkthrough terkunci sebelum selesai.
    const locked = await request(app).get(`/api/v1/sessions/${sid}/walkthrough`).set(as("alice"));
    expect(locked.status).toBe(403);

    let lastScore = 0;
    for (const cp of ["C1", "C2", "C3", "C4", "C5"] as const) {
      const res = await request(app)
        .post(`/api/v1/sessions/${sid}/submissions`)
        .set(as("alice"))
        .send({ checkpoint_id: cp, answer: CORRECT[cp], idempotency_key: "k-" + cp });
      expect(res.status).toBe(200);
      expect(res.body.correct).toBe(true);
      expect(res.body.score).toBeGreaterThanOrEqual(lastScore);
      lastScore = res.body.score;
      // Response tidak membocorkan expected/flag.
      expect(JSON.stringify(res.body)).not.toContain("RL{");
    }
    expect(lastScore).toBe(800);

    const status = await request(app).get(`/api/v1/sessions/${sid}`).set(as("alice"));
    expect(status.body.status).toBe("completed");

    const wt = await request(app).get(`/api/v1/sessions/${sid}/walkthrough`).set(as("alice"));
    expect(wt.status).toBe(200);
    expect(wt.text).toContain("Walkthrough");
  });

  it("jawaban salah tidak membocorkan solusi & tidak menambah skor", async () => {
    const sid = await newSession("bob");
    const res = await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("bob")).send({ checkpoint_id: "C2", answer: { url: "hxxps://salah" } });
    expect(res.status).toBe(200);
    expect(res.body.correct).toBe(false);
    expect(res.body.score).toBe(0);
    expect(JSON.stringify(res.body)).not.toContain("account-verify");
  });

  it("idempotency: key sama tidak double-score", async () => {
    const sid = await newSession("carol");
    const p = { checkpoint_id: "C1", answer: CORRECT.C1, idempotency_key: "dup-1" };
    const r1 = await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("carol")).send(p);
    const r2 = await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("carol")).send(p);
    expect(r1.body.score).toBe(100);
    expect(r2.body.score).toBe(100);
  });

  it("hint mengurangi poin checkpoint", async () => {
    const sid = await newSession("dave");
    await request(app).post(`/api/v1/sessions/${sid}/hints`).set(as("dave")).send({ checkpoint_id: "C1" });
    await request(app).post(`/api/v1/sessions/${sid}/hints`).set(as("dave")).send({ checkpoint_id: "C1" });
    const res = await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("dave")).send({ checkpoint_id: "C1", answer: CORRECT.C1 });
    expect(res.body.points_awarded).toBe(50); // 100 - 2*25
  });
});

describe("security", () => {
  it("IDOR: user lain tidak bisa membaca sesi", async () => {
    const sid = await newSession("alice");
    const res = await request(app).get(`/api/v1/sessions/${sid}`).set(as("mallory"));
    expect(res.status).toBe(403);
  });

  it("IDOR: user lain tidak bisa submit ke sesi", async () => {
    const sid = await newSession("alice");
    const res = await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("mallory")).send({ checkpoint_id: "C1", answer: CORRECT.C1 });
    expect(res.status).toBe(403);
  });

  it("path traversal pada artifactId ditolak", async () => {
    const sid = await newSession("alice");
    const res = await request(app).get(`/api/v1/sessions/${sid}/artifacts/${encodeURIComponent("../private/answers")}`).set(as("alice"));
    expect([404, 400]).toContain(res.status);
    expect(res.text).not.toContain("RL{");
  });

  it("artefak hanya dari allowlist", async () => {
    const sid = await newSession("alice");
    const ok = await request(app).get(`/api/v1/sessions/${sid}/artifacts/message`).set(as("alice"));
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toContain("text/plain");
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    const bad = await request(app).get(`/api/v1/sessions/${sid}/artifacts/does-not-exist`).set(as("alice"));
    expect(bad.status).toBe(404);
  });

  it("reset membuat sesi baru & menandai lama sebagai reset", async () => {
    const sid = await newSession("erin");
    await request(app).post(`/api/v1/sessions/${sid}/submissions`).set(as("erin")).send({ checkpoint_id: "C1", answer: CORRECT.C1 });
    const res = await request(app).post(`/api/v1/sessions/${sid}/reset`).set(as("erin")).send({});
    expect(res.status).toBe(201);
    expect(res.body.session_id).not.toBe(sid);
    expect(res.body.score).toBe(0);
    expect(res.body.reset_count).toBe(1);
    const old = await request(app).get(`/api/v1/sessions/${sid}`).set(as("erin"));
    expect(old.body.status).toBe("reset");
  });

  it("security headers terpasang", async () => {
    const res = await request(app).get("/healthz");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });
});
