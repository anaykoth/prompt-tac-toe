// One-shot schema setup. Run: npm run migrate (reads TTT_DATABASE_URL from .env.local)
import pg from "pg";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.TTT_DATABASE_URL;
if (!url) throw new Error("TTT_DATABASE_URL not set");

const dir = join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
for (const f of files) {
  await client.query(readFileSync(join(dir, f), "utf8"));
  console.log("applied", f);
}
console.log("migrated ok");
await client.end();
