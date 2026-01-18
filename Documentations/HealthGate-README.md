Perfect — that’s the right starting point.
Let’s explain it **from the queue**, then build up. Very simple, very concrete.

Paste this into the demo README.

---

## How Health Gate works (from the queue)

### 1. One queue per upstream (base URL)

`outbound-guard` keeps **one queue per base URL**, for example:

```
https://api.foo.com
https://api.bar.com
```

Each upstream has:

* its **own concurrency limit**
* its **own queue**
* its **own health state**

So if `api.foo.com` is slow or broken, it **cannot affect** `api.bar.com`.

---

### 2. Normal state: queue is open

When the upstream is healthy:

* requests enter the queue
* limited number run at the same time
* extra requests wait in the queue

This is normal backpressure.

---

### 3. Upstream starts failing

If requests to one base URL:

* time out
* or hit real network failures

The client counts these as **hard failures**.

---

### 4. Gate closes for that base URL

After strong failure signals (e.g. **3 timeouts in a row**):

For **that base URL only**:

* the queue is **closed**
* all waiting requests are **rejected**
* new requests are **rejected immediately**

No waiting. No retries. No queue growth.

---

### 5. Cooldown (short pause)

The queue stays closed for a **short time**:

* about **1 second** at first
* longer if failures keep happening

During this time, requests are still rejected.

---

### 6. One test request

After the cooldown:

* the queue allows **exactly one request**
* this request does **not wait**
* it is a **health probe**

All other requests are still rejected.

---

### 7. Decide based on the probe

* Probe succeeds → queue **opens again**
* Probe fails → queue **closes again** (longer pause)

---



---

### Run the demo

```bash
npm run demo:health
```

Watch how:

* the queue closes after timeouts
* requests fail instantly
* one probe is allowed
* normal traffic resumes


-------------------------------------------------------------------------------


Here’s the **simple explanation of cooldown time**, tied directly to failures

---

## Cooldown time (how long the queue stays closed)

When the gate closes, it does **not reopen immediately**.
It waits for a **cooldown period**.

### How cooldown is calculated

* First failure round → **~1 second**
* Every time the upstream fails again → cooldown **doubles**
* Maximum cooldown → **30 seconds**
* Small random jitter is added to avoid synchronized retries

---

### Cooldown timeline (example)

```
1st close  → ~1s
2nd close  → ~2s
3rd close  → ~4s
4th close  → ~8s
5th close  → ~16s
6th close  → ~30s (max)
```

---

### Important detail

* Cooldown **does not reopen the queue by itself**
* After cooldown, the **next request** triggers a HALF_OPEN probe
* If the probe fails → cooldown grows longer
* If the probe succeeds → cooldown resets

---

### In one sentence

> Each time the upstream fails again, outbound-guard waits longer before trying to recover.



