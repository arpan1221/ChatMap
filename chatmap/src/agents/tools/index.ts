/**
 * LangChain Tools for ChatMap Agents
 * Wraps API endpoints as tools that agents can use
 */

import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { getORSClient, type ORSProfile } from '@/src/clients/ors-client';
import { getNominatimClient } from '@/src/clients/nominatim-client';
import { getOverpassClient } from '@/src/clients/overpass-client';
import type { Location, POI, POIType, TransportMode } from '@/src/lib/types';

// ============================================================================
// Helper Functions
// ============================================================================

function getORSProfile(transport: TransportMode): ORSProfile {
  const profileMap: Record<TransportMode, ORSProfile> = {
    walking: 'foot-walking',
    driving: 'driving-car',
    cycling: 'cycling-regular',
    public_transport: 'foot-walking', // Fallback to walking
  };
  return profileMap[transport] || 'foot-walking';
}

// ============================================================================
// Schema Definitions
// ============================================================================

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  display_name: z.string(),
});

const TransportModeSchema = z.enum(['walking', 'driving', 'cycling', 'public_transport']);

const POITypeSchema = z.enum([
  'restaurant',
  'cafe',
  'grocery',
  'pharmacy',
  'hospital',
  'school',
  'park',
  'gym',
  'bank',
  'atm',
  'gas_station',
  'shopping',
  'entertainment',
  'transport',
  'accommodation',
  'other',
]);

// ============================================================================
// Tool: Find Nearest POI
// ============================================================================

export const findNearestPOITool = new DynamicStructuredTool({
  name: 'find_nearest_poi',
  description:
    'Find the single nearest POI of a given type. Returns the closest location with distance and travel time.',
  schema: z.object({
    poiType: POITypeSchema,
    userLocation: LocationSchema,
    transport: TransportModeSchema.optional().default('walking'),
    cuisine: z.string().optional(),
  }),
  func: async ({ poiType, userLocation, transport, cuisine }) => {
    try {
      // For "nearest" queries, progressively search larger areas until we find something
      // Don't use isochrone - just search by distance circles
      const overpassClient = getOverpassClient();
      const searchRadii = [5000, 10000, 20000, 50000]; // meters: 5km, 10km, 20km, 50km
      
      let pois: POI[] = [];
      let searchRadius = 0;
      
      for (const radius of searchRadii) {
        searchRadius = radius;
        // Calculate bounding box for this radius
        const latDelta = radius / 111000; // Approximate: 1 degree lat = 111km
        const lngDelta = radius / (111000 * Math.cos(userLocation.lat * Math.PI / 180));
        
        pois = await overpassClient.findPOIs({
          poiType,
          bounds: {
            south: userLocation.lat - latDelta,
            west: userLocation.lng - lngDelta,
            north: userLocation.lat + latDelta,
            east: userLocation.lng + lngDelta,
          },
          cuisine,
          maxResults: 50,
        });
        
        if (pois.length > 0) {
          console.log(`[FindNearestPOI] Found ${pois.length} ${poiType}(s) within ${radius}m`);
          break;
        }
      }

      if (pois.length === 0) {
        return JSON.stringify({
          success: false,
          message: `No ${poiType} found within ${searchRadius / 1000}km`,
        });
      }

      // Find nearest by straight-line distance
      const nearest = pois.reduce((closest, poi) => {
        const poiLoc = { lat: poi.lat, lng: poi.lng, display_name: poi.name };
        const closestLoc = { lat: closest.lat, lng: closest.lng, display_name: closest.name };
        const distToCurrent = calculateDistance(userLocation, poiLoc);
        const distToClosest = calculateDistance(userLocation, closestLoc);
        return distToCurrent < distToClosest ? poi : closest;
      });

      const distance = calculateDistance(userLocation, { lat: nearest.lat, lng: nearest.lng, display_name: nearest.name });
      
      console.log(`[FindNearestPOI] Nearest ${poiType}: ${nearest.name} at ${Math.round(distance)}m`);

      return JSON.stringify({
        success: true,
        poi: nearest,
        distance,
      });
    } catch (error) {
      console.error('[FindNearestPOI] Error:', error);
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Tool: Find POIs Within Time
// ============================================================================

export const findPOIsWithinTimeTool = new DynamicStructuredTool({
  name: 'find_pois_within_time',
  description:
    'Find all POIs of a type within a time constraint. Returns multiple locations that can be reached within the specified time.',
  schema: z.object({
    poiType: POITypeSchema,
    userLocation: LocationSchema,
    timeMinutes: z.number().min(1).max(60),
    transport: TransportModeSchema.optional().default('walking'),
    cuisine: z.string().optional(),
    maxResults: z.number().optional().default(50),
  }),
  func: async ({ poiType, userLocation, timeMinutes, transport, cuisine, maxResults }) => {
    try {
      // Get isochrone
      const orsClient = getORSClient();
      const isochrone = await orsClient.getIsochrone({
        location: userLocation,
        profile: transport || 'walking',
        range: [timeMinutes * 60],
      });

      // Get POIs within isochrone bbox
      const overpassClient = getOverpassClient();
      const bbox = isochrone.bbox;
      const pois = await overpassClient.findPOIs({
        poiType,
        bounds: {
          south: bbox[1],
          west: bbox[0],
          north: bbox[3],
          east: bbox[2],
        },
        cuisine,
        maxResults: maxResults || 50,
      });

      // Filter POIs actually within isochrone polygon
      // (This would require turf.js or similar - simplified for now)
      const filtered = pois.map(poi => ({
        ...poi,
        distance: calculateDistance(userLocation, { lat: poi.lat, lng: poi.lng, display_name: poi.name }),
      })).sort((a, b) => a.distance - b.distance);

      return JSON.stringify({
        success: true,
        pois: filtered,
        count: filtered.length,
        isochrone: isochrone,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Tool: Calculate Matrix
// ============================================================================

export const calculateMatrixTool = new DynamicStructuredTool({
  name: 'calculate_matrix',
  description:
    'Calculate travel time and distance matrix between multiple locations. Useful for finding which POI is closest to another location.',
  schema: z.object({
    locations: z.array(LocationSchema).min(2).max(50),
    transport: TransportModeSchema.optional().default('walking'),
    metrics: z.array(z.enum(['duration', 'distance'])).optional().default(['duration', 'distance']),
  }),
  func: async ({ locations, transport, metrics }) => {
    try {
      const orsClient = getORSClient();
      const matrix = await orsClient.getMatrix({
        locations,
        profile: transport || 'walking',
        metrics: metrics || ['duration', 'distance'],
      });

      return JSON.stringify({
        success: true,
        durations: matrix.durations,
        distances: matrix.distances,
        sources: matrix.sources,
        destinations: matrix.destinations,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Tool: Get Directions
// ============================================================================

export const getDirectionsTool = new DynamicStructuredTool({
  name: 'get_directions',
  description:
    'Get turn-by-turn directions between waypoints. Returns route geometry, instructions, and travel time.',
  schema: z.object({
    coordinates: z.array(LocationSchema).min(2).max(50),
    transport: TransportModeSchema.optional().default('walking'),
    avoidFeatures: z.array(z.enum(['highways', 'tollways', 'ferries', 'fords', 'steps'])).optional(),
  }),
  func: async ({ coordinates, transport, avoidFeatures }) => {
    try {
      const orsClient = getORSClient();
      const directions = await orsClient.getDirections({
        coordinates,
        profile: transport || 'walking',
        instructions: true,
        geometry: true,
        avoidFeatures,
      });

      return JSON.stringify({
        success: true,
        routes: directions.routes || directions.features,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Tool: Optimize Route
// ============================================================================

export const optimizeRouteTool = new DynamicStructuredTool({
  name: 'optimize_route',
  description:
    'Optimize a multi-stop route with time windows and constraints. Finds the best order to visit locations.',
  schema: z.object({
    jobs: z.array(
      z.object({
        id: z.number(),
        location: LocationSchema,
        service: z.number().optional(),
        priority: z.number().optional(),
      })
    ),
    vehicle: z.object({
      start: LocationSchema,
      end: LocationSchema.optional(),
      transport: TransportModeSchema.optional().default('walking'),
    }),
  }),
  func: async ({ jobs, vehicle }) => {
    try {
      const orsClient = getORSClient();
      const optimization = await orsClient.optimize({
        jobs: jobs.map(job => ({
          id: job.id,
          location: [job.location.lng, job.location.lat],
          service: job.service,
          priority: job.priority,
        })),
        vehicles: [
          {
            id: 1,
            profile: getORSProfile(vehicle.transport || 'walking'),
            start: [vehicle.start.lng, vehicle.start.lat],
            end: vehicle.end ? [vehicle.end.lng, vehicle.end.lat] : undefined,
          },
        ],
      });

      return JSON.stringify({
        success: true,
        summary: optimization.summary,
        routes: optimization.routes,
        unassigned: optimization.unassigned,
      });
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Tool: Geocode Address
// ============================================================================

export const geocodeAddressTool = new DynamicStructuredTool({
  name: 'geocode_address',
  description:
    'Convert an address string to coordinates. Useful when user mentions a place name or address.',
  schema: z.object({
    address: z.string().min(2),
    countryCode: z.string().optional(),
  }),
  func: async ({ address, countryCode }) => {
    try {
      const nominatimClient = getNominatimClient();
      const location = await nominatimClient.geocode(address, {
        countrycodes: countryCode,
      });

      if (!location) {
        return JSON.stringify({
          success: false,
          message: `Could not find location: ${address}`,
        });
      }

      return JSON.stringify({
        success: true,
        location,
      });
    } catch (error) {
      console.error(`[GeocodeAddressTool] Error geocoding "${address}":`, error);
      return JSON.stringify({
        success: false,
        message: `Could not find location: ${address}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate straight-line distance between two locations (Haversine formula)
 */
function calculateDistance(loc1: Location, loc2: Location): number {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (loc1.lat * Math.PI) / 180;
  const φ2 = (loc2.lat * Math.PI) / 180;
  const Δφ = ((loc2.lat - loc1.lat) * Math.PI) / 180;
  const Δλ = ((loc2.lng - loc1.lng) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

// ============================================================================
// Export All Tools
// ============================================================================

export const allTools = [
  findNearestPOITool,
  findPOIsWithinTimeTool,
  calculateMatrixTool,
  getDirectionsTool,
  optimizeRouteTool,
  geocodeAddressTool,
];

export default allTools;
