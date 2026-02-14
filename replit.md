# VibeVideo AI

## Overview
VibeVideo AI is a React + TypeScript frontend application for AI-powered video generation. Users can create videos from text, images, or audio clips using AI. The app uses Firebase for authentication, Firestore, and storage, and integrates with Google's Gemini API.

## Project Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite 5
- **Styling**: Tailwind CSS (loaded via CDN)
- **Backend Services**: Firebase (Auth, Firestore, Storage)
- **AI Integration**: Google Gemini API (@google/genai)
- **Icons**: Lucide React

## Project Structure
```
/
├── App.tsx              # Main app component with routing
├── index.tsx            # Entry point
├── index.html           # HTML template with importmap
├── types.ts             # TypeScript type definitions (Project has version, scene_count, total_duration)
├── vite.config.ts       # Vite configuration (port 5000, host 0.0.0.0)
├── tsconfig.json        # TypeScript config
├── components/          # React components
│   ├── AuthPage.tsx
│   ├── Icons.tsx
│   ├── LandingPage.tsx
│   ├── NavBar.tsx
│   ├── PricingPage.tsx
│   ├── ProfilePage.tsx
│   ├── ProjectManagement.tsx  # Paginated project list with "더 보기" button
│   └── ProjectWizard.tsx
└── services/            # Service layer
    ├── firebaseConfig.ts      # Firebase init with persistent offline cache
    ├── geminiService.ts
    ├── mediaCache.ts          # IndexedDB-based media cache for large base64 data
    └── storageService.ts      # Paginated queries, version tracking, Blob uploads, Storage cleanup
```

## Development
- **Dev Server**: `npm run dev` (runs on port 5000)
- **Build**: `npm run build` (outputs to `dist/`)
- **Deployment**: Static site deployment from `dist/` directory

## Environment Variables
- `API_KEY` - Google Gemini API key (mapped via Vite's define config)
- `FIREBASE_API_KEY` - Firebase 프로젝트 API Key (필수)
- `FIREBASE_AUTH_DOMAIN` - Firebase Auth Domain (필수)
- `FIREBASE_PROJECT_ID` - Firebase Project ID (필수)
- `FIREBASE_STORAGE_BUCKET` - Firebase Storage Bucket
- `FIREBASE_MESSAGING_SENDER_ID` - Firebase Messaging Sender ID
- `FIREBASE_APP_ID` - Firebase App ID (필수)
- `FIREBASE_MEASUREMENT_ID` - Firebase Measurement ID (선택)

## AI Models Used
- **TTS**: `gemini-2.5-flash-preview-tts` (Puck/Kore voices, 45s timeout)
- **Image**: `gemini-2.5-flash-image` (Nano Banana, responseModalities: IMAGE+TEXT, 60s timeout)
- **Video**: `veo-3.1-fast-generate-preview` (polling-based, 40 attempts x 7s)

## Database & Storage Architecture (Production-Ready)

### Firestore
- **Collection**: `projects` (flat collection, one document per project)
- **Offline Persistence**: Enabled via `persistentLocalCache` + `persistentMultipleTabManager` (multi-tab support)
- **Queries**: Paginated with `orderBy("updated_at", "desc")` + `limit(20)` + `startAfter(lastDoc)`
- **Conflict Detection**: `version` field incremented on each save; `runTransaction` for concurrent access safety
- **Document Size Guard**: `saved_scenes` capped at 50 scenes; base64 data always stripped before Firestore save
- **Summary Fields**: `scene_count`, `total_duration` stored for list view without loading full scenes
- **Required Composite Index**: `projects` collection → `user_id` ASC + `updated_at` DESC

### Firebase Storage
- **Path Structure**: `users/{userId}/projects/{projectId}/{type}/s{index}.{ext}`
- **Upload Method**: Blob-based (`uploadBytes`) with `cacheControl: 'public, max-age=31536000'`
- **Retry**: 1 automatic retry with 1s delay on failure (30s timeout per attempt)
- **Cleanup**: Full recursive folder deletion (`listAll` + `deleteObject`) when project is deleted

### Client-Side Caching
- **IndexedDB (mediaCache.ts)**: Stores large base64 audio/image data keyed by `{projectId}__s{idx}__{type}`
- **localStorage**: Lightweight project metadata only (no base64); project index per user (`vibe_project_index_{userId}`) capped at 50 entries
- **Firestore IndexedDB**: Automatic offline cache via Firebase SDK persistence

### Security Rules (Recommended for Firebase Console)
```
// Firestore Rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /projects/{projectId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.user_id;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.user_id;
    }
  }
}

// Storage Rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

## Recent Changes
- 2026-02-14: Sync timing & project restore fix + Export features:
  - Sync timing: `sync()` now builds project data inside timer callback using refs (scenesRef, stepRef, etc.) instead of at call time, preventing stale closure data
  - Restore: maxStep computed from actual scene data (video_path, image_path, audio_path presence) so steps 5-7 are accessible after re-entry
  - Video preview fix: Veo API URLs converted to blob URLs via `fetchVideoAsBlob` for browser playback (CORS-safe)
  - Video persistence: Generated videos saved to IndexedDB and restored as blob URLs on project re-entry
  - Blob URL memory management: `blobUrlsRef` tracks all blob URLs, revokes on replace/unmount
  - Step 5: Click-to-expand video preview panel with large player, scene info, close button
  - Step 5: Scene card thumbnails show expand icon on hover for video preview
  - Step 6: Added "Play All" button, scene counter (Scene X / Y), and progress bar for sequential preview
  - Step 7: Full export page with scene grid, individual download buttons per scene, "Download All Scenes" button, video previews
  - Download helper: fetch → blob → createObjectURL → programmatic download, with fallback to window.open
- 2026-02-14: Cloud connection reliability fix:
  - Firestore query fallback: compound query (where + orderBy) → simple query (where only) when composite index unavailable
  - Client-side sorting as fallback when compound index not available
  - Timeout increased from 10s to 15s for Firestore queries
  - PNG content type support added to `uploadFileToCloud`
  - Image generation returns correct mimeType (was hardcoded as JPEG, now detects from API response)
  - Video generation properly detects seed image mimeType from data URL or HTTP URL
  - Script text in scene cards: removed line-clamp, reduced font for full visibility
- 2026-02-13: Parallel processing & retry system:
  - Audio/Image/Video batch generation now runs in parallel (3 concurrent for audio/image, 2 for video)
  - Per-scene error tracking with visual Failed/Processing badges and retry buttons
  - Individual scene retry: `handleSingleAudio`, `handleSingleImage`, `handleSingleVideo`
  - Auto-retry with exponential backoff in geminiService for timeout/429/503 errors (1 retry)
  - Failed scenes show error message, red border, and dedicated retry button
  - Processing status shows concurrent count in real-time
- 2026-02-13: Production-level DB/Storage architecture upgrade:
  - Firestore offline persistence via `persistentLocalCache` + multi-tab support
  - Paginated project queries: `orderBy("updated_at", "desc")` + `limit(20)` + cursor-based pagination
  - Version-based conflict detection with `runTransaction` for concurrent edit safety
  - Project IDs use `crypto.randomUUID()` instead of `Date.now()` (collision-safe)
  - All uploads converted from `uploadString` (base64) to `uploadBytes` (Blob) for efficiency
  - Storage cache headers: `public, max-age=31536000` for CDN optimization
  - Full Storage folder cleanup on project deletion (recursive `listAll` + `deleteObject`)
  - Document size guard: scenes capped at 50, summary fields (`scene_count`, `total_duration`)
  - localStorage lightweight index system (`vibe_project_index_{userId}`, 50 entry cap)
  - ProjectManagement: "더 보기" pagination button, lazy-loaded thumbnails
- 2026-02-13: Media persistence & crash fix:
  - Added IndexedDB-based media cache (services/mediaCache.ts) for large base64 audio/image data
  - Fixed localStorage QuotaExceededError crash: base64 data stripped before localStorage save
  - Project restore recovers media from IndexedDB when '[local-*]' placeholders detected
  - Storage upload timeout 30s with 1 automatic retry
- 2026-02-13: Performance & reliability improvements:
  - Local-first project loading, Firestore timeouts, sync debouncing
  - Image model: gemini-2.5-flash-image, per-scene progress and error reporting
- 2026-02-13: Initial Replit setup - Vite port 5000, Firebase env vars
