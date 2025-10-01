/**
 * Find POIs Within Time Use Case
 * Finds all POIs of a type within a time constraint
 */

import { getORSClient } from '@/src/clients/ors-client';
import { getOverpassClient } from '@/src/clients/overpass-client';
import * as turf from '@turf/turf';
import type {
  FindPOIsWithinTimeRequest,
  FindPOIsWithinTimeResult,
  UseCaseResult,
  UseCaseMetadata,
} from './types';
import {
  createSuccess,
  createError,
  validateLocation,
  validateTimeConstraint,
  UseCaseErrorCode,
} from './types';
import type { POI } from '@/src/lib/types';

/**
 * Find all POIs of a type within a time constraint
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Generate isochrone for the time constraint
 * 3. Search for POIs within isochrone bbox
 * 4. Filter POIs to only those actually within isochrone polygon
 * 5. Sort and limit results
 */
export async function findPOIsWithinTime(
  request: FindPOIsWithinTimeRequest
): Promise<UseCaseResult<FindPOIsWithinTimeResult>> {
  const startTime = Date.now();
  let apiCallsCount = 0;

  try {
    // Step 1: Validate inputs
    const locationError = validateLocation(request.userLocation);
    if (locationError) {
      return createError(locationError.code, locationError.message, locationError.details);
    }

    const timeError = validateTimeConstraint(request.timeMinutes, 1, 120);
    if (timeError) {
      return createError(timeError.code, timeError.message, timeError.details);
    }

    if (!request.poiType) {
      return createError(
        UseCaseErrorCode.MISSING_REQUIRED_FIELD,
        'POI type is required'
      );
    }

    const transport = request.transport || 'walking';
    const maxResults = request.maxResults || 50;
    const sortBy = request.sortBy || 'distance';

    // Step 2: Generate isochrone
    const orsClient = getORSClient();
    apiCallsCount++;

    const isochrone = await orsClient.getIsochrone({
      location: request.userLocation,
      profile: transport,
      range: [request.timeMinutes * 60], // Convert to seconds
    });

    // Step 3: Search for POIs within isochrone bbox
    const overpassClient = getOverpassClient();
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
      maxResults: maxResults * 2, // Get more for filtering
    });

    if (pois.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found within ${request.timeMinutes} minutes`,
        { poiType: request.poiType, timeMinutes: request.timeMinutes }
      );
    }

    // Step 4: Filter POIs within isochrone polygon
    const filteredPOIs = filterPOIsWithinIsochrone(
      pois,
      isochrone,
      request.userLocation
    );

    if (filteredPOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found within the actual reachable area`,
        { poiType: request.poiType, timeMinutes: request.timeMinutes }
      );
    }

    // Step 5: Sort POIs
    let sortedPOIs = filteredPOIs;
    
    if (sortBy === 'distance') {
      sortedPOIs = filteredPOIs.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    } else if (sortBy === 'rating' && filteredPOIs[0].rating !== undefined) {
      sortedPOIs = filteredPOIs.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    }

    // Limit results
    const limitedPOIs = sortedPOIs.slice(0, maxResults);

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount,
      warnings:
        filteredPOIs.length > maxResults
          ? [`Found ${filteredPOIs.length} POIs but limited to ${maxResults}`]
          : undefined,
    };

    return createSuccess<FindPOIsWithinTimeResult>(
      {
        pois: limitedPOIs,
        count: limitedPOIs.length,
        isochrone,
        transport,
        timeMinutes: request.timeMinutes,
        clustered: limitedPOIs.length > 20, // Suggest clustering on frontend
      },
      metadata
    );
  } catch (error) {
    console.error('[FindPOIsWithinTime] Error:', error);

    return createError(
      UseCaseErrorCode.UNKNOWN_ERROR,
      error instanceof Error ? error.message : 'Failed to find POIs',
      error,
      true // retryable
    );
  }
}

/**
 * Filter POIs to only those within isochrone polygon
 */
function filterPOIsWithinIsochrone(
  pois: POI[],
  isochrone: any,
  userLocation: { lat: number; lng: number }
): POI[] {
  try {
    // Get isochrone polygon from GeoJSON
    const isochronePolygon = turf.polygon(
      isochrone.features[0].geometry.coordinates
    );

    const filtered: POI[] = [];

    for (const poi of pois) {
      // Create point from POI location
      const poiPoint = turf.point([poi.lng, poi.lat]);

      // Check if point is within polygon
      if (turf.booleanPointInPolygon(poiPoint, isochronePolygon)) {
        // Calculate straight-line distance
        const distance = calculateDistance(
          userLocation,
          { lat: poi.lat, lng: poi.lng }
        );

        filtered.push({
          ...poi,
          distance: Math.round(distance),
        });
      }
    }

    return filtered;
  } catch (error) {
    console.error('[FilterPOIs] Error filtering by polygon:', error);
    // Fallback: return all POIs with distances
    return pois.map(poi => ({
      ...poi,
      distance: Math.round(
        calculateDistance(userLocation, {
          lat: poi.lat,
          lng: poi.lng,
        })
      ),
    }));
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

export default findPOIsWithinTime;
