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
- 2026-02-13: Initial Replit setup - configured Vite for port 5000, host 0.0.0.0, allowedHosts. Fixed corrupted Firebase source map.
