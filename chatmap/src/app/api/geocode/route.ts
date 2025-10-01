/**
 * Geocode API Route
 * Convert addresses to geographic coordinates
 * Delegates to geocode use case
 */

import { NextRequest, NextResponse } from 'next/server';
import { geocode } from '@/src/usecases';
import type { APIResponse, Location } from '@/src/lib/types';
import { z } from 'zod';

// ============================================================================
// Request Validation
// ============================================================================

const GeocodeRequestSchema = z.object({
  address: z.string().min(2).max(500),
  countryCode: z.string().length(2).optional(),
  bounds: z
    .object({
      south: z.number().min(-90).max(90),
      west: z.number().min(-180).max(180),
      north: z.number().min(-90).max(90),
      east: z.number().min(-180).max(180),
    })
    .optional(),
  maxResults: z.number().min(1).max(50).optional().default(5),
  suggestions: z.boolean().optional().default(false), // For autocomplete
});

// ============================================================================
// API Route Handlers
// ============================================================================

/**
 * POST /api/geocode
 * Geocode an address to coordinates
 * 
 * @example
 * ```json
 * {
 *   "address": "Eiffel Tower, Paris",
 *   "countryCode": "FR",
 *   "maxResults": 3
 * }
 * ```
 */
export async function POST(
  request: NextRequest
): Promise<NextResponse<APIResponse<Location[]>>> {
  try {
    const body = await request.json();

    // Validate request
    const validation = GeocodeRequestSchema.safeParse(body);
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

    const { address, countryCode, bounds, maxResults, suggestions } = validation.data;

    // For autocomplete suggestions, use more results but limit to faster queries
    const effectiveMaxResults = suggestions ? 10 : maxResults;
    
    // For autocomplete, limit to faster queries by constraining search area
    // This helps avoid Nominatim timeouts on vague queries
    const optimizedParams = {
      address,
      countryCode: suggestions ? (countryCode || 'US') : countryCode, // Default to US for faster results
      bounds,
      maxResults: effectiveMaxResults,
    };

    // Call use case
    const result = await geocode(optimizedParams);

    // Handle error from use case
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Geocoding failed',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: result.error?.code === 'NO_RESULTS_FOUND' ? 404 : 500 }
      );
    }

    // Return success response
    // If suggestions=true, return in suggestions field for frontend compatibility
    if (suggestions) {
      return NextResponse.json({
        success: true,
        suggestions: result.data!.locations,
        metadata: {
          query: result.data!.query,
          resultCount: result.data!.resultCount,
          executionTimeMs: result.metadata?.executionTimeMs,
          apiCallsCount: result.metadata?.apiCallsCount,
        },
        timestamp: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      data: result.data!.locations,
      metadata: {
        query: result.data!.query,
        resultCount: result.data!.resultCount,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<Location[]>);
  } catch (error) {
    console.error('[Geocode API] Error:', error);

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
 * GET /api/geocode?address=...
 * Geocode via query parameters (convenience method)
 */
export async function GET(
  request: NextRequest
): Promise<NextResponse<APIResponse<Location[]>>> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const address = searchParams.get('address');
    const countryCode = searchParams.get('countryCode') || undefined;
    const maxResults = parseInt(searchParams.get('maxResults') || '5');

    if (!address) {
      return NextResponse.json(
        {
          success: false,
          error: 'Address parameter is required',
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: 400 }
      );
    }

    // Validate
    const validation = GeocodeRequestSchema.safeParse({
      address,
      countryCode,
      maxResults,
    });

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

    // Call use case
    const result = await geocode({
      address: validation.data.address,
      countryCode: validation.data.countryCode,
      maxResults: validation.data.maxResults,
    });

    // Handle error
    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error?.message || 'Geocoding failed',
          details: result.error?.details,
          timestamp: new Date().toISOString(),
        } as APIResponse,
        { status: result.error?.code === 'NO_RESULTS_FOUND' ? 404 : 500 }
      );
    }

    // Return success
    return NextResponse.json({
      success: true,
      data: result.data!.locations,
      metadata: {
        query: result.data!.query,
        resultCount: result.data!.resultCount,
        executionTimeMs: result.metadata?.executionTimeMs,
        apiCallsCount: result.metadata?.apiCallsCount,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<Location[]>);
  } catch (error) {
    console.error('[Geocode API] Error:', error);

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