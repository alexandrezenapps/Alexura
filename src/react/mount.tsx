import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StudioApp } from './StudioApp';
import type { StudioTabId } from '../../frontend/src/App';
import '../../frontend/src/styles/studio.css';
import './studio.css';

let overlayRoot: Root | null = null;
let overlayEl: HTMLElement | null = null;

function normalizeTab(tab?: unknown): StudioTabId {
  if (tab === 'upload' || tab === 'studio' || tab === 'adapters' || tab === 'skills') {
    return tab;
  }
  return 'upload';
}

export function openModularStudio(tab?: StudioTabId): void {
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
  overlayRoot.render(<StudioApp onClose={closeModularStudio} initialTab={normalizeTab(tab)} />);
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
  const paramTab =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('tab')
      : null;
  const root = createRoot(host);
  root.render(<StudioApp standalone initialTab={normalizeTab(paramTab)} />);
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
