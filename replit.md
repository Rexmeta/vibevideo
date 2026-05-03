# VibeVideo AI

## Overview
VibeVideo AI is a React + TypeScript frontend application for AI-powered video generation. It allows users to create videos from various inputs like text, images, or audio using advanced AI models. The platform aims to provide a seamless and robust experience for AI-driven media creation, utilizing Firebase for core services and Google's Gemini API for AI functionalities. The project seeks to lead in AI-powered creative tools, offering significant market potential in digital content creation.

## User Preferences
No specific user preferences were provided in the original `replit.md` file. The user is expected to provide these during the interaction.

## System Architecture
The application is built with React 18 and TypeScript, using Vite 5. Styling is managed by Tailwind CSS. Firebase provides authentication, Firestore (database), and Storage. AI capabilities are powered by the Google Gemini API.

### UI/UX Decisions
- **General Design**: Features a step-by-step wizard for project creation and an `AdminPage` for managing AI models.
- **Navigation**: A dynamic `NavBar` includes an admin link for authenticated users.
- **Project Management**: `ProjectManagement` displays a paginated list of projects.

### Technical Implementations
- **Routing**: `App.tsx` handles main application routing, including an admin route.
- **State Management**: React hooks are used for component state.
- **Media Handling**: `mediaCache.ts` uses IndexedDB for caching large base64 media data.
- **Video Processing**: `videoMergeService.ts` integrates `FFmpeg.wasm` for in-browser video merging.
- **AI Model Management**: `modelService.ts` handles CRUD operations for AI models, persisting data in Firestore and localStorage.
- **Cost Estimation**: `services/pricing.ts` provides approximate per-call USD prices for AI generations, displayed as estimated costs in the wizard.
- **Data Persistence**: Firebase Firestore is used with offline persistence enabled.
- **Storage**: Firebase Storage manages media uploads with structured paths and retry mechanisms.
- **AI Model Selection**: Users select AI models for image and video generation within the `ProjectWizard`.
- **Character Consistency**: Supports maintaining character consistency across scenes using injected descriptions and reference images.
- **Audio Source Selection**: Users choose between Veo 3.1 built-in audio or separate TTS narration.
- **Per-Model API Key Management**: Admin page allows managing provider and per-model API keys stored in localStorage.
- **Scene Duration Config**: Users can set script length by total time (8-120s) or by scene count (2-10 cuts, 8s each).
- **Video & Audio Merging**: Client-side merging of per-scene video and audio into a single MP4.
- **Project Save/Restore**: Robust system for saving and restoring project progress to Cloud, IndexedDB, and localStorage with conflict detection.
- **Parallel Processing**: Audio, image, and video generation tasks run in parallel to improve performance.
- **Export Features**: Supports individual scene downloads and full project video downloads.
- **Director Pipeline**: A quality-focused generation pipeline featuring:
    - **Genre & Platform Presets**: 5 genres and 5 platforms with auto-applied aspect ratio, duration, and scene count.
    - **2-Pass Script**: Generates a JSON outline then a spoken script.
    - **Shotlist-Based Scene Segmentation**: Each scene includes `shotType`, `cameraMovement`, `lighting`, `durationSec`, `beatRole`, `transitionTo`.
    - **StyleSheet**: Auto-extracted palette, lighting, and mood, editable in Step 4.
    - **Model-Aware Prompt Adapter**: Builds per-model prompts from scene, style, character, and other parameters.
    - **Vision Critic**: Optional Gemini multimodal scorer grades generated images, automatically refining if scores are low.
    - **Character Reference Image Lock**: Project-level character reference image for consistent character depiction across scenes.
    - **Character Reference Image in Video**: `generateSceneVideo` accepts reference images for video generation, prioritizing per-scene seeds but falling back to reference.
    - **Per-Character Cast**: Supports multiple recurring characters via a project-level array of named character references.
    - **Per-Scene Veo Seed Selection**: Users can choose seed sources for video generation (`scene`, `reference`, `text-only`) per scene.
    - **Negative Prompt**: Project-level field applied to image and video generation for supported models.
- **Wizard Context Modularization**: Refactored `WizardContext.tsx` into focused hooks for improved maintainability.
- **Dual Video Modes**: Two selectable video creation paths:
    - **AI Video Mode**: Uses AI models (Veo) for per-scene video generation with motion.
    - **Presentation Mode**: Creates video from generated images with transitions, motion effects, and text overlays.

### System Design Choices
- **Firestore Structure**: A flat `projects` collection with summary fields for efficient list views.
- **My Projects Sync**: `ProjectManagement` page uses a slim local card cache and fetches data efficiently from Firestore.
- **Firestore Indexes**: `firestore.indexes.json` defines composite indexes for project queries.
- **Conflict Detection**: Uses a `version` field and Firestore transactions for optimistic concurrency control.
- **Storage Strategy**: Blob-based uploads with aggressive caching headers and recursive cleanup.
- **Client-Side Caching**: Multi-layered caching with IndexedDB, localStorage, and Firestore SDK persistence.
- **Security Rules**: Firestore and Storage rules ensure user data isolation.

## External Dependencies
- **Firebase**:
    - **Authentication**: User authentication.
    - **Firestore**: NoSQL database for project data.
    - **Storage**: Blob storage for media files.
- **Google Gemini API**: (@google/genai) For AI-powered text-to-speech, image generation, and video generation.
    - **TTS Models**: `gemini-2.5-flash-preview-tts`
    - **Image Models**: `gemini-2.5-flash-image`
    - **Video Models**: `veo-3.1-fast-generate-preview`
- **FFmpeg.wasm**: Integrated via `@ffmpeg/ffmpeg` and `@ffmpeg/util` for client-side video/audio processing.
- **Lucide React**: For icons.
- **Vite**: Build tool.
- **Tailwind CSS**: Utility-first CSS framework.