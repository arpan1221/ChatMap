import { POIType, Location, POI, TransportMode } from './types';

// ============================================================================
// DISTANCE CALCULATIONS
// ============================================================================

/**
 * Calculate the distance between two coordinates using the Haversine formula
 * @param lat1 - First latitude
 * @param lng1 - First longitude
 * @param lat2 - Second latitude
 * @param lng2 - Second longitude
 * @returns Distance in meters
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculate distance between two Location objects
 * @param location1 - First location
 * @param location2 - Second location
 * @returns Distance in meters
 */
export function calculateLocationDistance(location1: Location, location2: Location): number {
  return calculateDistance(location1.lat, location1.lng, location2.lat, location2.lng);
}

/**
 * Convert degrees to radians
 * @param degrees - Degrees to convert
 * @returns Radians
 */
function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate walking time based on distance
 * @param distanceMeters - Distance in meters
 * @param walkingSpeed - Walking speed in m/s (default: 1.4 m/s = 5 km/h)
 * @returns Walking time in minutes
 */
export function calculateWalkingTime(
  distanceMeters: number,
  walkingSpeed: number = 1.4
): number {
  return Math.round((distanceMeters / walkingSpeed) / 60);
}

/**
 * Calculate cycling time based on distance
 * @param distanceMeters - Distance in meters
 * @param cyclingSpeed - Cycling speed in m/s (default: 4.2 m/s = 15 km/h)
 * @returns Cycling time in minutes
 */
export function calculateCyclingTime(
  distanceMeters: number,
  cyclingSpeed: number = 4.2
): number {
  return Math.round((distanceMeters / cyclingSpeed) / 60);
}

/**
 * Calculate driving time based on distance
 * @param distanceMeters - Distance in meters
 * @param drivingSpeed - Driving speed in m/s (default: 13.9 m/s = 50 km/h)
 * @returns Driving time in minutes
 */
export function calculateDrivingTime(
  distanceMeters: number,
  drivingSpeed: number = 13.9
): number {
  return Math.round((distanceMeters / drivingSpeed) / 60);
}

// ============================================================================
// TIME FORMATTING
// ============================================================================

/**
 * Format minutes to human-readable time
 * @param minutes - Time in minutes
 * @returns Human-readable time string
 */
export function formatTime(minutes: number): string {
  if (minutes < 1) {
    return 'Less than 1 minute';
  }
  
  if (minutes < 60) {
    return `${Math.round(minutes)} minute${minutes !== 1 ? 's' : ''}`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = Math.round(minutes % 60);
  
  if (remainingMinutes === 0) {
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }
  
  return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
}

/**
 * Format time range for display
 * @param minMinutes - Minimum time in minutes
 * @param maxMinutes - Maximum time in minutes
 * @returns Formatted time range string
 */
export function formatTimeRange(minMinutes: number, maxMinutes: number): string {
  if (minMinutes === maxMinutes) {
    return formatTime(minMinutes);
  }
  
  return `${formatTime(minMinutes)} - ${formatTime(maxMinutes)}`;
}

/**
 * Get relative time description
 * @param minutes - Time in minutes
 * @returns Relative time description
 */
export function getRelativeTimeDescription(minutes: number): string {
  if (minutes <= 5) {
    return 'Very close';
  } else if (minutes <= 10) {
    return 'Close by';
  } else if (minutes <= 20) {
    return 'Nearby';
  } else if (minutes <= 30) {
    return 'A short distance';
  } else if (minutes <= 60) {
    return 'A moderate distance';
  } else {
    return 'Far away';
  }
}

// ============================================================================
// POI TYPE MAPPING AND NORMALIZATION
// ============================================================================

/**
 * POI type display names
 */
export const POI_TYPE_DISPLAY_NAMES: Record<POIType, string> = {
  restaurant: 'Restaurant',
  cafe: 'Cafe',
  grocery: 'Grocery Store',
  pharmacy: 'Pharmacy',
  hospital: 'Hospital',
  school: 'School',
  park: 'Park',
  gym: 'Gym',
  bank: 'Bank',
  atm: 'ATM',
  gas_station: 'Gas Station',
  shopping: 'Shopping',
  entertainment: 'Entertainment',
  transport: 'Transport',
  accommodation: 'Accommodation',
  other: 'Other',
};

/**
 * POI type emojis for display
 */
export const POI_TYPE_EMOJIS: Record<POIType, string> = {
  restaurant: '🍽️',
  cafe: '☕',
  grocery: '🛒',
  pharmacy: '💊',
  hospital: '🏥',
  school: '🏫',
  park: '🌳',
  gym: '💪',
  bank: '🏦',
  atm: '🏧',
  gas_station: '⛽',
  shopping: '🛍️',
  entertainment: '🎭',
  transport: '🚌',
  accommodation: '🏨',
  other: '📍',
};

/**
 * Get display name for POI type
 * @param poiType - POI type
 * @returns Display name
 */
export function getPOITypeDisplayName(poiType: POIType): string {
  return POI_TYPE_DISPLAY_NAMES[poiType] || 'Unknown';
}

/**
 * Get emoji for POI type
 * @param poiType - POI type
 * @returns Emoji string
 */
export function getPOITypeEmoji(poiType: POIType): string {
  return POI_TYPE_EMOJIS[poiType] || '📍';
}

/**
 * Normalize POI type from various input formats
 * @param input - Input string to normalize
 * @returns Normalized POI type
 */
export function normalizePOIType(input: string): POIType {
  const normalized = input.toLowerCase().trim();
  
  // Direct matches
  const directMatches: Record<string, POIType> = {
    'restaurant': 'restaurant',
    'cafe': 'cafe',
    'coffee': 'cafe',
    'coffee shop': 'cafe',
    'grocery': 'grocery',
    'supermarket': 'grocery',
    'pharmacy': 'pharmacy',
    'chemist': 'pharmacy',
    'hospital': 'hospital',
    'clinic': 'hospital',
    'school': 'school',
    'university': 'school',
    'park': 'park',
    'gym': 'gym',
    'fitness': 'gym',
    'bank': 'bank',
    'atm': 'atm',
    'gas station': 'gas_station',
    'fuel': 'gas_station',
    'shopping': 'shopping',
    'shop': 'shopping',
    'entertainment': 'entertainment',
    'transport': 'transport',
    'accommodation': 'accommodation',
    'hotel': 'accommodation',
  };
  
  if (directMatches[normalized]) {
    return directMatches[normalized];
  }
  
  // Partial matches
  if (normalized.includes('restaurant') || normalized.includes('food')) {
    return 'restaurant';
  }
  if (normalized.includes('coffee') || normalized.includes('cafe')) {
    return 'cafe';
  }
  if (normalized.includes('grocery') || normalized.includes('supermarket') || normalized.includes('store')) {
    return 'grocery';
  }
  if (normalized.includes('pharmacy') || normalized.includes('chemist')) {
    return 'pharmacy';
  }
  if (normalized.includes('hospital') || normalized.includes('clinic') || normalized.includes('medical')) {
    return 'hospital';
  }
  if (normalized.includes('school') || normalized.includes('university') || normalized.includes('education')) {
    return 'school';
  }
  if (normalized.includes('park') || normalized.includes('green')) {
    return 'park';
  }
  if (normalized.includes('gym') || normalized.includes('fitness')) {
    return 'gym';
  }
  if (normalized.includes('bank') || normalized.includes('financial')) {
    return 'bank';
  }
  if (normalized.includes('atm') || normalized.includes('cash')) {
    return 'atm';
  }
  if (normalized.includes('gas') || normalized.includes('fuel') || normalized.includes('station')) {
    return 'gas_station';
  }
  if (normalized.includes('shop') || normalized.includes('mall') || normalized.includes('retail')) {
    return 'shopping';
  }
  if (normalized.includes('entertainment') || normalized.includes('cinema') || normalized.includes('theater')) {
    return 'entertainment';
  }
  if (normalized.includes('transport') || normalized.includes('bus') || normalized.includes('train')) {
    return 'transport';
  }
  if (normalized.includes('hotel') || normalized.includes('accommodation') || normalized.includes('stay')) {
    return 'accommodation';
  }
  
  return 'other';
}

/**
 * Get transport mode display name
 * @param transport - Transport mode
 * @returns Display name
 */
export function getTransportDisplayName(transport: TransportMode): string {
  const displayNames: Record<TransportMode, string> = {
    walking: 'Walking',
    cycling: 'Cycling',
    driving: 'Driving',
    public_transport: 'Public Transport',
  };
  
  return displayNames[transport] || 'Unknown';
}

/**
 * Get transport mode emoji
 * @param transport - Transport mode
 * @returns Emoji string
 */
export function getTransportEmoji(transport: TransportMode): string {
  const emojis: Record<TransportMode, string> = {
    walking: '🚶',
    cycling: '🚴',
    driving: '🚗',
    public_transport: '🚌',
  };
  
  return emojis[transport] || '🚶';
}

// ============================================================================
// ERROR MESSAGE STANDARDIZATION
// ============================================================================

/**
 * Error types for consistent error handling
 */
export enum ErrorType {
  NETWORK = 'network',
  API = 'api',
  VALIDATION = 'validation',
  GEOLOCATION = 'geolocation',
  PARSING = 'parsing',
  UNKNOWN = 'unknown',
}

/**
 * Standard error messages
 */
export const ERROR_MESSAGES = {
  [ErrorType.NETWORK]: {
    title: 'Network Error',
    message: 'Unable to connect to the server. Please check your internet connection and try again.',
    action: 'Retry',
  },
  [ErrorType.API]: {
    title: 'Service Error',
    message: 'The service is temporarily unavailable. Please try again in a few moments.',
    action: 'Retry',
  },
  [ErrorType.VALIDATION]: {
    title: 'Invalid Input',
    message: 'Please check your input and try again.',
    action: 'Fix Input',
  },
  [ErrorType.GEOLOCATION]: {
    title: 'Location Access Denied',
    message: 'Please enable location access to use this feature.',
    action: 'Enable Location',
  },
  [ErrorType.PARSING]: {
    title: 'Query Parsing Error',
    message: 'Unable to understand your request. Please try rephrasing your question.',
    action: 'Rephrase',
  },
  [ErrorType.UNKNOWN]: {
    title: 'Unexpected Error',
    message: 'Something went wrong. Please try again.',
    action: 'Retry',
  },
};

/**
 * Create standardized error object
 * @param type - Error type
 * @param customMessage - Custom error message (optional)
 * @param details - Additional error details (optional)
 * @returns Standardized error object
 */
export function createError(
  type: ErrorType,
  customMessage?: string,
  details?: any
) {
  const baseError = ERROR_MESSAGES[type];
  
  return {
    type,
    title: baseError.title,
    message: customMessage || baseError.message,
    action: baseError.action,
    details,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Format error for display
 * @param error - Error object or string
 * @returns Formatted error message
 */
export function formatError(error: any): string {
  if (typeof error === 'string') {
    return error;
  }
  
  if (error?.message) {
    return error.message;
  }
  
  if (error?.title && error?.message) {
    return `${error.title}: ${error.message}`;
  }
  
  return 'An unexpected error occurred';
}

/**
 * Check if error is retryable
 * @param error - Error object
 * @returns True if error is retryable
 */
export function isRetryableError(error: any): boolean {
  if (error?.type) {
    return [ErrorType.NETWORK, ErrorType.API].includes(error.type);
  }
  
  if (error?.message) {
    const retryableKeywords = ['timeout', 'network', 'connection', 'server', 'temporary'];
    return retryableKeywords.some(keyword => 
      error.message.toLowerCase().includes(keyword)
    );
  }
  
  return false;
}

// ============================================================================
// LOCATION VALIDATION
// ============================================================================

/**
 * Validate latitude
 * @param lat - Latitude value
 * @returns True if valid
 */
export function isValidLatitude(lat: number): boolean {
  return typeof lat === 'number' && lat >= -90 && lat <= 90 && !isNaN(lat);
}

/**
 * Validate longitude
 * @param lng - Longitude value
 * @returns True if valid
 */
export function isValidLongitude(lng: number): boolean {
  return typeof lng === 'number' && lng >= -180 && lng <= 180 && !isNaN(lng);
}

/**
 * Validate coordinates
 * @param lat - Latitude
 * @param lng - Longitude
 * @returns True if both coordinates are valid
 */
export function isValidCoordinates(lat: number, lng: number): boolean {
  return isValidLatitude(lat) && isValidLongitude(lng);
}

/**
 * Validate location object
 * @param location - Location object
 * @returns True if location is valid
 */
export function isValidLocation(location: any): location is Location {
  return (
    location &&
    typeof location === 'object' &&
    isValidLatitude(location.lat) &&
    isValidLongitude(location.lng) &&
    typeof location.display_name === 'string' &&
    location.display_name.trim().length > 0
  );
}

/**
 * Normalize location object
 * @param location - Location object to normalize
 * @returns Normalized location object
 */
export function normalizeLocation(location: any): Location | null {
  if (!location || typeof location !== 'object') {
    return null;
  }
  
  const lat = typeof location.lat === 'number' ? location.lat : parseFloat(location.lat);
  const lng = typeof location.lng === 'number' ? location.lng : parseFloat(location.lng);
  const display_name = location.display_name || location.name || 'Unknown Location';
  
  if (!isValidCoordinates(lat, lng)) {
    return null;
  }
  
  return {
    lat,
    lng,
    display_name: display_name.trim(),
  };
}

/**
 * Check if two locations are the same
 * @param location1 - First location
 * @param location2 - Second location
 * @param tolerance - Tolerance in meters (default: 10m)
 * @returns True if locations are the same
 */
export function isSameLocation(
  location1: Location,
  location2: Location,
  tolerance: number = 10
): boolean {
  const distance = calculateLocationDistance(location1, location2);
  return distance <= tolerance;
}

/**
 * Get location bounds for a center point and radius
 * @param center - Center location
 * @param radiusMeters - Radius in meters
 * @returns Bounds object
 */
export function getLocationBounds(center: Location, radiusMeters: number) {
  const latDelta = (radiusMeters / 111000) * (180 / Math.PI);
  const lngDelta = (radiusMeters / (111000 * Math.cos(center.lat * Math.PI / 180))) * (180 / Math.PI);
  
  return {
    north: center.lat + latDelta,
    south: center.lat - latDelta,
    east: center.lng + lngDelta,
    west: center.lng - lngDelta,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================



/**
 * Generate unique ID
 * @returns Unique ID string
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Format number with commas
 * @param num - Number to format
 * @returns Formatted number string
 */
export function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Clamp number between min and max
 * @param num - Number to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped number
 */
export function clamp(num: number, min: number, max: number): number {
  return Math.min(Math.max(num, min), max);
}

/**
 * Check if value is empty
 * @param value - Value to check
 * @returns True if empty
 */
export function isEmpty(value: any): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  
  if (typeof value === 'string') {
    return value.trim().length === 0;
  }
  
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  
  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }
  
  return false;
}

/**
 * Deep clone object
 * @param obj - Object to clone
 * @returns Cloned object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => deepClone(item)) as any;
  }
  
  const cloned = {} as T;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  
  return cloned;
}

// ============================================================================
// PERFORMANCE OPTIMIZATION UTILITIES
// ============================================================================

/**
 * Debounce function for performance optimization
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @param immediate - Whether to call immediately
 * @returns Debounced function
 */
export const debounce = <T extends (...args: any[]) => any>(
  func: T,
  wait: number,
  immediate = false
): ((...args: Parameters<T>) => void) => {
  let timeout: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    const later = () => {
      timeout = null;
      if (!immediate) func(...args);
    };
    
    const callNow = immediate && !timeout;
    clearTimeout(timeout!);
    timeout = setTimeout(later, wait);
    
    if (callNow) func(...args);
  };
};

/**
 * Throttle function for high-frequency events
 * @param func - Function to throttle
 * @param limit - Time limit in milliseconds
 * @returns Throttled function
 */
export const throttle = <T extends (...args: any[]) => any>(
  func: T,
  limit: number
): ((...args: Parameters<T>) => void) => {
  let inThrottle: boolean;
  
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Create a debounced request with cancellation support
 * @param requestFn - Function that returns a promise
 * @param delay - Delay in milliseconds
 * @returns Object with execute and cancel methods
 */
export const createDebouncedRequest = <T>(
  requestFn: () => Promise<T>,
  delay: number = 300
) => {
  let timeoutId: NodeJS.Timeout | null = null;
  let abortController: AbortController | null = null;

  return {
    execute: (): Promise<T> => {
      return new Promise((resolve, reject) => {
        // Cancel previous request
        if (abortController) {
          abortController.abort();
        }
        
        // Clear previous timeout
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Create new abort controller
        abortController = new AbortController();

        timeoutId = setTimeout(async () => {
          try {
            const result = await requestFn();
            resolve(result);
          } catch (error) {
            if (error instanceof Error && error.name !== 'AbortError') {
              reject(error);
            }
          }
        }, delay);
      });
    },
    cancel: () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
    }
  };
};

/**
 * Memoize function results for performance
 * @param fn - Function to memoize
 * @param getKey - Function to generate cache key
 * @returns Memoized function
 */
export const memoize = <T extends (...args: any[]) => any>(
  fn: T,
  getKey?: (...args: Parameters<T>) => string
): T => {
  const cache = new Map<string, ReturnType<T>>();
  
  return ((...args: Parameters<T>) => {
    const key = getKey ? getKey(...args) : JSON.stringify(args);
    
    if (cache.has(key)) {
      return cache.get(key);
    }
    
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
};

/**
 * Create a loading skeleton component
 * @param className - CSS classes for the skeleton
 * @param lines - Number of lines for text skeleton
 * @returns Skeleton HTML string
 */
export const createSkeleton = (className: string = '', lines: number = 1): string => {
  const lineElements = Array.from({ length: lines }, (_, i) => 
    `<div class="h-4 bg-gray-200 rounded animate-pulse ${i === lines - 1 ? 'w-3/4' : 'w-full'}"></div>`
  ).join('');
  
  return `<div class="space-y-2 ${className}">${lineElements}</div>`;
};

/**
 * Intersection Observer for lazy loading
 * @param callback - Callback when element enters viewport
 * @param options - Intersection Observer options
 * @returns Intersection Observer instance
 */
export const createIntersectionObserver = (
  callback: (entries: IntersectionObserverEntry[]) => void,
  options: IntersectionObserverInit = {}
) => {
  const defaultOptions: IntersectionObserverInit = {
    root: null,
    rootMargin: '50px',
    threshold: 0.1,
    ...options
  };
  
  return new IntersectionObserver(callback, defaultOptions);
};

/**
 * Preload image for better performance
 * @param src - Image source URL
 * @returns Promise that resolves when image is loaded
 */
export const preloadImage = (src: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = src;
  });
};

/**
 * Batch process items for better performance
 * @param items - Array of items to process
 * @param processor - Function to process each batch
 * @param batchSize - Size of each batch
 * @returns Promise that resolves when all batches are processed
 */
export const batchProcess = async <T, R>(
  items: T[],
  processor: (batch: T[]) => Promise<R[]>,
  batchSize: number = 10
): Promise<R[]> => {
  const results: R[] = [];
  
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await processor(batch);
    results.push(...batchResults);
  }
  
  return results;
};
