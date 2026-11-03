import { createWriteBehindBuffer } from "../buffer/write-behind-buffer";
import type { BufferStats, EnqueueResult } from "../buffer/write-behind-buffer";
import { env } from "../config/env";
import { pool } from "../db/pool";

type PendingLike = { userId: number; postId: number };

// One statement: insert the likes that don't exist yet (skipping missing
// users/posts), then add the number actually inserted to each post's counter.
const FLUSH_SQL = `
  WITH input AS (
    SELECT * FROM unnest($1::bigint[], $2::bigint[]) AS t(user_id, post_id)
  ),
  inserted AS (
    INSERT INTO likes (user_id, post_id, created_at)
    SELECT i.user_id, i.post_id, NOW()
    FROM input i
    JOIN users u ON u.id = i.user_id
    JOIN posts p ON p.id = i.post_id
    ON CONFLICT (user_id, post_id) DO NOTHING
    RETURNING post_id
  ),
  counts AS (
    SELECT post_id, COUNT(*)::int AS n FROM inserted GROUP BY post_id
  )
  UPDATE posts
  SET like_count = posts.like_count + counts.n
  FROM counts
  WHERE posts.id = counts.post_id
  RETURNING counts.n AS n`;

const likeBuffer = createWriteBehindBuffer<PendingLike>({
  name: "like",
  batchSize: env.likeBatchSize,
  flushIntervalMs: env.likeFlushIntervalMs,
  cap: env.likeBufferCap,
  keyOf: (like) => `${like.userId}:${like.postId}`,
  write: async (batch) => {
    const result = await pool.query<{ n: number }>(FLUSH_SQL, [
      batch.map((like) => like.userId),
      batch.map((like) => like.postId),
    ]);
    return result.rows.reduce((sum, row) => sum + row.n, 0);
  },
});

export type { EnqueueResult, BufferStats as LikeBufferStats };

export function enqueueLike(userId: number, postId: number): EnqueueResult {
  return likeBuffer.enqueue({ userId, postId });
}

export const shutdownLikeBuffer = likeBuffer.shutdown;
export const getLikeBufferStats = likeBuffer.getStats;
