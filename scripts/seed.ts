import { faker } from "@faker-js/faker";
import { pool } from "../src/db/pool";

type Config = {
  users: number;
  posts: number;
  follows: number;
  likes: number;
  seed?: number;
  mediaOnly?: boolean;
};

function parseArgs(argv: string[]): Config {
  const config: Config = {
    users: 5_000,
    posts: 50_000,
    follows: 0,
    likes: 0,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, rawValue] = arg.includes("=")
      ? arg.split("=", 2)
      : [arg, argv[i + 1]];
    const value = rawValue ?? "0";
    const option = key.replace(/^--/, "");

    if (
      option === "users" ||
      option === "posts" ||
      option === "follows" ||
      option === "likes"
    ) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid value for --${option}: ${value}`);
      }
      config[option as "users" | "posts" | "follows" | "likes"] = parsed;
      if (arg.includes("=") === false) {
        i += 1;
      }
      continue;
    }

    if (option === "media-only") {
      config.mediaOnly = true;
      continue;
    }

    if (option === "seed") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid value for --seed: ${value}`);
      }
      config.seed = parsed;
      if (arg.includes("=") === false) {
        i += 1;
      }
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
  }

  return config;
}

// URLs only, never downloaded, so the seed has no dependency on the external
// services. Half the posts are videos: even post id = video, odd id = image.
const IMAGE_URL_SQL = "'https://picsum.photos/seed/post-' || id || '/800/600'";
const VIDEO_URL_SQL = "'https://imgsrc.pub/video/640x360?text=' || id";
const MEDIA_SET_SQL = `image_url = CASE WHEN id % 2 = 1 THEN ${IMAGE_URL_SQL} END,
       video_url = CASE WHEN id % 2 = 0 THEN ${VIDEO_URL_SQL} END`;
const MEDIA_MISSING_SQL = `(id % 2 = 1 AND (image_url IS NULL OR video_url IS NOT NULL))
       OR (id % 2 = 0 AND (video_url IS NULL OR image_url IS NOT NULL))`;

function getBatchSize(target: number): number {
  if (target < 1_000) return 250;
  if (target < 10_000) return 1_000;
  if (target < 100_000) return 5_000;
  return 10_000;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function insertUsers(totalUsers: number): Promise<number[]> {
  const userIds: number[] = [];
  const batchSize = getBatchSize(totalUsers);
  let inserted = 0;

  while (inserted < totalUsers) {
    const batch = [] as Array<{ username: string; createdAt: Date }>;

    for (let i = 0; i < batchSize && inserted < totalUsers; i += 1) {
      const username = `${faker.internet
        .username()
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 18)}${inserted + i + 1}`;
      batch.push({
        username,
        createdAt: new Date(),
      });
    }

    const values = batch
      .map(
        (_, columnIndex) =>
          `($${columnIndex * 2 + 1}, $${columnIndex * 2 + 2})`,
      )
      .join(", ");

    const params = batch.flatMap((row) => [row.username, row.createdAt]);
    await pool.query(
      `INSERT INTO users (username, created_at) VALUES ${values} ON CONFLICT (username) DO NOTHING`,
      params,
    );

    const result = await pool.query(
      "SELECT id FROM users ORDER BY id DESC LIMIT $1",
      [batch.length],
    );
    userIds.push(...result.rows.map((row) => Number(row.id)));

    inserted += batch.length;
    console.log(`Users: ${Math.min(inserted, totalUsers)} / ${totalUsers}`);
  }

  return userIds;
}

async function insertPosts(
  userIds: number[],
  totalPosts: number,
): Promise<number[]> {
  const postIds: number[] = [];
  const batchSize = getBatchSize(totalPosts);
  let inserted = 0;

  while (inserted < totalPosts) {
    const batch = [] as Array<{
      userId: number;
      content: string;
      createdAt: Date;
    }>;

    for (let i = 0; i < batchSize && inserted < totalPosts; i += 1) {
      const userId = userIds[randomInt(0, userIds.length - 1)];
      const content = faker.lorem.paragraph({ min: 1, max: 3 });
      batch.push({
        userId,
        content,
        createdAt: faker.date.recent({ days: 365 }),
      });
    }

    const values = batch
      .map(
        (_, columnIndex) =>
          `($${columnIndex * 3 + 1}, $${columnIndex * 3 + 2}, $${columnIndex * 3 + 3})`,
      )
      .join(", ");

    const params = batch.flatMap((row) => [
      row.userId,
      row.content,
      row.createdAt,
    ]);
    const result = await pool.query(
      `INSERT INTO posts (user_id, content, created_at) VALUES ${values} RETURNING id`,
      params,
    );
    const batchIds = result.rows.map((row) => Number(row.id));
    await pool.query(
      `UPDATE posts SET ${MEDIA_SET_SQL} WHERE id = ANY($1::bigint[])`,
      [batchIds],
    );
    postIds.push(...batchIds);

    inserted += batch.length;
    console.log(`Posts: ${Math.min(inserted, totalPosts)} / ${totalPosts}`);
  }

  return postIds;
}

// Brings every post in line with the media rule above (e.g. posts created
// before the columns existed, or by the traffic tests). Idempotent; runs in id
// ranges so it never holds one huge update.
async function backfillMedia(): Promise<void> {
  const bounds = await pool.query(
    `SELECT MIN(id) AS lo, MAX(id) AS hi FROM posts WHERE ${MEDIA_MISSING_SQL}`,
  );
  if (bounds.rows[0].lo === null) {
    return;
  }

  const step = 50_000;
  const hi = Number(bounds.rows[0].hi);
  let filled = 0;
  for (let lo = Number(bounds.rows[0].lo); lo <= hi; lo += step) {
    const result = await pool.query(
      `UPDATE posts SET ${MEDIA_SET_SQL}
       WHERE id >= $1 AND id < $2 AND (${MEDIA_MISSING_SQL})`,
      [lo, lo + step],
    );
    filled += result.rowCount ?? 0;
    console.log(`Post media backfilled: ${filled}`);
  }
}

async function insertRelationships(
  kind: "follows" | "likes",
  totalTarget: number,
  userIds: number[],
  postIds: number[] = [],
): Promise<void> {
  const batchSize = getBatchSize(totalTarget);
  let inserted = 0;

  while (inserted < totalTarget) {
    const rows: Array<number[]> = [];

    for (let i = 0; i < batchSize && inserted < totalTarget; i += 1) {
      if (kind === "follows") {
        const followerId = userIds[randomInt(0, userIds.length - 1)];
        const followingId = userIds[randomInt(0, userIds.length - 1)];
        if (followerId === followingId) {
          continue;
        }
        rows.push([followerId, followingId]);
      } else {
        const userId = userIds[randomInt(0, userIds.length - 1)];
        const postId = postIds[randomInt(0, postIds.length - 1)];
        rows.push([userId, postId]);
      }
      inserted += 1;
    }

    if (rows.length === 0) {
      continue;
    }

    if (kind === "follows") {
      const values = rows
        .map(
          (_, columnIndex) =>
            `($${columnIndex * 2 + 1}, $${columnIndex * 2 + 2}, NOW())`,
        )
        .join(", ");
      const params = rows.flatMap((row) => [row[0], row[1]]);
      await pool.query(
        `INSERT INTO follows (follower_id, following_id, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
        params,
      );
    } else {
      const values = rows
        .map(
          (_, columnIndex) =>
            `($${columnIndex * 2 + 1}, $${columnIndex * 2 + 2}, NOW())`,
        )
        .join(", ");
      const params = rows.flatMap((row) => [row[0], row[1]]);
      await pool.query(
        `INSERT INTO likes (user_id, post_id, created_at) VALUES ${values} ON CONFLICT DO NOTHING`,
        params,
      );
    }

    console.log(
      `${kind[0].toUpperCase()}${kind.slice(1)}: ${Math.min(inserted, totalTarget)} / ${totalTarget}`,
    );
  }
}

async function getCount(
  tableName: "follows" | "likes" | "posts" | "users",
): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM ${tableName}`,
  );
  return Number(result.rows[0].count);
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  if (config.seed !== undefined) {
    faker.seed(config.seed);
  }

  const defaults: Required<Omit<Config, "seed" | "mediaOnly">> = {
    users: 5_000,
    posts: 50_000,
    follows: 0,
    likes: 0,
  };

  if (config.mediaOnly) {
    await backfillMedia();
    console.log("Media-only run complete; no users, posts, follows or likes added.");
    return;
  }

  if (config.follows === 0) {
    config.follows = Math.max(100_000, Math.round(config.users * 20));
  }
  if (config.likes === 0) {
    config.likes = Math.max(150_000, Math.round(config.posts * 5));
  }

  const start = Date.now();
  console.log(
    `Seed started with ${config.users} users and ${config.posts} posts.`,
  );

  const userIds = await insertUsers(config.users);
  const postIds = await insertPosts(userIds, config.posts);
  await backfillMedia();
  await insertRelationships("follows", config.follows, userIds);
  await insertRelationships("likes", config.likes, userIds, postIds);

  const usersCount = await getCount("users");
  const postsCount = await getCount("posts");
  const followsCount = await getCount("follows");
  const likesCount = await getCount("likes");

  const durationSeconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log("\nSeed completed.");
  console.log(`Users: ${usersCount}`);
  console.log(`Posts: ${postsCount}`);
  console.log(`Follows: ${followsCount}`);
  console.log(`Likes: ${likesCount}`);
  console.log(`Duration: ${durationSeconds} seconds`);
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error("Seed failed:", error);
    process.exit(1);
  });
