import http from "k6/http";
import { Counter } from "k6/metrics";
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
const actionRequests = {
  feed: new Counter("feed_requests"),
  follow: new Counter("follow_requests"),
  like: new Counter("like_requests"),
  post: new Counter("post_requests"),
};
const failedHttpStatusRequests = {};
for (let statusCode = 400; statusCode < 600; statusCode += 1) {
  failedHttpStatusRequests[statusCode] = new Counter(
    `failed_http_status_${statusCode}`,
  );
}
const failedNetworkRequests = new Counter("failed_network_requests");
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
  actionRequests[action].add(1);
  const params = {
    ...requestParams,
    tags: { action, name: action },
  };
  const response =
    method === "GET"
      ? http.get(`${baseUrl}${path}`, params)
      : http.post(`${baseUrl}${path}`, body, params);

  if (response.status === 0) {
    failedNetworkRequests.add(1);
  } else if (response.status >= 400 && response.status < 600) {
    failedHttpStatusRequests[response.status]?.add(1);
  }

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

  if (roll < 0.8) {
    const userId = randomUserId();
    sendRequest("feed", "GET", `/users/${userId}/feed?limit=20`);
  } else if (roll < 0.85) {
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
  } else if (roll < 0.95) {
    const userId = randomUserId();
    const postId = randomInt(1, postCount);
    sendRequest(
      "like",
      "POST",
      `/posts/${postId}/like`,
      JSON.stringify({ userId }),
    );
  } else {
    const userId = randomUserId();
    const content = `Traffic mix ${Date.now()} ${Math.random().toString(36).slice(2, 10)}`;
    sendRequest("post", "POST", "/posts", JSON.stringify({ userId, content }));
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
  const actionCount = (name) =>
    data.metrics[`${name}_requests`]?.values?.count ?? 0;
  const failedStatusCounts = {};
  for (let statusCode = 400; statusCode < 600; statusCode += 1) {
    const count =
      data.metrics[`failed_http_status_${statusCode}`]?.values?.count ?? 0;
    if (count > 0) {
      failedStatusCounts[statusCode] = count;
    }
  }
  const networkFailures =
    data.metrics.failed_network_requests?.values?.count ?? 0;
  if (networkFailures > 0) {
    failedStatusCounts.network_error = networkFailures;
  }
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
    feedRequests: actionCount("feed"),
    followRequests: actionCount("follow"),
    likeRequests: actionCount("like"),
    postRequests: actionCount("post"),
    failedStatusCounts,
  };

  return {
    stdout: `K6_METRICS_JSON=${JSON.stringify(summary)}\n`,
  };
}
