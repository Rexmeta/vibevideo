---
name: Upload retryability persistence
description: Rule for keeping durable upload state consistent across reloads and UI/job boundaries.
---

Persist a normalized, display-safe upload error together with its retryability. A non-retryable upload failure must be stored and restored as terminal (`upload-failed`), not pending.

**Why:** An in-memory listener can settle the current job, but after a reload there may be no listener-to-job correlation. If durable metadata still says pending, the UI reports a retry that will never run and the job can remain active indefinitely.

**How to apply:** Whenever upload error mapping or queue restoration changes, keep queue scheduling, persisted media status, restored events, and job terminal counts derived from the same normalized retryability.