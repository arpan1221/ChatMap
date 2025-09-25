'use client';

import React from 'react';
import { Sparkles, ArrowUpRight } from 'lucide-react';

interface PersonalizedSuggestionsProps {
  suggestions: string[];
  onSuggestionSelect: (suggestion: string) => void;
  className?: string;
  isLoading?: boolean;
  title?: string;
}

const PersonalizedSuggestions: React.FC<PersonalizedSuggestionsProps> = ({
  suggestions,
  onSuggestionSelect,
  className = '',
  isLoading = false,
  title = 'Personalized Suggestions',
}) => {
  if (!suggestions || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-xl border border-blue-500/40 bg-blue-500/10 backdrop-blur p-3 sm:p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/20 text-blue-300">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold text-blue-100">{title}</p>
            <p className="text-xs text-blue-200/80">Based on your recent activity</p>
          </div>
        </div>
        {isLoading && <span className="text-xs text-blue-200">Updating…</span>}
      </div>

      <div className="flex flex-wrap gap-2">
        {suggestions.slice(0, 6).map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => onSuggestionSelect(suggestion)}
            className="group flex items-center space-x-2 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-xs font-medium text-blue-100 transition hover:border-blue-400 hover:bg-blue-400/20"
          >
            <span className="truncate max-w-[180px] sm:max-w-[220px] text-left">{suggestion}</span>
            <ArrowUpRight className="h-3.5 w-3.5 opacity-70 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
          </button>
        ))}
      </div>
    </div>
  );
};

export default PersonalizedSuggestions;
