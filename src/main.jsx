import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { refreshPalette } from './lib/charts.js';
import './styles/theme.css';
import './styles/app.css';

// Sync the chart palette to the active theme's CSS variables before the first
// render, so chart series (which read PALETTE during render) start with the
// right colours instead of the module's dark-theme defaults.
refreshPalette();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Register the service worker so Roost installs as a PWA (home-screen icon,
// standalone shell) and can receive web push once a backend is wired up.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
