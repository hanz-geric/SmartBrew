import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!db) {
    db = await SQLite.openDatabaseAsync('smartbrew.db');
  }
  return db;
}

export async function initDb(): Promise<void> {
  const database = await getDb();

  await database.execAsync(`
    PRAGMA journal_mode = WAL;

    -- Cached product catalog (synced from server)
    CREATE TABLE IF NOT EXISTS products (
      id              TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      price           REAL    NOT NULL,
      cost            REAL    NOT NULL DEFAULT 0,
      category_id     TEXT    NOT NULL,
      category_name   TEXT    NOT NULL,
      tracking_mode   TEXT    NOT NULL DEFAULT 'none',
      stock_item_id   TEXT,
      image           TEXT,
      needs_kitchen   INTEGER NOT NULL DEFAULT 0,
      is_active       INTEGER NOT NULL DEFAULT 1,
      stock_status    TEXT    NOT NULL DEFAULT 'ok',
      modifier_groups TEXT    NOT NULL DEFAULT '[]',
      recipe_lines    TEXT    NOT NULL DEFAULT '[]',
      synced_at       TEXT    NOT NULL
    );

    -- Cached categories
    CREATE TABLE IF NOT EXISTS categories (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active  INTEGER NOT NULL DEFAULT 1,
      synced_at  TEXT    NOT NULL
    );

    -- Local stock ledger for optimistic deductions during offline orders
    CREATE TABLE IF NOT EXISTS stock_cache (
      id               TEXT  PRIMARY KEY,
      quantity_on_hand REAL  NOT NULL,
      reorder_level    REAL  NOT NULL DEFAULT 0,
      updated_at       TEXT  NOT NULL
    );

    -- Offline order queue (orders waiting to sync to server)
    CREATE TABLE IF NOT EXISTS pending_orders (
      local_id    TEXT PRIMARY KEY,
      payload     TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0
    );

    -- Orders that permanently failed after max retries
    CREATE TABLE IF NOT EXISTS failed_orders (
      local_id   TEXT PRIMARY KEY,
      payload    TEXT NOT NULL,
      created_at TEXT NOT NULL,
      failed_at  TEXT NOT NULL
    );

    -- Completed orders (local receipt cache)
    CREATE TABLE IF NOT EXISTS orders_cache (
      id           TEXT    PRIMARY KEY,
      order_number TEXT    NOT NULL,
      data         TEXT    NOT NULL,
      created_at   TEXT    NOT NULL
    );
  `);

  // Migration: add recipe_lines if missing (pre-existing databases)
  const migrations = [
    `ALTER TABLE products ADD COLUMN recipe_lines TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE products ADD COLUMN category_ids TEXT NOT NULL DEFAULT '[]'`,
  ];
  for (const sql of migrations) {
    try { await database.runAsync(sql); } catch { /* column already exists */ }
  }
}
