/**
 * Find POIs Near POI Use Case
 * Finds POIs of type X near the nearest POI of type Y
 * Example: "Find coffee shops near the nearest park"
 */

import { getORSClient } from '@/src/clients/ors-client';
import { getOverpassClient } from '@/src/clients/overpass-client';
import * as turf from '@turf/turf';
import type {
  FindPOIsNearPOIRequest,
  FindPOIsNearPOIResult,
  POIWithDistance,
  UseCaseResult,
  UseCaseMetadata,
} from './types';
import {
  createSuccess,
  createError,
  validateLocation,
  UseCaseErrorCode,
} from './types';
import type { POI, Location } from '@/src/lib/types';

/**
 * Find POIs of type X near the nearest POI of type Y
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Find nearest secondary POI (anchor point)
 * 3. Generate isochrone around anchor POI
 * 4. Search for primary POIs within isochrone
 * 5. Calculate travel times from anchor to primary POIs
 * 6. Sort by distance/time from anchor
 */
export async function findPOIsNearPOI(
  request: FindPOIsNearPOIRequest
): Promise<UseCaseResult<FindPOIsNearPOIResult>> {
  const startTime = Date.now();
  let apiCallsCount = 0;

  try {
    // Step 1: Validate inputs
    const locationError = validateLocation(request.userLocation);
    if (locationError) {
      return createError(locationError.code, locationError.message, locationError.details);
    }

    if (!request.primaryPOIType || !request.secondaryPOIType) {
      return createError(
        UseCaseErrorCode.MISSING_REQUIRED_FIELD,
        'Both primary and secondary POI types are required'
      );
    }

    const transport = request.transport || 'walking';
    const maxTimeFromSecondary = request.maxTimeFromSecondary || 15;
    const maxResults = request.maxResults || 20;

    // Step 2: Find nearest secondary POI (anchor)
    const orsClient = getORSClient();
    const overpassClient = getOverpassClient();

    // Generate search area for secondary POI
    apiCallsCount++;
    const userIsochrone = await orsClient.getIsochrone({
      location: request.userLocation,
      profile: transport,
      range: [1800], // 30 min search area for anchor
    });

    apiCallsCount++;
    const secondaryPOIs = await overpassClient.findPOIs({
      poiType: request.secondaryPOIType,
      bounds: {
        south: userIsochrone.bbox[1],
        west: userIsochrone.bbox[0],
        north: userIsochrone.bbox[3],
        east: userIsochrone.bbox[2],
      },
      maxResults: 10,
    });

    if (secondaryPOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.secondaryPOIType} found near your location`,
        { poiType: request.secondaryPOIType }
      );
    }

    // Find nearest secondary POI
    const anchorPOI = findNearest(request.userLocation, secondaryPOIs);

    // Step 3: Generate isochrone around anchor POI
    apiCallsCount++;
    const anchorIsochrone = await orsClient.getIsochrone({
      location: { lat: anchorPOI.lat, lng: anchorPOI.lng },
      profile: transport,
      range: [maxTimeFromSecondary * 60],
    });

    // Step 4: Search for primary POIs within anchor isochrone
    apiCallsCount++;
    const primaryPOIs = await overpassClient.findPOIs({
      poiType: request.primaryPOIType,
      bounds: {
        south: anchorIsochrone.bbox[1],
        west: anchorIsochrone.bbox[0],
        north: anchorIsochrone.bbox[3],
        east: anchorIsochrone.bbox[2],
      },
      cuisine: request.cuisine,
      maxResults: maxResults * 2, // Get extra for filtering
    });

    if (primaryPOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.primaryPOIType} found near ${anchorPOI.name}`,
        {
          primaryType: request.primaryPOIType,
          anchorName: anchorPOI.name,
        }
      );
    }

    // Step 5: Filter by polygon and calculate distances
    const filteredPOIs = filterAndEnrichPOIs(
      primaryPOIs,
      anchorIsochrone,
      { lat: anchorPOI.lat, lng: anchorPOI.lng, display_name: anchorPOI.name },
      request.userLocation,
      transport
    );

    if (filteredPOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.primaryPOIType} found within ${maxTimeFromSecondary} minutes of ${anchorPOI.name}`
      );
    }

    // Step 6: Sort by distance from anchor
    const sortedPOIs = filteredPOIs.sort(
      (a, b) => a.distanceFromAnchor - b.distanceFromAnchor
    );

    // Limit results
    const limitedPOIs = sortedPOIs.slice(0, maxResults);

    // Calculate search radius
    const searchRadius = Math.max(...limitedPOIs.map(p => p.distanceFromAnchor));

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount,
      warnings:
        sortedPOIs.length > maxResults
          ? [`Found ${sortedPOIs.length} POIs but limited to ${maxResults}`]
          : undefined,
    };

    return createSuccess<FindPOIsNearPOIResult>(
      {
        anchorPOI,
        primaryPOIs: limitedPOIs,
        count: limitedPOIs.length,
        transport,
        searchRadius: Math.round(searchRadius),
      },
      metadata
    );
  } catch (error) {
    console.error('[FindPOIsNearPOI] Error:', error);

    return createError(
      UseCaseErrorCode.UNKNOWN_ERROR,
      error instanceof Error ? error.message : 'Failed to find POIs near POI',
      error,
      true
    );
  }
}

/**
 * Find the nearest POI from a list
 */
function findNearest(userLocation: Location, pois: POI[]): POI {
  let nearest = pois[0];
  let minDistance = calculateDistance(userLocation, { lat: pois[0].lat, lng: pois[0].lng });

  for (const poi of pois.slice(1)) {
    const distance = calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng });
    if (distance < minDistance) {
      minDistance = distance;
      nearest = poi;
    }
  }

  return nearest;
}

/**
 * Filter POIs within isochrone and enrich with distance info
 */
function filterAndEnrichPOIs(
  pois: POI[],
  isochrone: any,
  anchorLocation: Location,
  userLocation: Location,
  transport: string
): POIWithDistance[] {
  try {
    const isochronePolygon = turf.polygon(
      isochrone.features[0].geometry.coordinates
    );

    const enriched: POIWithDistance[] = [];

    for (const poi of pois) {
      const poiPoint = turf.point([poi.lng, poi.lat]);

      if (turf.booleanPointInPolygon(poiPoint, isochronePolygon)) {
        const distanceFromAnchor = calculateDistance(anchorLocation, { lat: poi.lat, lng: poi.lng });
        const distanceFromUser = calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng });

        enriched.push({
          ...poi,
          distanceFromAnchor: Math.round(distanceFromAnchor),
          travelTimeFromAnchor: Math.round(
            estimateTravelTime(distanceFromAnchor, transport)
          ),
          travelTimeFromUser: Math.round(
            estimateTravelTime(distanceFromUser, transport)
          ),
        });
      }
    }

    return enriched;
  } catch (error) {
    console.error('[FilterAndEnrich] Error:', error);
    // Fallback without polygon filtering
    return pois.map(poi => {
      const distanceFromAnchor = calculateDistance(anchorLocation, { lat: poi.lat, lng: poi.lng });
      const distanceFromUser = calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng });

      return {
        ...poi,
        distanceFromAnchor: Math.round(distanceFromAnchor),
        travelTimeFromAnchor: Math.round(
          estimateTravelTime(distanceFromAnchor, transport)
        ),
        travelTimeFromUser: Math.round(
          estimateTravelTime(distanceFromUser, transport)
        ),
      };
    });
  }
}

/**
 * Calculate straight-line distance between two locations
 */
function calculateDistance(
  loc1: { lat: number; lng: number },
  loc2: { lat: number; lng: number }
): number {
  const R = 6371e3;
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
 * Estimate travel time
 */
function estimateTravelTime(distanceMeters: number, transport: string): number {
  const speeds: Record<string, number> = {
    walking: 1.4,
    driving: 13.9,
    cycling: 4.2,
    public_transport: 8.3,
  };

  const speed = speeds[transport] || speeds.walking;
  return (distanceMeters / speed) / 60;
}

export default findPOIsNearPOI;
