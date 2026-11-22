import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioApp } from './StudioApp';
import '../../frontend/src/styles/studio.css';
import './studio.css';

let overlayRoot: Root | null = null;
let overlayEl: HTMLElement | null = null;

export function openModularStudio(): void {
  if (typeof document === 'undefined') return;
  if (!overlayEl) {
    overlayEl = document.createElement('div');
    overlayEl.id = 'alexuraModularStudioOverlay';
    overlayEl.className = 'axr-overlay dark';
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-label', 'Alexura AI Lyrics Sync Engine');
    document.body.appendChild(overlayEl);
  }
  overlayEl.hidden = false;
  if (!overlayRoot) {
    overlayRoot = createRoot(overlayEl);
  }
  overlayRoot.render(<StudioApp onClose={closeModularStudio} />);
}

export function closeModularStudio(): void {
  if (overlayEl) {
    overlayEl.hidden = true;
  }
}

export function mountStandaloneStudio(targetId = 'alexuraReactStandalone'): void {
  const host = document.getElementById(targetId);
  if (!host) return;
  host.classList.add('dark');
  const root = createRoot(host);
  root.render(<StudioApp standalone />);
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).AlexuraReactStudio = {
    open: openModularStudio,
    close: closeModularStudio,
    mountStandalone: mountStandaloneStudio,
  };
  if (document.getElementById('alexuraReactStandalone')) {
    mountStandaloneStudio();
  }
}
