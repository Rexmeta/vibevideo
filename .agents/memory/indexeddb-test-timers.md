---
name: IndexedDB tests and fake timers
description: Avoiding deterministic-test deadlocks when fake IndexedDB and timer mocks are combined.
---

Persistence tests that combine IndexedDB with scheduled work should synchronize on observable lifecycle events rather than globally advancing timers.

**Why:** Timer mocking can prevent fake IndexedDB transaction callbacks from firing, causing hooks or tests to time out even though the production path is correct.

**How to apply:** Prefer event-driven assertions across fresh module lifecycles; timer control must not prevent storage transaction callbacks from settling.