# Case Notes — Helpdesk (FIKTIF, untuk latihan)

**Tiket:** HD-20251020-0042
**Dilaporkan oleh:** Rina (Helpdesk L1)
**Diteruskan ke:** Analyst-1 (SOC)

## Ringkasan
Seorang karyawan meneruskan email "verifikasi slip gaji" karena merasa ragu.
Email mengaku dari **HR Payroll Nusantara Dynamics** dan meminta membuka
lampiran serta mengklik tautan verifikasi dalam 24 jam.

## Yang sudah dilakukan helpdesk
- Email **tidak** dibalas.
- Tautan **tidak** diklik.
- Lampiran **tidak** dibuka.
- Pesan sudah dikarantina oleh mail gateway (lihat `mail-gateway-events.json`).

## Pertanyaan dari helpdesk
> "Apakah ini email HR asli? Beberapa karyawan sudah menerima email serupa.
> Mohon analisis dan arahan tindakan."

## Artefak terlampir untuk analisis
- `message.eml`
- `header-analysis.txt`
- `url-evidence.txt`
- `attachment-metadata.json`
- `mail-gateway-events.json`

> Catatan: domain, nama, dan data pada seluruh artefak bersifat fiktif khusus lab.
