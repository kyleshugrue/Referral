import { Router } from "express";
import { costCalculator } from "../services/cost-calculator";
import { locationCacheService } from "../services/location-cache";
import { requireAuthJWT } from '../auth';
import { requireCompleteRegistration } from '../middleware/require-complete-registration';
import { requireAdmin } from '../middleware/require-admin';
import { logger } from '../lib/logger';

const router = Router();

// Get comprehensive cost analysis for all synergy matches
router.get("/analysis", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    logger.debug('[Cost Analysis] Getting comprehensive cost analysis for admin request');
    
    const analysis = await costCalculator.calculateTotalCosts();
    
    logger.debug('[Cost Analysis] Completed comprehensive analysis');
    
    res.json({
      success: true,
      analysis,
      summary: {
        totalCostFormatted: `$${analysis.estimatedCostUSD.toFixed(4)}`,
        monthlyProjectedFormatted: `$${analysis.monthlyProjectedCost.toFixed(2)}`,
        costPerMatchFormatted: `$${analysis.costPerMatch.toFixed(4)}`,
        costPerUserFormatted: `$${analysis.costPerUser.toFixed(4)}`,
      }
    });
  } catch (error) {
    logger.error("[Cost Analysis] Error getting cost analysis:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get cost analysis",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get cost analysis for a specific user
router.get("/user/:userId", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ message: "Invalid user ID" });
    }

    logger.debug('[Cost Analysis] Getting cost analysis for user', { userId });
    
    const userCosts = await costCalculator.calculateCostForUser(userId);
    
    logger.debug('[Cost Analysis] User cost analysis completed', { userId });
    
    res.json({
      success: true,
      userId,
      costs: userCosts,
      summary: {
        totalCostFormatted: `$${userCosts.userCost.toFixed(4)}`,
        avgCostPerMatchFormatted: userCosts.userMatches > 0 
          ? `$${(userCosts.userCost / userCosts.userMatches).toFixed(4)}`
          : '$0.0000',
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting user cost analysis:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get user cost analysis",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get scaling cost analysis for different user scales
router.get("/scaling", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    logger.debug('[Cost Analysis] Getting scaling cost analysis for admin request');
    
    // Parse user scales from query parameters, default to standard scales
    const scalesParam = req.query.scales as string;
    let scales = [10, 100, 1000, 10000, 100000];
    
    if (scalesParam) {
      try {
        scales = scalesParam
          .split(',')
          .slice(0, 20)
          .map(s => Number.parseInt(s.trim(), 10))
          .filter(n => Number.isSafeInteger(n) && n > 0 && n <= 10_000_000);
      } catch {
        logger.warn('[Cost Analysis] Invalid scales parameter, using defaults');
      }
    }
    if (scales.length === 0) scales = [10, 100, 1000, 10000, 100000];
    
    const scalingAnalysis = await costCalculator.getScalingCostAnalysis(scales);
    
    logger.debug('[Cost Analysis] Completed scaling analysis', { scaleCount: scales.length });
    
    res.json({
      success: true,
      scalingAnalysis,
      metadata: {
        analysisDate: new Date().toISOString(),
        userScales: scales,
        assumptions: {
          avgMatchesPerUserPerMonth: 10,
          bidirectionalOptimizationRate: 35,
          locationCacheHitRate: 60,
          zipCodeHitRate: 75,
        }
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting scaling cost analysis:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get scaling cost analysis",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current user's cost analysis
router.get("/my-costs", requireAuthJWT, async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'User not found' });
    }
    
    const userId = req.user.id;
    logger.debug('[Cost Analysis] Getting cost analysis for current user', { userId });
    
    const userCosts = await costCalculator.calculateCostForUser(userId);
    
    res.json({
      success: true,
      costs: userCosts,
      summary: {
        totalCostFormatted: `$${userCosts.userCost.toFixed(4)}`,
        avgCostPerMatchFormatted: userCosts.userMatches > 0 
          ? `$${(userCosts.userCost / userCosts.userMatches).toFixed(4)}`
          : '$0.0000',
        estimatedTokensUsed: userCosts.estimatedTokensUsed,
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting current user cost analysis:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get your cost analysis",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get detailed cost breakdown and scaling projections
router.get("/breakdown", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    logger.debug('[Cost Analysis] Getting detailed cost breakdown');
    
    const breakdown = await costCalculator.getDetailedCostBreakdown();
    
    res.json({
      success: true,
      breakdown,
      formatted: {
        perMatchCosts: {
          anthropicDescription: `$${breakdown.perMatchCosts.anthropicDescription.toFixed(4)}`,
          geocodingQueries: `$${breakdown.perMatchCosts.geocodingQueries.toFixed(4)}`,
          total: `$${breakdown.perMatchCosts.total.toFixed(4)}`,
        },
        scalingProjections: {
          per100Users: `$${breakdown.scalingProjections.per100Users.toFixed(2)}`,
          per1000Users: `$${breakdown.scalingProjections.per1000Users.toFixed(2)}`,
          per10000Users: `$${breakdown.scalingProjections.per10000Users.toFixed(2)}`,
        },
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting cost breakdown:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get cost breakdown",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Public endpoint for cost estimation (no auth required)
router.get("/estimate", async (req, res) => {
  try {
    const { matches = 1, users = 1 } = req.query;
    
    const parsedMatches = Number.parseInt(matches as string, 10);
    const parsedUsers = Number.parseInt(users as string, 10);
    const matchCount = Number.isSafeInteger(parsedMatches)
      ? Math.min(1_000_000, Math.max(1, parsedMatches))
      : 1;
    const userCount = Number.isSafeInteger(parsedUsers)
      ? Math.min(1_000_000, Math.max(1, parsedUsers))
      : 1;
    
    logger.debug('[Cost Analysis] Estimating costs', { matchCount, userCount });
    
    const breakdown = await costCalculator.getDetailedCostBreakdown();
    
    // Estimate bidirectional optimization (assume 30% of matches are bidirectional)
    const estimatedBidirectionalRate = 0.30;
    const estimatedBidirectionalMatches = Math.floor(matchCount * estimatedBidirectionalRate);
    const estimatedApiCallsSaved = Math.floor(estimatedBidirectionalMatches / 2);
    
    // Calculate optimized costs
    const anthropicCostPerMatch = breakdown.perMatchCosts.anthropicDescription;
    const geocodingCostPerMatch = breakdown.perMatchCosts.geocodingQueries;
    
    const optimizedAnthropicCosts = (matchCount - estimatedApiCallsSaved) * anthropicCostPerMatch;
    const totalGeocodingCosts = matchCount * geocodingCostPerMatch;
    const totalCost = optimizedAnthropicCosts + totalGeocodingCosts;
    const optimizedCostPerMatch = totalCost / matchCount;
    
    const avgCostPerUser = userCount > 0 ? totalCost / userCount : 0;
    
    // Calculate savings from optimization
    const costWithoutOptimization = matchCount * breakdown.perMatchCosts.total;
    const costSaved = costWithoutOptimization - totalCost;
    
    res.json({
      success: true,
      estimate: {
        matches: matchCount,
        users: userCount,
        totalCost,
        costPerMatch: optimizedCostPerMatch,
        avgCostPerUser,
        breakdown: {
          anthropicCosts: optimizedAnthropicCosts,
          geocodingCosts: totalGeocodingCosts,
        },
        optimization: {
          bidirectionalRate: `${(estimatedBidirectionalRate * 100).toFixed(0)}%`,
          estimatedBidirectionalMatches,
          apiCallsSaved: estimatedApiCallsSaved,
          costSaved,
          costWithoutOptimization,
          optimizationSavings: `$${costSaved.toFixed(4)}`,
        },
      },
      formatted: {
        totalCost: `$${totalCost.toFixed(4)}`,
        costPerMatch: `$${optimizedCostPerMatch.toFixed(4)}`,
        avgCostPerUser: `$${avgCostPerUser.toFixed(4)}`,
        anthropicCosts: `$${optimizedAnthropicCosts.toFixed(4)}`,
        geocodingCosts: `$${totalGeocodingCosts.toFixed(4)}`,
      },
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting cost estimate:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get cost estimate",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get individual costs for every synergy match
router.get("/individual-matches", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const limitNum = Math.min(1000, Math.max(1, parseInt(limit as string) || 100));
    const offsetNum = Math.max(0, parseInt(offset as string) || 0);

    logger.debug('[Cost Analysis] Getting individual match costs', { limit: limitNum, offset: offsetNum });
    
    const individualMatches = await costCalculator.getAllIndividualMatchCosts(limitNum, offsetNum);
    
    const totalCost = individualMatches.reduce((sum, match) => sum + match.totalEstimatedCost, 0);
    
    res.json({
      success: true,
      individualMatches,
      pagination: {
        limit: limitNum,
        offset: offsetNum,
        count: individualMatches.length,
      },
      summary: {
        totalMatches: individualMatches.length,
        totalCost: totalCost,
        avgCostPerMatch: individualMatches.length > 0 ? totalCost / individualMatches.length : 0,
        totalTokensUsed: individualMatches.reduce((sum, match) => sum + match.tokensUsed.totalTokens, 0),
      },
      formatted: {
        totalCost: `$${totalCost.toFixed(4)}`,
        avgCostPerMatch: individualMatches.length > 0 ? `$${(totalCost / individualMatches.length).toFixed(4)}` : '$0.0000',
      },
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting individual match costs:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get individual match costs",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get top cost users
router.get("/top-users", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));

    logger.debug('[Cost Analysis] Getting top cost users', { limit: limitNum });
    
    const topUsers = await costCalculator.getTopCostUsers(limitNum);
    
    const totalCost = topUsers.reduce((sum, user) => sum + user.totalCost, 0);
    const totalMatches = topUsers.reduce((sum, user) => sum + user.matchCount, 0);
    
    res.json({
      success: true,
      topUsers,
      summary: {
        totalUsers: topUsers.length,
        totalCost: totalCost,
        totalMatches: totalMatches,
        avgCostPerUser: topUsers.length > 0 ? totalCost / topUsers.length : 0,
        avgMatchesPerUser: topUsers.length > 0 ? totalMatches / topUsers.length : 0,
      },
      formatted: {
        totalCost: `$${totalCost.toFixed(4)}`,
        avgCostPerUser: topUsers.length > 0 ? `$${(totalCost / topUsers.length).toFixed(4)}` : '$0.0000',
      },
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting top cost users:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get top cost users",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get daily cost breakdown
router.get("/daily-breakdown", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const daysNum = Math.min(365, Math.max(1, parseInt(days as string) || 30));

    logger.debug('[Cost Analysis] Getting daily cost breakdown', { days: daysNum });
    
    const dailyCosts = await costCalculator.getDailyCostBreakdown(daysNum);
    
    const totalCost = dailyCosts.reduce((sum, day) => sum + day.totalCost, 0);
    const totalMatches = dailyCosts.reduce((sum, day) => sum + day.matchCount, 0);
    
    res.json({
      success: true,
      dailyCosts,
      summary: {
        totalDays: dailyCosts.length,
        totalCost: totalCost,
        totalMatches: totalMatches,
        avgCostPerDay: dailyCosts.length > 0 ? totalCost / dailyCosts.length : 0,
        avgMatchesPerDay: dailyCosts.length > 0 ? totalMatches / dailyCosts.length : 0,
      },
      formatted: {
        totalCost: `$${totalCost.toFixed(4)}`,
        avgCostPerDay: dailyCosts.length > 0 ? `$${(totalCost / dailyCosts.length).toFixed(4)}` : '$0.0000',
      },
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting daily cost breakdown:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get daily cost breakdown",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get comprehensive cost report
router.get("/comprehensive-report", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    const { 
      includeIndividualMatches = 'false',
      individualMatchesLimit = 100,
      topUsersLimit = 20,
      dailyBreakdownDays = 30
    } = req.query;

    const options = {
      includeIndividualMatches: includeIndividualMatches === 'true',
      individualMatchesLimit: Math.min(1000, Math.max(1, parseInt(individualMatchesLimit as string) || 100)),
      topUsersLimit: Math.min(100, Math.max(1, parseInt(topUsersLimit as string) || 20)),
      dailyBreakdownDays: Math.min(365, Math.max(1, parseInt(dailyBreakdownDays as string) || 30)),
    };

    logger.debug('[Cost Analysis] Generating comprehensive cost report', { optionKeys: Object.keys(options) });
    
    const report = await costCalculator.getComprehensiveReport(options);
    
    res.json({
      success: true,
      report,
      metadata: {
        generatedAt: new Date().toISOString(),
        options,
        summary: {
          totalCostFormatted: `$${report.summary.estimatedCostUSD.toFixed(4)}`,
          monthlyProjectedFormatted: `$${report.summary.monthlyProjectedCost.toFixed(2)}`,
          costPerMatchFormatted: `$${report.summary.costPerMatch.toFixed(4)}`,
          costPerUserFormatted: `$${report.summary.costPerUser.toFixed(4)}`,
          individualMatchesIncluded: report.individualMatches.length,
          topUsersIncluded: report.topCostUsers.length,
          dailyBreakdownDays: report.dailyCosts.length,
        },
      },
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error generating comprehensive report:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to generate comprehensive cost report",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get location caching optimization statistics
router.get("/location-cache-stats", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    logger.debug('[Cost Analysis] Getting location cache optimization statistics');
    
    const cacheStats = await locationCacheService.getCacheStatistics();
    
    // Estimate potential savings based on cache performance
    const estimatedGeocodingCallsPerMatch = 4; // Average location checks per match
    const geocodingCostPerCall = 0.005; // $5 per 1000 requests
    
    const potentialSavingsPerMatch = cacheStats.cacheHitRate * estimatedGeocodingCallsPerMatch * geocodingCostPerCall;
    const monthlyProjectedSavings = potentialSavingsPerMatch * 30 * 100; // Assume 100 matches per day
    
    res.json({
      success: true,
      cacheStats: {
        totalCachedLocations: cacheStats.totalCachedLocations,
        cacheHitRate: `${(cacheStats.cacheHitRate * 100).toFixed(1)}%`,
        cacheHitRateValue: cacheStats.cacheHitRate,
        oldestEntry: cacheStats.oldestEntry,
        newestEntry: cacheStats.newestEntry,
        estimatedSavings: {
          perMatch: `$${potentialSavingsPerMatch.toFixed(5)}`,
          perMatchValue: potentialSavingsPerMatch,
          monthlyProjected: `$${monthlyProjectedSavings.toFixed(2)}`,
          monthlyProjectedValue: monthlyProjectedSavings,
          description: "Based on avoiding repeated geocoding API calls for cached locations"
        }
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error getting location cache stats:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to get location cache statistics",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get comprehensive optimization report including both bidirectional and location caching
router.get("/optimization-report", requireAuthJWT, requireCompleteRegistration, requireAdmin, async (req, res) => {
  try {
    logger.debug('[Cost Analysis] Generating comprehensive optimization report');
    
    // Get cost analysis with all optimizations
    const analysis = await costCalculator.calculateTotalCosts();
    const cacheStats = await locationCacheService.getCacheStatistics();
    
    // Calculate optimization impact
    const totalSavingsFromBidirectional = analysis.optimization.costSaved;
    const totalSavingsFromLocationCache = analysis.optimization.locationCaching.geocodingCostSaved;
    const totalOptimizationSavings = totalSavingsFromBidirectional + totalSavingsFromLocationCache;
    
    // Calculate what costs would be without optimizations
    const costWithoutOptimizations = analysis.estimatedCostUSD + totalOptimizationSavings;
    const optimizationRate = costWithoutOptimizations > 0 ? (totalOptimizationSavings / costWithoutOptimizations) * 100 : 0;
    
    res.json({
      success: true,
      optimizationReport: {
        currentCosts: {
          total: `$${analysis.estimatedCostUSD.toFixed(4)}`,
          totalValue: analysis.estimatedCostUSD,
          costPerMatch: `$${analysis.costPerMatch.toFixed(4)}`,
          costPerUser: `$${analysis.costPerUser.toFixed(4)}`,
          monthlyProjected: `$${analysis.monthlyProjectedCost.toFixed(2)}`
        },
        withoutOptimizations: {
          total: `$${costWithoutOptimizations.toFixed(4)}`,
          totalValue: costWithoutOptimizations,
          difference: `$${totalOptimizationSavings.toFixed(4)}`
        },
        optimizations: {
          bidirectionalMatching: {
            pairsFound: analysis.optimization.bidirectionalPairs,
            apiCallsSaved: analysis.optimization.apiCallsSaved,
            costSaved: `$${totalSavingsFromBidirectional.toFixed(4)}`,
            costSavedValue: totalSavingsFromBidirectional,
            description: "Saved by generating both user descriptions in single AI API calls"
          },
          locationCaching: {
            cachedLocations: cacheStats.totalCachedLocations,
            cacheHitRate: `${(cacheStats.cacheHitRate * 100).toFixed(1)}%`,
            geocodingCallsSaved: analysis.optimization.locationCaching.geocodingApiCallsSaved,
            costSaved: `$${totalSavingsFromLocationCache.toFixed(4)}`,
            costSavedValue: totalSavingsFromLocationCache,
            description: "Saved by avoiding repeated geocoding API calls for cached locations"
          },
          totalSavings: {
            combined: `$${totalOptimizationSavings.toFixed(4)}`,
            combinedValue: totalOptimizationSavings,
            optimizationRate: `${optimizationRate.toFixed(1)}%`,
            optimizationRateValue: optimizationRate
          }
        },
        breakdown: {
          currentAnthropicCosts: `$${analysis.breakdown.anthropicCostUSD.toFixed(4)}`,
          currentGeocodingCosts: `$${analysis.breakdown.geocodingCostUSD.toFixed(4)}`,
          anthropicPercentage: analysis.estimatedCostUSD > 0 ? `${((analysis.breakdown.anthropicCostUSD / analysis.estimatedCostUSD) * 100).toFixed(1)}%` : '0%',
          geocodingPercentage: analysis.estimatedCostUSD > 0 ? `${((analysis.breakdown.geocodingCostUSD / analysis.estimatedCostUSD) * 100).toFixed(1)}%` : '0%'
        }
      }
    });
  } catch (error) {
    logger.error('[Cost Analysis] Error generating optimization report:', error);
    res.status(500).json({ 
      success: false,
      message: "Failed to generate optimization report",
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;