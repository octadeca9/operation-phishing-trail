# Operation: Phishing Trail

Lab cybersecurity defensif (blue-team / SOC pemula) untuk platform **Hack RedLimit**.
Peserta menganalisis **artefak email phishing sintetis** — memeriksa header,
mengidentifikasi URL mencurigakan (defanged), membandingkan tipe konten lampiran,
menghubungkan bukti, lalu mengirim jawaban/flag yang dinilai **server-side**.

> Lab ini aman & simulasi: tidak ada email dikirim, tidak ada kredensial riil,
> tidak ada malware/payload aktif, tidak ada tautan ke situs pihak ketiga.
> Semua domain, nama, URL, dan data bersifat **fiktif khusus lab**.

Mengimplementasikan `PRD_Operation_Phishing_Trail.md` dan
`BLUEPRINT_Operation_Phishing_Trail.md`.

---

## Arsitektur singkat

```
Peserta → Nginx (TLS, headers) → Phishing Trail API (Node/TS/Express) → fixtures (read-only)
                                        └→ ProgressRepository (in-memory; adapter → DB/API platform)
```

- **Backend:** Node.js 20 + TypeScript + Express, REST `/api/v1`.
- **Scoring server-authoritative:** flag, rubric, hint, completion dihitung di backend.
- **Artefak inert:** EML/JSON/MD disajikan `text/plain` + `nosniff` (tidak dirender HTML aktif).
- **Adapter:** `IdentityProvider`, `ProgressRepository` → mudah disambungkan ke SSO/API Hack RedLimit.
- **Mock auth** hanya untuk dev; `APP_ENV=production` + `AUTH_MODE=mock` ditolak saat start.

### Checkpoint (total 800 poin)

| ID | Tipe | Fokus | Poin |
|----|------|-------|------|
| C1 | structured | Identitas pengirim (From / domain) | 100 |
| C2 | exact_match | URL utama (defanged) | 150 |
| C3 | multi_select (exact set) | Red flag didukung bukti | 200 |
| C4 | single_select | Declared vs observed content type lampiran | 150 |
| C5 | single_select | Klasifikasi & tindakan respons | 200 |

---

## Menjalankan lokal (tanpa Docker)

Prasyarat: Node.js ≥ 20.

```bash
make install
make dev        # http://localhost:8080  (AUTH_MODE=mock, CHALLENGE_DIR=./challenge)
```

Atau manual:

```bash
cd app
npm install
CHALLENGE_DIR=../challenge AUTH_MODE=mock APP_ENV=development npm run dev
```

Buka `http://localhost:8080`, klik **Mulai Lab**.
Identitas dev diambil dari header `X-Lab-User` / cookie `lab_user` (default `dev-user`).

## Menjalankan dengan Docker Compose

```bash
cp .env.example .env     # opsional
make compose-config      # validasi
make up                  # build + start (publish ke 127.0.0.1:18080)
make smoke               # cek /healthz
make logs
make down
```

Aplikasi hanya dipublish ke **loopback** (`127.0.0.1:18080`) agar reverse proxy
menjadi satu-satunya entry point publik.

## Testing

```bash
make test        # unit (scoring) + integration/security (API, IDOR, path traversal, dst.)
make typecheck   # dipakai sebagai lint di CI
```

---

## API (`/api/v1`)

| Method | Endpoint | Fungsi | Auth |
|--------|----------|--------|------|
| GET | `/healthz` | Health check | internal |
| GET | `/api/v1/challenges/operation-phishing-trail` | Detail challenge (tanpa jawaban) | ya |
| POST | `/api/v1/sessions` | Buat sesi | ya |
| GET | `/api/v1/sessions/{id}` | Status sesi | ya, pemilik |
| GET | `/api/v1/sessions/{id}/artifacts/{artifactId}` | Artefak (allowlist) | ya, pemilik |
| POST | `/api/v1/sessions/{id}/submissions` | Submit jawaban | ya, pemilik |
| POST | `/api/v1/sessions/{id}/hints` | Buka hint | ya, pemilik |
| POST | `/api/v1/sessions/{id}/reset` | Reset sesi | ya, pemilik |
| GET | `/api/v1/sessions/{id}/walkthrough` | Walkthrough (terkunci s/d selesai) | ya, pemilik |

Contoh submit:

```bash
SID=$(curl -s -XPOST localhost:8080/api/v1/sessions -H 'X-Lab-User: dave' \
  -H 'Content-Type: application/json' -d '{"challenge_id":"operation-phishing-trail"}' | jq -r .session_id)

curl -s -XPOST localhost:8080/api/v1/sessions/$SID/submissions -H 'X-Lab-User: dave' \
  -H 'Content-Type: application/json' \
  -d '{"checkpoint_id":"C3","answer":["sender_domain_mismatch"],"idempotency_key":"abc"}'
```

---

## Keamanan (ringkas)

- Scoring/flag **hanya** server-side; manifest publik & bundle client tidak memuat jawaban.
- Artefak via **allowlist id** (bukan path input) + guard path-traversal.
- **Ownership check** per request (anti-IDOR); ID sesi bukan satu-satunya kontrol akses.
- **Rate limiting** endpoint submit/hint; batas ukuran body; security headers (app + Nginx).
- Container: non-root, `read_only`, `cap_drop: ALL`, `no-new-privileges`, tanpa Docker socket, mem/pids limit.
- Log terstruktur JSON dengan redaction (tanpa cookie/authorization/secret/jawaban).

### Catatan tentang `challenge/.../private/answers.yaml`

Berisi rubric & `final_flag`. Dibaca backend saja dan **tidak pernah** dikembalikan
lewat API. Pada repo training privat ini sengaja di-commit agar lab jalan
out-of-the-box. **Jika repo dipublikasikan:** pindahkan ke secret manager / env,
jangan commit (lihat `.gitignore`).

---

## Integrasi Hack RedLimit (langkah berikutnya)

Implementasi mengikuti kontrak PRD §12 / Blueprint §4.1:

1. Ganti `MockIdentityProvider` dengan `PlatformIdentityProvider`
   (`app/src/auth/identity.ts`) — verifikasi issuer/audience/expiry/signature.
2. Ganti `InMemoryProgressRepository` dengan implementasi DB atau API progres
   platform (`ProgressRepository` di `app/src/sessions/sessionStore.ts`).
3. Tambahkan `PlatformProgressClient` untuk completion callback (idempotent + retry).
4. Set `AUTH_MODE=platform` dan `APP_ENV=production`.

Deployment: subdomain `phishing-trail.hack.redlimit.id` (lihat
`deploy/nginx/phishing-trail.conf`) atau path `/labs/phishing-trail/`.

## Deployment & rollback (ringkas)

- **Staging/Prod:** build image via CI → promosikan image yang sama antar-env.
- Pastikan TLS aktif, port publik hanya via reverse proxy, auth platform teruji.
- **Rollback:** simpan tag image sebelumnya; `docker compose` dengan tag lama.
  Jangan hapus data progres tanpa backup.
- Lihat PRD §20 & Blueprint §12 untuk prosedur lengkap.

## Struktur repo

```
app/            # backend (src/) + frontend statis (public/) + tests/ + Dockerfile
challenge/operation-phishing-trail/
  manifest.yaml           # metadata publik (tanpa jawaban)
  private/answers.yaml    # rubric + flag (server-side only)
  artifacts/*             # EML & bukti sintetis (inert, defanged)
  walkthrough.md
deploy/nginx/   # contoh reverse proxy
.github/workflows/ci.yml
compose.yaml, Makefile, .env.example
```
