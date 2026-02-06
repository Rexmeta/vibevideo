
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  console.error("Critical Error: Root element not found.");
} else {
  try {
    const root = createRoot(rootElement);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  } catch (error) {
    console.error("Failed to render React app:", error);
    rootElement.innerHTML = `<div style="padding: 40px; text-align: center;"><h1>Initialization Error</h1><p>${error instanceof Error ? error.message : String(error)}</p></div>`;
  }
}
