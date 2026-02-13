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

## Recent Changes
- 2026-02-13: Firebase 설정을 하드코딩에서 환경 변수로 분리. 설정 누락 시 앱에 안내 배너 표시.
- 2026-02-13: Fixed data persistence, step navigation, project restore, and video generation:
  - Firestore save now sanitizes scenes (strips base64/data URLs) to avoid 1MB doc limit
  - Added saved_max_step to Project type for proper step navigation persistence
  - Fixed useEffect restore to prevent reload loops (removed projectId from deps, added ref guard)
  - Fixed media skip conditions: already-generated media (data:/blob: URLs) won't be re-generated, only re-uploaded
  - Fixed video generation: better image source handling, increased poll timeout, proper error handling
  - Fixed stepper UI to show accessible steps based on maxStep
  - All step transitions now properly update maxStep
- 2026-02-13: Initial Replit setup - configured Vite for port 5000, host 0.0.0.0, allowedHosts. Fixed corrupted Firebase source map.
