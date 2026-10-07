const { appendFileSync } = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { join } = require("node:path");

require("dotenv").config();

const dashboardPort = process.env.K6_WEB_DASHBOARD_PORT ?? "6000";
const inputArgs = process.argv.slice(2);
const k6Args = [];
let mode = "single";

for (let index = 0; index < inputArgs.length; index += 1) {
  const arg = inputArgs[index];
  if (arg === "--mode") {
    mode = inputArgs[index + 1] ?? "single";
    index += 1;
  } else if (arg.startsWith("--mode=")) {
    mode = arg.slice("--mode=".length);
  } else {
    k6Args.push(arg);
  }
}

if (mode !== "single" && mode !== "cluster" && mode !== "replica") {
  console.error("Mode must be 'single', 'cluster' or 'replica'.");
  process.exit(1);
}

function optionValue(name, fallback) {
  const equalsArg = k6Args.find((arg) => arg.startsWith(`--${name}=`));
  if (equalsArg) {
    return equalsArg.slice(`--${name}=`.length);
  }

  const flagIndex = k6Args.indexOf(`--${name}`);
  return flagIndex >= 0 ? (k6Args[flagIndex + 1] ?? fallback) : fallback;
}

function formatTable(title, rows) {
  const keyWidth = Math.max(...rows.map(([key]) => key.length));
  const valueWidth = Math.max(...rows.map(([, value]) => String(value).length));
  const border = `+${"-".repeat(keyWidth + 2)}+${"-".repeat(valueWidth + 2)}+`;
  const formattedRows = rows.map(
    ([key, value]) =>
      `| ${key.padEnd(keyWidth)} | ${String(value).padEnd(valueWidth)} |`,
  );

  return [title, border, ...formattedRows, border].join("\n");
}

const port =
  mode === "cluster"
    ? (process.env.CLUSTER_PORT ?? "3001")
    : mode === "replica"
      ? (process.env.REPLICA_TEST_PORT ?? "3002")
      : (process.env.PORT ?? "3000");

if (mode === "replica") {
  console.log("Starting the read replica container...");
  const replicaUp = spawnSync(
    "docker",
    ["compose", "--profile", "read-replica", "up", "-d", "--wait", "postgres-replica"],
    { stdio: "inherit" },
  );
  if (replicaUp.error || replicaUp.status !== 0) {
    console.error("Unable to start the read replica container.");
    process.exit(1);
  }
}
const poolMax = Number(process.env.DB_POOL_MAX ?? 20);
const runDate = new Date();
const dateSuffix = `${runDate.getDate()}-${runDate.getMonth() + 1}-${runDate.getFullYear()}`;
const outputPath = join(process.cwd(), `traffic-metrics-${dateSuffix}.txt`);
let stdout = "";
let stderr = "";

const child = spawn(
  "docker",
  [
    "compose",
    "--profile",
    "load-test",
    "run",
    "--rm",
    "--service-ports",
    "-e",
    `BASE_URL=http://host.docker.internal:${port}`,
    "k6",
    "run",
    ...k6Args,
    "/scripts/traffic-k6.js",
  ],
  { stdio: ["inherit", "pipe", "pipe"] },
);

console.log(
  `Running ${mode} mode against port ${port}; dashboard: http://localhost:${dashboardPort}`,
);

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  stdout += text;
  process.stdout.write(text);
});

child.stderr.on("data", (chunk) => {
  stderr = (stderr + chunk.toString()).slice(-10_000);
});

child.on("error", (error) => {
  console.error(
    `Unable to start k6 with Docker. Make sure Docker is running. ${error.message}`,
  );
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (code !== 0) {
    if (stderr) {
      process.stderr.write(stderr);
    }
    process.exitCode = code ?? 1;
    return;
  }

  const match = stdout.match(/K6_METRICS_JSON=(\{[^\r\n]+\})/);
  if (!match) {
    console.error("k6 completed without emitting its metrics summary.");
    if (stderr) {
      process.stderr.write(stderr);
    }
    process.exitCode = 1;
    return;
  }

  try {
    const metrics = JSON.parse(match[1]);
    // The server reports HIT/MISS only while the cache is on (BYPASS when off).
    const cacheEnabled = metrics.feedCacheHits + metrics.feedCacheMisses > 0;
    const report = formatTable("k6 traffic benchmark", [
      ["Timestamp", new Date().toISOString()],
      ["Mode", mode],
      ["Workload", "random user per action"],
      ["Configured mix", "feed 80%, follow 5%, like 10%, post 5%"],
      ["Virtual users", optionValue("vus", "20")],
      ["Duration", optionValue("duration", "30s")],
      ["DB pool max", process.env.DB_POOL_MAX ?? "20"],
      ...(mode === "replica"
        ? [
            [
              "Pool split (primary/replica)",
              `${process.env.DB_POOL_PRIMARY_MAX ?? poolMax - Math.round(poolMax * 0.6)}/${process.env.DB_POOL_REPLICA_MAX ?? Math.round(poolMax * 0.6)}`,
            ],
            [
              "Configured feed read split (primary %)",
              process.env.PRIMARY_READ_PERCENT ?? "30",
            ],
            ["Feed reads from primary", String(metrics.feedPrimaryReads)],
            ["Feed reads from replica", String(metrics.feedReplicaReads)],
            [
              "Feed reads from replica (%)",
              metrics.feedReplicaPercent.toFixed(2),
            ],
          ]
        : []),
      [
        "Cache strategy",
        cacheEnabled
          ? "Full-feed response cache (process-local)"
          : "Disabled (--no-cache)",
      ],
      ["Cache TTL (ms)", cacheEnabled ? "10000" : "0"],
      ["Total requests", String(metrics.totalRequests)],
      ["Throughput (RPS)", metrics.throughputRps.toFixed(2)],
      ["Average latency (ms)", metrics.avgMs.toFixed(2)],
      ["p50 latency (ms)", metrics.p50Ms.toFixed(2)],
      ["p95 latency (ms)", metrics.p95Ms.toFixed(2)],
      ["Max latency (ms)", metrics.maxMs.toFixed(2)],
      ["Failed requests", String(metrics.failedRequests)],
      ["Failed (%)", metrics.failedPercent.toFixed(2)],
      ["Checks passed", String(metrics.checksPassed)],
      ["Checks failed", String(metrics.checksFailed)],
      ["Feed requests", String(metrics.feedRequests)],
      ["Follow requests", String(metrics.followRequests)],
      ["Like requests", String(metrics.likeRequests)],
      ["Post requests", String(metrics.postRequests)],
      ["Feed cache hits", String(metrics.feedCacheHits)],
      ["Feed cache misses", String(metrics.feedCacheMisses)],
      ["Feed cache hit (%)", metrics.feedCacheHitPercent.toFixed(2)],
      [
        "Failed status counts",
        Object.entries(metrics.failedStatusCounts)
          .map(([statusCode, count]) => `${statusCode}:${count}`)
          .join(", ") || "none",
      ],
    ]);

    appendFileSync(outputPath, `\n${report}\n`, "utf8");
    console.log(report);
  } catch (error) {
    console.error("Could not append k6 metrics:", error);
    process.exitCode = 1;
  }

  if (signal) {
    console.error(`k6 exited after receiving ${signal}.`);
    process.exitCode = 1;
  }
});
