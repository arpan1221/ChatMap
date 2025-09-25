import { NextRequest, NextResponse } from 'next/server';
import { Location, APIResponse, NominatimResponse } from '@/src/lib/types';

// Nominatim API configuration
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'ChatMap/1.0 (https://github.com/yourusername/chatmap)';

// Request interface
interface GeocodeRequest {
  address: string;
  suggestions?: boolean;
  limit?: number;
  countryCode?: string;
  viewbox?: {
    north: number;
    south: number;
    east: number;
    west: number;
  };
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

function validateAddress(address: string): { isValid: boolean; error?: string } {
  if (!address || typeof address !== 'string') {
    return { isValid: false, error: 'Address is required' };
  }

  if (address.trim().length < 2) {
    return { isValid: false, error: 'Address must be at least 2 characters long' };
  }

  if (address.length > 200) {
    return { isValid: false, error: 'Address must be less than 200 characters' };
  }

  return { isValid: true };
}

function validateLimit(limit: number | undefined): { isValid: boolean; error?: string } {
  if (limit !== undefined) {
    if (typeof limit !== 'number' || limit < 1 || limit > 10) {
      return { isValid: false, error: 'Limit must be between 1 and 10' };
    }
  }

  return { isValid: true };
}

function validateViewbox(viewbox: GeocodeRequest['viewbox']): { isValid: boolean; error?: string } {
  if (!viewbox) {
    return { isValid: true };
  }

  const { north, south, east, west } = viewbox;

  if (typeof north !== 'number' || typeof south !== 'number' || 
      typeof east !== 'number' || typeof west !== 'number') {
    return { isValid: false, error: 'Viewbox coordinates must be numbers' };
  }

  if (north <= south) {
    return { isValid: false, error: 'North must be greater than south' };
  }

  if (east <= west) {
    return { isValid: false, error: 'East must be greater than west' };
  }

  if (north > 90 || south < -90) {
    return { isValid: false, error: 'Latitude must be between -90 and 90' };
  }

  if (east > 180 || west < -180) {
    return { isValid: false, error: 'Longitude must be between -180 and 180' };
  }

  return { isValid: true };
}

// ============================================================================
// NOMINATIM API INTEGRATION
// ============================================================================

async function geocodeAddress(
  address: string,
  limit: number = 5,
  countryCode?: string,
  viewbox?: GeocodeRequest['viewbox']
): Promise<NominatimResponse[]> {
  const params = new URLSearchParams({
    q: address,
    format: 'json',
    limit: limit.toString(),
    addressdetails: '1',
    extratags: '1',
    namedetails: '1',
    dedupe: '1',
  });

  if (countryCode) {
    params.append('countrycodes', countryCode);
  }

  if (viewbox) {
    const { north, south, east, west } = viewbox;
    params.append('viewbox', `${west},${south},${east},${north}`);
    params.append('bounded', '1');
  }

  try {
    const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status} ${response.statusText}`);
    }

    const data: NominatimResponse[] = await response.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from Nominatim API');
    }

    return data;

  } catch (error) {
    console.error('Nominatim API error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error('Request timeout. Please try again with a more specific query.');
      }
      if (error.message.includes('429')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.message.includes('500')) {
        throw new Error('Nominatim server error. Please try again later.');
      }
    }
    
    throw error;
  }
}

// ============================================================================
// RESPONSE PROCESSING
// ============================================================================

function processNominatimResponse(nominatimData: NominatimResponse[]): Location[] {
  return nominatimData.map((item, index) => {
    // Extract coordinates
    const lat = parseFloat(item.lat);
    const lng = parseFloat(item.lon);

    // Build display name from address components
    const address = item.address;
    let displayName = item.display_name;

    // Try to create a more concise display name
    if (address) {
      const parts = [];
      
      if (address.house_number && address.road) {
        parts.push(`${address.house_number} ${address.road}`);
      } else if (address.road) {
        parts.push(address.road);
      }
      
      if (address.suburb) {
        parts.push(address.suburb);
      } else if (address.city) {
        parts.push(address.city);
      } else if (address.county) {
        parts.push(address.county);
      }
      
      if (address.state) {
        parts.push(address.state);
      }
      
      if (address.country) {
        parts.push(address.country);
      }

      if (parts.length > 0) {
        displayName = parts.join(', ');
      }
    }

    // Add ranking information for better sorting
    const ranking = item.place_rank || 0;
    const importance = item.importance || 0;

    return {
      lat,
      lng,
      display_name: displayName,
      // Additional metadata for sorting and filtering
      metadata: {
        place_id: item.place_id,
        osm_type: item.osm_type,
        osm_id: item.osm_id,
        place_rank: ranking,
        importance: importance,
        address: item.address,
        boundingbox: item.boundingbox,
        licence: item.licence,
        type: item.type,
        class: item.class,
      },
    } as Location & { metadata: any };
  });
}

// ============================================================================
// FALLBACK GEOCODING
// ============================================================================

function generateFallbackLocation(address: string): Location {
  // Simple fallback for common patterns
  const commonPatterns = [
    { pattern: /new york|nyc|manhattan/i, lat: 40.7128, lng: -74.0060, name: 'New York, NY' },
    { pattern: /london/i, lat: 51.5074, lng: -0.1278, name: 'London, UK' },
    { pattern: /paris/i, lat: 48.8566, lng: 2.3522, name: 'Paris, France' },
    { pattern: /tokyo/i, lat: 35.6762, lng: 139.6503, name: 'Tokyo, Japan' },
    { pattern: /san francisco|sf/i, lat: 37.7749, lng: -122.4194, name: 'San Francisco, CA' },
    { pattern: /los angeles|la/i, lat: 34.0522, lng: -118.2437, name: 'Los Angeles, CA' },
    { pattern: /chicago/i, lat: 41.8781, lng: -87.6298, name: 'Chicago, IL' },
    { pattern: /boston/i, lat: 42.3601, lng: -71.0589, name: 'Boston, MA' },
    { pattern: /seattle/i, lat: 47.6062, lng: -122.3321, name: 'Seattle, WA' },
    { pattern: /miami/i, lat: 25.7617, lng: -80.1918, name: 'Miami, FL' },
  ];

  for (const pattern of commonPatterns) {
    if (pattern.pattern.test(address)) {
      return {
        lat: pattern.lat,
        lng: pattern.lng,
        display_name: pattern.name,
        metadata: {
          fallback: true,
          original_query: address,
        },
      } as Location & { metadata: any };
    }
  }

  // Default fallback to center of world
  return {
    lat: 0,
    lng: 0,
    display_name: `Unknown location: ${address}`,
    metadata: {
      fallback: true,
      original_query: address,
      error: 'Location not found',
    },
  } as Location & { metadata: any };
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    const body: GeocodeRequest = await request.json();
    
    // Validate required fields
    if (!body.address) {
      return NextResponse.json(
        {
          success: false,
          error: 'Address is required',
        } as APIResponse,
        { status: 400 }
      );
    }

    // Validate input parameters
    const addressValidation = validateAddress(body.address);
    if (!addressValidation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: addressValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const limitValidation = validateLimit(body.limit);
    if (!limitValidation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: limitValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const viewboxValidation = validateViewbox(body.viewbox);
    if (!viewboxValidation.isValid) {
      return NextResponse.json(
        {
          success: false,
          error: viewboxValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const limit = body.limit || (body.suggestions ? 8 : 5);

    // Geocode address using Nominatim
    const nominatimData = await geocodeAddress(
      body.address,
      limit,
      body.countryCode,
      body.viewbox
    );

    // Process and return results
    const locations = processNominatimResponse(nominatimData);

    // If suggestions mode, return suggestions array
    if (body.suggestions) {
      return NextResponse.json({
        success: true,
        suggestions: locations,
        metadata: {
          totalFound: locations.length,
          fallbackUsed: false,
          originalQuery: body.address,
          countryCode: body.countryCode,
          viewbox: body.viewbox,
        },
        timestamp: new Date().toISOString(),
      } as APIResponse<Location[]> & { suggestions: Location[] });
    }

    // If no results found, try fallback
    if (locations.length === 0) {
      const fallbackLocation = generateFallbackLocation(body.address);
      return NextResponse.json({
        success: true,
        location: fallbackLocation,
        message: 'No exact matches found, using fallback location',
        metadata: {
          totalFound: 0,
          fallbackUsed: true,
          originalQuery: body.address,
        },
        timestamp: new Date().toISOString(),
      } as APIResponse<Location> & { location: Location });
    }

    // Return single location for regular geocoding
    return NextResponse.json({
      success: true,
      location: locations[0],
      metadata: {
        totalFound: locations.length,
        fallbackUsed: false,
        originalQuery: body.address,
        countryCode: body.countryCode,
        viewbox: body.viewbox,
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<Location> & { location: Location });

  } catch (error) {
    console.error('Geocode API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    // Try fallback on error
    try {
      const body: GeocodeRequest = await request.json();
      if (body.address) {
        const fallbackLocation = generateFallbackLocation(body.address);
        return NextResponse.json({
          success: true,
          location: fallbackLocation,
          message: 'Using fallback location due to API error',
          warning: errorMessage,
          metadata: {
            totalFound: 0,
            fallbackUsed: true,
            originalQuery: body.address,
          },
          timestamp: new Date().toISOString(),
        } as APIResponse<Location> & { location: Location });
      }
    } catch {
      // Fallback failed, return error
    }
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      } as APIResponse,
      { status: 500 }
    );
  }
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Geocode API is healthy',
    nominatim: {
      baseUrl: NOMINATIM_BASE_URL,
      userAgent: USER_AGENT,
    },
    features: {
      fallbackLocations: true,
      viewboxFiltering: true,
      countryCodeFiltering: true,
      addressDetails: true,
    },
    timestamp: new Date().toISOString(),
  } as APIResponse);
}
