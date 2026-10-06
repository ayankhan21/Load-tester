import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { loadavg } from "node:os";

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const args = process.argv.slice(2);

function getArgValue(flag: string): string | undefined {
  const directMatch = args.find((arg) => arg.startsWith(`${flag}=`));
  if (directMatch) {
    return directMatch.split("=")[1];
  }

  const index = args.findIndex((arg) => arg === flag);
  if (index >= 0 && index + 1 < args.length) {
    return args[index + 1];
  }

  return undefined;
}

const durationMs = Number(getArgValue("--duration") ?? "30000");
const vus = Number(getArgValue("--vus") ?? "20");
const thinkMinMs = Number(getArgValue("--thinkMin") ?? "250");
const thinkMaxMs = Number(getArgValue("--thinkMax") ?? "1500");

const USER_COUNT = 5_000;
const POST_COUNT = 50_000;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickUserId(): number {
  return randomInt(1, USER_COUNT);
}

function pickPostId(): number {
  return randomInt(1, POST_COUNT);
}

function pickFollowPair(): [number, number] {
  const source = pickUserId();
  let target = pickUserId();
  while (target === source) {
    target = pickUserId();
  }
  return [source, target];
}

function pickAction(): {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
} {
  const roll = Math.random();

  if (roll < 0.55) {
    const userId = pickUserId();
    return {
      name: "feed",
      method: "GET",
      path: `/users/${userId}/feed?limit=20`,
    };
  }

  if (roll < 0.8) {
    const userId = pickUserId();
    return {
      name: "post",
      method: "POST",
      path: "/posts",
      body: JSON.stringify({
        userId,
        content: `Traffic mix ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`,
      }),
    };
  }

  if (roll < 0.92) {
    const userId = pickUserId();
    const postId = pickPostId();
    return {
      name: "like",
      method: "POST",
      path: `/posts/${postId}/like`,
      body: JSON.stringify({ userId }),
    };
  }

  const [sourceUserId, targetUserId] = pickFollowPair();
  return {
    name: "follow",
    method: "POST",
    path: `/users/${sourceUserId}/follow/${targetUserId}`,
  };
}

async function runOneRequest(action: {
  name: string;
  method: "GET" | "POST";
  path: string;
  body?: string;
}): Promise<{ status: number; latencyMs: number; ok: boolean }> {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${action.path}`, {
    method: action.method,
    headers: {
      "content-type": "application/json",
    },
    body: action.body,
  });

  const latencyMs = performance.now() - startedAt;
  return {
    status: response.status,
    latencyMs,
    ok: response.ok,
  };
}

async function runVirtualUser(
  stopAt: number,
  latencies: number[],
  statusCounts: Map<number, number>,
  actionCounts: Map<string, number>,
): Promise<void> {
  while (Date.now() < stopAt) {
    const action = pickAction();
    const actionName = action.name;
    const delayMs = randomBetween(thinkMinMs, thinkMaxMs);

    try {
      const result = await runOneRequest(action);
      latencies.push(result.latencyMs);
      const nextStatusCount = (statusCounts.get(result.status) ?? 0) + 1;
      statusCounts.set(result.status, nextStatusCount);
      actionCounts.set(actionName, (actionCounts.get(actionName) ?? 0) + 1);

      if (result.ok) {
        // success is counted in the summary after all workers finish
      }
    } catch {
      const failedStatus = 0;
      const nextStatusCount = (statusCounts.get(failedStatus) ?? 0) + 1;
      statusCounts.set(failedStatus, nextStatusCount);
      actionCounts.set(actionName, (actionCounts.get(actionName) ?? 0) + 1);
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

async function main(): Promise<void> {
  const effectiveDurationMs =
    Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 30000;
  const effectiveVus = Number.isFinite(vus) && vus > 0 ? vus : 20;
  const stopAt = Date.now() + effectiveDurationMs;

  const latencies: number[] = [];
  const statusCounts = new Map<number, number>();
  const actionCounts = new Map<string, number>();

  const cpuBefore = process.cpuUsage();
  const startTime = performance.now();

  const workers = Array.from({ length: effectiveVus }, () =>
    runVirtualUser(stopAt, latencies, statusCounts, actionCounts),
  );
  await Promise.all(workers);

  const elapsedMs = performance.now() - startTime;
  const totalRequests = latencies.length;
  const statusSummary =
    Array.from(statusCounts.entries())
      .map(([status, count]) => `${status}:${count}`)
      .join(", ") || "none";
  const actionSummary =
    Array.from(actionCounts.entries())
      .map(([name, count]) => `${name}:${count}`)
      .join(", ") || "none";

  const successCount = Array.from(statusCounts.entries())
    .filter(([status]) => status >= 200 && status < 400)
    .reduce((sum, [, count]) => sum + count, 0);
  const failedCount = totalRequests - successCount;

  const summary = {
    durationMs: effectiveDurationMs,
    vus: effectiveVus,
    totalRequests,
    success: successCount,
    failed: failedCount,
    throughputRps: totalRequests > 0 ? totalRequests / (elapsedMs / 1000) : 0,
    averageMs:
      totalRequests > 0
        ? latencies.reduce((sum, value) => sum + value, 0) / totalRequests
        : 0,
    p50Ms: 0,
    p95Ms: 0,
    maxMs: 0,
    cpuUserMs: 0,
    cpuSystemMs: 0,
    cpuPercent: 0,
    rssMb: 0,
    heapUsedMb: 0,
    heapTotalMb: 0,
    loadAvg1m: 0,
    loadAvg5m: 0,
    loadAvg15m: 0,
    statusCounts: statusSummary,
    actionMix: actionSummary,
  };

  if (latencies.length > 0) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const p50Index = Math.max(0, Math.ceil(sorted.length * 0.5) - 1);
    const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
    summary.p50Ms = sorted[p50Index] ?? 0;
    summary.p95Ms = sorted[p95Index] ?? 0;
    summary.maxMs = sorted[sorted.length - 1] ?? 0;
  }

  const cpuAfter = process.cpuUsage(cpuBefore);
  const memoryAfter = process.memoryUsage();
  const averages = loadavg();

  summary.cpuUserMs = cpuAfter.user / 1000;
  summary.cpuSystemMs = cpuAfter.system / 1000;
  summary.cpuPercent =
    elapsedMs > 0
      ? ((cpuAfter.user + cpuAfter.system) / (elapsedMs * 1000)) * 100
      : 0;
  summary.rssMb = memoryAfter.rss / (1024 * 1024);
  summary.heapUsedMb = memoryAfter.heapUsed / (1024 * 1024);
  summary.heapTotalMb = memoryAfter.heapTotal / (1024 * 1024);
  summary.loadAvg1m = averages[0];
  summary.loadAvg5m = averages[1];
  summary.loadAvg15m = averages[2];

  const outputPath = join(process.cwd(), "traffic-metrics.txt");
  const report = [
    "Natural-flow traffic benchmark",
    `durationMs=${effectiveDurationMs}`,
    `vus=${effectiveVus}`,
    `throughputRps=${summary.throughputRps.toFixed(2)}`,
    `avgMs=${summary.averageMs.toFixed(2)}`,
    `p50Ms=${summary.p50Ms.toFixed(2)}`,
    `p95Ms=${summary.p95Ms.toFixed(2)}`,
    `maxMs=${summary.maxMs.toFixed(2)}`,
    `success=${summary.success}`,
    `failed=${summary.failed}`,
    `statusCounts=${summary.statusCounts}`,
    `actionMix=${summary.actionMix}`,
    `cpuUserMs=${summary.cpuUserMs.toFixed(2)}`,
    `cpuSystemMs=${summary.cpuSystemMs.toFixed(2)}`,
    `cpuPercent=${summary.cpuPercent.toFixed(2)}`,
    `rssMb=${summary.rssMb.toFixed(2)}`,
    `heapUsedMb=${summary.heapUsedMb.toFixed(2)}`,
    `heapTotalMb=${summary.heapTotalMb.toFixed(2)}`,
    `loadAvg1m=${summary.loadAvg1m.toFixed(2)}`,
    `loadAvg5m=${summary.loadAvg5m.toFixed(2)}`,
    `loadAvg15m=${summary.loadAvg15m.toFixed(2)}`,
    "",
  ].join("\n");

  appendFileSync(outputPath, `\n${report}`, "utf8");
  console.log(report);
}

main().catch((error) => {
  console.error("Natural-flow traffic test failed:", error);
  process.exit(1);
});
