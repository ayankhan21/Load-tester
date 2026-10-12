import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PAGE_SIZE, type Post, type PostPage } from "./api";
import { cachePosts, getSession, saveSession } from "./postCache";

// Fetch the next page once the user reaches the 15th item of the latest page
// (PAGE_SIZE - 15 items from the end), so the next batch is already in place
// before they hit the bottom.
const PREFETCH_AT = 15;
const MAX_EMPTY_RETRIES = 5;

export function useInfinitePosts(
  storeKey: string,
  fetchPage: (cursor: string | null) => Promise<PostPage>,
) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const state = useRef({ posts, nextCursor, loading: false });
  state.current.posts = posts;
  state.current.nextCursor = nextCursor;
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const scrollRestore = useRef<number | null>(null);

  const loadMore = useCallback(async () => {
    const s = state.current;
    if (s.loading || (s.posts.length > 0 && s.nextCursor === null)) return;
    s.loading = true;
    setLoading(true);
    setError(null);
    try {
      let list = s.posts;
      let cursor = s.nextCursor;
      // The feed cursor can return already-seen posts; keep going until
      // something new lands or the feed ends.
      for (let attempt = 0; attempt <= MAX_EMPTY_RETRIES; attempt += 1) {
        const page = await fetchRef.current(cursor);
        cachePosts(page.posts);
        const seen = new Set(list.map((p) => p.id));
        const fresh = page.posts.filter((p) => !seen.has(p.id));
        list = [...list, ...fresh];
        cursor = page.nextCursor;
        if (fresh.length > 0 || cursor === null) break;
      }
      s.posts = list;
      s.nextCursor = cursor;
      setPosts(list);
      setNextCursor(cursor);
      setDone(cursor === null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      s.loading = false;
      setLoading(false);
    }
  }, []);

  // Restore a still-valid session, otherwise load the first page.
  useEffect(() => {
    const s = state.current;
    s.posts = [];
    s.nextCursor = null;
    const session = getSession(storeKey);
    if (session) {
      scrollRestore.current = session.scrollY;
      s.posts = session.posts;
      s.nextCursor = session.nextCursor;
      setPosts(session.posts);
      setNextCursor(session.nextCursor);
      setDone(session.nextCursor === null);
    } else {
      setPosts([]);
      setNextCursor(null);
      setDone(false);
      void loadMore();
    }
    return () => {
      saveSession(storeKey, s.posts, s.nextCursor, window.scrollY);
    };
  }, [storeKey, loadMore]);

  useLayoutEffect(() => {
    if (scrollRestore.current !== null && posts.length > 0) {
      window.scrollTo(0, scrollRestore.current);
      scrollRestore.current = null;
    }
  }, [posts]);

  // Observe the trigger post: the one PAGE_SIZE - PREFETCH_AT from the end.
  const triggerIndex = Math.max(0, posts.length - (PAGE_SIZE - PREFETCH_AT));
  const triggerId = posts[triggerIndex]?.id;
  const observer = useRef<IntersectionObserver | null>(null);
  const attachTrigger = useCallback(
    (node: HTMLElement | null) => {
      observer.current?.disconnect();
      if (!node || done) return;
      observer.current = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      });
      observer.current.observe(node);
    },
    [done, loadMore],
  );

  return { posts, loading, done, error, triggerId, attachTrigger, loadMore };
}
