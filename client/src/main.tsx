import React from 'react';
import { createRoot } from 'react-dom/client';
// Self-hosted fallbacks; the system stack (SF Pro on Mac) is preferred and needs no files.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/base.css';
import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
