# VibeVideo Current-State Architecture Audit

> Issue #208 — evidence-based audit of the current repository. No application code or runtime behavior is changed by this audit.

## 1. Executive summary

VibeVideo is currently a browser-first React/Vite production workflow rather than a simple single-shot generator. The main production surface is `ProjectWizard`, whose state is centralized in `WizardContext` and whose actions are split across hooks for restore/sync, presentation, audio, image, video, and export. `App.tsx` owns application routing, authentication, API-key discovery, and startup recovery.

The strongest existing production foundations are already present: durable local snapshots, Firestore persistence, IndexedDB media caching, persisted Veo operation handles, a global video `JobManager`, and a durable upload queue. These should be preserved during commercialization.

The principal architectural constraint is coupling. `WizardContext` owns a large mutable state graph and injects it into many hooks; `geminiService.ts` directly constructs `GoogleGenAI` and resolves API keys in the browser; `jobManager.ts` directly depends on Gemini/Veo generation plus Firestore/storage/cache services; and `storageService.ts` combines repository behavior, Firestore health handling, serialization/sanitization, local cache behavior, and Storage uploads. `modelService.ts` is a catalog plus Google-specific model-ID migration layer, not yet a provider abstraction.

## 2. Application entry and UI ownership

### `App.tsx`

`App.tsx` owns:
- top-level `ViewState` routing
- current project ID and wizard session key
- new-project modal and Express mode
- Firebase auth subscription
- API-key availability probe and AI Studio host bridge integration
- startup recovery ordering (`uploadQueue.resumeAll()` then `jobManager.autoResumePendingOperations()` then interrupted-card hydration)
- top-level API-key and Firebase configuration banners
- mounting of `ProjectWizard`, project management, profile, pricing, admin/API-key and auth views

The component is therefore an application shell plus several cross-cutting policy decisions. It is not yet a pure route/layout component.

### `ProjectWizard` / `WizardContext`

`WizardContext` is the effective application state owner for the production workflow. It owns step/max-step, project configuration, script, scenes, model selections, context-pack linkage, processing state, restore/sync state, preview state, export state, and cross-cutting refs.

The context delegates action implementations to:
- `useRestore`
- `useSync`
- `usePresentationActions`
- `useAudioActions`
- `useImageActions`
- `useVideoActions`
- `useExportActions`
- `useAudioVideoSync`

This is a useful decomposition at the hook level, but the context remains a large orchestration boundary because all hooks receive state, setters, refs and callbacks from it.

## 3. End-to-end execution flow

```text
App
 ├─ auth state / API key probe / startup recovery
 └─ ProjectWizard
     └─ WizardProvider / WizardContext
         ├─ Restore existing project
         ├─ configure project / mode
         ├─ generate script + outline
         ├─ generate shot list / scene metadata
         ├─ generate reference / scene images
         │    └─ Gemini image calls + Vision Critic/refine
         ├─ generate audio/TTS
         │    └─ Gemini TTS / PCM→WAV
         ├─ generate videos
         │    └─ JobManager → geminiService → Veo operation polling
         │         └─ video blob → IndexedDB cache + uploadQueue → Firebase Storage
         ├─ preview / audio-video synchronization
         └─ FFmpeg export / merge
```

### Script and scene planning

`geminiService.ts` owns script generation and outline generation through `GoogleGenAI`. It also contains shot-list generation and scene-field migration logic. The current workflow is therefore AI-planning plus production metadata generation in one service module.

### Image generation and critique

The image path is routed through `geminiService.ts`, with project style/reference context and model selection. `visionCritic.ts` supplies image quality evaluation and refinement hints. The resulting scene image can become the seed for video generation.

### Video generation

`useVideoActions.ts` separates blob-only re-upload work from actual generation. Actual video generation is delegated to the singleton `jobManager`.

`jobManager.ts` owns:
- queueing and dispatch
- concurrency (1–3, persisted in localStorage)
- per-model rate budget
- pause/cancel lifecycle
- per-scene state
- persisted `GenerationRun`
- resume of persisted Veo operations
- interaction with `generateSceneVideo`
- interaction with IndexedDB media cache and Firebase Storage upload queue
- estimated pricing metadata

The current provider implementation underneath this path is effectively Google/Veo even when the model catalog contains non-Google video entries. `modelService.ts` explicitly documents that many non-Google IDs are marketing aliases and that actual provider integration remains future work.

### Audio/TTS

`geminiService.ts` constructs `GoogleGenAI` directly for Gemini calls. TTS output is converted from PCM to WAV in the browser and is then passed into the existing persistence/media workflow.

### Export

`videoMergeService.ts` owns browser-side FFmpeg/WASM lifecycle, caption frame generation, audio/video composition, long-form part concatenation and memory cleanup. The implementation includes a bundled FFmpeg core with CDN fallback and explicit termination between long-form chunks.

## 4. State ownership map

| State / concern | Current owner | Persistence | Main risk |
|---|---|---|---|
| Route/view | `App.tsx` | none | shell carries policy logic |
| Auth user | `App.tsx` / Firebase Auth | Firebase Auth | global dependency |
| Project wizard state | `WizardContext` | refs + sync | very large state owner |
| Scenes | `WizardContext` | Firestore map + local snapshot + IDB media | multiple representations |
| Restore state | `useRestore` | cloud/local/IDB | source reconciliation heuristic |
| Sync/debounce | `useSync` | Firestore + localStorage + IDB | dual local/cloud semantics |
| Long-running video jobs | `jobManager` | Firestore `generation_run` + memory | browser process lifetime |
| Pending uploads | `uploadQueue` | IndexedDB | browser/device scoped |
| Generated media cache | `mediaCache` | IndexedDB | device scoped, storage quota |
| Model catalog | `modelService` | Firestore/localStorage | catalog is not provider runtime |
| API keys | `apiKeyService` | browser localStorage / env | client-side secret exposure |
| Export state | `WizardContext` + export hook | memory / browser download | browser resource limits |

## 5. Persistence and recovery

### Firestore

`storageService.ts` is the primary cloud persistence layer. Projects are stored under `/projects/{projectId}` and scene data is represented as `saved_scenes_map.{NN}` dotted fields to avoid oversized document writes. Scene payloads are sanitized before cloud persistence; local-only `data:`, base64 and `blob:` media URLs are excluded from cloud scene fields.

Firestore is configured with persistent local cache and multi-tab support in `firebaseConfig.ts`.

### localStorage

Local storage currently serves several distinct purposes:
- project card/index cache
- full/compact project backup (`vibe_video_backup_*`)
- model catalog cache
- model/provider API keys and endpoints
- job concurrency preference
- interrupted-job bookkeeping

This makes localStorage a mixed configuration + cache + recovery store rather than a narrowly defined persistence layer.

### IndexedDB

Two separate databases exist:
- `vibe_video_media`: generated media and project metadata
- `vibe_upload_queue`: durable pending video uploads

`mediaCache.ts` stores audio/image/video as data URLs keyed by project/scene/type. `uploadQueue.ts` stores actual video `Blob`s and retry metadata.

### Recovery sequence

`App.tsx` deliberately starts recovery in this order after authentication:
1. resume durable upload queue
2. auto-resume persisted Veo operations
3. hydrate remaining interrupted project cards

`useRestore.ts` then compares Cloud, localStorage and IndexedDB project metadata. It selects the richest project using a score based on max step, scene count, media count and content, then merges missing HTTP media and scene text across available sources. If cloud/local project data has no scenes but IndexedDB has media, it synthesizes scene slots and repopulates cached media.

This recovery behavior is valuable but is also an important future boundary: reconciliation is currently embedded in UI hook logic rather than an explicit persistence/recovery domain service.

## 6. API/provider boundary

`geminiService.ts` is both AI application service and provider client. It:
- creates `GoogleGenAI`
- obtains effective API keys
- contains Google-specific model aliases
- builds prompts
- calls Gemini text/image/TTS/Veo
- handles retries/timeouts/error normalization
- performs Veo polling
- converts media formats

`modelService.ts` maintains a catalog of image/video/audio models, but catalog identity (`provider`, `modelId`) is not a runtime provider contract. Many non-Google video models are selectable in the catalog while their runtime path is not implemented as an independent adapter.

## 7. Security and operational boundary

### Browser API keys

`apiKeyService.ts` stores provider/model API keys in localStorage and can also read `process.env.API_KEY`. `geminiService.ts` consumes those keys directly in the browser. `App.tsx` also integrates the AI Studio host key picker.

This is acceptable for an AI Studio/prototype environment but is a commercialization blocker for a multi-user SaaS architecture because provider credentials and provider invocation policy are client-resident.

### Authorization

Firestore rules require signed-in users to own project documents. Storage rules restrict `users/{uid}/...` objects to the same authenticated UID. Admin model writes are guarded by an `/admins/{uid}` document, while client-side admin UID local storage is explicitly treated only as a UI hint.

### Observability

The current system has console logging, friendly error normalization, persisted operation metadata, estimated cost metadata and upload retry telemetry. There is no repository-level evidence of a dedicated structured application telemetry, tracing, provider usage accounting or server-side job monitoring boundary.

## 8. Current architectural hotspots

1. **`WizardContext` is the largest state/orchestration hub.** It passes many setters/refs into hooks and remains the implicit domain coordinator.
2. **`geminiService.ts` is a provider + prompt + application service monolith.** Provider calls cannot yet be swapped independently.
3. **`storageService.ts` is a persistence/repository + serialization + health + Storage module.** This mixes cloud persistence policy with infrastructure mechanics.
4. **`jobManager.ts` has strong infrastructure coupling.** It directly knows about Gemini/Veo, Firestore, media cache, upload queue, context packs and pricing.
5. **`apiKeyService.ts` creates a browser-secret boundary.** Moving generation server-side later will require a clean credential abstraction rather than changing every caller.
6. **Model catalog and runtime provider are different concepts.** Selecting a catalog entry does not guarantee that provider is actually integrated.
7. **Recovery is sophisticated but heuristic.** Cloud/local/IDB reconciliation should become an explicit domain/infrastructure policy.

## 9. Protected behavior for subsequent migrations

The following are regression-critical and must remain behaviorally equivalent during architecture work:
- Sample project works without authentication/cloud calls.
- Express/Quick mode preserves its preset behavior.
- Existing projects restore their saved step and scene state.
- Cloud-disabled/local-only recovery works.
- Fast tab-close still leaves an immediately usable local snapshot.
- Persisted Veo operations resume after reload.
- Pending video uploads retry durably and do not cause duplicate Veo generation.
- Single-scene and batch video generation share the durable job path.
- FFmpeg export, caption rendering, long-form part rendering and memory cleanup continue to work.
- Firestore/Storage ownership rules remain enforced.

## 10. Audit conclusion

The repository is not a candidate for a big-bang rewrite. It already contains several production-oriented mechanisms that should become the foundation of the commercial architecture. The correct migration strategy is to introduce explicit domain contracts around the existing implementation, then wrap existing Google/Veo behavior behind provider interfaces, then extract job orchestration and persistence boundaries, and only after those seams are stable introduce multi-provider routing, AI Director and a server-side generation plane.
