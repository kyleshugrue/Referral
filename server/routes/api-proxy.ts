import { Router } from 'express';
import { geocodingService } from '../services/geocoding.js';
import { rateLimit } from 'express-rate-limit';
import { logger } from '../lib/logger';

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
    
    if (!address || typeof address !== 'string' || address.length > 200) {
      return res.status(400).json({ 
        error: 'Address parameter is required' 
      });
    }

    const coordinates = await geocodingService.geocodeLocation(address);
    
    if (!coordinates) {
      return res.status(404).json({ 
        error: 'Unable to geocode address',
        fallback: true 
      });
    }

    res.json({
      success: true,
      coordinates,
      address
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
  const status = {
    geocoding: {
      available: !!process.env.GOOGLE_MAPS_API_KEY,
      service: 'Google Maps API'
    },
    ai_matching: {
      available: true,
      service: 'Worker VM (Background Processing)'
    },
    firebase: {
      available: !!(process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY),
      service: 'Firebase Admin'
    }
  };

  res.json({
    api_proxy: 'operational',
    services: status,
    timestamp: new Date().toISOString()
  });
});

export default router;