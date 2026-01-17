// backpressure.mjs
// Demo: bounded queue + in-flight cap.
// Expect: a burst will hit maxInFlight, then queue, then start rejecting when queue/timeout is exceeded.

import { ResilientHttpClient } from "@nextn/outbound-guard";

const client = new ResilientHttpClient({
  maxInFlight: 2,          // small on purpose
  maxQueue: 5,             // small on purpose
  enqueueTimeoutMs: 200,   // short -> rejections quickly
  requestTimeoutMs: 15000,

  // disable cache so we're purely testing admission control
  microCache: { enabled: false },
});

client.on("request:start", (e) => console.log("start", e.request.url));
client.on("request:success", (e) => console.log("ok", e.status, e.durationMs));
client.on("request:failure", (e) => console.log("fail", e.error?.name, e.durationMs));
client.on("request:rejected", (e) => console.log("rejected", e.error?.name));

async function callOne(i) {
  const t0 = Date.now();
  try {
    const res = await client.request({
      method: "GET",
      url: "https://httpbin.org/delay/2",
      headers: { "User-Agent": "guard-backpressure-test" },
    });
    return { i, ok: true, status: res.status, ms: Date.now() - t0 };
  } catch (err) {
    return { i, ok: false, err: err?.name || "Error", ms: Date.now() - t0 };
  }
}

async function main() {
  console.log("burst 30 (expect some rejects)...");
  const t0 = Date.now();

  const results = await Promise.all(
    Array.from({ length: 30 }, (_, i) => callOne(i))
  );

  console.log("burstTotalMs:", Date.now() - t0);

  const ok = results.filter((r) => r.ok).length;
  const bad = results.length - ok;
  console.log("ok:", ok, "bad:", bad);

  const rejected = results.filter((r) => !r.ok);
  console.log("rejectedSample:", rejected.slice(0, 10));

  await new Promise((r) => setTimeout(r, 200));
}

main().catch(console.error);
