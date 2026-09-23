import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerServiceWorker } from './lib/sw';
import { applyTheme, readTheme, watchSystemTheme } from './lib/theme';
import './index.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';

registerServiceWorker();

/*
 * The inline script in index.html already applied the theme before paint.
 * This re-applies it so the theme-color meta and the attribute stay in sync
 * with the module's own logic, and subscribes so that "System" keeps meaning
 * system — without the listener the OS could switch at sunset and the page
 * would hold whatever it resolved at load.
 */
applyTheme(readTheme());
watchSystemTheme(() => {});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary what="The app">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
