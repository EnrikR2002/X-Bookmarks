/**
 * Bookmark Analyzer Service
 * Uses Groq (free tier) with Llama 3.3 70B to categorize and analyze bookmarks
 */

import Groq from 'groq-sdk';
import { BirdBookmark } from '../types/bird-cli.js';
import { BookmarkAnalysis, BookmarkCategory } from '../types/bookmark.js';
import { enrichBookmarksWithUrls } from './url-enricher.js';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const BATCH_SIZE = 5;
const TOKEN_LIMIT_PER_MINUTE = 5600; // Conservative limit (actual is 6000)
const TOKEN_WINDOW_MS = 62_000; // 62s window (slightly more than 60s to be safe)
const MAX_TWEET_CHARS = 1800; // Truncate very long tweets/articles to this length
const CHARS_PER_TOKEN = 3.5; // Rough estimate for token counting

/**
 * Tracks token usage within a rolling 60-second window.
 * Blocks before a batch if we're close to the rate limit.
 */
class TokenBucket {
  private tokensUsed = 0;
  private windowStart = Date.now();
  private onWait?: (seconds: number) => void;

  setWaitCallback(cb: (seconds: number) => void) {
    this.onWait = cb;
  }

  async waitIfNeeded(estimatedTokens: number): Promise<void> {
    const elapsed = Date.now() - this.windowStart;
    if (elapsed >= TOKEN_WINDOW_MS) {
      this.tokensUsed = 0;
      this.windowStart = Date.now();
    }

    if (this.tokensUsed + estimatedTokens > TOKEN_LIMIT_PER_MINUTE) {
      const waitMs = Math.max(TOKEN_WINDOW_MS - elapsed + 2000, 2000);
      const secs = Math.ceil(waitMs / 1000);
      console.log(`⏳ Token limit: ${this.tokensUsed}/${TOKEN_LIMIT_PER_MINUTE} used — waiting ${secs}s...`);
      this.onWait?.(secs);
      await sleep(waitMs);
      this.tokensUsed = 0;
      this.windowStart = Date.now();
    }
  }

  recordUsage(tokens: number) {
    this.tokensUsed += tokens;
    console.log(`📊 Tokens this window: ${this.tokensUsed}/${TOKEN_LIMIT_PER_MINUTE}`);
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

interface AnalysisResponse {
  category: BookmarkCategory;
  isActionable: boolean;
  summary: string;
  keyTakeaway: string;
  action: string;
}

export class ClaudeAnalyzer {
  private client: Groq;
  private onProgress?: (processed: number, total: number, status?: string) => void;

  constructor(apiKey?: string) {
    this.client = new Groq({
      apiKey: apiKey || process.env.GROQ_API_KEY,
    });
  }

  /**
   * Set a progress callback for long-running analyses
   */
  setProgressCallback(cb: (processed: number, total: number, status?: string) => void) {
    this.onProgress = cb;
  }

  /**
   * Analyze bookmarks in batches using Groq
   */
  async analyzeBookmarks(
    bookmarks: BirdBookmark[]
  ): Promise<{
    analyses: BookmarkAnalysis[];
    totalCost: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    // Step 1: Re-fetch any stub bookmarks (bare t.co links) to get full article content
    this.onProgress?.(0, bookmarks.length, 'Fetching full article content...');
    const enrichedBookmarks = await import('./bookmark-fetcher.js').then(
      (m) => m.BookmarkFetcher.refetchFullContent(bookmarks)
    );

    // Step 2: Enrich bookmarks with URL metadata (for non-article external links)
    console.log(`🔗 Enriching ${enrichedBookmarks.length} bookmarks with URL metadata...`);
    this.onProgress?.(0, enrichedBookmarks.length, 'Fetching link previews...');
    const urlEnrichments = await enrichBookmarksWithUrls(enrichedBookmarks);
    console.log(`🔗 Enriched ${urlEnrichments.size} bookmarks with link context`);

    const allAnalyses: BookmarkAnalysis[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    const totalBatches = Math.ceil(enrichedBookmarks.length / BATCH_SIZE);

    const bucket = new TokenBucket();
    bucket.setWaitCallback((secs) => {
      this.onProgress?.(
        allAnalyses.length,
        enrichedBookmarks.length,
        `Rate limit reached — resuming in ${secs}s...`
      );
    });

    for (let i = 0; i < enrichedBookmarks.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = enrichedBookmarks.slice(i, i + BATCH_SIZE);

      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} bookmarks)...`);

      // Estimate tokens for this batch before sending
      const prompt = this.buildCategorizationPrompt(batch, urlEnrichments);
      const estimatedInput = estimateTokens(prompt);
      const estimatedOutput = batch.length * 150; // ~150 tokens per bookmark output
      await bucket.waitIfNeeded(estimatedInput + estimatedOutput);

      this.onProgress?.(
        allAnalyses.length,
        enrichedBookmarks.length,
        `Analyzing batch ${batchNum}/${totalBatches}...`
      );

      const { analyses, usage } = await this.analyzeBatch(batch, urlEnrichments, prompt);

      allAnalyses.push(...analyses);
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      bucket.recordUsage(usage.inputTokens + usage.outputTokens);

      this.onProgress?.(allAnalyses.length, enrichedBookmarks.length);
    }

    return {
      analyses: allAnalyses,
      totalCost: 0,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
    };
  }

  /**
   * Analyze a single batch of bookmarks, with 429 retry support.
   * Accepts a pre-built prompt so we don't rebuild it after waiting.
   */
  private async analyzeBatch(
    bookmarks: BirdBookmark[],
    urlEnrichments: Map<string, string>,
    prebuiltPrompt?: string
  ): Promise<{
    analyses: BookmarkAnalysis[];
    usage: { inputTokens: number; outputTokens: number };
  }> {
    const prompt = prebuiltPrompt ?? this.buildCategorizationPrompt(bookmarks, urlEnrichments);

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 2048,
        response_format: { type: 'json_object' },
      });
    } catch (err: unknown) {
      // Handle 429 rate limit errors: wait 65s and retry once
      const e = err as { status?: number; message?: string };
      if (e?.status === 429) {
        const waitSecs = 65;
        console.log(`⚠️ Groq 429 rate limit hit — waiting ${waitSecs}s then retrying...`);
        this.onProgress?.(0, bookmarks.length, `Rate limit hit — retrying in ${waitSecs}s...`);
        await sleep(waitSecs * 1000);
        response = await this.client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2048,
          response_format: { type: 'json_object' },
        });
      } else {
        throw err;
      }
    }

    const responseText = response.choices[0]?.message?.content || '';
    const inputTokens = response.usage?.prompt_tokens ?? 0;
    const outputTokens = response.usage?.completion_tokens ?? 0;

    const parsedResponses = this.parseResponse(responseText, bookmarks);

    const analyses: BookmarkAnalysis[] = bookmarks.map((bookmark, idx) => {
      const analysis = parsedResponses[idx] || {
        category: 'other' as BookmarkCategory,
        isActionable: false,
        summary: bookmark.text.slice(0, 100) + '...',
        keyTakeaway: 'Could not analyze this bookmark.',
        action: 'No specific action identified',
      };

      return {
        bookmarkId: bookmark.id,
        category: analysis.category,
        isActionable: analysis.isActionable,
        summary: analysis.summary,
        keyTakeaway: analysis.keyTakeaway,
        action: analysis.action,
        author: bookmark.author.name,
        authorUsername: bookmark.author.username,
        text: bookmark.text,
        likeCount: bookmark.likeCount,
        retweetCount: bookmark.retweetCount,
        createdAt: bookmark.createdAt,
      };
    });

    return {
      analyses,
      usage: { inputTokens, outputTokens },
    };
  }

  /**
   * Build the categorization prompt with URL enrichment
   */
  private buildCategorizationPrompt(
    bookmarks: BirdBookmark[],
    urlEnrichments: Map<string, string>
  ): string {
    const bookmarksText = bookmarks
      .map((b, idx) => {
        const enrichment = urlEnrichments.get(b.id);
        const linkContext = enrichment ? `\nLink context:\n${enrichment}` : '';

        // X Article: use article title + truncated text
        let textBlock: string;
        if (b.article) {
          const body = b.text.length > MAX_TWEET_CHARS
            ? b.text.slice(0, MAX_TWEET_CHARS) + `\n[...article continues — ${b.text.length} chars total]`
            : b.text;
          textBlock = `X Article: "${b.article.title}"\nContent:\n${body}`;
        } else {
          // Regular tweet: truncate if needed
          const tweet = b.text.length > MAX_TWEET_CHARS
            ? b.text.slice(0, MAX_TWEET_CHARS) + `... [truncated, ${b.text.length} chars total]`
            : b.text;
          textBlock = `Text: ${tweet}`;
        }

        // Include quoted tweet context if available
        let quotedContext = '';
        if (b.quotedTweet) {
          const qt = b.quotedTweet;
          const qtText = qt.text.length > 600 ? qt.text.slice(0, 600) + '...' : qt.text;
          quotedContext = `\nQuoted tweet by @${qt.author.username}: "${qtText}"`;
          if (qt.likeCount > 0) quotedContext += ` [${qt.likeCount} likes]`;
        }

        const views = b.viewCount ? `, ${b.viewCount} views` : '';

        return `
[${idx}] Author: @${b.author.username} (${b.author.name})
${textBlock}${quotedContext}${linkContext}
Engagement: ${b.likeCount} likes, ${b.retweetCount} RTs${views}
---`;
      })
      .join('\n');

    return `You are analyzing Twitter/X bookmarks for a personal digest. Your goal: help the user understand EXACTLY what each bookmark is about and what they should do with it.

For each bookmark, produce:
{
  "category": "AI" | "crypto" | "marketing" | "tools" | "personal" | "news" | "content-ideas" | "other",
  "isActionable": boolean,
  "summary": "A specific, descriptive title (8-15 words) that captures the ACTUAL topic — NOT 'Shared link' or 'Unknown content'",
  "keyTakeaway": "3-5 sentence deep breakdown: (1) What specific claim/insight/resource is being shared? (2) Why is this valuable or interesting? (3) What makes this bookmark worth keeping? Include specific details, names, numbers, or frameworks mentioned.",
  "action": "A specific, concrete next step the user can take (start with a verb like 'Read...', 'Research...', 'Try...', 'Apply...', 'Watch...')"
}

**Category Guidelines (use "other" ONLY as absolute last resort):**
- **AI**: Machine learning, AI tools, LLMs, AI research, prompting, automation
- **crypto**: Cryptocurrency, blockchain, web3, DeFi, trading, tokenomics
- **marketing**: Marketing strategies, growth hacking, advertising, audience building, SEO
- **tools**: Software, apps, GitHub repos, developer tools, browser extensions, utilities
- **personal**: Health, fitness, nutrition, biohacking, self-improvement, productivity, psychology, relationships, lifestyle
- **news**: Breaking events, announcements, industry trends, geopolitics, current affairs
- **content-ideas**: Writing frameworks, content strategies, creator tips, viral formats, media analysis

**CRITICAL RULES — violations will make the digest useless:**
1. NEVER use generic phrases like "Shared link", "Unknown content", "Shared article", "This tweet shares a URL without context". Instead, USE ALL AVAILABLE CONTEXT (tweet text, quoted tweet, link metadata, author, engagement) to figure out what it's about.
2. If a tweet is mostly a URL with little text, use the "Link context" (page title + description) to understand the topic. If no link context is available, infer from the author's profile, engagement level, and any text clues.
3. The "keyTakeaway" must contain SPECIFIC details — names, numbers, claims, techniques. Never write filler like "it might be worth exploring" or "the value is unclear."
4. Quoted tweets are PART of the bookmark's context. The main tweet is commenting on or amplifying the quoted tweet. Analyze BOTH together.
5. High engagement (1000+ likes) means the content resonated — try harder to understand why.
6. Categorize aggressively. Most tweets fit into a real category. Only use "other" if it truly doesn't fit anywhere.
7. Actions must be SPECIFIC to this bookmark. Not "investigate further" but "Read [specific article/thread]" or "Try [specific technique]" or "Research [specific topic]."

**Bookmarks to analyze:**
${bookmarksText}

Respond with JSON: {"bookmarks": [${bookmarks.map((_, i) => `{...bookmark ${i}...}`).join(', ')}]}
Array must have exactly ${bookmarks.length} objects.`;
  }

  /**
   * Parse the JSON response into analysis objects
   */
  private parseResponse(
    responseText: string,
    bookmarks: BirdBookmark[]
  ): AnalysisResponse[] {
    try {
      let cleaned = responseText.trim();
      cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

      const parsed = JSON.parse(cleaned);

      const arr: AnalysisResponse[] = Array.isArray(parsed)
        ? parsed
        : parsed.bookmarks || parsed.results || [];

      if (!Array.isArray(arr)) {
        throw new Error('Could not find array in response');
      }

      while (arr.length < bookmarks.length) {
        arr.push({
          category: 'other',
          isActionable: false,
          summary: 'Unable to analyze',
          keyTakeaway: 'Analysis was not available for this bookmark.',
          action: 'No action identified',
        });
      }

      return arr;
    } catch (err) {
      const error = err as Error;
      console.error('Failed to parse Groq response:', error.message);
      console.error('Response text:', responseText);

      return bookmarks.map(() => ({
        category: 'other' as BookmarkCategory,
        isActionable: false,
        summary: 'Analysis failed',
        keyTakeaway: 'Could not analyze this bookmark.',
        action: 'Unable to generate action',
      }));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
