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
├── types.ts             # TypeScript type definitions
├── vite.config.ts       # Vite configuration (port 5000, host 0.0.0.0)
├── tsconfig.json        # TypeScript config
├── components/          # React components
│   ├── AuthPage.tsx
│   ├── Icons.tsx
│   ├── LandingPage.tsx
│   ├── NavBar.tsx
│   ├── PricingPage.tsx
│   ├── ProfilePage.tsx
│   ├── ProjectManagement.tsx
│   └── ProjectWizard.tsx
└── services/            # Service layer
    ├── firebaseConfig.ts
    ├── geminiService.ts
    ├── mediaCache.ts     # IndexedDB-based media cache for large base64 data
    └── storageService.ts
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

## Recent Changes
- 2026-02-13: Media persistence & crash fix:
  - Added IndexedDB-based media cache (services/mediaCache.ts) for large base64 audio/image data
  - Fixed localStorage QuotaExceededError crash: base64 data stripped before localStorage save, stored in IndexedDB instead
  - Project restore now recovers media from IndexedDB when '[local-*]' placeholders detected
  - Existing base64 data URLs migrated to IndexedDB on project load
  - Storage upload timeout increased to 30s with 1 automatic retry
  - Unmount cleanup flushes pending debounced sync to prevent data loss
- 2026-02-13: Performance & reliability improvements:
  - Local-first project loading (instant display from localStorage, cloud sync in background)
  - Firestore timeouts: 8s for reads, 10s for saves (prevents infinite hanging)
  - Sync debouncing: 1.5s debounce prevents overlapping cloud saves during batch operations
  - Image model changed from gemini-3-pro-image-preview to gemini-2.5-flash-image
  - All batch handlers (audio/image/video) now collect errors per-scene and display detailed alerts
  - Per-scene progress messages shown during batch generation
  - ProjectManagement shows sync status indicator and offline warning
- 2026-02-13: Firebase 설정을 하드코딩에서 환경 변수로 분리. 설정 누락 시 앱에 안내 배너 표시.
- 2026-02-13: Fixed data persistence, step navigation, project restore, and video generation
- 2026-02-13: Initial Replit setup - configured Vite for port 5000, host 0.0.0.0, allowedHosts.
