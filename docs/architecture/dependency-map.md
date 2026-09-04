# VibeVideo Dependency Map

> Issue #208 — current-state dependency map. This document describes actual repository coupling; it is not a proposed implementation.

## 1. High-level dependency graph

```text
App.tsx
 ├─ Firebase Auth
 ├─ apiKeyService
 ├─ jobManager ───────────────┐
 ├─ uploadQueue ──────────────┤
 └─ ProjectWizard             │
      └─ WizardContext         │
          ├─ useRestore ──────┼─ storageService
          ├─ useSync ──────────┼─ storageService
          ├─ useImageActions ──┼─ geminiService
          ├─ useVideoActions ──┼─ jobManager
          ├─ useAudioActions ──┼─ geminiService
          ├─ useExportActions ─┼─ videoMergeService
          └─ useAudioVideoSync │
                               │
jobManager ────────────────────┤
 ├─ geminiService              │
 ├─ storageService             │
 ├─ mediaCache                 │
 ├─ uploadQueue                │
 ├─ contextPackService         │
 └─ pricing                    │
                               │
 geminiService ────────────────┤
 ├─ apiKeyService              │
 ├─ presets / promptAdapter    │
 └─ visionCritic               │
                               │
 storageService ───────────────┼─ Firebase Firestore
 └─────────────────────────────┼─ Firebase Storage

firebaseConfig
 ├─ Firebase App
 ├─ Firestore persistent cache
 ├─ Storage
 └─ Auth
```

## 2. Layering assessment

| Current layer | Main files | Actual responsibility | Target boundary |
|---|---|---|---|
| App shell | `App.tsx` | routing, auth, API-key probe, startup recovery | application shell + route composition |
| UI | `components/*` | screens and wizard UI | presentation |
| Wizard state | `components/wizard/WizardContext.tsx` | domain state, orchestration, persistence wiring | application state/controller |
| Wizard actions | `components/wizard/hooks/*` | generation, restore, sync, export | use cases |
| AI service | `services/geminiService.ts` | Gemini/Veo client + prompts + retries + media conversion | provider adapters + AI use cases |
| Model catalog | `services/modelService.ts` | model catalog, migration, admin persistence | model registry |
| Jobs | `services/jobManager.ts` | queue, concurrency, rate limiting, durable resume | job orchestration |
| Persistence | `services/storageService.ts` | Firestore CRUD, scene serialization, Storage upload, health | repositories + storage adapter |
| Local media | `services/mediaCache.ts` | IndexedDB media/meta cache | local cache adapter |
| Upload reliability | `services/uploadQueue.ts` | durable IndexedDB upload queue | upload job adapter |
| Export | `services/videoMergeService.ts` | browser FFmpeg rendering | render/export engine |
| Security | Firebase rules + `apiKeyService.ts` | auth ownership + browser credentials | server credential boundary |

## 3. Critical coupling hotspots

### H1 — WizardContext → everything

`WizardContext.tsx` owns many independent state slices and refs and passes a broad dependency object into each action hook. This is the largest coupling hub. Any new domain model introduced too early must avoid mirroring every React setter one-for-one.

**Migration seam:** introduce domain snapshots/commands while retaining context as an adapter until consumers migrate.

### H2 — geminiService → Google SDK

`geminiService.ts` imports `GoogleGenAI`, resolves browser API keys and contains Google-specific model IDs. This is the most important provider seam.

**Migration seam:** provider interface should accept provider-neutral generation requests and return provider-neutral operation/result objects; existing Google implementation can remain internally unchanged first.

### H3 — jobManager → Gemini + persistence

`jobManager.ts` imports `generateSceneVideo`, project persistence functions, media cache, upload queue and pricing. It therefore combines application orchestration with infrastructure.

**Migration seam:** keep JobManager behavior stable first; inject a video-generation port and persistence/update ports later.

### H4 — storageService → multiple persistence concerns

`storageService.ts` handles Firestore configuration/health, project CRUD, scene-map serialization, local cache/card behavior and Firebase Storage uploads.

**Migration seam:** introduce repository interfaces over existing functions before splitting the implementation module.

### H5 — browser API key storage

`apiKeyService.ts` stores model/provider credentials in localStorage and `geminiService.ts` uses them directly. `App.tsx` also knows about AI Studio's host bridge.

**Migration seam:** introduce a credential provider interface. Do not move keys as part of this audit; keep behavior unchanged until a server-side execution plane exists.

### H6 — model catalog ≠ runtime provider

`modelService.ts` exposes many providers/models, but the runtime video path is not a corresponding set of independent adapters. Its own source comments identify many non-Google video IDs as aliases/future integrations.

**Migration seam:** define provider capabilities and runtime support separately from catalog metadata.

### H7 — recovery policy embedded in hooks

`useRestore.ts` decides which persistence source wins and synthesizes scene slots from IndexedDB. `App.tsx` orders upload/job recovery. This is robust behavior but not a reusable recovery domain service.

**Migration seam:** extract a pure reconciliation policy first; keep existing I/O functions unchanged.

## 4. Data-flow map

```text
User action
  ↓
Wizard UI
  ↓
WizardContext state
  ↓
Action hook
  ├─ AI request → geminiService → Google SDK → Gemini/Veo
  │                    ↓
  │              generated media
  │                    ↓
  │              mediaCache (IDB)
  │                    ↓
  │              uploadQueue (IDB durable queue)
  │                    ↓
  │              storageService → Firebase Storage
  │                    ↓
  │              scene/project persistence → Firestore
  │
  └─ export request → videoMergeService → FFmpeg.wasm → browser download
```

## 5. State and persistence matrix

| Artifact | In-memory | localStorage | IndexedDB | Firestore | Storage |
|---|---:|---:|---:|---:|---:|
| Wizard config | ✓ | backup | project meta | ✓ | - |
| Scene metadata | ✓ | compact backup | project meta | `saved_scenes_map` | - |
| Scene image | ✓ | marker only | ✓ | path only | ✓ when uploaded |
| Scene audio | ✓ | marker only | ✓ | path only | ✓ when uploaded |
| Scene video | ✓ | marker only | ✓ | path/meta | ✓ |
| Veo operation | job memory | interruption bookkeeping | - | `generation_run` | - |
| Pending upload Blob | ✓ | - | ✓ | retry telemetry | - |
| Model catalog | ✓ | ✓ | - | ✓ | - |
| Provider/model API key | - | ✓ | - | - | - |
| Export/FFmpeg state | ✓ | - | - | - | browser output |

## 6. Key browser/runtime boundaries

### API key boundary

```text
Browser localStorage
  ↓
apiKeyService
  ↓
geminiService
  ↓
GoogleGenAI SDK
  ↓
Gemini / Veo
```

This is the clearest commercialization boundary because a browser client can inspect localStorage and runtime network requests. It must eventually become:

```text
Browser
  ↓ authenticated generation request
Backend generation API
  ↓ credential vault / server secret
Provider adapter
  ↓
Gemini / Veo / other providers
```

### Long-running operation boundary

```text
JobManager (browser)
  ↓ submit
Veo operation name
  ↓ persisted
Firestore generation_run.operations
  ↓ reload
App startup
  ↓
JobManager.autoResumePendingOperations()
  ↓ poll
Veo
```

This is a good conceptual job boundary already, but the executor still lives in the browser. Commercialization should preserve the persisted operation model while eventually allowing server-side workers to own long-running provider jobs.

### Upload boundary

```text
Generated Blob
  ↓
UploadQueue
  ├─ IndexedDB durable state
  ├─ exponential backoff
  └─ Storage upload
       ↓
Firebase Storage URL
       ↓
scene.video_path + video_meta
```

The queue is a valuable reliability mechanism and should not be removed during provider/backend migration.

## 7. Security rules boundary

Firestore project ownership is enforced by authenticated `user_id` matching. Storage ownership is enforced by `users/{uid}/...` path ownership. Admin model writes require an `/admins/{uid}` Firestore document. This is materially stronger than relying on client-side admin flags, which the code explicitly treats as UI hints only.

## 8. Risk legend

- **Critical:** blocks safe commercialization or creates architectural rewrite risk.
- **High:** substantial coupling or reliability/security risk.
- **Medium:** maintainability/scale limitation but can be deferred.
- **Low:** local cleanup opportunity.

| Hotspot | Severity | Why |
|---|---|---|
| Browser provider API keys | Critical | credentials and provider execution are client-resident |
| Google-specific `geminiService` | Critical | blocks real provider substitution |
| WizardContext state hub | High | domain evolution propagates through React setters/refs |
| JobManager infrastructure coupling | High | orchestration cannot be reused server-side cleanly |
| Persistence mixed responsibilities | High | repository migration becomes harder |
| Catalog/runtime mismatch | High | selectable model does not imply implemented provider |
| Browser FFmpeg | Medium | long-form rendering constrained by browser memory/runtime |
| Recovery policy in UI hooks | Medium | difficult to test independently |
