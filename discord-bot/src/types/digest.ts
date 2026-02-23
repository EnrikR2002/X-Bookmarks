/**
 * Types for digest structures and responses
 */

import { BookmarkAnalysis, BookmarkCategory } from './bookmark.js';

export interface DigestStats {
  newCount: number;
  cost: number;
  monthlyTotal: number;
  categoryCounts: Record<BookmarkCategory, number>;
}

export interface DigestResult {
  analyses: BookmarkAnalysis[];
  stats: DigestStats;
  lastSeenBookmarkId: string | null;
}

export interface CategoryGroup {
  category: BookmarkCategory;
  items: BookmarkAnalysis[];
}
