import React from 'react';
import { App } from '../../frontend/src/App';

interface StudioAppProps {
  onClose?: () => void;
  standalone?: boolean;
}

export const StudioApp: React.FC<StudioAppProps> = ({ onClose, standalone = false }) => {
  return <App onClose={onClose} standalone={standalone} />;
};

export default StudioApp;
