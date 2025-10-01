/**
 * Agent Metadata Display Component
 * Shows agent classification, reasoning steps, and execution metrics
 */

'use client';

import React, { useState } from 'react';
import { 
  Brain, 
  Zap, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Activity,
  Network,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';

// ============================================================================
// Types
// ============================================================================

export interface AgentMetadataProps {
  classification?: {
    intent: string;
    complexity: 'simple' | 'multi-step';
    confidence: number;
    entities?: Record<string, unknown>;
  };
  agentUsed?: string;
  toolsUsed?: string[];
  reasoningSteps?: string[];
  executionTimeMs?: number;
  apiCallsCount?: number;
  warnings?: string[];
}

// ============================================================================
// Main Component
// ============================================================================

export const AgentMetadata: React.FC<AgentMetadataProps> = ({
  classification,
  agentUsed,
  toolsUsed,
  reasoningSteps,
  executionTimeMs,
  apiCallsCount,
  warnings,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!classification && !agentUsed) {
    return null;
  }

  const getComplexityColor = (complexity?: string) => {
    if (complexity === 'multi-step') return 'text-purple-400 bg-purple-500/10';
    return 'text-blue-400 bg-blue-500/10';
  };

  const getConfidenceColor = (confidence?: number) => {
    if (!confidence) return 'text-gray-400';
    if (confidence >= 0.8) return 'text-green-400';
    if (confidence >= 0.6) return 'text-yellow-400';
    return 'text-orange-400';
  };

  return (
    <div className="mt-2 rounded-lg border border-gray-700 bg-gray-800/50 text-sm">
      {/* Header - Always Visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between p-3 text-left hover:bg-gray-700/30 transition-colors"
      >
        <div className="flex items-center space-x-2">
          <Brain className="h-4 w-4 text-purple-400" />
          <span className="font-medium text-gray-200">
            {agentUsed || 'Agent Processing'}
          </span>
          {classification?.complexity && (
            <span className={`px-2 py-0.5 rounded text-xs ${getComplexityColor(classification.complexity)}`}>
              {classification.complexity}
            </span>
          )}
        </div>
        
        <div className="flex items-center space-x-3">
          {executionTimeMs !== undefined && (
            <div className="flex items-center space-x-1 text-gray-400">
              <Clock className="h-3 w-3" />
              <span className="text-xs">{Math.round(executionTimeMs)}ms</span>
            </div>
          )}
          {apiCallsCount !== undefined && (
            <div className="flex items-center space-x-1 text-gray-400">
              <Network className="h-3 w-3" />
              <span className="text-xs">{apiCallsCount} calls</span>
            </div>
          )}
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="border-t border-gray-700 p-3 space-y-3">
          {/* Classification */}
          {classification && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-medium text-gray-300">
                <Zap className="h-3 w-3" />
                <span>Query Classification</span>
              </div>
              <div className="pl-5 space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-400">Intent:</span>
                  <span className="text-gray-200 font-mono">{classification.intent}</span>
                </div>
                {classification.confidence !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-gray-400">Confidence:</span>
                    <span className={`font-mono ${getConfidenceColor(classification.confidence)}`}>
                      {(classification.confidence * 100).toFixed(0)}%
                    </span>
                  </div>
                )}
                {classification.entities && Object.keys(classification.entities).length > 0 && (
                  <div className="mt-2 pt-2 border-t border-gray-700/50">
                    <div className="text-gray-400 mb-1">Extracted Entities:</div>
                    {Object.entries(classification.entities).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between ml-2">
                        <span className="text-gray-500">{key}:</span>
                        <span className="text-gray-300 font-mono text-xs">
                          {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Tools Used */}
          {toolsUsed && toolsUsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-medium text-gray-300">
                <Activity className="h-3 w-3" />
                <span>Tools Used ({toolsUsed.length})</span>
              </div>
              <div className="pl-5 space-y-1">
                {toolsUsed.map((tool, index) => (
                  <div key={index} className="flex items-center space-x-2">
                    <CheckCircle2 className="h-3 w-3 text-green-400 flex-shrink-0" />
                    <span className="text-xs text-gray-300 font-mono">{tool}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Reasoning Steps */}
          {reasoningSteps && reasoningSteps.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-medium text-gray-300">
                <Brain className="h-3 w-3" />
                <span>Reasoning Steps</span>
              </div>
              <div className="pl-5 space-y-1.5">
                {reasoningSteps.map((step, index) => (
                  <div key={index} className="flex items-start space-x-2">
                    <span className="text-purple-400 font-mono text-xs mt-0.5 flex-shrink-0">
                      {index + 1}.
                    </span>
                    <span className="text-xs text-gray-300 leading-relaxed">{step}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Warnings */}
          {warnings && warnings.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center space-x-2 text-xs font-medium text-yellow-300">
                <AlertTriangle className="h-3 w-3" />
                <span>Warnings</span>
              </div>
              <div className="pl-5 space-y-1">
                {warnings.map((warning, index) => (
                  <div key={index} className="text-xs text-yellow-200/80">
                    • {warning}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AgentMetadata;
