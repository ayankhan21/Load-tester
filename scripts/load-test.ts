import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadavg } from "node:os";

type HttpMethod = "GET" | "POST";

type Scenario = {
  name: string;
  method?: HttpMethod;
  path?: string;
  description: string;
};

type BenchmarkResult = {
  scenario: string;
  description: string;
  concurrency: number;
  requests: number;
  success: number;
  failed: number;
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  throughputRps: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuPercent: number;
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  loadAvg1m: number;
  loadAvg5m: number;
  loadAvg15m: number;
  statusCounts: string;
  durationMs: number;
};

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const scenarioFilter = process.argv[2]?.toLowerCase();

const USER_COUNT = 5_000;
const POST_COUNT = 50_000;

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickUserId(): number {
  return randomInt(1, USER_COUNT);
}

function pickPostId(): number {
  return randomInt(1, POST_COUNT);
}

function pickFollowPair(): [number, number] {
  const sourceUserId = pickUserId();
  let targetUserId = pickUserId();
  while (targetUserId === sourceUserId) {
    targetUserId = pickUserId();
  }
  return [sourceUserId, targetUserId];
}

function buildRequest(scenario: Scenario): {
  method: HttpMethod;
  path: string;
  body?: string;
} {
  switch (scenario.name) {
    case "feed": {
      const userId = pickUserId();
      return {
        method: "GET",
        path: `/users/${userId}/feed?limit=20`,
      };
    }
    case "post": {
      const userId = pickUserId();
      return {
        method: "POST",
        path: "/posts",
        body: JSON.stringify({
          userId,
          content: `Load-test post ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`,
        }),
      };
    }
    case "like": {
      const userId = pickUserId();
      const postId = pickPostId();
      return {
        method: "POST",
        path: `/posts/${postId}/like`,
        body: JSON.stringify({ userId }),
      };
    }
    case "follow": {
      const [sourceUserId, targetUserId] = pickFollowPair();
      return {
        method: "POST",
        path: `/users/${sourceUserId}/follow/${targetUserId}`,
      };
    }
    case "social-mix": {
      const roll = Math.random();
      if (roll < 0.45) {
        const userId = pickUserId();
        return { method: "GET", path: `/users/${userId}/feed?limit=20` };
      }
      if (roll < 0.7) {
        const userId = pickUserId();
        return {
          method: "POST",
          path: "/posts",
          body: JSON.stringify({
            userId,
            content: `Mixed workload check ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`,
          }),
        };
      }
      if (roll < 0.9) {
        const userId = pickUserId();
        const postId = pickPostId();
        return {
          method: "POST",
          path: `/posts/${postId}/like`,
          body: JSON.stringify({ userId }),
        };
      }
      const [sourceUserId, targetUserId] = pickFollowPair();
      return {
        method: "POST",
        path: `/users/${sourceUserId}/follow/${targetUserId}`,
      };
    }
    default:
      return {
        method: "GET",
        path: "/health",
      };
  }
}

const scenarios: Scenario[] = [
  {
    name: "feed",
    description: "Read the user feed for real social content",
  },
  {
    name: "post",
    description: "Create new posts to simulate publishing activity",
  },
  {
    name: "like",
    description: "Like a post to simulate engagement",
  },
  {
    name: "follow",
    description: "Follow a user to simulate social graph updates",
  },
  {
    name: "social-mix",
    description:
      "Mixed realistic workload: feed, create post, like, and follow",
  },
];

const selectedScenarios =
  scenarioFilter && scenarioFilter !== "all"
    ? scenarios.filter((scenario) => scenario.name === scenarioFilter)
    : scenarios;

if (selectedScenarios.length === 0) {
  console.error(
    `Unknown scenario: ${scenarioFilter}. Available: ${scenarios.map((s) => s.name).join(", ")}`,
  );
  process.exit(1);
}

function formatResultLine(result: BenchmarkResult): string {
  return [
    `timestamp=${new Date().toISOString()}`,
    `scenario=${result.scenario}`,
    `description=${result.description}`,
    `concurrency=${result.concurrency}`,
    `requests=${result.requests}`,
    `success=${result.success}`,
    `failed=${result.failed}`,
    `avgMs=${result.averageMs.toFixed(2)}`,
    `p50Ms=${result.p50Ms.toFixed(2)}`,
    `p95Ms=${result.p95Ms.toFixed(2)}`,
    `maxMs=${result.maxMs.toFixed(2)}`,
    `throughputRps=${result.throughputRps.toFixed(2)}`,
    `cpuUserMs=${result.cpuUserMs.toFixed(2)}`,
    `cpuSystemMs=${result.cpuSystemMs.toFixed(2)}`,
    `cpuPercent=${result.cpuPercent.toFixed(2)}`,
    `rssMb=${result.rssMb.toFixed(2)}`,
    `heapUsedMb=${result.heapUsedMb.toFixed(2)}`,
    `heapTotalMb=${result.heapTotalMb.toFixed(2)}`,
    `loadAvg1m=${result.loadAvg1m.toFixed(2)}`,
    `statusCounts=${result.statusCounts}`,
    `runDurationMs=${result.durationMs.toFixed(2)}`,
    "---",
  ].join(" | ");
}

async function runScenario(
  scenario: Scenario,
  concurrency: number,
): Promise<BenchmarkResult> {
  const requestCountPerWorker = 20;
  const totalRequests = concurrency * requestCountPerWorker;
  const latencies: number[] = [];
  const statusCounts = new Map<number, number>();

  const cpuUsageBefore = process.cpuUsage();
  const startedAt = performance.now();
  let successCount = 0;
  let failedCount = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    for (let i = 0; i < requestCountPerWorker; i += 1) {
      const requestStartedAt = performance.now();
      const request = buildRequest(scenario);

      try {
        const response = await fetch(`${baseUrl}${request.path}`, {
          method: request.method,
          headers: {
            "content-type": "application/json",
          },
          body: request.body,
        });

        const latencyMs = performance.now() - requestStartedAt;
        latencies.push(latencyMs);

        const nextValue = (statusCounts.get(response.status) ?? 0) + 1;
        statusCounts.set(response.status, nextValue);

        if (response.ok) {
          successCount += 1;
        } else {
          failedCount += 1;
        }
      } catch (error) {
        const latencyMs = performance.now() - requestStartedAt;
        latencies.push(latencyMs);
        failedCount += 1;
      }
    }
  });

  await Promise.all(workers);

  const durationMs = performance.now() - startedAt;
  const averageMs =
    latencies.length === 0
      ? 0
      : latencies.reduce((sum, value) => sum + value, 0) / latencies.length;

  const sortedLatencies = [...latencies].sort((a, b) => a - b);
  const p50Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.5) - 1);
  const p95Index = Math.max(0, Math.ceil(sortedLatencies.length * 0.95) - 1);
  const p50Ms = sortedLatencies[p50Index] ?? 0;
  const p95Ms = sortedLatencies[p95Index] ?? 0;
  const maxMs = sortedLatencies[sortedLatencies.length - 1] ?? 0;

  const statusSummary =
    Array.from(statusCounts.entries())
      .map(([status, count]) => `${status}:${count}`)
      .join(", ") || "none";

  const throughputRps =
    durationMs > 0 ? totalRequests / (durationMs / 1000) : 0;
  const cpuUsageAfter = process.cpuUsage(cpuUsageBefore);
  const memoryAfter = process.memoryUsage();
  const loadAverages = loadavg();
  const cpuPercent =
    durationMs > 0
      ? ((cpuUsageAfter.user + cpuUsageAfter.system) / (durationMs * 1000)) *
        100
      : 0;

  return {
    scenario: scenario.name,
    description: scenario.description,
    concurrency,
    requests: totalRequests,
    success: successCount,
    failed: failedCount,
    averageMs,
    p50Ms,
    p95Ms,
    maxMs,
    throughputRps,
    cpuUserMs: cpuUsageAfter.user / 1000,
    cpuSystemMs: cpuUsageAfter.system / 1000,
    cpuPercent,
    rssMb: memoryAfter.rss / (1024 * 1024),
    heapUsedMb: memoryAfter.heapUsed / (1024 * 1024),
    heapTotalMb: memoryAfter.heapTotal / (1024 * 1024),
    loadAvg1m: loadAverages[0],
    loadAvg5m: loadAverages[1],
    loadAvg15m: loadAverages[2],
    statusCounts: statusSummary,
    durationMs,
  };
}

async function main(): Promise<void> {
  const concurrencyLevels = [10, 25, 50, 100, 150, 200, 300, 500];
  const outputLines: string[] = ["Benchmark run using real social API actions"];
  const allResults: BenchmarkResult[] = [];

  for (const scenario of selectedScenarios) {
    outputLines.push(`\nScenario: ${scenario.name} - ${scenario.description}`);

    for (const concurrency of concurrencyLevels) {
      const result = await runScenario(scenario, concurrency);
      allResults.push(result);
      outputLines.push(formatResultLine(result));
    }
  }

  const summaryLines = ["\nSummary by scenario and max throughput"];
  for (const scenario of selectedScenarios) {
    const scenarioResults = allResults.filter(
      (result) => result.scenario === scenario.name,
    );
    const best = scenarioResults.reduce((bestResult, result) =>
      result.throughputRps > bestResult.throughputRps ? result : bestResult,
    );

    summaryLines.push(
      `${scenario.name}: best concurrency=${best.concurrency}, throughput=${best.throughputRps.toFixed(2)} rps, avg=${best.averageMs.toFixed(2)} ms, p50=${best.p50Ms.toFixed(2)} ms, p95=${best.p95Ms.toFixed(2)} ms, runDurationMs=${best.durationMs.toFixed(2)}`,
    );
  }

  outputLines.push(...summaryLines);
  const output = `${outputLines.join("\n")}\n`;
  const outputPath = join(process.cwd(), "loop-metrics.txt");
  writeFileSync(outputPath, output, "utf8");
  console.log(output);
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
