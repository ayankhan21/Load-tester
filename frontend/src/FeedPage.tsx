import { api } from "./api";
import { PostList } from "./PostList";

export function FeedPage({ viewerId }: { viewerId: number }) {
  return (
    <>
      <h1>Your feed</h1>
      <PostList
        storeKey={`feed:${viewerId}`}
        viewerId={viewerId}
        fetchPage={(cursor) => api.getFeed(viewerId, cursor)}
        emptyText="Nothing here yet. Follow someone to fill your feed."
        linkAuthor
      />
    </>
  );
}
