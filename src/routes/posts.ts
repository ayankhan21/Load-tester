import type { FastifyInstance } from "fastify";
import { enqueueLike } from "../likes/like-buffer";
import { pool, withTransaction } from "../db/pool";

async function ensureUserExists(userId: number): Promise<void> {
  const userResult = await pool.query("SELECT id FROM users WHERE id = $1", [
    userId,
  ]);
  if (userResult.rowCount === 0) {
    throw Object.assign(new Error("User not found"), { statusCode: 404 });
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

    const post = await withTransaction(async (client) => {
      const result = await client.query(
        `INSERT INTO posts (user_id, content, created_at)
         VALUES ($1, $2, NOW())
         RETURNING id, user_id AS "userId", content, created_at AS "createdAt"`,
        [userId, content],
      );
      await client.query(
        "UPDATE users SET post_count = post_count + 1 WHERE id = $1",
        [userId],
      );
      return result.rows[0];
    });

    return reply.code(201).send(post);
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

    // Write-behind: the like is written to Postgres later in a batch. Missing
    // users/posts and duplicate likes are skipped at flush time, not rejected.
    if (enqueueLike(userId, postId) === "full") {
      return reply
        .code(503)
        .header("retry-after", "1")
        .send({ error: "Like buffer is full, retry shortly" });
    }

    return reply.code(202).send({
      userId,
      postId,
      message: "Like accepted",
    });
  });
}
