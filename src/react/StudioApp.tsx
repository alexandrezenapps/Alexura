import React from 'react';
import { App, type StudioTabId } from '../../frontend/src/App';

interface StudioAppProps {
  onClose?: () => void;
  standalone?: boolean;
  initialTab?: StudioTabId;
}

export const StudioApp: React.FC<StudioAppProps> = ({
  onClose,
  standalone = false,
  initialTab = 'upload',
}) => {
  return <App onClose={onClose} standalone={standalone} initialTab={initialTab} />;
};

export default StudioApp;
