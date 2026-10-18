import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Db } from "../db/index.ts";
import { INITIAL_MICROS, nextInterval, seededRng } from "./config.ts";
import { initializeMarket, marketState } from "./repository.ts";
import { marketRuntime } from "./runtime.ts";

// RFC4180-style parser, including quoted commas, escaped quotes, CRLF and embedded newlines.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === '"') {
      if (field || closed) throw new Error("Malformed CSV quote");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field); field = ""; closed = false;
      if (c !== ",") { rows.push(row); row = []; if (c === "\r" && text[i + 1] === "\n") i++; }
    } else { if (closed) throw new Error("Text after CSV quote"); field += c; }
  }
  if (quoted) throw new Error("Unclosed CSV quote");
  if (field || row.length || closed) { row.push(field); rows.push(row); }
  return rows;
}
const AssetRow = z.strictObject({
  id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), name: z.string().trim().min(1).max(500),
  imagefile: z.string().regex(/^[0-9]+_[A-Za-z0-9_-]+\.jpg$/), sourceImageCount: z.number().int().positive(),
});
export type AssetRow = z.infer<typeof AssetRow>;

export function seedRows(db: Db, rows: readonly AssetRow[], now: number, seed = randomBytes(16).toString("hex")): number {
  const checked = rows.map((r) => AssetRow.parse(r));
  if (new Set(checked.map((r) => r.id)).size !== checked.length || new Set(checked.map((r) => r.imagefile)).size !== checked.length)
    throw new Error("Duplicate asset label or filename");
  return db.transaction(() => {
    initializeMarket(db, marketRuntime().seed ?? seed, now, marketRuntime().config);
    const state = marketState(db); let added = 0;
    for (const r of checked) {
      const next = now + nextInterval(state.config, seededRng(state.seed, `seed:${r.id}:interval`));
      const inserted = db.prepare(`INSERT OR IGNORE INTO market_celebrities(id,name,imagefile,initial_micros,current_micros,next_tick)
        VALUES(?,?,?,?,?,?)`).run(r.id, r.name, r.imagefile, state.config.initialPriceMicros ?? INITIAL_MICROS, state.config.initialPriceMicros ?? INITIAL_MICROS, next).changes;
      if (!inserted) {
        const old = db.prepare("SELECT imagefile,name FROM market_celebrities WHERE id=?").get(r.id) as { imagefile: string; name: string } | undefined;
        if (!old || old.imagefile !== r.imagefile || old.name !== r.name) throw new Error("Dataset identity conflict; review instead of overwriting");
        continue;
      }
      added++;
      db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES(?,?,'price',?)").run(`price:${r.id}:1`, r.id, next);
      db.prepare("INSERT INTO market_jobs(id,celebrity_id,kind,due_at) VALUES(?,?,'enrich',?)").run(`enrich:${r.id}:initial`, r.id, now);
    }
    return added;
  }).immediate();
}

export function importAssets(db: Db, directory: string, now: number, seed?: string, expected = 997): number {
  const csv = parseCsv(readFileSync(join(directory, "metadata.csv"), "utf8"));
  const header = csv.shift();
  if (header?.join(",") !== "label_id,celebrity_name,filename,total_images_available") throw new Error("Unexpected metadata columns");
  if (csv.length !== expected) throw new Error(`Expected ${expected} celebrity labels, found ${csv.length}`);
  const rows = csv.map((r) => {
    if (r.length !== 4 || !/^\d+$/.test(r[0]!) || !/^\d+$/.test(r[3]!)) throw new Error("Malformed metadata row");
    const row = AssetRow.parse({ id: Number(r[0]), name: r[1], imagefile: r[2], sourceImageCount: Number(r[3]) });
    if (!row.imagefile.startsWith(`${row.id}_`) || !statSync(join(directory, row.imagefile)).isFile()) throw new Error("Missing or mismatched asset filename");
    return row;
  });
  return seedRows(db, rows, now, seed);
}
