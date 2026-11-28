import React from 'react';
import { UploadScreen } from '@/components/UploadScreen';
import type { AudioAssetRecord, ProcessingJob } from '@/types/lyrics';

export interface AudioUploaderProps {
  uploadedAudio: AudioAssetRecord | null;
  activeJob: ProcessingJob | null;
  title: string;
  artist: string;
  languageHint: string;
  draftLyricsText: string;
  enableVocalSeparation: boolean;
  uploading: boolean;
  analyzing: boolean;
  errorMsg: string | null;
  onTitleChange: (val: string) => void;
  onArtistChange: (val: string) => void;
  onLanguageHintChange: (val: string) => void;
  onDraftLyricsChange: (val: string) => void;
  onToggleVocalSeparation: (val: boolean) => void;
  onUploadFile: (file: File) => void;
  onStartAnalysis: () => void;
  onOpenStage?: () => void;
}

export const AudioUploader: React.FC<AudioUploaderProps> = (props) => {
  return <UploadScreen {...props} />;
};
