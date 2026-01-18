// guard.mjs
import http from "node:http";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function startUpstream({ delayMs = 200, jitterMs = 50 } = {}) {
  let hits = 0;

  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/data")) {
      hits += 1;
      const jitter = Math.floor(Math.random() * (jitterMs + 1));
      await sleep(delayMs + jitter);

      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ ok: true, ts: Date.now(), hits }));
      return;
    }

    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const url = `http://127.0.0.1:${addr.port}`;

  return {
    url,
    hits: () => hits,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function runLoad({ fn, total = 200, concurrency = 50 }) {
  const latencies = [];
  let ok = 0;
  let bad = 0;

  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= total) return;

      const t0 = Date.now();
      try {
        await fn();
        ok += 1;
      } catch {
        bad += 1;
      } finally {
        latencies.push(Date.now() - t0);
      }
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  latencies.sort((a, b) => a - b);
  return {
    ok,
    bad,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
  };
}

// Tries to build your client even if export names differ.
// If it fails, it prints available exports so you can wire it correctly fast.
async function createGuardClient() {
  const mod = await import("@nextn/outbound-guard");

  const Candidate =
    mod.ResilientHttpClient ??
    mod.OutboundGuardClient ??
    mod.Client ??
    mod.default?.ResilientHttpClient ??
    mod.default?.OutboundGuardClient ??
    mod.default?.Client;

  const factory =
    mod.createClient ??
    mod.createOutboundGuard ??
    mod.createResilientHttpClient ??
    mod.default?.createClient ??
    mod.default?.createOutboundGuard ??
    mod.default?.createResilientHttpClient;

  // Config guess (adjust after you see the exports / your other demo files)
  const options = {
    // core knobs you’ve been talking about:
    maxInFlight: 200,
    maxQueue: 1000,
    enqueueTimeoutMs: 500,
    requestTimeoutMs: 5000,
    microCache: {
        enabled: true,

        // key trick: ttl=0 means "no fresh window"
        // so requests won't be served from cache immediately after leader completes.
        ttlMs: 1000,

        // still allow stale window, but since ttl=0 the entry becomes stale immediately
        // and singleflight will ensure only 1 refresh happens at a time.
        maxStaleMs: 8000,
        maxEntries: 1000,

        // allow many followers to join the leader
        maxWaiters: 2000,
        followerTimeoutMs: 12000,
  },
  };

  if (typeof factory === "function") return factory(options);
  if (typeof Candidate === "function") return new Candidate(options);

  const keys = Object.keys(mod);
  throw new Error(
    `Cannot create client from @nextn/outbound-guard. Exports: ${keys.join(", ")}`
  );
}

// Tries common request methods (fetch/request/get).
async function guardGet(client, url) {
  if (typeof client.fetch === "function") {
    const r = await client.fetch(url, { method: "GET" });
    if (r?.ok === false) throw new Error(`status ${r.status}`);
    if (typeof r?.text === "function") await r.text();
    return;
  }

  if (typeof client.request === "function") {
    const r = await client.request({ method: "GET", url });
    // accept either fetch-like or already-parsed response
    if (r?.ok === false) throw new Error(`status ${r.status}`);
    return;
  }

  if (typeof client.get === "function") {
    const r = await client.get(url);
    if (r?.ok === false) throw new Error(`status ${r.status}`);
    return;
  }

  const keys = Object.keys(client ?? {});
  throw new Error(`Client has no fetch/request/get. Client keys: ${keys.join(", ")}`);
}

async function main() {
  const total = Number(process.env.N ?? 30000);
  const concurrency = Number(process.env.C ?? 800);

  const upstream = await startUpstream({ delayMs: 250, jitterMs: 50 });
  const targetUrl = `${upstream.url}/data?key=same`;

  const client = await createGuardClient();

  const result = await runLoad({
    total,
    concurrency,
    fn: async () => {
      await guardGet(client, targetUrl);
    },
  });

  const hits = upstream.hits();
  const dedupeRatio = 1 - hits / total;

  console.log("\n=== OUTBOUND-GUARD ===");
  console.log({ total, concurrency, ok: result.ok, bad: result.bad });
  console.log({ upstreamHits: hits, dedupeRatio: Number(dedupeRatio.toFixed(4)) });
  console.log({ p50: result.p50, p95: result.p95, p99: result.p99 });

  await upstream.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
