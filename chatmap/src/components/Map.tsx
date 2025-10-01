'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { MapContainer, TileLayer, Marker, Popup, Polygon, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { MapState, Location, POI, IsochroneData, MapComponentProps, LocationFrequency, RouteInfo } from '@/src/lib/types';
import 'leaflet/dist/leaflet.css';

// Fix for default markers in react-leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom POI icons based on type
const createPOIIcon = (poiType: string, isSelected: boolean = false, isPreferred: boolean = false) => {
  const colors = {
    restaurant: '#e74c3c',
    cafe: '#f39c12',
    grocery: '#27ae60',
    pharmacy: '#9b59b6',
    hospital: '#e67e22',
    school: '#3498db',
    park: '#2ecc71',
    gym: '#e91e63',
    bank: '#34495e',
    atm: '#95a5a6',
    gas_station: '#f1c40f',
    shopping: '#8e44ad',
    entertainment: '#e74c3c',
    transport: '#16a085',
    accommodation: '#2980b9',
    other: '#7f8c8d',
  };

  const baseColor = colors[poiType as keyof typeof colors] || colors.other;
  const color = isPreferred ? '#ff915f' : baseColor;
  const size = isSelected ? 26 : isPreferred ? 23 : 20;
  const borderWidth = isSelected ? 3 : isPreferred ? 3 : 2;
  const boxShadow = isSelected
    ? '0 2px 10px rgba(231, 76, 60, 0.5)'
    : isPreferred
    ? '0 2px 10px rgba(255, 145, 95, 0.45)'
    : '0 2px 6px rgba(0,0,0,0.3)';

  return L.divIcon({
    className: 'custom-poi-icon touch-manipulation',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background-color: ${color};
        border: ${borderWidth}px solid white;
        border-radius: 50%;
        box-shadow: ${boxShadow};
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${size * 0.5}px;
        color: white;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
      ">
        ${poiType.charAt(0).toUpperCase()}
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// Custom location marker icon
const createLocationIcon = (isSelected: boolean = false) => {
  const size = isSelected ? 28 : 24;
  const color = isSelected ? '#e74c3c' : '#3498db';

  return L.divIcon({
    className: 'custom-location-icon touch-manipulation',
    html: `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background-color: ${color};
        border: 3px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 8px rgba(0,0,0,0.4);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: ${size * 0.5}px;
        color: white;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
      ">
        📍
      </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
};

// Map event handlers component
interface MapEventHandlersProps {
  onLocationSelect: (location: Location) => void;
  onMapMove: (center: Location, zoom: number) => void;
  center: Location;
  zoom: number;
}

const MapEventHandlers: React.FC<MapEventHandlersProps> = ({
  onLocationSelect,
  onMapMove,
  center,
  zoom,
}) => {
  const map = useMap();

  // Handle map clicks
  useMapEvents({
    click: (e) => {
      const { lat, lng } = e.latlng;
      onLocationSelect({
        lat,
        lng,
        display_name: `Location (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      });
    },
    moveend: () => {
      const mapCenter = map.getCenter();
      const mapZoom = map.getZoom();
      onMapMove(
        {
          lat: mapCenter.lat,
          lng: mapCenter.lng,
          display_name: `Location (${mapCenter.lat.toFixed(4)}, ${mapCenter.lng.toFixed(4)})`,
        },
        mapZoom
      );
    },
  });

  // Update map center when props change
  useEffect(() => {
    if (center.lat !== 0 || center.lng !== 0) {
      const currentCenter = map.getCenter();
      const currentZoom = map.getZoom();
      
      // Only update if the center or zoom has actually changed
      const centerChanged = Math.abs(currentCenter.lat - center.lat) > 0.0001 || 
                           Math.abs(currentCenter.lng - center.lng) > 0.0001;
      const zoomChanged = currentZoom !== zoom;
      
      if (centerChanged || zoomChanged) {
        map.setView([center.lat, center.lng], zoom);
      }
    }
  }, [center.lat, center.lng, zoom, map]);

  return null;
};

// Isochrone polygon component
interface IsochronePolygonProps {
  isochroneData: IsochroneData | null;
}

const IsochronePolygon: React.FC<IsochronePolygonProps> = ({ isochroneData }) => {
  if (!isochroneData || !isochroneData.features) {
    return null;
  }

  return (
    <>
      {isochroneData.features.map((feature, index) => {
        if (feature.geometry.type === 'Polygon') {
          const coordinates = (feature.geometry.coordinates as number[][][])[0].map((coord: number[]): [number, number] => [coord[1], coord[0]]);
          return (
            <Polygon
              key={index}
              positions={coordinates}
              pathOptions={{
                color: '#3498db',
                fillColor: '#3498db',
                fillOpacity: 0.2,
                weight: 2,
                opacity: 0.8,
              }}
            />
          );
        } else if (feature.geometry.type === 'MultiPolygon') {
          return (
            <React.Fragment key={index}>
              {(feature.geometry.coordinates as number[][][]).map((polygon, polygonIndex) => {
                const coordinates = (polygon[0] as unknown as number[][]).map((coord: number[]): [number, number] => [coord[1], coord[0]]);
                return (
                  <Polygon
                    key={`${index}-${polygonIndex}`}
                    positions={coordinates}
                    pathOptions={{
                      color: '#3498db',
                      fillColor: '#3498db',
                      fillOpacity: 0.2,
                      weight: 2,
                      opacity: 0.8,
                    }}
                  />
                );
              })}
            </React.Fragment>
          );
        }
        return null;
      })}
    </>
  );
};

// POI markers component
interface POIMarkersProps {
  pois: POI[];
  selectedPOI: POI | null;
  onPOISelect: (poi: POI | null) => void;
  preferredPOITypes?: string[];
}

// Route Polyline Component
const RoutePolyline: React.FC<{
  route: RouteInfo;
  color?: string;
  weight?: number;
  opacity?: number;
}> = ({ route, color = '#3b82f6', weight = 6, opacity = 0.9 }) => {
  return (
    <Polyline
      positions={route.coordinates}
      pathOptions={{
        color: color,
        weight: weight,
        opacity: opacity,
        dashArray: route.transport === 'walking' ? '5, 10' : undefined,
        lineCap: 'round',
        lineJoin: 'round',
      }}
      eventHandlers={{
        click: () => {
          console.log('[RoutePolyline] Click detected on route:', {
            hasSteps: !!route.steps,
            stepsLength: route.steps?.length || 0,
            route: route
          });
          // Show turn-by-turn directions in chat
          if (route.steps && route.steps.length > 0) {
            console.log('[RoutePolyline] Dispatching showTurnByTurnDirections event');
            const event = new CustomEvent('showTurnByTurnDirections', { 
              detail: { 
                route: route,
                steps: route.steps
              } 
            });
            window.dispatchEvent(event);
          } else {
            console.log('[RoutePolyline] No steps available for turn-by-turn directions');
          }
        }
      }}
    >
      <Popup>
        <div className="text-sm space-y-2 max-w-sm">
          <div className="border-b pb-2">
            <p className="font-semibold text-lg">Route Information</p>
            <p className="text-gray-600">{route.transport} route</p>
          </div>
          
          {/* Basic Route Info */}
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="font-medium">Distance:</span>
              <span>{(route.distance / 1000).toFixed(2)} km</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Duration:</span>
              <span>{Math.round(route.duration / 60)} min</span>
            </div>
            
            {/* Speed and Elevation */}
            {route.avgspeed && route.avgspeed > 0 && (
              <div className="flex justify-between">
                <span className="font-medium">Avg Speed:</span>
                <span>{Math.round(route.avgspeed)} km/h</span>
              </div>
            )}
            
            {route.ascent !== undefined && route.descent !== undefined && (
              <>
                <div className="flex justify-between">
                  <span className="font-medium">Elevation Gain:</span>
                  <span className="text-green-600">+{Math.round(route.ascent)}m</span>
                </div>
                <div className="flex justify-between">
                  <span className="font-medium">Elevation Loss:</span>
                  <span className="text-red-600">-{Math.round(route.descent)}m</span>
                </div>
              </>
            )}
            
            {route.detourfactor && route.detourfactor > 1.1 && (
              <div className="flex justify-between">
                <span className="font-medium">Detour:</span>
                <span className="text-orange-600">{Math.round((route.detourfactor - 1) * 100)}% longer</span>
              </div>
            )}
          </div>
          
          {/* Traffic and Road Conditions */}
          {route.warnings && route.warnings.length > 0 && (
            <div className="border-t pt-2">
              <p className="font-medium text-orange-600 mb-1">🚦 Traffic & Road Info:</p>
              <ul className="text-xs space-y-1">
                {route.warnings.slice(0, 4).map((warning: string, index: number) => (
                  <li key={index} className="flex items-start">
                    <span className="text-orange-500 mr-1">•</span>
                    <span className="text-orange-700">{warning}</span>
                  </li>
                ))}
                {route.warnings.length > 4 && (
                  <li className="text-orange-500 text-xs">
                    ...and {route.warnings.length - 4} more conditions
                  </li>
                )}
              </ul>
            </div>
          )}
          
          {/* Click instruction */}
          <div className="border-t pt-2 text-xs text-gray-500 text-center">
            Click route for turn-by-turn directions
          </div>
        </div>
      </Popup>
    </Polyline>
  );
};

const POIMarkers: React.FC<POIMarkersProps> = ({ pois, selectedPOI, onPOISelect, preferredPOITypes = [] }) => {
  return (
    <>
      {pois.map((poi) => (
        <Marker
          key={poi.id}
          position={[poi.lat, poi.lng]}
          icon={createPOIIcon(poi.type, selectedPOI?.id === poi.id, preferredPOITypes.includes(poi.type))}
          eventHandlers={{
            click: () => onPOISelect(poi),
          }}
        >
          <Popup maxWidth={350} className="poi-popup-mobile">
            <div className="poi-popup bg-white rounded-lg shadow-lg border border-gray-200 p-4 min-w-[300px]">
              {/* Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="font-bold text-lg text-gray-900 mb-1 break-words">{poi.name}</h3>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                      {poi.type}
                    </span>
                    {poi.rating && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                        ⭐ {poi.rating}/5
                      </span>
                    )}
                    {poi.priceLevel && (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        {poi.priceLevel === 'low' ? '💰' : poi.priceLevel === 'medium' ? '💰💰' : '💰💰💰'}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Close popup logic would go here
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Main Content */}
              <div className="space-y-3">
                {/* Address */}
                {poi.address && (
                  <div className="flex items-start gap-2">
                    <span className="text-gray-500 mt-0.5">📍</span>
                    <p className="text-sm text-gray-700 break-words">{poi.address}</p>
                  </div>
                )}

                {/* Distance */}
                {poi.distance && (
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">📏</span>
                    <p className="text-sm text-gray-700">
                      <span className="font-medium">{Math.round(poi.distance / 1000 * 100) / 100} km</span> away
                    </p>
                  </div>
                )}

                {/* Travel Times */}
                {poi.durations && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <h4 className="font-semibold text-sm text-gray-900 mb-2">Travel Times</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(poi.durations).map(([mode, time]) => (
                        <div key={mode} className="flex items-center justify-between bg-white rounded px-2 py-1">
                          <span className="text-xs text-gray-600 capitalize flex items-center gap-1">
                            {mode === 'walking' && '🚶'}
                            {mode === 'driving' && '🚗'}
                            {mode === 'cycling' && '🚴'}
                            {mode === 'public_transport' && '🚌'}
                            {mode.replace('_', ' ')}
                          </span>
                          <span className="text-xs font-semibold text-gray-900">{time}min</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Contact Info */}
                <div className="space-y-2">
                  {poi.phone && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">📞</span>
                      <a href={`tel:${poi.phone}`} className="text-sm text-blue-600 hover:text-blue-800 hover:underline">
                        {poi.phone}
                      </a>
                    </div>
                  )}
                  
                  {poi.website && (
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">🌐</span>
                      <a href={poi.website} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all">
                        Visit Website
                      </a>
                    </div>
                  )}
                  
                  {poi.openingHours && (
                    <div className="flex items-start gap-2">
                      <span className="text-gray-500 mt-0.5">🕒</span>
                      <p className="text-sm text-gray-700 break-words">{poi.openingHours}</p>
                    </div>
                  )}
                </div>

                {/* Action Buttons */}
                <div className="flex gap-2 pt-2 border-t border-gray-200">
                  <button 
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-3 rounded-md transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Trigger directions request
                      if (onPOISelect) {
                        onPOISelect(poi);
                        // Also trigger directions request
                        setTimeout(() => {
                          const event = new CustomEvent('requestDirections', { detail: { poi } });
                          window.dispatchEvent(event);
                        }, 100);
                      }
                    }}
                  >
                    Get Directions
                  </button>
                  <button 
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium py-2 px-3 rounded-md transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      // Trigger custom event to show POI details in chat
                      const event = new CustomEvent('showPOIDetails', { 
                        detail: { 
                          pois: [poi],
                          query: { poiType: poi.type }
                        } 
                      });
                      window.dispatchEvent(event);
                    }}
                  >
                    More Info
                  </button>
                </div>
              </div>
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
};

// Main Map component
const Map: React.FC<MapComponentProps> = ({
  mapState,
  onLocationSelect,
  onPOISelect,
  onMapMove,
  className = '',
  queryLocation = null,
  showLocationMarker = false,
  frequentLocations = [],
  preferredPOITypes = [],
}) => {
  const [isClient, setIsClient] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  // Ensure component only renders on client side
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // Handle POI selection
  const handlePOISelect = useCallback((poi: POI | null) => {
    onPOISelect(poi);
  }, [onPOISelect]);

  // Handle location selection
  const handleLocationSelect = useCallback((location: Location) => {
    onLocationSelect(location);
  }, [onLocationSelect]);

  // Handle map movement
  const handleMapMove = useCallback((center: Location, zoom: number) => {
    onMapMove(center, zoom);
  }, [onMapMove]);

  // Don't render on server side
  if (!isClient) {
    return (
      <div className={`w-full h-full bg-gray-100 flex items-center justify-center ${className}`}>
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-gray-600">Loading map...</p>
        </div>
      </div>
    );
  }

  // Default center (New York) if no location provided
  const center = mapState.center.lat !== 0 && mapState.center.lng !== 0 
    ? [mapState.center.lat, mapState.center.lng] 
    : [40.7128, -74.0060];

  const zoom = mapState.zoom || 13;

  return (
    <div className={`w-full h-full relative ${className}`}>
        <MapContainer
          center={center as [number, number]}
          zoom={zoom}
          className="w-full h-full z-0 touch-manipulation"
          ref={mapRef}
          zoomControl={true}
          scrollWheelZoom={true}
          doubleClickZoom={true}
          dragging={true}
          touchZoom={true}
          boxZoom={true}
          keyboard={true}
          attributionControl={true}
        >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          tileSize={256}
          zoomOffset={0}
        />
        
        <MapEventHandlers
          onLocationSelect={handleLocationSelect}
          onMapMove={handleMapMove}
          center={mapState.center}
          zoom={zoom}
        />
        
        <IsochronePolygon isochroneData={mapState.isochrone} />
        
        <POIMarkers
          pois={mapState.pois}
          selectedPOI={mapState.selectedPOI}
          onPOISelect={handlePOISelect}
          preferredPOITypes={preferredPOITypes}
        />

        {/* Route Polylines */}
        {mapState.routes.map((route, index) => (
          <div key={`route-${index}`}>
            {/* Shadow/outline for better visibility */}
            <RoutePolyline
              route={route}
              color="#1e40af" // Darker blue for shadow
              weight={8}
              opacity={0.3}
            />
            {/* Main route line */}
            <RoutePolyline
              route={route}
              color={index === 0 ? '#3b82f6' : '#10b981'} // Blue for primary route, green for secondary
            />
          </div>
        ))}

        {frequentLocations.map((location) => (
          <CircleMarker
            key={`${location.location.lat}-${location.location.lng}`}
            center={[location.location.lat, location.location.lng]}
            radius={Math.min(18, 6 + location.count * 2)}
            pathOptions={{
              color: '#ff7849',
              fillColor: '#ffb199',
              fillOpacity: 0.35,
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm space-y-1">
                <p className="font-semibold">Frequent location</p>
                <p>{location.location.display_name}</p>
                <p className="text-xs text-gray-600">Visits: {location.count}</p>
                {location.poiTypes && location.poiTypes.length > 0 && (
                  <p className="text-xs text-gray-600">Prefers {location.poiTypes.slice(0, 3).join(', ')}</p>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
        
        {/* Query location marker */}
        {showLocationMarker && queryLocation && queryLocation.lat !== 0 && queryLocation.lng !== 0 && (
          <Marker
            position={[queryLocation.lat, queryLocation.lng]}
            icon={createLocationIcon(true)}
          >
            <Popup>
              <div className="location-popup">
                <h3 className="font-semibold text-lg mb-2">📍 Query Location</h3>
                <p className="text-sm">{queryLocation.display_name}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {queryLocation.lat.toFixed(4)}, {queryLocation.lng.toFixed(4)}
                </p>
                <p className="text-xs text-blue-600 mt-1">
                  Click anywhere on the map to change this location
                </p>
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
      
      {/* Loading overlay */}
      {mapState.isLoading && (
        <div className="absolute inset-0 bg-white bg-opacity-75 flex items-center justify-center z-10">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      )}
      
      {/* Error overlay */}
      {mapState.error && (
        <div className="absolute inset-0 bg-red-50 bg-opacity-90 flex items-center justify-center z-10">
          <div className="text-center p-4 max-w-sm">
            <div className="text-red-600 text-4xl mb-2">⚠️</div>
            <p className="text-red-800 font-medium mb-2">Map Error</p>
            <p className="text-red-600 text-sm mb-4">{mapState.error}</p>
            <div className="space-y-2">
              <button
                onClick={() => window.location.reload()}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
              >
                Reload Page
              </button>
              <button
                onClick={() => {
                  // Clear error and try to reload map
                  if (onLocationSelect) {
                    onLocationSelect({ lat: 40.7128, lng: -74.0060, display_name: 'New York, NY' });
                  }
                }}
                className="w-full px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
              >
                Reset to Default
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Export as dynamic component to avoid SSR issues
export default dynamic(() => Promise.resolve(Map), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-100 flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
        <p className="text-gray-600">Loading map...</p>
      </div>
    </div>
  ),
});
