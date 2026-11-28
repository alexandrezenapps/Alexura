import React from 'react';
import { CheckCircle2, Clock3, Lock, ServerCog } from 'lucide-react';
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
          <div className="font-semibold text-slate-50">
            API Keys &amp; Secrets Isolated on Backend
          </div>
          <p className="text-[11px] text-slate-400">
            <code className="axr-tc text-slate-200">GEMINI_API_KEY</code> and Phase 2 inference URLs
            are stored strictly in backend environment variables. Frontend bundle never accesses
            provider credentials.
          </p>
        </div>
      </Alert>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {list.length === 0 ? (
          <Card className="md:col-span-2">
            <CardContent className="py-8 text-center text-xs text-slate-400">
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
                        ? 'axr-tc inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-300'
                        : 'axr-tc inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#e8c97a]'
                    }
                  >
                    {adapter.isImplementedForProduction ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Clock3 className="h-3.5 w-3.5" />
                    )}
                    <span>{adapter.status}</span>
                  </span>
                </div>
                <CardDescription className="axr-tc text-[11px]">
                  {adapter.adapterClass} · {adapter.phaseTarget}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-xs leading-relaxed text-slate-300">
                {adapter.note}
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {adapters?.asrRouting && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ServerCog className="h-4 w-4 text-[#e8c97a]" />
              <span>Unified ASR Model Routing Strategy</span>
            </CardTitle>
            <CardDescription className="axr-tc text-[11px]">
              {adapters.asrRouting.interfaceClass} · Primary: {adapters.asrRouting.primaryModel} · Fallbacks:{' '}
              {adapters.asrRouting.fallbackModels.join(', ')}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs text-slate-300">
            {adapters.asrRouting.stages.map((stage) => (
              <div
                key={stage}
                className="rounded-lg border border-slate-200/8 bg-[#080b12]/80 px-3 py-2"
              >
                {stage}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
};
