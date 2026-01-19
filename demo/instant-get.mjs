// demo/instant-get.mjs
//
// Run:
//   npm run demo:instant
//
// What this shows:
// - One URL is polled in the background
// - waitReady(timeoutSec) waits for first SUCCESS (2xx)
// - get() is instant (last good value, or undefined)
// - When upstream fails: infinite retry uses backoff (1s, 5s, 10s, 30s, 60s...)
// - stop() stops polling

import http from "node:http";
import { InstantGetStore } from "@nextn/outbound-guard";

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

function bodyToString(res) {
  return Buffer.from(res.body).toString();
}

/* ---------------- fake upstream ---------------- */

async function startUpstream() {
  let mode = "ok"; // ok | fail
  let counter = 0;

  const server = http.createServer((_req, res) => {
    counter += 1;

    if (mode === "ok") {
      res.statusCode = 200;
      res.setHeader("content-type", "text/plain");
      res.end(`VALUE_${counter}`);
      return;
    }

    res.statusCode = 500;
    res.setHeader("content-type", "text/plain");
    res.end("FAIL");
  });

  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();

  return {
    url: `http://127.0.0.1:${addr.port}`,
    setMode(m) {
      mode = m;
      log(`UPSTREAM mode -> ${mode}`);
    },
    close() {
      return new Promise((r) => server.close(r));
    },
  };
}

/* ---------------- demo ---------------- */

async function main() {
  hr("DEMO: InstantGetStore (single URL)");

  const upstream = await startUpstream();
  log(`UPSTREAM listening at ${upstream.url}`);

  const store = new InstantGetStore();

  hr("Phase 0: start polling (interval=1s, onError=retry forever)");
  store.start(upstream.url, { intervalMs: 1000, onError: { retry: Infinity } });

  log("waitReady(5) ... (becomes true after first 2xx)");
  const ready = await store.waitReady(5);
  log(`waitReady -> ${ready}`);

  if (!ready) {
    log("Not ready in time => stopping");
    store.stop();
    await upstream.close();
    return;
  }

  hr("Phase 1: instant reads (get())");
  for (let i = 0; i < 5; i++) {
    const res = store.get();
    const snap = store.snapshot();
    const val = res ? bodyToString(res) : "undefined";
    const ageMs = snap?.lastOkAt ? Date.now() - snap.lastOkAt : undefined;
    log(`get() -> ${val} (ageMs=${ageMs ?? "n/a"})`);
    await sleep(500);
  }

  hr("Phase 2: upstream starts failing (store keeps last good value until it expires)");
  upstream.setMode("fail");

  // wait a bit so you can see failures reflected in snapshot
  await sleep(1200);

  for (let i = 0; i < 8; i++) {
    const res = store.get();
    const snap = store.snapshot();

    const val = res ? bodyToString(res) : "undefined";
    const nextDelay = snap?.nextDelayMs;
    const errName = snap?.lastErrorName ?? "none";
    const consec = snap?.consecutiveErrors ?? 0;

    log(
      `get() -> ${val} | lastError=${errName} consecErrors=${consec} nextDelayMs=${nextDelay}`
    );

    // wait a bit to watch backoff ramp; snapshot.nextDelayMs shows what's scheduled
    await sleep(900);
  }
   hr("Phase 2.5: wait 60s for cache expiry");
  
   log("Waiting 61 seconds so cached value expires...");
   await sleep(61_000);

   const expired = store.get();
   log(`After 60s: get() -> ${expired ? bodyToString(expired) : "undefined"}`);
   log("Expected: undefined (cache expired)");

   hr("Phase 3: stop polling");
   store.stop();

  // bring upstream back, but value should not change (polling stopped)
  upstream.setMode("ok");
  await sleep(1500);

  const res2 = store.get();
  log(`After stop(): get() -> ${res2 ? bodyToString(res2) : "undefined"}`);
  log("Since polling stopped, value does not change anymore.");

  hr("DONE");
  await upstream.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
