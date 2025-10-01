/**
 * Isochrone API Route
 * Generate isochrone polygons showing reachable areas within time limits
 * Uses OpenRouteService Isochrone API via ORS Client
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getORSClient, ORSError } from '@/src/clients/ors-client';
import type { IsochroneData, Location, TransportMode, APIResponse } from '@/src/lib/types';

// ============================================================================
// Request/Response Types
// ============================================================================

interface IsochroneRequest {
  location: Location;
  timeMinutes: number;
  transport: TransportMode;
  intervals?: number[]; // Additional time intervals (e.g., [5, 10, 15] for multi-ring isochrone)
}

// ============================================================================
// Helper Functions
// ============================================================================

function validateIsochroneRequest(body: unknown): body is IsochroneRequest {
  if (!body || typeof body !== 'object') {
    return false;
  }

  const req = body as Partial<IsochroneRequest>;

  // Validate location
  if (
    !req.location ||
    typeof req.location.lat !== 'number' ||
    typeof req.location.lng !== 'number' ||
    req.location.lat < -90 ||
    req.location.lat > 90 ||
    req.location.lng < -180 ||
    req.location.lng > 180
  ) {
    return false;
  }

  // Validate time
  if (
    typeof req.timeMinutes !== 'number' ||
    req.timeMinutes < 1 ||
    req.timeMinutes > 60
  ) {
    return false;
  }

  // Validate transport mode
  const validModes: TransportMode[] = ['walking', 'cycling', 'driving', 'public_transport'];
  if (!req.transport || !validModes.includes(req.transport)) {
    return false;
  }

  return true;
}

/**
 * Generate fallback isochrone when API is unavailable
 */
function generateFallbackIsochrone(
  location: Location,
  timeMinutes: number,
  transport: TransportMode
): IsochroneData {
  // Approximate speeds in m/s
  const speeds: Record<TransportMode, number> = {
    walking: 1.4, // 5 km/h
    cycling: 4.2, // 15 km/h
    driving: 13.9, // 50 km/h
    public_transport: 8.3, // 30 km/h
  };

  const radius = speeds[transport] * timeMinutes * 60; // meters
  const points = 32;
  const coordinates: number[][] = [];

  // Generate circular polygon
  for (let i = 0; i < points; i++) {
    const angle = (i * 2 * Math.PI) / points;
    const lat = location.lat + (radius / 111000) * Math.cos(angle);
    const lng =
      location.lng +
      (radius / (111000 * Math.cos((location.lat * Math.PI) / 180))) *
        Math.sin(angle);
    coordinates.push([lng, lat]);
  }

  // Close the polygon
  coordinates.push(coordinates[0]);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coordinates],
        },
        properties: {
          group_index: 0,
          value: timeMinutes * 60,
          center: [location.lng, location.lat],
        },
      },
    ],
    properties: {
      transportMode: transport,
      timeMinutes: timeMinutes,
      center: location,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/isochrone
 * Generate isochrone polygon for a location and time
 * 
 * @example
 * ```json
 * {
 *   "location": { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *   "timeMinutes": 15,
 *   "transport": "walking",
 *   "intervals": [5, 10, 15]
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<IsochroneData>>> {
  try {
    const body = await request.json();

    // Validate request
    if (!validateIsochroneRequest(body)) {
      return NextResponse.json(
        {
          success: false,
          error:
            'Invalid request. Provide location (with valid coordinates), timeMinutes (1-60), and transport mode.',
          timestamp: new Date().toISOString(),
        },
        { status: 400 }
      );
    }

    const { location, timeMinutes, transport, intervals } = body;

    // Handle edge case: location at (0,0) is likely invalid
    if (location.lat === 0 && location.lng === 0) {
      console.warn('[Isochrone] Invalid location (0,0), using fallback');
      const fallbackData = generateFallbackIsochrone(location, timeMinutes, transport);
      return NextResponse.json({
        success: true,
        data: fallbackData,
        message: 'Using fallback isochrone (invalid location)',
        timestamp: new Date().toISOString(),
      });
    }

    // Handle multiple transport modes (split by |)
    let transportMode = transport;
    if (typeof transport === 'string' && transport.includes('|')) {
      const modes = transport.split('|');
      transportMode = modes[0].trim() as TransportMode;
      console.log(`[Isochrone] Multiple modes detected, using: ${transportMode}`);
    }

    try {
      // Get ORS client
      const orsClient = getORSClient();

      // Build time ranges
      const timeRanges = intervals
        ? intervals.map(t => t * 60) // Convert to seconds
        : [timeMinutes * 60];

      // Get isochrone from ORS
      const orsResponse = await orsClient.getIsochrone({
        location,
        profile: transportMode,
        range: timeRanges,
        rangeType: 'time',
        attributes: ['area', 'reachfactor'],
      });

      // Convert ORS response to our IsochroneData format
      const isochroneData: IsochroneData = {
        type: 'FeatureCollection',
        features: orsResponse.features.map(feature => ({
          type: 'Feature',
          geometry: feature.geometry,
          properties: feature.properties,
        })),
        properties: {
          transportMode: transportMode,
          timeMinutes: timeMinutes,
          center: location,
          generatedAt: new Date().toISOString(),
        },
      };

      return NextResponse.json({
        success: true,
        data: isochroneData,
        timestamp: new Date().toISOString(),
      });
    } catch (apiError) {
      console.warn('[Isochrone] ORS API failed, using fallback:', apiError);

      // Use fallback when API fails
      const fallbackData = generateFallbackIsochrone(location, timeMinutes, transportMode);

      return NextResponse.json({
        success: true,
        data: fallbackData,
        message: 'Using fallback isochrone (API unavailable)',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('[Isochrone API] Error:', error);

    if (error instanceof ORSError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          details: {
            statusCode: error.statusCode,
            orsErrorCode: error.orsErrorCode,
          },
          timestamp: new Date().toISOString(),
        },
        { status: error.statusCode || 500 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : 'Failed to generate isochrone',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/isochrone
 * Health check endpoint
 */
export async function GET(): Promise<NextResponse<APIResponse<{ status: string }>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'Isochrone API is operational',
    },
    timestamp: new Date().toISOString(),
  });
}