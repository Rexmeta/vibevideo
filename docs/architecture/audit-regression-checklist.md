# Architecture Audit Regression Checklist

> Companion checklist for issue #208. This is a test/verification contract for future migration PRs; it does not change runtime behavior.

## Existing user flows

- [ ] Landing page loads without authentication.
- [ ] Sample project opens for signed-out users and does not require cloud generation.
- [ ] Authenticated user can create a blank project through New Project.
- [ ] Express mode starts with its intended short/presentation preset.
- [ ] Existing project opens in its persisted step.
- [ ] Quick/Wizard mode state survives navigation/reload.

## Persistence and recovery

- [ ] Normal Cloud restore returns step, scene metadata and remote media paths.
- [ ] Firestore-disabled/local-only mode still restores the latest local snapshot.
- [ ] IndexedDB media is reattached when cloud/local metadata is incomplete.
- [ ] Local snapshot is written before the debounced cloud sync.
- [ ] Backfill from local snapshot to cloud remains possible when cloud recovers.
- [ ] Multiple tabs do not corrupt Firestore's persistent cache behavior.

## Generation jobs

- [ ] Batch video generation creates one durable job.
- [ ] Single-scene retry uses the same job infrastructure.
- [ ] Concurrency remains bounded by the current configured limit.
- [ ] Per-model rate limiting still applies.
- [ ] Pause/cancel behavior remains intact.
- [ ] Veo operation names are persisted before long polling can be interrupted.
- [ ] Reload resumes pending operations rather than submitting duplicates.
- [ ] Long-wait state remains visible and recoverable.

## Upload reliability

- [ ] Generated video is cached before/around upload as currently expected.
- [ ] Pending upload Blob survives tab close through IndexedDB.
- [ ] Upload retries use persisted attempt/backoff state.
- [ ] Successful upload patches the scene to a stable HTTP URL.
- [ ] A pending upload does not trigger a second paid video generation.

## AI provider behavior

- [ ] Google model-ID aliases continue to resolve correctly.
- [ ] Missing API key produces the existing friendly error path.
- [ ] Retryable 429/5xx/timeout errors retain retry behavior.
- [ ] Veo polling backoff and max poll budget remain behaviorally equivalent.
- [ ] Seed source and video metadata remain persisted.
- [ ] Vision Critic/refinement behavior remains available for the existing image path.

## Export

- [ ] FFmpeg bundled core loads normally.
- [ ] CDN fallback remains available when bundled core loading fails.
- [ ] Audio/video merge works for normal projects.
- [ ] Caption rendering works.
- [ ] Long-form part export works.
- [ ] FFmpeg termination/cleanup is still executed between long-form chunks.
- [ ] Export failure still exposes the current memory-friendly fallback behavior.

## Security

- [ ] Firestore project ownership rules remain enforced.
- [ ] Storage `users/{uid}` ownership rules remain enforced.
- [ ] Admin model writes remain protected by server-side Firestore admin documents.
- [ ] No domain/application type imports Firebase SDK types as a result of architecture extraction.

## Migration acceptance principle

A migration ticket is not complete merely because TypeScript compiles. It is complete only when the affected boundary has tests and the regression-critical flows above remain green.
