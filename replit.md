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

## Recent Changes
- 2026-02-13: Fixed data persistence, step navigation, project restore, and video generation:
  - Firestore save now sanitizes scenes (strips base64/data URLs) to avoid 1MB doc limit
  - Added saved_max_step to Project type for proper step navigation persistence
  - Fixed useEffect restore to prevent reload loops (removed projectId from deps, added ref guard)
  - Fixed media skip conditions: already-generated media (data:/blob: URLs) won't be re-generated, only re-uploaded
  - Fixed video generation: better image source handling, increased poll timeout, proper error handling
  - Fixed stepper UI to show accessible steps based on maxStep
  - All step transitions now properly update maxStep
- 2026-02-13: Initial Replit setup - configured Vite for port 5000, host 0.0.0.0, allowedHosts. Fixed corrupted Firebase source map.
