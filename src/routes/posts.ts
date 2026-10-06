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

async function ensurePostExists(postId: number): Promise<void> {
  const postResult = await pool.query("SELECT id FROM posts WHERE id = $1", [
    postId,
  ]);
  if (postResult.rowCount === 0) {
    throw Object.assign(new Error("Post not found"), { statusCode: 404 });
  }
}

export async function postsRoutes(app: FastifyInstance): Promise<void> {
  app.post("/posts", async (request, reply) => {
    const body = request.body as { userId?: number; content?: string };
    const userId = Number(body.userId);
    const content = (body.content ?? "").trim();

    if (!Number.isInteger(userId) || userId <= 0) {
      throw Object.assign(new Error("userId must be a positive integer"), {
        statusCode: 400,
      });
    }

    if (!content) {
      throw Object.assign(new Error("content is required"), {
        statusCode: 400,
      });
    }

    await ensureUserExists(userId);

    const result = await pool.query(
      `INSERT INTO posts (user_id, content, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id, user_id AS "userId", content, created_at AS "createdAt"`,
      [userId, content],
    );

    return reply.code(201).send(result.rows[0]);
  });

  app.post("/posts/:postId/like", async (request, reply) => {
    const params = request.params as { postId?: string };
    const body = request.body as { userId?: number };
    const postId = Number(params.postId);
    const userId = Number(body.userId);

    if (!Number.isInteger(postId) || postId <= 0) {
      throw Object.assign(new Error("postId must be a positive integer"), {
        statusCode: 400,
      });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      throw Object.assign(new Error("userId must be a positive integer"), {
        statusCode: 400,
      });
    }

    await ensurePostExists(postId);
    await ensureUserExists(userId);

    const result = await pool.query(
      `INSERT INTO likes (user_id, post_id, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id, post_id) DO NOTHING
       RETURNING user_id AS "userId", post_id AS "postId"`,
      [userId, postId],
    );

    if (result.rowCount === 0) {
      throw conflict("User already liked this post");
    }

    return reply.code(201).send({
      userId,
      postId,
      message: "Post liked",
    });
  });
}
