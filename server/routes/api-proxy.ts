import { Router } from 'express';
import { geocodingService } from '../services/geocoding.js';
import { rateLimit } from 'express-rate-limit';
import { logger } from '../lib/logger';
import { boundedString } from '../lib/request-validation';

const router = Router();
const geocodeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many geocoding requests' },
});

// Geocoding proxy endpoint
router.get('/geocode', geocodeLimiter, async (req, res) => {
  try {
    const { address } = req.query;
    
    const normalizedAddress = boundedString(address, 200);
    if (!normalizedAddress) {
      return res.status(400).json({ 
        error: 'Address parameter is required' 
      });
    }

    const coordinates = await geocodingService.geocodeLocation(normalizedAddress);
    
    if (!coordinates) {
      return res.status(404).json({ 
        error: 'Unable to geocode address',
        fallback: true 
      });
    }

    res.json({
      success: true,
      coordinates,
      address: normalizedAddress
    });
  } catch (error) {
    logger.error('[API Proxy] Geocoding error:', error);
    res.status(500).json({ 
      error: 'Geocoding service unavailable',
      fallback: true 
    });
  }
});

// API status check endpoint
router.get('/status', async (req, res) => {
  // Keep this endpoint useful as a liveness check without exposing provider
  // configuration, credential presence, or internal service topology.
  res.json({
    api_proxy: 'operational',
    timestamp: new Date().toISOString()
  });
});

export default router;