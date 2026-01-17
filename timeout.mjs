// timeout.mjs
// Demo: requestTimeoutMs causes a hard fail when upstream is too slow.

import { ResilientHttpClient } from "@nextn/outbound-guard";

const client = new ResilientHttpClient({
  maxInFlight: 5,
  maxQueue: 50,
  enqueueTimeoutMs: 1000,

  requestTimeoutMs: 1500, // intentionally too small

  microCache: { enabled: false }, // keep it pure
});

client.on("request:success", (e) => console.log("ok", e.status, e.durationMs));
client.on("request:failure", (e) => console.log("fail", e.error?.name, e.durationMs));
client.on("request:rejected", (e) => console.log("rejected", e.error?.name));

async function main() {
  const t0 = Date.now();
  try {
    await client.request({
      method: "GET",
      url: "https://httpbin.org/delay/2",
      headers: { "User-Agent": "guard-timeout-test" },
    });
    console.log("unexpected: succeeded");
  } catch (err) {
    console.log("caught:", err?.name || "Error", "wallMs:", Date.now() - t0);
  }

  await new Promise((r) => setTimeout(r, 200));
}

main().catch(console.error);
