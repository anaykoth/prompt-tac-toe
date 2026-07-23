// One-shot schema setup. Run: npm run migrate (reads TTT_DATABASE_URL from .env.local)
import pg from "pg";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const url = process.env.TTT_DATABASE_URL;
if (!url) throw new Error("TTT_DATABASE_URL not set");

const sql = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../supabase/migrations/0001_ttt_tables.sql"),
  "utf8"
);

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(sql);
console.log("migrated ok");
await client.end();
