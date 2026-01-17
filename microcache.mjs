/**
 * Demo: GET micro-cache + singleflight
 *
 * - First call hits upstream
 * - Burst of identical calls returns from memory
 * - Upstream is protected from thundering herd
 */

import { ResilientHttpClient } from "@nextn/outbound-guard";

const client = new ResilientHttpClient({
  maxInFlight: 5,
  maxQueue: 200,
  enqueueTimeoutMs: 2000,
  requestTimeoutMs: 7000,
  microCache: {
    enabled: true,
    ttlMs: 1000,
    maxStaleMs: 8000,
    maxEntries: 1000,
    maxWaiters: 1000,
    followerTimeoutMs: 12000,
  },
});

// optional logs
client.on("request:success", (e) => console.log("ok", e.durationMs));
client.on("request:failure", (e) => console.log("fail", e.error?.name, e.durationMs));

async function callOne(i) {
  const t0 = Date.now();
  const res = await client.request({
    method: "GET",
    url: "https://httpbin.org/delay/1",
    headers: { "User-Agent": "guard-test" },
  });
  return { i, status: res.status, ms: Date.now() - t0 };
}

async function main() {
  console.log("warmup...");
  console.log(await callOne("warmup"));

  console.log("burst 100...");
  const t0 = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 100 }, (_, i) => callOne(i))
  );
  console.log("burstTotalMs:", Date.now() - t0);

  const ok = results.filter((r) => r.status === "fulfilled").length;
  const bad = results.length - ok;
  console.log("ok:", ok, "bad:", bad);

  // show first 10 fulfilled timings
  console.log(
    results
      .filter((r) => r.status === "fulfilled")
      .slice(0, 10)
      .map((r) => r.value)
  );

  await new Promise((r) => setTimeout(r, 200));
}

main().catch(console.error);
