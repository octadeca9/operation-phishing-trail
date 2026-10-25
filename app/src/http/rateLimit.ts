/**
 * Rate limiter in-memory sederhana (fixed window) per-kunci.
 * Untuk MVP; di produksi gunakan store terdistribusi bila multi-instance.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** @returns true jika diizinkan, false jika melewati batas. */
  take(key: string): boolean {
    const now = Date.now();
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (entry.count >= this.max) return false;
    entry.count += 1;
    return true;
  }
}
