// singleflight.mjs
// Demo: singleflight (request coalescing) WITHOUT cache hits.
// Expect: 1 leader does the upstream call, followers await it.
// Result: burst calls are NOT ~1ms; they finish around leader duration.

import { ResilientHttpClient } from "@nextn/outbound-guard";

const client = new ResilientHttpClient({
  maxInFlight: 5,
  maxQueue: 200,
  enqueueTimeoutMs: 2000,
  requestTimeoutMs: 15000,

  microCache: {
    enabled: true,

    // key trick: ttl=0 means "no fresh window"
    // so requests won't be served from cache immediately after leader completes.
    ttlMs: 0,

    // still allow stale window, but since ttl=0 the entry becomes stale immediately
    // and singleflight will ensure only 1 refresh happens at a time.
    maxStaleMs: 8000,
    maxEntries: 1000,

    // allow many followers to join the leader
    maxWaiters: 2000,
    followerTimeoutMs: 12000,
  },
});

client.on("request:success", (e) => console.log("ok", e.status, e.durationMs));
client.on("request:failure", (e) => console.log("fail", e.error?.name, e.durationMs));

async function callOne(i) {
  const t0 = Date.now();
  const res = await client.request({
    method: "GET",
    url: "https://httpbin.org/delay/2",
    headers: { "User-Agent": "guard-singleflight-test" },
  });
  return { i, status: res.status, ms: Date.now() - t0 };
}

function summarize(results) {
  const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => r.value);
  const rejected = results.filter((r) => r.status === "rejected");

  const ms = fulfilled.map((x) => x.ms).sort((a, b) => a - b);
  const p = (q) => ms[Math.floor((ms.length - 1) * q)] ?? null;

  console.log("ok:", fulfilled.length, "bad:", rejected.length);
  console.log("p50:", p(0.5), "p90:", p(0.9), "p99:", p(0.99), "max:", ms[ms.length - 1] ?? null);
  console.log("first10:", fulfilled.slice(0, 10));
  if (rejected.length) console.log("rejectedSample:", rejected.slice(0, 3).map((r) => String(r.reason?.name || r.reason)));
}

async function main() {
  console.log("burst 100 (singleflight, ttl=0)...");
  const t0 = Date.now();

  const results = await Promise.allSettled(
    Array.from({ length: 100 }, (_, i) => callOne(i))
  );

  console.log("burstTotalMs:", Date.now() - t0);
  summarize(results);

  // let event logs flush
  await new Promise((r) => setTimeout(r, 200));
}

main().catch(console.error);
