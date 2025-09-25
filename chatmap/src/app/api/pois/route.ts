import { NextRequest, NextResponse } from 'next/server';
import { POI, POIType, IsochroneData, Location, APIResponse } from '@/src/lib/types';
import * as turf from '@turf/turf';

// Overpass API configuration
const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';
const MAX_RESULTS = 50;

// POI type to OSM amenity mapping
const POI_TYPE_TO_OSM_AMENITY: Record<POIType, string[]> = {
  restaurant: ['restaurant', 'fast_food', 'food_court'],
  cafe: ['cafe', 'coffee_shop'],
  grocery: ['supermarket', 'convenience', 'grocery', 'marketplace'],
  pharmacy: ['pharmacy', 'chemist'],
  hospital: ['hospital', 'clinic', 'doctors', 'dentist'],
  school: ['school', 'university', 'college', 'kindergarten'],
  park: ['park', 'playground', 'recreation_ground'],
  gym: ['gym', 'fitness_center', 'sports_centre'],
  bank: ['bank', 'atm', 'bureau_de_change'],
  atm: ['atm'],
  gas_station: ['fuel'],
  shopping: ['shop', 'shopping_centre', 'mall'],
  entertainment: ['cinema', 'theatre', 'nightclub', 'bar', 'pub', 'casino'],
  transport: ['bus_station', 'taxi', 'car_rental', 'bicycle_rental'],
  accommodation: ['hotel', 'hostel', 'guest_house', 'motel'],
  other: ['toilets', 'waste_basket', 'bench', 'drinking_water', 'post_office'],
};

// Request interface
interface POIRequest {
  location: Location;
  poiType: POIType;
  isochroneData: IsochroneData;
  maxResults?: number;
  page?: number;
  pageSize?: number;
  keywords?: string[];
  cuisine?: string;
  priceRange?: string;
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

function validateIsochroneData(isochroneData: IsochroneData): { isValid: boolean; error?: string } {
  if (!isochroneData || isochroneData.type !== 'FeatureCollection') {
    return { isValid: false, error: 'Valid isochrone data is required' };
  }

  if (!isochroneData.features || isochroneData.features.length === 0) {
    return { isValid: false, error: 'Isochrone data must contain at least one feature' };
  }

  return { isValid: true };
}

function validatePOIType(poiType: POIType): { isValid: boolean; error?: string } {
  const validTypes: POIType[] = Object.keys(POI_TYPE_TO_OSM_AMENITY) as POIType[];
  
  if (!validTypes.includes(poiType)) {
    return { 
      isValid: false, 
      error: `POI type must be one of: ${validTypes.join(', ')}` 
    };
  }

  return { isValid: true };
}

// ============================================================================
// OVERPASS API QUERY GENERATION
// ============================================================================

function generateOverpassQuery(
  location: Location,
  poiType: POIType,
  bbox: { north: number; south: number; east: number; west: number }
): string {
  const amenities = POI_TYPE_TO_OSM_AMENITY[poiType];
  
  // Build node queries for each amenity
  const nodeQueries = amenities.map(amenity => 
    `node["amenity"="${amenity}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east})`
  ).join(';');
  
  // Build way queries for each amenity
  const wayQueries = amenities.map(amenity => 
    `way["amenity"="${amenity}"](${bbox.south},${bbox.west},${bbox.north},${bbox.east})`
  ).join(';');
  
  // Additional filters for specific POI types
  let additionalQueries = '';
  if (poiType === 'shopping') {
    additionalQueries = `;node["shop"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["shop"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  } else if (poiType === 'entertainment') {
    additionalQueries = `;node["leisure"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["leisure"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});node["tourism"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["tourism"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  } else if (poiType === 'accommodation') {
    additionalQueries = `;node["tourism"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east});way["tourism"~"."](${bbox.south},${bbox.west},${bbox.north},${bbox.east})`;
  }

  const query = `
[out:json][timeout:25];
(
  ${nodeQueries};
  ${wayQueries};${additionalQueries}
);
out center meta;
`;

  return query.trim();
}

// ============================================================================
// BOUNDING BOX CALCULATION
// ============================================================================

function calculateBoundingBox(isochroneData: IsochroneData): { north: number; south: number; east: number; west: number } {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  for (const feature of isochroneData.features) {
    if (feature.geometry.type === 'Polygon') {
      const coords = (feature.geometry.coordinates as number[][][])[0]; // Exterior ring
      for (const coord of coords) {
        const [lng, lat] = coord as [number, number];
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }
    } else if (feature.geometry.type === 'MultiPolygon') {
      for (const polygon of feature.geometry.coordinates as number[][][]) {
        const coords = polygon[0] as unknown as number[][]; // Exterior ring
        for (const coord of coords) {
          const [lng, lat] = coord as [number, number];
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
        }
      }
    }
  }

  // Add small buffer to ensure we don't miss POIs at the edges
  const buffer = 0.001; // ~100m buffer
  return {
    north: maxLat + buffer,
    south: minLat - buffer,
    east: maxLng + buffer,
    west: minLng - buffer,
  };
}

// ============================================================================
// OVERPASS API INTEGRATION
// ============================================================================

async function fetchPOIsFromOverpass(
  location: Location,
  poiType: POIType,
  isochroneData: IsochroneData
): Promise<any[]> {
  const bbox = calculateBoundingBox(isochroneData);
  const query = generateOverpassQuery(location, poiType, bbox);

  console.log('Overpass query:', query);
  console.log('Bounding box:', bbox);

  try {
    const response = await fetch(OVERPASS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(30000), // 30 second timeout
    });

    if (!response.ok) {
      throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.elements || !Array.isArray(data.elements)) {
      throw new Error('Invalid response format from Overpass API');
    }

    return data.elements;

  } catch (error) {
    console.error('Overpass API error:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('timeout')) {
        throw new Error('Request timeout. Please try again with a smaller search area.');
      }
      if (error.message.includes('429')) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      if (error.message.includes('500')) {
        throw new Error('Overpass API server error. Please try again later.');
      }
    }
    
    throw error;
  }
}

// ============================================================================
// POI PROCESSING AND FILTERING
// ============================================================================

function processOverpassElement(element: any, poiType: POIType): POI | null {
  // Extract coordinates
  let lat: number, lng: number;
  
  if (element.type === 'node') {
    lat = element.lat;
    lng = element.lon;
  } else if (element.type === 'way' || element.type === 'relation') {
    if (element.center) {
      lat = element.center.lat;
      lng = element.center.lon;
    } else {
      return null; // Skip if no center coordinates
    }
  } else {
    return null; // Skip unknown element types
  }

  // Extract name
  const name = element.tags?.name || 
               element.tags?.brand || 
               element.tags?.operator || 
               `${poiType} (${element.id})`;

  // Extract relevant tags
  const tags: Record<string, string | number | boolean> = {};
  if (element.tags) {
    for (const [key, value] of Object.entries(element.tags)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        tags[key] = value;
      }
    }
  }

  // Determine specific POI type from tags
  let specificType = poiType;
  if (element.tags?.amenity) {
    const amenity = element.tags.amenity;
    if (amenity === 'fast_food') specificType = 'restaurant';
    else if (amenity === 'coffee_shop') specificType = 'cafe';
    else if (amenity === 'supermarket' || amenity === 'convenience') specificType = 'grocery';
    else if (amenity === 'hospital' || amenity === 'clinic') specificType = 'hospital';
    else if (amenity === 'school' || amenity === 'university') specificType = 'school';
    else if (amenity === 'park' || amenity === 'playground') specificType = 'park';
    else if (amenity === 'gym' || amenity === 'fitness_center') specificType = 'gym';
    else if (amenity === 'bank' || amenity === 'atm') specificType = 'bank';
    else if (amenity === 'fuel') specificType = 'gas_station';
    else if (amenity === 'shop') specificType = 'shopping';
    else if (amenity === 'cinema' || amenity === 'theatre' || amenity === 'bar') specificType = 'entertainment';
    else if (amenity === 'hotel' || amenity === 'hostel') specificType = 'accommodation';
  }

  return {
    id: element.id.toString(),
    name,
    type: specificType,
    lat,
    lng,
    tags,
    address: element.tags?.['addr:full'] || 
             `${element.tags?.['addr:street'] || ''} ${element.tags?.['addr:housenumber'] || ''}`.trim() ||
             undefined,
    phone: element.tags?.phone,
    website: element.tags?.website,
    openingHours: element.tags?.['opening_hours'],
  };
}

function filterPOIsByKeywords(pois: POI[], keywords: string[], cuisine?: string): POI[] {
  return pois.filter(poi => {
    const searchText = [
      poi.name,
      poi.tags?.cuisine,
      poi.tags?.brand,
      poi.tags?.operator,
      poi.tags?.amenity,
      poi.tags?.shop,
      poi.tags?.leisure,
      poi.tags?.tourism,
    ].filter(Boolean).join(' ').toLowerCase();

    // Check if any keyword matches (if keywords provided)
    const keywordMatch = !keywords || keywords.length === 0 || keywords.some(keyword => 
      searchText.includes(keyword.toLowerCase())
    );

    // Check cuisine match if specified
    const cuisineMatch = !cuisine || cuisine === 'none' || 
      (typeof poi.tags?.cuisine === 'string' && poi.tags.cuisine.toLowerCase().includes(cuisine.toLowerCase())) ||
      searchText.includes(cuisine.toLowerCase());

    return keywordMatch && cuisineMatch;
  });
}

function filterPOIsWithinIsochrone(pois: POI[], isochroneData: IsochroneData): POI[] {
  if (!isochroneData.features || isochroneData.features.length === 0) {
    return pois;
  }

  // Create a combined polygon from all isochrone features
  const isochronePolygons = isochroneData.features
    .filter(feature => feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon')
    .map(feature => turf.feature(feature.geometry as any));

  if (isochronePolygons.length === 0) {
    return pois;
  }

  // Combine all polygons into one
  let combinedPolygon = isochronePolygons[0];
  for (let i = 1; i < isochronePolygons.length; i++) {
    const unionResult = turf.union(combinedPolygon as any, isochronePolygons[i] as any);
    if (unionResult) {
      combinedPolygon = unionResult;
    }
  }

  // Filter POIs that are within the isochrone
  const filteredPOIs: POI[] = [];

  for (const poi of pois) {
    const poiPoint = turf.point([poi.lng, poi.lat]);
    
    // Check if POI is within any of the isochrone polygons
    let isWithin = false;
    for (const polygon of isochronePolygons) {
      if (turf.booleanPointInPolygon(poiPoint, polygon as any)) {
        isWithin = true;
        break;
      }
    }

    if (isWithin) {
      // Calculate distance to center (approximate)
      const center = isochroneData.properties?.center;
      if (center) {
        const centerPoint = turf.point([center.lng, center.lat]);
        const distance = turf.distance(poiPoint, centerPoint, { units: 'meters' });
        poi.distance = Math.round(distance);
        
        // Estimate walk time (assuming 1.4 m/s walking speed)
        poi.walkTime = Math.round(distance / 1.4 / 60); // Convert to minutes
      }
      
      filteredPOIs.push(poi);
    }
  }

  return filteredPOIs;
}

// ============================================================================
// API ROUTE HANDLER
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    console.log('POIs API: Starting request processing');
    const body: POIRequest = await request.json();
    console.log('POIs API: Request body parsed:', body);
    
    // Validate required fields
    console.log('POIs API: Validating required fields');
    console.log('POIs API: body.location:', !!body.location);
    console.log('POIs API: body.poiType:', body.poiType);
    console.log('POIs API: body.isochroneData:', !!body.isochroneData);
    
    if (!body.location || !body.poiType || !body.isochroneData) {
      console.log('POIs API: Missing required fields - location:', !!body.location, 'poiType:', !!body.poiType, 'isochroneData:', !!body.isochroneData);
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: location, poiType, isochroneData',
        } as APIResponse,
        { status: 400 }
      );
    }

    // Extract pagination parameters
    const page = body.page || 1;
    const pageSize = Math.min(body.pageSize || 20, 50); // Max 50 per page
    const maxResults = Math.min(body.maxResults || MAX_RESULTS, 200); // Max 200 total

    // Validate input parameters
    const locationValidation = validateLocation(body.location);
    if (!locationValidation.isValid) {
      console.log('POIs API: Location validation failed:', locationValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: locationValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const isochroneValidation = validateIsochroneData(body.isochroneData);
    if (!isochroneValidation.isValid) {
      console.log('POIs API: Isochrone validation failed:', isochroneValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: isochroneValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    const poiTypeValidation = validatePOIType(body.poiType);
    if (!poiTypeValidation.isValid) {
      console.log('POIs API: POI type validation failed:', poiTypeValidation.error);
      return NextResponse.json(
        {
          success: false,
          error: poiTypeValidation.error,
        } as APIResponse,
        { status: 400 }
      );
    }

    // Fetch POIs from Overpass API
    const overpassElements = await fetchPOIsFromOverpass(
      body.location,
      body.poiType,
      body.isochroneData
    );

    // Process and filter POIs
    const allPOIs = overpassElements
      .map(element => processOverpassElement(element, body.poiType))
      .filter((poi): poi is POI => poi !== null);

    // Filter POIs by keywords and cuisine
    console.log('POI filtering - Keywords:', body.keywords, 'Cuisine:', body.cuisine);
    console.log('Total POIs before filtering:', allPOIs.length);
    const keywordFilteredPOIs = filterPOIsByKeywords(allPOIs, body.keywords || [], body.cuisine);
    console.log('POIs after keyword/cuisine filtering:', keywordFilteredPOIs.length);

    // Filter POIs within isochrone
    const filteredPOIs = filterPOIsWithinIsochrone(keywordFilteredPOIs, body.isochroneData);

    // Sort by distance
    const sortedPOIs = filteredPOIs
      .sort((a, b) => (a.distance || 0) - (b.distance || 0));

    // Apply pagination
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    const paginatedPOIs = sortedPOIs.slice(startIndex, endIndex);

    // Check if there are more results
    const hasMore = endIndex < Math.min(sortedPOIs.length, maxResults);

    return NextResponse.json({
      success: true,
      data: paginatedPOIs,
      metadata: {
        totalFound: allPOIs.length,
        filteredCount: filteredPOIs.length,
        returnedCount: paginatedPOIs.length,
        poiType: body.poiType,
        location: body.location.display_name,
        pagination: {
          page,
          pageSize,
          totalPages: Math.ceil(Math.min(sortedPOIs.length, maxResults) / pageSize),
          hasMore,
          totalResults: Math.min(sortedPOIs.length, maxResults),
        },
      },
      timestamp: new Date().toISOString(),
    } as APIResponse<POI[]>);

  } catch (error) {
    console.error('POIs API error:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    
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
    message: 'POIs API is healthy',
    overpass: {
      baseUrl: OVERPASS_API_URL,
      maxResults: MAX_RESULTS,
    },
    supportedPOITypes: Object.keys(POI_TYPE_TO_OSM_AMENITY),
    timestamp: new Date().toISOString(),
  } as APIResponse);
}
