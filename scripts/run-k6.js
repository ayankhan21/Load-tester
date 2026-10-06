const { spawn } = require("node:child_process");
const { join } = require("node:path");

const dashboardPort = process.env.K6_WEB_DASHBOARD_PORT ?? "6000";
const child = spawn(
  "docker",
  [
    "compose",
    "--profile",
    "load-test",
    "run",
    "--rm",
    "--service-ports",
    "k6",
    "run",
    ...process.argv.slice(2),
    "/scripts/traffic-k6.js",
  ],
  { stdio: "inherit" },
);

console.log(`Starting k6 dashboard at http://localhost:${dashboardPort}`);

child.on("error", (error) => {
  console.error(
    `Unable to start k6 with Docker. Make sure Docker is running. ${error.message}`,
  );
  process.exitCode = 1;
});

child.on("close", (code, signal) => {
  if (code !== null) {
    process.exitCode = code;
  } else if (signal) {
    console.error(`k6 exited after receiving ${signal}.`);
    process.exitCode = 1;
  }
});
