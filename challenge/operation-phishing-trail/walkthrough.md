# Walkthrough — Operation: Phishing Trail (The Payroll Notice)

> Tersedia hanya setelah seluruh checkpoint tervalidasi. Fokus pada **bukti**,
> bukan sekadar jawaban.

## C1 — Identitas pengirim
- **From:** `"HR Payroll Department" <payroll@nusantara-dynamics-hr.example>`
- Alamat pengirim: `payroll@nusantara-dynamics-hr.example`
- Domain yang perlu diperiksa: `nusantara-dynamics-hr.example`
- **Bukti:** domain ini **berbeda** dari domain resmi organisasi
  `nusantara-dynamics.example`. `Reply-To` dan `Return-Path` bahkan mengarah ke
  domain ketiga `mail-verify.example`. Display name yang meyakinkan tidak
  mengubah fakta domain teknisnya.

## C2 — URL utama (defanged)
`hxxps://account-verify[.]nusantara-dynamics-hr[.]example-payroll[.]review/secure/login?ref=PR-8842`
- **Bukti:** `url-evidence.txt`. Domain terdaftar yang sebenarnya adalah
  `example-payroll[.]review`; nama organisasi hanya ditempel sebagai
  subdomain untuk menipu mata (lookalike / misleading subdomain).

## C3 — Red flag yang didukung bukti
Benar (semua harus dipilih, tidak boleh ada yang salah):
- `display_name_mismatch` — display name "HR Payroll" vs alamat di domain asing.
- `sender_domain_mismatch` — `nusantara-dynamics-hr.example` ≠ `nusantara-dynamics.example`.
- `reply_to_mismatch` — `Reply-To` di `mail-verify.example`.
- `url_lookalike_domain` — nama org sebagai subdomain dari `example-payroll[.]review`.
- `auth_spf_dmarc_fail` — SPF fail, DKIM none, DMARC fail.
- `urgency_pressure` — ancaman penangguhan gaji dalam 24 jam.

Jebakan (jangan dipilih):
- `uses_https_safe` — HTTPS hanya mengenkripsi transport, bukan jaminan keaslian.
- `dkim_valid` — DKIM justru `none`/tidak aligned.
- `internal_ip_trusted` — asal pesan adalah IP eksternal `198.51.100.77`.

## C4 — Kesesuaian tipe konten lampiran
Jawaban: **declared PDF, tetapi signature menunjukkan executable (MZ/PE)**.
- **Bukti:** `attachment-metadata.json` — `declared_mime_type: application/pdf`
  tetapi `observed_file_signature: 4D 5A` ("MZ"), penanda executable Windows,
  bukan `%PDF-`. File lab bersifat inert; tidak ada payload aktif.

## C5 — Klasifikasi & tindakan
Jawaban: **Phishing — jangan klik/jangan buka lampiran, laporkan & eskalasi ke
SOC, blokir pengirim.**
- Kesimpulan diambil dari **gabungan** bukti C1–C4 yang konsisten, bukan satu
  sinyal tunggal.

## Mitigasi & pembelajaran
- Verifikasi permintaan sensitif melalui kanal resmi terpisah (bukan membalas email).
- Periksa domain terdaftar (registrable domain), bukan hanya teks yang terlihat.
- SPF/DKIM/DMARC membantu, tetapi interpretasikan bersama konteks.
- Jangan pernah "klik untuk memastikan" — laporkan ke SOC.
- Kendali teknis: karantina gateway, pemblokiran domain, kesadaran pengguna.
