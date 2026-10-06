import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 20,
  duration: "30s",
  discardResponseBodies: true,
};

const baseUrl = (__ENV.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const userCount = 5_000;
const postCount = 50_000;
const thinkMinSeconds = Number(__ENV.THINK_MIN_MS ?? "250") / 1_000;
const thinkMaxSeconds = Number(__ENV.THINK_MAX_MS ?? "1500") / 1_000;
const requestParams = {
  headers: { "content-type": "application/json" },
};

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomUserId() {
  return randomInt(1, userCount);
}

function sendRequest(action, method, path, body) {
  const params = {
    ...requestParams,
    tags: { action, name: action },
  };
  const response =
    method === "GET"
      ? http.get(`${baseUrl}${path}`, params)
      : http.post(`${baseUrl}${path}`, body, params);

  check(
    response,
    {
      "status is below 400": (result) =>
        result.status >= 200 && result.status < 400,
    },
    { action },
  );
}

export default function () {
  const roll = Math.random();

  if (roll < 0.55) {
    const userId = randomUserId();
    sendRequest("feed", "GET", `/users/${userId}/feed?limit=20`);
  } else if (roll < 0.8) {
    const userId = randomUserId();
    const content = `Traffic mix ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`;
    sendRequest("post", "POST", "/posts", JSON.stringify({ userId, content }));
  } else if (roll < 0.92) {
    const userId = randomUserId();
    const postId = randomInt(1, postCount);
    sendRequest(
      "like",
      "POST",
      `/posts/${postId}/like`,
      JSON.stringify({ userId }),
    );
  } else {
    const sourceUserId = randomUserId();
    let targetUserId = randomUserId();
    while (targetUserId === sourceUserId) {
      targetUserId = randomUserId();
    }
    sendRequest(
      "follow",
      "POST",
      `/users/${sourceUserId}/follow/${targetUserId}`,
    );
  }

  const thinkTime =
    Math.random() * (thinkMaxSeconds - thinkMinSeconds) + thinkMinSeconds;
  sleep(thinkTime);
}

export function handleSummary(data) {
  const requestMetrics = data.metrics.http_reqs.values;
  const durationMetrics = data.metrics.http_req_duration.values;
  const failedRate = data.metrics.http_req_failed.values.rate ?? 0;
  const checkMetrics = data.metrics.checks.values;
  const summary = {
    totalRequests: requestMetrics.count ?? 0,
    throughputRps: requestMetrics.rate ?? 0,
    avgMs: durationMetrics.avg ?? 0,
    p50Ms: durationMetrics.med ?? 0,
    p95Ms: durationMetrics["p(95)"] ?? 0,
    maxMs: durationMetrics.max ?? 0,
    failedRequests: Math.round((requestMetrics.count ?? 0) * failedRate),
    failedPercent: failedRate * 100,
    checksPassed: checkMetrics.passes ?? 0,
    checksFailed: checkMetrics.fails ?? 0,
  };

  return {
    stdout: `K6_METRICS_JSON=${JSON.stringify(summary)}\n`,
  };
}
