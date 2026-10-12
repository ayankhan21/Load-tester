import { api, ApiError, type Post, type PostPage } from "./api";
import { PostCard } from "./PostCard";
import { useInfinitePosts } from "./useInfinitePosts";
import { useLiked } from "./useLiked";

type Props = {
  storeKey: string;
  viewerId: number;
  fetchPage: (cursor: string | null) => Promise<PostPage>;
  emptyText: string;
  linkAuthor: boolean;
};

export function PostList({
  storeKey,
  viewerId,
  fetchPage,
  emptyText,
  linkAuthor,
}: Props) {
  const { posts, loading, done, error, triggerId, attachTrigger, loadMore } =
    useInfinitePosts(storeKey, fetchPage);
  const { isLiked, markLiked } = useLiked(viewerId);

  const like = async (post: Post) => {
    try {
      await api.like(post.id, viewerId);
      markLiked(post.id);
    } catch (e) {
      // 409 means this viewer already liked it; reflect that.
      if (e instanceof ApiError && e.status === 409) markLiked(post.id);
      else throw e;
    }
  };

  return (
    <>
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          liked={isLiked(post.id)}
          onLike={() => like(post)}
          linkAuthor={linkAuthor}
          triggerRef={post.id === triggerId ? attachTrigger : undefined}
        />
      ))}
      {error && (
        <p className="status error">
          {error} <button onClick={() => void loadMore()}>Retry</button>
        </p>
      )}
      {loading && <p className="status">Loading…</p>}
      {done && posts.length === 0 && <p className="status">{emptyText}</p>}
      {done && posts.length > 0 && <p className="status">You are all caught up.</p>}
    </>
  );
}
