export type Post = {
  id: number;
  userId: number;
  username: string;
  content: string;
  imageUrl: string | null;
  videoUrl: string | null;
  likeCount: number;
  createdAt: string;
};

export type PostPage = { posts: Post[]; nextCursor: string | null };

export type Profile = {
  id: number;
  username: string;
  createdAt: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
};

export const PAGE_SIZE = 20;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? response.statusText);
  }
  return body as T;
}

function pageQuery(cursor: string | null): string {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

export const api = {
  getFeed: (viewerId: number, cursor: string | null) =>
    request<PostPage>(`/users/${viewerId}/home-feed?${pageQuery(cursor)}`),

  getUserPosts: (userId: number, cursor: string | null) =>
    request<PostPage>(`/users/${userId}/posts?${pageQuery(cursor)}`),

  getProfile: (userId: number, viewerId: number) =>
    request<Profile>(`/users/${userId}?viewerId=${viewerId}`),

  follow: (viewerId: number, targetId: number) =>
    request<unknown>(`/users/${viewerId}/follow/${targetId}`, {
      method: "POST",
    }),

  unfollow: (viewerId: number, targetId: number) =>
    request<unknown>(`/users/${viewerId}/follow/${targetId}`, {
      method: "DELETE",
    }),

  like: (postId: number, userId: number) =>
    request<unknown>(`/posts/${postId}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId }),
    }),
};
