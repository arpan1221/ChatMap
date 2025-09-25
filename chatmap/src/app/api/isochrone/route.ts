import { NextRequest, NextResponse } from 'next/server';
import { IsochroneData, Location, TransportMode, APIResponse } from '@/src/lib/types';

// OpenRouteService configuration
const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';

// Transport mode mapping
const TRANSPORT_MODE_MAP: Record<TransportMode, string> = {
  walking: 'foot-walking',
  cycling: 'cycling-regular',
  driving: 'driving-car',
  public_transport: 'driving-car', // Fallback to driving for now
};

// Request interface
interface IsochroneRequest {
  location: Location;
  timeMinutes: number;
  transport: TransportMode;
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

function validateLocation(location: Location): { isValid: boolean; error?: string } {
  if (!location || typeof location !== 'object') {
    return { isValid: false, error: 'Location is required' };
  }

  const { lat, lng, display_name } = location;

  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { isValid: false, error: 'Latitude and longitude must be numbers' };
  }

  if (lat < -90 || lat > 90) {
    return { isValid: false, error: 'Latitude must be between -90 and 90' };
  }

  if (lng < -180 || lng > 180) {
    return { isValid: false, error: 'Longitude must be between -180 and 180' };
  }

  if (!display_name || typeof display_name !== 'string') {
    return { isValid: false, error: 'Display name is required' };
  }

  return { isValid: true };
}

function validateTimeMinutes(timeMinutes: number): { isValid: boolean; error?: string } {
  if (typeof timeMinutes !== 'number') {
    return { isValid: false, error: 'Time must be a number' };
  }

  if (timeMinutes < 1 || timeMinutes > 60) {
    return { isValid: false, error: 'Time must be between 1 and 60 minutes' };
  }

  return { isValid: true };
}

function validateTransport(transport: TransportMode): { isValid: boolean; error?: string } {
  const validModes: TransportMode[] = ['walking', 'cycling', 'driving', 'public_transport'];
  
  if (!validModes.includes(transport)) {
    return { 
      isValid: false, 
      error: `Transport mode must be one of: ${validModes.join(', ')}` 
    };
  }

  return { isValid: true };
}

// ============================================================================
// OPENROUTESERVICE API INTEGRATION
// ============================================================================

async function fetchIsochrone(
  location: Location,
  timeMinutes: number,
  transport: TransportMode
): Promise<IsochroneData> {
  if (!ORS_API_KEY) {
    throw new Error('OpenRouteService API key is not configured. Please set ORS_API_KEY in your environment variables.');
  }

  const orsProfile = TRANSPORT_MODE_MAP[transport];
  const timeSeconds = timeMinutes * 60; // Convert minutes to seconds

  const requestBody = {
    locations: [[location.lng, location.lat]], // ORS expects [lng, lat] format
    range: [timeSeconds],
    range_type: 'time',
    options: {
      avoid_features: transport === 'driving' ? ['tollways'] : [],
    },
  };

  try {
    console.log('Making request to OpenRouteService:', {
      url: `${ORS_BASE_URL}/isochrones/${orsProfile}`,
      body: requestBody,
      headers: {
        'Authorization': `Bearer ${ORS_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      }
    });
    
    const response = await fetch(`${ORS_BASE_URL}/isochrones/${orsProfile}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ORS_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/geo+json;charset=UTF-8',
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });
    
    console.log('OpenRouteService response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `OpenRouteService API error: ${response.status}`;
      
      try {
        const errorData = JSON.parse(errorText);
        errorMessage = errorData.error?.message || errorMessage;
      } catch {
        // Use default error message if parsing fails
      }

      console.error('OpenRouteService API error:', {
        status: response.status,
        statusText: response.statusText,
        errorText: errorText,
        url: `${ORS_BASE_URL}/isochrones/${orsProfile}`,
        requestBody: requestBody
      });

      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    console.log('OpenRouteService response:', JSON.stringify(data, null, 2));
    
    // Validate response structure
    if (!data) {
      console.error('No data received from OpenRouteService');
      throw new Error('No data received from OpenRouteService');
    }
    
    // Check if it's a valid GeoJSON FeatureCollection
    if (data.type !== 'FeatureCollection') {
      console.error('Invalid response format from OpenRouteService:', data);
      // Try to handle different response formats
      if (data.features && Array.isArray(data.features)) {
        console.log('Response has features array, treating as valid GeoJSON');
      } else {
        // Throw an error for invalid response format
        throw new Error(`Invalid response format: ${JSON.stringify(data).substring(0, 500)}...`);
      }
    }

    // Add metadata to the isochrone data
    const isochroneData: IsochroneData = {
      ...data,
      properties: {
        transportMode: transport,
        timeMinutes: timeMinutes,
        center: location,
        generatedAt: new Date().toISOString(),
      },
    };

    return isochroneData;

  } catch (error) {
    console.error('OpenRouteService API error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error('Request timeout. Please try again with a shorter time limit.');
      }
      if (error.message.includes('401') || error.message.includes('403')) {
        throw new Error('Invalid API key. Please check your OpenRouteService API key.');
      }
      if (error.message.includes('429')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.message.includes('500')) {
        throw new Error('OpenRouteService server error. Please try again later.');
      }
    }
    
    throw error;
  }
}

// ============================================================================
// FALLBACK ISOCHRONE GENERATION
// ============================================================================

function generateFallbackIsochrone(
  location: Location,
  timeMinutes: number,
  transport: TransportMode
): IsochroneData {
  // Create a simple circular isochrone as fallback
  const radius = getFallbackRadius(timeMinutes, transport);
  const center = [location.lng, location.lat];
  
  // Generate a simple circle polygon (approximation)
  const points = 32;
  const coordinates: number[][] = [];
  
  for (let i = 0; i < points; i++) {
    const angle = (i * 2 * Math.PI) / points;
    const lat = location.lat + (radius / 111000) * Math.cos(angle); // Rough conversion: 1 degree ≈ 111km
    const lng = location.lng + (radius / (111000 * Math.cos(location.lat * Math.PI / 180))) * Math.sin(angle);
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
          center: center,
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

function getFallbackRadius(timeMinutes: number, transport: TransportMode): number {
  // Rough estimates in meters
  const speeds = {
    walking: 1.4, // m/s (5 km/h)
    cycling: 4.2, // m/s (15 km/h)
    driving: 13.9, // m/s (50 km/h)
    public_transport: 8.3, // m/s (30 km/h)
  };
  
  const speed = speeds[transport];
  return speed * timeMinutes * 60; // Convert to meters
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    console.log('Isochrone API: Starting request processing');
    const body: IsochroneRequest = await request.json();
    console.log('Isochrone API: Request body parsed:', body);
    
    // Validate required fields
    console.log('Isochrone API: Validating required fields');
    console.log('Isochrone API: body.location:', body.location);
    console.log('Isochrone API: body.timeMinutes:', body.timeMinutes);
    console.log('Isochrone API: body.transport:', body.transport);
    
    if (!body.location || !body.timeMinutes || !body.transport) {
      console.log('Isochrone API: Missing required fields - location:', !!body.location, 'timeMinutes:', !!body.timeMinutes, 'transport:', !!body.transport);
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: location, timeMinutes, transport',
        } as APIResponse,
        { status: 400 }
      );
    }

    // Validate input parameters
    const locationValidation = validateLocation(body.location);
    if (!locationValidation.isValid) {
      console.log('Isochrone API: Location validation failed:', locationValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: locationValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const timeValidation = validateTimeMinutes(body.timeMinutes);
    if (!timeValidation.isValid) {
      console.log('Isochrone API: Time validation failed:', timeValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: timeValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    // Handle multiple transport modes (e.g., "walking|driving")
    let transportMode: TransportMode;
    if (typeof body.transport === 'string' && body.transport.includes('|')) {
      // If multiple modes are provided, use the first one
      const modes = body.transport.split('|').map(m => m.trim());
      transportMode = modes[0] as TransportMode;
      console.log(`Multiple transport modes detected: ${body.transport}, using: ${transportMode}`);
    } else {
      transportMode = body.transport as TransportMode;
    }

    const transportValidation = validateTransport(transportMode);
    if (!transportValidation.isValid) {
      console.log('Isochrone API: Transport validation failed:', transportValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: transportValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    // Check if API key is configured
    console.log('ORS_API_KEY:', ORS_API_KEY ? 'SET' : 'NOT SET');
    if (!ORS_API_KEY) {
      console.warn('OpenRouteService API key not configured, using fallback isochrone');
      const fallbackData = generateFallbackIsochrone(
        body.location,
        body.timeMinutes,
        transportMode
      );
      
      return NextResponse.json({
        success: true,
        data: fallbackData,
        message: 'Using fallback isochrone (API key not configured)',
        timestamp: new Date().toISOString(),
      } as APIResponse<IsochroneData>);
    }



    // Check if location is (0,0) which causes API to fail
    if (body.location.lat === 0 && body.location.lng === 0) {
      console.warn('Invalid location (0,0) detected, using fallback isochrone');
      const fallbackData = generateFallbackIsochrone(
        body.location,
        body.timeMinutes,
        transportMode
      );
      
      return NextResponse.json({
        success: true,
        data: fallbackData,
        message: 'Using fallback isochrone (invalid location)',
        timestamp: new Date().toISOString(),
      } as APIResponse<IsochroneData>);
    }

    try {
      // Fetch isochrone from OpenRouteService
      const isochroneData = await fetchIsochrone(
        body.location,
        body.timeMinutes,
        transportMode
      );

      return NextResponse.json({
        success: true,
        data: isochroneData,
        timestamp: new Date().toISOString(),
      } as APIResponse<IsochroneData>);
    } catch (apiError) {
      console.warn('OpenRouteService API failed, using fallback isochrone:', apiError);
      
      // Use fallback isochrone when API fails
      const fallbackData = generateFallbackIsochrone(
        body.location,
        body.timeMinutes,
        transportMode
      );
      
      return NextResponse.json({
        success: true,
        data: fallbackData,
        message: 'Using fallback isochrone (API failed)',
        timestamp: new Date().toISOString(),
      } as APIResponse<IsochroneData>);
    }

  } catch (error) {
    console.error('Isochrone API error:', error);
    
    let errorMessage = 'Unknown error occurred';
    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === 'string') {
      errorMessage = error;
    } else if (error && typeof error === 'object') {
      errorMessage = JSON.stringify(error);
    }
    
    // Add debugging information
    const debugInfo = {
      error: errorMessage,
      errorType: typeof error,
      errorConstructor: error?.constructor?.name,
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
    };
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        debug: debugInfo,
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
  const hasApiKey = !!ORS_API_KEY;
  
  return NextResponse.json({
    success: true,
    message: 'Isochrone API is healthy',
    openrouteservice: {
      configured: hasApiKey,
      baseUrl: ORS_BASE_URL,
    },
    transportModes: Object.keys(TRANSPORT_MODE_MAP),
    timestamp: new Date().toISOString(),
  } as APIResponse);
}
