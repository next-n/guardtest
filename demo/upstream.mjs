// demo/upstream.mjs
import http from "node:http";

export async function startUpstream() {
  // modes:
  // - ok      : 200 immediately
  // - timeout : never responds
  // - s503    : respond 503 immediately
  let mode = "ok";

  const server = http.createServer((_req, res) => {
    if (mode === "ok") {
      res.statusCode = 200;
      res.end("OK");
      return;
    }

    if (mode === "s503") {
      res.statusCode = 503;
      res.end("SERVICE UNAVAILABLE");
      return;
    }

    if (mode === "timeout") {
      // do nothing → client times out
      return;
    }

    res.statusCode = 500;
    res.end("UNKNOWN MODE");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    setMode(m) {
      mode = m;
      console.log(`[upstream] mode -> ${mode}`);
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
