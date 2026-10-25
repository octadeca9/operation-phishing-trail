# Deployment Runbook — Operation: Phishing Trail

**Platform:** Hack RedLimit (`hack.redlimit.id`)
**Komponen:** Phishing Trail Web/API (Node.js + TypeScript)
**Target:** Linux + Docker Compose + Nginx
**Dokumen terkait:** `PRD_Operation_Phishing_Trail.md`, `BLUEPRINT_Operation_Phishing_Trail.md`, `README.md`

Runbook ini adalah prosedur operasional: deploy, verifikasi, rollback, backup,
dan troubleshooting. Perintah mengacu pada isi repo nyata (`compose.yaml`,
`deploy/nginx/phishing-trail.conf`, `app/`).

> ⚠️ **Prinsip keselamatan operasi**
> - `AUTH_MODE=mock` **dilarang** di deployment publik. Aplikasi menolak start
>   bila `APP_ENV=production` + `AUTH_MODE=mock` (lihat `app/src/config.ts`).
> - Port aplikasi hanya dipublish ke loopback (`127.0.0.1:18080`); reverse proxy
>   adalah satu-satunya entry point publik.
> - `challenge/operation-phishing-trail/private/answers.yaml` berisi rubric &
>   flag → perlakukan sebagai secret (lihat §7).

---

## 0. Ringkasan cepat (TL;DR)

| Aksi | Perintah |
|------|----------|
| Validasi config | `docker compose config --quiet` |
| Build + start | `make up` (atau `docker compose up -d --build`) |
| Cek sehat | `make smoke` → `curl 127.0.0.1:18080/healthz` |
| Lihat log | `make logs` |
| Stop | `make down` |
| Rollback | `IMAGE_TAG=<tag-lama> docker compose -f compose.yaml -f deploy/compose/compose.prod.yaml up -d` (lihat §5) |

---

## 1. Prasyarat lingkungan

### 1.1 Host
- Linux x86_64, Docker Engine ≥ 24 + Docker Compose v2 (`docker compose version`).
- Akses ke registry image yang disetujui (lihat §3.2).
- Nginx (host atau container) + sertifikat TLS untuk host yang dipilih.
- Jam sistem tersinkron (NTP) — penting untuk timestamp audit & expiry sesi.

### 1.2 Jaringan & DNS
- Subdomain `phishing-trail.hack.redlimit.id` (rekomendasi MVP) **atau** path
  `/labs/phishing-trail/` di domain utama. Pastikan record DNS sudah resolve
  sebelum menerbitkan sertifikat.
- Firewall: hanya 80/443 ke publik. Port aplikasi (18080) **tidak** boleh
  terekspos ke interface publik.

### 1.3 Checklist pra-deploy
- [ ] `docker compose config --quiet` lolos.
- [ ] Image dibangun oleh CI dari commit yang di-review (bukan build lokal ad-hoc untuk production).
- [ ] `.env` produksi berisi `APP_ENV=production` dan `AUTH_MODE=platform`.
- [ ] Secret (jika ada) ada di secret manager / env deployment, bukan di Git.
- [ ] Integrasi auth platform induk sudah teruji di staging.
- [ ] TLS & security headers terverifikasi.
- [ ] Prosedur rollback (§5) & backup (§6) dipahami oleh operator on-call.

---

## 2. Konfigurasi (environment variables)

Sumber: `.env.example`. Salin ke `.env` dan sesuaikan.

| Var | Dev | Production | Catatan |
|-----|-----|------------|---------|
| `APP_ENV` | `development` | `production` | Mengaktifkan guard mock-auth |
| `AUTH_MODE` | `mock` | `platform` | `mock` ditolak saat production |
| `PORT` | `8080` | `8080` | Port internal container |
| `CHALLENGE_DIR` | `./challenge` | `/opt/challenge` | Mount read-only |
| `CHALLENGE_ID` | `operation-phishing-trail` | sama | — |
| `LOG_LEVEL` | `info` | `info` / `warn` | JSON structured |
| `SESSION_TTL_SECONDS` | `7200` | sesuai kebijakan | Masa berlaku sesi |
| `RATE_LIMIT_MAX` | `30` | sesuaikan beban | Per sesi per window |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | — | — |

Integrasi platform (isi hanya jika dibutuhkan, simpan sebagai secret):
`PLATFORM_BASE_URL`, `PLATFORM_ISSUER`, `PLATFORM_AUDIENCE`,
`PLATFORM_CLIENT_ID`, `PLATFORM_CLIENT_SECRET`, `DATABASE_URL`.

> **Catatan state:** MVP memakai `InMemoryProgressRepository` — progres sesi
> **hilang saat container restart**. Untuk produksi yang butuh persistensi,
> implementasikan `ProgressRepository` berbasis DB atau pakai API progres
> platform induk (lihat §6 dan Blueprint §4.1).

---

## 3. Build & image

### 3.1 Build via CI (jalur produksi)
Image dibangun **sekali** oleh GitHub Actions (`.github/workflows/ci.yml`) setelah
lint + test + fixture-check + health smoke lolos, lalu di-tag dan dipush ke
registry. **Promosikan image yang sama** dari staging ke production — jangan
build ulang dari source yang berubah (Blueprint §12.2).

### 3.2 Tagging & registry
- Tag imutable per rilis, mis. `registry.example/operation-phishing-trail:1.0.0`
  atau `:<git-sha>`. Hindari `latest` untuk production.
- Simpan minimal 1–2 tag sebelumnya untuk rollback cepat.
- Scan image (dependency/vuln) sebelum promote.

### 3.3 Build lokal (dev/staging kecil)
```bash
make docker-build              # docker compose build phishing-trail
# image: operation-phishing-trail:local
```

### 3.4 Mengarahkan Compose ke image registry
`compose.yaml` memakai `image: operation-phishing-trail:local` + `build:`.
Untuk production, deploy dengan image hasil CI. Opsi:
- Override via file compose tambahan, mis. `deploy/compose/compose.prod.yaml`
  yang menetapkan `image: registry.example/operation-phishing-trail:<tag>` dan
  menghapus blok `build`, lalu:
  ```bash
  docker compose -f compose.yaml -f deploy/compose/compose.prod.yaml up -d
  ```
- Atau `docker pull` tag target lalu re-tag ke nama yang dirujuk compose.

---

## 4. Prosedur deployment

### 4.1 Local development
```bash
make install
make dev                       # http://localhost:8080 (AUTH_MODE=mock)
```
Atau via Docker:
```bash
cp .env.example .env
make compose-config
make up
make smoke
```

### 4.2 Staging
1. Deploy image dari build CI yang lolos (tag spesifik).
2. Set `.env`: `APP_ENV=production`, `AUTH_MODE=platform` (atau mock identity
   yang **tidak** dapat diakses publik jika kontrak platform belum siap).
3. Konfigurasikan DNS/subdomain atau path di reverse proxy.
4. Aktifkan TLS.
5. `docker compose up -d` lalu jalankan verifikasi §4.4 + acceptance/security test.
6. Uji reset, scoring, logging, dan rollback.

### 4.3 Production
1. Promote **image yang sama** yang sudah lolos staging.
2. Pastikan `.env`: `APP_ENV=production`, `AUTH_MODE=platform`, tidak ada debug/secret default.
3. `docker compose -f compose.yaml -f deploy/compose/compose.prod.yaml up -d`
   (atau mekanisme deploy organisasi).
4. Batasi port publik hanya pada reverse proxy (80/443).
5. Aktifkan monitoring + alerting (§8).
6. Rilis bertahap (canary / kelompok peserta terbatas) sebelum rilis umum.

### 4.4 Verifikasi pasca-deploy (smoke test)
```bash
# 1) Health (dari host, via loopback)
curl -fsS http://127.0.0.1:18080/healthz
# → {"status":"ok","challenge":"operation-phishing-trail","version":1}

# 2) Container sehat
docker compose ps            # STATUS = healthy
docker inspect --format '{{.State.Health.Status}}' $(docker compose ps -q phishing-trail)

# 3) Via reverse proxy (publik)
curl -fsS https://phishing-trail.hack.redlimit.id/healthz

# 4) Security headers terpasang
curl -sI https://phishing-trail.hack.redlimit.id/ | grep -iE 'content-security-policy|x-content-type-options|x-frame-options'

# 5) Rubric/flag TIDAK bocor di manifest publik
curl -s https://phishing-trail.hack.redlimit.id/api/v1/challenges/operation-phishing-trail \
  -H 'Authorization: <token-platform>' | grep -i 'RL{' && echo "BOCOR!" || echo "OK: tidak ada flag"
```
- [ ] Health 200 via loopback **dan** via proxy.
- [ ] Container `healthy`.
- [ ] CSP / nosniff / X-Frame-Options ada.
- [ ] Auth platform menolak request tanpa kredensial valid (401).
- [ ] Peserta uji dapat menyelesaikan C1–C5 dan membuka walkthrough.

---

## 5. Rollback

**Kapan:** health gagal, error rate melonjak, regресi scoring/konten, atau temuan
keamanan pasca-rilis.

### 5.1 Rollback image (kasus umum)
```bash
# 1) Identifikasi tag sebelumnya yang stabil
docker image ls | grep operation-phishing-trail

# 2) Arahkan compose ke tag lama & redeploy (override prod menetapkan IMAGE/tag)
IMAGE=registry.example/operation-phishing-trail IMAGE_TAG=<tag-lama> \
  docker compose -f compose.yaml -f deploy/compose/compose.prod.yaml up -d

# 3) Verifikasi (§4.4)
curl -fsS http://127.0.0.1:18080/healthz
docker compose ps
```

### 5.2 Prinsip
- Simpan tag image versi sebelumnya; rollback = deploy ulang tag lama (image imutable).
- **Jangan** rollback dengan menghapus data progres tanpa backup & persetujuan.
- Jika ada perubahan schema DB (bila DB dipakai), pastikan kompatibel mundur atau
  sediakan migrasi balik; uji di staging lebih dulu.
- Catat insiden & alasan rollback di tracker.

### 5.3 Rollback cepat (restart ke state bersih)
Karena state MVP in-memory, `docker compose restart phishing-trail` mengembalikan
aplikasi ke kondisi bersih (semua sesi aktif hilang). Gunakan hanya bila
kehilangan sesi aktif dapat diterima.

---

## 6. Backup & data

### 6.1 MVP (in-memory)
- Tidak ada state persisten → **tidak ada backup data progres**. Sesi hilang saat
  restart/redeploy. Komunikasikan ini ke stakeholder; pertimbangkan waktu deploy
  di luar jam sibuk.
- Yang perlu "di-backup" hanyalah **source & fixture** → sudah di Git.

### 6.2 Bila progress-db diaktifkan (opsional, lihat compose `progress-db`)
```bash
# Backup
docker compose exec progress-db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > backup_$(date +%F).sql
# Restore
cat backup_YYYY-MM-DD.sql | docker compose exec -T progress-db psql -U "$POSTGRES_USER" "$POSTGRES_DB"
```
- Jadwalkan backup berkala + uji restore.
- Volume `progress_data` jangan dihapus saat `docker compose down` (hindari `-v`).

### 6.3 Secret & konten rahasia
- `challenge/.../private/answers.yaml`: pada deployment publik, injeksikan via
  secret manager / mount read-only terbatas, **bukan** di image/front-end.
- Rotasi secret integrasi platform bila terindikasi bocor; pisahkan kredensial
  dev/staging/prod.

---

## 7. Keamanan operasional

- [ ] Container non-root (`user: node`), `read_only: true`, `cap_drop: ALL`,
  `no-new-privileges:true`, `tmpfs /tmp` noexec — sudah di `compose.yaml`.
- [ ] Tidak ada mount `docker.sock`.
- [ ] `mem_limit` & `pids_limit` sesuai kapasitas host.
- [ ] Port aplikasi hanya loopback; publik hanya via Nginx.
- [ ] Rate limit aktif (app) + opsional `limit_req` di Nginx.
- [ ] Log tidak memuat cookie/authorization/secret/jawaban (redaction di logger).
- [ ] `answers.yaml` tidak pernah dikembalikan API; cek berkala bundle client bersih dari flag.

---

## 8. Observability & monitoring

### 8.1 Log
JSON structured ke stdout/stderr. Kumpulkan via log driver/agen.
```bash
docker compose logs -f phishing-trail
docker compose logs phishing-trail | grep '"audit":true'
```
Event audit kunci: `session_started`, `artifact_viewed`, `submission_correct/incorrect`,
`hint_revealed`, `session_reset`, `challenge_completed`, `platform_sync_failed`.

### 8.2 Metrik & alert (minimal)
- Health status & restart count container.
- Error rate API (5xx) dan latency.
- `submission_incorrect` rate abnormal (indikasi brute-force) → korelasikan 429.
- `platform_sync_failed` (bila callback progres aktif).

### 8.3 Health
`/healthz` dipakai Docker HEALTHCHECK (`node dist/healthcheck.js`) dan proxy.
Tidak memuat informasi rahasia.

---

## 9. Troubleshooting

| Gejala | Kemungkinan sebab | Tindakan |
|--------|-------------------|----------|
| Container exit saat start, log "AUTH_MODE=mock dilarang saat APP_ENV=production" | Guard keamanan aktif | Set `AUTH_MODE=platform` (atau `APP_ENV=development` untuk dev saja) |
| Start gagal, error parse manifest/answers | `manifest.yaml`/`answers.yaml` invalid atau tidak ter-mount | Cek `CHALLENGE_DIR`, volume `:ro`, jalankan ulang schema validation |
| `/healthz` 200 di loopback tapi gagal via domain | Masalah Nginx/TLS/DNS | Cek `nginx -t`, sertifikat, upstream `127.0.0.1:18080`, resolve DNS |
| 502/504 di proxy | Upstream down / timeout | `docker compose ps`; cek `proxy_read_timeout`; lihat log app |
| Semua request 401 | Auth platform belum tersambung / token invalid | Verifikasi adapter identitas, issuer/audience/expiry |
| 403 saat akses sesi | Ownership check (IDOR guard) — user ≠ pemilik sesi | Perilaku benar; pastikan identitas user konsisten |
| 404 pada artefak | Bukan di allowlist / percobaan traversal | Perilaku benar; gunakan `artifactId` dari manifest |
| 429 saat submit/hint | Rate limit tercapai | Naikkan `RATE_LIMIT_MAX`/window bila sah; jika tidak, indikasi abuse |
| Progres hilang setelah deploy | State in-memory ter-reset saat restart | Ekspektasi MVP; aktifkan DB/API progres bila butuh persistensi |
| Walkthrough 403 | Sesi belum `completed` | Perilaku benar; selesaikan seluruh checkpoint |
| Health `starting` lama | `start_period` / app lambat init | Cek log; sesuaikan `start_period` bila perlu |

### Perintah diagnostik
```bash
docker compose ps
docker compose logs --tail=200 phishing-trail
docker inspect --format '{{json .State.Health}}' $(docker compose ps -q phishing-trail) | jq
docker compose exec phishing-trail node dist/healthcheck.js; echo "exit=$?"
nginx -t && systemctl reload nginx     # bila Nginx di host
```

---

## 10. Maintenance & update

1. Buat perubahan di `feature/<nama>` → PR → CI hijau → review → merge `main`.
2. CI build image imutable → push registry.
3. Deploy ke staging → acceptance/security test (§4.2).
4. Promote image yang sama ke production (§4.3) secara bertahap.
5. Monitor (§8); rollback (§5) bila perlu.

**Update konten challenge** (fixture/manifest non-rahasia): ubah di `challenge/`,
lewati CI fixture-check (tidak ada flag bocor, URL defanged), bump `version` bila
rubric berubah agar sesi lama tidak rusak (Blueprint §9.3). Perubahan rubric/flag
ada di `private/answers.yaml` dan harus konsisten dengan manifest (divalidasi saat startup).

---

## 11. Kontak & eskalasi

- On-call / pemilik layanan: _isi sesuai organisasi_.
- Eskalasi keamanan (temuan kritis/tinggi): _isi kanal SOC/security_.
- Owner integrasi platform Hack RedLimit: _isi PIC_.

> Lengkapi placeholder di atas sebelum go-live.
