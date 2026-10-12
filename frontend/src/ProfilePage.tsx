import { useEffect, useState } from "react";
import { api, ApiError, type Profile } from "./api";
import { dropSession } from "./postCache";
import { PostList } from "./PostList";

type Props = { viewerId: number; userId: number };

export function ProfilePage({ viewerId, userId }: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getProfile(userId, viewerId)
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  }, [userId, viewerId]);

  const toggleFollow = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      if (profile.isFollowing) {
        await api.unfollow(viewerId, userId);
      } else {
        try {
          await api.follow(viewerId, userId);
        } catch (e) {
          // 409: already following, so the state we want is already true.
          if (!(e instanceof ApiError && e.status === 409)) throw e;
        }
      }
      // The viewer's feed content changed; make the feed refetch on return.
      dropSession(`feed:${viewerId}`);
      const now = !profile.isFollowing;
      setProfile({
        ...profile,
        isFollowing: now,
        followerCount: profile.followerCount + (now ? 1 : -1),
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <>
        <p className="status error">{error}</p>
        <a href="#/">← Back to feed</a>
      </>
    );
  }
  if (!profile) return <p className="status">Loading…</p>;

  return (
    <>
      <a href="#/">← Back to feed</a>
      <section className="profile">
        <div>
          <h1>@{profile.username}</h1>
          <p className="stats">
            <strong>{profile.postCount}</strong> posts ·{" "}
            <strong>{profile.followerCount}</strong> followers ·{" "}
            <strong>{profile.followingCount}</strong> following
          </p>
        </div>
        {profile.id !== viewerId && (
          <button
            className={profile.isFollowing ? "secondary" : "primary"}
            disabled={busy}
            onClick={toggleFollow}
          >
            {profile.isFollowing ? "Unfollow" : "Follow"}
          </button>
        )}
      </section>
      <PostList
        storeKey={`profile:${userId}`}
        viewerId={viewerId}
        fetchPage={(cursor) => api.getUserPosts(userId, cursor)}
        emptyText="No posts yet."
        linkAuthor={false}
      />
    </>
  );
}
