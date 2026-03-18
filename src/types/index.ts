// Satellite types
export interface Satellite {
  id: string;
  name: string;
  noradId: number;
  type: 'LEO' | 'MEO' | 'GEO' | 'HEO';
  owner: string;
  lat: number;
  lng: number;
  altitude: number;
  velocity: number;
  inclination: number;
  status: 'active' | 'inactive' | 'unknown';
  lastUpdated: string;
}

// Aircraft types
export interface Aircraft {
  icao: string;
  callsign: string;
  airline?: string;
  registration?: string;
  type?: string;
  lat: number;
  lng: number;
  altitude: number;
  speed: number;
  heading: number;
  verticalRate: number;
  origin?: string;
  destination?: string;
  status: 'airborne' | 'ground' | 'unknown';
  lastContact: string;
  emergency?: boolean;
}

// Ship types
export interface Ship {
  mmsi: string;
  name: string;
  callsign?: string;
  type: string;
  flag?: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  course: number;
  status: string;
  destination?: string;
  eta?: string;
  length?: number;
  width?: number;
  lastUpdated: string;
}

// Camera types
export interface Camera {
  id: string;
  name: string;
  type: 'traffic' | 'weather' | 'wildlife' | 'city' | 'beach' | 'airport' | 'other';
  lat: number;
  lng: number;
  streamUrl?: string;
  thumbnailUrl?: string;
  location: string;
  country: string;
  status: 'live' | 'offline' | 'unknown';
  source: string;
}

// Flock camera
export interface FlockCamera {
  id: string;
  serialNumber: string;
  lat: number;
  lng: number;
  location: string;
  city: string;
  state: string;
  status: 'active' | 'inactive';
  coverage: number;
  agency?: string;
}

// OSINT lookup types
export interface PersonRecord {
  name: string;
  age?: number;
  addresses?: string[];
  phones?: string[];
  emails?: string[];
  relatives?: string[];
  socialProfiles?: SocialProfile[];
  sources: string[];
}

export interface SocialProfile {
  platform: string;
  username: string;
  url: string;
  followers?: number;
}

export interface PhoneLookup {
  number: string;
  formatted: string;
  country: string;
  carrier?: string;
  lineType: 'mobile' | 'landline' | 'voip' | 'unknown';
  isValid: boolean;
  location?: string;
  spamScore?: number;
}

export interface AddressRecord {
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  lat?: number;
  lng?: number;
  residents?: string[];
  propertyInfo?: PropertyInfo;
}

export interface PropertyInfo {
  yearBuilt?: number;
  sqft?: number;
  bedrooms?: number;
  bathrooms?: number;
  estimatedValue?: number;
}

// Scanner types
export interface Scanner {
  id: string;
  name: string;
  type: 'police' | 'fire' | 'ems' | 'airport' | 'military' | 'weather' | 'ham' | 'other';
  frequency?: string;
  streamUrl: string;
  location: string;
  state: string;
  country: string;
  listeners?: number;
  status: 'live' | 'offline' | 'unknown';
  tags: string[];
}

// Resource types
export interface Resource {
  id: string;
  name: string;
  category: ResourceCategory;
  url: string;
  description: string;
  requiresAuth: boolean;
  apiKey?: string;
  isEnabled: boolean;
  lastChecked?: string;
  tags: string[];
  icon?: string;
}

export type ResourceCategory =
  | 'satellite'
  | 'aircraft'
  | 'ship'
  | 'camera'
  | 'scanner'
  | 'person'
  | 'phone'
  | 'address'
  | 'social'
  | 'darkweb'
  | 'ai'
  | 'other';

// Search types
export interface SearchResult {
  id: string;
  type: ResourceCategory;
  title: string;
  snippet: string;
  url?: string;
  confidence: number;
  source: string;
  timestamp: string;
}

// Map types
export interface MapFilter {
  satellites: boolean;
  aircraft: boolean;
  ships: boolean;
  cameras: boolean;
  flockCameras: boolean;
}

// Settings
export interface AppSettings {
  perplexityApiKey: string;
  darkMode: boolean;
  mapStyle: 'dark' | 'satellite' | 'terrain';
  refreshInterval: number;
  showAlerts: boolean;
  units: 'metric' | 'imperial';
  language: string;
}

// Alert types
export interface Alert {
  id: string;
  type: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  category: ResourceCategory;
}
