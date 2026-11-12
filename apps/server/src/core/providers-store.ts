import type { QuotaPeriod, QuotaUnit } from "@tg/shared";
import type { DB } from "../db/index.js";
import { getDefinition } from "../providers/registry.js";
import type { Credentials, TranslationProvider } from "../providers/types.js";
import { decrypt, encrypt } from "./crypto.js";

export interface ProviderRow {
  id: string;
  type: string;
  name: string;
  enabled: number;
  priority: number;
  credentials_enc: string;
  quota_unit: QuotaUnit;
  quota_limit: number;
  quota_period: QuotaPeriod;
  reset_timezone: string;
  cooldown_until: number;
}

export class ProvidersStore {
  constructor(
    private db: DB,
    private key: Buffer,
  ) {}

  list(): ProviderRow[] {
    return this.db.prepare("SELECT * FROM providers ORDER BY priority ASC, rowid ASC").all() as ProviderRow[];
  }

  get(id: string): ProviderRow | undefined {
    return this.db.prepare("SELECT * FROM providers WHERE id=?").get(id) as ProviderRow | undefined;
  }

  credentials(row: ProviderRow): Credentials {
    if (!row.credentials_enc) return {};
    return JSON.parse(decrypt(row.credentials_enc, this.key));
  }

  encryptCredentials(c: Credentials): string {
    return encrypt(JSON.stringify(c), this.key);
  }

  instantiate(row: ProviderRow): TranslationProvider {
    const def = getDefinition(row.type);
    if (!def) throw new Error(`Loại provider không biết: ${row.type}`);
    return def.create(row.id, this.credentials(row));
  }

  insert(row: Omit<ProviderRow, "priority" | "cooldown_until">): ProviderRow {
    const max = this.db.prepare("SELECT COALESCE(MAX(priority),-1) AS m FROM providers").get() as { m: number };
    this.db
      .prepare(
        `INSERT INTO providers(id,type,name,enabled,priority,credentials_enc,quota_unit,quota_limit,quota_period,reset_timezone,cooldown_until)
         VALUES(@id,@type,@name,@enabled,@priority,@credentials_enc,@quota_unit,@quota_limit,@quota_period,@reset_timezone,0)`,
      )
      .run({ ...row, priority: max.m + 1 });
    return this.get(row.id)!;
  }

  update(id: string, patch: Partial<ProviderRow>): void {
    const cols = Object.keys(patch);
    if (!cols.length) return;
    this.db
      .prepare(`UPDATE providers SET ${cols.map((c) => `${c}=@${c}`).join(",")} WHERE id=@id`)
      .run({ ...patch, id });
  }

  remove(id: string): boolean {
    this.db.prepare("DELETE FROM usage_counters WHERE provider_id=?").run(id);
    return this.db.prepare("DELETE FROM providers WHERE id=?").run(id).changes > 0;
  }

  setOrder(ids: string[]): void {
    const upd = this.db.prepare("UPDATE providers SET priority=? WHERE id=?");
    this.db.transaction(() => ids.forEach((id, i) => upd.run(i, id)))();
  }

  setCooldown(id: string, until: number): void {
    this.db.prepare("UPDATE providers SET cooldown_until=? WHERE id=?").run(until, id);
  }
}
