/**
 * Filesystem store for local development: one JSON file per case under .data/cases.
 * Writes are atomic (write to temp file, then rename) and serialised per case id.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { CaseSchema, type Case } from "@/lib/schemas";
import { NotFoundError, summarize, type CaseStore, type CaseSummary } from "./types";

export class LocalCaseStore implements CaseStore {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private dir: string) {}

  private caseDir() {
    return path.join(this.dir, "cases");
  }

  private file(id: string) {
    if (!/^[A-Z0-9-]{4,32}$/.test(id)) throw new NotFoundError();
    return path.join(this.caseDir(), `${id}.json`);
  }

  private async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(
      key,
      next.catch(() => undefined),
    );
    return next;
  }

  private async writeAtomic(file: string, data: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data, "utf8");
    await fs.rename(tmp, file);
  }

  async get(id: string): Promise<Case | null> {
    try {
      const raw = await fs.readFile(this.file(id), "utf8");
      return CaseSchema.parse(JSON.parse(raw));
    } catch (e) {
      if (e instanceof NotFoundError) return null;
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async create(c: Case): Promise<void> {
    const file = this.file(c.id);
    await this.withLock(c.id, async () => {
      try {
        await fs.access(file);
        throw new Error(`Case ${c.id} already exists`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await this.writeAtomic(file, JSON.stringify(CaseSchema.parse(c), null, 2));
    });
  }

  async update(id: string, mutate: (c: Case) => Case): Promise<Case> {
    return this.withLock(id, async () => {
      const current = await this.get(id);
      if (!current) throw new NotFoundError();
      const next = CaseSchema.parse(mutate(structuredClone(current)));
      next.updatedAt = new Date().toISOString();
      await this.writeAtomic(this.file(id), JSON.stringify(next, null, 2));
      return next;
    });
  }

  async list(limit = 200): Promise<CaseSummary[]> {
    let names: string[] = [];
    try {
      names = (await fs.readdir(this.caseDir())).filter((n) => n.endsWith(".json"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: CaseSummary[] = [];
    for (const n of names) {
      const c = await this.get(n.replace(/\.json$/, ""));
      if (c) out.push(summarize(c));
    }
    return out.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt)).slice(0, limit);
  }

  async increment(counter: string): Promise<number> {
    const file = path.join(this.dir, "counters.json");
    return this.withLock("__counters", async () => {
      let data: Record<string, number> = {};
      try {
        data = JSON.parse(await fs.readFile(file, "utf8"));
      } catch {
        data = {};
      }
      data[counter] = (data[counter] ?? 0) + 1;
      await this.writeAtomic(file, JSON.stringify(data));
      return data[counter];
    });
  }
}
