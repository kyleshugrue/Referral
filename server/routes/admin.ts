import { Router } from 'express';
import { storage } from '../storage';
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration.js';
import { requireAdmin } from '../middleware/require-admin';
import { logger } from '../lib/logger';
import { parseBoundedIntegerQuery, parseStrictPositiveInteger } from '../lib/request-validation';

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);
router.use(requireAdmin);

router.get('/dead-letters', async (req, res) => {
  try {
    const limit = parseBoundedIntegerQuery(req.query.limit, 50, 1, 100);
    if (limit === undefined) {
      return res.status(400).json({ success: false, error: 'Invalid limit' });
    }
    
    const deadLetters = await storage.getDeadLetterJobs(limit);
    
    res.json({
      success: true,
      deadLetters,
      count: deadLetters.length
    });
  } catch (error) {
    logger.error('[Admin] Error fetching dead letter jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dead letter jobs'
    });
  }
});

router.post('/dead-letters/:id/retry', async (req, res) => {
  try {
    const deadLetterId = parseStrictPositiveInteger(req.params.id);
    
    if (!deadLetterId) {
      return res.status(400).json({
        success: false,
        error: 'Invalid dead letter ID'
      });
    }
    
    await storage.retryDeadLetterJob(deadLetterId);
    
    res.json({
      success: true,
      message: `Dead letter job ${deadLetterId} has been re-queued`
    });
  } catch (error) {
    logger.error('[Admin] Error retrying dead letter job:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retry dead letter job'
    });
  }
});

export default router;
