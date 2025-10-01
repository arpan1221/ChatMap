/**
 * Get Route Use Case
 * Calculates optimal route between locations
 */

import { getORSClient } from '@/src/clients/ors-client';
import type {
  GetRouteRequest,
  GetRouteResult,
  RouteInfo,
  UseCaseResult,
  UseCaseMetadata,
} from './types';
import {
  createSuccess,
  createError,
  validateLocation,
  UseCaseErrorCode,
} from './types';

/**
 * Get route between locations
 * 
 * Flow:
 * 1. Validate inputs
 * 2. Call ORS Directions API
 * 3. Parse and return routes
 */
export async function getRoute(
  request: GetRouteRequest
): Promise<UseCaseResult<GetRouteResult>> {
  const startTime = Date.now();

  try {
    // Step 1: Validate
    const startError = validateLocation(request.start);
    if (startError) {
      return createError(startError.code, startError.message, startError.details);
    }

    const endError = validateLocation(request.end);
    if (endError) {
      return createError(endError.code, endError.message, endError.details);
    }

    // Validate waypoints if provided
    if (request.waypoints) {
      for (const waypoint of request.waypoints) {
        const waypointError = validateLocation(waypoint);
        if (waypointError) {
          return createError(
            waypointError.code,
            waypointError.message,
            waypointError.details
          );
        }
      }
    }

    const transport = request.transport || 'driving';

    // Step 2: Get directions
    const orsClient = getORSClient();

    const coordinates = [
      request.start,
      ...(request.waypoints || []),
      request.end,
    ];

    console.log('[GetRoute] Calling ORS with coordinates:', coordinates);
    console.log('[GetRoute] Transport:', transport);

    const directions = await orsClient.getDirections({
      coordinates,
      profile: transport,
      instructions: true,
      geometry: true,
      avoidFeatures: request.avoidFeatures,
      alternativeRoutes: request.alternativeRoutes
        ? { shareeFactor: 0.6, targetCount: 2, weightFactor: 1.4 }
        : undefined,
      // Request additional route attributes
      attributes: ['avgspeed', 'detourfactor', 'percentage'],
      elevation: true, // Include elevation data
      maneuvers: true, // Include maneuver information
      // Request traffic and warnings information
      options: {
        avoid_features: request.avoidFeatures || [],
        avoid_borders: 'all',
        avoid_countries: [],
        // Request traffic information
        profile_params: {
          weightings: {
            green: 0.1,
            quiet: 0.1
          }
        }
      }
    });

    // Step 3: Parse routes
    const routes = parseRoutes(directions);

    if (routes.length === 0) {
      return createError(
        UseCaseErrorCode.ROUTING_FAILED,
        'No routes found',
        { start: request.start, end: request.end }
      );
    }

    // Find best route (shortest duration)
    const bestRouteIndex = routes.reduce(
      (bestIdx, route, idx) =>
        route.duration < routes[bestIdx].duration ? idx : bestIdx,
      0
    );

    const metadata: UseCaseMetadata = {
      executionTimeMs: Date.now() - startTime,
      apiCallsCount: 1,
    };

    return createSuccess<GetRouteResult>(
      {
        routes,
        transport,
        bestRouteIndex,
      },
      metadata
    );
  } catch (error) {
    console.error('[GetRoute] Error:', error);

    return createError(
      UseCaseErrorCode.ROUTING_FAILED,
      error instanceof Error ? error.message : 'Route calculation failed',
      error,
      true
    );
  }
}

/**
 * Parse ORS directions response
 */
function parseRoutes(directionsResponse: any): RouteInfo[] {
  const routesData = directionsResponse.routes || directionsResponse.features || [];

  return routesData.map((route: any) => {
    const summary = route.summary || route.properties?.summary;
    const geometry = route.geometry;
    const segments = route.segments || [];

    // Calculate elevation data from coordinates if available
    let ascent = 0;
    let descent = 0;
    let avgspeed = 0;
    
    if (geometry?.coordinates && geometry.coordinates.length > 0) {
      // Check if coordinates have elevation data (3rd dimension)
      const hasElevation = geometry.coordinates[0].length === 3;
      
      if (hasElevation) {
        let totalAscent = 0;
        let totalDescent = 0;
        
        for (let i = 1; i < geometry.coordinates.length; i++) {
          const prevElevation = geometry.coordinates[i - 1][2];
          const currElevation = geometry.coordinates[i][2];
          const elevationDiff = currElevation - prevElevation;
          
          if (elevationDiff > 0) {
            totalAscent += elevationDiff;
          } else {
            totalDescent += Math.abs(elevationDiff);
          }
        }
        
        ascent = Math.round(totalAscent);
        descent = Math.round(totalDescent);
      }
      
      // Calculate average speed from distance and duration
      const distance = summary?.distance || 0;
      const duration = summary?.duration || 0;
      if (distance > 0 && duration > 0) {
        avgspeed = Math.round((distance / 1000) / (duration / 3600)); // km/h
      }
    }

    // Extract additional information from segments and extras
    const allWarnings: string[] = [];
    const trafficInfo: string[] = [];
    const roadConditions: string[] = [];
    
    // Check for warnings in segments
    segments.forEach((segment: any) => {
      if (segment.warnings) {
        allWarnings.push(...segment.warnings);
      }
    });
    
    // Check for traffic and road condition information in extras
    if (route.extras) {
      // Check for tollways
      if (route.extras.tollways && route.extras.tollways.length > 0) {
        trafficInfo.push(`Toll roads: ${route.extras.tollways.length} sections`);
      }
      
      // Check for surface conditions
      if (route.extras.surface) {
        const surfaces = Object.keys(route.extras.surface);
        if (surfaces.length > 0) {
          roadConditions.push(`Road surfaces: ${surfaces.join(', ')}`);
        }
      }
      
      // Check for way categories (highways, residential, etc.)
      if (route.extras.waycategory) {
        const categories = Object.keys(route.extras.waycategory);
        if (categories.length > 0) {
          roadConditions.push(`Road types: ${categories.join(', ')}`);
        }
      }
      
      // Check for road access restrictions
      if (route.extras.roadaccessrestrictions && route.extras.roadaccessrestrictions.length > 0) {
        roadConditions.push(`Access restrictions: ${route.extras.roadaccessrestrictions.length} sections`);
      }
    }
    
    // Add traffic information based on route characteristics
    if (avgspeed < 30) {
      trafficInfo.push('Heavy traffic expected');
    } else if (avgspeed < 50) {
      trafficInfo.push('Moderate traffic');
    } else {
      trafficInfo.push('Light traffic');
    }
    
    // Add elevation warnings
    if (ascent > 100) {
      roadConditions.push(`Steep climb: +${ascent}m elevation gain`);
    }
    if (descent > 100) {
      roadConditions.push(`Steep descent: -${descent}m elevation loss`);
    }

    return {
      distance: summary?.distance || 0,
      duration: (summary?.duration || 0) / 60, // Convert to minutes
      geometry: geometry,
      steps: segments[0]?.steps?.map((step: any) => ({
        instruction: step.instruction,
        distance: step.distance,
        duration: step.duration / 60,
        type: step.type,
      })) || [],
      // Additional route attributes
      ascent: ascent, // Elevation gain in meters (calculated from coordinates)
      descent: descent, // Elevation loss in meters (calculated from coordinates)
      avgspeed: avgspeed, // Average speed in km/h (calculated)
      detourfactor: route.detourfactor || 1.0, // How much longer vs direct route
      way_points: route.way_points || [], // Indices of waypoints in geometry
      warnings: [...allWarnings, ...trafficInfo, ...roadConditions], // Combined warnings and info
      bbox: route.bbox || [], // Bounding box of the route
      extras: route.extras || {}, // Additional route information
    };
  });
}

export default getRoute;
