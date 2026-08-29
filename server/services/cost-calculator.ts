import { db } from '../db';
import { synergyMatches, users } from '@shared/schema';
import { eq, count, sql, desc, asc } from 'drizzle-orm';
import { locationCacheService } from './location-cache';
import { geocodingService } from './geocoding';

export interface CostAnalysis {
  totalMatches: number;
  totalUsers: number;
  totalApiCalls: number;
  estimatedCostUSD: number;
  averageMatchesPerUser: number;
  costPerMatch: number;
  costPerUser: number;
  monthlyProjectedCost: number;
  dailyApiCalls: number;
  breakdown: {
    anthropicApiCalls: number;
    anthropicCostUSD: number;
    geocodingApiCalls: number;
    geocodingCostUSD: number;
    // Platform-specific breakdown
    platform: {
      iosMatches: number;
      webMatches: number;
      iosCostUSD: number;
      webCostUSD: number;
      iosGeocodingCostUSD: number;
      webGeocodingCostUSD: number;
    };
  };
  optimization: {
    bidirectionalPairs: number;
    apiCallsSaved: number;
    costSaved: number;
    optimizationRate: number;
    totalSavings: string;
    locationCaching: {
      cachedLocations: number;
      cacheHitRate: number;
      geocodingApiCallsSaved: number;
      geocodingCostSaved: number;
    };
  };
  timeRange: {
    oldestMatch: string | null;
    newestMatch: string | null;
    daysCovered: number;
  };
}

export interface IndividualMatchCost {
  matchId: number;
  userId: number;
  targetUserId: number;
  createdAt: string;
  estimatedAnthropicCost: number;
  estimatedGeocodingCost: number;
  totalEstimatedCost: number;
  tokensUsed: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  userDetails?: {
    name?: string;
    email?: string;
  };
  targetUserDetails?: {
    name?: string;
    email?: string;
  };
}

export interface DetailedCostReport {
  summary: CostAnalysis;
  individualMatches: IndividualMatchCost[];
  topCostUsers: Array<{
    userId: number;
    name?: string;
    email?: string;
    matchCount: number;
    totalCost: number;
    avgCostPerMatch: number;
  }>;
  dailyCosts: Array<{
    date: string;
    matchCount: number;
    totalCost: number;
    avgCostPerMatch: number;
  }>;
}

export class CostCalculator {
  // Anthropic Claude Haiku pricing (as of 2024)
  private readonly ANTHROPIC_INPUT_COST_PER_1K_TOKENS = 0.00025; // $0.25 per million input tokens
  private readonly ANTHROPIC_OUTPUT_COST_PER_1K_TOKENS = 0.00125; // $1.25 per million output tokens
  
  // Estimated tokens per match description generation
  private readonly ESTIMATED_INPUT_TOKENS_PER_MATCH = 1200; // Prompt + user data
  private readonly ESTIMATED_OUTPUT_TOKENS_PER_MATCH = 100; // Generated description
  
  // Platform-specific geocoding costs
  private readonly WEB_GEOCODING_COST_PER_REQUEST = 0.005; // $5 per 1000 requests (Google Maps)
  private readonly IOS_GEOCODING_COST_PER_REQUEST = 0.0; // FREE (Apple MapKit - 25,000 requests/day)
  private readonly ESTIMATED_GEOCODING_CALLS_PER_MATCH = 4; // Average location checks per match
  
  // Platform usage distribution
  private readonly iosUsagePercentage = 0.3; // 30% iOS usage based on typical mobile app distribution

  private calculateAnthropicCostPerMatch(): number {
    const inputCost = (this.ESTIMATED_INPUT_TOKENS_PER_MATCH / 1000) * this.ANTHROPIC_INPUT_COST_PER_1K_TOKENS;
    const outputCost = (this.ESTIMATED_OUTPUT_TOKENS_PER_MATCH / 1000) * this.ANTHROPIC_OUTPUT_COST_PER_1K_TOKENS;
    return inputCost + outputCost;
  }

  private calculateGeocodingCostPerMatch(platform: 'ios' | 'web' = 'web'): number {
    // Platform-specific geocoding costs
    const costPerRequest = platform === 'ios' 
      ? this.IOS_GEOCODING_COST_PER_REQUEST 
      : this.WEB_GEOCODING_COST_PER_REQUEST;
    
    return this.ESTIMATED_GEOCODING_CALLS_PER_MATCH * costPerRequest;
  }

  private calculateOptimizedCostPerMatch(): { anthropic: number; geocoding: number; total: number; } {
    // Calculate platform-specific and cache-optimized costs
    const anthropicCost = this.calculateAnthropicCostPerMatch();
    
    // Apply platform ratio (30% iOS free, 70% web paid) and location caching (60% hit rate)
    const iosRatio = this.iosUsagePercentage;
    const webRatio = 1 - iosRatio;
    const cacheHitRate = 0.60; // 60% location cache hit rate
    
    const baseGeocodingCallsPerMatch = this.ESTIMATED_GEOCODING_CALLS_PER_MATCH;
    const optimizedCallsPerMatch = baseGeocodingCallsPerMatch * (1 - cacheHitRate);
    
    // Only web calls cost money (iOS is free with Apple MapKit)
    const geocodingCost = optimizedCallsPerMatch * webRatio * this.WEB_GEOCODING_COST_PER_REQUEST;
    
    return {
      anthropic: anthropicCost,
      geocoding: geocodingCost,
      total: anthropicCost + geocodingCost
    };
  }

  /**
   * Calculate platform-specific cost breakdown
   * Returns costs for both iOS and web platforms
   */
  private calculatePlatformSpecificCosts(totalMatches: number, iosMatchRatio: number = 0.3): {
    totalCost: number;
    iosMatchCount: number;
    webMatchCount: number;
    iosCost: number;
    webCost: number;
    costBreakdown: {
      iosGeocoding: number;
      webGeocoding: number;
      anthropic: number;
    };
  } {
    // Estimate platform distribution (30% iOS, 70% web by default)
    const iosMatchCount = Math.round(totalMatches * iosMatchRatio);
    const webMatchCount = totalMatches - iosMatchCount;
    
    const anthropicCostPerMatch = this.calculateAnthropicCostPerMatch();
    const iosGeocodingCostPerMatch = this.calculateGeocodingCostPerMatch('ios');
    const webGeocodingCostPerMatch = this.calculateGeocodingCostPerMatch('web');
    
    // Calculate platform-specific costs
    const iosGeocodingCost = iosMatchCount * iosGeocodingCostPerMatch;
    const webGeocodingCost = webMatchCount * webGeocodingCostPerMatch;
    const totalAnthropicCost = totalMatches * anthropicCostPerMatch;
    
    const iosTotalCost = (iosMatchCount * anthropicCostPerMatch) + iosGeocodingCost;
    const webTotalCost = (webMatchCount * anthropicCostPerMatch) + webGeocodingCost;
    const totalCost = iosTotalCost + webTotalCost;
    
    return {
      totalCost,
      iosMatchCount,
      webMatchCount,
      iosCost: iosTotalCost,
      webCost: webTotalCost,
      costBreakdown: {
        iosGeocoding: iosGeocodingCost,
        webGeocoding: webGeocodingCost,
        anthropic: totalAnthropicCost
      }
    };
  }

  private async calculateLocationCachingSavings(): Promise<{
    cachedLocations: number;
    cacheHitRate: number;
    geocodingApiCallsSaved: number;
    geocodingCostSaved: number;
  }> {
    try {
      const cacheStats = await locationCacheService.getCacheStatistics();
      
      // Estimate the number of geocoding API calls saved based on cache usage
      // If we have cached locations and a good hit rate, we save significantly on geocoding
      const potentialGeocodingCalls = cacheStats.totalCachedLocations * 2; // Each location typically gets looked up multiple times
      const actualSavedCalls = Math.floor(potentialGeocodingCalls * cacheStats.cacheHitRate);
      const costSaved = actualSavedCalls * this.WEB_GEOCODING_COST_PER_REQUEST;

      console.log(`[CostCalculator] Location cache optimization: ${actualSavedCalls} API calls saved, $${costSaved.toFixed(4)} cost saved`);

      return {
        cachedLocations: cacheStats.totalCachedLocations,
        cacheHitRate: cacheStats.cacheHitRate,
        geocodingApiCallsSaved: actualSavedCalls,
        geocodingCostSaved: costSaved
      };
    } catch (error) {
      console.error('[CostCalculator] Error calculating location caching savings:', error);
      return {
        cachedLocations: 0,
        cacheHitRate: 0,
        geocodingApiCallsSaved: 0,
        geocodingCostSaved: 0
      };
    }
  }

  private async calculateBidirectionalSavings(): Promise<{
    bidirectionalPairs: number;
    apiCallsSaved: number;
    costSaved: number;
    optimizationRate: number;
  }> {
    try {
      // Get all match pairs that could be bidirectional
      const matchPairs = await db
        .select({
          user1: synergyMatches.userId,
          user2: synergyMatches.matchedUserId,
          count: count()
        })
        .from(synergyMatches)
        .groupBy(synergyMatches.userId, synergyMatches.matchedUserId);

      // Identify bidirectional pairs (where both A->B and B->A exist)
      const bidirectionalPairs = new Set<string>();
      
      for (const pair1 of matchPairs) {
        const reverseExists = matchPairs.find(pair2 => 
          pair2.user1 === pair1.user2 && pair2.user2 === pair1.user1
        );
        
        if (reverseExists) {
          // Create a consistent key for the pair
          const pairKey = [pair1.user1, pair1.user2].sort().join('-');
          bidirectionalPairs.add(pairKey);
        }
      }

      const bidirectionalCount = bidirectionalPairs.size;
      // CRITICAL FIX: Bidirectional matching does NOT actually save API calls
      // The generateMutualDescriptions method makes 2 separate API calls, not 1 optimized call
      // Reporting actual behavior: no API call savings from bidirectional matching
      const apiCallsSaved = 0; // No actual savings - each mutual match still uses 2 API calls
      const costSaved = 0; // No cost savings
      
      // Get total matches for optimization rate
      const totalMatches = await db
        .select({ count: count() })
        .from(synergyMatches);
      
      const total = totalMatches[0]?.count || 0;
      const optimizationRate = total > 0 ? (bidirectionalCount * 2 / total) * 100 : 0; // *2 because each pair represents 2 matches

      console.log(`[CostCalculator] Bidirectional analysis: ${bidirectionalCount} mutual pairs found, but NO API savings (each pair still uses 2 separate calls)`);

      return {
        bidirectionalPairs: bidirectionalCount,
        apiCallsSaved,
        costSaved,
        optimizationRate
      };
    } catch (error) {
      console.error('[CostCalculator] Error calculating bidirectional savings:', error);
      return {
        bidirectionalPairs: 0,
        apiCallsSaved: 0,
        costSaved: 0,
        optimizationRate: 0
      };
    }
  }

  async calculateTotalCosts(): Promise<CostAnalysis> {
    try {
      console.log('[CostCalculator] Starting comprehensive cost analysis...');

      // Get total synergy matches count and time range
      const matchStats = await db
        .select({
          totalMatches: count(),
          oldestMatch: sql<string>`MIN(created_at)`,
          newestMatch: sql<string>`MAX(created_at)`,
          uniqueUsers: sql<number>`COUNT(DISTINCT user_id)`
        })
        .from(synergyMatches);

      const stats = matchStats[0];
      const totalMatches = stats.totalMatches || 0;
      const totalUsers = stats.uniqueUsers || 0;

      console.log(`[CostCalculator] Found ${totalMatches} total matches for ${totalUsers} users`);

      // Calculate bidirectional pairs to determine actual API usage
      const bidirectionalSavings = await this.calculateBidirectionalSavings();
      
      // Calculate location caching optimization savings
      const locationCachingSavings = await this.calculateLocationCachingSavings();
      
      // Calculate time range
      let daysCovered = 1;
      if (stats.oldestMatch && stats.newestMatch) {
        const oldestDate = new Date(stats.oldestMatch);
        const newestDate = new Date(stats.newestMatch);
        daysCovered = Math.max(1, Math.ceil((newestDate.getTime() - oldestDate.getTime()) / (1000 * 60 * 60 * 24)));
      }

      // Calculate platform-specific costs (iOS vs Web)
      // Estimate 30% iOS usage based on typical mobile app distribution
      const platformCosts = this.calculatePlatformSpecificCosts(totalMatches, 0.3);
      // CRITICAL FIX: Actual API calls accounting for platform differences and location caching
      // No reduction for bidirectional matching - each match uses 1 Anthropic call
      const actualAnthropicCalls = totalMatches;
      
      // Platform-specific geocoding calculation
      const iosGeocodingCalls = platformCosts.iosMatchCount * this.ESTIMATED_GEOCODING_CALLS_PER_MATCH;
      const webGeocodingCalls = platformCosts.webMatchCount * this.ESTIMATED_GEOCODING_CALLS_PER_MATCH;
      const totalPotentialGeocodingCalls = iosGeocodingCalls + webGeocodingCalls;
      
      // Apply location caching savings proportionally across platforms
      const actualGeocodingCalls = Math.max(0, totalPotentialGeocodingCalls - locationCachingSavings.geocodingApiCallsSaved);
      const totalApiCalls = actualAnthropicCalls + actualGeocodingCalls;

      // CRITICAL FIX: Apply location caching savings to actual costs
      const totalAnthropicCost = platformCosts.costBreakdown.anthropic;
      const totalGeocodingCostBeforeOptimization = platformCosts.costBreakdown.iosGeocoding + platformCosts.costBreakdown.webGeocoding;
      const totalGeocodingCost = Math.max(0, totalGeocodingCostBeforeOptimization - locationCachingSavings.geocodingCostSaved);
      const totalCost = totalAnthropicCost + totalGeocodingCost;
      
      // Average cost per match (with optimization factored in)
      const optimizedCostPerMatch = totalMatches > 0 ? totalCost / totalMatches : 0;

      // Usage statistics
      const averageMatchesPerUser = totalUsers > 0 ? totalMatches / totalUsers : 0;
      const costPerUser = totalUsers > 0 ? totalCost / totalUsers : 0;
      const dailyApiCalls = daysCovered > 0 ? totalApiCalls / daysCovered : 0;

      // Monthly projection based on current usage rate
      // CRITICAL FIX: Correct formula - daily cost * 30, not daily API calls * cost per match
      const dailyCost = daysCovered > 0 ? totalCost / daysCovered : 0;
      const monthlyProjectedCost = dailyCost * 30;

      const analysis: CostAnalysis = {
        totalMatches,
        totalUsers,
        totalApiCalls,
        estimatedCostUSD: totalCost,
        averageMatchesPerUser,
        costPerMatch: optimizedCostPerMatch,
        costPerUser,
        monthlyProjectedCost,
        dailyApiCalls,
        breakdown: {
          anthropicApiCalls: actualAnthropicCalls,
          anthropicCostUSD: totalAnthropicCost,
          geocodingApiCalls: actualGeocodingCalls,
          geocodingCostUSD: totalGeocodingCost,
          // CRITICAL FIX: Platform-specific cost breakdown with optimizations applied
          platform: {
            iosMatches: platformCosts.iosMatchCount,
            webMatches: platformCosts.webMatchCount,
            iosCostUSD: platformCosts.iosCost,
            webCostUSD: Math.max(0, platformCosts.webCost - locationCachingSavings.geocodingCostSaved), // Apply savings to web cost
            iosGeocodingCostUSD: platformCosts.costBreakdown.iosGeocoding, // iOS is always free
            webGeocodingCostUSD: Math.max(0, platformCosts.costBreakdown.webGeocoding - locationCachingSavings.geocodingCostSaved),
          },
        },
        optimization: {
          bidirectionalPairs: bidirectionalSavings.bidirectionalPairs,
          apiCallsSaved: bidirectionalSavings.apiCallsSaved,
          costSaved: bidirectionalSavings.costSaved,
          optimizationRate: bidirectionalSavings.optimizationRate,
          totalSavings: `$${(bidirectionalSavings.costSaved + locationCachingSavings.geocodingCostSaved).toFixed(4)}`,
          locationCaching: locationCachingSavings,
        },
        timeRange: {
          oldestMatch: stats.oldestMatch,
          newestMatch: stats.newestMatch,
          daysCovered,
        },
      };

      // Add ZIP code optimization statistics
      const zipStats = geocodingService.getZipCodeStats();
      console.log(`[CostCalculator] ZIP code optimization: ${zipStats.totalZipCodes} codes available, initialized: ${zipStats.initialized}`);

      console.log(`[CostCalculator] Analysis complete:`, {
        totalCost: totalCost.toFixed(4),
        costPerMatch: optimizedCostPerMatch.toFixed(4),
        monthlyProjected: monthlyProjectedCost.toFixed(2),
        zipCodeOptimization: zipStats,
      });

      return analysis;
    } catch (error) {
      console.error('[CostCalculator] Error calculating costs:', error);
      throw error;
    }
  }

  async calculateCostForUser(userId: number): Promise<{
    userMatches: number;
    userCost: number;
    userApiCalls: number;
    estimatedTokensUsed: number;
  }> {
    try {
      console.log(`[CostCalculator] Calculating costs for user ${userId}...`);

      const userMatchCount = await db
        .select({ count: count() })
        .from(synergyMatches)
        .where(eq(synergyMatches.userId, userId));

      const matchCount = userMatchCount[0]?.count || 0;
      // CRITICAL FIX: Use optimized costs that include platform-specific and caching savings
      const optimizedCosts = this.calculateOptimizedCostPerMatch();
      const totalCostPerMatch = optimizedCosts.total;

      // User costs now account for platform differences and location caching optimizations
      const userCost = matchCount * totalCostPerMatch;
      const userApiCalls = matchCount * (1 + this.ESTIMATED_GEOCODING_CALLS_PER_MATCH);
      const estimatedTokensUsed = matchCount * (this.ESTIMATED_INPUT_TOKENS_PER_MATCH + this.ESTIMATED_OUTPUT_TOKENS_PER_MATCH);

      console.log(`[CostCalculator] User ${userId} has ${matchCount} matches costing $${userCost.toFixed(4)}`);

      return {
        userMatches: matchCount,
        userCost,
        userApiCalls,
        estimatedTokensUsed,
      };
    } catch (error) {
      console.error(`[CostCalculator] Error calculating costs for user ${userId}:`, error);
      throw error;
    }
  }

  calculateOptimizationSavings(bidirectionalMatches: number, totalMatches: number): {
    bidirectionalMatches: number;
    apiCallsSaved: number;
    costSaved: number;
    optimizationRate: number;
  } {
    // CRITICAL FIX: Bidirectional matching does NOT actually save API calls
    // Each mutual match still uses 2 separate API calls to generateMutualDescriptions
    const apiCallsSaved = 0; // No actual API call savings
    const costSaved = 0; // No cost savings
    const optimizationRate = totalMatches > 0 ? (bidirectionalMatches / totalMatches) * 100 : 0;

    return {
      bidirectionalMatches,
      apiCallsSaved,
      costSaved,
      optimizationRate
    };
  }

  async getScalingCostAnalysis(userScales: number[] = [10, 100, 1000, 10000, 100000]): Promise<{
    scales: Array<{
      userCount: number;
      monthlyMatches: number;
      costPerMatch: number;
      costPerUser: number;
      totalMonthlyCost: number;
      matchingCosts: {
        anthropic: number;
        geocoding: number;
        infrastructure: number;
        total: number;
      };
      optimizations: {
        bidirectionalSavings: number;
        locationCachingSavings: number;
        zipCodeOptimization: number;
        totalSavings: number;
      };
    }>;
    insights: {
      costEfficiency: string;
      breakEvenPoint: string;
      optimizationImpact: string;
      recommendations: string[];
    };
  }> {
    const avgMatchesPerUser = 10; // Monthly matches per user
    const cacheHitRate = 0.60; // 60% location cache hit rate
    const zipHitRate = 0.75; // 75% ZIP code hit rate
    
    const anthropicCostPerMatch = this.calculateAnthropicCostPerMatch();
    const geocodingCostPerMatch = this.calculateGeocodingCostPerMatch();
    
    const scales = userScales.map(userCount => {
      const monthlyMatches = userCount * avgMatchesPerUser;
      
      // Base costs
      const baseAnthropicCost = monthlyMatches * anthropicCostPerMatch;
      const baseGeocodingCost = monthlyMatches * geocodingCostPerMatch;
      
      // CRITICAL FIX: No bidirectional API call savings in actual implementation
      const bidirectionalSavings = 0; // Bidirectional matching does NOT save API calls
      const locationCachingSavings = monthlyMatches * this.ESTIMATED_GEOCODING_CALLS_PER_MATCH * cacheHitRate * this.WEB_GEOCODING_COST_PER_REQUEST;
      const nonCachedCalls = monthlyMatches * this.ESTIMATED_GEOCODING_CALLS_PER_MATCH * (1 - cacheHitRate);
      const zipCodeOptimization = nonCachedCalls * zipHitRate * this.WEB_GEOCODING_COST_PER_REQUEST * 0.9;
      
      // Actual costs (no bidirectional savings)
      const optimizedAnthropicCost = baseAnthropicCost; // No reduction for bidirectional matching
      const optimizedGeocodingCost = Math.max(0, baseGeocodingCost - locationCachingSavings - zipCodeOptimization);
      
      // Infrastructure costs (simplified)
      const infraTiers = Math.ceil(userCount / 1000);
      const infrastructureCost = 50 + (infraTiers * 25) + 30 + (infraTiers * 15); // Server + DB
      
      const totalMatchingCost = optimizedAnthropicCost + optimizedGeocodingCost + infrastructureCost;
      const totalMonthlyCost = totalMatchingCost + 15 + (infraTiers * 5) + (userCount * 5 / 1000 * 2); // + storage + notifications
      
      return {
        userCount,
        monthlyMatches,
        costPerMatch: totalMatchingCost / monthlyMatches,
        costPerUser: totalMonthlyCost / userCount,
        totalMonthlyCost,
        matchingCosts: {
          anthropic: optimizedAnthropicCost,
          geocoding: optimizedGeocodingCost,
          infrastructure: infrastructureCost,
          total: totalMatchingCost
        },
        optimizations: {
          bidirectionalSavings,
          locationCachingSavings,
          zipCodeOptimization,
          totalSavings: bidirectionalSavings + locationCachingSavings + zipCodeOptimization
        }
      };
    });
    
    return {
      scales,
      insights: {
        costEfficiency: `Cost per user decreases from $${scales[0].costPerUser.toFixed(2)} to $${scales[scales.length-1].costPerUser.toFixed(2)} as scale increases`,
        breakEvenPoint: "Platform becomes cost-efficient at 1,000+ users with infrastructure cost amortization",
        optimizationImpact: `Location caching and ZIP code optimization provide significant geocoding cost savings`,
        recommendations: [
          "Use ZIP code geocoding for US users (90% cost savings)",
          "Implement aggressive location caching",
          "Monitor platform usage (iOS free geocoding vs web paid)",
          "Consider serverless architecture for small scales",
          "Negotiate volume discounts at 10k+ users"
        ]
      }
    };
  }

  async getDetailedCostBreakdown(): Promise<{
    perMatchCosts: {
      anthropicDescription: number;
      geocodingQueries: number;
      total: number;
    };
    scalingProjections: {
      per100Users: number;
      per1000Users: number;
      per10000Users: number;
    };
    currentRates: {
      anthropicInputCostPer1KTokens: number;
      anthropicOutputCostPer1KTokens: number;
      geocodingCostPer1KRequests: number;
    };
    optimizationPotential: {
      costSavingsAt50PercentBidirectional: number;
      costSavingsAt75PercentBidirectional: number;
      maxPossibleSavings: number;
    };
  }> {
    // CRITICAL FIX: Use optimized costs that include platform-specific and caching savings
    const optimizedCosts = this.calculateOptimizedCostPerMatch();
    const totalCostPerMatch = optimizedCosts.total;

    // Assuming average of 10 matches per user (based on typical matching algorithms)
    const avgMatchesPerUser = 10;
    const costPerUser = avgMatchesPerUser * totalCostPerMatch;

    return {
      perMatchCosts: {
        anthropicDescription: optimizedCosts.anthropic,
        geocodingQueries: optimizedCosts.geocoding,
        total: totalCostPerMatch,
      },
      scalingProjections: {
        per100Users: 100 * costPerUser,
        per1000Users: 1000 * costPerUser,
        per10000Users: 10000 * costPerUser,
      },
      currentRates: {
        anthropicInputCostPer1KTokens: this.ANTHROPIC_INPUT_COST_PER_1K_TOKENS,
        anthropicOutputCostPer1KTokens: this.ANTHROPIC_OUTPUT_COST_PER_1K_TOKENS,
        geocodingCostPer1KRequests: this.WEB_GEOCODING_COST_PER_REQUEST * 1000, // Using web baseline
      },
      optimizationPotential: {
        costSavingsAt50PercentBidirectional: 0, // CRITICAL FIX: No actual savings from bidirectional matching
        costSavingsAt75PercentBidirectional: 0, // CRITICAL FIX: No actual savings from bidirectional matching  
        maxPossibleSavings: 0, // CRITICAL FIX: No actual savings from bidirectional matching
      },
    };
  }

  async getAllIndividualMatchCosts(limit: number = 1000, offset: number = 0): Promise<IndividualMatchCost[]> {
    try {
      console.log(`[CostCalculator] Getting individual match costs (limit: ${limit}, offset: ${offset})...`);

      const matchesWithUsers = await db
        .select({
          matchId: synergyMatches.id,
          userId: synergyMatches.userId,
          targetUserId: synergyMatches.matchedUserId,
          createdAt: synergyMatches.createdAt,
          userName: users.fullName,
          userEmail: users.email,
        })
        .from(synergyMatches)
        .leftJoin(users, eq(synergyMatches.userId, users.id))
        .orderBy(desc(synergyMatches.createdAt))
        .limit(limit)
        .offset(offset);

      // CRITICAL FIX: Use optimized costs that include platform-specific and caching savings
      const optimizedCosts = this.calculateOptimizedCostPerMatch();

      const individualCosts: IndividualMatchCost[] = await Promise.all(
        matchesWithUsers.map(async (match) => {
          // Get target user details
          const targetUser = await db
            .select({ name: users.fullName, email: users.email })
            .from(users)
            .where(eq(users.id, match.targetUserId))
            .limit(1);

          return {
            matchId: match.matchId,
            userId: match.userId,
            targetUserId: match.targetUserId,
            createdAt: match.createdAt,
            estimatedAnthropicCost: optimizedCosts.anthropic,
            estimatedGeocodingCost: optimizedCosts.geocoding,
            totalEstimatedCost: optimizedCosts.total,
            tokensUsed: {
              inputTokens: this.ESTIMATED_INPUT_TOKENS_PER_MATCH,
              outputTokens: this.ESTIMATED_OUTPUT_TOKENS_PER_MATCH,
              totalTokens: this.ESTIMATED_INPUT_TOKENS_PER_MATCH + this.ESTIMATED_OUTPUT_TOKENS_PER_MATCH,
            },
            userDetails: {
              name: match.userName || undefined,
              email: match.userEmail || undefined,
            },
            targetUserDetails: {
              name: targetUser[0]?.name || undefined,
              email: targetUser[0]?.email || undefined,
            },
          };
        })
      );

      console.log(`[CostCalculator] Retrieved ${individualCosts.length} individual match costs`);
      return individualCosts;
    } catch (error) {
      console.error('[CostCalculator] Error getting individual match costs:', error);
      throw error;
    }
  }

  async getTopCostUsers(limit: number = 20): Promise<Array<{
    userId: number;
    name?: string;
    email?: string;
    matchCount: number;
    totalCost: number;
    avgCostPerMatch: number;
  }>> {
    try {
      console.log(`[CostCalculator] Getting top cost users (limit: ${limit})...`);

      const userMatchCounts = await db
        .select({
          userId: synergyMatches.userId,
          matchCount: count(),
          userName: users.fullName,
          userEmail: users.email,
        })
        .from(synergyMatches)
        .leftJoin(users, eq(synergyMatches.userId, users.id))
        .groupBy(synergyMatches.userId, users.fullName, users.email)
        .orderBy(desc(count()))
        .limit(limit);

      // CRITICAL FIX: Use optimized costs that include platform-specific and caching savings
      const optimizedCosts = this.calculateOptimizedCostPerMatch();
      const totalCostPerMatch = optimizedCosts.total;

      const topUsers = userMatchCounts.map(user => ({
        userId: user.userId,
        name: user.userName || undefined,
        email: user.userEmail || undefined,
        matchCount: user.matchCount,
        totalCost: user.matchCount * totalCostPerMatch,
        avgCostPerMatch: totalCostPerMatch,
      }));

      console.log(`[CostCalculator] Found ${topUsers.length} top cost users`);
      return topUsers;
    } catch (error) {
      console.error('[CostCalculator] Error getting top cost users:', error);
      throw error;
    }
  }

  async getDailyCostBreakdown(days: number = 30): Promise<Array<{
    date: string;
    matchCount: number;
    totalCost: number;
    avgCostPerMatch: number;
  }>> {
    try {
      console.log(`[CostCalculator] Getting daily cost breakdown for last ${days} days...`);

      const dailyStats = await db
        .select({
          date: sql<string>`DATE(created_at)`,
          matchCount: count(),
        })
        .from(synergyMatches)
        .where(sql`created_at >= NOW() - INTERVAL ${days} DAY`)
        .groupBy(sql`DATE(created_at)`)
        .orderBy(asc(sql`DATE(created_at)`));

      // CRITICAL FIX: Use optimized costs that include platform-specific and caching savings
      const optimizedCosts = this.calculateOptimizedCostPerMatch();
      const totalCostPerMatch = optimizedCosts.total;

      const dailyCosts = dailyStats.map(day => ({
        date: day.date,
        matchCount: day.matchCount,
        totalCost: day.matchCount * totalCostPerMatch,
        avgCostPerMatch: totalCostPerMatch,
      }));

      console.log(`[CostCalculator] Generated daily breakdown for ${dailyCosts.length} days`);
      return dailyCosts;
    } catch (error) {
      console.error('[CostCalculator] Error getting daily cost breakdown:', error);
      throw error;
    }
  }

  async getComprehensiveReport(options: {
    includeIndividualMatches?: boolean;
    individualMatchesLimit?: number;
    topUsersLimit?: number;
    dailyBreakdownDays?: number;
  } = {}): Promise<DetailedCostReport> {
    try {
      console.log('[CostCalculator] Generating comprehensive cost report...');

      const {
        includeIndividualMatches = false,
        individualMatchesLimit = 100,
        topUsersLimit = 20,
        dailyBreakdownDays = 30,
      } = options;

      // Get all the data in parallel for efficiency
      const [summary, topUsers, dailyCosts, individualMatches] = await Promise.all([
        this.calculateTotalCosts(),
        this.getTopCostUsers(topUsersLimit),
        this.getDailyCostBreakdown(dailyBreakdownDays),
        includeIndividualMatches ? this.getAllIndividualMatchCosts(individualMatchesLimit) : Promise.resolve([]),
      ]);

      const report: DetailedCostReport = {
        summary,
        individualMatches,
        topCostUsers: topUsers,
        dailyCosts,
      };

      console.log(`[CostCalculator] Comprehensive report generated with ${individualMatches.length} individual matches`);
      return report;
    } catch (error) {
      console.error('[CostCalculator] Error generating comprehensive report:', error);
      throw error;
    }
  }
}

export const costCalculator = new CostCalculator();