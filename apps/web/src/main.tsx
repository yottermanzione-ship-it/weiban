import './app/secure-context-polyfill.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../../../docs/design/tokens.css';
import './app/tokens.css';
import './app/styles.css';
import './app/media-call.css';
import './app/l6.css';
import './app/l6b.css';
import './app/plaza.css';
import './app/play.css';
import './app/shell.css';
import './app/old-ui.css';
import './app/chat-old.css';
import './app/pages-old.css';
import './app/ecology.css';
import { App } from './app/app.js';
import { RuntimeErrorBoundary } from './app/runtime-error-boundary.js';
import { applyDisplayPrefs } from './data/display-prefs.js';
applyDisplayPrefs();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RuntimeErrorBoundary>
        <App />
      </RuntimeErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
import './app/common-fixes.css';
import './app/edit-pages.css';
import './app/ui-components.css';
import './app/persona-card.css';
