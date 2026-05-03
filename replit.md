# VibeVideo AI

## Overview
VibeVideo AI is a React + TypeScript frontend application for AI-powered video generation. It allows users to create videos from various inputs like text, images, or audio using advanced AI models. The platform leverages Firebase for core services and Google's Gemini API for AI functionalities, aiming to provide a seamless and robust experience for AI-driven media creation.

## User Preferences
No specific user preferences were provided in the original `replit.md` file. The user is expected to provide these during the interaction.

## System Architecture
The application is built with React 18, TypeScript, and Vite 5. Styling is managed with Tailwind CSS. Firebase is utilized for authentication, Firestore (database), and Storage, while Google Gemini API powers the core AI capabilities.

### UI/UX Decisions
The application features a step-by-step `ProjectWizard.tsx` for project creation, an `AdminPage.tsx` for managing AI models with CRUD operations, and a dynamic `NavBar.tsx`. Project management is handled by `ProjectManagement.tsx`, offering a paginated list of projects. Dual video modes are supported: `AI Video Mode` using models like Veo, and `Presentation Mode` which creates videos from images with transitions, motion effects, and text overlays.

### Technical Implementations
Key technical aspects include React hooks for state management, `mediaCache.ts` for IndexedDB-based media caching, and `videoMergeService.ts` integrating `FFmpeg.wasm` for in-browser video merging. `modelService.ts` manages AI models with Firestore persistence, and `pricing.ts` provides cost estimation for AI operations. Firebase Firestore is used for data persistence with offline support, and Firebase Storage for media uploads.

Features include AI model selection, character consistency maintenance, audio source selection (Veo 3.1 built-in or separate TTS), and per-model API key management. Scene duration can be configured by total time or scene count. The system supports robust project save/restore with conflict detection, parallel processing of generation tasks, and comprehensive export options.

The `Director Pipeline` refines the generation process with:
- **Genre & Platform Presets**: Configurable in Step 1, influencing aspect ratio, duration, and scene count.
- **2-Pass Scripting**: Generating a JSON outline followed by a detailed script.
- **Shotlist-Based Scene Segmentation**: Each scene includes detailed shot properties.
- **StyleSheet**: Auto-extracted palette, lighting, and mood for consistent prompting.
- **Model-Aware Prompt Adapter**: Tailors prompts for specific AI models.
- **Vision Critic**: An optional Gemini multimodal scorer for image quality, with auto-refinement.
- **Character Reference Image Lock**: Ensures character consistency across scenes using a reference image.
- **Per-Character Cast**: Supports multiple recurring characters with individual reference images.
- **Per-Scene Veo Seed Selection**: Allows specifying `videoSeedSource` for each scene.
- **Negative Prompt**: Project-level field for controlling undesirable elements in generation.

The `JobManager` handles multi-project parallel production with a concurrency cap, cancel/pause functionality, and interruption recovery. `Studio Dock` provides a floating panel to monitor job progress. `Context Packs` allow reusable creative-context bundles for projects, with versioned linkage and impact assessment. The `Wizard Context` has been modularized into focused hooks for better maintainability.

### System Design Choices
Firestore utilizes a flat `projects` collection with summary fields for efficient list views. Optimistic concurrency control is implemented using a `version` field and Firestore transactions. Storage uses blob-based uploads with caching headers. Client-side caching combines IndexedDB, localStorage, and Firestore SDK persistence. Security rules ensure user-specific data access for Firestore and Storage.

## External Dependencies
- **Firebase**: Authentication, Firestore (NoSQL database), Storage (blob storage).
- **Google Gemini API**: For AI-powered TTS (`gemini-2.5-flash-preview-tts`), image generation (`gemini-2.5-flash-image`), and video generation (`veo-3.1-fast-generate-preview`).
- **FFmpeg.wasm**: Client-side video and audio processing.
- **Lucide React**: Icon library.
- **Vite**: Build tool.
- **Tailwind CSS**: Styling framework.