/**
 * Usage Store - persistent replacement for in-memory CostTracker
 */

import { getDb } from './db.js';

export interface UsageLogEntry {
  id: number;
  discord_user_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  operation: string;
  logged_at: number;
}

export class UsageStore {
  static logUsage(params: {
    userId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    operation: string;
  }): void {
    const db = getDb();
    db.prepare(`
      INSERT INTO usage_log (discord_user_id, model, input_tokens, output_tokens, cost_usd, operation, logged_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.userId,
      params.model,
      params.inputTokens,
      params.outputTokens,
      params.costUsd,
      params.operation,
      Date.now()
    );
  }

  static getMonthlyTotal(userId: string): number {
    const db = getDb();
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();

    const row = db
      .prepare(
        `SELECT SUM(cost_usd) as total FROM usage_log
         WHERE discord_user_id = ? AND logged_at >= ? AND logged_at <= ?`
      )
      .get(userId, monthStart, monthEnd) as any;

    return row?.total ?? 0;
  }

  static getTodayTokens(userId: string): { input: number; output: number } {
    const db = getDb();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const todayEnd = todayStart + 86400000;

    const row = db
      .prepare(
        `SELECT SUM(input_tokens) as input, SUM(output_tokens) as output FROM usage_log
         WHERE discord_user_id = ? AND logged_at >= ? AND logged_at <= ?`
      )
      .get(userId, todayStart, todayEnd) as any;

    return {
      input: row?.input ?? 0,
      output: row?.output ?? 0,
    };
  }

  static getUserEntries(userId: string, days: number = 30): UsageLogEntry[] {
    const db = getDb();
    const cutoff = Date.now() - days * 86400000;

    return db
      .prepare(
        `SELECT * FROM usage_log WHERE discord_user_id = ? AND logged_at >= ? ORDER BY logged_at DESC`
      )
      .all(userId, cutoff) as UsageLogEntry[];
  }
}
