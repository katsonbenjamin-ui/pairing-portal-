/**
 * Pairing Portal — Postgres helpers
 *
 * After WhatsApp pairing succeeds, credentials are saved to the shared
 * wa_auth_state table so Core can restore the session after Railway restarts.
 *
 * Required env var: DATABASE_URL
 */

import pg from "pg";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const { Pool } = pg;

let _pool = null;

function getPool() {
  if (!_pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL env var is not set on Pairing Portal service");
    }
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
    _pool.on("error", (err) => console.error("[db] Pool error:", err.message));
  }
  return _pool;
}

async function ensureTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS wa_auth_state (
      session_id TEXT PRIMARY KEY,
      creds      JSONB NOT NULL,
      keys       JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Read all Baileys auth files from authDir, combine them into
 * the creds + keys structure, and upsert into Postgres.
 *
 * Baileys useMultiFileAuthState writes:
 *   creds.json          → our `creds` column
 *   <type>-<id>.json    → individual key files → our `keys` column
 */
export async function savePairedSession(botifySessionId, authDir) {
  await ensureTable();

  if (!existsSync(authDir)) {
    throw new Error(`Auth directory not found: ${authDir}`);
  }

  const files = readdirSync(authDir);
  if (!files.length) {
    throw new Error(`Auth directory is empty: ${authDir}`);
  }

  let creds = null;
  const keys = {};

  for (const file of files) {
    const filePath = path.join(authDir, file);
    let content;
    try {
      content = JSON.parse(readFileSync(filePath, "utf8"));
    } catch {
      continue; // Skip unreadable files
    }

    if (file === "creds.json") {
      creds = content;
    } else {
      // Key files are named like: "app-state-sync-key-<id>.json"
      // Strip the .json extension and use as the key
      const keyName = file.replace(/\.json$/, "");
      keys[keyName] = content;
    }
  }

  if (!creds) {
    throw new Error("creds.json not found in auth directory — pairing may not be complete");
  }

  await getPool().query(
    `INSERT INTO wa_auth_state (session_id, creds, keys, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (session_id) DO UPDATE
       SET creds = $2, keys = $3, updated_at = NOW()`,
    [botifySessionId, creds, keys]
  );
}
