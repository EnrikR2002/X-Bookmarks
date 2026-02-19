/**
 * TypeScript types for Bird CLI JSON output
 * Based on @steipete/bird v0.8.0 schema
 */

export interface BirdAuthor {
  username: string;
  name: string;
  profileImageUrl?: string;
  verified?: boolean;
}

export interface BirdMedia {
  type: 'photo' | 'video' | 'animated_gif';
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
}

export interface BirdBookmark {
  id: string;
  text: string;
  createdAt: string;
  replyCount: number;
  retweetCount: number;
  likeCount: number;
  viewCount?: number;
  author: BirdAuthor;
  media?: BirdMedia[];
  quotedTweet?: BirdBookmark;
  inReplyToStatusId?: string;
  lang?: string;
  urls?: Array<{
    url: string;
    expandedUrl: string;
    displayUrl: string;
  }>;
  /** Present when the bookmark is an X Article (long-form content) */
  article?: {
    title: string;
    previewText: string;
  };
}

export type BirdBookmarkArray = BirdBookmark[];
