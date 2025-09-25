/**
 * ChatMap TypeScript Type Definitions
 * Comprehensive interfaces for the conversational isochrone mapping application
 */

// ============================================================================
// CORE LOCATION TYPES
// ============================================================================

export interface Location {
  lat: number;
  lng: number;
  display_name: string;
}

// ============================================================================
// QUERY PARSING TYPES
// ============================================================================

export type POIType = 
  | 'restaurant' 
  | 'cafe' 
  | 'grocery' 
  | 'pharmacy' 
  | 'hospital' 
  | 'school' 
  | 'park' 
  | 'gym' 
  | 'bank' 
  | 'atm' 
  | 'gas_station' 
  | 'shopping' 
  | 'entertainment' 
  | 'transport' 
  | 'accommodation'
  | 'other';

export type TransportMode = 
  | 'walking' 
  | 'driving' 
  | 'cycling' 
  | 'public_transport';

export interface ParsedQuery {
  poiType: POIType;
  transport: TransportMode;
  timeMinutes: number;
  location: Location;
  keywords?: string[];
  cuisine?: 'mexican' | 'italian' | 'chinese' | 'indian' | 'japanese' | 'thai' | 'american' | 'french' | 'mediterranean' | 'other' | 'none';
  priceRange?: 'budget' | 'moderate' | 'upscale' | 'any';
  searchStrategy?: 'nearest_only' | 'all_within_time';
  showMultiModalDurations?: boolean;
  preferences?: {
    maxResults?: number;
    radius?: number;
    amenities?: string[];
    rating?: number;
  };
}

// ============================================================================
// POINT OF INTEREST TYPES
// ============================================================================

export interface POI {
  id: string;
  name: string;
  type: POIType;
  lat: number;
  lng: number;
  tags: Record<string, string | number | boolean>;
  distance?: number; // in meters
  walkTime?: number; // in minutes
  address?: string;
  phone?: string;
  website?: string;
  openingHours?: string;
  rating?: number;
  priceLevel?: 'low' | 'medium' | 'high';
  durations?: {
    walking?: number; // in minutes
    driving?: number; // in minutes
    cycling?: number; // in minutes
    public_transport?: number; // in minutes
  };
}

// ============================================================================
// GEOJSON TYPES
// ============================================================================

export interface GeoJSONFeature {
  type: 'Feature';
  geometry: {
    type: 'Polygon' | 'MultiPolygon' | 'Point' | 'LineString' | 'MultiLineString';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: Record<string, any>;
}

export interface IsochroneData {
  type: 'FeatureCollection';
  features: GeoJSONFeature[];
  properties?: {
    transportMode: TransportMode;
    timeMinutes: number;
    center: Location;
    generatedAt: string;
  };
}

// ============================================================================
// CHAT MESSAGE TYPES
// ============================================================================

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  timestamp: string; // ISO 8601 format
  id?: string;
  metadata?: {
    queryType?: 'location' | 'poi_search' | 'general';
    parsedQuery?: ParsedQuery;
    processingTime?: number;
    error?: string;
    memoryContextIds?: string[];
  };
}

// ============================================================================
// MAP STATE TYPES
// ============================================================================

export interface MapState {
  center: Location;
  zoom: number;
  isochrone: IsochroneData | null;
  pois: POI[];
  selectedPOI: POI | null;
  isLoading: boolean;
  error: string | null;
  bounds?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// ============================================================================
// API RESPONSE TYPES
// ============================================================================

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

// Pagination metadata
export interface PaginationMetadata {
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  totalResults: number;
}

export interface OpenRouteServiceResponse {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: {
      type: 'Polygon';
      coordinates: number[][][];
    };
    properties: {
      group_index: number;
      value: number;
      center: number[];
    };
  }>;
  bbox: number[];
  metadata: {
    attribution: string;
    service: string;
    timestamp: number;
    query: {
      profile: string;
      format: string;
      locations: number[][];
      range: number[];
      range_type: string;
    };
  };
}

// ============================================================================
// MEMORY TYPES
// ============================================================================

export interface TimePreferences {
  morning?: boolean;
  afternoon?: boolean;
  evening?: boolean;
  lateNight?: boolean;
  weekdays?: boolean;
  weekends?: boolean;
  preferredTimeRanges?: Array<{
    start: string; // HH:mm
    end: string;   // HH:mm
  }>;
}

export interface UserPreferences {
  favoriteTransport?: TransportMode[];
  favoritePOITypes?: string[];
  favoriteCuisines?: string[];
  timePreferences?: TimePreferences;
  dietaryRestrictions?: string[];
  budgetPreference?: 'low' | 'medium' | 'high' | 'any';
  accessibilityNeeds?: string[];
  ambiencePreferences?: string[];
  parkingPreference?: 'required' | 'preferred' | 'not_needed';
  visitFrequency?: Record<string, number>;
}

export interface ConversationMemory {
  id: string;
  userId: string;
  query: string;
  response: string;
  timestamp: string; // ISO 8601
  context?: Record<string, any>;
  relatedPOIs?: POI[];
  extractedPreferences?: Partial<UserPreferences>;
}

export interface LocationMemory {
  id: string;
  userId: string;
  location: Location;
  query: string;
  poisFound: POI[];
  selectedPOI?: POI;
  satisfaction?: number; // 1-5 rating
  timestamp: string;
  context: {
    timeOfDay: string;
    dayOfWeek: string;
    weather?: string;
    activity?: string;
    transportMode?: TransportMode;
  };
}

export interface Memory {
  id: string;
  userId: string;
  type: 'location' | 'conversation' | 'preference' | 'system' | string;
  content: string;
  score?: number;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
}

export interface LocationFrequency {
  location: Location;
  count: number;
  lastVisited: string;
  poiTypes?: string[];
  timeOfDay?: string[];
}

export interface MemorySearchFilters {
  poiType?: string;
  transportMode?: TransportMode;
  timeOfDay?: string;
  dayOfWeek?: string;
  radiusMeters?: number;
  locationCenter?: Location;
}

export interface MemoryContextSummary {
  userId: string;
  preferences: UserPreferences;
  conversationMemories: ConversationMemory[];
  locationHistory: LocationMemory[];
  relevantMemories: Memory[];
  frequentLocations: LocationFrequency[];
}

export interface OverpassResponse {
  elements: Array<{
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    tags: Record<string, string>;
  }>;
}

export interface NominatimResponse {
  place_id: number;
  licence: string;
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  display_name: string;
  address: {
    house_number?: string;
    road?: string;
    suburb?: string;
    city?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    country_code?: string;
  };
  boundingbox: string[];
  place_rank?: number;
  importance?: number;
  class?: string;
  type?: string;
}

// ============================================================================
// OLLAMA TYPES
// ============================================================================

export interface OllamaRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  };
}

export interface OllamaResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

// ============================================================================
// UTILITY TYPES
// ============================================================================

export interface SearchFilters {
  poiTypes?: POIType[];
  transportModes?: TransportMode[];
  timeRange?: {
    min: number;
    max: number;
  };
  distanceRange?: {
    min: number;
    max: number;
  };
  amenities?: string[];
  priceRange?: 'low' | 'medium' | 'high';
  rating?: number;
}

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface LoadingState {
  isLoading: boolean;
  loadingType?: 'geocoding' | 'isochrone' | 'pois' | 'ai_processing';
  progress?: number;
  message?: string;
}

export interface ErrorState {
  hasError: boolean;
  error: string | null;
  errorType?: 'network' | 'api' | 'parsing' | 'validation' | 'unknown';
  retryable: boolean;
}

// ============================================================================
// COMPONENT PROPS TYPES
// ============================================================================

export interface MapComponentProps {
  mapState: MapState;
  onLocationSelect: (location: Location) => void;
  onPOISelect: (poi: POI | null) => void;
  onMapMove: (center: Location, zoom: number) => void;
  className?: string;
  queryLocation?: Location | null;
  showLocationMarker?: boolean;
  frequentLocations?: LocationFrequency[];
  preferredPOITypes?: string[];
}

export interface ChatComponentProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isLoading: boolean;
  className?: string;
  queryLocation?: Location | null;
  userLocation?: Location | null;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  suggestions?: string[];
  onSuggestionSelect?: (suggestion: string) => void;
  memoryContext?: MemoryContextSummary | null;
  memoryEnabled?: boolean;
  onToggleMemory?: (enabled: boolean) => void;
  isMemoryHydrated?: boolean;
}

export interface POIListProps {
  pois: POI[];
  selectedPOI: POI | null;
  onPOISelect: (poi: POI | null) => void;
  onClose: () => void;
  className?: string;
}
