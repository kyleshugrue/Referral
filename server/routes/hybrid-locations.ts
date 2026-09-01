/**
 * API routes for handling hybrid location data from clients
 * Supports both Apple MapKit coordinates (iOS) and Google Maps (web)
 */

import express from "express";
import { hybridGeocodingService, type ClientLocationData } from "../services/hybrid-geocoding";
import { requireAuthJWT } from "../auth";
import { requireCompleteRegistration } from "../middleware/require-complete-registration";
import { logger } from "../lib/logger";
import { boundedString } from "../lib/request-validation";

const router = express.Router();
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

/**
 * POST /api/hybrid-locations/process
 * Process location data from hybrid clients and return coordinates (platform-aware)
 */
router.post("/process", async (req, res) => {
  try {
    const locationData: ClientLocationData = req.body;
    
    if (!locationData || !boundedString(locationData.location, 200)) {
      return res.status(400).json({ error: "Location is required" });
    }

    logger.debug('[HybridLocations] Processing location', {
      locationLength: locationData.location.length,
    });

    // Use platform-aware processing with request headers
    const coordinates = await hybridGeocodingService.processClientLocation(locationData, req.headers);

    if (coordinates) {
      res.json({
        success: true,
        location: locationData.location,
        coordinates,
        source: locationData.source || 'unknown'
      });
    } else {
      res.status(404).json({ 
        error: "Could not process location", 
        location: locationData.location 
      });
    }
  } catch (error) {
    logger.error('[HybridLocations] Error processing location:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/hybrid-locations/batch-process
 * Process multiple locations efficiently
 */
router.post("/batch-process", async (req, res) => {
  try {
    const { locations }: { locations: ClientLocationData[] } = req.body;
    
    if (!Array.isArray(locations) || locations.length === 0 || locations.length > 50 ||
      locations.some((location) => !location || !boundedString(location.location, 200))) {
      return res.status(400).json({ error: "Locations array is required" });
    }

    logger.debug('[HybridLocations] Batch processing locations', { count: locations.length });

    const results = new Map<string, unknown>();
    
    // Process locations in parallel using platform-aware method
    const promises = locations.map(async (locationData) => {
      try {
        const coordinates = await hybridGeocodingService.processClientLocation(locationData, req.headers);
        results.set(locationData.location, {
          success: true,
          location: locationData.location,
          coordinates,
          source: locationData.source || 'unknown'
        });
      } catch (error) {
        logger.error('[HybridLocations] Error processing location:', error);
        results.set(locationData.location, {
          success: false,
          location: locationData.location,
          error: 'Processing failed'
        });
      }
    });

    await Promise.all(promises);

    res.json({
      success: true,
      results: Object.fromEntries(results)
    });
  } catch (error) {
    logger.error('[HybridLocations] Error in batch processing:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/hybrid-locations/distance
 * Calculate distance between two locations using hybrid geocoding (platform-aware)
 */
router.post("/distance", async (req, res) => {
  try {
    const { location1, location2 }: { 
      location1: string | ClientLocationData, 
      location2: string | ClientLocationData 
    } = req.body;
    
    if (!location1 || !location2) {
      return res.status(400).json({ error: "Both location1 and location2 are required" });
    }

    logger.debug('[HybridLocations] Calculating distance between locations');

    // Process both locations to get coordinates using platform-aware methods
    const coord1 = typeof location1 === 'string' 
      ? await hybridGeocodingService.geocodeLocationWithPlatform(location1, req.headers)
      : await hybridGeocodingService.processClientLocation(location1, req.headers);
      
    const coord2 = typeof location2 === 'string' 
      ? await hybridGeocodingService.geocodeLocationWithPlatform(location2, req.headers)
      : await hybridGeocodingService.processClientLocation(location2, req.headers);

    if (!coord1 || !coord2) {
      return res.status(404).json({ 
        error: "Could not geocode one or both locations",
        location1Available: !!coord1,
        location2Available: !!coord2
      });
    }

    const distance = hybridGeocodingService.calculateDistance(coord1, coord2);

    res.json({
      success: true,
      distance,
      unit: 'miles',
      coordinates: {
        location1: coord1,
        location2: coord2
      }
    });
  } catch (error) {
    logger.error('[HybridLocations] Error calculating distance:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/hybrid-locations/within-radius
 * Check if two locations are within a specified radius (platform-aware)
 */
router.post("/within-radius", async (req, res) => {
  try {
    const { 
      location1, 
      location2, 
      radiusMiles 
    }: { 
      location1: string | ClientLocationData, 
      location2: string | ClientLocationData,
      radiusMiles: number
    } = req.body;
    
    if (!location1 || !location2 || typeof radiusMiles !== 'number' || !Number.isFinite(radiusMiles) || radiusMiles <= 0 || radiusMiles > 500) {
      return res.status(400).json({ error: "location1, location2, and radiusMiles are required" });
    }

    logger.debug('[HybridLocations] Checking radius', { radiusMiles });

    const withinRadius = await hybridGeocodingService.isWithinRadius(location1, location2, radiusMiles, req.headers);

    res.json({
      success: true,
      withinRadius,
      radiusMiles
    });
  } catch (error) {
    logger.error('[HybridLocations] Error checking radius:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/hybrid-locations/cache-stats
 * Get caching statistics for monitoring
 */
router.get("/cache-stats", async (req, res) => {
  try {
    const stats = hybridGeocodingService.getCacheStats();
    res.json({
      success: true,
      stats
    });
  } catch (error) {
    logger.error('[HybridLocations] Error getting cache stats:', error);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;