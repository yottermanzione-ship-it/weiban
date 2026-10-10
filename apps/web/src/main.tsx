import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '../../../docs/design/tokens.css';
import './app/styles.css';
import './app/media-call.css';
import './app/l6.css';
import './app/l6b.css';
import './app/plaza.css';
import './app/play.css';
import { App } from './app/app.js';
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  void navigator.serviceWorker.register('/sw.js').catch(() => {});
}
