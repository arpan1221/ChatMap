/**
 * Find POI Enroute Use Case
 * Finds optimal POI stopover along route to destination
 * Example: "Find gas station before airport in 30 mins"
 */

import { getORSClient } from '@/src/clients/ors-client';
import { getNominatimClient } from '@/src/clients/nominatim-client';
import { getOverpassClient } from '@/src/clients/overpass-client';
import * as turf from '@turf/turf';
import type {
  FindPOIEnrouteRequest,
  FindPOIEnrouteResult,
  RouteInfo,
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
import type { POI, Location } from '@/src/lib/types';

/**
 * Find optimal POI stopover along route to destination
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Geocode destination if string
 * 3. Get direct route to destination
 * 4. Check if within time constraint
 * 5. Create route corridor buffer
 * 6. Search for candidate POIs along route
 * 7. Optimize stopover selection
 * 8. Return optimized route
 */
export async function findPOIEnroute(
  request: FindPOIEnrouteRequest
): Promise<UseCaseResult<FindPOIEnrouteResult>> {
  const startTime = Date.now();
  let apiCallsCount = 0;

  try {
    // Step 1: Validate inputs
    const locationError = validateLocation(request.userLocation);
    if (locationError) {
      return createError(locationError.code, locationError.message, locationError.details);
    }

    const timeError = validateTimeConstraint(request.maxTotalTimeMinutes, 5, 180);
    if (timeError) {
      return createError(timeError.code, timeError.message, timeError.details);
    }

    if (!request.poiType) {
      return createError(
        UseCaseErrorCode.MISSING_REQUIRED_FIELD,
        'POI type is required'
      );
    }

    const transport = request.transport || 'driving';
    const maxDetourMinutes = request.maxDetourMinutes || 10;

    // Step 2: Geocode destination if needed
    let destinationLocation: Location;

    if (typeof request.destination === 'string') {
      const nominatimClient = getNominatimClient();
      apiCallsCount++;

      const geocoded = await nominatimClient.geocode(request.destination);

      if (!geocoded) {
        return createError(
          UseCaseErrorCode.GEOCODING_FAILED,
          `Could not find destination: ${request.destination}`,
          { destination: request.destination }
        );
      }

      destinationLocation = geocoded;
    } else {
      destinationLocation = request.destination;
    }

    // Step 3: Get direct route
    const orsClient = getORSClient();
    apiCallsCount++;

    const directDirections = await orsClient.getDirections({
      coordinates: [request.userLocation, destinationLocation],
      profile: transport,
      instructions: true,
      geometry: true,
    });

    const directRoute = parseRouteInfo(directDirections);

    // Step 4: Check time constraint
    if (directRoute.duration > request.maxTotalTimeMinutes) {
      return createError(
        UseCaseErrorCode.TIME_CONSTRAINT_EXCEEDED,
        `Direct route takes ${Math.round(directRoute.duration)} minutes, exceeds ${request.maxTotalTimeMinutes} minute limit`,
        {
          directDuration: directRoute.duration,
          maxTime: request.maxTotalTimeMinutes,
        }
      );
    }

    // Step 5: Create route corridor for POI search
    const routeBuffer = createRouteBuffer(directRoute, 5000); // 5km buffer

    // Step 6: Search for candidate POIs along route
    const overpassClient = getOverpassClient();
    apiCallsCount++;

    const candidatePOIs = await overpassClient.findPOIs({
      poiType: request.poiType,
      bounds: routeBuffer,
      cuisine: request.cuisine,
      maxResults: 30,
    });

    if (candidatePOIs.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found along the route to ${destinationLocation.display_name}`,
        { poiType: request.poiType }
      );
    }

    // Filter POIs close to route
    const poisNearRoute = filterPOIsNearRoute(
      candidatePOIs,
      directRoute,
      request.userLocation,
      2000 // 2km max distance from route
    );

    if (poisNearRoute.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found close enough to the route`
      );
    }

    // Step 7: Find optimal stopover
    // Calculate route through each candidate and find best one
    const candidateRoutes = await Promise.all(
      poisNearRoute.slice(0, 5).map(async (poi) => {
        try {
          apiCallsCount++;
          const routeWithStopover = await orsClient.getDirections({
            coordinates: [request.userLocation, { lat: poi.lat, lng: poi.lng }, destinationLocation],
            profile: transport,
            instructions: true,
            geometry: true,
          });

          const routeInfo = parseRouteInfo(routeWithStopover);
          const detourTime = routeInfo.duration - directRoute.duration;

          return {
            poi,
            routeInfo,
            detourTime,
            feasible: detourTime <= maxDetourMinutes,
          };
        } catch {
          return null;
        }
      })
    );

    const validRoutes = candidateRoutes.filter(
      r => r !== null && r.feasible
    ) as NonNullable<typeof candidateRoutes[0]>[];

    if (validRoutes.length === 0) {
      return createError(
        UseCaseErrorCode.NO_RESULTS_FOUND,
        `No ${request.poiType} found that meets the detour time limit of ${maxDetourMinutes} minutes`,
        {
          candidatesChecked: poisNearRoute.length,
          maxDetour: maxDetourMinutes,
        }
      );
    }

    // Select route with minimal detour
    const bestRoute = validRoutes.reduce((best, current) =>
      current.detourTime < best.detourTime ? current : best
    );

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount,
    };

    return createSuccess<FindPOIEnrouteResult>(
      {
        stopoverPOI: bestRoute.poi,
        destination: destinationLocation,
        directRoute,
        optimizedRoute: bestRoute.routeInfo,
        timeSavings: -Math.round(bestRoute.detourTime), // Negative = added time
        detourDistance: Math.round(
          bestRoute.routeInfo.distance - directRoute.distance
        ),
        allCandidates: poisNearRoute.slice(0, 10),
      },
      metadata
    );
  } catch (error) {
    console.error('[FindPOIEnroute] Error:', error);

    return createError(
      UseCaseErrorCode.UNKNOWN_ERROR,
      error instanceof Error ? error.message : 'Failed to find POI enroute',
      error,
      true
    );
  }
}

/**
 * Parse ORS directions response to RouteInfo
 */
function parseRouteInfo(directionsResponse: any): RouteInfo {
  const route = directionsResponse.routes?.[0] || directionsResponse.features?.[0];

  if (!route) {
    throw new Error('No route found in response');
  }

  const summary = route.summary || route.properties?.summary;
  const geometry = route.geometry;

  return {
    distance: summary?.distance || 0,
    duration: (summary?.duration || 0) / 60, // Convert to minutes
    geometry: geometry,
    steps: route.segments?.[0]?.steps?.map((step: any) => ({
      instruction: step.instruction,
      distance: step.distance,
      duration: step.duration / 60,
      type: step.type,
    })),
  };
}

/**
 * Create bounding box buffer around route
 */
function createRouteBuffer(route: RouteInfo, bufferMeters: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  if (!route.geometry || !route.geometry.coordinates) {
    throw new Error('Route geometry missing');
  }

  const coords = route.geometry.coordinates;
  const lats = coords.map(c => c[1]);
  const lngs = coords.map(c => c[0]);

  // Add buffer (rough approximation: 1 degree ≈ 111km)
  const bufferDegrees = bufferMeters / 111000;

  return {
    south: Math.min(...lats) - bufferDegrees,
    west: Math.min(...lngs) - bufferDegrees,
    north: Math.max(...lats) + bufferDegrees,
    east: Math.max(...lngs) + bufferDegrees,
  };
}

/**
 * Filter POIs near the route
 */
function filterPOIsNearRoute(
  pois: POI[],
  route: RouteInfo,
  userLocation: Location,
  maxDistanceMeters: number
): POI[] {
  if (!route.geometry) {
    return pois;
  }

  try {
    const routeLine = turf.lineString(route.geometry.coordinates);

    return pois.filter(poi => {
      const poiPoint = turf.point([poi.lng, poi.lat]);
      const distance = turf.pointToLineDistance(poiPoint, routeLine, {
        units: 'meters',
      });

      return distance <= maxDistanceMeters;
    }).map(poi => {
      // Add distance from user
      const distanceFromUser = calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng });
      return {
        ...poi,
        distance: Math.round(distanceFromUser),
      };
    });
  } catch (error) {
    console.error('[FilterPOIsNearRoute] Error:', error);
    // Fallback: return POIs sorted by distance from user
    return pois
      .map(poi => ({
        ...poi,
        distance: Math.round(calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng })),
      }))
      .sort((a, b) => a.distance! - b.distance!)
      .slice(0, 10);
  }
}

/**
 * Calculate distance between two locations
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

export default findPOIEnroute;
