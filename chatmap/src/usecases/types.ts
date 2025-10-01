/**
 * Use Case Types
 * Common types and interfaces for all use cases
 */

import type { Location, POI, IsochroneData, TransportMode, POIType } from '@/src/lib/types';

// ============================================================================
// Base Use Case Types
// ============================================================================

/**
 * Base result type for all use cases
 */
export interface UseCaseResult<T> {
  success: boolean;
  data?: T;
  error?: UseCaseError;
  metadata?: UseCaseMetadata;
}

/**
 * Error information for use case failures
 */
export interface UseCaseError {
  code: UseCaseErrorCode;
  message: string;
  details?: unknown;
  retryable?: boolean;
}

/**
 * Metadata about use case execution
 */
export interface UseCaseMetadata {
  executionTimeMs?: number;
  apiCallsCount?: number;
  cacheHit?: boolean;
  warnings?: string[];
}

/**
 * Standard error codes for use cases
 */
export enum UseCaseErrorCode {
  // Input validation errors
  INVALID_INPUT = 'INVALID_INPUT',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  INVALID_COORDINATES = 'INVALID_COORDINATES',
  INVALID_TIME_CONSTRAINT = 'INVALID_TIME_CONSTRAINT',
  
  // External service errors
  GEOCODING_FAILED = 'GEOCODING_FAILED',
  ISOCHRONE_FAILED = 'ISOCHRONE_FAILED',
  POI_SEARCH_FAILED = 'POI_SEARCH_FAILED',
  ROUTING_FAILED = 'ROUTING_FAILED',
  OPTIMIZATION_FAILED = 'OPTIMIZATION_FAILED',
  
  // Business logic errors
  NO_RESULTS_FOUND = 'NO_RESULTS_FOUND',
  TIME_CONSTRAINT_EXCEEDED = 'TIME_CONSTRAINT_EXCEEDED',
  TOO_MANY_RESULTS = 'TOO_MANY_RESULTS',
  
  // System errors
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
}

// ============================================================================
// Find Nearest POI
// ============================================================================

export interface FindNearestPOIRequest {
  poiType: POIType;
  userLocation: Location;
  transport?: TransportMode;
  maxDistanceMeters?: number;
  maxTimeMinutes?: number;
  cuisine?: string;
  preferences?: POIPreferences;
}

export interface FindNearestPOIResult {
  poi: POI;
  distance: number; // meters
  travelTime: number; // minutes
  transport: TransportMode;
  alternativePOIs?: POI[]; // Next 2-3 nearest as alternatives
  strategy?: {
    transport: TransportMode;
    timeMinutes: number;
  };
}

// ============================================================================
// Find POIs Within Time
// ============================================================================

export interface FindPOIsWithinTimeRequest {
  poiType: POIType;
  userLocation: Location;
  timeMinutes: number;
  transport?: TransportMode;
  maxResults?: number;
  cuisine?: string;
  preferences?: POIPreferences;
  sortBy?: 'distance' | 'rating' | 'relevance';
}

export interface FindPOIsWithinTimeResult {
  pois: POI[];
  count: number;
  isochrone: IsochroneData;
  transport: TransportMode;
  timeMinutes: number;
  clustered?: boolean;
}

// ============================================================================
// Find POIs Near POI
// ============================================================================

export interface FindPOIsNearPOIRequest {
  primaryPOIType: POIType;
  secondaryPOIType: POIType;
  userLocation: Location;
  transport?: TransportMode;
  maxTimeFromSecondary?: number; // minutes
  maxResults?: number;
  cuisine?: string;
  preferences?: POIPreferences;
}

export interface FindPOIsNearPOIResult {
  anchorPOI: POI; // The secondary POI (reference point)
  primaryPOIs: POIWithDistance[];
  count: number;
  transport: TransportMode;
  searchRadius: number; // meters
}

export interface POIWithDistance extends POI {
  distanceFromAnchor: number; // meters
  travelTimeFromAnchor: number; // minutes
  travelTimeFromUser: number; // minutes
}

// ============================================================================
// Find POI Enroute
// ============================================================================

export interface FindPOIEnrouteRequest {
  poiType: POIType;
  userLocation: Location;
  destination: string | Location;
  transport?: TransportMode;
  maxTotalTimeMinutes: number;
  maxDetourMinutes?: number;
  cuisine?: string;
  preferences?: POIPreferences;
}

export interface FindPOIEnrouteResult {
  stopoverPOI: POI;
  destination: Location;
  directRoute: RouteInfo;
  optimizedRoute: RouteInfo;
  timeSavings: number; // minutes (negative = added time)
  detourDistance: number; // meters
  allCandidates?: POI[]; // All POIs considered
}

export interface RouteInfo {
  distance: number; // meters
  duration: number; // minutes
  geometry?: GeoJSON.LineString;
  steps?: RouteStep[];
  // Additional route attributes from OpenRouteService
  ascent?: number; // Elevation gain in meters
  descent?: number; // Elevation loss in meters
  avgspeed?: number; // Average speed in km/h
  detourfactor?: number; // How much longer vs direct route (1.0 = direct)
  way_points?: number[]; // Indices of waypoints in geometry
  warnings?: string[]; // Route warnings
  bbox?: number[]; // Bounding box [minLng, minLat, maxLng, maxLat]
  extras?: Record<string, any>; // Additional route information
}

export interface RouteStep {
  instruction: string;
  distance: number;
  duration: number;
  type: 'start' | 'turn' | 'stopover' | 'destination';
}

// ============================================================================
// Geocoding
// ============================================================================

export interface GeocodeRequest {
  address: string;
  countryCode?: string;
  bounds?: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  maxResults?: number;
}

export interface GeocodeResult {
  locations: Location[];
  query: string;
  resultCount: number;
}

// ============================================================================
// Routing
// ============================================================================

export interface GetRouteRequest {
  start: Location;
  end: Location;
  waypoints?: Location[];
  transport?: TransportMode;
  avoidFeatures?: ('highways' | 'tollways' | 'ferries' | 'fords' | 'steps')[];
  alternativeRoutes?: boolean;
}

export interface GetRouteResult {
  routes: RouteInfo[];
  transport: TransportMode;
  bestRouteIndex: number;
}

// ============================================================================
// Common Types
// ============================================================================

export interface POIPreferences {
  openNow?: boolean;
  minRating?: number;
  maxPriceLevel?: 'low' | 'medium' | 'high';
  accessibility?: boolean;
  outdoorSeating?: boolean;
  parking?: boolean;
  wifi?: boolean;
}

/**
 * Helper to create success result
 */
export function createSuccess<T>(
  data: T,
  metadata?: UseCaseMetadata
): UseCaseResult<T> {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Helper to create error result
 */
export function createError<T = never>(
  code: UseCaseErrorCode,
  message: string,
  details?: unknown,
  retryable = false
): UseCaseResult<T> {
  return {
    success: false,
    error: {
      code,
      message,
      details,
      retryable,
    },
  };
}

/**
 * Helper to validate location
 */
export function validateLocation(location?: Location): UseCaseError | null {
  if (!location) {
    return {
      code: UseCaseErrorCode.MISSING_REQUIRED_FIELD,
      message: 'User location is required',
    };
  }

  if (
    typeof location.lat !== 'number' ||
    typeof location.lng !== 'number' ||
    location.lat < -90 ||
    location.lat > 90 ||
    location.lng < -180 ||
    location.lng > 180
  ) {
    return {
      code: UseCaseErrorCode.INVALID_COORDINATES,
      message: 'Invalid coordinates provided',
      details: { lat: location.lat, lng: location.lng },
    };
  }

  return null;
}

/**
 * Helper to validate time constraint
 */
export function validateTimeConstraint(
  timeMinutes?: number,
  min = 1,
  max = 120
): UseCaseError | null {
  if (timeMinutes === undefined) {
    return null; // Optional
  }

  if (typeof timeMinutes !== 'number' || timeMinutes < min || timeMinutes > max) {
    return {
      code: UseCaseErrorCode.INVALID_TIME_CONSTRAINT,
      message: `Time constraint must be between ${min} and ${max} minutes`,
      details: { provided: timeMinutes, min, max },
    };
  }

  return null;
}

export default {
  createSuccess,
  createError,
  validateLocation,
  validateTimeConstraint,
};
