/**
 * User Store - manages Discord users and their encrypted X auth tokens
 */

import { getDb } from './db.js';
import { encryptToken, decryptToken } from '../utils/crypto.js';

function getEncryptionKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error('ENCRYPTION_KEY env var required for multi-user support');
  }
  return key;
}

export interface UserRecord {
  discord_id: string;
  auth_token: string;
  ct0: string;
  created_at: number;
  last_digest_at: number | null;
  last_seen_bookmark_id: string | null;
  schedule_channel_id: string | null;
  schedule_cron: string | null;
}

export class UserStore {
  static getOrCreateUser(discordId: string): UserRecord {
    const db = getDb();
    const existing = db
      .prepare('SELECT * FROM users WHERE discord_id = ?')
      .get(discordId) as any;

    if (existing) {
      return {
        discord_id: existing.discord_id,
        auth_token: existing.encrypted_auth_token
          ? decryptToken(existing.encrypted_auth_token, getEncryptionKey())
          : '',
        ct0: existing.encrypted_ct0
          ? decryptToken(existing.encrypted_ct0, getEncryptionKey())
          : '',
        created_at: existing.created_at,
        last_digest_at: existing.last_digest_at,
        last_seen_bookmark_id: existing.last_seen_bookmark_id,
        schedule_channel_id: existing.schedule_channel_id,
        schedule_cron: existing.schedule_cron,
      };
    }

    const now = Date.now();
    db.prepare(
      `INSERT INTO users (discord_id, created_at) VALUES (?, ?)`
    ).run(discordId, now);

    return {
      discord_id: discordId,
      auth_token: '',
      ct0: '',
      created_at: now,
      last_digest_at: null,
      last_seen_bookmark_id: null,
      schedule_channel_id: null,
      schedule_cron: null,
    };
  }

  static hasAuthTokens(discordId: string): boolean {
    const db = getDb();
    const row = db
      .prepare('SELECT encrypted_auth_token, encrypted_ct0 FROM users WHERE discord_id = ?')
      .get(discordId) as any;
    return !!(row?.encrypted_auth_token && row?.encrypted_ct0);
  }

  static registerTokens(discordId: string, authToken: string, ct0: string): void {
    const db = getDb();
    // Ensure user row exists before updating
    UserStore.getOrCreateUser(discordId);

    const encryptedAuth = encryptToken(authToken, getEncryptionKey());
    const encryptedCt0 = encryptToken(ct0, getEncryptionKey());

    db.prepare(
      `UPDATE users SET encrypted_auth_token = ?, encrypted_ct0 = ? WHERE discord_id = ?`
    ).run(encryptedAuth, encryptedCt0, discordId);
  }

  static updateLastSeenBookmarkId(discordId: string, bookmarkId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE users SET last_seen_bookmark_id = ? WHERE discord_id = ?`
    ).run(bookmarkId, discordId);
  }

  static updateLastDigestAt(discordId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE users SET last_digest_at = ? WHERE discord_id = ?`
    ).run(Date.now(), discordId);
  }

  static setSchedule(discordId: string, channelId: string, cronExpression: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE users SET schedule_channel_id = ?, schedule_cron = ? WHERE discord_id = ?`
    ).run(channelId, cronExpression, discordId);
  }

  static clearSchedule(discordId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE users SET schedule_channel_id = NULL, schedule_cron = NULL WHERE discord_id = ?`
    ).run(discordId);
  }

  static getAllScheduledUsers(): Array<{
    discord_id: string;
    channel_id: string;
    cron: string;
    auth_token: string;
    ct0: string;
  }> {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT discord_id, schedule_channel_id, schedule_cron, encrypted_auth_token, encrypted_ct0
         FROM users WHERE schedule_channel_id IS NOT NULL AND schedule_cron IS NOT NULL`
      )
      .all() as any[];

    return rows.map((row) => ({
      discord_id: row.discord_id,
      channel_id: row.schedule_channel_id,
      cron: row.schedule_cron,
      auth_token: row.encrypted_auth_token
        ? decryptToken(row.encrypted_auth_token, getEncryptionKey())
        : '',
      ct0: row.encrypted_ct0
        ? decryptToken(row.encrypted_ct0, getEncryptionKey())
        : '',
    }));
  }
}
