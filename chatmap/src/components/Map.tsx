'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { MapContainer, TileLayer, Marker, Popup, Polygon, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { MapState, Location, POI, IsochroneData, MapComponentProps, LocationFrequency } from '@/src/lib/types';
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
          <Popup maxWidth={280} className="poi-popup-mobile">
            <div className="poi-popup p-2">
              <h3 className="font-semibold text-base sm:text-lg mb-2 break-words">{poi.name}</h3>
              <div className="space-y-1 text-xs sm:text-sm">
                <p><span className="font-medium">Type:</span> {poi.type}</p>
                {poi.address && (
                  <p className="break-words"><span className="font-medium">Address:</span> {poi.address}</p>
                )}
                {poi.distance && (
                  <p><span className="font-medium">Distance:</span> {Math.round(poi.distance / 1000 * 100) / 100} km</p>
                )}
                {poi.walkTime && (
                  <p><span className="font-medium">Walk Time:</span> {poi.walkTime} min</p>
                )}
                {poi.durations && (
                  <div className="mt-2">
                    <p className="font-medium text-xs mb-1">Travel Times:</p>
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      {Object.entries(poi.durations).map(([mode, time]) => (
                        <div key={mode} className="flex justify-between">
                          <span className="capitalize">{mode.replace('_', ' ')}:</span>
                          <span className="font-medium">{time}min</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {poi.phone && (
                  <p><span className="font-medium">Phone:</span> {poi.phone}</p>
                )}
                {poi.website && (
                  <p>
                    <span className="font-medium">Website:</span>{' '}
                    <a href={poi.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">
                      Visit
                    </a>
                  </p>
                )}
                {poi.openingHours && (
                  <p className="break-words"><span className="font-medium">Hours:</span> {poi.openingHours}</p>
                )}
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
