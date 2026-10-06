const { appendFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
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

if (mode !== "single" && mode !== "cluster") {
  console.error("Mode must be either 'single' or 'cluster'.");
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

const port =
  mode === "cluster"
    ? (process.env.CLUSTER_PORT ?? "3001")
    : (process.env.PORT ?? "3000");
const outputPath = join(
  process.cwd(),
  mode === "cluster"
    ? "traffic-metrics-cluster-mode.txt"
    : "traffic-metrics.txt",
);
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
    const report = [
      "k6 traffic benchmark",
      `timestamp=${new Date().toISOString()}`,
      `mode=${mode}`,
      `vus=${optionValue("vus", "20")}`,
      `duration=${optionValue("duration", "30s")}`,
      `totalRequests=${metrics.totalRequests}`,
      `throughputRps=${metrics.throughputRps.toFixed(2)}`,
      `avgMs=${metrics.avgMs.toFixed(2)}`,
      `p50Ms=${metrics.p50Ms.toFixed(2)}`,
      `p95Ms=${metrics.p95Ms.toFixed(2)}`,
      `maxMs=${metrics.maxMs.toFixed(2)}`,
      `failedRequests=${metrics.failedRequests}`,
      `failedPercent=${metrics.failedPercent.toFixed(2)}`,
      `checksPassed=${metrics.checksPassed}`,
      `checksFailed=${metrics.checksFailed}`,
      "",
    ].join("\n");

    appendFileSync(outputPath, `\n${report}`, "utf8");
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
