---
name: Cross-tab generation leases
description: Durable coordination rules for image and audio generation across tabs and reconnects.
---

Cross-tab provider deduplication must use an atomic shared lease keyed by the full generation fingerprint, then fence every state update by the current owner. Runtime-local maps are only a fast path.

**Why:** A second tab or a refreshed page has a different JavaScript runtime and can otherwise submit the same billable provider request. Expired leases must be reclaimable, while late completions from a previous owner must not overwrite the replacement job.

**How to apply:** Keep the shared record durable in Firestore when cloud sync is enabled and IndexedDB for same-browser offline coordination. Persist a bounded JSON-safe completion reference/value, refresh long-running leases, release leases on terminal updates, and make reconnecting callers reuse completed records without invoking the provider.