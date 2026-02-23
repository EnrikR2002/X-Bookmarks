/**
 * Bookmark Fetcher Service
 * Wraps the fetch_bookmarks.sh bash script to fetch X/Twitter bookmarks via bird CLI
 */

import { spawn } from 'child_process';
import { BirdBookmark, BirdBookmarkArray } from '../types/bird-cli.js';

export interface FetchBookmarksOptions {
  count?: number;
  authToken?: string;
  ct0?: string;
  sinceId?: string;
}

export class BookmarkFetcher {
  /**
   * Fetch bookmarks using the bash script wrapper
   *
   * @param options Fetch options (count, auth tokens)
   * @returns Array of bookmarks from Bird CLI
   */
  static async fetchBookmarks(
    options: FetchBookmarksOptions = {}
  ): Promise<BirdBookmark[]> {
    const {
      count = 10,
      authToken = process.env.AUTH_TOKEN,
      ct0 = process.env.CT0,
      sinceId,
    } = options;

    if (!authToken || !ct0) {
      throw new Error(
        'Missing X authentication tokens. Set AUTH_TOKEN and CT0 in .env or provide them explicitly.'
      );
    }

    const birdArgs = ['bookmarks', '-n', count.toString(), '--json'];
    // Note: bird CLI has no --since-id flag; incremental filtering is done client-side below

    // Call bird CLI directly (works on Windows without bash)
    return new Promise((resolve, reject) => {
      const proc = spawn(
        'bird',
        birdArgs,
        {
          env: {
            ...process.env,
            AUTH_TOKEN: authToken,
            CT0: ct0,
          },
          shell: true, // Use shell on Windows for finding bird in PATH
        }
      );

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          return reject(
            new Error(`Bird CLI failed (exit code ${code}): ${stderr}`)
          );
        }

        try {
          const bookmarks: BirdBookmarkArray = JSON.parse(stdout);

          if (!Array.isArray(bookmarks)) {
            return reject(new Error('Bird CLI output is not an array'));
          }

          // Filter to only bookmarks newer than sinceId (client-side, since bird has no --since-id)
          // Tweet IDs are snowflakes — numerically larger = newer
          if (sinceId) {
            const sinceIdBig = BigInt(sinceId);
            const filtered = bookmarks.filter((b) => BigInt(b.id) > sinceIdBig);
            return resolve(filtered);
          }

          resolve(bookmarks);
        } catch (err) {
          const error = err as Error;
          reject(new Error(`Failed to parse Bird CLI output: ${error.message}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn bird CLI: ${err.message}`));
      });
    });
  }

  /**
   * Fetch a single tweet by ID using `bird read <id> --json`
   */
  static async fetchBookmarkById(
    bookmarkId: string,
    options: { authToken?: string; ct0?: string } = {}
  ): Promise<BirdBookmark> {
    const {
      authToken = process.env.AUTH_TOKEN,
      ct0 = process.env.CT0,
    } = options;

    if (!authToken || !ct0) {
      throw new Error('Missing X authentication tokens');
    }

    return new Promise((resolve, reject) => {
      // On Linux: use detached=true so the child gets its own process group.
      // This lets us kill the entire group (shell + bird grandchild) with SIGKILL,
      // which closes the pipe immediately so proc.on('close') fires quickly.
      const useDetached = process.platform !== 'win32';
      const proc = spawn(
        'bird',
        ['read', bookmarkId, '--json'],
        {
          env: {
            ...process.env,
            AUTH_TOKEN: authToken,
            CT0: ct0,
          },
          shell: true,
          detached: useDetached,
        }
      );

      // Kill bird process if it takes too long (15s timeout)
      const timeout = setTimeout(() => {
        // Attempt to kill process group if detached
        if (useDetached && proc.pid) {
          try {
            process.kill(-proc.pid, 'SIGKILL');
          } catch (err) {
            // Swallow error - process may already be dead
            console.warn(`Failed to kill process group for bookmark ${bookmarkId}:`, err);
          }
        }

        // Also attempt regular kill
        try {
          proc.kill();
        } catch (err) {
          // Swallow error - process may already be dead
          console.warn(`Failed to kill process for bookmark ${bookmarkId}:`, err);
        }

        reject(new Error(`bird read ${bookmarkId} timed out after 15s`));
      }, 15_000);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          return reject(
            new Error(`Bird CLI failed to fetch tweet ${bookmarkId}: ${stderr}`)
          );
        }

        try {
          const bookmark: BirdBookmark = JSON.parse(stdout);
          resolve(bookmark);
        } catch (err) {
          const error = err as Error;
          reject(new Error(`Failed to parse bird CLI output: ${error.message}`));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn bird CLI: ${err.message}`));
      });
    });
  }

  /**
   * Detect bookmarks that are just a bare t.co link (no other text) and
   * re-fetch them using `bird read <id>` to get the full article content.
   * This is important for X Articles, which the bookmarks API returns as stubs.
   */
  static async refetchFullContent(
    bookmarks: BirdBookmark[],
    options: { authToken?: string; ct0?: string } = {}
  ): Promise<BirdBookmark[]> {
    const stubPattern = /^https?:\/\/t\.co\/\w+\s*$/;
    const stubs = bookmarks.filter((b) => stubPattern.test(b.text.trim()));

    if (stubs.length === 0) return bookmarks;

    console.log(`📰 Re-fetching ${stubs.length} stub bookmark(s) for full content...`);

    // Re-fetch stubs SEQUENTIALLY — each bird read process uses ~40MB RAM and the
    // Fly.io container only has 256MB. Running all in parallel causes OOM crashes.
    const refetched: PromiseSettledResult<BirdBookmark>[] = [];
    for (const stub of stubs) {
      const result = await BookmarkFetcher.fetchBookmarkById(stub.id, options)
        .then((v) => ({ status: 'fulfilled' as const, value: v }))
        .catch((e) => ({ status: 'rejected' as const, reason: e }));
      refetched.push(result);
    }

    // Build a lookup map of re-fetched bookmarks
    const fullContentMap = new Map<string, BirdBookmark>();
    stubs.forEach((stub, idx) => {
      const result = refetched[idx];
      if (result.status === 'fulfilled') {
        // Merge: keep original engagement numbers (bookmarks API is more accurate),
        // replace text/article with the full-content version
        fullContentMap.set(stub.id, {
          ...result.value,
          likeCount: stub.likeCount || result.value.likeCount,
          retweetCount: stub.retweetCount || result.value.retweetCount,
          replyCount: stub.replyCount || result.value.replyCount,
          viewCount: stub.viewCount || result.value.viewCount,
        });
      }
    });

    // Replace stubs with full-content versions
    return bookmarks.map((b) => fullContentMap.get(b.id) ?? b);
  }

  /**
   * Validate that X auth tokens work by calling bird whoami
   */
  static async validateTokens(authToken: string, ct0: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        'bird',
        ['whoami'],
        {
          env: { ...process.env, AUTH_TOKEN: authToken, CT0: ct0 },
          shell: true,
        }
      );

      let stderr = '';
      proc.stderr.on('data', (data) => (stderr += data.toString()));

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Bird validation failed: ${stderr}`));
        }
      });

      proc.on('error', (err) => reject(err));
    });
  }
}
