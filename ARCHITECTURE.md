# Architecture — Operation: Phishing Trail

**Platform:** Hack RedLimit (`hack.redlimit.id`)
**Komponen:** Phishing Trail Web/API (Node.js + TypeScript + Express)
**Dokumen terkait:** `PRD_Operation_Phishing_Trail.md`, `BLUEPRINT_Operation_Phishing_Trail.md`, `CHALLENGE_AUTHORING_GUIDE.md`, `DEPLOYMENT_RUNBOOK.md`

Dokumen ini menjelaskan arsitektur **sebagaimana diimplementasikan** di repo:
komponen, alur request, peta modul, data model, boundary keamanan, dan titik
integrasi ke platform induk. Nama file menunjuk ke kode nyata di `app/`.

---

## 1. Prinsip arsitektur

1. **Server adalah sumber kebenaran** — flag, rubric, scoring, hint unlock, dan
   completion dihitung & divalidasi di backend. Client tidak dipercaya.
2. **Artefak inert** — email/bukti disajikan sebagai `text/plain` + `nosniff`;
   tidak ada HTML aktif/script/eksekusi.
3. **Integrasi longgar via adapter** — core challenge tidak terikat pada
   mekanisme auth atau storage tertentu (`IdentityProvider`, `ProgressRepository`).
4. **Fail-fast config** — konfigurasi tidak aman (mis. mock auth di production)
   menyebabkan aplikasi menolak start.
5. **Minimasi hak akses** — container non-root, read-only, tanpa Docker socket;
   port publik hanya via reverse proxy.
6. **Stateless core, state terisolasi** — logika murni (scoring) terpisah dari
   state sesi (repository), sehingga mudah diuji dan diganti backend-nya.

---

## 2. Gambaran komponen (C4 level-2)

```
                         Peserta (browser)
                               |
                               | HTTPS
                               v
                   +-----------------------------+
                   | Nginx reverse proxy         |
                   | TLS, security headers,      |
                   | routing, rate-limit (edge)  |
                   +-----------------------------+
                               | HTTP (loopback 127.0.0.1:18080)
                               v
   +-------------------------------------------------------------+
   | Phishing Trail Web/API  (Express, app/src)                  |
   |                                                             |
   |  app.ts  ── security headers, JSON limit, /healthz,         |
   |            static frontend (public/), mount /api/v1         |
   |                 |                                           |
   |                 v                                           |
   |  http/routes.ts ── auth guard, validasi (zod), rate limit,  |
   |                     audit, error mapping                    |
   |         |              |                |                   |
   |         v              v                v                   |
   |  auth/identity   sessions/          challenges/             |
   |  IdentityProvider SessionService     ChallengeRepository    |
   |                     |   \                |   \               |
   |                     v    \               v    v              |
   |             scoring/      sessions/   manifest  private/     |
   |             scoringService sessionStore (public) answers     |
   |             (pure)         ProgressRepository                |
   +-------------------------------------------------------------+
            |                         |                  |
            v                         v                  v
   observability/logger   in-memory Map (MVP)   challenge/ fixtures
   (JSON + redaction)      (→ DB/API platform)   (mount read-only)

   Platform Hack RedLimit  ← (adapter) identity + progress callback
```

Boundary:
- **Nginx** — TLS, routing, header, satu-satunya entry publik.
- **Web/API** — seluruh logika challenge; membaca fixtures read-only.
- **Fixtures** — artefak + manifest publik + `private/answers.yaml` (rahasia).
- **Progress store** — in-memory pada MVP; adapter untuk DB atau API platform.

---

## 3. Peta modul (`app/src`)

| Modul | Tanggung jawab | Catatan |
|-------|----------------|---------|
| `main.ts` | Entry: `assertSafeForPublic()`, start server, graceful shutdown (SIGTERM/SIGINT) | — |
| `config.ts` | Baca & validasi env; guard `production + mock` | Fail-fast |
| `app.ts` | Factory Express: security headers, `express.json` limit, `/healthz`, mount `/api/v1`, static `public/` | Composition root (DI manual) |
| `http/routes.ts` | Router `/api/v1`, auth middleware, validasi zod, rate limit, audit, mapping error→HTTP | Tidak ada business logic |
| `http/rateLimit.ts` | `RateLimiter` fixed-window in-memory | Per `user:session` |
| `auth/identity.ts` | `IdentityProvider` + `MockIdentityProvider` (dev) + `PlatformIdentityProvider` (stub) | Adapter identitas |
| `challenges/challengeRepository.ts` | Muat & validasi manifest + answers (zod), cross-check, baca artefak via **allowlist** | Sumber rubric & flag |
| `sessions/sessionService.ts` | Business logic: create/get(owned)/submit/hint/reset/walkthrough, state machine, completion | Tidak tahu Express |
| `sessions/sessionStore.ts` | `ProgressRepository` + `InMemoryProgressRepository` | Adapter storage |
| `scoring/scoringService.ts` | `evaluate()` (murni) per tipe + `awardablePoints()` | Tanpa side-effect |
| `observability/logger.ts` | JSON structured log + redaction + `audit()` | — |
| `types.ts` | Tipe domain bersama | — |
| `healthcheck.ts` | Executable untuk Docker HEALTHCHECK | GET `/healthz` → exit 0/1 |

Frontend: `app/public/{index.html, styles.css, app.js}` — vanilla, tanpa
dependency, render objektif generik dari manifest, artefak via `textContent`
(anti-XSS). Tidak memuat jawaban/flag.

### 3.1 Arah ketergantungan (dependency rule)

```
routes.ts ─▶ sessionService ─▶ scoringService (pure)
   │              │
   │              └▶ ProgressRepository (interface)
   ├─▶ challengeRepository
   └─▶ IdentityProvider (interface)
```

Business logic (`sessionService`, `scoringService`) **tidak** mengimpor Express
maupun implementasi konkret storage/identity → mudah di-unit-test dan diganti
adapternya. Wiring konkret hanya di `app.ts`.

---

## 4. Alur request (sequence)

### 4.1 Mulai sesi
```
Browser          routes.ts        IdentityProvider   SessionService    ProgressRepo
  |  POST /sessions  |                   |                 |                |
  |----------------->|  authenticate()   |                 |                |
  |                  |------------------>| user / null     |                |
  |                  |<------------------|                 |                |
  |                  |  create(userId)   |                 |                |
  |                  |---------------------------------->  | create()       |
  |                  |                   |                 |--------------->|
  |                  |  audit session_started             |                |
  |  201 session json (tanpa jawaban)    |                 |                |
  |<-----------------|                                                       |
```

### 4.2 Submit checkpoint (inti evidence-based scoring)
```
Browser           routes.ts            SessionService         scoringService
  | POST /sessions/:id/submissions         |                        |
  |--------------->| rateLimiter.take()     |                        |
  |                | zod validate body      |                        |
  |                | submit(id,user,cp,ans) |                        |
  |                |----------------------->| getOwned() ownership   |
  |                |                        | cek status ACTIVE      |
  |                |                        | evaluate(answerKey,ans)|
  |                |                        |----------------------->| correct?
  |                |                        |<-----------------------|
  |                |                        | award = max(0,...)     |
  |                |                        | update score, idempotency
  |                |                        | completed? → COMPLETED |
  |                | audit correct/incorrect|                        |
  | 200 {correct, points_awarded, score, completed}  (TANPA expected/flag)
  |<---------------|                                                 |
```

Poin kunci:
- **Ownership check** (`getOwned`) di setiap endpoint sesi → anti-IDOR.
- **Idempotency** via `idempotency_key` + flag `correct` per checkpoint → submit
  berulang tidak menggandakan skor.
- Response **tidak pernah** memuat `expected`/flag, baik saat benar maupun salah.

### 4.3 Ambil artefak (anti path-traversal)
```
routes.ts → sessionService.getOwned() (ownership + status)
          → challengeRepository.readArtifact(artifactId)
                - lookup artifactId di manifest (ALLOWLIST), bukan path user
                - resolve path, pastikan tetap di dalam folder challenge
                - baca file, kirim text/plain + nosniff + Content-Disposition inline
```

---

## 5. Data model & state

Tipe di `types.ts`. Pada MVP disimpan in-memory; skema setara bila dipindah ke DB
(lihat PRD §13 / Blueprint §7).

### 5.1 Entitas

**LabSession**
`id` (UUID acak) · `platformUserId` · `challengeId` · `challengeVersion` ·
`status` · `score` · `startedAt` · `completedAt?` · `expiresAt` · `resetCount` ·
`checkpoints: Record<id, CheckpointState>` · `seenIdempotencyKeys: Set`

**CheckpointState**
`correct` · `pointsAwarded` · `attempts` · `hintLevel`

**PublicManifest / AnswerKey** — konten challenge (lihat `CHALLENGE_AUTHORING_GUIDE.md`).

> Audit event tidak disimpan sebagai entitas pada MVP; dipancarkan sebagai log
> JSON terstruktur (`observability/logger.ts`) untuk dikumpulkan di luar proses.

### 5.2 State machine sesi (`status`)

```
      create()                 semua checkpoint correct
NOT ──────────▶ ACTIVE ───────────────────────────────▶ COMPLETED
                 │  │
          reset()│  │ expiresAt < now (lazy, saat diakses)
                 ▼  ▼
               RESET  EXPIRED
```

Aturan yang ditegakkan `sessionService`:
- Hanya `ACTIVE` menerima submission/hint.
- `COMPLETED` tidak menambah skor; walkthrough terbuka.
- `reset()` menandai sesi lama `RESET` dan membuat sesi **baru** (`resetCount+1`)
  untuk user yang sama — **tidak** menyentuh progres challenge/sesi lain.
- Expiry dievaluasi lazy saat `getOwned()` (tanpa scheduler).

---

## 6. Scoring (deterministik & murni)

`scoring/scoringService.ts`:
- `evaluate(answerKey, submitted)` → `{ correct }`, tanpa side-effect, tidak
  membocorkan `expected`.
  - `structured`: semua field `expected` cocok (normalisasi trim/lowercase).
  - `exact_match`: string tunggal (terima `{url}` atau string) + normalisasi.
  - `single_select`: id opsi (terima `{option}` atau string), case-sensitive.
  - `multi_select`: **exact set** (himpunan harus persis sama).
- `awardablePoints(points, hintLevel, penaltyPerLevel)` = `max(0, points − level×penalty)`.

Scoring murni → unit test tanpa HTTP/DB (`tests/scoring.test.ts`).

---

## 7. Boundary & kontrol keamanan

| Lapisan | Kontrol | Lokasi |
|---------|---------|--------|
| Edge | TLS, security headers, routing, (opsional) `limit_req` | `deploy/nginx/phishing-trail.conf` |
| App global | CSP, `nosniff`, `X-Frame-Options: DENY`, Referrer-Policy, body size limit, `x-powered-by` off | `app.ts` |
| AuthZ | Ownership check per request (anti-IDOR); ID sesi bukan satu-satunya kontrol | `sessionService.getOwned` |
| Input | Validasi schema zod, batas panjang field, checkpoint allowlist | `routes.ts` |
| Artefak | Allowlist `artifactId` + guard path di dalam folder | `challengeRepository.readArtifact` |
| Abuse | Rate limiting submit/hint per `user:session` | `rateLimit.ts` + `routes.ts` |
| Secret | Rubric & flag server-side; tidak pernah di response/bundle | `private/answers.yaml`, response hanya `{correct, points, score, completed}` |
| Rendering | Artefak `text/plain`; frontend pakai `textContent` | `routes.ts`, `app.js` |
| Log | Redaction (cookie/authorization/token/flag/answer) | `logger.ts` |
| Runtime | non-root, read-only FS, `cap_drop: ALL`, `no-new-privileges`, tmpfs, mem/pids limit, loopback-only publish | `compose.yaml`, `Dockerfile` |
| Config | Guard `production + AUTH_MODE=mock` → refuse start | `config.assertSafeForPublic` |

Threat model ringkas (Blueprint §10.1): XSS→plain-text+CSP; IDOR→ownership;
path traversal→allowlist; manipulasi skor→backend authoritative; brute-force→rate
limit+audit; kebocoran flag→server-side only; SSRF→tidak ada fetch URL artefak.

---

## 8. Integrasi platform induk (adapter)

Dua titik sambung utama (Blueprint §4.1), keduanya interface:

### 8.1 `IdentityProvider` (`auth/identity.ts`)
```
authenticate(req) -> AuthenticatedUser | null
```
- **MockIdentityProvider** (dev): ambil user dari header `X-Lab-User`/cookie
  `lab_user`. Ditolak di production oleh guard.
- **PlatformIdentityProvider** (stub → implementasi): verifikasi token/sesi
  platform (issuer, audience, expiry, signature) — PRD §12 Metode A/B.

### 8.2 `ProgressRepository` (`sessions/sessionStore.ts`)
```
create(session) / get(id) / save(session) / delete(id)
```
- **InMemoryProgressRepository** (MVP): `Map` — hilang saat restart.
- Implementasi DB (PostgreSQL) **atau** klien API progres platform menggantikan
  ini tanpa mengubah `sessionService`.

### 8.3 Completion callback (belum diimplementasikan — titik ekstensi)
Setelah sesi `COMPLETED`, kirim hasil ke platform induk via klien terautentikasi
(idempotent + retry terbatas). Payload kontrak (PRD §12):
```json
{ "user_id": "...", "challenge_id": "operation-phishing-trail",
  "session_id": "...", "status": "completed", "score": 800,
  "completed_at": "ISO-8601" }
```
Rencana: tambahkan `PlatformProgressClient` dipanggil dari `sessionService` saat
transisi ke `COMPLETED`; simpan status sinkronisasi agar gagal→retry tanpa
menghilangkan completion lokal. Event `platform_sync_failed` sudah tersedia di logger.

Mengaktifkan integrasi: `AUTH_MODE=platform` + implementasi adapter; wiring
diganti di `app.ts` (composition root), bukan di business logic.

---

## 9. API surface (`/api/v1`)

| Method | Endpoint | Auth | Handler |
|--------|----------|------|---------|
| GET | `/healthz` | internal | `app.ts` |
| GET | `/api/v1/challenges/operation-phishing-trail` | user | kirim manifest publik |
| POST | `/api/v1/sessions` | user | `SessionService.create` |
| GET | `/api/v1/sessions/:id` | pemilik | `getOwned` |
| GET | `/api/v1/sessions/:id/artifacts/:artifactId` | pemilik | allowlist read |
| POST | `/api/v1/sessions/:id/submissions` | pemilik | `submit` |
| POST | `/api/v1/sessions/:id/hints` | pemilik | `revealHint` |
| POST | `/api/v1/sessions/:id/reset` | pemilik | `reset` |
| GET | `/api/v1/sessions/:id/walkthrough` | pemilik, setelah `COMPLETED` | `walkthrough` |

Error mapping (`routes.ts`): `NotFoundError`→404, `ForbiddenError`→403,
`ConflictError`→409, `ValidationError`→400, lainnya→500 (tanpa detail internal).

---

## 10. Observability

- **Log**: JSON terstruktur ke stdout/stderr dengan redaction. `audit()`
  menandai event bisnis: `session_started`, `artifact_viewed`,
  `submission_received/correct/incorrect`, `hint_revealed`, `session_reset`,
  `challenge_completed`, `platform_sync_failed`, `integration_error`.
- **Correlation**: `session_id` disertakan pada event (ID acak, bukan PII).
- **Health**: `/healthz` ringkas (status + challenge id/version), tanpa rahasia;
  dipakai Docker HEALTHCHECK & reverse proxy.
- **Metrik** (dari log/health, lihat Blueprint §13.2): sesi aktif, completion rate,
  waktu penyelesaian, hint/sesi, submission error rate, API latency, health fails.

---

## 11. Deployment & topologi

Detail operasional di `DEPLOYMENT_RUNBOOK.md`. Ringkas:
- **Dev**: `make dev` (langsung) atau `make up` (Docker, mock auth).
- **Prod**: image imutable dari CI + `deploy/compose/compose.prod.yaml`
  (`APP_ENV=production`, `AUTH_MODE=platform`, image registry, build dihapus).
- **Jaringan**: aplikasi publish hanya `127.0.0.1:18080`; Nginx satu-satunya entry
  publik (Topologi A di Blueprint §11.1). Topologi B (Nginx dalam Docker) & C
  (reverse proxy pihak ketiga) didukung dengan menyesuaikan upstream/port.
- **Build**: multi-stage Dockerfile (build→prune dev deps→runtime non-root).

---

## 12. Keputusan teknis & trade-off

| Keputusan | Alasan | Trade-off / jalur evolusi |
|-----------|--------|---------------------------|
| Node.js + TypeScript + Express | Baseline Blueprint §4; ekosistem umum | — |
| Storage in-memory (MVP) | Hilangkan dependensi DB; cepat & reproducible | Progres hilang saat restart → ganti `ProgressRepository` ke DB/API platform |
| Frontend vanilla tanpa framework | Zero secret di client, bundle minimal, mudah di-audit | Kurang ergonomis untuk UI kompleks → bisa diganti SPA bila perlu |
| Rubric di file terpisah `private/` | Pisahkan konten publik vs rahasia | Perlu disiplin secret handling di repo publik (lihat runbook §6.3) |
| Adapter identity & progress | Integrasi longgar, mudah mock & uji | Butuh implementasi konkret sebelum go-live |
| Validasi fail-fast saat startup | Deteksi dini manifest/answers rusak | Challenge rusak = app tidak start (sengaja) |
| Rate limiter in-memory | Cukup untuk MVP single-instance | Multi-instance perlu store bersama (mis. Redis) |

---

## 13. Batasan saat ini (known limitations)

- Satu challenge aktif per instance (dipilih via `CHALLENGE_ID`).
- State & rate limit in-memory → tidak lintas-instance; progres non-persisten.
- Completion callback ke platform belum diimplementasikan (titik ekstensi §8.3).
- `PlatformIdentityProvider` masih stub.

Semua batasan di atas by-design untuk MVP dan memiliki jalur evolusi lewat
adapter tanpa mengubah business logic.
