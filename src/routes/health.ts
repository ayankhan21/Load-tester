import type { FastifyInstance } from "fastify";
import { getFollowBufferStats } from "../follows/follow-buffer";
import { getLikeBufferStats } from "../likes/like-buffer";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({
    status: "ok",
    // Per process: in cluster mode this is the worker that served the request.
    likeBuffer: getLikeBufferStats(),
    followBuffer: getFollowBufferStats(),
  }));
}
