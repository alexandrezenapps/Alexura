import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/studio.css';

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <React.StrictMode>
      <App standalone />
    </React.StrictMode>,
  );
}
