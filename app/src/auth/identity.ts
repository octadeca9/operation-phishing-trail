import type { Request } from "express";
import type { AuthenticatedUser } from "../types.js";

/**
 * IdentityProvider — adapter identitas. Core challenge TIDAK bergantung pada
 * mekanisme auth tertentu. Implementasi platform (API/OIDC) menggantikan mock
 * ini tanpa mengubah business logic (Blueprint §4.1, PRD §12).
 */
export interface IdentityProvider {
  authenticate(req: Request): AuthenticatedUser | null;
}

/**
 * Mock provider — HANYA untuk local/dev. Identitas diambil dari header
 * `X-Lab-User` atau cookie `lab_user`, default "dev-user".
 * DILARANG aktif di deployment publik (lihat config.assertSafeForPublic()).
 */
export class MockIdentityProvider implements IdentityProvider {
  authenticate(req: Request): AuthenticatedUser | null {
    const headerUser = req.header("x-lab-user");
    const cookieUser = parseCookie(req.header("cookie"))["lab_user"];
    const id = (headerUser || cookieUser || "dev-user").trim();
    if (!/^[A-Za-z0-9_.@-]{1,64}$/.test(id)) return null;
    return { id };
  }
}

/**
 * Placeholder provider platform. Implementasikan verifikasi issuer, audience,
 * expiry, signature token / sesi platform induk di sini sebelum production.
 */
export class PlatformIdentityProvider implements IdentityProvider {
  authenticate(_req: Request): AuthenticatedUser | null {
    throw new Error(
      "PlatformIdentityProvider belum diimplementasikan. Sambungkan API/SSO Hack RedLimit sebelum rilis.",
    );
  }
}

function parseCookie(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
