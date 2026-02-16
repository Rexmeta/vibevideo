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
- **Data Persistence**: Firebase Firestore is used with offline persistence enabled for multi-tab support.
- **Storage**: Firebase Storage manages media uploads, with structured paths and robust retry mechanisms.

### Feature Specifications
- **AI Model Selection**: Users can select specific AI models for image and video generation within the `ProjectWizard`.
- **Character Consistency**: The system supports maintaining character consistency across scenes by injecting character descriptions into prompts and using reference images.
- **Video & Audio Merging**: Facilitates merging per-scene video and audio into a single MP4 file client-side.
- **Project Save/Restore**: Robust system to save project progress, including generated media, to Cloud, IndexedDB, and localStorage with conflict detection and priority-based restoration.
- **Parallel Processing**: Audio, image, and video generation tasks run in parallel (with limits) to improve performance, including per-scene error tracking and retry mechanisms.
- **Export Features**: Comprehensive export options, including individual scene downloads and full project video downloads.

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