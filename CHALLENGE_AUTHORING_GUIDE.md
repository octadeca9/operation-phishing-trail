# Challenge Authoring Guide — Operation: Phishing Trail

**Platform:** Hack RedLimit (`hack.redlimit.id`)
**Untuk:** author konten / instruktur yang membuat atau memperbarui challenge.
**Dokumen terkait:** `PRD_Operation_Phishing_Trail.md`, `BLUEPRINT_Operation_Phishing_Trail.md`, `DEPLOYMENT_RUNBOOK.md`

Panduan ini menjelaskan cara membuat & memperbarui challenge: struktur file,
format `manifest.yaml` (publik) dan `private/answers.yaml` (rahasia), tipe
checkpoint, pembuatan artefak aman, aturan validasi, dan QA konten.

Semua format di bawah **sesuai schema yang divalidasi aplikasi** saat startup
(`app/src/challenges/challengeRepository.ts`) dan logika penilaian
(`app/src/scoring/scoringService.ts`). Jika manifest/answers tidak valid,
aplikasi **gagal start** — ini sengaja (fail-fast).

> 🔒 **Aturan emas keamanan konten**
> 1. Jawaban benar, rubric, dan flag **hanya** di `private/answers.yaml` — tidak
>    pernah di manifest publik, artefak, atau bundle client.
> 2. Semua domain/URL/nama/IP **fiktif** khusus lab. URL ditampilkan **defanged**
>    (`hxxps://`, `[.]`) — tidak ada tautan aktif.
> 3. Artefak **inert**: tidak ada HTML aktif, script, macro, tracking pixel, atau
>    executable nyata. Lampiran contoh harus sampel inert.
> 4. Setiap jawaban benar **harus didukung bukti** yang benar-benar ada di artefak.

---

## 1. Struktur direktori satu challenge

```
challenge/<challenge-id>/
├── manifest.yaml            # PUBLIK — metadata, objektif, opsi. Tanpa jawaban.
├── private/
│   └── answers.yaml         # RAHASIA — rubric, flag, teks hint. Server-side only.
├── artifacts/               # Bukti sintetis (file-file inert)
│   ├── message.eml
│   ├── header-analysis.txt
│   ├── url-evidence.txt
│   ├── attachment-metadata.json
│   ├── mail-gateway-events.json
│   └── case-notes.md
└── walkthrough.md           # Dibuka hanya setelah sesi `completed`
```

- `<challenge-id>` harus cocok dengan `id` di manifest & `challenge_id` di answers.
- Backend memuat challenge berdasarkan env `CHALLENGE_ID` + `CHALLENGE_DIR`
  (lihat `DEPLOYMENT_RUNBOOK.md §2`). MVP memuat satu challenge aktif.

---

## 2. `manifest.yaml` (publik)

AMAN dikirim ke browser. Dilarang memuat `expected`, `flag`, atau teks hint.

### 2.1 Field tingkat atas (semua wajib)

| Field | Tipe | Keterangan |
|-------|------|------------|
| `id` | string | ID challenge, = nama folder & `challenge_id` di answers |
| `version` | int > 0 | Naikkan saat rubric/konten berubah (lihat §6) |
| `title` | string | Judul tampil |
| `difficulty` | string | mis. `easy`, `medium`, `hard` |
| `estimated_minutes` | int > 0 | Estimasi waktu |
| `description` | string | Narasi/pengantar |
| `artifacts` | list | Lihat §2.2 (min 1) |
| `hints` | `{ max_level: int ≥ 0 }` | Batas jumlah hint per checkpoint |
| `scoring` | `{ max_score: int > 0, hint_penalty_per_level: int ≥ 0 }` | Lihat §4 |
| `objectives` | list | Lihat §3 (min 1) |

### 2.2 Artefak (`artifacts[]`)

```yaml
artifacts:
  - id: message                 # id stabil, dipakai URL artefak
    path: artifacts/message.eml  # relatif terhadap folder challenge
    title: "message.eml"         # label tab + nama unduhan
    display_mode: plain_text     # plain_text | structured_json
```

- `path` harus menunjuk file yang **ada** di dalam folder challenge (dicek saat
  startup; path di luar folder ditolak).
- `display_mode` saat ini hanya penanda tampilan; **semua artefak disajikan
  sebagai `text/plain` + `nosniff`** (inert) oleh endpoint, apa pun ekstensinya.
- `id` dipakai peserta untuk mengambil artefak lewat allowlist — bukan path.

---

## 3. Objektif / checkpoint (`objectives[]`)

Field umum tiap objektif: `id`, `type`, `points`, `title`, `prompt`.
Field tambahan tergantung `type`:

| `type` | Field manifest tambahan | Bentuk jawaban yang dikirim client | `expected` di answers |
|--------|-------------------------|-------------------------------------|-----------------------|
| `structured` | `fields: [{id,label,placeholder?}]` | objek `{ fieldId: "teks" }` | objek `{ fieldId: "benar" }` |
| `exact_match` | `field: {id,label,placeholder?}` | `{ "url": "teks" }` atau string | string |
| `single_select` | `options: [{id,label}]` | `{ "option": "optId" }` atau string | string (id opsi benar) |
| `multi_select` | `options: [{id,label}]` | array `["id1","id2"]` | array id benar |

> **Konsistensi dijamin saat startup:** `type` di manifest harus sama dengan
> `type` di answers untuk tiap `id` checkpoint, dan jumlah hint ≤ `hints.max_level`.
> Jika tidak, app gagal start.

### 3.1 `structured`
Beberapa field teks. Semua field pada `expected` harus cocok (dengan normalisasi,
§5). Field yang tidak ada di `expected` tidak dinilai.

```yaml
# manifest
- id: C1
  type: structured
  points: 100
  title: "Identitas pengirim"
  prompt: "Tentukan alamat pengirim dan domainnya."
  fields:
    - id: sender_address
      label: "Alamat pengirim (From)"
      placeholder: "nama@domain.example"
    - id: sender_domain
      label: "Domain pengirim"
```
```yaml
# answers
C1:
  type: structured
  expected:
    sender_address: "payroll@nusantara-dynamics-hr.example"
    sender_domain: "nusantara-dynamics-hr.example"
  normalize: { lowercase: true, trim: true }
  hints: [ "...", "...", "..." ]
```

### 3.2 `exact_match`
Satu nilai harus persis (dengan normalisasi). Untuk URL, gunakan bentuk
**defanged** yang identik dengan artefak. Jangan diam-diam mengubah URL di backend.

```yaml
# manifest
- id: C2
  type: exact_match
  points: 150
  title: "URL utama (defanged)"
  prompt: "Salin URL utama persis seperti di url-evidence.txt."
  field: { id: url, label: "URL (defanged)", placeholder: "hxxps://..." }
```
```yaml
# answers
C2:
  type: exact_match
  expected: "hxxps://account-verify[.]nusantara-dynamics-hr[.]example-payroll[.]review/secure/login?ref=PR-8842"
  normalize: { lowercase: true, trim: true }
  hints: [ "...", "...", "..." ]
```

### 3.3 `single_select`
Satu opsi benar. Gunakan **id opsi stabil** di `expected`, bukan label UI.

```yaml
# manifest
- id: C4
  type: single_select
  points: 150
  title: "Tipe konten lampiran"
  prompt: "Declared vs observed content type?"
  options:
    - { id: match, label: "Sesuai" }
    - { id: mismatch_executable, label: "Tidak sesuai: PDF tapi signature MZ/PE" }
    - { id: mismatch_archive, label: "Tidak sesuai: PDF tapi ZIP" }
```
```yaml
# answers
C4: { type: single_select, expected: "mismatch_executable", hints: [ "...", "...", "..." ] }
```

### 3.4 `multi_select` (kebijakan: exact set)
Peserta harus memilih **persis** himpunan benar — tidak kurang, tidak ada yang
salah. Sertakan **distractor** yang terdengar benar tapi tidak didukung bukti
(mis. "HTTPS pasti aman").

```yaml
# manifest
- id: C3
  type: multi_select
  points: 200
  title: "Red flag"
  prompt: "Pilih SEMUA red flag yang didukung bukti."
  options:
    - { id: sender_domain_mismatch, label: "Domain pengirim ≠ domain organisasi" }
    - { id: uses_https_safe,        label: "HTTPS sehingga pasti aman" }   # distractor
    # ...
```
```yaml
# answers
C3:
  type: multi_select
  policy: exact_set            # satu-satunya policy yang didukung saat ini
  expected: [ sender_domain_mismatch, url_lookalike_domain, auth_spf_dmarc_fail ]
  hints: [ "...", "...", "..." ]
```

---

## 4. Scoring & penalti hint

- Total `max_score` di manifest **harus** = jumlah `points` seluruh objektif.
  (Sebagai kebiasaan QA; cek saat review.)
- Poin diberikan **sekali** per checkpoint saat jawaban pertama yang benar.
- Penalti hint: tiap hint yang dibuka mengurangi `hint_penalty_per_level` poin
  dari checkpoint terkait. Poin checkpoint tidak pernah < 0.
  Rumus: `award = max(0, points − hintLevel × hint_penalty_per_level)`.
- `completed` ditetapkan backend saat **semua** objektif benar; saat itu
  `final_flag` dianggap tercapai (walkthrough terbuka). Flag tidak dikirim di
  response submit.

Contoh: C1 (100 poin), penalti 25/level, 2 hint dibuka → benar = 50 poin.

---

## 5. `private/answers.yaml` (rahasia)

Server-side only; tidak pernah dikembalikan API. Pada repo publik, pindahkan ke
secret manager/env (lihat `DEPLOYMENT_RUNBOOK.md §6.3`).

```yaml
challenge_id: operation-phishing-trail   # = manifest.id
version: 1                                # = manifest.version
final_flag: "RL{...}"                     # format flag platform
checkpoints:
  C1: { type: ..., expected: ..., normalize?: ..., policy?: ..., hints: [...] }
  # ... satu entri untuk SETIAP objektif di manifest
```

### 5.1 Normalisasi jawaban (`normalize`)
Opsional, berlaku untuk `structured` & `exact_match`:

| Opsi | Default | Efek |
|------|---------|------|
| `trim` | `true` | Hapus spasi di awal/akhir |
| `lowercase` | `false` | Bandingkan tanpa peduli huруf besar/kecil |

> Untuk `single_select`/`multi_select`, perbandingan memakai **id opsi** apa
> adanya (case-sensitive) — jaga id tetap lowercase & stabil.

### 5.2 Hint bertingkat
`hints` adalah array string, urut dari paling halus ke paling terarah. Panjang
array ≤ `manifest.hints.max_level`. Rekomendasi 3 tingkat:
1. **Konsep** — kategori bukti yang perlu diperiksa.
2. **Teknis** — artefak/field spesifik.
3. **Terarah** — metode pemeriksaan, **tanpa** memberi jawaban langsung.

---

## 6. Versioning

Naikkan `version` (di manifest **dan** answers) bila mengubah rubric, opsi,
atau poin. Ini menjaga sesi lama tetap konsisten (sesi menyimpan
`challenge_version`). Perbaikan teks murni (typo di artefak yang tidak mengubah
jawaban) boleh tanpa bump versi, tapi catat di changelog/PR.

---

## 7. Membuat artefak aman

Panduan per jenis:

- **`message.eml`** — RFC 5322. Sertakan header yang relevan dengan objektif
  (`From`, `Reply-To`, `Return-Path`, `Received`, `Authentication-Results`,
  `DKIM-Signature`). Body plain text. Jika ada bagian HTML, tetap akan disajikan
  sebagai teks — jangan andalkan rendering. Lampiran: gunakan sampel **inert**
  (mis. byte `MZ` untuk mendemonstrasikan mismatch), beri catatan "inert lab
  sample / DO NOT RUN".
- **`header-analysis.txt`** — ringkasan header yang memudahkan latihan; jangan
  "membocorkan" kesimpulan akhir, cukup sajikan fakta + catatan netral.
- **`url-evidence.txt`** — semua URL **defanged** konsisten (`hxxps://`, `[.]`).
  URL di sini harus **identik** dengan `expected` C2.
- **`attachment-metadata.json`** — `declared_*` vs `observed_*` yang saling
  bertentangan hanya bila itu memang objektif (mis. C4). Hash boleh sintetis.
- **`mail-gateway-events.json`** — event log simulasi; selaras dengan artefak lain
  (SPF/DKIM/DMARC, verdict URL/lampiran).
- **`case-notes.md`** — narasi helpdesk; tegaskan tidak ada klik/buka lampiran.
- **`walkthrough.md`** — jelaskan **bukti** di balik tiap jawaban, bukan sekadar
  kunci; tambahkan mitigasi.

Prinsip desain konten (PRD §6.5): jangan jadikan satu sinyal (mis. SPF fail)
sebagai bukti tunggal; kesimpulan harus dari gabungan bukti yang konsisten.

---

## 8. Validasi & QA sebelum merge

### 8.1 Validasi schema (otomatis)
Aplikasi memvalidasi manifest + answers saat **startup** dan **test** memuatnya.
Cara tercepat memvalidasi lokal:

```bash
cd app
npm test                 # test integrasi memuat challenge nyata (lihat tests/api.test.ts)
# atau boot cepat:
CHALLENGE_DIR=../challenge AUTH_MODE=mock APP_ENV=development npm run dev
# app gagal start → ada error schema/konsistensi yang ditampilkan di log
```

Yang dicek saat load (`challengeRepository.ts`):
- Schema manifest & answers valid (zod).
- `manifest.id == answers.challenge_id`, `version` cocok.
- Setiap objektif punya entri answers dengan `type` sama.
- Jumlah hint ≤ `hints.max_level`.
- Semua file artefak ada & berada di dalam folder challenge.

### 8.2 Pemeriksaan fixture (CI)
Job `fixtures` di `.github/workflows/ci.yml` menolak PR bila:
- Ada pola flag `RL{` di `manifest.yaml` atau `artifacts/` (bocor ke publik).
- Ada URL aktif `http(s)://` di `artifacts/` (harus defanged).

Jalankan setara lokal sebelum push:
```bash
grep -RInE 'RL\{' challenge/<id>/manifest.yaml challenge/<id>/artifacts && echo "FLAG BOCOR" || echo "ok: tidak ada flag"
grep -RInE 'https?://' challenge/<id>/artifacts && echo "URL AKTIF" || echo "ok: defanged"
```

### 8.3 Checklist Content QA (manual)
- [ ] Setiap jawaban benar **didukung** artefak yang tersedia.
- [ ] URL defanged **konsisten** antara artefak dan `expected` C2.
- [ ] `multi_select` punya distractor; memilih semua opsi **tidak** lolos.
- [ ] Metadata MIME vs signature hanya bertentangan bila memang objektif.
- [ ] Walkthrough menjelaskan bukti, bukan hanya kunci.
- [ ] Tidak ada identitas/domain/kredensial nyata.
- [ ] `sum(points) == max_score`.
- [ ] Hint tidak membocorkan jawaban di level 1–2.
- [ ] `version` sudah dinaikkan bila rubric berubah.

---

## 9. Worked example — menambah checkpoint baru

Menambah **C6** bertipe `single_select` (contoh: "Protokol autentikasi email mana
yang gagal paling menentukan?"):

1. **manifest.yaml** → tambahkan objektif:
   ```yaml
   - id: C6
     type: single_select
     points: 100
     title: "Sinyal autentikasi"
     prompt: "Mekanisme mana yang kegagalannya paling kuat sebagai indikator di sini?"
     options:
       - { id: dmarc, label: "DMARC fail (p=reject, tidak aligned)" }
       - { id: spf,   label: "SPF fail saja" }
       - { id: tls,   label: "TLS tidak dipakai" }
   ```
2. **private/answers.yaml** → tambahkan rubric + hint:
   ```yaml
   C6:
     type: single_select
     expected: "dmarc"
     hints:
       - "Konsep: mekanisme mana yang menilai keselarasan dengan domain From?"
       - "Teknis: lihat Authentication-Results & mail-gateway-events.json."
       - "Terarah: DMARC menggabungkan SPF/DKIM + alignment; di sini p=reject & fail."
   ```
3. **scoring.max_score** → naikkan (800 → 900). **version** → naikkan.
4. Pastikan artefak mendukung jawaban (sudah ada di gateway events).
5. `npm test` + grep fixtures → PR.

> Frontend meng-render objektif secara **generik** dari manifest (tidak perlu
> ubah UI untuk tipe yang sudah didukung). Menambah **tipe checkpoint baru**
> memerlukan perubahan kode di `scoringService.ts` + input builder di
> `app/public/app.js` — di luar authoring konten biasa.

---

## 10. Membuat challenge yang benar-benar baru

1. Salin folder `challenge/operation-phishing-trail/` → `challenge/<id-baru>/`.
2. Ganti `id`/`challenge_id`, tulis narasi & objektif, buat artefak baru.
3. Set env `CHALLENGE_ID=<id-baru>` (atau tambahkan dukungan multi-challenge bila
   diperlukan — saat ini MVP satu challenge aktif per instance).
4. Jalankan validasi §8 dan QA.
5. Deploy sesuai `DEPLOYMENT_RUNBOOK.md`.

---

## 11. Larangan (jangan lakukan)

- ❌ Menaruh `expected`/`flag`/hint di `manifest.yaml`, artefak, atau frontend.
- ❌ Memakai domain/URL yang benar-benar bisa diakses, atau identitas nyata.
- ❌ Menyertakan executable/macro/HTML aktif/tracking pixel.
- ❌ Menjadikan satu sinyal sebagai bukti tunggal "pasti phishing".
- ❌ Mengubah rubric tanpa menaikkan `version`.
- ❌ Menerima path file dari pengguna untuk artefak (selalu via allowlist `id`).
