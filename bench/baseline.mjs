// baseline.mjs
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

async function main() {
  const total = Number(process.env.N ?? 30000);
  const concurrency = Number(process.env.C ?? 800);

  const upstream = await startUpstream({ delayMs: 250, jitterMs: 50 });
  const targetUrl = `${upstream.url}/data?key=same`;

  const result = await runLoad({
    total,
    concurrency,
    fn: async () => {
      const r = await fetch(targetUrl);
      if (!r.ok) throw new Error(`status ${r.status}`);
      await r.text();
    },
  });

  const hits = upstream.hits();
  const dedupeRatio = 1 - hits / total;

  console.log("\n=== BASELINE (plain fetch) ===");
  console.log({ total, concurrency, ok: result.ok, bad: result.bad });
  console.log({ upstreamHits: hits, dedupeRatio: Number(dedupeRatio.toFixed(4)) });
  console.log({ p50: result.p50, p95: result.p95, p99: result.p99 });

  await upstream.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
