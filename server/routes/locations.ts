import { Router } from "express";
import citiesData from "cities.json" with { type: 'json' };

const router = Router();

// Valid US state codes
const validUSStateCodes = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  'DC'
]);

interface CityData {
  name: string;
  lat: string;
  lng: string;
  country: string;
  admin1: string; // State code
  admin2: string; // County or region
}

// Process all US cities from the data
const cityList = (() => {
  try {
    console.log("Processing US cities data...");
    if (!Array.isArray(citiesData)) {
      console.error("Cities data is not an array", citiesData);
      return new Map();
    }

    const cities = citiesData as CityData[];
    console.log(`Total cities in dataset: ${cities.length}`);

    // Create an index for faster lookups
    const cityIndex = new Map<string, Array<{
      formatted: string;
      name: string;
      state: string;
      lat: string;
      lng: string;
    }>>();

    // Process only US cities with enhanced logging
    let processedCount = 0;
    let skippedCount = 0;

    cities.forEach((city, index) => {
      try {
        // Only process US cities
        if (city.country === 'US' && city.name && city.admin1) {
          const stateCode = city.admin1.trim().toUpperCase();

          // Validate state code
          if (validUSStateCodes.has(stateCode)) {
            const cityName = city.name.trim();
            const key = cityName.toLowerCase();

            const cityData = {
              formatted: `${cityName}, ${stateCode}, US`,
              name: cityName,
              state: stateCode,
              lat: city.lat || '',
              lng: city.lng || ''
            };

            if (!cityIndex.has(key)) {
              cityIndex.set(key, [cityData]);
            } else {
              cityIndex.get(key)!.push(cityData);
            }
            processedCount++;
          } else {
            skippedCount++;
          }
        } else {
          skippedCount++;
        }
      } catch (error) {
        console.error(`Error processing city at index ${index}:`, error);
        skippedCount++;
      }
    });

    console.log(`Cities data processing complete:
    - Total entries: ${cities.length}
    - Processed US cities: ${processedCount}
    - Skipped entries: ${skippedCount}
    - Unique city names: ${cityIndex.size}`);

    return cityIndex;
  } catch (error) {
    console.error("Failed to process cities data:", error);
    return new Map();
  }
})();

router.get("/search", (req, res) => {
  try {
    const query = (req.query.q as string || "").toLowerCase().trim();
    console.log("Search query:", query);

    if (!query || query.length < 2) {
      return res.json([]);
    }

    // Check if query includes a state code
    const parts = query.split(',').map(part => part.trim());
    const cityQuery = parts[0];
    const stateQuery = parts[1]?.toUpperCase();

    const results: Array<{formatted: string; name: string; state: string; lat: string; lng: string}> = [];

    // Search through the city index
    for (const [cityName, cities] of cityList.entries()) {
      // If state is specified, filter by state
      if (stateQuery) {
        const matchingCities = cities.filter((city: {name: string; state: string; lat: string; lng: string; formatted: string}) =>
          city.name.toLowerCase().startsWith(cityQuery) &&
          city.state.includes(stateQuery)
        );
        results.push(...matchingCities.map((c: {name: string; state: string; lat: string; lng: string; formatted: string}) => c));
      }
      // Otherwise, match by city name (startsWith for better search results)
      else if (cityName.startsWith(cityQuery)) {
        results.push(...cities.map((c: {name: string; state: string; lat: string; lng: string; formatted: string}) => c));
      }

      // Limit results for performance
      if (results.length >= 50) break;
    }

    console.log(`Found ${results.length} matches for query "${query}"`);
    res.json(results.slice(0, 50));
  } catch (error) {
    console.error('Error in location search:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get("/reverse-geocode", async (req, res) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lng = parseFloat(req.query.lng as string);

    if (isNaN(lat) || isNaN(lng)) {
      return res.status(400).json({ error: 'Invalid coordinates' });
    }

    let nearestCity = null;
    let shortestDistance = Infinity;

    // Search through all cities to find the nearest one
    for (const cities of cityList.values()) {
      for (const city of cities) {
        const cityLat = parseFloat(city.lat);
        const cityLng = parseFloat(city.lng);

        if (isNaN(cityLat) || isNaN(cityLng)) continue;

        const distance = Math.sqrt(
          Math.pow(cityLat - lat, 2) + Math.pow(cityLng - lng, 2)
        );

        if (distance < shortestDistance) {
          shortestDistance = distance;
          nearestCity = city;
        }
      }
    }

    if (!nearestCity) {
      return res.status(404).json({ error: 'No nearby cities found' });
    }

    res.json(nearestCity.formatted);
  } catch (error) {
    console.error('Error in reverse geocoding:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;