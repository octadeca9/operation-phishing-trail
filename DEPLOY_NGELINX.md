# Deploy ke Ngelinx (ngelinx.com)

Panduan mengintegrasikan repo GitHub `octadeca9/operation-phishing-trail` ke
**Ngelinx** — PaaS yang build & deploy langsung dari GitHub (push-to-deploy,
SSL otomatis, URL publik).

Deploy memakai **`Dockerfile` di root repo** (image self-contained) — konten
challenge sudah di-*bake* ke image, jadi **tidak perlu volume mount**. Ini sudah
diuji build + run lokal (termasuk dengan PORT yang di-inject).

---

## 1. Prasyarat

- Repo sudah ada di GitHub: `git@github.com:octadeca9/operation-phishing-trail.git` (privat).
- Akun Ngelinx dengan GitHub terhubung (install GitHub App Ngelinx & beri akses ke repo privat ini).

---

## 2. Langkah di dashboard Ngelinx

1. **New Project / New Application** → pilih sumber **GitHub**.
2. Pilih repository **`operation-phishing-trail`**, branch **`main`**.
3. Build type: **Dockerfile / Application** (bukan Nixpacks, bukan Docker Compose).
   - **Dockerfile path:** `Dockerfile` (root)
   - **Build context:** `.` (root repo)
   > Jika Ngelinx men-deteksi `compose.yaml` dan menawarkan mode Compose,
   > **jangan** pakai itu — `compose.yaml` kita memakai bind-mount & publish
   > loopback yang untuk host lokal, bukan PaaS. Gunakan Dockerfile root.
4. **Port aplikasi:** `8080` (atau biarkan Ngelinx inject `PORT` — app bind otomatis ke `process.env.PORT`).
5. **Health check path:** `/healthz`.
6. Set **Environment Variables** (bagian §3).
7. **Deploy**. Build ±1–3 menit; setelah itu dapat URL publik + SSL.

Setiap `git push` ke `main` memicu rebuild & redeploy otomatis.

---

## 3. Environment variables

| Var | Nilai (demo mandiri) | Catatan |
|-----|----------------------|---------|
| `APP_ENV` | `development` | ⚠️ lihat §4 — `production` + mock akan menolak start |
| `AUTH_MODE` | `mock` | Demo tanpa SSO. Untuk produksi: `platform` |
| `PORT` | *(di-inject Ngelinx)* | Jangan hardcode; app pakai `process.env.PORT` |
| `CHALLENGE_DIR` | *(sudah di image: `/opt/challenge`)* | Tidak perlu diisi |
| `CHALLENGE_ID` | *(sudah di image)* | Tidak perlu diisi |
| `LOG_LEVEL` | `info` | opsional |
| `SESSION_TTL_SECONDS` | `7200` | opsional |
| `RATE_LIMIT_MAX` | `30` | opsional |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | opsional |

> `CHALLENGE_DIR`/`CHALLENGE_ID` sudah di-set di dalam image (root `Dockerfile`),
> jadi tidak wajib diisi di dashboard.

---

## 4. ⚠️ Keamanan auth — WAJIB dipahami

Aplikasi ini dirancang memakai identitas **platform induk (Hack RedLimit)**.
Dua kondisi:

- **`AUTH_MODE=platform`** → memerlukan implementasi `PlatformIdentityProvider`
  (verifikasi token/SSO). Saat ini masih **stub** → request akan error sampai
  adapter diimplementasikan.
- **`AUTH_MODE=mock`** → siapa pun bisa menjadi user apa pun lewat header
  `X-Lab-User` (default `dev-user`). **Tidak ada autentikasi nyata.**

Karena itu, guard menolak start bila `APP_ENV=production` + `AUTH_MODE=mock`.

**Implikasi untuk Ngelinx:**
- Untuk **demo/showcase mandiri**: set `APP_ENV=development` + `AUTH_MODE=mock`.
  URL publik dapat diakses siapa saja; integritas skor **tidak** terjamin
  (cukup untuk mendemokan alur lab, **bukan** untuk penilaian peserta nyata).
- Untuk **produksi sebenarnya**: implementasikan `PlatformIdentityProvider`
  (atau adapter OIDC), set `AUTH_MODE=platform` + `APP_ENV=production`, lalu
  deploy. Lihat `ARCHITECTURE.md §8` dan `DEPLOYMENT_RUNBOOK.md`.

> Catatan: image Ngelinx mem-bake `private/answers.yaml` (berisi flag). Pastikan
> deployment & repo tetap **privat**. Flag tidak pernah dikembalikan via API.

---

## 5. Verifikasi pasca-deploy

Ganti `<URL>` dengan domain dari Ngelinx:

```bash
# Health
curl -fsS https://<URL>/healthz
# → {"status":"ok","challenge":"operation-phishing-trail","version":1}

# Frontend
curl -fsS https://<URL>/ | head -5

# Alur singkat (mode mock/demo)
SID=$(curl -fsS -XPOST https://<URL>/api/v1/sessions -H 'X-Lab-User: demo' \
  -H 'Content-Type: application/json' -d '{"challenge_id":"operation-phishing-trail"}' \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["session_id"])')
curl -fsS "https://<URL>/api/v1/sessions/$SID/artifacts/message" -H 'X-Lab-User: demo' | head -1

# Security header
curl -sI https://<URL>/ | grep -iE 'content-security-policy|x-frame-options'
```

- [ ] `/healthz` 200
- [ ] Frontend termuat, **Mulai Lab** berfungsi
- [ ] Artefak tampil sebagai teks
- [ ] Security header ada
- [ ] (Jika `platform`) request tanpa kredensial valid ditolak

---

## 6. Troubleshooting

| Gejala | Sebab | Tindakan |
|--------|-------|----------|
| Container exit, log "AUTH_MODE=mock dilarang saat APP_ENV=production" | Guard aktif | Set `APP_ENV=development` (demo) atau implementasikan platform auth |
| Build pakai Nixpacks & gagal | Build type salah | Pilih **Dockerfile/Application**, path `Dockerfile` (root) |
| App crash "Artefak hilang" / gagal baca challenge | Deploy dari `app/Dockerfile` (tanpa challenge) | Pakai **Dockerfile root** (bukan `app/Dockerfile`) |
| 502 / tidak reachable | Port salah | Biarkan Ngelinx inject `PORT`; health path `/healthz` |
| Semua request 401/500 di `platform` mode | `PlatformIdentityProvider` stub | Implementasikan adapter atau pakai `mock` untuk demo |

---

## 7. Perbedaan dengan `compose.yaml` lokal

| Aspek | Lokal (`compose.yaml`) | Ngelinx (root `Dockerfile`) |
|-------|------------------------|------------------------------|
| Konten challenge | volume mount `./challenge:ro` | **di-bake** ke image |
| Port | publish `127.0.0.1:18080` | Ngelinx inject `PORT` + proxy |
| TLS/Routing | Nginx terpisah | ditangani Ngelinx |
| Build file | `app/Dockerfile` | `Dockerfile` (root) |

Keduanya memakai source yang sama; hanya cara pengemasan/routing yang berbeda.
