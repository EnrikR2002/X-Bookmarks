/**
 * SQLite database singleton with WAL mode and migrations
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '../../data');
const dbPath = path.join(dataDir, 'bookmarks.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let instance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!instance) {
    instance = new Database(dbPath);
    instance.pragma('journal_mode = WAL');
    runMigrations(instance);
  }
  return instance;
}

function runMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      discord_id TEXT PRIMARY KEY,
      encrypted_auth_token TEXT,
      encrypted_ct0 TEXT,
      created_at INTEGER NOT NULL,
      last_digest_at INTEGER,
      last_seen_bookmark_id TEXT,
      schedule_channel_id TEXT,
      schedule_cron TEXT
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS analyzed_bookmarks (
      bookmark_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      analyzed_at INTEGER NOT NULL,
      category TEXT NOT NULL,
      is_actionable INTEGER NOT NULL,
      summary TEXT NOT NULL,
      key_takeaway TEXT NOT NULL,
      action TEXT NOT NULL,
      author TEXT NOT NULL,
      author_username TEXT NOT NULL,
      tweet_text TEXT NOT NULL,
      like_count INTEGER NOT NULL,
      retweet_count INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (bookmark_id, discord_user_id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      operation TEXT NOT NULL,
      logged_at INTEGER NOT NULL
    );
  `);

  console.log('✅ Database migrations complete');
}

export function closeDb() {
  if (instance) {
    instance.close();
    instance = null;
  }
}
