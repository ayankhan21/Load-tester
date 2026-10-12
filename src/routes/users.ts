import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { env } from "../config/env";
import type { PoolClient } from "pg";
import { getFeedReadPool, pool, withTransaction } from "../db/pool";
import {
  FEED_CACHE_TTL_MS,
  FeedResponse,
  getCachedFeed,
  invalidateUserFeeds,
  setCachedFeed,
} from "../cache/feed-cache";

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 409 });
}

async function ensureUserExists(
  userId: number,
  queryPool: Pool = pool,
): Promise<void> {
  const userResult = await queryPool.query(
    "SELECT id FROM users WHERE id = $1",
    [userId],
  );
  if (userResult.rowCount === 0) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }
}

function parsePositiveInt(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw Object.assign(new Error(`${name} must be a positive integer`), {
      statusCode: 400,
    });
  }
  return parsed;
}

// One statement updates both rows, so concurrent follows between the same
// two users lock them in the same (index) order instead of crossing.
async function adjustFollowCounters(
  client: PoolClient,
  followerId: number,
  followingId: number,
  delta: 1 | -1,
): Promise<void> {
  await client.query(
    `UPDATE users SET
       follower_count = follower_count + CASE WHEN id = $2 THEN $3::int ELSE 0 END,
       following_count = following_count + CASE WHEN id = $1 THEN $3::int ELSE 0 END
     WHERE id IN ($1, $2)`,
    [followerId, followingId, delta],
  );
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users/:userId", async (request) => {
    const params = request.params as { userId?: string };
    const query = request.query as { viewerId?: string };
    const userId = parsePositiveInt(params.userId, "userId");
    const viewerId =
      query.viewerId === undefined
        ? null
        : parsePositiveInt(query.viewerId, "viewerId");

    const result = await pool.query(
      `SELECT u.id,
              u.username,
              u.created_at AS "createdAt",
              u.post_count AS "postCount",
              u.follower_count AS "followerCount",
              u.following_count AS "followingCount",
              EXISTS (
                SELECT 1 FROM follows
                WHERE follower_id = $2::bigint AND following_id = u.id
              ) AS "isFollowing"
       FROM users u
       WHERE u.id = $1`,
      [userId, viewerId],
    );

    const row = result.rows[0];
    if (!row) {
      throw Object.assign(new Error("User not found"), { statusCode: 404 });
    }

    return {
      id: Number(row.id),
      username: row.username,
      createdAt: row.createdAt,
      postCount: Number(row.postCount),
      followerCount: Number(row.followerCount),
      followingCount: Number(row.followingCount),
      isFollowing: row.isFollowing === true,
    };
  });

  app.get("/users/:userId/posts", async (request) => {
    const params = request.params as { userId?: string };
    const query = request.query as { limit?: string; cursor?: string };
    const userId = parsePositiveInt(params.userId, "userId");
    const limit = Math.min(parsePositiveInt(query.limit ?? 20, "limit"), 100);
    const cursor =
      query.cursor === undefined
        ? null
        : parsePositiveInt(query.cursor, "cursor");

    await ensureUserExists(userId);

    const result = await pool.query(
      `SELECT p.id, p.user_id AS "userId", u.username, p.content,
              p.image_url AS "imageUrl", p.video_url AS "videoUrl", p.like_count AS "likeCount", p.created_at AS "createdAt"
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1 AND ($2::bigint IS NULL OR p.id < $2)
       ORDER BY p.id DESC
       LIMIT $3`,
      [userId, cursor, limit + 1],
    );

    const posts = result.rows.slice(0, limit).map((row) => ({
      id: Number(row.id),
      userId: Number(row.userId),
      username: row.username,
      content: row.content,
      imageUrl: row.imageUrl,
      videoUrl: row.videoUrl,
      likeCount: Number(row.likeCount),
      createdAt: row.createdAt,
    }));

    return {
      posts,
      nextCursor:
        result.rows.length > limit
          ? String(posts[posts.length - 1].id)
          : null,
    };
  });

  // Frontend home feed. Separate from /feed (which the k6 suite measures) and
  // paginated by (created_at, id) so pages never repeat or skip posts.
  app.get("/users/:userId/home-feed", async (request) => {
    const params = request.params as { userId?: string };
    const query = request.query as { limit?: string; cursor?: string };
    const userId = parsePositiveInt(params.userId, "userId");
    const limit = Math.min(parsePositiveInt(query.limit ?? 20, "limit"), 100);

    let cursorCreatedAt: string | null = null;
    let cursorId: number | null = null;
    if (query.cursor !== undefined) {
      const [createdAt, id] = Buffer.from(query.cursor, "base64url")
        .toString("utf8")
        .split("|");
      cursorId = Number(id);
      if (
        !createdAt ||
        Number.isNaN(Date.parse(createdAt)) ||
        !Number.isInteger(cursorId) ||
        cursorId <= 0
      ) {
        throw Object.assign(new Error("cursor is invalid"), {
          statusCode: 400,
        });
      }
      cursorCreatedAt = createdAt;
    }

    await ensureUserExists(userId);

    // created_at::text keeps microsecond precision, which a JS Date would lose.
    const result = await pool.query(
      `SELECT p.id, p.user_id AS "userId", u.username, p.content,
              p.image_url AS "imageUrl", p.video_url AS "videoUrl", p.like_count AS "likeCount",
              p.created_at AS "createdAt", p.created_at::text AS "createdAtText"
       FROM posts p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
         AND ($2::timestamptz IS NULL OR (p.created_at, p.id) < ($2::timestamptz, $3::bigint))
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $4`,
      [userId, cursorCreatedAt, cursorId, limit + 1],
    );

    const page = result.rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      posts: page.map((row) => ({
        id: Number(row.id),
        userId: Number(row.userId),
        username: row.username,
        content: row.content,
        imageUrl: row.imageUrl,
      videoUrl: row.videoUrl,
      likeCount: Number(row.likeCount),
        createdAt: row.createdAt,
      })),
      nextCursor:
        result.rows.length > limit && last
          ? Buffer.from(`${last.createdAtText}|${last.id}`).toString(
              "base64url",
            )
          : null,
    };
  });

  app.get("/users/:userId/feed", async (request, reply) => {
    const routeParams = request.params as { userId?: string };
    const query = request.query as { limit?: string; cursor?: string };
    const userId = Number(routeParams.userId);
    const limitRaw = Number(query.limit ?? 20);
    const cursorRaw = query.cursor === undefined ? null : Number(query.cursor);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw Object.assign(new Error("userId must be a positive integer"), {
        statusCode: 400,
      });
    }

    if (!Number.isInteger(limitRaw) || limitRaw <= 0) {
      throw Object.assign(new Error("limit must be a positive integer"), {
        statusCode: 400,
      });
    }

    if (
      cursorRaw !== null &&
      (!Number.isInteger(cursorRaw) || cursorRaw <= 0)
    ) {
      throw Object.assign(new Error("cursor must be a positive integer"), {
        statusCode: 400,
      });
    }

    const pageLimit = Math.min(limitRaw, 100);
    const cacheKey = `feed:${userId}:limit=${pageLimit}:cursor=${cursorRaw ?? "first"}`;
    const { pool: feedPool, source } = getFeedReadPool();
    const cachedFeed = getCachedFeed(cacheKey, env.feedCacheTtlMs);
    reply.header("x-feed-source", source);
    if (cachedFeed !== undefined) {
      reply.header("x-feed-cache", "HIT");
      return cachedFeed;
    }

    reply.header("x-feed-cache", env.feedCacheTtlMs > 0 ? "MISS" : "BYPASS");
    await ensureUserExists(userId, feedPool);

    const followingResult = await feedPool.query(
      "SELECT following_id FROM follows WHERE follower_id = $1 ORDER BY following_id ASC",
      [userId],
    );

    const followingIds = followingResult.rows.map((row) =>
      Number(row.following_id),
    );

    if (followingIds.length === 0) {
      const emptyFeed: FeedResponse = { posts: [], nextCursor: null };
      setCachedFeed(cacheKey, emptyFeed, env.feedCacheTtlMs);
      return emptyFeed;
    }

    const queryParameters: unknown[] = [followingIds];
    let queryText = `
      SELECT p.id, p.user_id AS "userId", u.username, p.content, p.created_at AS "createdAt"
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.user_id = ANY($1::bigint[])
    `;

    if (cursorRaw !== null) {
      queryText += ` AND p.id < $2`;
      queryParameters.push(cursorRaw);
    }

    queryText += ` ORDER BY p.created_at DESC, p.id DESC LIMIT $${queryParameters.length + 1}`;
    queryParameters.push(pageLimit + 1);

    const result = await feedPool.query(queryText, queryParameters);
    const posts = result.rows.slice(0, pageLimit).map((row) => ({
      id: Number(row.id),
      userId: Number(row.userId),
      username: row.username,
      content: row.content,
      createdAt: row.createdAt,
    }));

    const nextCursor =
      result.rows.length > pageLimit
        ? String(posts[posts.length - 1]?.id ?? null)
        : null;

    const feed: FeedResponse = { posts, nextCursor };
    setCachedFeed(cacheKey, feed, env.feedCacheTtlMs);
    return feed;
  });

  app.post("/users/:userId/follow/:targetUserId", async (request, reply) => {
    const params = request.params as { userId?: string; targetUserId?: string };
    const userId = Number(params.userId);
    const targetUserId = Number(params.targetUserId);

    if (!Number.isInteger(userId) || userId <= 0) {
      throw Object.assign(new Error("userId must be a positive integer"), {
        statusCode: 400,
      });
    }

    if (!Number.isInteger(targetUserId) || targetUserId <= 0) {
      throw Object.assign(
        new Error("targetUserId must be a positive integer"),
        { statusCode: 400 },
      );
    }

    if (userId === targetUserId) {
      throw conflict("Users cannot follow themselves");
    }

    const existingUsers = await pool.query(
      "SELECT id FROM users WHERE id IN ($1, $2)",
      [userId, targetUserId],
    );

    if (existingUsers.rowCount !== 2) {
      throw Object.assign(new Error("One or more users not found"), {
        statusCode: 404,
      });
    }

    const followed = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO follows (follower_id, following_id, created_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (follower_id, following_id) DO NOTHING`,
        [userId, targetUserId],
      );
      if (result.rowCount === 0) {
        return false;
      }
      await adjustFollowCounters(client, userId, targetUserId, 1);
      return true;
    });

    if (!followed) {
      throw conflict("User is already following this user");
    }

    invalidateUserFeeds(userId);

    return reply.code(201).send({
      followerId: userId,
      followingId: targetUserId,
      message: "User followed",
    });
  });

  app.delete("/users/:userId/follow/:targetUserId", async (request) => {
    const params = request.params as { userId?: string; targetUserId?: string };
    const userId = parsePositiveInt(params.userId, "userId");
    const targetUserId = parsePositiveInt(
      params.targetUserId,
      "targetUserId",
    );

    const unfollowed = await withTransaction(async (client) => {
      const result = await client.query(
        `DELETE FROM follows
         WHERE follower_id = $1 AND following_id = $2`,
        [userId, targetUserId],
      );
      if (result.rowCount === 0) {
        return false;
      }
      await adjustFollowCounters(client, userId, targetUserId, -1);
      return true;
    });

    if (!unfollowed) {
      throw Object.assign(new Error("User is not following this user"), {
        statusCode: 404,
      });
    }

    invalidateUserFeeds(userId);

    return {
      followerId: userId,
      followingId: targetUserId,
      message: "User unfollowed",
    };
  });
}
