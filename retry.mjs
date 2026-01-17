// retry.mjs
// Demo: microCache leader retry on retryable STATUS (e.g., 503).
// Local server returns 503 twice then 200.
// Expect: client emits microcache:retry events, final status 200.

import http from "node:http";
import { ResilientHttpClient } from "@nextn/outbound-guard";

function startFlakyServer() {
  let hits = 0;

  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url !== "/flaky") {
        res.statusCode = 404;
        res.end("not found");
        return;
      }

      hits += 1;

      if (hits <= 2) {
        res.statusCode = 503;
        res.setHeader("content-type", "text/plain");
        res.end(`temporary unavailable (hit ${hits})`);
        return;
      }

      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end(`ok (hit ${hits})`);
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${addr.port}/flaky`,
        getHits: () => hits,
      });
    });
  });
}

const client = new ResilientHttpClient({
  maxInFlight: 5,
  maxQueue: 50,
  enqueueTimeoutMs: 1000,
  requestTimeoutMs: 5000,

  microCache: {
    enabled: true,
    ttlMs: 1000,
    maxStaleMs: 8000,
    maxEntries: 100,

    maxWaiters: 1000,
    followerTimeoutMs: 12000,

    retry: {
      maxAttempts: 3,
      baseDelayMs: 50,
      maxDelayMs: 1000,
      retryOnStatus: [503],
    },
  },
});

client.on("microcache:retry", (e) =>
  console.log("microcache:retry", e.attempt, "/", e.maxAttempts, e.reason, "delayMs", e.delayMs)
);
client.on("request:success", (e) => console.log("request:success", e.status, e.durationMs));
client.on("request:failure", (e) => console.log("request:failure", e.error?.name, e.durationMs));

async function main() {
  const { server, url, getHits } = await startFlakyServer();

  try {
    const t0 = Date.now();
    const res = await client.request({
      method: "GET",
      url,
      headers: { "User-Agent": "guard-retry-test" },
    });
    console.log("final status:", res.status, "wallMs:", Date.now() - t0);
    console.log("server hits:", getHits()); // should be 3
  } finally {
    // close server
    await new Promise((r) => server.close(r));
  }

  await new Promise((r) => setTimeout(r, 200));
}

main().catch(console.error);
