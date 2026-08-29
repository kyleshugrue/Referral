import { Router } from 'express';
import { storage } from '../storage';
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration.js';

const router = Router();

// Chain both middlewares: auth first, then registration check
router.use(requireAuthJWT);
router.use(requireCompleteRegistration);

router.get('/dead-letters', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    
    const deadLetters = await storage.getDeadLetterJobs(limit);
    
    res.json({
      success: true,
      deadLetters,
      count: deadLetters.length
    });
  } catch (error) {
    console.error('[Admin] Error fetching dead letter jobs:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch dead letter jobs'
    });
  }
});

router.post('/dead-letters/:id/retry', async (req, res) => {
  try {
    const deadLetterId = parseInt(req.params.id);
    
    if (isNaN(deadLetterId)) {
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
    console.error(`[Admin] Error retrying dead letter job ${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retry dead letter job'
    });
  }
});

export default router;
