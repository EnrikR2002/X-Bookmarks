/**
 * URL Enricher Service
 * Fetches page titles and descriptions from URLs found in tweets
 * so the LLM has context about link-heavy bookmarks
 */

import https from 'https';
import http from 'http';
import { BirdBookmark } from '../types/bird-cli.js';

interface UrlMetadata {
  url: string;
  domain: string;
  title: string | null;
  description: string | null;
}

const FETCH_TIMEOUT = 5000; // 5s per URL
const MAX_BODY_SIZE = 50000; // Only read first 50KB for meta tags

/**
 * Extract all URLs from tweet text (skip t.co shortened links,
 * use expanded URLs from bird CLI if available)
 */
function extractUrls(bookmark: BirdBookmark): string[] {
  // Prefer expanded URLs from bird CLI's url entities
  if (bookmark.urls && bookmark.urls.length > 0) {
    return bookmark.urls.map((u) => u.expandedUrl);
  }

  // Fallback: extract ALL URLs from text (including t.co — they'll be resolved via redirects)
  const urlRegex = /https?:\/\/[^\s]+/g;
  const matches = bookmark.text.match(urlRegex) || [];
  return matches;
}

/**
 * Fetch metadata (title + description) from a single URL.
 * Follows redirects (up to 5 hops) and reports the final domain.
 */
async function fetchUrlMetadata(
  url: string,
  originalUrl?: string,
  redirectsLeft: number = 5
): Promise<UrlMetadata> {
  const origin = originalUrl || url;

  return new Promise((resolve) => {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      resolve({ url: origin, domain: 'unknown', title: null, description: null });
      return;
    }

    const client = parsedUrl.protocol === 'https:' ? https : http;

    const req = client.get(
      url,
      {
        timeout: FETCH_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      },
      (res) => {
        // Follow redirects
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          // Resolve relative redirect URLs
          let redirectUrl = res.headers.location;
          if (redirectUrl.startsWith('/')) {
            redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
          }
          res.destroy();
          fetchUrlMetadata(redirectUrl, origin, redirectsLeft - 1).then(resolve);
          return;
        }

        let body = '';
        res.setEncoding('utf8');

        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_SIZE) {
            res.destroy();
          }
        });

        let resolved = false;
        const finalize = () => {
          if (resolved) return;
          resolved = true;
          const finalDomain = parsedUrl.hostname.replace(/^www\./, '');
          const title =
            extractMeta(body, 'og:title') ||
            extractMeta(body, 'twitter:title') ||
            extractTag(body, 'title');

          const description =
            extractMeta(body, 'og:description') ||
            extractMeta(body, 'twitter:description') ||
            extractMeta(body, 'description');

          resolve({
            url: origin,
            domain: finalDomain,
            title: title ? title.slice(0, 200) : null,
            description: description ? description.slice(0, 300) : null,
          });
        };

        res.on('end', finalize);
        res.on('close', finalize);

        res.on('error', () => {
          resolve({
            url: origin,
            domain: parsedUrl.hostname.replace(/^www\./, ''),
            title: null,
            description: null,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ url: origin, domain: 'unknown', title: null, description: null });
    });

    req.on('error', () => {
      resolve({ url: origin, domain: 'unknown', title: null, description: null });
    });
  });
}

/**
 * Extract <title>...</title> from HTML
 */
function extractTag(html: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, 'i');
  const match = html.match(regex);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

/**
 * Extract <meta name="..." content="..."> or <meta property="..." content="...">
 */
function extractMeta(html: string, name: string): string | null {
  const regex = new RegExp(
    `<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']` +
    `|<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${name}["']`,
    'i'
  );
  const match = html.match(regex);
  const value = match ? (match[1] || match[2]) : null;
  return value ? decodeHtmlEntities(value.trim()) : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/');
}

/**
 * Enrich bookmarks with URL metadata
 * Returns a map of bookmark ID -> enrichment string
 */
export async function enrichBookmarksWithUrls(
  bookmarks: BirdBookmark[]
): Promise<Map<string, string>> {
  const enrichments = new Map<string, string>();

  // Collect all URLs to fetch (deduplicated)
  const urlsByBookmark = new Map<string, string[]>();
  for (const bookmark of bookmarks) {
    const urls = extractUrls(bookmark);
    if (urls.length > 0) {
      urlsByBookmark.set(bookmark.id, urls);
    }
  }

  // Fetch all unique URLs in parallel (with concurrency limit of 5)
  const allUrls = [...new Set([...urlsByBookmark.values()].flat())];
  const metadataCache = new Map<string, UrlMetadata>();

  for (let i = 0; i < allUrls.length; i += 5) {
    const batch = allUrls.slice(i, i + 5);
    const results = await Promise.all(batch.map((u) => fetchUrlMetadata(u)));
    for (const meta of results) {
      metadataCache.set(meta.url, meta);
    }
  }

  // Build enrichment strings per bookmark
  for (const [bookmarkId, urls] of urlsByBookmark) {
    const parts: string[] = [];

    for (const url of urls) {
      const meta = metadataCache.get(url);
      if (!meta) continue;

      let line = `[${meta.domain}]`;
      if (meta.title) line += ` "${meta.title}"`;
      if (meta.description) line += ` — ${meta.description}`;
      parts.push(line);
    }

    if (parts.length > 0) {
      enrichments.set(bookmarkId, parts.join('\n'));
    }
  }

  return enrichments;
}
