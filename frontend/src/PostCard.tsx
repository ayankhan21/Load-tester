import { useState } from "react";
import type { Post } from "./api";
import { AutoPlayVideo } from "./AutoPlayVideo";

type Props = {
  post: Post;
  liked: boolean;
  onLike: () => Promise<void>;
  linkAuthor: boolean;
  triggerRef?: (node: HTMLElement | null) => void;
};

export function PostCard({ post, liked, onLike, linkAuthor, triggerRef }: Props) {
  const [busy, setBusy] = useState(false);

  const handleLike = async () => {
    setBusy(true);
    try {
      await onLike();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not like post");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="post" ref={triggerRef}>
      <header>
        {linkAuthor ? (
          <a className="author" href={`#/users/${post.userId}`}>
            @{post.username}
          </a>
        ) : (
          <span className="author">@{post.username}</span>
        )}
        <time dateTime={post.createdAt}>
          {new Date(post.createdAt).toLocaleString()}
        </time>
      </header>
      <p>{post.content}</p>
      {post.imageUrl && (
        <img
          className="post-media"
          src={post.imageUrl}
          alt=""
          width={800}
          height={600}
          loading="lazy"
        />
      )}
      {post.videoUrl && <AutoPlayVideo src={post.videoUrl} />}
      <footer>
        <button
          className={liked ? "liked" : ""}
          disabled={liked || busy}
          onClick={handleLike}
        >
          {liked ? "♥ Liked" : "♡ Like"}
        </button>
      </footer>
    </article>
  );
}
