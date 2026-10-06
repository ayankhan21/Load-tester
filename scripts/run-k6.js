const { spawn } = require("node:child_process");
const { join } = require("node:path");

const dashboardPort = process.env.K6_WEB_DASHBOARD_PORT ?? "6000";
const child = spawn(
  "k6",
  ["run", join(__dirname, "traffic-k6.js"), ...process.argv.slice(2)],
  {
    env: {
      ...process.env,
      K6_WEB_DASHBOARD: process.env.K6_WEB_DASHBOARD ?? "true",
      K6_WEB_DASHBOARD_HOST: process.env.K6_WEB_DASHBOARD_HOST ?? "127.0.0.1",
      K6_WEB_DASHBOARD_PORT: dashboardPort,
      K6_WEB_DASHBOARD_OPEN: process.env.K6_WEB_DASHBOARD_OPEN ?? "true",
    },
    stdio: "inherit",
  },
);

console.log(`Starting k6 dashboard at http://localhost:${dashboardPort}`);

child.on("error", (error) => {
  console.error(
    `Unable to start k6. Install the k6 CLI and make sure it is on PATH. ${error.message}`,
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
