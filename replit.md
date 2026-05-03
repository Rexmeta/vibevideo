# VibeVideo AI

## Overview
VibeVideo AI is a React + TypeScript frontend application designed for AI-powered video generation. It enables users to create videos from various inputs like text, images, or audio clips using advanced AI models. The project aims to provide a seamless and robust platform for AI-driven media creation, leveraging Firebase for core services and Google's Gemini API for AI functionalities.

## User Preferences
No specific user preferences were provided in the original `replit.md` file. The user is expected to provide these during the interaction.

## System Architecture
The application is built with React 18 and TypeScript, using Vite 5 as the build tool. Styling is handled by Tailwind CSS, loaded via CDN. Firebase is extensively used for authentication, Firestore (database), and Storage. The core AI capabilities are powered by the Google Gemini API.

### UI/UX Decisions
- **General Design**: The application incorporates a clear, step-by-step wizard for project creation (`ProjectWizard.tsx`).
- **Admin Interface**: An `AdminPage.tsx` exists for managing AI models, providing CRUD operations, toggling activity, searching, and resetting models.
- **Navigation**: A `NavBar.tsx` includes dynamic links, such as an admin link for authenticated admin users.
- **Project Management**: `ProjectManagement.tsx` offers a paginated list of projects with a "더 보기" (Load More) button.

### Technical Implementations
- **Routing**: `App.tsx` handles main application routing, including a dedicated admin route.
- **State Management**: React's built-in hooks are used for component state.
- **Media Handling**: `mediaCache.ts` utilizes IndexedDB for caching large base64 media data, enhancing performance and offline capabilities.
- **Video Processing**: `videoMergeService.ts` integrates `FFmpeg.wasm` for in-browser video merging and scene concatenation.
- **AI Model Management**: `modelService.ts` handles CRUD operations for AI models, persisting data in Firestore and localStorage, and seeding default models.
- **Cost Estimation**: `services/pricing.ts` holds approximate per-call USD prices for image, video, and vision-critic models. Step 4 and Step 6 cost chips multiply generation counters by these prices to surface an estimated USD spend with a tooltip clarifying it is an approximation.
- **Data Persistence**: Firebase Firestore is used with offline persistence enabled for multi-tab support.
- **Storage**: Firebase Storage manages media uploads, with structured paths and robust retry mechanisms.

### Feature Specifications
- **AI Model Selection**: Users can select specific AI models for image and video generation within the `ProjectWizard`.
- **Character Consistency**: The system supports maintaining character consistency across scenes by injecting character descriptions into prompts and using reference images.
- **Audio Source Selection**: Users choose between Veo 3.1 built-in audio (default, with lip-sync/SFX/BGM) or separate TTS narration. When Veo audio is selected, Step 3 can be skipped and TTS audio sync/merge overlay is disabled.
- **Per-Model API Key Management**: Admin page includes an "API 설정" tab for managing provider-level and per-model API keys. Keys are stored in localStorage (not Firestore) for security. Priority chain: model-specific key > provider key > global env API_KEY. `apiKeyService.ts` handles storage; `geminiService.ts` uses `getApiKeyForModel` to resolve the correct key. Non-Google providers that fall back to Google API always use the global key.
- **Scene Duration Config**: Users set script length by total time (slider, 8-120s) or by scene count (2-10 cuts, 8s each). Both modes sync bidirectionally.
- **Video & Audio Merging**: Facilitates merging per-scene video and audio into a single MP4 file client-side.
- **Project Save/Restore**: Robust system to save project progress, including generated media, to Cloud, IndexedDB, and localStorage with conflict detection and priority-based restoration.
- **Parallel Processing**: Audio, image, and video generation tasks run in parallel (with limits) to improve performance, including per-scene error tracking and retry mechanisms.
- **Export Features**: Comprehensive export options, including individual scene downloads and full project video downloads.
- **Director Pipeline (Task #6)**: Quality-focused refactor of the generation pipeline:
  - **Genre & Platform Presets** (`services/presets.ts`): 5 genres (ad/explainer/story/vlog/social-hook) and 5 platforms (YouTube Shorts/TikTok/Reels/YouTube 16:9/Instagram 1:1) selectable in Step 1. Selecting a platform auto-applies aspect ratio, duration, and scene count.
  - **2-Pass Script** (`generateScriptOutline` + `generateScript`): First pass produces a JSON outline (hook + beats + optional CTA), second pass writes the spoken script grounded in that outline. The first sentence is always a pattern-interrupt hook.
  - **Shotlist-Based Scene Segmentation** (`segmentScriptIntoScenes`): Each scene now carries `shotType`, `cameraMovement`, `lighting`, `durationSec`, `beatRole`, `transitionTo`. The first scene is always tagged `hook`.
  - **StyleSheet** (`generateStyleSheet`): Auto-extracted after segmentation — palette of 5 hex colors + lighting + mood. Editable inline in Step 4. Injected into every image and video prompt for cross-scene consistency.
  - **Model-Aware Prompt Adapter** (`services/promptAdapter.ts`): `gemini-image` / `veo` / `generic-cinematic` targets with capability flags (e.g. negative prompt support). Builds the per-model prompt from {shot, styleSheet, characterProfile, negativePrompt, audioScript, continuity}.
  - **Vision Critic** (`services/visionCritic.ts`): Optional Gemini multimodal scorer that grades each generated image on character consistency, composition, and intent alignment (0–10 each). If overall < 6, automatically refines once using the issue list as a director note. Toggleable in Step 1; default ON. Score badge shown on each scene card with a hover tooltip listing axes + issues. When a character reference image is set, the critic receives it as a second image part and uses it as the ground truth for `characterConsistency`.
  - **Character Reference Image Lock (Task #12)**: Project-level `character_reference_image` (data URL or http URL) settable in Step 1 via upload or "AI로 자동 생성" (which calls the image model with a portrait prompt derived from the character profile). When set, `generateSceneImage` injects it as an additional `inlineData` part for `gemini-2.5-flash-image`, and the prompt adapter prepends a "match the attached reference" directive so every scene depicts the SAME character (face/hair/clothing/identity). A small reference-locked badge also appears on Step 4 above the StyleSheet panel, with a remove button.
  - **Character Reference Image in Video (Task #14)**: `generateSceneVideo` now also accepts the project-level reference via `GenerateVideoOptions.referenceImage`. ProjectWizard's batch and single-video handlers pass `characterReferenceImage` through. When a per-scene seed image already exists it is still preferred (it already encodes both the reference identity and the scene composition), but when no per-scene image exists Veo is seeded with the reference image instead of going text-only. The Veo prompt adapter (`buildVeoPrompt`) also receives `hasReferenceImage` and adds an explicit "the attached still shows the locked main character — animate the SAME person" directive whenever a reference is in play.
  - **Per-Character Cast (Task #15)**: Project-level `character_references: { name, description?, imageUrl }[]` array for stories with multiple recurring characters (host+guest, hero+villain, etc). New "Cast (Multiple Characters)" section in Step 1 lets users add/remove named entries with thumbnails (upload or AI-generate). `segmentScriptIntoScenes` receives the cast and tags each scene with a `characters: string[]` subset. `generateSceneImage` accepts `referenceImages: NamedReferenceImage[]`; for each scene it attaches only the references whose names are tagged on that scene (Gemini supports multiple `inlineData` parts), and the prompt adapter mentions the named cast and the order of attached refs. The single-character `character_reference_image` flow remains unchanged for backward compatibility — when a project has both, the main reference is attached first and named cast refs follow.
  - **Per-Scene Veo Seed Selection (Task #27)**: Each scene now carries an optional `videoSeedSource` field (`'scene' | 'reference' | 'text-only'`). Step 5 video cards expose a 3-button toggle ("씬 이미지" / "캐릭터 레퍼런스" / "텍스트만") that updates the field per scene. Default is `'scene'` which keeps the previous behavior (per-scene image preferred, falling back to character reference). `'reference'` forces the locked character reference even when a scene image exists (useful when the scene image drifted from the locked identity). `'text-only'` suppresses any seed image. `GenerateVideoOptions.seedSource` plumbs the choice into `generateSceneVideo`, and both `handleSingleVideo` and `handleBatchVideos` pass `s.videoSeedSource` through.
  - **Negative Prompt**: Project-level field plumbed through both image and video generation; only applied for models whose adapter capability flag enables it.
  - **Backward Compatibility**: `migrateSceneFields` fills in missing shotlist defaults on restored scenes; all new Project fields are optional so legacy projects open without migration.
  - Real API calls remain Google-only; `promptAdapter` is interface-only for non-Google providers (still falls back to Gemini at the network layer).
- **Wizard Context Modularization (Task #47)**: The wizard's central provider (`components/wizard/WizardContext.tsx`) was reduced from ~1860 lines to ~570 by splitting action handlers into focused hooks under `components/wizard/hooks/`: `useAudioActions`, `useImageActions`, `useVideoActions`, `useExportActions`, `usePresentationActions`, `useAudioVideoSync`, `useSync` (sync + unmount flush), `useRestore` (cloud/local/IndexedDB hydration), and shared pure helpers/constants in `wizardHelpers.ts`. The `WizardContextValue` interface lives in `components/wizard/wizardTypes.ts` and is re-exported from `WizardContext.tsx` so existing consumers (`useWizard`, `WizardContextValue`) keep working unchanged. Behavior is preserved exactly, including the empty-deps unmount cleanup that intentionally captures initial values for non-ref props.
- **Dual Video Modes**: Two video creation paths selectable in Step 1:
  - **AI Video Mode** (`ai`): Uses AI models (Veo) for per-scene video generation with motion.
  - **Presentation Mode** (`presentation`): Creates video from generated images with configurable transitions (fade, wipe, slide, circle, smooth), motion effects (zoom-in/out, pan directions), and Canvas-based text overlays with Korean font support. In this mode, Step 5 shows per-scene transition/motion/text config instead of AI video generation; the video model selector is hidden; and the export step renders the final video via `renderPresentationVideo` in `videoMergeService.ts`.

### System Design Choices
- **Firestore Structure**: A flat `projects` collection is used, with one document per project. Each project document includes summary fields (`scene_count`, `total_duration`) to avoid loading full scenes for list views.
- **My Projects Sync (Task #74)**: The `ProjectManagement` page paints from a slim local card cache (`vibe_video_card_<id>`) immediately, then concurrently hits Firestore's persistent local cache (`getProjectsPageFromCache`) and the server. The server fetch path uses the Firestore REST API's `runQuery` endpoint with a `select.fields` field mask listing only the card fields (no `saved_scenes`), so the cloud→client payload is reduced at the network layer rather than after download. Failures fall through to the SDK `getDocs` path (compound, then simple) as a backstop. Server fetch retries up to 2 times with 500ms/1500ms backoff before falling back to an "오프라인 모드" yellow banner with a "다시 시도" button. The offline banner is suppressed when the user has 0 projects so first-time users aren't told the workspace is offline. The wizard's `useSync` remains the sole writer of the full `vibe_video_backup_<id>`. Pagination uses an `updated_at` string cursor (`PaginatedResult.cursor`). Card-cache writes and the orphaned `vibe_video_mode_pref_<id>` cleanup full-scan run via `requestIdleCallback` after first paint; the cleanup full-scan is throttled to once per day per user via `vibe_modepref_cleanup_<uid>`. `[Sync Timing]` console logs report local first-paint, cache first-paint, and server-arrival times.
- **Firestore Indexes**: `firestore.indexes.json` declares the composite `(user_id ASC, updated_at DESC)` index on `projects`. Deploy with `firebase deploy --only firestore:indexes` (see `docs/firestore-deploy.md`). The composite is required by both the REST `runQuery` path and the SDK fallback. If the index is missing, the SDK simple-query backstop runs `where(user_id) + limit(100)` with client-side sort and emits a console warning.
- **Conflict Detection**: A `version` field and Firestore transactions are used for optimistic concurrency control.
- **Storage Strategy**: Blob-based uploads with aggressive caching headers and recursive cleanup for deleted projects.
- **Client-Side Caching**: A multi-layered approach combines IndexedDB for large media, localStorage for light metadata, and Firestore's SDK persistence.
- **Security Rules**: Firestore and Storage rules are configured to ensure that users can only access their own project data.

## External Dependencies
- **Firebase**:
    - **Authentication**: User authentication.
    - **Firestore**: NoSQL database for project data storage and retrieval.
    - **Storage**: Blob storage for images, audio, and video files.
- **Google Gemini API**: (@google/genai) Used for AI-powered text-to-speech (TTS), image generation, and video generation.
    - **TTS Models**: `gemini-2.5-flash-preview-tts`
    - **Image Models**: `gemini-2.5-flash-image`
    - **Video Models**: `veo-3.1-fast-generate-preview`
- **FFmpeg.wasm**: Integrated via `@ffmpeg/ffmpeg` and `@ffmpeg/util` for client-side video and audio processing.
- **Lucide React**: For icons used throughout the application.
- **Vite**: Build tool for the React application.
- **Tailwind CSS**: Utility-first CSS framework for styling.