/**
 * Internal bookmark types after categorization and analysis
 */

export type BookmarkCategory =
  | 'AI'
  | 'crypto'
  | 'marketing'
  | 'tools'
  | 'personal'
  | 'news'
  | 'content-ideas'
  | 'other';

export interface BookmarkAnalysis {
  bookmarkId: string;
  category: BookmarkCategory;
  isActionable: boolean;
  summary: string;
  keyTakeaway: string;
  action: string;
  author: string;
  authorUsername: string;
  text: string;
  likeCount: number;
  retweetCount: number;
  createdAt: string;
}

export interface ProcessedBookmark extends BookmarkAnalysis {
  processedAt: number;
  discordUserId: string;
}
