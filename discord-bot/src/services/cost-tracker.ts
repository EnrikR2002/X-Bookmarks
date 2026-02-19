/**
 * Cost Tracker Service
 * Tracks AI API usage and tokens
 * Gemini Flash free tier = $0 cost, but we still track token usage
 */

export interface CostEntry {
  timestamp: number;
  userId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  operation: string;
}

export class CostTracker {
  private static entries: CostEntry[] = [];

  private static readonly PRICING = {
    'llama-3.3-70b-versatile': {
      input: 0, // Free tier
      output: 0,
    },
  };

  /**
   * Log an API usage event
   */
  static logUsage(params: {
    userId: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    operation: string;
  }): number {
    const pricing = this.PRICING[params.model as keyof typeof this.PRICING] || {
      input: 0,
      output: 0,
    };

    const cost =
      params.inputTokens * pricing.input + params.outputTokens * pricing.output;

    const entry: CostEntry = {
      timestamp: Date.now(),
      userId: params.userId,
      model: params.model,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      costUsd: cost,
      operation: params.operation,
    };

    this.entries.push(entry);

    return cost;
  }

  /**
   * Get total cost for a user this month
   */
  static getMonthlyTotal(userId: string): number {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startTimestamp = startOfMonth.getTime();

    return this.entries
      .filter((e) => e.userId === userId && e.timestamp >= startTimestamp)
      .reduce((sum, e) => sum + e.costUsd, 0);
  }

  /**
   * Get all entries for a user
   */
  static getUserEntries(userId: string): CostEntry[] {
    return this.entries.filter((e) => e.userId === userId);
  }

  /**
   * Get total tokens used today
   */
  static getTodayTokens(userId: string): {
    input: number;
    output: number;
  } {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startTimestamp = startOfDay.getTime();

    const todayEntries = this.entries.filter(
      (e) => e.userId === userId && e.timestamp >= startTimestamp
    );

    return {
      input: todayEntries.reduce((sum, e) => sum + e.inputTokens, 0),
      output: todayEntries.reduce((sum, e) => sum + e.outputTokens, 0),
    };
  }

  /**
   * Clear old entries (cleanup, optional)
   */
  static clearOldEntries(daysToKeep: number = 90): void {
    const cutoffTimestamp = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    this.entries = this.entries.filter((e) => e.timestamp >= cutoffTimestamp);
  }
}
