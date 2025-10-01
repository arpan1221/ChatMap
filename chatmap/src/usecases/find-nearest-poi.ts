/**
 * Find Nearest POI Use Case
 * Finds the single nearest POI of a given type
 */

import { getORSClient } from '@/src/clients/ors-client';
import { getOverpassClient } from '@/src/clients/overpass-client';
import type {
  FindNearestPOIRequest,
  FindNearestPOIResult,
  UseCaseResult,
  UseCaseMetadata,
} from './types';
import type { TransportMode } from '@/src/lib/types';
import {
  createSuccess,
  createError,
  validateLocation,
  UseCaseErrorCode,
} from './types';
import type { POI } from '@/src/lib/types';

/**
 * Find the nearest POI of a specific type
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Generate isochrone around user location
 * 3. Search for POIs within isochrone
 * 4. Calculate distances to all POIs
 * 5. Return nearest POI with alternatives
 */
export async function findNearestPOI(
  request: FindNearestPOIRequest
): Promise<UseCaseResult<FindNearestPOIResult>> {
  const startTime = Date.now();
  let apiCallsCount = 0;

  try {
    // Step 1: Validate inputs
    const locationError = validateLocation(request.userLocation);
    if (locationError) {
      return createError(locationError.code, locationError.message, locationError.details);
    }

    if (!request.poiType) {
      return createError(
        UseCaseErrorCode.MISSING_REQUIRED_FIELD,
        'POI type is required'
      );
    }

    // Progressive search strategy for "nearest" queries
    // Try different transport modes and time constraints until we find something
    const searchStrategies: Array<{ transport: TransportMode; timeMinutes: number }> = [
      { transport: 'walking', timeMinutes: 10 },
      { transport: 'driving', timeMinutes: 10 },
      { transport: 'walking', timeMinutes: 20 },
      { transport: 'driving', timeMinutes: 20 },
      { transport: 'walking', timeMinutes: 30 },
      { transport: 'driving', timeMinutes: 30 },
      { transport: 'walking', timeMinutes: 45 },
      { transport: 'driving', timeMinutes: 45 },
      { transport: 'walking', timeMinutes: 60 },
      { transport: 'driving', timeMinutes: 60 },
    ];

    const orsClient = getORSClient();
    const overpassClient = getOverpassClient();
    let foundPOIs: POI[] = [];
    let usedStrategy = searchStrategies[0];

    // Try each strategy until we find POIs
    for (const strategy of searchStrategies) {
      try {
        console.log(`[FindNearestPOI] Trying ${strategy.transport} for ${strategy.timeMinutes} minutes`);
        
        // Generate isochrone
        apiCallsCount++;
        const isochrone = await orsClient.getIsochrone({
          location: request.userLocation,
          profile: strategy.transport as any, // Will be converted by ORS client
          range: [strategy.timeMinutes * 60], // Convert to seconds
        });

        // Search for POIs within isochrone bbox
        apiCallsCount++;
        const bbox = isochrone.bbox;
        const pois = await overpassClient.findPOIs({
          poiType: request.poiType,
          bounds: {
            south: bbox[1],
            west: bbox[0],
            north: bbox[3],
            east: bbox[2],
          },
          cuisine: request.cuisine,
          maxResults: 20, // Get top 20 to find nearest
        });

        if (pois && pois.length > 0) {
          // Filter POIs that are actually within the time constraint
          const poisWithinTime = pois.filter(poi => {
            const distance = calculateDistance(request.userLocation, { lat: poi.lat, lng: poi.lng });
            const estimatedTime = estimateTravelTime(distance, strategy.transport);
            return estimatedTime <= strategy.timeMinutes;
          });
          
          if (poisWithinTime.length > 0) {
            foundPOIs = poisWithinTime;
            usedStrategy = strategy;
            console.log(`[FindNearestPOI] Found ${poisWithinTime.length} POI(s) within ${strategy.timeMinutes}min ${strategy.transport} (filtered from ${pois.length} total)`);
            break;
          } else {
            console.log(`[FindNearestPOI] Found ${pois.length} POI(s) but none within ${strategy.timeMinutes}min ${strategy.transport}, trying next strategy`);
          }
        }
      } catch (error) {
        console.warn(`[FindNearestPOI] Strategy ${strategy.transport}/${strategy.timeMinutes}min failed:`, error);
        // Continue to next strategy
      }
    }

    if (foundPOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found within reasonable distance`,
        { poiType: request.poiType, strategiesTried: searchStrategies.length }
      );
    }

    // Step 4: Calculate distances and sort
    const poisWithDistances = foundPOIs.map(poi => ({
      poi,
      distance: calculateDistance(request.userLocation, { lat: poi.lat, lng: poi.lng }),
    }));

    poisWithDistances.sort((a, b) => a.distance - b.distance);

    // Step 5: Get nearest and alternatives
    const nearest = poisWithDistances[0];
    const alternatives = poisWithDistances.slice(1, 4).map(p => p.poi);

    // Estimate travel time based on distance and the transport mode that actually worked
    const travelTime = estimateTravelTime(nearest.distance, usedStrategy.transport);

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount,
    };

    return createSuccess<FindNearestPOIResult>(
      {
        poi: nearest.poi,
        distance: Math.round(nearest.distance),
        travelTime: Math.round(travelTime),
        transport: usedStrategy.transport,
        alternativePOIs: alternatives,
        strategy: {
          transport: usedStrategy.transport,
          timeMinutes: usedStrategy.timeMinutes,
        },
      },
      metadata
    );
  } catch (error) {
    console.error('[FindNearestPOI] Error:', error);

    return createError(
      UseCaseErrorCode.UNKNOWN_ERROR,
      error instanceof Error ? error.message : 'Failed to find nearest POI',
      error,
      true // retryable
    );
  }
}

/**
 * Calculate straight-line distance between two locations (Haversine formula)
 * @returns distance in meters
 */
function calculateDistance(
  loc1: { lat: number; lng: number },
  loc2: { lat: number; lng: number }
): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (loc1.lat * Math.PI) / 180;
  const φ2 = (loc2.lat * Math.PI) / 180;
  const Δφ = ((loc2.lat - loc1.lat) * Math.PI) / 180;
  const Δλ = ((loc2.lng - loc1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Estimate travel time based on distance and transport mode
 * @returns time in minutes
 */
function estimateTravelTime(distanceMeters: number, transport: string): number {
  // Average speeds in m/s
  const speeds: Record<string, number> = {
    walking: 1.4, // ~5 km/h
    driving: 13.9, // ~50 km/h
    cycling: 4.2, // ~15 km/h
    public_transport: 8.3, // ~30 km/h
  };

  const speed = speeds[transport] || speeds.walking;
  return (distanceMeters / speed) / 60; // Convert seconds to minutes
}

export default findNearestPOI;
