import {
  createGuard,
} from "@nextn/outbound-guard";

const guard = createGuard({
  maxInFlight: 5,
  maxQueue: 20,
  timeoutMs: 3000,

  microCache: {
    ttlMs: 2000,
    maxWaiters: 10,
    followerTimeoutMs: 2500,
  },

  retry: {
    maxAttempts: 2,
    baseDelayMs: 50,
    maxDelayMs: 200,
    retryOnStatus: [502, 503, 429],
  },
});

async function call() {
  const res = await guard.fetch(
    "https://httpstat.us/200?sleep=2000"
  );
  const text = await res.text();
  console.log("OK:", text.slice(0, 30));
}

await Promise.all(
  Array.from({ length: 10 }, call)
);
