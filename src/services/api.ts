import axios from 'axios';

// Perplexity AI API
export const perplexitySearch = async (
  query: string,
  apiKey: string,
  model = 'llama-3.1-sonar-large-128k-online'
): Promise<string> => {
  try {
    const response = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      {
        model,
        messages: [
          {
            role: 'system',
            content:
              'You are an OSINT research assistant. Provide detailed, factual information from open sources. Include relevant links and sources. Be concise but thorough.',
          },
          {
            role: 'user',
            content: query,
          },
        ],
        max_tokens: 2048,
        temperature: 0.2,
        top_p: 0.9,
        return_citations: true,
        search_domain_filter: [],
        return_images: false,
        return_related_questions: true,
        search_recency_filter: 'month',
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return response.data.choices[0].message.content;
  } catch (error: unknown) {
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        throw new Error('Invalid Perplexity API key. Please check your settings.');
      }
      throw new Error(`Perplexity API error: ${error.response?.data?.error?.message || error.message}`);
    }
    throw new Error('Failed to connect to Perplexity AI');
  }
};

// N2YO Satellite API
export const fetchSatellitePositions = async (
  noradId: number,
  lat: number,
  lng: number,
  alt: number,
  apiKey: string
) => {
  try {
    const response = await axios.get(
      `https://api.n2yo.com/rest/v1/satellite/positions/${noradId}/${lat}/${lng}/${alt}/2/&apiKey=${apiKey}`
    );
    return response.data;
  } catch {
    throw new Error('Failed to fetch satellite position');
  }
};

// OpenSky Network - Aircraft tracking (free, no key needed)
export const fetchAircraftData = async (
  minLat?: number,
  maxLat?: number,
  minLng?: number,
  maxLng?: number
) => {
  try {
    let url = 'https://opensky-network.org/api/states/all';
    if (minLat !== undefined) {
      url += `?lamin=${minLat}&lomin=${minLng}&lamax=${maxLat}&lomax=${maxLng}`;
    }
    const response = await axios.get(url, { timeout: 10000 });
    return response.data;
  } catch {
    throw new Error('Failed to fetch aircraft data');
  }
};

// MarineTraffic / VesselFinder proxy
export const fetchShipData = async (apiKey: string, lat: number, lng: number, radius = 100) => {
  try {
    const response = await axios.get(
      `https://services.marinetraffic.com/api/getVesselsInArea/v:8/${apiKey}/LAT:${lat}/LON:${lng}/R:${radius}/`,
      { timeout: 10000 }
    );
    return response.data;
  } catch {
    throw new Error('Failed to fetch ship data');
  }
};

// Phone number lookup - NumVerify
export const lookupPhoneNumber = async (phone: string, apiKey: string) => {
  try {
    const response = await axios.get(`https://apilayer.net/api/validate`, {
      params: {
        access_key: apiKey,
        number: phone,
        country_code: '',
        format: 1,
      },
    });
    return response.data;
  } catch {
    throw new Error('Failed to lookup phone number');
  }
};

// Geocoding - Nominatim (free)
export const geocodeAddress = async (address: string) => {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: address,
        format: 'json',
        limit: 5,
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'WatcherV1-OSINT/1.0',
      },
    });
    return response.data;
  } catch {
    throw new Error('Failed to geocode address');
  }
};

// Reverse geocoding
export const reverseGeocode = async (lat: number, lng: number) => {
  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
      params: {
        lat,
        lon: lng,
        format: 'json',
        addressdetails: 1,
      },
      headers: {
        'User-Agent': 'WatcherV1-OSINT/1.0',
      },
    });
    return response.data;
  } catch {
    throw new Error('Failed to reverse geocode');
  }
};

// CelesTrak TLE data
export const fetchTLEData = async (group = 'active') => {
  try {
    const response = await axios.get(
      `https://celestrak.org/SOCRATES/query.php?GROUP=${group}&FORMAT=json`,
      { timeout: 15000 }
    );
    return response.data;
  } catch {
    throw new Error('Failed to fetch TLE data');
  }
};
