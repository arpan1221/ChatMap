'use client';

import React from 'react';
import { Compass, Heart, MapPin, Sparkles, Route } from 'lucide-react';

import type {
  MemoryContextSummary,
  ConversationMemory,
} from '@/src/lib/types';

interface ConversationContextProps {
  memoryContext: MemoryContextSummary | null;
  isLoading?: boolean;
  onSuggestionSelect?: (suggestion: string) => void;
  suggestions?: string[];
  memoryEnabled?: boolean;
  onToggleMemory?: (enabled: boolean) => void;
  onClearMemories?: () => void;
  isClearing?: boolean;
}

const ConversationContext: React.FC<ConversationContextProps> = ({
  memoryContext,
  isLoading = false,
  onSuggestionSelect,
  suggestions = [],
  memoryEnabled = true,
  onToggleMemory,
  onClearMemories,
  isClearing = false,
}) => {
  if (!memoryEnabled) {
    return (
      <div className="rounded-xl border border-gray-700 bg-gray-800/70 px-4 py-3 text-sm text-gray-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-4 w-4 text-gray-400" />
            <span className="font-medium text-gray-200">Memory disabled</span>
          </div>
        {onToggleMemory && (
          <button
            onClick={() => onToggleMemory(true)}
            className="rounded-full border border-blue-500/20 px-3 py-1 text-xs text-blue-200 hover:border-blue-400/50 hover:text-blue-100"
          >
            Enable
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-gray-400">
          Turn memory on to keep track of your favorite places, preferences, and conversation context.
        </p>
      </div>
    );
  }

  if (!memoryContext && !isLoading) {
    return null;
  }

  return (
    <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-100">
      <div className="flex items-center justify-between">
      <div className="flex items-center space-x-2">
        <Sparkles className="h-4 w-4 text-blue-300" />
        <span className="font-medium">Personalized context</span>
        {isLoading && <span className="text-xs text-blue-200/80">Refreshing…</span>}
      </div>
        {onToggleMemory && (
          <button
            onClick={() => onToggleMemory(false)}
            className="rounded-full border border-blue-500/20 px-3 py-1 text-xs text-blue-200 hover:border-blue-400/50 hover:text-blue-100"
          >
            Disable
        </button>
      )}
    </div>

      {onClearMemories && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={onClearMemories}
            disabled={isClearing}
            className="rounded-full border border-blue-500/20 px-3 py-1 text-[11px] text-blue-200 hover:border-blue-400/50 hover:text-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isClearing ? 'Clearing…' : 'Clear memory'}
          </button>
        </div>
      )}

      {memoryContext && memoryContext.preferences ? (
        <div className="mt-3 space-y-3">
          {/* Preferences */}
          {(
            memoryContext.preferences.favoritePOITypes?.length ||
            memoryContext.preferences.favoriteTransport?.length ||
            memoryContext.preferences.favoriteCuisines?.length ||
            memoryContext.preferences.dietaryRestrictions?.length
          ) && (
            <div className="flex items-start space-x-2">
              <Heart className="h-4 w-4 text-pink-300 mt-0.5" />
              <div className="space-y-1">
                {memoryContext.preferences.favoritePOITypes?.length && (
                  <p className="text-xs">
                    <span className="font-semibold">Likes:</span> {memoryContext.preferences.favoritePOITypes.join(', ')}
                  </p>
                )}
                {memoryContext.preferences.favoriteCuisines?.length && (
                  <p className="text-xs">
                    <span className="font-semibold">Cuisines:</span> {memoryContext.preferences.favoriteCuisines.join(', ')}
                  </p>
                )}
                {memoryContext.preferences.favoriteTransport?.length && (
                  <p className="text-xs">
                    <span className="font-semibold">Travel:</span> {memoryContext.preferences.favoriteTransport.join(', ')}
                  </p>
                )}
                {memoryContext.preferences.dietaryRestrictions?.length && (
                  <p className="text-xs">
                    <span className="font-semibold">Dietary:</span> {memoryContext.preferences.dietaryRestrictions.join(', ')}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Frequent Locations */}
          {memoryContext.frequentLocations?.length > 0 && (
            <div className="flex items-start space-x-2">
              <MapPin className="h-4 w-4 text-blue-300 mt-0.5" />
              <div className="flex-1 space-y-1">
                <p className="text-xs font-semibold text-blue-100">Frequent spots</p>
                <div className="flex flex-wrap gap-1.5">
                  {memoryContext.frequentLocations.slice(0, 3).map((freq) => (
                    <span
                      key={`${freq.location.lat}-${freq.location.lng}`}
                      className="rounded-full bg-blue-500/20 px-3 py-1 text-xs text-blue-50"
                    >
                      {freq.location.display_name} · {freq.count}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Recent conversation references */}
          {memoryContext.conversationMemories?.length > 0 && (
            <div className="flex items-start space-x-2">
              <Route className="h-4 w-4 text-blue-300 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-blue-100">Recent follow-ups</p>
                <ul className="space-y-1 text-xs">
                  {memoryContext.conversationMemories.slice(-2).map((memory: ConversationMemory) => (
                    <li key={memory.id} className="text-blue-50/90">
                      <span className="font-medium">You:</span> {memory.query}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Optional suggestions */}
          {suggestions.length > 0 && onSuggestionSelect && (
            <div className="flex items-start space-x-2">
              <Compass className="h-4 w-4 text-blue-300 mt-0.5" />
              <div className="space-y-1">
                <p className="text-xs font-semibold text-blue-100">Try next</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.slice(0, 3).map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => onSuggestionSelect(suggestion)}
                      className="rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs text-blue-100 transition hover:border-blue-400/60 hover:bg-blue-400/10"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-blue-200">Loading your conversation context…</p>
      )}
    </div>
  );
};

export default ConversationContext;
