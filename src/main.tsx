import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App';

/**
 * Updates are applied automatically and silently.
 *
 * There is no "a new version is available, reload?" prompt on purpose. It is a
 * decision the user cannot make an informed choice about, presented at the
 * moment they were trying to do something else — and this app's entire premise
 * is that every avoidable decision is friction it cannot afford.
 */
registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
