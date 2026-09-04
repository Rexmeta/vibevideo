# VibeVideo Target Architecture

> Issue #208 — incremental target architecture. The design intentionally preserves current behavior while introducing seams for an AI Video Production OS.

## 1. Target principles

1. **No big-bang rewrite.** Existing Wizard, recovery, generation, upload and FFmpeg paths remain the reference implementation until replacements are proven.
2. **Domain before infrastructure.** Define stable production concepts before moving providers or persistence.
3. **Provider-neutral application layer.** UI/use cases should not know Google SDK types or provider-specific credentials.
4. **Jobs are durable application objects.** A generation request must be resumable independently of a browser tab.
5. **Persistence is an implementation detail.** Firestore/IndexedDB/localStorage remain adapters behind repository/port contracts.
6. **Model catalog and provider execution are separate.** A model can be catalogued without being runtime-enabled.
7. **Preserve the current recovery contract.** Local snapshot + cloud state + media cache + durable upload queue remain supported during migration.

## 2. Target logical architecture

```text
                    VibeVideo Web
                         │
              Presentation / React UI
                         │
                 Application Layer
          ┌──────────────┼──────────────┐
          │              │              │
      Project       Generation      Export
      Use Cases      Use Cases       Use Cases
          │              │              │
          └──────────────┼──────────────┘
                         │
                   Domain Model
     Project / Brief / Scene / Character / Asset
     GenerationJob / CriticResult / ProductionRun
                         │
                 Orchestration Ports
          ┌──────────────┼──────────────┐
          │              │              │
     Model Router     Job Store      Asset Store
          │              │              │
   Provider Ports      Repositories    Cache Ports
          │
   ┌──────┼────────┬─────────┐
   │      │        │         │
  Veo   Runway   Kling   Seedance ...

Infrastructure adapters:
 Firebase / Firestore / Storage / IndexedDB / FFmpeg / server queues
```

## 3. Domain boundary

The first stable domain objects should be:

### Project

Identity, owner, title, lifecycle status and references to production context.

### ProjectBrief

Genre, audience, platform, duration, aspect ratio, visual style, tone, constraints and creative intent. This becomes the persistent context used across AI calls instead of repeatedly reconstructing intent from scattered React state.

### Scene

A production unit containing script segment, visual intent, cast references, location/world references, shot/camera/lighting, duration, transition, selected model strategy and generated assets.

### Character

Identity attributes, reference assets, voice and consistency constraints. Existing `character_profile` and `character_references` can initially map into this object without changing persisted data.

### Asset

A provider-independent reference to image/audio/video/generated source media, its lifecycle, storage location and provenance.

### GenerationJob

Provider-independent request state: job ID, project/scene, stage, provider/model, status, attempts, timestamps, operation handle and result asset.

### CriticResult

Evaluation scores, issues, recommendations, revision relationship and provenance.

## 4. Application/use-case boundary

The UI should eventually invoke use cases such as:

```text
CreateProject
RestoreProject
UpdateProjectBrief
GenerateScript
GenerateStoryboard
GenerateSceneImage
GenerateSceneVideo
GenerateAudio
CritiqueScene
RefineScene
RetryGeneration
ResumeGeneration
ExportProject
```

During migration these use cases can be thin wrappers around existing hooks/services. The goal is to establish stable commands without immediately moving implementation.

## 5. Provider boundary

Introduce provider-neutral contracts:

```ts
interface VideoProvider {
  readonly providerId: string;
  getCapabilities(): VideoCapabilities;
  submit(request: VideoGenerationRequest): Promise<VideoSubmission>;
  getStatus(operation: ProviderOperation): Promise<VideoOperationStatus>;
  cancel?(operation: ProviderOperation): Promise<void>;
}

interface ImageProvider {
  readonly providerId: string;
  getCapabilities(): ImageCapabilities;
  generate(request: ImageGenerationRequest): Promise<GeneratedAsset>;
}

interface AudioProvider {
  readonly providerId: string;
  getCapabilities(): AudioCapabilities;
  synthesize(request: AudioGenerationRequest): Promise<GeneratedAsset>;
}
```

The existing Google/Veo path becomes the first adapter. Its polling, timeout, retry, long-wait and metadata behavior should remain intact behind the adapter.

## 6. Model registry and router

Separate three concepts:

```text
Model Catalog
  = user-visible metadata, pricing/capabilities, active state

Provider Adapter
  = executable integration

Model Router
  = selects an executable model based on scene requirements
```

A model should not be considered executable merely because it exists in `ai_models`.

Initial routing inputs should include:
- scene type and duration
- aspect ratio
- reference-image requirements
- cast consistency requirements
- audio requirement
- desired quality/speed/cost
- provider availability and rate state

The first router version may simply preserve the selected model and fall back only when an explicitly configured capability is unavailable.

## 7. Job architecture

Current browser `JobManager` becomes the reference behavior for a future durable job service:

```text
GenerationJob
   ↓
Job Orchestrator
   ├─ acquire provider/model
   ├─ submit
   ├─ persist provider operation
   ├─ poll / receive callback
   ├─ evaluate result
   ├─ persist asset
   └─ update scene/project
```

Phase 1 can remain browser-executed. Later, the same port can be executed by a backend worker without changing the domain job shape.

## 8. Persistence boundary

Target repository ports:

```ts
interface ProjectRepository {
  get(id: string): Promise<Project>;
  save(project: Project): Promise<void>;
  patch(id: string, patch: ProjectPatch): Promise<void>;
}

interface GenerationJobRepository {
  get(id: string): Promise<GenerationJob | null>;
  save(job: GenerationJob): Promise<void>;
  listActive(projectId?: string): Promise<GenerationJob[]>;
}

interface AssetRepository {
  get(id: string): Promise<Asset | null>;
  save(asset: Asset): Promise<void>;
}
```

Existing Firestore/localStorage/IndexedDB behavior can implement these ports incrementally. No persisted format change is required for the first migration.

## 9. Asset and upload boundary

Keep the existing durable upload queue. Evolve it toward an asset lifecycle:

```text
Generated bytes
   ↓
Local Asset
   ↓
Upload Task
   ↓
Remote Asset
   ↓
Scene asset reference
```

The current `uploadQueue` already provides the critical durability primitive. Its implementation can remain unchanged while an `AssetStore` facade is introduced.

## 10. Recovery boundary

Extract a deterministic reconciliation policy from `useRestore`:

```text
Cloud snapshot ─┐
Local snapshot ─┼─> ReconcileProjectState ─> canonical restored state
IDB metadata ───┘
        + media inventory
```

The policy should be pure and unit-testable. I/O remains in adapters. This preserves current fallback behavior while removing source-selection logic from React.

## 11. Security boundary

Commercial target:

```text
Browser
  ↓ authenticated request
VibeVideo API
  ↓ authorization / quota / audit
Generation service
  ↓ credential resolver
Provider adapter
  ↓
External AI provider
```

Provider credentials must not be required in browser localStorage for server-executed generation. The existing client key path remains supported only as a transitional/development path until the server generation plane is introduced.

## 12. AI Director boundary

AI Director belongs above individual providers:

```text
Project Brief
   ↓
Story / Script
   ↓
Storyboard / Scene Graph
   ↓
Scene requirements
   ↓
Model Router
   ↓
Generate variants
   ↓
Critic
   ↓
Refinement / selection
```

It should consume provider-neutral scene requirements and return production decisions. It must not call provider SDKs directly.

## 13. Transition strategy

### Boundary A — types first

Add domain types and mapping functions while keeping current `Project`/`Scene` persisted structures unchanged.

### Boundary B — repositories

Wrap `storageService`, `mediaCache` and local snapshot behavior. No UI behavior change.

### Boundary C — providers

Wrap current Google/Veo calls. Existing `geminiService` becomes an implementation detail of the Google adapter.

### Boundary D — jobs

Make `JobManager` depend on the provider and job repository ports. Keep browser execution initially.

### Boundary E — orchestration

Move scene-level decisions into use cases and a model router. Keep existing Wizard UI as a client of those use cases.

### Boundary F — backend

Move provider execution behind authenticated server APIs and worker processes. Browser remains responsible for presentation, preview and eventually local export where appropriate.

## 14. Non-goals for the first migration

Do not initially:
- rewrite all React components
- rename every persisted field
- replace Firestore
- remove IndexedDB
- remove FFmpeg.wasm
- integrate every catalogued provider
- build billing
- build a timeline editor
- redesign the Wizard UI

The architecture is successful if each boundary can be introduced and regression-tested independently.
