/**
 * Bookmark Store - caches analyzed bookmarks to avoid re-analyzing
 */

import { getDb } from './db.js';
import { BookmarkAnalysis } from '../types/bookmark.js';

export class BookmarkStore {
  static saveAnalyses(discordUserId: string, analyses: BookmarkAnalysis[]): void {
    const db = getDb();
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO analyzed_bookmarks (
        bookmark_id, discord_user_id, analyzed_at, category, is_actionable,
        summary, key_takeaway, action, author, author_username, tweet_text,
        like_count, retweet_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const analysis of analyses) {
      stmt.run(
        analysis.bookmarkId,
        discordUserId,
        Date.now(),
        analysis.category,
        analysis.isActionable ? 1 : 0,
        analysis.summary,
        analysis.keyTakeaway,
        analysis.action,
        analysis.author,
        analysis.authorUsername,
        analysis.text,
        analysis.likeCount,
        analysis.retweetCount,
        analysis.createdAt
      );
    }
  }

  static getAnalysis(discordUserId: string, bookmarkId: string): BookmarkAnalysis | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT * FROM analyzed_bookmarks WHERE discord_user_id = ? AND bookmark_id = ?`
      )
      .get(discordUserId, bookmarkId) as any;

    if (!row) return null;

    return {
      bookmarkId: row.bookmark_id,
      category: row.category,
      isActionable: !!row.is_actionable,
      summary: row.summary,
      keyTakeaway: row.key_takeaway,
      action: row.action,
      author: row.author,
      authorUsername: row.author_username,
      text: row.tweet_text,
      likeCount: row.like_count,
      retweetCount: row.retweet_count,
      createdAt: row.created_at,
    };
  }

  /**
   * Returns a Set of bookmark IDs that have already been analyzed for this user
   */
  static hasBeenAnalyzed(discordUserId: string, bookmarkIds: string[]): Set<string> {
    if (bookmarkIds.length === 0) return new Set();

    const db = getDb();
    const placeholders = bookmarkIds.map(() => '?').join(',');
    const rows = db
      .prepare(
        `SELECT bookmark_id FROM analyzed_bookmarks
         WHERE discord_user_id = ? AND bookmark_id IN (${placeholders})`
      )
      .all(discordUserId, ...bookmarkIds) as any[];

    return new Set(rows.map((r) => r.bookmark_id));
  }

  /**
   * Clear all analyzed bookmarks for a user (for cache reset / re-analysis)
   */
  static clearAll(discordUserId: string): number {
    const db = getDb();
    const result = db
      .prepare(`DELETE FROM analyzed_bookmarks WHERE discord_user_id = ?`)
      .run(discordUserId);
    return result.changes;
  }

  static getRecentAnalyses(discordUserId: string, limit: number = 100): BookmarkAnalysis[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT * FROM analyzed_bookmarks
         WHERE discord_user_id = ?
         ORDER BY analyzed_at DESC LIMIT ?`
      )
      .all(discordUserId, limit) as any[];

    return rows.map((row) => ({
      bookmarkId: row.bookmark_id,
      category: row.category,
      isActionable: !!row.is_actionable,
      summary: row.summary,
      keyTakeaway: row.key_takeaway,
      action: row.action,
      author: row.author,
      authorUsername: row.author_username,
      text: row.tweet_text,
      likeCount: row.like_count,
      retweetCount: row.retweet_count,
      createdAt: row.created_at,
    }));
  }
}
