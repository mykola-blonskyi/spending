import '@fontsource-variable/inter';
import '@shared/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@app/app';
import { applyStoredTheme } from '@shared/theme';

applyStoredTheme();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
