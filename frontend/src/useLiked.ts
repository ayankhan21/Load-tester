import { useCallback, useState } from "react";

// The API has no "did I like this" read, so liked posts are remembered locally
// per viewer. A 409 from the API also marks a post as liked.
function storageKey(viewerId: number): string {
  return `liked:${viewerId}`;
}

function load(viewerId: number): Set<number> {
  try {
    const raw = localStorage.getItem(storageKey(viewerId));
    return new Set(raw ? (JSON.parse(raw) as number[]) : []);
  } catch {
    return new Set();
  }
}

export function useLiked(viewerId: number) {
  const [liked, setLiked] = useState(() => load(viewerId));

  const markLiked = useCallback(
    (postId: number) => {
      setLiked((prev) => {
        const next = new Set(prev).add(postId);
        try {
          localStorage.setItem(storageKey(viewerId), JSON.stringify([...next]));
        } catch {
          // Not persisted; still works for this session.
        }
        return next;
      });
    },
    [viewerId],
  );

  return { isLiked: (postId: number) => liked.has(postId), markLiked };
}
