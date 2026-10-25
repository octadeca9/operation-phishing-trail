import type { LabSession } from "../types.js";

/**
 * ProgressRepository — adapter penyimpanan progres sesi.
 * Implementasi default: in-memory. Ganti dengan DB / API platform induk
 * tanpa mengubah business logic (lihat Blueprint §4.1).
 */
export interface ProgressRepository {
  create(session: LabSession): void;
  get(id: string): LabSession | undefined;
  save(session: LabSession): void;
  delete(id: string): void;
}

export class InMemoryProgressRepository implements ProgressRepository {
  private readonly sessions = new Map<string, LabSession>();

  create(session: LabSession): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): LabSession | undefined {
    return this.sessions.get(id);
  }

  save(session: LabSession): void {
    this.sessions.set(session.id, session);
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}
