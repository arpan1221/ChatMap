'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, X, Search, Lightbulb, AlertCircle, WifiOff, Sparkles, ArrowUpRight } from 'lucide-react';

// Props interface
interface QueryInputProps {
  onSendQuery: (query: string) => void;
  isLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  showExamples?: boolean;
  maxLength?: number;
  error?: string | null;
  isOnline?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  personalizedSuggestions?: string[];
  onSuggestionSelect?: (suggestion: string) => void;
}

// Example queries for suggestions
const EXAMPLE_QUERIES = [
  "Find coffee shops within 15 minutes walk",
  "Show me restaurants I can drive to in 10 minutes",
  "Where are the nearest pharmacies?",
  "Find gyms within 20 minutes cycling",
  "Show me gas stations near me",
  "Find grocery stores within 5 minutes walk",
  "Where can I get food within 30 minutes?",
  "Find banks I can walk to in 10 minutes",
  "Show me hospitals within 15 minutes drive",
  "Find shopping centers near me"
];

// Rotating placeholder text
const PLACEHOLDER_TEXTS = [
  "Ask me to find places near you...",
  "Find coffee shops within 15 minutes walk",
  "Show me restaurants I can drive to",
  "Where are the nearest pharmacies?",
  "Find gyms within 20 minutes cycling",
  "Show me gas stations near me"
];

const QueryInput: React.FC<QueryInputProps> = ({
  onSendQuery,
  isLoading = false,
  disabled = false,
  placeholder,
  className = '',
  showExamples = true,
  maxLength = 200,
  error = null,
  isOnline = true,
  inputRef: externalInputRef,
  personalizedSuggestions = [],
  onSuggestionSelect,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [currentPlaceholder, setCurrentPlaceholder] = useState(PLACEHOLDER_TEXTS[0]);
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const placeholderIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Rotate placeholder text
  useEffect(() => {
    if (!placeholder) {
      placeholderIntervalRef.current = setInterval(() => {
        setPlaceholderIndex((prev) => (prev + 1) % PLACEHOLDER_TEXTS.length);
        setCurrentPlaceholder(PLACEHOLDER_TEXTS[placeholderIndex]);
      }, 3000);
    }

    return () => {
      if (placeholderIntervalRef.current) {
        clearInterval(placeholderIntervalRef.current);
      }
    };
  }, [placeholder, placeholderIndex]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (maxLength && value.length > maxLength) {
      return;
    }
    setInputValue(value);
    setShowSuggestions(value.length > 0 && showExamples);
  }, [maxLength, showExamples]);

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading || disabled || isComposing) {
      return;
    }

    const query = inputValue.trim();
    onSendQuery(query);
    // Don't clear input immediately - let the parent component handle it
    setShowSuggestions(false);
  }, [inputValue, isLoading, disabled, isComposing, onSendQuery]);

  // Handle key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      inputRef.current?.blur();
    }
  }, [handleSubmit, isComposing]);

  // Handle composition events for better mobile support
  const handleCompositionStart = useCallback(() => {
    setIsComposing(true);
  }, []);

  const handleCompositionEnd = useCallback(() => {
    setIsComposing(false);
  }, []);

  // Handle example click
  const handleSuggestionUse = useCallback((suggestion: string) => {
    if (isLoading || disabled) return;
    setInputValue('');
    setShowSuggestions(false);
    if (onSuggestionSelect) {
      onSuggestionSelect(suggestion);
    } else {
      onSendQuery(suggestion);
    }
  }, [disabled, isLoading, onSendQuery, onSuggestionSelect]);

  const handleExampleClick = useCallback((example: string) => {
    handleSuggestionUse(example);
    inputRef.current?.focus();
  }, [handleSuggestionUse, inputRef]);

  // Handle clear input
  const handleClearInput = useCallback(() => {
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  // Handle input focus
  const handleInputFocus = useCallback(() => {
    if (showExamples && inputValue.length > 0) {
      setShowSuggestions(true);
    }
  }, [showExamples, inputValue.length]);

  // Handle input blur
  const handleInputBlur = useCallback((e: React.FocusEvent) => {
    // Delay hiding suggestions to allow clicking on them
    setTimeout(() => {
      if (!suggestionsRef.current?.contains(document.activeElement)) {
        setShowSuggestions(false);
      }
    }, 150);
  }, []);

  // Filter examples based on input
  const filteredExamples = EXAMPLE_QUERIES.filter(example =>
    example.toLowerCase().includes(inputValue.toLowerCase())
  ).slice(0, 5);

  const isDisabled = disabled || isLoading || !isOnline;
  const canSubmit = inputValue.trim().length > 0 && !isDisabled && !isComposing;

  return (
    <div className={`relative w-full ${className}`}>
      {/* Input Form */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex items-center">
          {/* Search Icon */}
          <div className="absolute left-3 z-10 pointer-events-none">
            <Search className={`w-4 h-4 ${isDisabled ? 'text-gray-400' : 'text-gray-500'}`} />
          </div>

          {/* Input Field */}
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyPress={handleKeyPress}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onFocus={handleInputFocus}
            onBlur={handleInputBlur}
            placeholder={!isOnline ? 'No internet connection...' : (placeholder || currentPlaceholder)}
            disabled={isDisabled}
            maxLength={maxLength}
            className={`
              w-full pl-10 pr-12 py-3 sm:py-3 border rounded-xl
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500
              disabled:opacity-50 disabled:cursor-not-allowed
              text-base sm:text-sm placeholder-gray-400
              transition-all duration-200
              ${error ? 'border-red-500 bg-red-900/20' : 'border-gray-600'}
              ${isDisabled ? 'bg-gray-700' : 'bg-gray-700 text-white'}
              ${showSuggestions && filteredExamples.length > 0 ? 'rounded-b-none' : ''}
              touch-manipulation
            `}
            style={{ fontSize: '16px' }} // Prevents zoom on iOS
          />

          {/* Clear Button */}
          {inputValue && !isDisabled && (
            <button
              type="button"
              onClick={handleClearInput}
              className="absolute right-12 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded-full p-1 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center touch-manipulation"
            >
              <X className="w-4 h-4" />
            </button>
          )}

          {/* Send Button */}
          <button
            type="submit"
            disabled={!canSubmit}
            className={`
              absolute right-2 top-1/2 transform -translate-y-1/2
              p-2 rounded-xl transition-all duration-200 min-h-[44px] min-w-[44px] flex items-center justify-center
              touch-manipulation shadow-lg
              ${canSubmit
                ? 'bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>

        {/* Character Count */}
        {maxLength && (
          <div className="absolute -bottom-5 right-0 text-xs text-gray-400">
            {inputValue.length}/{maxLength}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="absolute -bottom-8 left-0 right-0 flex items-center space-x-1 text-red-600 text-xs">
            <AlertCircle className="w-3 h-3" />
            <span>{error}</span>
          </div>
        )}

        {/* Offline Message */}
        {!isOnline && (
          <div className="absolute -bottom-8 left-0 right-0 flex items-center space-x-1 text-orange-600 text-xs">
            <WifiOff className="w-3 h-3" />
            <span>No internet connection</span>
          </div>
        )}
      </form>

      {/* Suggestions Dropdown */}
      {showSuggestions && filteredExamples.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 z-20 bg-gray-800 border border-gray-700 border-t-0 rounded-b-xl shadow-lg max-h-60 overflow-y-auto"
        >
          <div className="p-3">
            <div className="flex items-center space-x-2 mb-3">
              <Lightbulb className="w-4 h-4 text-yellow-400" />
              <span className="text-xs font-medium text-gray-300">Suggestions</span>
            </div>
            <div className="space-y-1">
              {filteredExamples.map((example, index) => (
                <button
                  key={index}
                  onClick={() => handleExampleClick(example)}
                  className="w-full text-left p-3 text-sm text-gray-200 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Loading Overlay */}
      {isLoading && (
        <div className="absolute inset-0 bg-gray-800 bg-opacity-75 rounded-xl flex items-center justify-center">
          <div className="flex items-center space-x-2 text-blue-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm font-medium">Processing...</span>
          </div>
        </div>
      )}

      {personalizedSuggestions.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 flex items-center space-x-2 text-xs font-medium text-blue-200">
            <Sparkles className="h-4 w-4" />
            <span>Personalized for you:</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {personalizedSuggestions.slice(0, 4).map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionUse(suggestion)}
                className="inline-flex items-center space-x-1 rounded-full border border-blue-500/40 bg-blue-500/10 px-3 py-1 text-xs text-blue-100 transition hover:border-blue-400 hover:bg-blue-400/20"
              >
                <span className="truncate max-w-[160px] text-left">{suggestion}</span>
                <ArrowUpRight className="h-3.5 w-3.5 opacity-80" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick Examples (when input is empty) */}
      {showExamples && !inputValue && !isLoading && (
        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-3 flex items-center space-x-2">
            <Lightbulb className="w-4 h-4 text-yellow-400" />
            <span>Try these examples:</span>
          </p>
          <div className="grid grid-cols-2 gap-2">
            {EXAMPLE_QUERIES.slice(0, 4).map((example, index) => (
              <button
                key={index}
                onClick={() => handleExampleClick(example)}
                className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-2 rounded-lg transition-all duration-200 hover:scale-105 text-left"
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default QueryInput;
