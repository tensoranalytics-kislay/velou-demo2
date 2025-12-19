'use client';

import { useEffect, useState } from 'react';
import { STAGE_LABELS, type QueryStage, type QueryType } from '@/lib/llm/types';

type QueryProgressBarProps = {
  isLoading: boolean;
  currentStage?: QueryStage | null;
  currentProgress?: number | null;
  queryType?: QueryType; // 'discovery', 'product_qa', or 'non_contextual'
};

export default function QueryProgressBar({ isLoading, currentStage, currentProgress, queryType = 'discovery' }: QueryProgressBarProps) {
  const [displayProgress, setDisplayProgress] = useState(0);
  const [displayStage, setDisplayStage] = useState<QueryStage | null>(null);

  useEffect(() => {
    if (!isLoading) {
      // Reset when loading stops
      setDisplayProgress(0);
      setDisplayStage(null);
      return;
    }

    // Update from props when available
    if (currentStage) {
      setDisplayStage(currentStage);
    }
    if (currentProgress !== null && currentProgress !== undefined) {
      // Smoothly animate to the new progress value
      setDisplayProgress((prev) => {
        const diff = currentProgress - prev;
        if (Math.abs(diff) < 1) {
          return currentProgress;
        }
        // Smooth transition
        return prev + diff * 0.3;
      });
    }
  }, [isLoading, currentStage, currentProgress]);

  // Smooth animation loop
  useEffect(() => {
    if (!isLoading) return;

    const interval = setInterval(() => {
      setDisplayProgress((prev) => {
        if (currentProgress !== null && currentProgress !== undefined) {
          const diff = currentProgress - prev;
          if (Math.abs(diff) < 0.5) {
            return currentProgress;
          }
          return prev + diff * 0.2;
        }
        return prev;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isLoading, currentProgress]);

  if (!isLoading) {
    return null;
  }

  // Get appropriate stage label based on query type
  const getStageLabel = (stage: QueryStage | null): string => {
    if (!stage) {
      if (queryType === 'product_qa') {
        return STAGE_LABELS.loading_product;
      } else if (queryType === 'non_contextual') {
        return STAGE_LABELS.understanding;
      }
      return STAGE_LABELS.understanding;
    }
    
    // For product Q&A, use Q&A-specific labels
    if (queryType === 'product_qa') {
      if (stage === 'loading_product' || stage === 'analyzing' || stage === 'answering') {
        return STAGE_LABELS[stage];
      }
      // Map discovery stages to Q&A equivalents if needed
      if (stage === 'safety_check') {
        return STAGE_LABELS.loading_product;
      }
      // Fallback for discovery stages if somehow used in Q&A
      return STAGE_LABELS[stage] || STAGE_LABELS.loading_product;
    }
    
    // For non-contextual queries, use simplified stages (understanding -> generating -> completing)
    if (queryType === 'non_contextual') {
      if (stage === 'understanding' || stage === 'generating' || stage === 'completing') {
        return STAGE_LABELS[stage];
      }
      // Map other stages to non-contextual equivalents
      if (stage === 'searching' || stage === 'evaluating' || stage === 'retrieving' || stage === 'ranking') {
        return STAGE_LABELS.generating; // Skip search/evaluate stages for non-contextual
      }
      if (stage === 'safety_check' || stage === 'classifying') {
        return STAGE_LABELS.understanding;
      }
      return STAGE_LABELS[stage] || STAGE_LABELS.understanding;
    }
    
    // For discovery queries (including all pipeline stages), use all available labels
    // Supported stages:
    // - safety_check: Safety & domain gate
    // - understanding: Intent & constraints extraction, query parsing, constraint merging
    // - classifying: Query categorization & category classification
    // - retrieving: Multi-view retrieval
    // - ranking: Constraint-based ranking
    // - generating_reply: Reply generation
    // - generating: Follow-up question generation (for vague queries)
    // - handling_unrelated: Irrelevant queries
    // - complete: All done
    // All stages are now supported via STAGE_LABELS with proper fallbacks
    return STAGE_LABELS[stage] || STAGE_LABELS.understanding;
  };

  const stageLabel = getStageLabel(displayStage);
  const progressValue = Math.min(100, Math.max(0, displayProgress));

  return (
    <div className="mb-3 w-full">
      {/* Progress bar */}
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-rose-100/50">
        <div
          className="h-full rounded-full bg-gradient-to-r from-rose-400 via-rose-500 to-rose-600 transition-all duration-300 ease-out"
          style={{ width: `${progressValue}%` }}
        />
      </div>
      {/* Stage label */}
      <p className="mt-1.5 text-[10px] text-slate-500 text-center">
        {stageLabel}
      </p>
    </div>
  );
}

