'use client';

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ChatComponentProps, ChatMessage } from '@/src/lib/types';
import { Send, Loader2, MapPin, User, Bot, Clock, AlertCircle, Sparkles, Shield } from 'lucide-react';
import PersonalizedSuggestions from '@/src/components/PersonalizedSuggestions';
import { AgentMetadata } from '@/src/components/AgentMetadata';

// Main Chat component
const Chat: React.FC<ChatComponentProps> = ({
  messages,
  onSendMessage,
  isLoading,
  className = '',
  inputRef: externalInputRef,
  suggestions = [],
  onSuggestionSelect,
  memoryContext,
  memoryEnabled = true,
  onToggleMemory,
  isMemoryHydrated = false,
}) => {
  const [inputValue, setInputValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);
  
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const memoryActive = memoryEnabled && Boolean(memoryContext);
  const memoryHighlights = useMemo(() => {
    if (!memoryContext || !memoryContext.preferences) {
      return [] as string[];
    }

    const highlights: string[] = [];
    if (memoryContext.preferences.favoritePOITypes?.length) {
      highlights.push(`Favorite: ${memoryContext.preferences.favoritePOITypes.slice(0, 2).join(', ')}`);
    }
    if (memoryContext.preferences.favoriteTransport?.length) {
      highlights.push(`Prefers ${memoryContext.preferences.favoriteTransport[0]}`);
    }
    if (memoryContext.frequentLocations?.length > 0) {
      highlights.push(`Often visits ${memoryContext.frequentLocations[0].location.display_name}`);
    }
    return highlights;
  }, [memoryContext]);

  const memorySubtitle = useMemo(() => {
    if (!memoryEnabled) {
      return 'Memory disabled';
    }
    if (!memoryContext) {
      return isMemoryHydrated ? 'Personalizing results' : 'Syncing your preferences…';
    }
    return memoryHighlights[0] || 'Personalizing results';
  }, [memoryContext, memoryEnabled, isMemoryHydrated, memoryHighlights]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const hasMessages = messages && messages.length > 0;

  // Handle form submission
  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inputValue.trim() || isLoading) {
      return;
    }

    const message = inputValue.trim();
    onSendMessage(message);
    setInputValue(''); // Clear input after sending
  }, [inputValue, isLoading, onSendMessage]);

  const handleSuggestionUse = useCallback((suggestion: string) => {
    if (isLoading) return;
    setInputValue('');
    if (onSuggestionSelect) {
      onSuggestionSelect(suggestion);
    } else {
      onSendMessage(suggestion);
    }
  }, [isLoading, onSendMessage, onSuggestionSelect]);

  // Handle input change
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  }, []);

  // Handle key press
  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();
      handleSubmit(e);
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
  const handleExampleClick = useCallback((example: string) => {
    handleSuggestionUse(example);
  }, [handleSuggestionUse]);

  const renderMemoryBanner = () => {
    if (onToggleMemory && !memoryEnabled) {
      return (
        <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900/80 px-4 py-3 text-xs text-gray-300">
          <div className="flex items-center space-x-2">
            <Shield className="h-4 w-4 text-gray-400" />
            <span>Memory is off. Turn it on for personalized results.</span>
          </div>
          <button
            onClick={() => onToggleMemory(true)}
            className="rounded-full border border-blue-500/30 px-3 py-1 text-[11px] font-medium text-blue-200 hover:border-blue-400/60 hover:text-blue-100"
          >
            Enable
          </button>
        </div>
      );
    }

    if (!memoryEnabled) {
      return null;
    }

    if (!memoryActive) {
      return (
        <div className="flex items-center justify-between border-b border-blue-500/10 bg-blue-500/5 px-4 py-3 text-[11px] text-blue-100">
          <div className="flex items-center space-x-2">
            <Sparkles className="h-4 w-4" />
            <span>{isMemoryHydrated ? 'No saved preferences yet. Try interacting to teach ChatMap.' : 'Syncing your preferences…'}</span>
          </div>
          {onToggleMemory && (
            <button
              onClick={() => onToggleMemory(false)}
              className="rounded-full border border-blue-500/20 px-3 py-1 text-[11px] text-blue-100/80 hover:border-blue-400/50"
            >
              Pause
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-between border-b border-blue-500/20 bg-blue-500/10 px-4 py-3 text-xs text-blue-100">
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="h-4 w-4" />
            <span className="font-semibold">Personalizing with your memory</span>
          </div>
          <p className="mt-1 text-[11px] text-blue-200">{memorySubtitle}</p>
        </div>
        {onToggleMemory && (
          <button
            onClick={() => onToggleMemory(false)}
            className="rounded-full border border-blue-500/20 px-3 py-1 text-[11px] font-medium text-blue-100 hover:border-blue-400/60 hover:text-blue-50"
          >
            Disable
          </button>
        )}
      </div>
    );
  };

  // Message component
  const Message: React.FC<{ message: ChatMessage }> = ({ message }) => {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const isSystem = message.role === 'system';

    const formatTimestamp = (timestamp: string) => {
      const date = new Date(timestamp);
      const now = new Date();
      const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

      if (diffInMinutes < 1) {
        return 'Just now';
      } else if (diffInMinutes < 60) {
        return `${diffInMinutes}m ago`;
      } else if (diffInMinutes < 1440) {
        const hours = Math.floor(diffInMinutes / 60);
        return `${hours}h ago`;
      } else {
        return date.toLocaleDateString();
      }
    };

    const getMessageIcon = () => {
      if (isUser) return <User className="w-4 h-4" />;
      if (isAssistant) return <Bot className="w-4 h-4" />;
      return <Clock className="w-4 h-4" />;
    };

    const getMessageStyles = () => {
      if (isUser) {
        return {
          container: 'flex justify-end',
          bubble: 'bg-blue-600 text-white rounded-2xl rounded-br-md px-4 py-3 max-w-[85%] sm:max-w-md break-words shadow-lg',
          icon: 'text-blue-600',
        };
      } else if (isAssistant) {
        return {
          container: 'flex justify-start',
          bubble: 'bg-gray-700 text-gray-100 rounded-2xl rounded-bl-md px-4 py-3 max-w-[85%] sm:max-w-md break-words shadow-lg',
          icon: 'text-gray-400',
        };
      } else {
        return {
          container: 'flex justify-center',
          bubble: 'bg-yellow-50 text-yellow-800 rounded-lg px-3 py-1 max-w-[90%] text-xs sm:text-sm break-words',
          icon: 'text-yellow-600',
        };
      }
    };

    const styles = getMessageStyles();

    return (
      <div className={`${styles.container} mb-4`}>
        <div className="flex items-start space-x-2 max-w-full">
          {!isUser && (
            <div className={`flex-shrink-0 mt-1 ${styles.icon}`}>
              {getMessageIcon()}
            </div>
          )}
          
          <div className="flex flex-col max-w-full">
            <div className={`${styles.bubble} break-words`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.content}
              </p>
            </div>
            
            {/* More Info button for assistant messages with POI data */}
            {isAssistant && message.metadata?.pois && message.metadata.pois.length > 0 && (
              <div className="mt-2">
                <button
                  onClick={() => {
                    // Trigger a custom event to show more POI details
                    const event = new CustomEvent('showPOIDetails', { 
                      detail: { 
                        pois: message.metadata?.pois,
                        query: message.metadata?.parsedQuery 
                      } 
                    });
                    window.dispatchEvent(event);
                  }}
                  className="inline-flex items-center space-x-1 px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 text-xs font-medium rounded-md transition-colors"
                >
                  <MapPin className="w-3 h-3" />
                  <span>More Info ({message.metadata.pois.length} places)</span>
                </button>
              </div>
            )}
            
            <div className={`flex items-center space-x-1 mt-1 ${isUser ? 'justify-end' : 'justify-start'}`}>
              <span className="text-xs text-gray-400">
                {formatTimestamp(message.timestamp)}
              </span>
              {message.metadata?.processingTime && (
                <span className="text-xs text-gray-500">
                  ({Math.round(message.metadata.processingTime)}ms)
                </span>
              )}
            </div>
            
            {message.metadata?.parsedQuery && (
              <div className="mt-2 p-2 bg-blue-50 rounded-lg text-xs">
                <div className="flex items-center space-x-1 mb-1">
                  <MapPin className="w-3 h-3 text-blue-600" />
                  <span className="font-medium text-blue-800">Query Details:</span>
                </div>
                <div className="text-blue-700 space-y-1">
                  <p>Type: {message.metadata.parsedQuery.poiType}</p>
                  <p>Transport: {message.metadata.parsedQuery.transport}</p>
                  <p>Time: {message.metadata.parsedQuery.timeMinutes} min</p>
                </div>
              </div>
            )}

            {message.metadata?.error && (
              <div className="mt-2 p-2 bg-red-50 rounded-lg text-xs">
                <div className="flex items-center space-x-1 mb-1">
                  <AlertCircle className="w-3 h-3 text-red-600" />
                  <span className="font-medium text-red-800">Error Details:</span>
                </div>
                <div className="text-red-700">
                  <p>{message.metadata.error}</p>
                </div>
              </div>
            )}

            {message.metadata?.agent && (
              <AgentMetadata
                classification={message.metadata.agent.classification}
                agentUsed={message.metadata.agent.agentUsed}
                toolsUsed={message.metadata.agent.toolsUsed}
                reasoningSteps={message.metadata.agent.reasoningSteps}
                executionTimeMs={message.metadata.agent.executionTimeMs}
                apiCallsCount={message.metadata.agent.apiCallsCount}
                warnings={message.metadata.agent.warnings}
              />
            )}
          </div>
          
          {isUser && (
            <div className={`flex-shrink-0 mt-1 ${styles.icon}`}>
              {getMessageIcon()}
            </div>
          )}
        </div>
      </div>
    );
  };

  // Loading indicator component
  const LoadingIndicator: React.FC = () => (
    <div className="flex justify-start mb-4">
      <div className="flex items-start space-x-2">
        <div className="flex-shrink-0 mt-1 text-gray-400">
          <Bot className="w-4 h-4" />
        </div>
        <div className="bg-gray-700 text-gray-100 rounded-2xl rounded-bl-md px-4 py-3 shadow-lg">
          <div className="flex items-center space-x-2">
            <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
            <span className="text-sm">Mapping...</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className={`flex h-full flex-col bg-gray-800 shadow-xl overflow-hidden ${className}`}>
      {renderMemoryBanner()}
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {!hasMessages ? (
          /* Welcome Screen */
          <div className="flex-1 flex flex-col items-center justify-start pt-8 px-6 space-y-4 max-h-[calc(100vh-200px)] overflow-y-auto">
          {/* Location Icon */}
          <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center flex-shrink-0">
            <MapPin className="w-6 h-6 text-white" />
          </div>

          {/* Welcome Text */}
          <div className="text-center space-y-1 flex-shrink-0">
            <h2 className="text-xl font-bold text-white">Welcome to ChatMap!</h2>
            <p className="text-gray-400 text-sm">Ask me to find places near you. Try something like:</p>
          </div>

          {/* Example Buttons */}
          <div className="w-full space-y-2 flex-shrink-0">
            {[
              "Find coffee shops within 15 minutes walk",
              "Show me restaurants I can drive to in 10 minutes",
              "Where are the nearest pharmacies?"
            ].map((example) => (
              <button
                key={example}
                onClick={() => handleExampleClick(example)}
                className="w-full py-2.5 px-3 bg-slate-700/80 hover:bg-slate-600/80 text-white rounded-lg transition-all duration-200 text-left text-sm"
              >
                {example}
              </button>
            ))}
          </div>

          {suggestions.length > 0 && (
            <PersonalizedSuggestions
              suggestions={suggestions}
              onSuggestionSelect={handleSuggestionUse}
              className="w-full"
            />
          )}

          {/* Input Field */}
          <div className="w-full">
            <form onSubmit={handleSubmit} className="flex space-x-3">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder="Ask me to find places near you..."
                  disabled={isLoading}
                  className="w-full px-4 py-3 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white bg-gray-700 placeholder-gray-400 transition-all duration-200 shadow-inner"
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => setInputValue('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded-full p-1 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </form>
          </div>
        </div>
        ) : (
          /* Chat Interface */
          <>
          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gradient-to-b from-gray-800 to-gray-900 min-h-0 max-h-full">
            {messages.map((message, index) => (
              <Message
                key={message.id || index}
                message={message}
              />
            ))}
            {isLoading && <LoadingIndicator />}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area - Hidden on mobile as we have bottom input */}
          <div className="hidden lg:flex flex-shrink-0 flex-col space-y-3 border-t border-gray-700 p-4 bg-gray-800/95 backdrop-blur-sm min-h-0">
            {suggestions.length > 0 && (
              <PersonalizedSuggestions
                suggestions={suggestions}
                onSuggestionSelect={handleSuggestionUse}
              />
            )}
            <form onSubmit={handleSubmit} className="flex space-x-3 w-full">
              <div className="flex-1 relative">
                <input
                  ref={inputRef}
                  type="text"
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder="Ask me to find places near you..."
                  disabled={isLoading}
                  className="w-full px-4 py-3 border border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white bg-gray-700 placeholder-gray-400 transition-all duration-200 shadow-inner"
                />
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => setInputValue('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-200 hover:bg-gray-600 rounded-full p-1 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!inputValue.trim() || isLoading}
                className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center shadow-lg hover:shadow-xl hover:scale-105"
              >
                {isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </form>
          </div>
        </>
        )}
      </div>
    </div>
  );
};

export default Chat;
