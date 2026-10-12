import type { Post } from "./api";

export const POST_TTL_MS = 5 * 60 * 1000;

type ListSession = {
  ids: number[];
  nextCursor: string | null;
  scrollY: number;
};

// Every post item carries its own 5-minute expiry.
const posts = new Map<number, { post: Post; expiresAt: number }>();
// Which posts a given list (feed / profile) was showing, so navigating back
// restores it without refetching.
const sessions = new Map<string, ListSession>();

export function cachePosts(items: Post[]): void {
  const expiresAt = Date.now() + POST_TTL_MS;
  for (const post of items) posts.set(post.id, { post, expiresAt });
}

export function getSession(
  key: string,
): { posts: Post[]; nextCursor: string | null; scrollY: number } | undefined {
  const session = sessions.get(key);
  if (!session) return undefined;

  const now = Date.now();
  const live: Post[] = [];
  for (const id of session.ids) {
    const entry = posts.get(id);
    if (entry && entry.expiresAt > now) live.push(entry.post);
    else posts.delete(id);
  }
  if (live.length === 0) {
    sessions.delete(key);
    return undefined;
  }
  return {
    posts: live,
    nextCursor: session.nextCursor,
    scrollY: session.scrollY,
  };
}

export function saveSession(
  key: string,
  list: Post[],
  nextCursor: string | null,
  scrollY: number,
): void {
  sessions.set(key, { ids: list.map((p) => p.id), nextCursor, scrollY });
}

export function dropSession(key: string): void {
  sessions.delete(key);
}
