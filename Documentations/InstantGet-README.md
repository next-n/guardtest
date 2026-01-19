
## Demo: `InstantGetStore`

`InstantGetStore` provides **instant, non-blocking reads** backed by a **background polling loop**.

Your application **never waits on upstream**.  
It always returns the **last known good value** (until it expires).

---

## Basic usage

```js
import { InstantGetStore } from "@nextn/outbound-guard";

const store = new InstantGetStore();

store.start("https://upstream/api", {
  intervalMs: 1000,
  onError: { retry: Infinity },
});

const ready = await store.waitReady(5);

if (ready) {
  const res = store.get();
  // use res
}
````

---

## API overview

### `store.start(url, options)`

Starts polling a single URL in the background.

```js
store.start(url, {
  intervalMs: 1000,
  onError: { retry: Infinity },
});
```

* polling runs independently of request handlers
* only **2xx responses** are treated as valid
* failures trigger retry behavior

---

### `await store.waitReady(timeoutSec)`

Waits until the first successful (`2xx`) response is observed.

```js
const ready = await store.waitReady(5);
```

* returns `true` if a success arrives in time
* returns `false` on timeout
* useful for boot-time readiness gates

---

### `store.get()`

Returns the **last successful response instantly**.

```js
const res = store.get();
```

* **O(1)** lookup
* returns `undefined` if:

  * no successful response yet
  * cached value has expired
* never performs network I/O

---

### `store.snapshot()`

Returns internal state for observability.

```js
const snap = store.snapshot();
```

Includes:

* `lastOkAt`
* `lastErrorName`
* `consecutiveErrors`
* `nextDelayMs`

---

### `store.stop()`

Stops background polling immediately.

```js
store.stop();
```

* no further retries
* cached value will not update

---

## Why this exists

This pattern is useful when:

* upstream is **slow or flaky**
* handlers must be **instant and predictable**
* serving **slightly stale data** is acceptable

Common use cases:

* feature flags / config snapshots
* exchange rates
* metadata lookups
* dashboard data

---

## Running the demo

```bash
npm run demo:instant
```

File: `demo/instant-get.mjs`

---

## What the demo shows

The demo spins up a fake upstream with two modes:

* `ok` → returns `200 VALUE_n`
* `fail` → returns `500 FAIL`

Then it walks through these phases:

---

### Phase 0 — Start polling + readiness

* polling interval: `1s`
* waits up to `5s` for first success
* exits early if upstream never succeeds

---

### Phase 1 — Instant reads

* repeated calls to `store.get()`
* always returns immediately
* `ageMs` shows freshness of cached value

---

### Phase 2 — Upstream failure

* upstream switches to `fail`
* `get()` continues returning last good value
* `snapshot()` shows retry state:

  * error name
  * consecutive failures
  * next scheduled retry delay

---

### Phase 2.5 — Cache expiry

* wait ~60 seconds
* cached value expires
* `get()` becomes `undefined`

---

### Phase 3 — Stop polling

* `store.stop()` is called
* upstream recovery no longer affects the store
* cached value remains frozen

---

## Retry behavior

This demo uses:

```js
onError: { retry: Infinity }
```

Meaning:

* polling **never stops**
* retries continue with backoff

Retry delays:

```
1s → 3s → 5s → 10s → 30s → 60s → 60s → ...
```

This prevents hammering a failing upstream while keeping the store warm.

---

### Limited retries

```js
onError: { retry: 3 }
```

* retries 3 times
* polling stops after the final failure

---

### Stop on first failure

```js
onError: "stop"
```

* no retries
* polling stops immediately

