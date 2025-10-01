/**
 * Use Cases Index
 * Exports all use cases and types
 */

// Use case implementations
import { findNearestPOI } from './find-nearest-poi';
import { findPOIsWithinTime } from './find-pois-within-time';
import { findPOIsNearPOI } from './find-pois-near-poi';
import { findPOIEnroute } from './find-poi-enroute';
import { geocode } from './geocode';
import { getRoute } from './get-route';

// Re-export for named imports
export { findNearestPOI, findPOIsWithinTime, findPOIsNearPOI, findPOIEnroute, geocode, getRoute };

// Types
export type {
  // Base types
  UseCaseResult,
  UseCaseError,
  UseCaseMetadata,
  
  // Find Nearest POI
  FindNearestPOIRequest,
  FindNearestPOIResult,
  
  // Find POIs Within Time
  FindPOIsWithinTimeRequest,
  FindPOIsWithinTimeResult,
  
  // Find POIs Near POI
  FindPOIsNearPOIRequest,
  FindPOIsNearPOIResult,
  POIWithDistance,
  
  // Find POI Enroute
  FindPOIEnrouteRequest,
  FindPOIEnrouteResult,
  RouteInfo,
  RouteStep,
  
  // Geocoding
  GeocodeRequest,
  GeocodeResult,
  
  // Routing
  GetRouteRequest,
  GetRouteResult,
  
  // Common
  POIPreferences,
} from './types';

export { UseCaseErrorCode, createSuccess, createError } from './types';

// Default export with all use cases
export default {
  findNearestPOI,
  findPOIsWithinTime,
  findPOIsNearPOI,
  findPOIEnroute,
  geocode,
  getRoute,
};
