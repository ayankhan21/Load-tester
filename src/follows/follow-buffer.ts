import { createWriteBehindBuffer } from "../buffer/write-behind-buffer";
import type { BufferStats, EnqueueResult } from "../buffer/write-behind-buffer";
import { invalidateUserFeeds } from "../cache/feed-cache";
import { env } from "../config/env";
import { pool } from "../db/pool";

type PendingFollow = { followerId: number; followingId: number };

// One statement: insert the follows that don't exist yet (skipping missing
// users and self-follows), then add the rows actually inserted to each user's
// following_count / follower_count, one update per affected user.
const FLUSH_SQL = `
  WITH input AS (
    SELECT * FROM unnest($1::bigint[], $2::bigint[]) AS t(follower_id, following_id)
  ),
  inserted AS (
    INSERT INTO follows (follower_id, following_id, created_at)
    SELECT i.follower_id, i.following_id, NOW()
    FROM input i
    JOIN users a ON a.id = i.follower_id
    JOIN users b ON b.id = i.following_id
    WHERE i.follower_id <> i.following_id
    ON CONFLICT (follower_id, following_id) DO NOTHING
    RETURNING follower_id, following_id
  ),
  deltas AS (
    SELECT follower_id AS user_id, COUNT(*)::int AS following_delta, 0 AS follower_delta
    FROM inserted GROUP BY follower_id
    UNION ALL
    SELECT following_id, 0, COUNT(*)::int
    FROM inserted GROUP BY following_id
  ),
  sums AS (
    SELECT user_id,
           SUM(following_delta)::int AS following_delta,
           SUM(follower_delta)::int AS follower_delta
    FROM deltas GROUP BY user_id
  )
  UPDATE users
  SET following_count = users.following_count + sums.following_delta,
      follower_count = users.follower_count + sums.follower_delta
  FROM sums
  WHERE users.id = sums.user_id
  RETURNING sums.following_delta AS n`;

const followBuffer = createWriteBehindBuffer<PendingFollow>({
  name: "follow",
  batchSize: env.followBatchSize,
  flushIntervalMs: env.followFlushIntervalMs,
  cap: env.followBufferCap,
  keyOf: (follow) => `${follow.followerId}:${follow.followingId}`,
  // Each inserted follow adds exactly 1 to its follower's following_delta, so
  // summing following_delta over the updated users gives the inserted count.
  write: async (batch) => {
    const result = await pool.query<{ n: number }>(FLUSH_SQL, [
      batch.map((follow) => follow.followerId),
      batch.map((follow) => follow.followingId),
    ]);
    return result.rows.reduce((sum, row) => sum + row.n, 0);
  },
  // Same invalidation the synchronous route did, now after the batch commits.
  onWritten: (batch) => {
    for (const followerId of new Set(batch.map((f) => f.followerId))) {
      invalidateUserFeeds(followerId);
    }
  },
});

export type { EnqueueResult, BufferStats as FollowBufferStats };

export function enqueueFollow(
  followerId: number,
  followingId: number,
): EnqueueResult {
  return followBuffer.enqueue({ followerId, followingId });
}

// Drops a follow that is still waiting in the buffer (used by unfollow).
// Returns false if it isn't pending, e.g. it was already written or is being
// written right now.
export function cancelPendingFollow(
  followerId: number,
  followingId: number,
): boolean {
  return followBuffer.remove({ followerId, followingId });
}

export const shutdownFollowBuffer = followBuffer.shutdown;
export const getFollowBufferStats = followBuffer.getStats;
