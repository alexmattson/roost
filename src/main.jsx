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
