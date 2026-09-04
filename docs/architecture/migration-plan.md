# VibeVideo Commercialization Migration Plan

> Issue #208 — incremental ticket plan. The audit phase does not implement these tickets.

## 1. Priority model

- **P0:** architecture safety and seams required before commercialization work
- **P1:** production intelligence and multi-model foundation
- **P2:** studio/product experience and rendering scale
- **P3:** server commercialization, usage, billing and enterprise

## 2. Ordered migration backlog

| ID | Priority | Ticket | Depends on | Main regression risk |
|---|---|---|---|---|
| ARCH-01 | P0 | Domain contracts + legacy mappers | #208 | persisted field drift |
| ARCH-02 | P0 | Repository ports over existing persistence | ARCH-01 | restore/sync divergence |
| ARCH-03 | P0 | Provider ports + Google/Veo adapter | ARCH-01 | generation/polling behavior |
| ARCH-04 | P0 | Generation job port + JobManager adapter | ARCH-02, ARCH-03 | duplicate generation |
| ARCH-05 | P0 | Wizard orchestration boundary | ARCH-01..04 | step/state regressions |
| PROD-01 | P1 | Scene Graph | ARCH-01 | scene index/order changes |
| PROD-02 | P1 | Character Bible | PROD-01 | reference consistency |
| PROD-03 | P1 | Asset Library | ARCH-02, PROD-01 | media path resolution |
| PROD-04 | P1 | Model capability registry/router | ARCH-03 | wrong provider/model selection |
| PROD-05 | P1 | Critic/evaluation contract | ARCH-01, PROD-01 | quality-loop changes |
| PROD-06 | P1 | AI Director | PROD-01, PROD-04, PROD-05 | uncontrolled generation/cost |
| STUDIO-01 | P2 | Production workspace shell | ARCH-05, PROD-01 | existing Wizard UX |
| STUDIO-02 | P2 | Variants + compare/select | PROD-04, PROD-05 | asset/version confusion |
| STUDIO-03 | P2 | Timeline/render pipeline | PROD-03, STUDIO-01 | FFmpeg export regression |
| CLOUD-01 | P3 | Server generation API | ARCH-03, ARCH-04 | auth/job semantics |
| CLOUD-02 | P3 | Worker-owned long-running jobs | CLOUD-01 | resume/duplicate operations |
| CLOUD-03 | P3 | Usage/credits/observability | CLOUD-01 | inaccurate accounting |
| CLOUD-04 | P3 | Workspace/team/API/webhooks | CLOUD-01, CLOUD-03 | authorization leakage |
| CLOUD-05 | P3 | Billing | CLOUD-03 | entitlement errors |

## 3. P0 ticket definitions

### ARCH-01 — Domain contracts + legacy mappers

**Goal:** establish provider/storage-independent production concepts without changing persisted JSON.

**Scope:** add domain types for ProjectBrief, Character, Asset, GenerationJob, CriticResult and Scene requirements; create pure mapping functions from current `Project`/`Scene`.

**Depends on:** #208.

**Done:** typecheck/tests pass; old project JSON maps losslessly; Sample/Quick/Wizard/Express paths unchanged.

**Risk:** duplicate sources of truth. Keep legacy `Project`/`Scene` authoritative until later tickets complete.

### ARCH-02 — Repository ports

**Goal:** hide Firestore/IndexedDB/localStorage behind repository contracts.

**Scope:** introduce `ProjectRepository`, `SceneRepository`, `AssetRepository`, `GenerationJobRepository`; adapt current `storageService`, `mediaCache`, and local backup logic.

**Depends on:** ARCH-01.

**Done:** all existing reads/writes still pass through current implementations; restore tests cover cloud/local/IDB reconciliation; no storage format change.

**Risk:** sync ordering and delete-field behavior. Preserve current dotted scene-map patching.

### ARCH-03 — Provider ports + Google/Veo adapter

**Goal:** isolate Google SDK and API-key resolution behind provider interfaces.

**Scope:** introduce `VideoProvider`, `ImageProvider`, `AudioProvider`; wrap existing Gemini/Veo calls; preserve exact polling/backoff, long-wait, retry, seed and metadata semantics.

**Depends on:** ARCH-01.

**Done:** current Veo generation output path is behaviorally equivalent; provider-neutral request/result objects exist; no non-Google adapter is required yet.

**Risk:** operation resume and API model ID aliasing. Test both new and legacy IDs.

### ARCH-04 — Generation job boundary

**Goal:** make generation jobs independent from provider and storage implementation.

**Scope:** adapt `JobManager` to provider/job repository ports while retaining its current concurrency, rate limiting, pause/cancel, resume and upload interactions.

**Depends on:** ARCH-02, ARCH-03.

**Done:** single-scene and batch generation still use one durable job path; no duplicate Veo submission on reload; upload queue remains durable.

**Risk:** job lifecycle race conditions.

### ARCH-05 — Wizard orchestration boundary

**Goal:** reduce `WizardContext`'s role from infrastructure orchestrator to UI state adapter.

**Scope:** introduce application commands/use cases and move orchestration calls behind them incrementally. Do not rewrite Wizard UI.

**Depends on:** ARCH-01..04.

**Done:** UI behavior unchanged; context no longer imports provider-specific implementation details for migrated paths.

**Risk:** stale React refs/state. Keep current refs until use-case state ownership is proven.

## 4. P1 ticket definitions

### PROD-01 — Scene Graph

Canonicalize scene order, cast, world, shot, audio and generated asset references. Existing scene indices remain as compatibility IDs.

**Done:** all current scene serialization maps to graph and back; no export change.

### PROD-02 — Character Bible

Promote character profile/reference images into reusable character entities with identity/voice/style constraints. Existing character fields remain backward-compatible.

**Done:** existing projects render exactly as before; new character objects can be used without requiring a migration of old documents.

### PROD-03 — Asset Library

Introduce asset identity/provenance/type/status and a resolver for local/remote media. Wrap the current media cache/upload queue rather than replacing them.

**Done:** every generated image/audio/video has a stable asset reference while current URLs remain readable.

### PROD-04 — Model capability registry/router

Separate model catalog from executable provider adapters. Add capabilities for aspect ratio, reference images, duration, audio, editing, latency and cost.

**Done:** unsupported model/provider combinations are blocked or explicitly routed; catalog entries no longer imply runtime support.

### PROD-05 — Critic contract

Generalize image Vision Critic into a provider-neutral `CriticResult` contract and add video-quality evaluation inputs.

**Done:** scores and refinement recommendations are persisted with provenance and can be consumed by orchestration.

### PROD-06 — AI Director

Convert project brief → story → scene requirements → model selection → variants → critic → refinement/selection into an explicit application workflow.

**Done:** Director decisions are inspectable, repeatable and bounded by user controls/cost limits; direct provider SDK access is prohibited from Director code.

## 5. P2 ticket definitions

### STUDIO-01 — Production workspace

Evolve the Wizard into a persistent workspace with Brief, Cast, World, Storyboard, Scenes, Timeline and Export surfaces. Existing Wizard remains available during rollout.

### STUDIO-02 — Variants and compare

Generate multiple scene variants, show side-by-side comparisons, record selection and preserve rejected candidates as versioned assets rather than overwriting.

### STUDIO-03 — Timeline/render

Extract a render graph from current FFmpeg functions. Keep browser FFmpeg for supported projects and add server rendering only when browser constraints are proven insufficient.

## 6. P3 ticket definitions

### CLOUD-01 — Server generation API

Move provider calls behind authenticated backend endpoints. Enforce authorization, project ownership, model availability, quota and idempotency at the server boundary. Client keys become development-only.

### CLOUD-02 — Worker-owned long-running jobs

Persist provider operation handles server-side; workers poll or receive provider callbacks. Browser subscribes to job state instead of owning the provider lifecycle.

### CLOUD-03 — Usage/credits/observability

Record provider/model, generation units, duration, estimated/actual cost, retries, latency and failures. Build idempotent usage accounting and structured telemetry.

### CLOUD-04 — Workspace/team/API/webhooks

Add organization/workspace roles, service credentials, API clients, batch generation and webhooks with tenant isolation.

### CLOUD-05 — Billing

Introduce plans, entitlements, credit consumption and payment integration only after usage accounting is authoritative.

## 7. Migration gates

Each ticket must pass these gates before the next architectural layer starts:

1. **Type gate:** TypeScript build succeeds.
2. **Unit gate:** pure mappings/policies are covered by tests.
3. **Behavior gate:** existing Sample, Express/Quick and Wizard flows remain usable.
4. **Recovery gate:** cloud restore, local-only restore, IDB media restore, Veo operation resume and upload retry still work.
5. **Export gate:** FFmpeg export and long-form cleanup still work.
6. **Security gate:** Firestore/Storage ownership rules are unchanged unless a ticket explicitly changes the security boundary.
7. **Compatibility gate:** old project documents can still be opened.

## 8. Recommended implementation order

```text
#208 Audit
  ↓
ARCH-01 Domain contracts
  ↓
ARCH-02 Repository ports ──────┐
  ↓                            │
ARCH-03 Provider ports ────────┤
  ↓                            │
ARCH-04 Generation jobs ◄──────┘
  ↓
ARCH-05 Wizard orchestration
  ↓
PROD-01 Scene Graph
  ↓
PROD-02 Character Bible
  ↓
PROD-03 Asset Library
  ↓
PROD-04 Model Router
  ↓
PROD-05 Critic
  ↓
PROD-06 AI Director
  ↓
STUDIO-01 → STUDIO-02 → STUDIO-03
  ↓
CLOUD-01 → CLOUD-02 → CLOUD-03
  ↓
CLOUD-04 → CLOUD-05
```

## 9. Hard rules for future implementation tickets

- No ticket may rewrite the entire Wizard.
- No ticket may silently change the persisted Firestore scene format before a compatibility mapper exists.
- No provider SDK import is allowed in domain code.
- No new provider may be advertised as executable until its adapter and capability contract exist.
- No client-side provider secret migration is mixed into an unrelated feature ticket.
- Every generation path must have an idempotency strategy before server execution is introduced.
- Existing durable recovery mechanisms are preserved until their replacement has parity tests.
