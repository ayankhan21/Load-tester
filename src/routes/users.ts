import type { FastifyInstance } from "fastify";
import { pool } from "../db/pool";

function conflict(message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode: 409 });
}

async function ensureUserExists(userId: number): Promise<void> {
  const userResult = await pool.query("SELECT id FROM users WHERE id = $1", [
    userId,
  ]);
  if (userResult.rowCount === 0) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
  }
}

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.get("/users/:userId/feed", async (request) => {
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

    await ensureUserExists(userId);

    const followingResult = await pool.query(
      "SELECT following_id FROM follows WHERE follower_id = $1 ORDER BY following_id ASC",
      [userId],
    );

    const followingIds = followingResult.rows.map((row) =>
      Number(row.following_id),
    );

    if (followingIds.length === 0) {
      return { posts: [], nextCursor: null };
    }

    const pageLimit = Math.min(limitRaw, 100);
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

    const result = await pool.query(queryText, queryParameters);
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

    return { posts, nextCursor };
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

    const result = await pool.query(
      `INSERT INTO follows (follower_id, following_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (follower_id, following_id) DO NOTHING
       RETURNING follower_id AS "followerId", following_id AS "followingId"`,
      [userId, targetUserId],
    );

    if (result.rowCount === 0) {
      throw conflict("User is already following this user");
    }

    return reply.code(201).send({
      followerId: userId,
      followingId: targetUserId,
      message: "User followed",
    });
  });
}
