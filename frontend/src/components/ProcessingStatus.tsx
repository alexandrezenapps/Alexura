import React from 'react';
import { CheckCircle2, Info, Loader2, PlayCircle, XCircle } from 'lucide-react';
import {
  DEFAULT_JOB_STEP_MESSAGES,
  PIPELINE_STAGE_ORDER,
  type ProcessingJob,
  type ProcessingStatus as ProcessingStatusType,
} from '@/types/lyrics';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

const STAGE_LABELS: Record<ProcessingStatusType, string> = {
  queued: 'Queued',
  validating: 'Validating',
  analyzing: 'Analyzing',
  separating_vocals: 'Separating Vocals',
  transcribing: 'Transcribing',
  aligning: 'Aligning',
  validating_alignment: 'Validating Alignment',
  completed: 'Completed',
  failed: 'Failed',
};

export interface ProcessingStatusProps {
  activeJob: ProcessingJob | null;
  onOpenStage?: () => void;
}

export const ProcessingStatus: React.FC<ProcessingStatusProps> = ({
  activeJob,
  onOpenStage,
}) => {
  const activeStatus: ProcessingStatusType | null = activeJob
    ? (activeJob.status ?? activeJob.state)
    : null;
  const activeProgress = activeJob
    ? (activeJob.progress ?? activeJob.progressPercent)
    : 0;
  const activeStep = activeJob && activeStatus
    ? (
        activeJob.currentStep?.trim() ||
        activeJob.transitions[activeJob.transitions.length - 1]?.message?.trim() ||
        DEFAULT_JOB_STEP_MESSAGES[activeStatus]
      )
    : '';
  const currentStageIdx = activeStatus ? PIPELINE_STAGE_ORDER.indexOf(activeStatus) : -1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pipeline Processing Status</CardTitle>
        <CardDescription>
          Explicit finite-state transitions preserving original audio coordinate fidelity.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!activeJob || !activeStatus ? (
          <div className="rounded-xl border border-dashed border-slate-200/14 bg-[#080b12]/70 px-4 py-8 text-center">
            <p className="text-xs font-medium text-slate-300">No Active Pipeline Job</p>
            <p className="mt-1 text-[11px] text-slate-500">
              Upload an audio track and start analysis to inspect real state transitions.
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-slate-100">
                  {STAGE_LABELS[activeStatus] || activeStatus}
                </span>
                <span className="axr-tc tabular-nums font-semibold text-[#e8c97a]">
                  {activeProgress}%
                </span>
              </div>
              {activeStep && (
                <p className="text-[11px] text-slate-400 truncate" title={activeStep}>
                  {activeStep}
                </p>
              )}
            </div>

            <Progress value={activeProgress} />

            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-1">
              {PIPELINE_STAGE_ORDER.filter((s) => s !== 'failed').map((stage, idx) => {
                const isDone =
                  activeStatus === 'completed' ||
                  (currentStageIdx > idx && activeStatus !== 'failed');
                const isCurrent = activeStatus === stage && activeStatus !== 'completed';
                return (
                  <div
                    key={stage}
                    className={cn(
                      'flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-[11px]',
                      isCurrent
                        ? 'border-sky-400/50 bg-sky-500/14 text-white'
                        : isDone
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                          : 'border-slate-200/8 bg-[#080b12]/75 text-slate-400',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      ) : isCurrent ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
                      ) : (
                        <span className="axr-tc inline-flex w-3.5 justify-center text-[10px] text-slate-500">
                          {String(idx + 1).padStart(2, '0')}
                        </span>
                      )}
                      {STAGE_LABELS[stage]}
                    </span>
                    <span className="axr-tc text-[10px] opacity-80">
                      {isDone ? 'OK' : isCurrent ? 'Active' : 'Wait'}
                    </span>
                  </div>
                );
              })}
            </div>

            {activeStatus === 'failed' && activeJob.error && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{activeJob.error}</span>
              </Alert>
            )}

            {activeStatus === 'completed' && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200 space-y-2">
                <div className="flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5 text-emerald-400" />
                  <span>
                    Normalized document created cleanly with zero simulated word timestamps.
                  </span>
                </div>
                {onOpenStage && (
                  <Button
                    type="button"
                    variant="emerald"
                    size="sm"
                    onClick={onOpenStage}
                    className="w-full"
                  >
                    <PlayCircle className="h-4 w-4" />
                    <span>Open Player &amp; Lyrics Stage</span>
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};
