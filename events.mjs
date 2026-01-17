// events.mjs
// Demo: observe ALL events emitted by ResilientHttpClient.
// This file exists purely to show the event surface / payload shapes.

import { ResilientHttpClient } from "@nextn/outbound-guard";

const client = new ResilientHttpClient({
  maxInFlight: 2,
  maxQueue: 5,
  enqueueTimeoutMs: 500,
  requestTimeoutMs: 4000,

  microCache: {
    enabled: true,
    ttlMs: 1000,
    maxStaleMs: 5000,
    maxEntries: 50,
    maxWaiters: 5,
    followerTimeoutMs: 2000,
  },
});

// ---- Event listeners ----

client.on("request:start", (e) =>
  console.log("[event] request:start", {
    id: e.requestId,
    method: e.request.method,
    url: e.request.url,
  })
);

client.on("request:success", (e) =>
  console.log("[event] request:success", {
    id: e.requestId,
    status: e.status,
    durationMs: e.durationMs,
  })
);

client.on("request:failure", (e) =>
  console.log("[event] request:failure", {
    id: e.requestId,
    error: e.error?.name,
    durationMs: e.durationMs,
  })
);

client.on("request:rejected", (e) =>
  console.log("[event] request:rejected", {
    id: e.requestId,
    error: e.error?.name,
  })
);

client.on("microcache:retry", (e) =>
  console.log("[event] microcache:retry", {
    url: e.url,
    attempt: e.attempt,
    maxAttempts: e.maxAttempts,
    reason: e.reason,
    delayMs: e.delayMs,
  })
);

client.on("microcache:refresh_failed", (e) =>
  console.log("[event] microcache:refresh_failed", {
    key: e.key,
    url: e.url,
    error: e.error?.name,
  })
);

// ---- Demo workload ----

async function run() {
  // slow endpoint to trigger timeout / retry / cache behavior
  const urls = [
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/2",
    "https://httpbin.org/delay/2",
    "https://httpbin.org/status/503",
  ];

  const calls = urls.map((url) =>
    client.request({
      method: "GET",
      url,
      headers: { "User-Agent": "guard-events-test" },
    })
  );

  const results = await Promise.allSettled(calls);
  console.log("\nresults:");
  console.log(results.map((r) => r.status));

  await new Promise((r) => setTimeout(r, 200));
}

run().catch(console.error);
