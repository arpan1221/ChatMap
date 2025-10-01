/**
 * POIs API Route
 * Find Points of Interest within a time/distance constraint
 * Delegates to findPOIsWithinTime use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { findPOIsWithinTime } from '@/src/usecases';
import type { APIResponse, POI, POIType, TransportMode, Location } from '@/src/lib/types';
import { z } from 'zod';

// ============================================================================
// Request Validation
// ============================================================================

const LocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  display_name: z.string(),
  address: z.any().optional(),
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

const POIRequestSchema = z.object({
  location: LocationSchema,
  poiType: POITypeSchema,
  timeMinutes: z.number().min(1).max(120),
  transport: TransportModeSchema.optional().default('walking'),
  maxResults: z.number().optional().default(50),
  cuisine: z.string().optional(),
  sortBy: z.enum(['distance', 'rating', 'relevance']).optional().default('distance'),
  // Pagination
  page: z.number().optional().default(1),
  pageSize: z.number().optional().default(20),
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/pois
 * Find POIs within a time constraint
 * 
 * @example
 * ```json
 * {
 *   "location": { "lat": 51.5074, "lng": -0.1278, "display_name": "London" },
 *   "poiType": "restaurant",
 *   "timeMinutes": 15,
 *   "transport": "walking",
 *   "cuisine": "italian",
 *   "sortBy": "distance",
 *   "maxResults": 50
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<POI[]>>> {
  try {
    const body = await request.json();

    // Validate request
    const validation = POIRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid request parameters',
          details: validation.error.errors,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    const {
      location,
      poiType,
      timeMinutes,
      transport,
      maxResults,
      cuisine,
      sortBy,
      page,
      pageSize,
    } = validation.data;

    // Call use case
    const result = await findPOIsWithinTime({
      poiType,
      userLocation: location,
      timeMinutes,
      transport,
      maxResults,
      cuisine,
      sortBy,
    });

    // Handle error from use case
    if (!result.success) {
      // Handle no results as a successful response with empty data
      if (result.error?.code === 'NO_RESULTS_FOUND') {
        return NextResponse.json(
          {
            success: true,
            data: [],
            metadata: {
              totalFound: 0,
              returnedCount: 0,
              poiType,
              location: location.display_name,
              timeMinutes,
              transport,
              message: result.error.message,
            },
            timestamp: new Date().toISOString(),
          } as APIResponse<POI[]>
        );
      }
      
      // Other errors still return error status
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Failed to find POIs',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 500 }
      );
    }

    // Apply pagination to results
    const allPOIs = result.data!.pois;
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedPOIs = allPOIs.slice(startIndex, endIndex);
    const hasMore = endIndex < allPOIs.length;

    // Return success response
    return NextResponse.json({
      success: true,
      data: paginatedPOIs,
      metadata: {
        totalFound: result.data!.count,
        returnedCount: paginatedPOIs.length,
        poiType,
        location: location.display_name,
        timeMinutes,
        transport,
        isochrone: result.data!.isochrone,
        pagination: {
          page,
          pageSize,
          totalPages: Math.ceil(allPOIs.length / pageSize),
          hasMore,
          totalResults: allPOIs.length,
        },
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
        warnings: result.metadata?.warnings,
        clustered: result.data!.clustered,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<POI[]>);
  } catch (error) {
    console.error('[POIs API] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

/**
 * GET /api/pois
 * Health check and API information
 */
export async function GET(): Promise<NextResponse<APIResponse<unknown>>> {
  return NextResponse.json({
    success: true,
    data: {
      status: 'healthy',
      endpoint: '/api/pois',
      method: 'POST',
      supportedPOITypes: [
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
      ],
      supportedTransportModes: ['walking', 'driving', 'cycling', 'public_transport'],
      timeConstraints: {
        min: 1,
        max: 120,
        unit: 'minutes',
      },
      pagination: {
        defaultPageSize: 20,
        maxPageSize: 50,
      },
    },
    timestamp: new Date().toISOString(),
  } as APIResponse);
}