'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { 
  Location, 
  MapState, 
  ChatMessage, 
  ParsedQuery, 
  POI, 
  IsochroneData,
  POIType,
  TransportMode,
  UserPreferences,
  MemoryContextSummary,
} from '@/src/lib/types';
import Chat from '@/src/components/Chat';
import QueryInput from '@/src/components/QueryInput';
import { MapPin, AlertCircle, Loader2, RefreshCw, Wifi, WifiOff, MapPinOff, Bot, Shield, Sparkles } from 'lucide-react';
import { createError, ErrorType, formatError, isRetryableError, debounce } from '@/src/lib/utils';
import { MapSkeleton } from '@/src/components/LoadingSkeleton';
import ConversationContext from '@/src/components/ConversationContext';
import { v4 as uuidv4 } from 'uuid';

// Dynamic import for Map component to avoid SSR issues
const MapComponent = dynamic(() => import('@/src/components/Map'), {
  ssr: false,
  loading: () => <MapSkeleton />,
});

// Memoized components for performance
const MemoizedChat = React.memo(Chat);
const MemoizedQueryInput = React.memo(QueryInput);

// API response types
interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

// Loading states for different operations
interface LoadingStates {
  geolocation: boolean;
  geocoding: boolean;
  parsing: boolean;
  isochrone: boolean;
  pois: boolean;
  responding: boolean;
}

// Error states
interface ErrorStates {
  geolocation: string | null;
  geocoding: string | null;
  parsing: string | null;
  isochrone: string | null;
  pois: string | null;
  responding: string | null;
  network: string | null;
  ollama: string | null;
}

// Error recovery actions
interface ErrorRecovery {
  canRetry: boolean;
  canFallback: boolean;
  action: string;
  description: string;
}

const USER_ID_STORAGE_KEY = 'chatmap:user-id';
const MEMORY_ENABLED_STORAGE_KEY = 'chatmap:memory-enabled';

const resolveUserId = () => {
  if (typeof window === 'undefined') {
    return `anon-${Math.random().toString(36).slice(2)}`;
  }
  const stored = window.localStorage.getItem(USER_ID_STORAGE_KEY);
  if (stored && stored.trim().length > 0) {
    return stored;
  }
  const newId = uuidv4();
  window.localStorage.setItem(USER_ID_STORAGE_KEY, newId);
  return newId;
};

const resolveMemoryEnabled = () => {
  if (typeof window === 'undefined') {
    return true;
  }
  const stored = window.localStorage.getItem(MEMORY_ENABLED_STORAGE_KEY);
  if (stored === null) {
    return true;
  }
  return stored !== 'false';
};

interface ParseAPIResponse {
  parsedQuery: ParsedQuery;
  memoryContext: MemoryContextSummary;
  preferenceSignals: UserPreferences;
  personalizedSuggestions: string[];
  recordedMemoryIds?: {
    preferenceId?: string;
  };
}

interface RespondAPIResponse {
  response: string;
  memoryContext: MemoryContextSummary;
  preferenceSignals: UserPreferences;
  personalizedSuggestions: string[];
  recordedMemoryIds: {
    conversationId?: string;
    locationId?: string;
    preferenceId?: string;
  };
}

type CachedQuery = {
  isochrone: IsochroneData | null;
  pois: POI[];
  center: Location;
  response: string;
  memoryContext?: MemoryContextSummary;
  suggestions?: string[];
};

export default function Home() {
  // Application state
  const [mapState, setMapState] = useState<MapState>({
    center: { lat: 0, lng: 0, display_name: 'Loading...' },
    zoom: 13,
    isochrone: null,
    pois: [],
    selectedPOI: null,
    isLoading: false,
    error: null,
  });

  // State for user's current location and selected location for queries
  const [userLocation, setUserLocation] = useState<Location | null>(null);
  const [queryLocation, setQueryLocation] = useState<Location | null>(null);
  const [showLocationMarker, setShowLocationMarker] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentQuery, setCurrentQuery] = useState<string>('');
  const [isGeolocationEnabled, setIsGeolocationEnabled] = useState(false);
  
  // Refs for clearing inputs
  const chatInputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);
  const isProcessingRef = useRef(false);
  
  // Address autocomplete state
  const [addressSuggestions, setAddressSuggestions] = useState<Location[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  // Loading and error states
  const [loadingStates, setLoadingStates] = useState<LoadingStates>({
    geolocation: false,
    geocoding: false,
    parsing: false,
    isochrone: false,
    pois: false,
    responding: false,
  });

  const [errorStates, setErrorStates] = useState<ErrorStates>({
    geolocation: null,
    geocoding: null,
    parsing: null,
    isochrone: null,
    pois: null,
    responding: null,
    network: null,
    ollama: null,
  });

  const [errorRecovery, setErrorRecovery] = useState<ErrorRecovery | null>(null);
  const [isOnline, setIsOnline] = useState(true);

  // Performance optimization states
  const [poiPage, setPoiPage] = useState(1);
  const [poiPageSize] = useState(20);
  const [hasMorePOIs, setHasMorePOIs] = useState(false);
  const [isLoadingMorePOIs, setIsLoadingMorePOIs] = useState(false);
  const [cachedQueries, setCachedQueries] = useState<Map<string, CachedQuery>>(new Map<string, CachedQuery>());

  // Memory and personalization state
  const [userId, setUserId] = useState<string>('');
  const [userPreferences, setUserPreferences] = useState<UserPreferences>({});
  const [memoryContext, setMemoryContext] = useState<MemoryContextSummary | null>(null);
  const [personalizedSuggestions, setPersonalizedSuggestions] = useState<string[]>([]);
  const [memoryEnabled, setMemoryEnabled] = useState<boolean>(() => (typeof window === 'undefined' ? true : resolveMemoryEnabled()));
  const [isMemoryHydrated, setIsMemoryHydrated] = useState(false);
  const [memoryInsightsLoading, setMemoryInsightsLoading] = useState(false);
  const [isClearingMemory, setIsClearingMemory] = useState(false);

  // Refs for cleanup
  const geolocationWatchId = useRef<number | null>(null);

  // Memory and personalization functions
  const fetchMemoryInsights = useCallback(async () => {
    if (!userId || !memoryEnabled) {
      return;
    }

    setMemoryInsightsLoading(true);
    try {
      const response = await fetch(`/api/memory?resource=insights`, {
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch memory insights (${response.status})`);
      }

      const payload = await response.json();
      if (payload?.success && payload.data) {
        const insights = payload.data;
        if (insights.preferences) {
          setUserPreferences(insights.preferences);
        }
        setMemoryContext((prev) => ({
          userId,
          preferences: insights.preferences ?? prev?.preferences ?? {},
          conversationMemories: insights.conversationHighlights ?? prev?.conversationMemories ?? [],
          locationHistory: insights.locationHistory ?? prev?.locationHistory ?? [],
          frequentLocations: insights.frequentLocations ?? prev?.frequentLocations ?? [],
          relevantMemories: prev?.relevantMemories ?? [],
        }));
        if (Array.isArray(insights.personalizedSuggestions)) {
          setPersonalizedSuggestions(insights.personalizedSuggestions);
        }
        setIsMemoryHydrated(true);
      }
    } catch (error) {
      console.error('Failed to load memory insights:', error);
    } finally {
      setMemoryInsightsLoading(false);
    }
  }, [userId, memoryEnabled]);

  useEffect(() => {
    if (!userId) {
      setUserId(resolveUserId());
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }
    if (!memoryEnabled) {
      setMemoryContext(null);
      setPersonalizedSuggestions([]);
      return;
    }
    fetchMemoryInsights();
  }, [userId, memoryEnabled, fetchMemoryInsights]);

  // ============================================================================
  // ERROR HANDLING UTILITIES
  // ============================================================================

  const handleError = useCallback((
    error: unknown,
    errorType: keyof ErrorStates,
    context?: string
  ) => {
    console.error(`Error in ${context || errorType}:`, error);
    
    const errorMessage = formatError(error);
    setErrorStates(prev => ({ ...prev, [errorType]: errorMessage }));
    
    // Determine recovery options
    const canRetry = isRetryableError(error);
    const canFallback = errorType !== 'network' && errorType !== 'ollama';
    
    let action = 'Try Again';
    let description = 'Please try again in a moment.';
    
    if (errorType === 'geolocation') {
      action = 'Enable Location';
      description = 'Please enable location access in your browser settings.';
    } else if (errorType === 'network') {
      action = 'Check Connection';
      description = 'Please check your internet connection and try again.';
    } else if (errorType === 'ollama') {
      action = 'Check Ollama';
      description = 'Please ensure Ollama is running on localhost:11434.';
    } else if (errorType === 'parsing') {
      action = 'Rephrase Query';
      description = 'Try rephrasing your question in a different way.';
    } else if (errorType === 'pois') {
      action = 'Try Different Area';
      description = 'No places found in this area. Try a different location or time range.';
    }
    
    setErrorRecovery({
      canRetry,
      canFallback,
      action,
      description,
    });
  }, []);

  const clearError = useCallback((errorType: keyof ErrorStates) => {
    setErrorStates(prev => ({ ...prev, [errorType]: null }));
    setErrorRecovery(null);
  }, []);

  const clearAllErrors = useCallback(() => {
    setErrorStates({
      geolocation: null,
      geocoding: null,
      parsing: null,
      isochrone: null,
      pois: null,
      responding: null,
      network: null,
      ollama: null,
    });
    setErrorRecovery(null);
  }, []);

  // ============================================================================
  // NETWORK STATUS MONITORING
  // ============================================================================

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      clearError('network');
    };

    const handleOffline = () => {
      setIsOnline(false);
      handleError(createError(ErrorType.NETWORK, 'No internet connection'), 'network');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [handleError, clearError]);

  // ============================================================================
  // GEOLOCATION HANDLING
  // ============================================================================

  const getCurrentLocation = useCallback(async (): Promise<Location | null> => {
    if (!navigator.geolocation) {
      handleError(createError(ErrorType.GEOLOCATION, 'Geolocation not supported by this browser'), 'geolocation');
      return null;
    }

    if (!isOnline) {
      handleError(createError(ErrorType.NETWORK, 'No internet connection required for location services'), 'network');
      return null;
    }

    setLoadingStates(prev => ({ ...prev, geolocation: true }));
    clearError('geolocation');

    return new Promise((resolve) => {
      const options: PositionOptions = {
        enableHighAccuracy: true,
        timeout: 15000, // Increased timeout
        maximumAge: 300000, // 5 minutes
      };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location: Location = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
            display_name: `Current Location (${position.coords.latitude.toFixed(4)}, ${position.coords.longitude.toFixed(4)})`,
          };
          
          setLoadingStates(prev => ({ ...prev, geolocation: false }));
          clearError('geolocation');
          setIsGeolocationEnabled(true);
          
          // Set user location and recenter map
          setUserLocation(location);
          setQueryLocation(location); // Use current location for queries by default
          setMapState(prev => ({ ...prev, center: location }));
          setShowLocationMarker(true);
          
          resolve(location);
        },
        (error) => {
          let errorType: ErrorType;
          let errorMessage: string;
          
          switch (error.code) {
            case error.PERMISSION_DENIED:
              errorType = ErrorType.GEOLOCATION;
              errorMessage = 'Location access denied. Please enable location permissions in your browser settings.';
              break;
            case error.POSITION_UNAVAILABLE:
              errorType = ErrorType.GEOLOCATION;
              errorMessage = 'Location information unavailable. Please check your GPS settings.';
              break;
            case error.TIMEOUT:
              errorType = ErrorType.NETWORK;
              errorMessage = 'Location request timed out. Please try again.';
              break;
            default:
              errorType = ErrorType.UNKNOWN;
              errorMessage = 'Failed to get your location. Please try again.';
          }
          
          setLoadingStates(prev => ({ ...prev, geolocation: false }));
          handleError(createError(errorType, errorMessage), 'geolocation');
          resolve(null);
        },
        options
      );
    });
  }, [isOnline, handleError, clearError]);

  // ============================================================================
  // API CALLS
  // ============================================================================

  const callAPI = useCallback(async <T,>(
    url: string, 
    options: RequestInit = {},
    loadingKey: keyof LoadingStates,
    errorKey: keyof ErrorStates
  ): Promise<T | null> => {
    if (!isOnline) {
      handleError(createError(ErrorType.NETWORK, 'No internet connection'), 'network');
      return null;
    }

    setLoadingStates(prev => ({ ...prev, [loadingKey]: true }));
    clearError(errorKey);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const { headers: providedHeaders, ...restOptions } = options;
      const headers = new Headers(providedHeaders as HeadersInit | undefined);
      if (!headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }
      if (userId) {
        headers.set('X-User-Id', userId);
      }
      headers.set('X-Memory-Enabled', memoryEnabled ? 'true' : 'false');

      const response = await fetch(url, {
        ...restOptions,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw createError(ErrorType.API, 'Authentication failed. Please check your API keys.');
        } else if (response.status === 429) {
          throw createError(ErrorType.API, 'Rate limit exceeded. Please wait a moment and try again.');
        } else if (response.status >= 500) {
          throw createError(ErrorType.API, 'Server error. Please try again later.');
        } else {
          throw createError(ErrorType.API, `Request failed with status ${response.status}`);
        }
      }

      const data: APIResponse<T> = await response.json();

      if (!data.success) {
        console.error('API Error Response:', data);
        throw createError(ErrorType.API, data.error || 'API request failed');
      }

      setLoadingStates(prev => ({ ...prev, [loadingKey]: false }));
      return data.data || null;
    } catch (error) {
      setLoadingStates(prev => ({ ...prev, [loadingKey]: false }));
      
      console.error(`API Call Error for ${url}:`, error);
      
      if (error instanceof Error && error.name === 'AbortError') {
        handleError(createError(ErrorType.NETWORK, 'Request timed out. Please try again.'), errorKey);
      } else if (error instanceof Error && error.message.includes('Failed to fetch')) {
        handleError(createError(ErrorType.NETWORK, 'Network error. Please check your connection.'), 'network');
      } else if (error instanceof Error && error.message.includes('Ollama')) {
        handleError(createError(ErrorType.UNKNOWN, 'Ollama connection failed. Please ensure Ollama is running.'), 'ollama');
      } else {
        // Better error handling for different error types
        let errorMessage = 'An unexpected error occurred';
        if (error instanceof Error) {
          errorMessage = error.message;
        } else if (typeof error === 'string') {
          errorMessage = error;
        } else if (error && typeof error === 'object') {
          errorMessage = JSON.stringify(error);
        }
        handleError(createError(ErrorType.UNKNOWN, errorMessage), errorKey, `API call to ${url}`);
      }
      
      return null;
    }
  }, [isOnline, handleError, clearError, userId, memoryEnabled]);

  // ============================================================================
  // PERFORMANCE OPTIMIZATIONS
  // ============================================================================

  const parseQuery = useCallback(
    async (query: string, location: Location, conversationHistory?: ChatMessage[]): Promise<ParseAPIResponse | null> => {
      return callAPI<ParseAPIResponse>(
        '/api/chat',
        {
          method: 'POST',
          body: JSON.stringify({
            type: 'parse',
            message: query,
            location,
            conversationHistory,
            userId,
            memoryEnabled,
          }),
        },
        'parsing',
        'parsing'
      );
    },
    [callAPI, userId, memoryEnabled]
  );

  const generateIsochrone = useCallback(
    async (location: Location, timeMinutes: number, transport: TransportMode): Promise<IsochroneData | null> => {
      return callAPI<IsochroneData>(
        '/api/isochrone',
        {
          method: 'POST',
          body: JSON.stringify({
            location,
            timeMinutes,
            transport,
          }),
        },
        'isochrone',
        'isochrone'
      );
    },
    [callAPI]
  );

  const fetchPOIs = useCallback(
    async (
      location: Location,
      poiType: POIType,
      isochroneData: IsochroneData,
      page: number = 1,
      pageSize: number = 20,
      keywords?: string[],
      cuisine?: string,
      priceRange?: string
    ): Promise<POI[] | null> => {
      return callAPI<POI[]>(
        '/api/pois',
        {
          method: 'POST',
          body: JSON.stringify({
            location,
            poiType,
            isochroneData,
            page,
            pageSize,
            keywords,
            cuisine,
            priceRange,
          }),
        },
        'pois',
        'pois'
      );
    },
    [callAPI]
  );

  // Generate response
  const generateResponse = useCallback(async (query: ParsedQuery, pois: POI[], isochroneData: IsochroneData, conversationHistory?: ChatMessage[]): Promise<RespondAPIResponse | null> => {
    return callAPI<RespondAPIResponse>(
      '/api/chat',
      {
        method: 'POST',
        body: JSON.stringify({
          type: 'respond',
          query,
          pois,
          isochroneData,
          conversationHistory,
          userId,
          memoryEnabled,
        }),
      },
      'responding',
      'responding'
    );
  }, [callAPI, userId, memoryEnabled]);

  // Internal query processing function
  const processQueryInternal = useCallback(async (query: string) => {
    if (!query.trim()) return;
    
    if (isProcessing) {
      console.log('processQueryInternal: Already processing, ignoring query:', query);
      return;
    }

    console.log('processQueryInternal: Starting to process query:', query);
    setIsProcessing(true);
    isProcessingRef.current = true;
    setCurrentQuery(query);
    clearAllErrors();

    // Add user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: query,
      timestamp: new Date().toISOString(),
      id: Date.now().toString(),
    };
    setMessages(prev => [...prev, userMessage]);

    try {
      // Use query location if available, otherwise fall back to user location or map center
      // But avoid using (0,0) which causes isochrone API to fail
      let locationForQuery = queryLocation || userLocation || mapState.center;
      
      // If location is (0,0), try to get current location first
      if (locationForQuery.lat === 0 && locationForQuery.lng === 0) {
        console.log('Location is (0,0), attempting to get current location...');
        const currentLocation = await getCurrentLocation();
        if (currentLocation) {
          locationForQuery = currentLocation;
          setQueryLocation(currentLocation);
          setShowLocationMarker(true);
        } else {
          // If we can't get location, use a default location (Houston, TX)
          locationForQuery = {
            lat: 29.7604,
            lng: -95.3698,
            display_name: 'Houston, TX (Default)'
          };
          console.log('Using default location:', locationForQuery);
        }
      }
      
      // Step 1: Parse query
      const parseResult = await parseQuery(query, locationForQuery, messages);
      if (!parseResult) {
        throw createError(ErrorType.PARSING, 'Unable to understand your request. Please try rephrasing your question.');
      }

      const parsedQuery = parseResult.parsedQuery;

      if (parseResult.memoryContext) {
        setMemoryContext(parseResult.memoryContext);
        setUserPreferences(parseResult.memoryContext.preferences ?? {});
        setPersonalizedSuggestions(parseResult.personalizedSuggestions ?? []);
        setIsMemoryHydrated(true);
      }

      // Step 2: Generate isochrone
      const isochroneData = await generateIsochrone(
        parsedQuery.location,
        parsedQuery.timeMinutes,
        parsedQuery.transport
      );
      if (!isochroneData) {
        throw createError(ErrorType.API, 'Unable to calculate travel time. Please try a different location or time range.');
      }

      // Update map with isochrone
      setMapState(prev => ({
        ...prev,
        center: parsedQuery.location,
        isochrone: isochroneData,
        pois: [],
        selectedPOI: null,
        error: null,
      }));

      // Step 3: Fetch POIs with pagination
      const pois = await fetchPOIs(
        parsedQuery.location, 
        parsedQuery.poiType, 
        isochroneData, 
        1, 
        poiPageSize,
        parsedQuery.keywords,
        parsedQuery.cuisine,
        parsedQuery.priceRange
      );
      if (!pois) {
        throw createError(ErrorType.API, 'Unable to find places. Please try a different area or search term.');
      }

      // Step 3.5: Calculate multi-modal durations if requested
      let finalPOIs = pois;
      if (parsedQuery.showMultiModalDurations) {
        try {
          const transportModes: TransportMode[] = ['walking', 'driving', 'cycling', 'public_transport'];
          const durationResponse = await fetch('/api/durations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pois: pois.slice(0, 10), // Limit to first 10 POIs for performance
              origin: parsedQuery.location,
              transportModes
            })
          });
          
          if (durationResponse.ok) {
            const durationData = await durationResponse.json();
            if (durationData.success && durationData.data) {
              finalPOIs = durationData.data;
              console.log('Multi-modal durations calculated for POIs');
            }
          }
        } catch (error) {
          console.error('Error calculating multi-modal durations:', error);
          // Continue with original POIs if duration calculation fails
        }
      }

      // Check if no POIs found
      if (finalPOIs.length === 0) {
        const noResultsMessage: ChatMessage = {
          role: 'assistant',
          content: `I couldn't find any ${parsedQuery.poiType}s within ${parsedQuery.timeMinutes} minutes by ${parsedQuery.transport} from ${parsedQuery.location.display_name}. Try expanding your search area, adjusting the time limit, or searching for a different type of place.`,
          timestamp: new Date().toISOString(),
          id: (Date.now() + 1).toString(),
          metadata: {
            queryType: 'poi_search',
            parsedQuery,
            processingTime: Date.now() - new Date(userMessage.timestamp).getTime(),
          },
        };
        setMessages(prev => [...prev, noResultsMessage]);
        
        setMapState(prev => ({
          ...prev,
          pois: [],
          selectedPOI: null,
        }));
        
        setIsProcessing(false);
        setCurrentQuery('');
        return;
      }

      // Update map with POIs
      setMapState(prev => ({
        ...prev,
        pois: finalPOIs,
      }));

      // Set pagination state
      setHasMorePOIs(finalPOIs.length === poiPageSize);
      setPoiPage(1);

      // Step 4: Generate response
      const responsePayload = await generateResponse(parsedQuery, finalPOIs, isochroneData, messages);

      if (responsePayload?.memoryContext) {
        setMemoryContext(responsePayload.memoryContext);
        setUserPreferences(responsePayload.memoryContext.preferences ?? {});
        setPersonalizedSuggestions(responsePayload.personalizedSuggestions ?? []);
      }

      const responseText = responsePayload?.response;

      if (!responseText) {
        // Generate contextual fallback response
        let fallbackResponse = '';
        
        if (parsedQuery.searchStrategy === 'nearest_only') {
          const nearestPOI = finalPOIs[0];
          const durationInfo = nearestPOI.durations ? 
            Object.entries(nearestPOI.durations)
              .map(([mode, time]) => `${mode}: ${time}min`)
              .join(', ') : 
            `${Math.round((nearestPOI.distance || 0) / 1000 * 100) / 100}km away`;
          
          fallbackResponse = `Found the nearest ${parsedQuery.poiType}: ${nearestPOI.name} (${durationInfo})`;
        } else {
          const durationInfo = finalPOIs[0].durations ? 
            Object.entries(finalPOIs[0].durations)
              .map(([mode, time]) => `${mode}: ${time}min`)
              .join(', ') : 
            `${Math.round((finalPOIs[0].distance || 0) / 1000 * 100) / 100}km away`;
          
          fallbackResponse = `Found ${finalPOIs.length} ${parsedQuery.poiType}s within ${parsedQuery.timeMinutes} minutes by ${parsedQuery.transport}. The closest is ${finalPOIs[0].name} (${durationInfo})`;
        }
        
        const fallbackMessage: ChatMessage = {
          role: 'assistant',
          content: fallbackResponse,
          timestamp: new Date().toISOString(),
          id: (Date.now() + 1).toString(),
          metadata: {
            queryType: 'poi_search',
            parsedQuery,
            processingTime: Date.now() - new Date(userMessage.timestamp).getTime(),
          },
        };
        setMessages(prev => [...prev, fallbackMessage]);
      } else {
        // Add AI-generated response
        const assistantMessage: ChatMessage = {
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString(),
          id: (Date.now() + 1).toString(),
          metadata: {
            queryType: 'poi_search',
            parsedQuery,
            processingTime: Date.now() - new Date(userMessage.timestamp).getTime(),
            memoryContextIds: responsePayload?.recordedMemoryIds
              ? (Object.values(responsePayload.recordedMemoryIds).filter(Boolean) as string[])
              : undefined,
          },
        };
        setMessages(prev => [...prev, assistantMessage]);
      }

      // Cache the result
      const cacheKey = `query_${query}_${mapState.center.lat}_${mapState.center.lng}`;
      setCachedQueries(prev => {
        const next = new Map<string, CachedQuery>(prev);
        next.set(cacheKey, {
          isochrone: isochroneData,
          pois: finalPOIs,
          center: parsedQuery.location,
          response: responseText || `Found ${finalPOIs.length} ${parsedQuery.poiType}s near you!`,
          memoryContext: responsePayload?.memoryContext,
          suggestions: responsePayload?.personalizedSuggestions ?? [],
        });
        return next;
      });

    } catch (error) {
      console.error('Query processing error:', error);
      
      // Determine error type and create appropriate message
      let errorMessage: string;
      let errorType: ErrorType;
      
      if (error instanceof Error) {
        if (error.message.includes('parse') || error.message.includes('understand')) {
          errorType = ErrorType.PARSING;
          errorMessage = 'I had trouble understanding your request. Please try rephrasing your question in a different way.';
        } else if (error.message.includes('isochrone') || error.message.includes('travel time')) {
          errorType = ErrorType.API;
          errorMessage = 'Unable to calculate travel time. Please try a different location or time range.';
        } else if (error.message.includes('places') || error.message.includes('POI')) {
          errorType = ErrorType.API;
          errorMessage = 'Unable to find places. Please try a different area or search term.';
        } else if (error.message.includes('Ollama') || error.message.includes('AI')) {
          errorType = ErrorType.UNKNOWN;
          errorMessage = 'AI service temporarily unavailable. Please try again in a moment.';
        } else {
          errorType = ErrorType.UNKNOWN;
          errorMessage = 'Something went wrong. Please try again.';
        }
      } else {
        errorType = ErrorType.UNKNOWN;
        errorMessage = 'An unexpected error occurred. Please try again.';
      }
      
      // Add error message to chat
      const errorChatMessage: ChatMessage = {
        role: 'assistant',
        content: `I'm sorry, ${errorMessage.toLowerCase()}`,
        timestamp: new Date().toISOString(),
        id: (Date.now() + 1).toString(),
        metadata: {
          queryType: 'general',
          error: errorMessage,
        },
      };
      setMessages(prev => [...prev, errorChatMessage]);

      // Update map state with error
      setMapState(prev => ({ ...prev, error: errorMessage }));
      
      // Set error recovery options
      handleError(createError(errorType, errorMessage), 'responding');
    } finally {
      console.log('processQueryInternal: Finished processing, resetting state');
      setIsProcessing(false);
      isProcessingRef.current = false;
      setCurrentQuery('');
      
      // Clear input fields
      if (chatInputRef.current) {
        chatInputRef.current.value = '';
      }
      if (mobileInputRef.current) {
        mobileInputRef.current.value = '';
      }
      
      // Safety timeout to ensure processing state is reset
      setTimeout(() => {
        if (isProcessingRef.current) {
          console.log('Safety timeout: Forcing isProcessing to false');
          setIsProcessing(false);
          isProcessingRef.current = false;
        }
      }, 1000);
    }
  }, [
    mapState.center,
    parseQuery,
    generateIsochrone,
    fetchPOIs,
    generateResponse,
    clearAllErrors,
    handleError,
    poiPageSize,
    queryLocation,
    messages,
    userLocation,
    getCurrentLocation,
    isProcessing,
  ]);

  const processQuery = useCallback(async (query: string) => {
    if (!query.trim()) {
      return;
    }

    if (isProcessing || isProcessingRef.current) {
      console.log('Query already being processed, ignoring:', query);
      return;
    }

    const cacheKey = `query_${query}_${mapState.center.lat}_${mapState.center.lng}`;
    const cachedResult = cachedQueries.get(cacheKey);

    if (cachedResult) {
      setMapState(prev => ({
        ...prev,
        isochrone: cachedResult.isochrone,
        pois: cachedResult.pois,
        center: cachedResult.center,
      }));

      if (cachedResult.memoryContext) {
        setMemoryContext(cachedResult.memoryContext);
        setUserPreferences(cachedResult.memoryContext.preferences ?? {});
        setIsMemoryHydrated(true);
      }

      if (cachedResult.suggestions) {
        setPersonalizedSuggestions(cachedResult.suggestions);
      }

      const cachedMessage: ChatMessage = {
        role: 'assistant',
        content: cachedResult.response,
        timestamp: new Date().toISOString(),
        id: Date.now().toString(),
      };
      setMessages(prev => [...prev, cachedMessage]);
      return;
    }

    console.log('processQuery: processing query immediately:', query);
    await processQueryInternal(query);
  }, [cachedQueries, mapState.center, isProcessing, processQueryInternal]);


  const handleMemoryToggle = useCallback((enabled: boolean) => {
    setMemoryEnabled(enabled);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MEMORY_ENABLED_STORAGE_KEY, enabled ? 'true' : 'false');
    }
    if (!enabled) {
      setMemoryContext(null);
      setPersonalizedSuggestions([]);
      setUserPreferences({});
      setIsMemoryHydrated(false);
    } else if (userId) {
      fetchMemoryInsights();
    }
  }, [fetchMemoryInsights, userId]);

  const handleClearMemories = useCallback(async () => {
    if (!userId) {
      return;
    }
    setIsClearingMemory(true);
    try {
      const response = await fetch('/api/memory?resource=all', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Id': userId,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to clear memory (${response.status})`);
      }

      setMemoryContext(null);
      setPersonalizedSuggestions([]);
      setUserPreferences({});
      setIsMemoryHydrated(false);
    } catch (error) {
      console.error('Failed to clear stored memories:', error);
    } finally {
      setIsClearingMemory(false);
    }
  }, [userId]);


  // ============================================================================
  // ADDRESS SEARCH FUNCTIONALITY
  // ============================================================================

  // Debounced address search for autocomplete
  const searchAddressSuggestions = useMemo(
    () => debounce(async (query: string) => {
      if (!query.trim() || query.length < 3) {
        setAddressSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      setIsLoadingSuggestions(true);
      try {
        const response = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: query, suggestions: true }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.suggestions) {
            setAddressSuggestions(data.suggestions);
            setShowSuggestions(true);
          } else {
            setAddressSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          setAddressSuggestions([]);
          setShowSuggestions(false);
        }
      } catch (error) {
        console.error('Address suggestion error:', error);
        setAddressSuggestions([]);
        setShowSuggestions(false);
      } finally {
        setIsLoadingSuggestions(false);
      }
    }, 300),
    []
  );

  // Handle address input change
  const handleAddressInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAddressInput(value);
    searchAddressSuggestions(value);
  }, [searchAddressSuggestions]);

  useEffect(() => {
    const debouncedFn = searchAddressSuggestions as typeof searchAddressSuggestions & { cancel?: () => void };
    return () => {
      debouncedFn.cancel?.();
    };
  }, [searchAddressSuggestions]);

  const handleAddressSearch = useCallback(async (address: string) => {
    try {
      setMapState(prev => ({ ...prev, isLoading: true, error: null }));
      
      // Call geocoding API
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address }),
      });

      if (!response.ok) {
        throw new Error(`Geocoding failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.success && data.location) {
        const location = data.location;
        
        // Update query location and recenter map
        setQueryLocation(location);
        setShowLocationMarker(true);
        setMapState(prev => ({
          ...prev,
          center: location,
          isochrone: null,
          pois: [],
          selectedPOI: null,
          error: null,
          isLoading: false,
        }));

        // Add a message to chat about the location change
        const locationMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `📍 Location updated to: ${location.display_name}`,
          timestamp: new Date().toISOString(),
        };
        setMessages(prev => [...prev, locationMessage]);
      } else {
        throw new Error(data.error || 'Address not found');
      }
    } catch (error) {
      console.error('Address search error:', error);
      setMapState(prev => ({
        ...prev,
        error: `Address search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        isLoading: false,
      }));
    }
  }, []);

  // Handle address suggestion selection
  const handleAddressSuggestionSelect = useCallback((location: Location) => {
    setAddressInput(location.display_name);
    setShowSuggestions(false);
    setAddressSuggestions([]);
    handleAddressSearch(location.display_name);
  }, [handleAddressSearch]);

  // Handle address input key press
  const handleAddressKeyPress = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const input = e.target as HTMLInputElement;
      if (input.value.trim()) {
        handleAddressSearch(input.value.trim());
        setShowSuggestions(false);
        setAddressSuggestions([]);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setAddressSuggestions([]);
    }
  }, [handleAddressSearch]);

  // ============================================================================
  // QUERY PROCESSING FLOW
  // ============================================================================

  // Load more POIs function
  const loadMorePOIs = useCallback(async () => {
    if (!hasMorePOIs || isLoadingMorePOIs || !mapState.isochrone) return;

    setIsLoadingMorePOIs(true);
    const nextPage = poiPage + 1;

    try {
      // Get current parsed query from last message
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage?.metadata?.parsedQuery) return;

      const { parsedQuery } = lastMessage.metadata;
      const newPOIs = await fetchPOIs(
        parsedQuery.location,
        parsedQuery.poiType,
        mapState.isochrone,
        nextPage,
        poiPageSize,
        parsedQuery.keywords,
        parsedQuery.cuisine,
        parsedQuery.priceRange
      );

      if (newPOIs && newPOIs.length > 0) {
        setMapState(prev => ({
          ...prev,
          pois: [...prev.pois, ...newPOIs],
        }));

        setPoiPage(nextPage);
        setHasMorePOIs(newPOIs.length === poiPageSize);

        // Add loading message
        const loadingMessage: ChatMessage = {
          role: 'assistant',
          content: `Loaded ${newPOIs.length} more ${parsedQuery.poiType}s. Total: ${mapState.pois.length + newPOIs.length} places found.`,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
        };
        setMessages(prev => [...prev, loadingMessage]);
      } else {
        setHasMorePOIs(false);
      }
    } catch (error) {
      console.error('Error loading more POIs:', error);
      handleError(createError(ErrorType.API, 'Failed to load more places'), 'pois');
    } finally {
      setIsLoadingMorePOIs(false);
    }
  }, [hasMorePOIs, isLoadingMorePOIs, mapState.isochrone, poiPage, poiPageSize, messages, fetchPOIs, mapState.pois.length, handleError]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handleSendMessage = useCallback((message: string) => {
    processQuery(message);
  }, [processQuery]);

  const handleLocationSelect = useCallback((location: Location) => {
    // Update query location when user clicks on map
    setQueryLocation(location);
    setShowLocationMarker(true);
    
    setMapState(prev => ({
      ...prev,
      center: location,
      isochrone: null,
      pois: [],
      selectedPOI: null,
      error: null,
    }));
  }, []);

  const handlePOISelect = useCallback((poi: POI | null) => {
    setMapState(prev => ({ ...prev, selectedPOI: poi }));
  }, []);

  const handleMapMove = useCallback((center: Location, zoom: number) => {
    setMapState(prev => {
      // Only update if the center or zoom has actually changed
      const centerChanged = Math.abs(prev.center.lat - center.lat) > 0.0001 || 
                           Math.abs(prev.center.lng - center.lng) > 0.0001;
      const zoomChanged = prev.zoom !== zoom;
      
      if (centerChanged || zoomChanged) {
        return { ...prev, center, zoom };
      }
      return prev; // No change, return same state
    });
  }, []);

  const handleGetCurrentLocation = useCallback(async () => {
    const location = await getCurrentLocation();
    if (location) {
      // Update query location when user clicks on map
      setQueryLocation(location);
      setShowLocationMarker(true);
      
      setMapState(prev => ({
        ...prev,
        center: location,
        isochrone: null,
        pois: [],
        selectedPOI: null,
        error: null,
      }));
    }
  }, [getCurrentLocation]);

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  useEffect(() => {
    // Try to get current location on mount
    getCurrentLocation().then((location) => {
      if (location) {
        setMapState(prev => ({ ...prev, center: location }));
      }
    });

    const watchIdSnapshot = geolocationWatchId.current;
    // Cleanup geolocation watch on unmount
    return () => {
      if (watchIdSnapshot !== null) {
        navigator.geolocation.clearWatch(watchIdSnapshot);
      }
    };
  }, [getCurrentLocation]);

  // ============================================================================
  // RENDER
  // ============================================================================

  const hasError = Object.values(errorStates).some(Boolean);
  const hasNetworkError = errorStates.network !== null;
  const hasOllamaError = errorStates.ollama !== null;
  const hasLocationError = errorStates.geolocation !== null;

  return (
    <div className="h-screen flex flex-col bg-gray-900 overflow-hidden">
      {/* Header */}
      <header className="flex-shrink-0 bg-gray-800 border-b border-gray-700 px-3 py-2 sm:px-4 sm:py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2 min-w-0 flex-1">
            <MapPin className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <h1 className="text-lg sm:text-xl font-bold text-white truncate">ChatMap</h1>
              <span className="text-xs sm:text-sm text-gray-300 hidden sm:inline">Find places near you</span>
            </div>
          </div>
          
          {/* Address Search Bar */}
          <div className="hidden lg:flex flex-1 max-w-md mx-4">
            <div className="relative w-full">
              <input
                type="text"
                value={addressInput}
                onChange={handleAddressInputChange}
                onKeyPress={handleAddressKeyPress}
                onFocus={() => {
                  if (addressSuggestions.length > 0) {
                    setShowSuggestions(true);
                  }
                }}
                onBlur={() => {
                  // Delay hiding suggestions to allow clicking on them
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                placeholder="Search for an address..."
                className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
              />
              <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                {isLoadingSuggestions ? (
                  <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
                ) : (
                  <MapPin className="w-4 h-4 text-gray-400" />
                )}
              </div>

              {/* Address Suggestions Dropdown */}
              {showSuggestions && addressSuggestions.length > 0 && (
                <div className="absolute top-full left-0 right-0 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto mt-1">
                  {addressSuggestions.map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleAddressSuggestionSelect(suggestion)}
                      className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-b-0"
                    >
                      <div className="flex items-center space-x-3">
                        <MapPin className="w-4 h-4 text-blue-400 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">
                            {suggestion.display_name}
                          </p>
                          <p className="text-gray-400 text-xs">
                            {suggestion.lat.toFixed(4)}, {suggestion.lng.toFixed(4)}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-1 sm:space-x-2 flex-shrink-0">
            {/* Network Status - Hidden on mobile to save space */}
            {!isOnline ? (
              <div className="hidden sm:flex items-center space-x-1 text-red-600">
                <WifiOff className="w-4 h-4" />
                <span className="text-xs">Offline</span>
              </div>
            ) : (
              <div className="hidden sm:flex items-center space-x-1 text-green-600">
                <Wifi className="w-4 h-4" />
                <span className="text-xs">Online</span>
              </div>
            )}

            <div className="hidden sm:flex items-center space-x-1">
              {memoryEnabled ? (
                <>
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span className="text-xs text-blue-200">Memory on</span>
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 text-gray-400" />
                  <span className="text-xs text-gray-400">Memory off</span>
                </>
              )}
            </div>

            {/* Location Status - Icon only on mobile */}
            {hasLocationError ? (
              <div className="flex items-center space-x-1 text-red-600">
                <MapPinOff className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">Location denied</span>
              </div>
            ) : isGeolocationEnabled ? (
              <div className="flex items-center space-x-1 text-green-600">
                <MapPin className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">Location enabled</span>
              </div>
            ) : null}

            {/* Ollama Status - Icon only on mobile */}
            {hasOllamaError && (
              <div className="flex items-center space-x-1 text-red-600">
                <Bot className="w-4 h-4" />
                <span className="hidden sm:inline text-xs">AI unavailable</span>
              </div>
            )}
            
            <button
              onClick={handleGetCurrentLocation}
              disabled={loadingStates.geolocation || !isOnline}
              className="flex items-center space-x-1 px-2 py-1.5 sm:px-3 sm:py-1 text-xs sm:text-sm bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] touch-manipulation"
            >
              {loadingStates.geolocation ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <RefreshCw className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Get Location</span>
            </button>
            
            {/* Reset to current location button */}
            {userLocation && queryLocation && (queryLocation.lat !== userLocation.lat || queryLocation.lng !== userLocation.lng) && (
              <button
                onClick={() => {
                  setQueryLocation(userLocation);
                  setMapState(prev => ({ ...prev, center: userLocation }));
                }}
                className="flex items-center space-x-1 px-2 py-1.5 sm:px-3 sm:py-1 text-xs sm:text-sm bg-green-600 text-white rounded-full hover:bg-green-700 min-h-[44px] touch-manipulation"
                title="Reset to current location"
              >
                <MapPin className="w-4 h-4" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Map Section */}
        <div className="flex-1 min-h-0 order-1 lg:order-1">
          <MapComponent
            mapState={mapState}
            onLocationSelect={handleLocationSelect}
            onPOISelect={handlePOISelect}
            onMapMove={handleMapMove}
            className="h-full w-full"
            queryLocation={queryLocation}
            showLocationMarker={showLocationMarker}
            frequentLocations={memoryContext?.frequentLocations ?? []}
            preferredPOITypes={userPreferences.favoritePOITypes ?? []}
          />
        </div>

        {/* Chat Section */}
        <div className="flex-1 lg:w-80 min-h-0 flex flex-col order-2 lg:order-2 border-l border-gray-700 lg:max-h-screen">
          <div className="hidden lg:block border-b border-gray-700 bg-gray-900/60 p-4">
            <ConversationContext
              memoryContext={memoryEnabled ? memoryContext : null}
              isLoading={memoryInsightsLoading && memoryEnabled}
              suggestions={memoryEnabled ? personalizedSuggestions : []}
              onSuggestionSelect={handleSendMessage}
              memoryEnabled={memoryEnabled}
              onToggleMemory={handleMemoryToggle}
              onClearMemories={handleClearMemories}
              isClearing={isClearingMemory}
            />
          </div>
          <MemoizedChat
            messages={messages}
            onSendMessage={handleSendMessage}
            isLoading={isProcessing}
            className="h-full w-full"
            queryLocation={queryLocation}
            userLocation={userLocation}
            inputRef={chatInputRef}
            suggestions={memoryEnabled ? personalizedSuggestions : []}
            onSuggestionSelect={handleSendMessage}
            memoryContext={memoryEnabled ? memoryContext : null}
            memoryEnabled={memoryEnabled}
            onToggleMemory={handleMemoryToggle}
            isMemoryHydrated={isMemoryHydrated}
          />
          
          {/* Load More POIs Button */}
          {hasMorePOIs && (
            <div className="flex-shrink-0 p-4 border-t border-gray-200">
              <button
                onClick={loadMorePOIs}
                disabled={isLoadingMorePOIs}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
              >
                {isLoadingMorePOIs ? (
                  <div className="flex items-center justify-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading more places...</span>
                  </div>
                ) : (
                  'Load More Places'
                )}
              </button>
            </div>
          )}
        </div>
      </div>

        {/* Bottom Input Bar (Mobile) */}
      <div className="lg:hidden flex-shrink-0 bg-gray-800/95 backdrop-blur-sm border-t border-gray-700 p-4 safe-area-pb shadow-lg">
        {/* Mobile Address Search */}
        <div className="mb-3">
          <div className="relative">
            <input
              type="text"
              value={addressInput}
              onChange={handleAddressInputChange}
              onKeyPress={handleAddressKeyPress}
              onFocus={() => {
                if (addressSuggestions.length > 0) {
                  setShowSuggestions(true);
                }
              }}
              onBlur={() => {
                // Delay hiding suggestions to allow clicking on them
                setTimeout(() => setShowSuggestions(false), 200);
              }}
              placeholder="Search for an address..."
              className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
            />
            <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
              {isLoadingSuggestions ? (
                <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
              ) : (
                <MapPin className="w-4 h-4 text-gray-400" />
              )}
            </div>

            {/* Mobile Address Suggestions Dropdown */}
            {showSuggestions && addressSuggestions.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-lg max-h-60 overflow-y-auto mt-1">
                {addressSuggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={() => handleAddressSuggestionSelect(suggestion)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-700 transition-colors border-b border-gray-700 last:border-b-0"
                  >
                    <div className="flex items-center space-x-3">
                      <MapPin className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-white text-sm font-medium truncate">
                          {suggestion.display_name}
                        </p>
                        <p className="text-gray-400 text-xs">
                          {suggestion.lat.toFixed(4)}, {suggestion.lng.toFixed(4)}
                        </p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        
        <MemoizedQueryInput
          onSendQuery={handleSendMessage}
          isLoading={isProcessing}
          disabled={isProcessing}
          placeholder="Ask me to find places near you..."
          className="w-full"
          showExamples={true}
          error={errorStates.responding || errorStates.parsing || errorStates.network}
          isOnline={isOnline}
          inputRef={mobileInputRef}
          personalizedSuggestions={memoryEnabled ? personalizedSuggestions : []}
          onSuggestionSelect={handleSendMessage}
        />
      </div>

      {/* Error Overlay */}
      {hasError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md mx-4">
            <div className="flex items-center space-x-2 mb-4">
              <AlertCircle className="w-6 h-6 text-red-600" />
              <h3 className="text-lg font-semibold text-gray-900">Error</h3>
            </div>
            
            {/* Primary Error Message */}
            <div className="mb-4">
              {hasNetworkError && (
                <div className="flex items-start space-x-2 p-3 bg-red-50 rounded-lg">
                  <WifiOff className="w-5 h-5 text-red-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">Network Connection Lost</p>
                    <p className="text-sm text-red-600">Please check your internet connection and try again.</p>
                  </div>
                </div>
              )}
              
              {hasOllamaError && (
                <div className="flex items-start space-x-2 p-3 bg-yellow-50 rounded-lg">
                  <Bot className="w-5 h-5 text-yellow-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-yellow-800">AI Service Unavailable</p>
                    <p className="text-sm text-yellow-600">Ollama is not running. Please start Ollama on localhost:11434.</p>
                  </div>
                </div>
              )}
              
              {hasLocationError && (
                <div className="flex items-start space-x-2 p-3 bg-blue-50 rounded-lg">
                  <MapPinOff className="w-5 h-5 text-blue-600 mt-0.5" />
                  <div>
                    <p className="font-medium text-blue-800">Location Access Denied</p>
                    <p className="text-sm text-blue-600">Please enable location access in your browser settings.</p>
                  </div>
                </div>
              )}
            </div>

            {/* Error Recovery Options */}
            {errorRecovery && (
              <div className="mb-4 p-3 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-700 mb-2">{errorRecovery.description}</p>
                <div className="flex space-x-2">
                  {errorRecovery.canRetry && (
                    <button
                      onClick={() => {
                        clearAllErrors();
                        if (currentQuery) {
                          processQuery(currentQuery);
                        }
                      }}
                      className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      {errorRecovery.action}
                    </button>
                  )}
                  <button
                    onClick={clearAllErrors}
                    className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* All Errors List */}
            <div className="space-y-2 mb-4">
              {Object.entries(errorStates).map(([key, error]) => 
                error && (
                  <div key={key} className="flex items-center space-x-2 text-sm">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <span className="text-gray-600 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}:</span>
                    <span className="text-red-600">{error}</span>
                  </div>
                )
              )}
            </div>

            <div className="flex space-x-2">
              <button
                onClick={clearAllErrors}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
              >
                Dismiss All
              </button>
              {errorRecovery?.canRetry && (
                <button
                  onClick={() => {
                    clearAllErrors();
                    if (currentQuery) {
                      processQuery(currentQuery);
                    }
                  }}
                  className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
