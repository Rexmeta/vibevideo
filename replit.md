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
  - **Negative Prompt**: Project-level field plumbed through both image and video generation; only applied for models whose adapter capability flag enables it.
  - **Backward Compatibility**: `migrateSceneFields` fills in missing shotlist defaults on restored scenes; all new Project fields are optional so legacy projects open without migration.
  - Real API calls remain Google-only; `promptAdapter` is interface-only for non-Google providers (still falls back to Gemini at the network layer).
- **Dual Video Modes**: Two video creation paths selectable in Step 1:
  - **AI Video Mode** (`ai`): Uses AI models (Veo) for per-scene video generation with motion.
  - **Presentation Mode** (`presentation`): Creates video from generated images with configurable transitions (fade, wipe, slide, circle, smooth), motion effects (zoom-in/out, pan directions), and Canvas-based text overlays with Korean font support. In this mode, Step 5 shows per-scene transition/motion/text config instead of AI video generation; the video model selector is hidden; and the export step renders the final video via `renderPresentationVideo` in `videoMergeService.ts`.

### System Design Choices
- **Firestore Structure**: A flat `projects` collection is used, with one document per project. Each project document includes summary fields (`scene_count`, `total_duration`) to avoid loading full scenes for list views.
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