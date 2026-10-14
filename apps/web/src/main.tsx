import { App } from '@app/app';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@shared/styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
