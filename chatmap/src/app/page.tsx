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
  RouteInfo,
} from '@/src/lib/types';
import Chat from '@/src/components/Chat';
import QueryInput from '@/src/components/QueryInput';
import { MapPin, AlertCircle, Loader2, RefreshCw, Wifi, WifiOff, MapPinOff, Bot, Shield, Sparkles, ArrowUpRight } from 'lucide-react';
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
  directions: boolean;
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
  directions: string | null;
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
    center: { lat: 29.7604, lng: -95.3698, display_name: 'Houston, TX' },
    zoom: 13,
    isochrone: null,
    pois: [],
    selectedPOI: null,
    isLoading: false,
    error: null,
    routes: [],
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
    directions: false,
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
    directions: null,
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
      directions: null,
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
  // MULTI-STEP QUERY HANDLER (Agent Orchestrator)
  // ============================================================================

  const handleMultiStepQuery = useCallback(
    async (
      query: string,
      location: Location,
      parsedQuery: ParsedQuery,
      conversationHistory: ChatMessage[]
    ) => {
      try {
        console.log('[Agent] Processing multi-step query:', { query, parsedQuery });

        // Call the agent orchestrator
        // Note: callAPI returns the inner 'data' field, so we get the orchestrator response directly
        const response = await callAPI<{
          success: boolean;
          result?: {
            success: boolean;
            data?: {
              primaryPOIs?: POI[];
              anchorPOI?: POI;
              pois?: POI[];
              nearest?: POI;
              alternatives?: POI[];
              strategy?: {
                transport: TransportMode;
                timeMinutes: number;
              };
            };
            explanation?: string;
          };
          agentUsed?: string;
          classification?: {
            intent: string;
            complexity: string;
          };
        }>(
          '/api/agent',
          {
            method: 'POST',
            body: JSON.stringify({
              query,
              userId: userId || 'anonymous',
              userLocation: location,
              conversationHistory: {
                messages: conversationHistory.slice(-3).map(msg => ({
                  role: msg.role,
                  content: msg.content,
                })),
              },
              memoryEnabled,
            }),
          },
          'parsing',
          'parsing'
        );

        console.log('[Agent] Raw response:', JSON.stringify(response, null, 2));

        if (!response || !response.success) {
          console.error('[Agent] Response failed:', response);
          throw new Error(`Agent orchestrator failed: ${JSON.stringify(response)}`);
        }

        console.log('[Agent] Full response:', JSON.stringify(response, null, 2));

        // Extract POIs from agent response
        // callAPI already unwraps the data field, so response is the orchestrator result
        const resultData = response.result?.data;
        let pois: POI[] = [];
        let anchorPOI: POI | undefined;
        let isMultiStep = false;

        // Multi-step queries return primaryPOIs + anchorPOI
        if (resultData?.primaryPOIs) {
          isMultiStep = true;
          pois = resultData.primaryPOIs;
          anchorPOI = resultData.anchorPOI;
          
          // Add the anchor POI (e.g., the Starbucks) to the map too
          if (anchorPOI) {
            pois = [anchorPOI, ...pois];
          }
          
          // Update parsedQuery with actual strategy used by the agent
          if (resultData.strategy) {
            parsedQuery.transport = resultData.strategy.transport;
            parsedQuery.timeMinutes = resultData.strategy.timeMinutes;
          }
        } 
        // Enroute queries return stopoverPOI and candidatePOIs
        else if ((resultData as any)?.stopoverPOI || (resultData as any)?.candidatePOIs) {
          isMultiStep = true;
          pois = [];
          
          // Add stopover POI if available
          if ((resultData as any).stopoverPOI) {
            pois.push((resultData as any).stopoverPOI);
          }
          
          // Add candidate POIs if available
          if ((resultData as any).candidatePOIs && Array.isArray((resultData as any).candidatePOIs)) {
            pois = [...pois, ...(resultData as any).candidatePOIs];
          }
        } 
        // Simple queries might return pois, nearest, or single poi
        else if (resultData?.pois) {
          pois = resultData.pois;
        } else if (resultData?.nearest) {
          pois = [resultData.nearest, ...(resultData.alternatives || [])];
        }

        console.log('[Agent] Extracted POIs:', pois.length, pois);
        console.log('[Agent] Is multi-step:', isMultiStep, 'Anchor:', anchorPOI?.name);

        // Update map with results
        const result = response.result as any; // Type assertion for enroute properties
        const mapResultData = result?.data || result; // Try result.data first, fallback to result
        
        console.log('[Map] mapResultData structure:', {
          hasOptimizedRoute: !!mapResultData?.optimizedRoute,
          hasDirectRoute: !!mapResultData?.directRoute,
          hasStopoverPOI: !!mapResultData?.stopoverPOI,
          hasDestination: !!mapResultData?.destination,
          keys: Object.keys(mapResultData || {}),
          fullData: mapResultData
        });
        
        if (pois.length > 0 || mapResultData?.optimizedRoute || mapResultData?.directRoute) {
          // Handle enroute queries with optimized routes
          if (mapResultData?.optimizedRoute || mapResultData?.directRoute) {
            const { optimizedRoute, directRoute, stopoverPOI, candidatePOIs, destination, strategy } = mapResultData;
            
            // Update parsedQuery with actual strategy used by the agent
            if (strategy) {
              console.log('[Map] Updating parsedQuery with strategy:', strategy);
              parsedQuery.transport = strategy.transport;
              parsedQuery.timeMinutes = strategy.timeMinutes;
            } else {
              console.log('[Map] No strategy found in mapResultData, setting default transport to driving for enroute query');
              // For enroute queries, default to driving since walking doesn't make sense for long distances
              parsedQuery.transport = 'driving';
              parsedQuery.timeMinutes = 45; // Use the time constraint from the query
            }
            
            // Use optimized route if available, otherwise direct route
            const routeToDisplay = optimizedRoute || directRoute;
            const routePOIs = stopoverPOI ? [stopoverPOI, ...(candidatePOIs || [])] : (candidatePOIs || []);
            
            // Add destination as a POI if available
            if (destination) {
              const destinationPOI: POI = {
                id: 'destination',
                name: destination.display_name || 'Destination',
                type: 'other',
                lat: destination.lat,
                lng: destination.lng,
                tags: {
                  destination: true,
                  display_name: destination.display_name
                }
              };
              routePOIs.push(destinationPOI);
            }
            
            // Use locationForQuery instead of userLocation for enroute queries
            // Avoid using (0,0) coordinates which are invalid
            // For enroute queries, try to get user location from the agent response first
            let locationForEnroute = userLocation || queryLocation || mapState.center;
            
            // Try to extract user location from the agent response optimized route
            const agentResultData = resultData as any; // Type assertion for enroute properties
            if (agentResultData?.optimizedRoute?.steps?.[0]?.location) {
              const startLocation = agentResultData.optimizedRoute.steps[0].location;
              locationForEnroute = {
                lat: startLocation[1], // [lng, lat] format from ORS
                lng: startLocation[0],
                display_name: 'Current Location'
              };
              console.log('[Map] Using user location from optimized route start:', locationForEnroute);
            } else {
              console.log('[Map] Using fallback location for enroute query:', locationForEnroute);
            }
            
            // If coordinates are (0,0) or invalid, use a default Houston location
            console.log('[Map] Coordinate validation check:', {
              hasLocation: !!locationForEnroute,
              lat: locationForEnroute?.lat,
              lng: locationForEnroute?.lng,
              latType: typeof locationForEnroute?.lat,
              lngType: typeof locationForEnroute?.lng,
              isLatZero: locationForEnroute?.lat === 0,
              isLngZero: locationForEnroute?.lng === 0,
              isLatNaN: isNaN(locationForEnroute?.lat),
              isLngNaN: isNaN(locationForEnroute?.lng),
              latInRange: locationForEnroute?.lat >= -90 && locationForEnroute?.lat <= 90,
              lngInRange: locationForEnroute?.lng >= -180 && locationForEnroute?.lng <= 180,
              // Check each condition individually
              condition1: !locationForEnroute,
              condition2: (locationForEnroute?.lat === 0 && locationForEnroute?.lng === 0),
              condition3: isNaN(locationForEnroute?.lat),
              condition4: isNaN(locationForEnroute?.lng),
              condition5: locationForEnroute?.lat < -90,
              condition6: locationForEnroute?.lat > 90,
              condition7: locationForEnroute?.lng < -180,
              condition8: locationForEnroute?.lng > 180
            });
            
            if (!locationForEnroute || 
                (locationForEnroute.lat === 0 && locationForEnroute.lng === 0) ||
                isNaN(locationForEnroute.lat) || 
                isNaN(locationForEnroute.lng) ||
                locationForEnroute.lat < -90 || locationForEnroute.lat > 90 ||
                locationForEnroute.lng < -180 || locationForEnroute.lng > 180) {
              console.warn('[Map] Invalid coordinates detected, using default Houston location');
              locationForEnroute = {
                lat: 29.7604,
                lng: -95.3698,
                display_name: 'Houston, TX (Default)'
              };
            }
            
            console.log('[Map] Location for enroute:', {
              userLocation,
              queryLocation,
              mapStateCenter: mapState.center,
              locationForEnroute,
              isValidLocation: locationForEnroute && locationForEnroute.lat && locationForEnroute.lng
            });
            
            console.log('[Map] Route display check:', {
              hasRouteToDisplay: !!routeToDisplay,
              hasUserLocation: !!userLocation,
              hasLocationForEnroute: !!locationForEnroute,
              hasStopoverPOI: !!stopoverPOI,
              hasDestination: !!destination,
              routeToDisplay: routeToDisplay,
              userLocation: userLocation,
              locationForEnroute: locationForEnroute,
              stopoverPOI: stopoverPOI,
              destination: destination
            });
            
            if (routeToDisplay && locationForEnroute && stopoverPOI && destination) {
              console.log('[Map] Creating segmented routes for enroute query');
              
              // Create segmented routes for enroute queries
              const routes: RouteInfo[] = [];
              
              // Route 1: Current location to coffee stop
              if (stopoverPOI) {
                const stopoverLocation: Location = {
                  lat: stopoverPOI.lat,
                  lng: stopoverPOI.lng,
                  display_name: stopoverPOI.name
                };
                
                try {
                  console.log('[Map] Calculating route to stopover:', {
                    from: locationForEnroute,
                    to: stopoverLocation,
                    transport: parsedQuery.transport || 'driving',
                    fromCoords: `${locationForEnroute.lat}, ${locationForEnroute.lng}`,
                    toCoords: `${stopoverLocation.lat}, ${stopoverLocation.lng}`,
                    isValidFrom: !isNaN(locationForEnroute.lat) && !isNaN(locationForEnroute.lng),
                    isValidTo: !isNaN(stopoverLocation.lat) && !isNaN(stopoverLocation.lng)
                  });
                  const routeToStop = await calculateRoute(locationForEnroute, stopoverLocation, parsedQuery.transport || 'driving');
                  if (routeToStop) {
                    routes.push({
                      ...routeToStop,
                      transport: parsedQuery.transport || 'driving'
                    });
                    console.log('[Map] Added route to coffee stop:', routeToStop.coordinates.length, 'coordinates');
                  } else {
                    console.warn('[Map] No route returned for current location to coffee stop');
                  }
                } catch (error) {
                  console.error('[Map] Failed to calculate route to coffee stop:', error);
                  // Create a simple straight-line route as fallback
                  const fallbackRoute: RouteInfo = {
                    coordinates: [
                      [locationForEnroute.lat, locationForEnroute.lng],
                      [stopoverLocation.lat, stopoverLocation.lng]
                    ],
                    distance: 0, // Will be calculated
                    duration: 0, // Will be calculated
                    transport: parsedQuery.transport || 'driving'
                  };
                  routes.push(fallbackRoute);
                  console.log('[Map] Added fallback route to coffee stop');
                }
              }
              
              // Route 2: Coffee stop to destination
              if (stopoverPOI && destination) {
                const stopoverLocation: Location = {
                  lat: stopoverPOI.lat,
                  lng: stopoverPOI.lng,
                  display_name: stopoverPOI.name
                };
                
                const destinationLocation: Location = {
                  lat: destination.lat,
                  lng: destination.lng,
                  display_name: destination.display_name || 'Destination'
                };
                
                try {
                  console.log('[Map] Calculating route from stopover to destination:', {
                    from: stopoverLocation,
                    to: destinationLocation,
                    transport: parsedQuery.transport || 'driving',
                    fromCoords: `${stopoverLocation.lat}, ${stopoverLocation.lng}`,
                    toCoords: `${destinationLocation.lat}, ${destinationLocation.lng}`,
                    isValidFrom: !isNaN(stopoverLocation.lat) && !isNaN(stopoverLocation.lng),
                    isValidTo: !isNaN(destinationLocation.lat) && !isNaN(destinationLocation.lng)
                  });
                  const routeToDestination = await calculateRoute(stopoverLocation, destinationLocation, parsedQuery.transport || 'driving');
                  if (routeToDestination) {
                    routes.push({
                      ...routeToDestination,
                      transport: parsedQuery.transport || 'driving'
                    });
                    console.log('[Map] Added route from coffee stop to destination:', routeToDestination.coordinates.length, 'coordinates');
                  } else {
                    console.warn('[Map] No route returned for coffee stop to destination');
                  }
                } catch (error) {
                  console.error('[Map] Failed to calculate route to destination:', error);
                  // Create a simple straight-line route as fallback
                  const fallbackRoute: RouteInfo = {
                    coordinates: [
                      [stopoverLocation.lat, stopoverLocation.lng],
                      [destinationLocation.lat, destinationLocation.lng]
                    ],
                    distance: 0, // Will be calculated
                    duration: 0, // Will be calculated
                    transport: parsedQuery.transport || 'driving'
                  };
                  routes.push(fallbackRoute);
                  console.log('[Map] Added fallback route to destination');
                }
              }
              
              // Center map on the route - use stopover as center if available, otherwise use destination
              // Calculate center point between user location, stopover, and destination
              const routeCenter: Location = {
                lat: (locationForEnroute.lat + stopoverPOI.lat + destination.lat) / 3,
                lng: (locationForEnroute.lng + stopoverPOI.lng + destination.lng) / 3,
                display_name: 'Route Center'
              };
              
              console.log('[Map] Setting map state with segmented routes:', {
                center: routeCenter,
                pois: routePOIs.length,
                routes: routes.length,
                routeDetails: routes.map((r, i) => ({
                  segment: i + 1,
                  coordinates: r.coordinates.length,
                  distance: r.distance,
                  duration: r.duration
                }))
              });
              
              // Create isochrone around the stopover POI
              const isochroneData: IsochroneData | null = stopoverPOI ? {
                type: 'FeatureCollection',
                features: [],
                properties: {
                  transportMode: parsedQuery.transport || 'driving',
                  timeMinutes: 15,
                  center: {
                    lat: stopoverPOI.lat,
                    lng: stopoverPOI.lng,
                    display_name: stopoverPOI.name
                  },
                  generatedAt: new Date().toISOString()
                }
              } : null;

              setMapState(prev => ({
                ...prev,
                center: routeCenter,
                zoom: 12, // Zoom out to show full route
                pois: routePOIs,
                routes: routes,
                isochrone: isochroneData,
                selectedPOI: routePOIs[0] || null,
              }));
            }
          }
          // For multi-step queries, center map on anchor POI and generate isochrone
          else if (isMultiStep && anchorPOI) {
            const anchorLocation: Location = {
              lat: anchorPOI.lat,
              lng: anchorPOI.lng,
              display_name: anchorPOI.name
            };

            // Generate isochrone around anchor POI to show search area
            try {
              const isochroneData = await callAPI<IsochroneData>(
                '/api/isochrone',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    location: anchorLocation, // Use anchor location for isochrone
                    timeMinutes: parsedQuery.timeMinutes || 15,
                    transport: parsedQuery.transport,
                  }),
                },
                'isochrone',
                'isochrone'
              );

              if (isochroneData) {
                // Calculate routes from anchor POI to secondary POIs to show connections
                const routes: RouteInfo[] = [];
                  const secondaryPOIs = pois.filter(poi => poi.id !== anchorPOI.id);
                
                // Routes from anchor to secondary POIs (show connections)
                for (const poi of secondaryPOIs.slice(0, 3)) { // Limit to first 3 for performance
                    const poiLocation: Location = {
                      lat: poi.lat,
                      lng: poi.lng,
                      display_name: poi.name
                    };
                  const poiRoute = await calculateRoute(anchorLocation, poiLocation, parsedQuery.transport);
                    if (poiRoute) {
                      routes.push(poiRoute);
                    }
                }
                
                // Also add route from user to anchor if user location available
                if (userLocation) {
                  const userToAnchorRoute = await calculateRoute(userLocation, anchorLocation, parsedQuery.transport);
                  if (userToAnchorRoute) {
                    routes.push(userToAnchorRoute);
                  }
                }

                setMapState(prev => ({
                  ...prev,
                  center: anchorLocation,
                  zoom: 13, // Slightly zoomed out to show more context
                  pois,
                  selectedPOI: anchorPOI, // Select the anchor first
                  isochrone: isochroneData,
                  routes,
                }));
              } else {
                // Fallback: just update POIs and center without isochrone
                setMapState(prev => ({
                  ...prev,
                  center: anchorLocation,
                  zoom: 13,
                  pois,
                  selectedPOI: anchorPOI,
                }));
              }
            } catch (error) {
              console.error('[Agent] Failed to generate isochrone for anchor:', error);
              // Fallback: just update POIs and center
              setMapState(prev => ({
                ...prev,
                center: anchorLocation,
                zoom: 13,
                pois,
                selectedPOI: anchorPOI,
              }));
            }
          } else {
            // Simple queries: center on the found POI and generate isochrone
            const primaryPOI = pois[0];
            const poiLocation: Location = {
              lat: primaryPOI.lat,
              lng: primaryPOI.lng,
              display_name: primaryPOI.name
            };

            try {
              const isochroneData = await callAPI<IsochroneData>(
                '/api/isochrone',
                {
                  method: 'POST',
                  body: JSON.stringify({
                    location: userLocation || poiLocation, // Use user location if available
                    timeMinutes: parsedQuery.timeMinutes || 15,
                    transport: parsedQuery.transport,
                  }),
                },
                'isochrone',
                'isochrone'
              );

              if (isochroneData) {
                // Calculate route from user location to primary POI
                const routes: RouteInfo[] = [];
                
                if (userLocation) {
                  const primaryRoute = await calculateRoute(userLocation, poiLocation, parsedQuery.transport);
                  if (primaryRoute) {
                    routes.push(primaryRoute);
                  }
                }

                setMapState(prev => ({
                  ...prev,
                  center: poiLocation,
                  zoom: 14,
                  pois,
                  selectedPOI: primaryPOI,
                  isochrone: isochroneData,
                  routes,
                }));
              } else {
                // Fallback: just update POIs and center without isochrone
                setMapState(prev => ({
                  ...prev,
                  center: poiLocation,
                  zoom: 14,
                  pois,
                  selectedPOI: primaryPOI,
                }));
              }
            } catch (error) {
              console.error('[Agent] Failed to generate isochrone for POI:', error);
              // Fallback: just update POIs and center
              setMapState(prev => ({
                ...prev,
                center: poiLocation,
                zoom: 14,
                pois,
                selectedPOI: primaryPOI,
              }));
            }
          }
        }

        // Store POIs in memory for follow-up queries
        if (memoryEnabled && pois.length > 0) {
          try {
            await callAPI(
              '/api/memory',
              {
                method: 'POST',
                body: JSON.stringify({
                  userId: userId || 'anonymous',
                  content: isMultiStep 
                    ? `Found ${pois.length - 1} ${parsedQuery.poiType}(s) near ${anchorPOI?.name}`
                    : `Found ${pois.length} ${parsedQuery.poiType}(s)`,
                  type: 'location',
                  metadata: {
                    query,
                    location,
                    poisFound: pois.map(poi => ({
                      id: poi.id,
                      name: poi.name,
                      type: poi.type,
                      lat: poi.lat,
                      lng: poi.lng,
                      tags: poi.tags,
                    })),
                    anchorPOI: anchorPOI ? {
                      id: anchorPOI.id,
                      name: anchorPOI.name,
                      type: anchorPOI.type,
                    } : undefined,
                    isMultiStep,
                    timestamp: new Date().toISOString(),
                    context: {
                      timeOfDay: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening',
                      dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
                    },
                  },
                }),
              },
              'responding',
              'responding'
            );
            console.log('[Memory] Stored', pois.length, 'agent POIs for follow-up queries');
          } catch (error) {
            console.error('[Memory] Failed to store agent POIs:', error);
            // Don't block the main flow if memory storage fails
          }
        }

        // Add agent response to chat with contextual details
        let explanation = response.result?.explanation;
        

        if (!explanation) {
          // Check if this is an enroute query result
          const result = response.result as any; // Type assertion for enroute properties
          const resultData = result?.data; // Get the actual data from the agent response
          if (resultData?.optimizedRoute || resultData?.directRoute) {
            const { optimizedRoute, directRoute, stopoverPOI, candidatePOIs, destination, message, strategy } = resultData;
            
            // Update parsedQuery with actual strategy used by the agent
            if (strategy) {
              parsedQuery.transport = strategy.transport;
              parsedQuery.timeMinutes = strategy.timeMinutes;
            }
            
            if (optimizedRoute && stopoverPOI) {
              // Enhanced conversational response for optimized route with stopover
              const totalTime = Math.round(optimizedRoute.duration / 60);
              
              // Calculate distance from route geometry if not provided
              let totalDistance = 'Unknown';
              if (optimizedRoute.distance) {
                totalDistance = (optimizedRoute.distance / 1000).toFixed(1);
              } else if (optimizedRoute.steps && Array.isArray(optimizedRoute.steps)) {
                // Calculate distance from optimization steps
                const coordinates = optimizedRoute.steps
                  .filter((step: any) => step.location && Array.isArray(step.location))
                  .map((step: any) => [step.location[1], step.location[0]]); // Convert [lng, lat] to [lat, lng]
                
                if (coordinates.length > 1) {
                  const calculatedDistance = calculateRouteDistance(coordinates);
                  totalDistance = (calculatedDistance / 1000).toFixed(1);
                }
              }
              const directTime = directRoute ? Math.round(directRoute.properties.segments[0].duration / 60) : 0;
              const timeAdded = totalTime - directTime;
              
              explanation = `☕ Perfect! I found you an optimized route with a great coffee stop!\n\n`;
              
              // Route overview
              explanation += `🚗 Your Route:\n`;
              explanation += `• Total Time: ${totalTime} minutes (${timeAdded > 0 ? `+${timeAdded} min` : 'same time'} vs direct route)\n`;
              explanation += `• Total Distance: ${totalDistance} km\n`;
              // For enroute queries, always use driving since walking doesn't make sense for long distances
              const transportMode = parsedQuery.transport === 'walking' ? 'driving' : (parsedQuery.transport || 'driving');
              explanation += `• Transport: ${transportMode}\n\n`;
              
              // Stopover details
              explanation += `☕ Coffee Stop:\n`;
              explanation += `• ${stopoverPOI.name}\n`;
              if (stopoverPOI.tags?.['addr:street']) {
                explanation += `• 📍 ${stopoverPOI.tags['addr:street']}`;
                if (stopoverPOI.tags?.['addr:housenumber']) {
                  explanation += ` ${stopoverPOI.tags['addr:housenumber']}`;
                }
                explanation += '\n';
              }
              if (stopoverPOI.tags?.website) {
                explanation += `• 🌐 [Website](${stopoverPOI.tags.website})\n`;
              }
              if (stopoverPOI.tags?.phone) {
                explanation += `• 📞 ${stopoverPOI.tags.phone}\n`;
              }
              if (stopoverPOI.tags?.opening_hours) {
                explanation += `• 🕒 ${stopoverPOI.tags.opening_hours}\n`;
              }
              explanation += `• ⏱️ Stop Duration: ~5 minutes (perfect for a quick coffee!)\n\n`;
              
              // Destination info
              if (destination) {
                explanation += `🎬 Your Destination:\n`;
                explanation += `• ${destination.display_name}\n`;
                explanation += `• ⏰ Arrival Time: ~${totalTime} minutes from now\n`;
                if (totalTime <= 45) {
                  explanation += `• ✅ Perfect timing! You'll arrive with ${45 - totalTime} minutes to spare before your movie!\n\n`;
                } else {
                  explanation += `• ⚠️ Note: You might be cutting it close - consider leaving a bit earlier!\n\n`;
                }
              }
              
              // Additional route info if available
              if (optimizedRoute.avgspeed && optimizedRoute.avgspeed > 0) {
                explanation += `📊 Route Stats:\n`;
                explanation += `• Average Speed: ${Math.round(optimizedRoute.avgspeed)} km/h\n`;
                if (optimizedRoute.ascent !== undefined && optimizedRoute.descent !== undefined) {
                  explanation += `• Elevation: +${Math.round(optimizedRoute.ascent)}m / -${Math.round(optimizedRoute.descent)}m\n`;
                }
                if (optimizedRoute.detourfactor && optimizedRoute.detourfactor > 1.1) {
                  const detourPercent = Math.round((optimizedRoute.detourfactor - 1) * 100);
                  explanation += `• Detour: ${detourPercent}% longer than direct route\n`;
                }
                explanation += '\n';
              }
              
              // Traffic and Road Conditions
              if (optimizedRoute.warnings && optimizedRoute.warnings.length > 0) {
                explanation += `🚦 Traffic & Road Conditions:\n`;
                
                // Separate traffic info from road conditions
                const trafficWarnings = optimizedRoute.warnings.filter((w: string) => 
                  w.includes('traffic') || w.includes('Heavy') || w.includes('Moderate') || w.includes('Light')
                );
                const roadWarnings = optimizedRoute.warnings.filter((w: string) => 
                  !w.includes('traffic') && !w.includes('Heavy') && !w.includes('Moderate') && !w.includes('Light')
                );
                
                // Show traffic info first
                if (trafficWarnings.length > 0) {
                  trafficWarnings.forEach((warning: string) => {
                    explanation += `• 🚗 ${warning}\n`;
                  });
                }
                
                // Show road conditions
                if (roadWarnings.length > 0) {
                  roadWarnings.slice(0, 3).forEach((warning: string) => {
                    if (warning.includes('Steep')) {
                      explanation += `• 🏔️ ${warning}\n`;
                    } else if (warning.includes('Toll')) {
                      explanation += `• 💰 ${warning}\n`;
                    } else if (warning.includes('Road surfaces') || warning.includes('Road types')) {
                      explanation += `• 🛣️ ${warning}\n`;
                    } else {
                      explanation += `• ⚠️ ${warning}\n`;
                    }
                  });
                  
                  // Show count if there are more warnings
                  if (roadWarnings.length > 3) {
                    explanation += `• ...and ${roadWarnings.length - 3} more conditions\n`;
                  }
                }
                
                explanation += '\n';
              }
              
              // Alternative options
              if (candidatePOIs && candidatePOIs.length > 1) {
                explanation += `🔄 Other Coffee Options Along Route:\n`;
                candidatePOIs.slice(1, 4).forEach((poi: any, index: number) => {
                  explanation += `${index + 1}. ${poi.name}`;
                  if (poi.tags?.cuisine) {
                    explanation += ` (${poi.tags.cuisine})`;
                  }
                  explanation += '\n';
                });
                explanation += '\n';
              }
              
              explanation += `🗺️ The map shows your optimized route with the coffee stop highlighted!\n`;
              explanation += `💡 Pro tip: Click on the coffee shop marker for more details, or ask for turn-by-turn directions!`;
              
            } else if (directRoute) {
              // Fallback for direct route only
              const totalTime = Math.round(directRoute.properties.segments[0].duration / 60);
              explanation = `🚗 **Direct Route to ${destination?.display_name || 'your destination'}:**\n\n`;
              explanation += `⏱️ **Travel Time:** ${totalTime} minutes\n`;
              explanation += `📏 **Distance:** ${(directRoute.properties.segments[0].distance / 1000).toFixed(1)} km\n\n`;
              explanation += `⚠️ **No suitable coffee stops found along this route.**\n`;
              explanation += `💡 **Suggestion:** Try a different route or check for cafes near your destination!`;
            }
            
          } else if (isMultiStep && anchorPOI) {
            // Multi-step query: Show anchor POI and nearby results
            const secondaryPOIs = pois.filter(poi => poi.id !== anchorPOI.id);
            const transport = parsedQuery.transport || 'walking';
            
            // Get the appropriate emoji and label for the anchor POI type
            const getPOIEmoji = (type: string) => {
              switch (type) {
                case 'hospital': return '🏥';
                case 'cafe': return '☕';
                case 'restaurant': return '🍽️';
                case 'pharmacy': return '💊';
                case 'gas_station': return '⛽';
                case 'bank': return '🏦';
                case 'atm': return '🏧';
                case 'grocery': return '🛒';
                case 'shopping': return '🛍️';
                default: return '📍';
              }
            };
            
            const getPOILabel = (type: string) => {
              switch (type) {
                case 'hospital': return 'hospital';
                case 'cafe': return 'coffee shop';
                case 'restaurant': return 'restaurant';
                case 'pharmacy': return 'pharmacy';
                case 'gas_station': return 'gas station';
                case 'bank': return 'bank';
                case 'atm': return 'ATM';
                case 'grocery': return 'grocery store';
                case 'shopping': return 'shopping center';
                default: return type;
              }
            };
            
            // Get the appropriate emoji and label for the secondary POI type
            const secondaryPOIType = parsedQuery.poiType || 'restaurant';
            const secondaryPOIEmoji = getPOIEmoji(secondaryPOIType);
            const secondaryPOILabel = getPOILabel(secondaryPOIType);
            
            // Add cuisine info if available
            const cuisineInfo = parsedQuery.cuisine ? ` ${parsedQuery.cuisine}` : '';
            
            explanation = `${getPOIEmoji(anchorPOI.type)} Found ${anchorPOI.name} as the nearest ${getPOILabel(anchorPOI.type)}\n\n`;
            explanation += `${secondaryPOIEmoji} Found ${secondaryPOIs.length}${cuisineInfo} ${secondaryPOILabel}s nearby:\n\n`;
            
            secondaryPOIs.slice(0, 5).forEach((poi, index) => {
              const distance = poi.distanceFromAnchor ? `${(poi.distanceFromAnchor / 1000).toFixed(2)} km` : 'Unknown distance';
              const travelTime = poi.travelTimeFromAnchor ? `${poi.travelTimeFromAnchor} min` : 'Unknown time';
              
              explanation += `${index + 1}. ${poi.name}\n`;
              explanation += `   📍 ${distance} from ${getPOILabel(anchorPOI.type)} (${travelTime} by ${transport})\n`;
              
              if (poi.tags?.cuisine) {
                explanation += `   🍝 Cuisine: ${poi.tags.cuisine}\n`;
              }
              if (poi.tags?.website) {
                explanation += `   🌐 [Website](${poi.tags.website})\n`;
              }
              if (poi.tags?.phone) {
                explanation += `   📞 ${poi.tags.phone}\n`;
              }
              explanation += '\n';
            });
            
            if (secondaryPOIs.length > 5) {
              explanation += `... and ${secondaryPOIs.length - 5} more ${secondaryPOILabel}s nearby.\n\n`;
            }
            
            explanation += `💡 Tip: Click on any ${secondaryPOILabel} marker on the map for more details, or ask for directions to a specific one!`;
            
          } else if (pois.length === 1) {
            // Single POI result
            const poi = pois[0];
            const distance = poi.distance ? `${(poi.distance / 1000).toFixed(2)} km away` : 'nearby';
            const transport = parsedQuery.transport || 'walking';

            explanation = `I found ${poi.name} - a ${poi.type} located ${distance} by ${transport}. `;

            // Add additional details if available
            if (poi.tags) {
              const details = [];
              if (poi.tags.website) details.push(`[Website](${poi.tags.website})`);
              if (poi.tags.phone) details.push(`📞 ${poi.tags.phone}`);
              if (poi.tags['addr:housenumber'] && poi.tags['addr:street']) {
                details.push(`📍 ${poi.tags['addr:housenumber']} ${poi.tags['addr:street']}`);
              }
              if (poi.tags.opening_hours) details.push(`🕒 ${poi.tags.opening_hours}`);
              if (poi.tags.wheelchair) details.push('♿ Wheelchair accessible');

              if (details.length > 0) {
                explanation += details.join(' • ');
              }
            }

            explanation += '\n\nWould you like directions or more details about this location?';
          } else {
            // Multiple POIs without anchor
            explanation = `Found ${pois.length} ${parsedQuery.poiType}(s) matching your request.`;
          }
        }

        const agentMessage: ChatMessage = {
          id: Date.now().toString(),
          role: 'assistant',
          content: explanation || 'I found some results for you.',
          timestamp: new Date().toISOString(),
        };

        setMessages(prev => [...prev, agentMessage]);
        setIsProcessing(false);
        setLoadingStates(prev => ({ ...prev, parsing: false, pois: false, responding: false }));

      } catch (error) {
        console.error('[Agent] Multi-step query failed:', error);
        throw createError(
          ErrorType.API,
          'Failed to process multi-step query. Please try rephrasing your request.'
        );
      }
    },
    [callAPI, userId, memoryEnabled, setMapState, setMessages, setIsProcessing, setLoadingStates]
  );

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

  const calculateRoute = useCallback(
    async (from: Location, to: Location, transport: TransportMode): Promise<RouteInfo | null> => {
      try {
        const response = await callAPI<{
          distance: number;
          duration: number;
          geometry: {
          coordinates: [number, number][];
            type: string;
          };
          steps: {
            instruction: string;
          distance: number;
          duration: number;
            type: number;
          }[];
          // Additional route attributes
          ascent?: number;
          descent?: number;
          avgspeed?: number;
          detourfactor?: number;
          warnings?: string[];
          extras?: any;
          bbox?: number[];
          way_points?: number[];
        }[]>(
          '/api/directions',
          {
            method: 'POST',
            body: JSON.stringify({
              start: from,
              end: to,
              transport,
            }),
          },
          'directions',
          'directions'
        );
        
        if (response && response.length > 0) {
          const route = response[0]; // Get the first (best) route
          // Convert coordinates from [lng, lat] to [lat, lng] for Leaflet
          const coordinates = route.geometry.coordinates.map((coord: [number, number]) => [coord[1], coord[0]] as [number, number]);
          return {
            coordinates: coordinates,
            distance: route.distance,
            duration: route.duration * 60, // Convert to seconds
            transport: transport,
            steps: route.steps?.map(step => ({
              instruction: step.instruction,
              distance: step.distance,
              duration: step.duration * 60, // Convert to seconds
              type: step.type,
            })),
            // Additional route attributes
            ascent: route.ascent,
            descent: route.descent,
            avgspeed: route.avgspeed,
            detourfactor: route.detourfactor,
            warnings: route.warnings,
            extras: route.extras,
            bbox: route.bbox,
            way_points: route.way_points,
          };
        }
        return null;
      } catch (error) {
        console.error('Route calculation failed:', error);
        return null;
      }
    },
    [callAPI]
  );

  const fetchPOIs = useCallback(
    async (
      location: Location,
      poiType: POIType,
      timeMinutes: number,
      transport: TransportMode,
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
            timeMinutes,
            transport,
            page,
            pageSize,
            cuisine,
          }),
        },
        'pois',
        'pois'
      );
    },
    [callAPI]
  );

  // Generate response
  const generateResponse = useCallback(async (query: ParsedQuery, pois: POI[] | null, isochroneData: IsochroneData | null, conversationHistory?: ChatMessage[]): Promise<RespondAPIResponse | null> => {
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

  // Extract POI query processing into a separate function
  const processPOIQuery = async (parsedQuery: ParsedQuery, locationForQuery: Location, messages: ChatMessage[]) => {
    try {
      console.log('[POI Query] Processing POI query:', parsedQuery);

      // Step 1: Fetch POIs based on search strategy
      let pois: POI[] | null = null;

      if (parsedQuery.searchStrategy === 'nearest_only') {
        // Find the single nearest POI
        const nearestResponse = await callAPI<{ 
          nearest: POI; 
          alternatives: POI[];
          strategy?: {
            transport: TransportMode;
            timeMinutes: number;
          };
        }>(
          '/api/poi/nearest',
          {
            method: 'POST',
            body: JSON.stringify({
              poiType: parsedQuery.poiType,
              userLocation: parsedQuery.location,
              transport: parsedQuery.transport,
              maxTimeMinutes: parsedQuery.timeMinutes,
              cuisine: parsedQuery.cuisine,
            }),
          },
          'pois',
          'pois'
        );
        
        if (nearestResponse) {
          // Combine nearest with alternatives
          pois = [nearestResponse.nearest, ...nearestResponse.alternatives];
          
          // Update parsed query with actual strategy used
          if (nearestResponse.strategy) {
            parsedQuery.transport = nearestResponse.strategy.transport;
            parsedQuery.timeMinutes = nearestResponse.strategy.timeMinutes;
          }
        }
      } else {
        // Find all POIs within time (default behavior)
        pois = await fetchPOIs(
          parsedQuery.location, 
          parsedQuery.poiType, 
          parsedQuery.timeMinutes,
          parsedQuery.transport,
          1, // page
          20, // pageSize
          parsedQuery.keywords,
          parsedQuery.cuisine
        );
      }

      if (!pois || pois.length === 0) {
        // Handle no results case
        const noResultsMessage: ChatMessage = {
          role: 'assistant',
          content: `I couldn't find any ${parsedQuery.poiType}s within ${parsedQuery.timeMinutes} minutes by ${parsedQuery.transport} from ${parsedQuery.location.display_name}. Try expanding your search area, adjusting the time limit, or searching for a different type of place.`,
          timestamp: new Date().toISOString(),
          id: Date.now().toString(),
          metadata: {
            queryType: 'poi_search',
            parsedQuery,
            processingTime: Date.now() - new Date().getTime(),
          },
        };
        setMessages(prev => [...prev, noResultsMessage]);
        return;
      }

      // Step 2: Calculate multi-modal durations for all POIs
      let finalPOIs = pois;
      try {
        const transportModes: TransportMode[] = ['walking', 'driving', 'cycling', 'public_transport'];
        console.log('[Duration API] Request data:', {
          pois: pois.map(poi => ({
            lat: poi.lat,
            lng: poi.lng,
            name: poi.name
          })),
          origin: parsedQuery.location,
          transportModes
        });

        const durationResponse = await fetch('/api/durations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pois: pois.map(poi => ({
              lat: poi.lat,
              lng: poi.lng,
              name: poi.name
            })),
            origin: parsedQuery.location,
            transportModes
          })
        });

        if (durationResponse.ok) {
          const durationData = await durationResponse.json();
          console.log('[Duration API] Response data:', durationData);
          if (durationData.success && durationData.data) {
            // Merge duration data back into POIs
            finalPOIs = pois.map(poi => {
              const durationInfo = durationData.data.find((d: any) => 
                d.name === poi.name && 
                Math.abs(d.lat - poi.lat) < 0.0001 && 
                Math.abs(d.lng - poi.lng) < 0.0001
              );
              return {
                ...poi,
                durations: durationInfo?.durations || {},
                distance: durationInfo?.durations?.[parsedQuery.transport] ? 
                  durationInfo.durations[parsedQuery.transport] * 1000 : poi.distance
              };
            });
          }
        }
      } catch (error) {
        console.error('Duration calculation failed:', error);
        // Continue with original POIs if duration calculation fails
      }

      console.log('Multi-modal durations calculated for POIs');

      // Step 3: Generate isochrone for visualization
      let isochroneData: IsochroneData | null = null;
      try {
        const isochroneResponse = await callAPI<IsochroneData>(
          '/api/isochrone',
          {
            method: 'POST',
            body: JSON.stringify({
              location: parsedQuery.location,
              timeMinutes: parsedQuery.timeMinutes,
              transport: parsedQuery.transport,
            }),
          },
          'isochrone',
          'isochrone'
        );
        isochroneData = isochroneResponse;
      } catch (error) {
        console.error('Isochrone generation failed:', error);
        // Continue without isochrone if it fails
      }

      // Step 4: Update map state
      setMapState(prev => ({
        ...prev,
        center: parsedQuery.location,
        zoom: 13,
        pois: finalPOIs,
        isochrone: isochroneData,
        routes: [],
        selectedPOI: null,
        error: null,
      }));

      // Step 5: Generate AI response
      const responsePayload = await generateResponse(parsedQuery, finalPOIs, isochroneData, messages);

      if (responsePayload?.memoryContext) {
        setMemoryContext(responsePayload.memoryContext);
        setUserPreferences(responsePayload.memoryContext.preferences ?? {});
        setPersonalizedSuggestions(responsePayload.personalizedSuggestions ?? []);
      }

      // Step 6: Add response to chat
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: responsePayload?.response || `Found ${finalPOIs.length} ${parsedQuery.poiType}s near you!`,
        timestamp: new Date().toISOString(),
        id: (Date.now() + 1).toString(),
        metadata: {
          queryType: 'poi_search',
          parsedQuery,
          pois: finalPOIs,
          processingTime: Date.now() - new Date().getTime(),
          memoryContextIds: responsePayload?.recordedMemoryIds
            ? (Object.values(responsePayload.recordedMemoryIds).filter(Boolean) as string[])
            : undefined,
        },
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      console.error('POI query processing error:', error);
      
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `I'm sorry, I couldn't process your request. Please try again.`,
        timestamp: new Date().toISOString(),
        id: (Date.now() + 1).toString(),
        metadata: {
          queryType: 'general',
          error: 'POI query processing failed',
        },
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  };

  // Helper function to calculate distance from coordinates
  const calculateRouteDistance = (coordinates: [number, number][]): number => {
    let totalDistance = 0;
    for (let i = 1; i < coordinates.length; i++) {
      const [lat1, lng1] = coordinates[i - 1];
      const [lat2, lng2] = coordinates[i];
      
      // Haversine formula for distance calculation
      const R = 6371e3; // Earth's radius in meters
      const φ1 = (lat1 * Math.PI) / 180;
      const φ2 = (lat2 * Math.PI) / 180;
      const Δφ = ((lat2 - lat1) * Math.PI) / 180;
      const Δλ = ((lng2 - lng1) * Math.PI) / 180;

      const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      
      totalDistance += R * c;
    }
    return totalDistance;
  };

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
        console.log('getCurrentLocation() returned:', currentLocation);
        if (currentLocation) {
          locationForQuery = currentLocation;
          setQueryLocation(currentLocation);
          setUserLocation(currentLocation); // Also set userLocation
          setShowLocationMarker(true);
          console.log('Set userLocation to:', currentLocation);
        } else {
          // If we can't get location, use a default location (Houston, TX)
          locationForQuery = {
            lat: 29.7604,
            lng: -95.3698,
            display_name: 'Houston, TX (Default)'
          };
          setUserLocation(locationForQuery); // Set as userLocation
          console.log('Using default location:', locationForQuery);
        }
      }
      
      // Step 1: Parse query to determine if it's multi-step
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

      // Check if this is a multi-step query using proper query classification
      // Use server-side API for classification to avoid client-side environment issues
      const conversationContext = {
        messages: messages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .map(msg => ({
            role: msg.role as 'user' | 'assistant',
            content: msg.content
          }))
      };
      
      const classificationResponse = await callAPI<{
        intent: string;
        complexity: 'simple' | 'multi-step';
        entities: any;
        requiresContext: boolean;
        confidence: number;
        reasoning: string;
      }>(
        '/api/classify',
        {
          method: 'POST',
          body: JSON.stringify({
            query,
            context: conversationContext
          }),
        },
        'parsing',
        'parsing'
      );
      
      if (!classificationResponse) {
        throw createError(ErrorType.API, 'Failed to classify query. Please try again.');
      }
      
      const classification = classificationResponse;
      const isMultiStepQuery = classification.complexity === 'multi-step';
      
      console.log('[Query Classification]', {
        query,
        intent: classification.intent,
        complexity: classification.complexity,
        entities: classification.entities,
        isMultiStepQuery
      });

      if (isMultiStepQuery) {
        console.log('[Multi-Step Query Detected] Routing to agent orchestrator');
        return await handleMultiStepQuery(query, locationForQuery, parsedQuery, messages);
      }

      // Step 2: Handle clarification queries (modify previous query parameters)
      if (classification.intent === 'clarification') {
        console.log('[Query] Handling clarification request');
        
        // Get the last POI search query from messages
        const lastPOIQuery = messages
          .slice()
          .reverse()
          .find(msg => msg.role === 'user' && 
            (msg.content.toLowerCase().includes('find') || 
             msg.content.toLowerCase().includes('show') || 
             msg.content.toLowerCase().includes('search')));
        
        if (lastPOIQuery) {
          console.log('[Clarification] Found previous POI query:', lastPOIQuery.content);
          
          // Re-parse the previous query with new parameters
          const previousQuery = lastPOIQuery.content;
          const previousParseResult = await parseQuery(previousQuery, locationForQuery);
          
          if (!previousParseResult) {
            console.log('[Clarification] Failed to parse previous query, falling back to regular processing');
            return;
          }
          
          // Update with new parameters from clarification
          const updatedParsedQuery = {
            ...previousParseResult.parsedQuery,
            location: locationForQuery, // Ensure location is set
            ...(classification.entities.transport && { transport: classification.entities.transport }),
            ...(classification.entities.timeConstraint && { timeMinutes: classification.entities.timeConstraint }),
            ...(classification.entities.poiType && { poiType: classification.entities.poiType }),
          };
          
          console.log('[Clarification] Updated query parameters:', updatedParsedQuery);
          
          // Process the updated query
          return await processPOIQuery(updatedParsedQuery, locationForQuery, messages);
        } else {
          console.log('[Clarification] No previous POI query found, falling back to regular processing');
        }
      }

      // Step 3: Check for directions requests (only if no POI search terms)
      const hasPOISearchTerms = query.toLowerCase().match(/find|show|search|restaurant|food|eat|movie|theater|cinema|grab|bite|downtown|near|close|within/);
      const isDirectionsRequest = !hasPOISearchTerms && query.toLowerCase().match(/directions|route|how to get|navigate|way to|give me directions|take me to/);

      if (isDirectionsRequest) {
        // Handle directions request
        console.log('[Query] Handling directions request');

        // Check if we have a selected POI to get directions to
        if (mapState.selectedPOI) {
          const destination = mapState.selectedPOI;
          const destinationLocation: Location = {
            lat: destination.lat,
            lng: destination.lng,
            display_name: destination.name
          };

          // Calculate route from user location to selected POI
          if (userLocation) {
            const route = await calculateRoute(userLocation, destinationLocation, 'driving');
            
            if (route) {
              // Update map with route
              setMapState(prev => ({
                ...prev,
                routes: [route],
                center: userLocation,
                zoom: 13,
              }));

              // Generate turn-by-turn directions
              let turnByTurnText = '';
              if (route.steps && route.steps.length > 0) {
                turnByTurnText = '\n\n🗺️ Turn-by-Turn Directions:\n';
                route.steps.forEach((step, index) => {
                  const stepNumber = index + 1;
                  const distance = step.distance > 1000 
                    ? `${(step.distance / 1000).toFixed(1)} km` 
                    : `${Math.round(step.distance)} m`;
                  turnByTurnText += `${stepNumber}. ${step.instruction} (${distance})\n`;
                });
              }

              // Build enhanced conversational route details
              const totalTime = Math.round(route.duration / 60);
              const totalDistance = (route.distance / 1000).toFixed(1);
              
              let routeDetails = `🗺️ Perfect! Here's your route to ${destination.name}:\n\n`;
              
              // Main route info
              routeDetails += `📍 Route Overview:\n`;
              routeDetails += `• Distance: ${totalDistance} km\n`;
              routeDetails += `• Travel Time: ${totalTime} minutes\n`;
              routeDetails += `• Transport: ${route.transport}\n`;
              
              // Enhanced route stats
              if ((route as any).avgspeed && (route as any).avgspeed > 0) {
                routeDetails += `• Average Speed: ${Math.round((route as any).avgspeed)} km/h\n`;
              }
              
              // Elevation info
              if ((route as any).ascent !== undefined && (route as any).descent !== undefined) {
                routeDetails += `• Elevation: +${Math.round((route as any).ascent)}m gain, -${Math.round((route as any).descent)}m loss\n`;
              }
              
              // Detour info
              if ((route as any).detourfactor && (route as any).detourfactor > 1.1) {
                const detourPercent = Math.round(((route as any).detourfactor - 1) * 100);
                routeDetails += `• Route Efficiency: ${detourPercent}% longer than direct route\n`;
              }
              
              routeDetails += '\n';
              
              // Traffic and Road Conditions
              if ((route as any).warnings && (route as any).warnings.length > 0) {
                routeDetails += `🚦 Traffic & Road Conditions:\n`;
                
                // Separate traffic info from road conditions
                const trafficWarnings = (route as any).warnings.filter((w: string) => 
                  w.includes('traffic') || w.includes('Heavy') || w.includes('Moderate') || w.includes('Light')
                );
                const roadWarnings = (route as any).warnings.filter((w: string) => 
                  !w.includes('traffic') && !w.includes('Heavy') && !w.includes('Moderate') && !w.includes('Light')
                );
                
                // Show traffic info first
                if (trafficWarnings.length > 0) {
                  trafficWarnings.forEach((warning: string) => {
                    routeDetails += `• 🚗 ${warning}\n`;
                  });
                }
                
                // Show road conditions
                if (roadWarnings.length > 0) {
                  roadWarnings.slice(0, 4).forEach((warning: string) => {
                    if (warning.includes('Steep')) {
                      routeDetails += `• 🏔️ ${warning}\n`;
                    } else if (warning.includes('Toll')) {
                      routeDetails += `• 💰 ${warning}\n`;
                    } else if (warning.includes('Road surfaces') || warning.includes('Road types')) {
                      routeDetails += `• 🛣️ ${warning}\n`;
                    } else {
                      routeDetails += `• ⚠️ ${warning}\n`;
                    }
                  });
                  
                  // Show count if there are more warnings
                  if (roadWarnings.length > 4) {
                    routeDetails += `• ...and ${roadWarnings.length - 4} more road conditions\n`;
                  }
                }
                
                routeDetails += '\n';
              }
              
              // Turn-by-turn directions
              if (turnByTurnText) {
                routeDetails += turnByTurnText;
              }
              
              routeDetails += `\n🗺️ The map shows your route with detailed turn-by-turn directions!\n`;
              routeDetails += `💡 Pro tip: Click on the blue route line for more route details!`;

              const directionsMessage: ChatMessage = {
                role: 'assistant',
                content: routeDetails,
                timestamp: new Date().toISOString(),
                id: Date.now().toString(),
              };

              setMessages(prev => [...prev, directionsMessage]);
            } else {
              const errorMessage: ChatMessage = {
                role: 'assistant',
                content: `❌ Sorry, I couldn't calculate directions to ${destination.name}. Please try again or use your device's navigation app.`,
                timestamp: new Date().toISOString(),
                id: Date.now().toString(),
              };

              setMessages(prev => [...prev, errorMessage]);
            }
          } else {
            const errorMessage: ChatMessage = {
              role: 'assistant',
              content: '❌ I need your current location to provide directions. Please enable location access or select a location on the map.',
              timestamp: new Date().toISOString(),
              id: Date.now().toString(),
            };

            setMessages(prev => [...prev, errorMessage]);
          }
        } else {
          const errorMessage: ChatMessage = {
            role: 'assistant',
            content: '❌ Please select a destination first by clicking on a marker on the map, then ask for directions.',
            timestamp: new Date().toISOString(),
            id: Date.now().toString(),
          };

          setMessages(prev => [...prev, errorMessage]);
        }

        setIsProcessing(false);
        isProcessingRef.current = false;
        return;
      }

      // Step 4: Fetch POIs based on search strategy
      let pois: POI[] | null = null;

      if (parsedQuery.searchStrategy === 'nearest_only') {
        // Find the single nearest POI
        const nearestResponse = await callAPI<{ 
          nearest: POI; 
          alternatives: POI[];
          strategy?: {
            transport: TransportMode;
            timeMinutes: number;
          };
        }>(
          '/api/poi/nearest',
          {
            method: 'POST',
            body: JSON.stringify({
              poiType: parsedQuery.poiType,
              userLocation: parsedQuery.location,
              transport: parsedQuery.transport,
              maxTimeMinutes: parsedQuery.timeMinutes,
              cuisine: parsedQuery.cuisine,
            }),
          },
          'pois',
          'pois'
        );
        
        if (nearestResponse) {
          // Combine nearest with alternatives
          pois = [nearestResponse.nearest, ...nearestResponse.alternatives];
          
          // Update parsed query with actual strategy used
          if (nearestResponse.strategy) {
            parsedQuery.transport = nearestResponse.strategy.transport;
            parsedQuery.timeMinutes = nearestResponse.strategy.timeMinutes;
          }
        }
      } else {
        // Find all POIs within time (default behavior)
        pois = await fetchPOIs(
          parsedQuery.location, 
          parsedQuery.poiType, 
          parsedQuery.timeMinutes,
          parsedQuery.transport,
          1, 
          poiPageSize,
          parsedQuery.keywords,
          parsedQuery.cuisine,
          parsedQuery.priceRange
        );
      }
      
      if (!pois) {
        throw createError(ErrorType.API, 'Unable to find places. Please try a different area or search term.');
      }

      // Step 3: Generate isochrone based on actual strategy used
      let isochroneData: IsochroneData | null = null;
      if (parsedQuery.searchStrategy === 'nearest_only') {
        // For nearest queries, generate isochrone based on the actual strategy that found POIs
        // The parsedQuery should have been updated with the actual strategy
        isochroneData = await generateIsochrone(
          parsedQuery.location,
          parsedQuery.timeMinutes,
          parsedQuery.transport
        );
      } else {
        // For within-time queries, use the original constraints
        isochroneData = await generateIsochrone(
          parsedQuery.location,
          parsedQuery.timeMinutes,
          parsedQuery.transport
        );
      }
      
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

      // Step 3.5: Calculate multi-modal durations for all POIs
      let finalPOIs = pois;
      try {
        const transportModes: TransportMode[] = ['walking', 'driving', 'cycling', 'public_transport'];
        const durationResponse = await fetch('/api/durations', {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'X-User-Id': userId || 'anonymous',
            'X-Memory-Enabled': memoryEnabled ? 'true' : 'false',
          },
          body: JSON.stringify({
            pois: pois,
            origin: parsedQuery.location,
            transportModes: transportModes,
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

      // Store POIs in memory for follow-up queries
      if (memoryEnabled && finalPOIs.length > 0) {
        try {
          await callAPI(
            '/api/memory',
            {
              method: 'POST',
              body: JSON.stringify({
                userId: userId || 'anonymous',
                content: `Found ${finalPOIs.length} ${parsedQuery.poiType}(s) near ${parsedQuery.location.display_name}`,
                type: 'location',
                metadata: {
                  query,
                  location: parsedQuery.location,
                  poisFound: finalPOIs.map(poi => ({
                    id: poi.id,
                    name: poi.name,
                    type: poi.type,
                    lat: poi.lat,
                    lng: poi.lng,
                    tags: poi.tags,
                  })),
                  transport: parsedQuery.transport,
                  timeMinutes: parsedQuery.timeMinutes,
                  poiType: parsedQuery.poiType,
                  cuisine: parsedQuery.cuisine,
                  timestamp: new Date().toISOString(),
                  context: {
                    timeOfDay: new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 18 ? 'afternoon' : 'evening',
                    dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' }),
                  },
                },
              }),
            },
              'responding',
              'responding'
            );
            console.log('[Memory] Stored', finalPOIs.length, 'POIs for follow-up queries');
        } catch (error) {
          console.error('[Memory] Failed to store POIs:', error);
          // Don't block the main flow if memory storage fails
        }
      }

      // Step 4: Generate response
      const responsePayload = await generateResponse(parsedQuery, finalPOIs!, isochroneData, messages);

      if (responsePayload?.memoryContext) {
        setMemoryContext(responsePayload.memoryContext);
        setUserPreferences(responsePayload.memoryContext.preferences ?? {});
        setPersonalizedSuggestions(responsePayload.personalizedSuggestions ?? []);
      }

      const responseText = responsePayload?.response;

      if (!responseText) {
        // Generate contextual fallback response
        let fallbackResponse = '';
        
        // Check if no POIs were found
        if (!finalPOIs || finalPOIs.length === 0) {
          const suggestions = [];
          if (parsedQuery.timeMinutes < 30) {
            suggestions.push(`try increasing the time to ${parsedQuery.timeMinutes + 15} minutes`);
          }
          if (parsedQuery.transport === 'walking') {
            suggestions.push('try changing to driving or cycling');
          } else if (parsedQuery.transport === 'driving') {
            suggestions.push('try changing to walking or cycling');
          }
          
          const suggestionText = suggestions.length > 0 ? `\n\n💡 Suggestions:\n• ${suggestions.join('\n• ')}` : '';
          
          fallbackResponse = `❌ Could not find any ${parsedQuery.poiType}s within ${parsedQuery.timeMinutes} minutes by ${parsedQuery.transport}.${suggestionText}`;
        } else if (parsedQuery.searchStrategy === 'nearest_only') {
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
            pois: finalPOIs, // Include POI data for More Info button
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
      
      // Handle both data.data (array) and data.location (single) formats
      const locations = data.data || (data.location ? [data.location] : []);
      
      if (data.success && locations.length > 0) {
        const location = locations[0]; // Use first result
        
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
    
    // Use the location directly instead of making another API call
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
  }, []);

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
        parsedQuery.timeMinutes,
        parsedQuery.transport,
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
    // Clear the input after sending
    if (chatInputRef.current) {
      chatInputRef.current.value = '';
    }
    if (mobileInputRef.current) {
      mobileInputRef.current.value = '';
    }
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

  // Handle directions request from popup button
  useEffect(() => {
    const handleDirectionsRequest = (event: CustomEvent) => {
      const { poi } = event.detail;
      if (poi) {
        // Set the POI as selected
        setMapState(prev => ({ ...prev, selectedPOI: poi }));
        // Trigger directions request
        setTimeout(() => {
          processQuery('give me directions');
        }, 100);
      }
    };

    window.addEventListener('requestDirections', handleDirectionsRequest as EventListener);
    return () => {
      window.removeEventListener('requestDirections', handleDirectionsRequest as EventListener);
    };
  }, [processQuery]);

  // Handle show POI details request from chat
  useEffect(() => {
    const handleShowPOIDetails = (event: CustomEvent) => {
      const { pois, query } = event.detail;
      if (pois && pois.length > 0) {
        // Create a detailed message about the POIs
        const poiDetails = pois.map((poi: POI, index: number) => {
          const distance = poi.distance ? `${(poi.distance / 1000).toFixed(2)} km` : 'Unknown distance';
          const duration = poi.durations ? 
            Object.entries(poi.durations)
              .map(([mode, time]) => `${mode}: ${time}min`)
              .join(', ') : 
            'Unknown duration';
          
          let details = `**${poi.name}** (${poi.type})\n`;
          details += `📍 Distance: ${distance}\n`;
          details += `⏱️ Duration: ${duration}\n`;
          
          if (poi.tags) {
            // Basic info
            if (poi.tags.cuisine) details += `🍽️ Cuisine: ${poi.tags.cuisine}\n`;
            if (poi.tags.opening_hours) details += `🕒 Hours: ${poi.tags.opening_hours}\n`;
            
            // Contact info
            if (poi.tags.website) details += `🌐 Website: ${poi.tags.website}\n`;
            if (poi.tags.phone) details += `📞 Phone: ${poi.tags.phone}\n`;
            if (poi.tags.email) details += `📧 Email: ${poi.tags.email}\n`;
            
            // Address info
            if (poi.tags['addr:street']) details += `🏠 Address: ${poi.tags['addr:street']}`;
            if (poi.tags['addr:housenumber']) details += ` ${poi.tags['addr:housenumber']}`;
            if (poi.tags['addr:city']) details += `, ${poi.tags['addr:city']}`;
            if (poi.tags['addr:postcode']) details += ` ${poi.tags['addr:postcode']}`;
            if (poi.tags['addr:street'] || poi.tags['addr:housenumber'] || poi.tags['addr:city']) details += '\n';
            
            // Amenities and features
            if (poi.tags.wheelchair) details += `♿ Wheelchair: ${poi.tags.wheelchair}\n`;
            if (poi.tags.payment) details += `💳 Payment: ${poi.tags.payment}\n`;
            if (poi.tags.wifi) details += `📶 WiFi: ${poi.tags.wifi}\n`;
            if (poi.tags.smoking) details += `🚭 Smoking: ${poi.tags.smoking}\n`;
            if (poi.tags.outdoor_seating) details += `🪑 Outdoor Seating: ${poi.tags.outdoor_seating}\n`;
            if (poi.tags.takeaway) details += `🥡 Takeaway: ${poi.tags.takeaway}\n`;
            if (poi.tags.delivery) details += `🚚 Delivery: ${poi.tags.delivery}\n`;
            
            // Ratings and reviews (if available)
            if (poi.tags.rating) details += `⭐ Rating: ${poi.tags.rating}/5\n`;
            if (poi.tags.reviews) details += `📝 Reviews: ${poi.tags.reviews}\n`;
            if (poi.tags['fhrs:id']) details += `🏆 Food Hygiene Rating: ${poi.tags['fhrs:id']}\n`;
            
            // Additional features
            if (poi.tags.brand) details += `🏷️ Brand: ${poi.tags.brand}\n`;
            if (poi.tags.amenity) details += `🏢 Type: ${poi.tags.amenity}\n`;
            if (poi.tags.capacity) details += `👥 Capacity: ${poi.tags.capacity}\n`;
            
            // Dietary options
            if (poi.tags['diet:vegetarian']) details += `🥬 Vegetarian: ${poi.tags['diet:vegetarian']}\n`;
            if (poi.tags['diet:vegan']) details += `🌱 Vegan: ${poi.tags['diet:vegan']}\n`;
            if (poi.tags['diet:gluten_free']) details += `🌾 Gluten-free: ${poi.tags['diet:gluten_free']}\n`;
          }
          
          return `${index + 1}. ${details}`;
        }).join('\n\n');

        const detailedMessage: ChatMessage = {
          role: 'assistant',
          content: `Here are the detailed information for the ${query?.poiType || 'places'} I found:\n\n${poiDetails}\n\nClick on any marker on the map to get directions!`,
          timestamp: new Date().toISOString(),
          metadata: {
            pois: pois,
            parsedQuery: query,
          }
        };

        setMessages(prev => [...prev, detailedMessage]);
      }
    };

    const handleShowTurnByTurnDirections = (event: CustomEvent) => {
      console.log('[Page] Received showTurnByTurnDirections event:', event.detail);
      const { route, steps } = event.detail;
      
      if (steps && steps.length > 0) {
        console.log('[Page] Processing turn-by-turn directions with', steps.length, 'steps');
        // Generate turn-by-turn directions message
        let turnByTurnText = `🧭 Turn-by-Turn Directions:\n\n`;
        
        steps.forEach((step: any, index: number) => {
          const stepNumber = index + 1;
          const distance = step.distance ? `${(step.distance / 1000).toFixed(2)} km` : '';
          const duration = step.duration ? `${Math.round(step.duration / 60)} min` : '';
          
          turnByTurnText += `${stepNumber}. ${step.instruction}`;
          if (distance || duration) {
            turnByTurnText += ` (${distance}${distance && duration ? ', ' : ''}${duration})`;
          }
          turnByTurnText += '\n';
        });
        
        turnByTurnText += `\n📍 Route Summary:\n`;
        turnByTurnText += `• Total Distance: ${(route.distance / 1000).toFixed(2)} km\n`;
        turnByTurnText += `• Total Duration: ${Math.round(route.duration / 60)} minutes\n`;
        turnByTurnText += `• Transport: ${route.transport}\n`;
        
        if (route.avgspeed && route.avgspeed > 0) {
          turnByTurnText += `• Average Speed: ${Math.round(route.avgspeed)} km/h\n`;
        }
        
        if (route.ascent !== undefined && route.descent !== undefined) {
          turnByTurnText += `• Elevation: +${Math.round(route.ascent)}m gain, -${Math.round(route.descent)}m loss\n`;
        }
        
        if (route.warnings && route.warnings.length > 0) {
          turnByTurnText += `\n⚠️ Route Warnings:\n`;
          route.warnings.slice(0, 3).forEach((warning: string) => {
            turnByTurnText += `• ${warning}\n`;
          });
          if (route.warnings.length > 3) {
            turnByTurnText += `• ...and ${route.warnings.length - 3} more conditions\n`;
          }
        }
        
        const turnByTurnMessage: ChatMessage = {
          role: 'assistant',
          content: turnByTurnText,
          timestamp: new Date().toISOString(),
          id: (Date.now() + 1).toString(),
          metadata: {
            queryType: 'turn_by_turn',
            route: route,
          },
        };
        
        setMessages(prev => [...prev, turnByTurnMessage]);
      }
    };

    window.addEventListener('showPOIDetails', handleShowPOIDetails as EventListener);
    window.addEventListener('showTurnByTurnDirections', handleShowTurnByTurnDirections as EventListener);
    return () => {
      window.removeEventListener('showPOIDetails', handleShowPOIDetails as EventListener);
      window.removeEventListener('showTurnByTurnDirections', handleShowTurnByTurnDirections as EventListener);
    };
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
        <div className="w-full lg:w-[420px] min-h-0 flex flex-col order-2 lg:order-2 border-l border-gray-700 lg:max-h-screen">
          {/* Compact Memory Indicator */}
          {memoryEnabled && (
            <div className="hidden lg:flex items-center justify-between px-4 py-2 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-b border-blue-500/20">
              <div className="flex items-center space-x-2">
                <Sparkles className="h-3.5 w-3.5 text-blue-400 animate-pulse" />
                <span className="text-xs font-medium text-blue-200">Memory active</span>
              </div>
              <div className="flex items-center space-x-2">
                {memoryInsightsLoading && <Loader2 className="h-3 w-3 text-blue-400 animate-spin" />}
                <button onClick={() => handleMemoryToggle(false)} className="text-xs text-gray-400 hover:text-gray-300 transition">Disable</button>
                <button onClick={handleClearMemories} disabled={isClearingMemory} className="text-xs text-gray-400 hover:text-red-400 transition disabled:opacity-50">
                  {isClearingMemory ? 'Clearing...' : 'Clear'}
                </button>
              </div>
            </div>
          )}
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
