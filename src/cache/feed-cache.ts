export type FeedResponse = {
  posts: Array<{
    id: number;
    userId: number;
    username: string;
    content: string;
    createdAt: Date;
  }>;
  nextCursor: string | null;
};

export const FEED_CACHE_TTL_MS = 10_000;
export const FEED_CACHE_MAX_ENTRIES = 5_000;

type CacheEntry = {
  expiresAt: number;
  value: FeedResponse;
};

const entries = new Map<string, CacheEntry>();

export function getCachedFeed(
  key: string,
  ttlMs = FEED_CACHE_TTL_MS,
): FeedResponse | undefined {
  if (ttlMs <= 0) {
    return undefined;
  }

  const entry = entries.get(key);
  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    entries.delete(key);
    return undefined;
  }

  entries.delete(key);
  entries.set(key, entry);
  return entry.value;
}

export function setCachedFeed(
  key: string,
  value: FeedResponse,
  ttlMs = FEED_CACHE_TTL_MS,
): void {
  if (ttlMs <= 0) {
    return;
  }

  entries.delete(key);
  while (entries.size >= FEED_CACHE_MAX_ENTRIES) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    entries.delete(oldestKey);
  }

  entries.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
}

export function invalidateUserFeeds(userId: number): void {
  const prefix = `feed:${userId}:`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) {
      entries.delete(key);
    }
  }
}
