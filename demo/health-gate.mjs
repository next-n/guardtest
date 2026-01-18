// demo/health-gate.mjs
import { ResilientHttpClient } from "@nextn/outbound-guard";
import { startUpstream } from "./upstream.mjs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function hr(title) {
  console.log("\n" + "=".repeat(70));
  console.log(title);
  console.log("=".repeat(70));
}

function log(msg) {
  const t = new Date().toISOString().slice(11, 23);
  console.log(`[${t}] ${msg}`);
}

async function one(client, url) {
  return client.request({ method: "GET", url });
}

async function burst(client, url, n) {
  const tasks = [];
  for (let i = 0; i < n; i++) tasks.push(one(client, url));

  const results = await Promise.allSettled(tasks);
  let ok = 0;
  const errors = {};

  for (const r of results) {
    if (r.status === "fulfilled") {
      ok++;
    } else {
      const name = r.reason?.name || "Error";
      errors[name] = (errors[name] || 0) + 1;
    }
  }

  return { ok, errors };
}

async function main() {
  hr("DEMO: health gate (OPEN -> CLOSED -> HALF_OPEN -> OPEN)");

  const upstream = await startUpstream();
  log(`UPSTREAM listening at ${upstream.baseUrl}`);

  const client = new ResilientHttpClient({
    maxInFlight: 2,
    requestTimeoutMs: 150,
    health: { enabled: true },
    microCache: { enabled: false },
  });

  // ---- Phase 0: healthy
  hr("Phase 0: baseline (healthy)");
  upstream.setMode("ok");
  await one(client, `${upstream.baseUrl}/test`);

  // ---- Phase 1: trip CLOSED
  hr("Phase 1: trip CLOSED (3 timeouts)");
  upstream.setMode("timeout");
  for (let i = 1; i <= 3; i++) {
    try {
      await one(client, `${upstream.baseUrl}/test`);
    } catch {
      log(`(expected) timeout #${i}`);
    }
  }

  // ---- Phase 2: CLOSED fast-fail
  hr("Phase 2: while CLOSED (fast-fail)");
  const r2 = await burst(client, `${upstream.baseUrl}/test`, 20);
  log(`Burst result: ok=${r2.ok} errors=${JSON.stringify(r2.errors)}`);
  log(`Snapshot: ${JSON.stringify(client.snapshot())}`);

  // ---- Phase 3: HALF_OPEN probe
  hr("Phase 3: HALF_OPEN probe");
  log("Waiting ~1200ms for cooldown...");
  await sleep(1200);

  upstream.setMode("ok");

  log("Sending probe...");
  await client.probe({ method: "GET", url: `${upstream.baseUrl}/test` });
  log("Probe succeeded");

  const r3 = await burst(client, `${upstream.baseUrl}/test`, 10);
  log(`Burst result: ok=${r3.ok} errors=${JSON.stringify(r3.errors)}`);

  // ---- Phase 4: confirm OPEN
  hr("Phase 4: confirm OPEN");
  await one(client, `${upstream.baseUrl}/test`);

  await upstream.close();
  hr("DONE");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
