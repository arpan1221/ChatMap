import { NextRequest, NextResponse } from 'next/server';
import { POI, Location, TransportMode } from '@/src/lib/types';

// OpenRouteService configuration
const ORS_API_KEY = process.env.ORS_API_KEY;
const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';

interface DurationRequest {
  pois: POI[];
  origin: Location;
  transportModes: TransportMode[];
}

interface DurationResponse {
  success: boolean;
  data?: POI[];
  error?: string;
  timestamp: string;
}

// Calculate durations for multiple transport modes
async function calculateMultiModalDurations(
  pois: POI[], 
  origin: Location, 
  transportModes: TransportMode[]
): Promise<POI[]> {
  if (!ORS_API_KEY) {
    throw new Error('OpenRouteService API key not configured');
  }

  const updatedPOIs = [...pois];
  
  // Process each transport mode
  for (const transportMode of transportModes) {
    try {
      // Map transport modes to ORS profiles
      const profileMap: Record<TransportMode, string> = {
        walking: 'foot-walking',
        driving: 'driving-car',
        cycling: 'cycling-regular',
        public_transport: 'driving-car' // ORS doesn't have public transport, use driving as approximation
      };
      
      const profile = profileMap[transportMode];
      if (!profile) continue;

      // Prepare destinations
      const destinations = pois.map(poi => [poi.lng, poi.lat]);
      
      // Make request to ORS Matrix API
      const response = await fetch(`${ORS_BASE_URL}/matrix/${profile}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ORS_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locations: [[origin.lng, origin.lat], ...destinations],
          sources: [0], // Origin is source
          destinations: Array.from({ length: destinations.length }, (_, i) => i + 1), // All POIs are destinations
          metrics: ['duration'],
          units: 'm'
        }),
      });

      if (!response.ok) {
        console.error(`ORS Matrix API error for ${transportMode}:`, response.status, response.statusText);
        continue;
      }

      const data = await response.json();
      
      if (data.durations && data.durations[0]) {
        const durations = data.durations[0];
        
        // Update POIs with duration information
        durations.forEach((duration: number, index: number) => {
          if (duration && duration > 0) {
            const poiIndex = updatedPOIs.findIndex(poi => 
              poi.lat === pois[index].lat && poi.lng === pois[index].lng
            );
            
            if (poiIndex !== -1) {
              if (!updatedPOIs[poiIndex].durations) {
                updatedPOIs[poiIndex].durations = {};
              }
              
              // Convert seconds to minutes
              updatedPOIs[poiIndex].durations![transportMode] = Math.round(duration / 60);
            }
          }
        });
      }
    } catch (error) {
      console.error(`Error calculating ${transportMode} durations:`, error);
      // Continue with other transport modes
    }
  }

  return updatedPOIs;
}

export async function POST(request: NextRequest) {
  try {
    const body: DurationRequest = await request.json();
    
    if (!body.pois || !body.origin || !body.transportModes) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Missing required fields: pois, origin, transportModes' 
        },
        { status: 400 }
      );
    }

    if (!ORS_API_KEY) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'OpenRouteService API key not configured' 
        },
        { status: 500 }
      );
    }

    // Calculate multi-modal durations
    const updatedPOIs = await calculateMultiModalDurations(
      body.pois,
      body.origin,
      body.transportModes
    );

    return NextResponse.json({
      success: true,
      data: updatedPOIs,
      timestamp: new Date().toISOString(),
    } as DurationResponse);

  } catch (error) {
    console.error('Duration calculation error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      } as DurationResponse,
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: 'Duration calculation API is healthy',
    timestamp: new Date().toISOString(),
  });
}
