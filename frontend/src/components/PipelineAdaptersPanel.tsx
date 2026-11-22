import React from 'react';
import { Lock, ServerCog } from 'lucide-react';
import type { AdapterReportMap } from '@/types/lyrics';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface PipelineAdaptersPanelProps {
  adapters: AdapterReportMap | null;
}

export const PipelineAdaptersPanel: React.FC<PipelineAdaptersPanelProps> = ({ adapters }) => {
  const list = adapters
    ? [
        adapters.vocalSeparation,
        adapters.singingAsr,
        adapters.forcedAlignment,
        adapters.lyricsValidation,
      ]
    : [];

  return (
    <div className="space-y-4">
      <Alert variant="default">
        <Lock className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
        <div className="space-y-0.5">
          <div className="font-semibold text-zinc-100">
            API Keys &amp; Secrets Isolated on Backend
          </div>
          <p className="text-[11px] text-zinc-400">
            `GEMINI_API_KEY` and Phase 2 inference URLs are stored strictly in backend environment
            variables. Frontend bundle never accesses provider credentials.
          </p>
        </div>
      </Alert>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="py-8 text-center text-xs text-zinc-400">
              Loading modular adapter capability report from backend...
            </CardContent>
          </Card>
        ) : (
          list.map((adapter) => (
            <Card key={adapter.name}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">
                    <ServerCog className="h-4 w-4 text-sky-400" />
                    <span>{adapter.name}</span>
                  </CardTitle>
                  <span
                    className={
                      adapter.isImplementedForProduction
                        ? 'axr-tc text-[11px] text-emerald-400'
                        : 'axr-tc text-[11px] text-amber-300'
                    }
                  >
                    {adapter.status}
                  </span>
                </div>
                <CardDescription className="axr-tc text-[11px]">
                  {adapter.adapterClass} · {adapter.phaseTarget}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs leading-relaxed text-zinc-300">
                {adapter.note}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};
