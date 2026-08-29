import { User, SynergyMatch } from '@shared/schema';
import type { IStorage } from '../storage';

export interface ProfileChanges {
  oldProfile: Partial<User>;
  newProfile: Partial<User>;
  changedFields: string[];
}

export interface StaleMatchAnalysis {
  validMatches: number[];      
  staleMatches: number[];       
  needsUpdate: number[];        
  newPotentialMatches: number[]; 
}

export async function analyzeStaleMatches(
  userId: number,
  changes: ProfileChanges,
  storage: IStorage
): Promise<StaleMatchAnalysis> {
  console.log(`[StaleMatchAnalyzer] Analyzing stale matches for user ${userId}`);
  console.log(`[StaleMatchAnalyzer] Changed fields:`, changes.changedFields);
  
  const result: StaleMatchAnalysis = {
    validMatches: [],
    staleMatches: [],
    needsUpdate: [],
    newPotentialMatches: []
  };

  try {
    if (!changes.changedFields || changes.changedFields.length === 0) {
      console.log(`[StaleMatchAnalyzer] No changed fields detected - skipping analysis`);
      return result;
    }

    const existingMatches = await storage.getSavedSynergyMatches(userId);
    console.log(`[StaleMatchAnalyzer] Found ${existingMatches.length} existing matches to analyze`);

    if (existingMatches.length === 0) {
      console.log(`[StaleMatchAnalyzer] No existing matches to analyze`);
      return result;
    }

    const currentUser = await storage.getUser(userId);
    if (!currentUser) {
      throw new Error(`User ${userId} not found`);
    }

    for (const match of existingMatches) {
      const matchedUserId = match.matchedUserId === userId ? match.userId : match.matchedUserId;
      const matchedUser = await storage.getUser(matchedUserId);
      
      if (!matchedUser) {
        console.warn(`[StaleMatchAnalyzer] Matched user ${matchedUserId} not found - marking match ${match.id} as stale`);
        result.staleMatches.push(match.id);
        continue;
      }

      const matchStatus = analyzeMatchStatus(
        currentUser,
        matchedUser,
        match,
        changes
      );

      switch (matchStatus) {
        case 'VALID':
          result.validMatches.push(match.id);
          break;
        case 'STALE':
          result.staleMatches.push(match.id);
          break;
        case 'NEEDS_UPDATE':
          result.needsUpdate.push(match.id);
          break;
      }
    }

    console.log(`[StaleMatchAnalyzer] Analysis complete:`, {
      valid: result.validMatches.length,
      stale: result.staleMatches.length,
      needsUpdate: result.needsUpdate.length
    });

    return result;

  } catch (error) {
    console.error(`[StaleMatchAnalyzer] Error analyzing stale matches:`, error);
    throw error;
  }
}

type MatchStatus = 'VALID' | 'STALE' | 'NEEDS_UPDATE';

function analyzeMatchStatus(
  user: User,
  matchedUser: User,
  match: SynergyMatch,
  changes: ProfileChanges
): MatchStatus {
  const { changedFields } = changes;
  const matchReasons = match.matchReasons || [];
  
  console.log(`[StaleMatchAnalyzer] Analyzing match ${match.id} with reasons:`, matchReasons);

  let hasStaleReason = false;
  let hasMinorChange = false;

  for (const reason of matchReasons) {
    switch (reason) {
      case 'company_priority_bidirectional':
        if (isCompanyMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} is stale - company_priority_bidirectional no longer valid`);
          hasStaleReason = true;
        }
        break;

      case 'location_priority_bidirectional':
        if (isLocationMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} is stale - location_priority_bidirectional no longer valid`);
          hasStaleReason = true;
        }
        break;

      case 'location_company_priority_bidirectional':
        if (isCompanyMatchStale(user, matchedUser, changes) || isLocationMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} is stale - location_company_priority_bidirectional no longer valid`);
          hasStaleReason = true;
        }
        break;

      case 'industry_match':
        if (isIndustryMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} is stale - industry_match no longer valid`);
          hasStaleReason = true;
        }
        break;

      case 'senior_mentorship':
        if (isMentorshipMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} is stale - senior_mentorship no longer valid`);
          hasStaleReason = true;
        }
        break;

      case 'metro_radius_match':
        if (isRadiusMatchStale(user, matchedUser, changes)) {
          console.log(`[StaleMatchAnalyzer] Match ${match.id} needs update - metro_radius_match may have changed`);
          hasMinorChange = true;
        }
        break;

      default:
        console.warn(`[StaleMatchAnalyzer] Unknown match reason: ${reason}`);
    }
  }

  if (hasStaleReason) {
    return 'STALE';
  }

  if (needsDescriptionUpdate(changedFields) || hasMinorChange) {
    return 'NEEDS_UPDATE';
  }

  return 'VALID';
}

function isCompanyMatchStale(
  user: User,
  matchedUser: User,
  changes: ProfileChanges
): boolean {
  const { changedFields, oldProfile, newProfile } = changes;

  if (changedFields.includes('currentCompany')) {
    const userCompanyChanged = oldProfile.currentCompany !== newProfile.currentCompany;
    if (userCompanyChanged) {
      const newCompany = (newProfile.currentCompany || '').toLowerCase().trim();
      const matchedUserDesiredCompanies = (matchedUser.desiredCompanies || []).map(c => c.toLowerCase().trim());
      
      if (newCompany && !matchedUserDesiredCompanies.includes(newCompany)) {
        console.log(`[StaleMatchAnalyzer] User's new company "${newCompany}" is not in matched user's desired companies`);
        return true;
      }
    }
  }

  if (changedFields.includes('desiredCompanies')) {
    const oldDesiredCompanies = (oldProfile.desiredCompanies || []).map(c => c.toLowerCase().trim());
    const newDesiredCompanies = (newProfile.desiredCompanies || []).map(c => c.toLowerCase().trim());
    const matchedUserCompany = (matchedUser.currentCompany || '').toLowerCase().trim();

    if (matchedUserCompany) {
      const previouslyWantedMatchedCompany = oldDesiredCompanies.includes(matchedUserCompany);
      const stillWantsMatchedCompany = newDesiredCompanies.includes(matchedUserCompany);

      if (previouslyWantedMatchedCompany && !stillWantsMatchedCompany) {
        console.log(`[StaleMatchAnalyzer] User no longer wants matched user's company "${matchedUserCompany}"`);
        return true;
      }
    }
  }

  const userDesiredCompanies = (user.desiredCompanies || []).map(c => c.toLowerCase().trim());
  const matchedUserDesiredCompanies = (matchedUser.desiredCompanies || []).map(c => c.toLowerCase().trim());
  const userCompany = (user.currentCompany || '').toLowerCase().trim();
  const matchedUserCompany = (matchedUser.currentCompany || '').toLowerCase().trim();

  const userWantsMatchedCompany = matchedUserCompany && userDesiredCompanies.includes(matchedUserCompany);
  const matchedUserWantsUserCompany = userCompany && matchedUserDesiredCompanies.includes(userCompany);

  return !(userWantsMatchedCompany && matchedUserWantsUserCompany);
}

function isLocationMatchStale(
  user: User,
  matchedUser: User,
  changes: ProfileChanges
): boolean {
  const { changedFields, oldProfile, newProfile } = changes;

  if (changedFields.includes('currentLocation')) {
    const userLocationChanged = oldProfile.currentLocation !== newProfile.currentLocation;
    if (userLocationChanged) {
      const newLocation = (newProfile.currentLocation || '').toLowerCase().trim();
      const matchedUserDesiredLocations = (matchedUser.desiredLocations || []).map(l => l.toLowerCase().trim());
      
      if (newLocation && !matchedUserDesiredLocations.includes(newLocation)) {
        console.log(`[StaleMatchAnalyzer] User's new location "${newLocation}" is not in matched user's desired locations`);
        return true;
      }
    }
  }

  if (changedFields.includes('desiredLocations')) {
    const oldDesiredLocations = (oldProfile.desiredLocations || []).map(l => l.toLowerCase().trim());
    const newDesiredLocations = (newProfile.desiredLocations || []).map(l => l.toLowerCase().trim());
    const matchedUserLocation = (matchedUser.currentLocation || '').toLowerCase().trim();

    if (matchedUserLocation) {
      const previouslyWantedMatchedLocation = oldDesiredLocations.includes(matchedUserLocation);
      const stillWantsMatchedLocation = newDesiredLocations.includes(matchedUserLocation);

      if (previouslyWantedMatchedLocation && !stillWantsMatchedLocation) {
        console.log(`[StaleMatchAnalyzer] User no longer wants matched user's location "${matchedUserLocation}"`);
        return true;
      }
    }
  }

  const userDesiredLocations = (user.desiredLocations || []).map(l => l.toLowerCase().trim());
  const matchedUserDesiredLocations = (matchedUser.desiredLocations || []).map(l => l.toLowerCase().trim());
  const userLocation = (user.currentLocation || '').toLowerCase().trim();
  const matchedUserLocation = (matchedUser.currentLocation || '').toLowerCase().trim();

  const userWantsMatchedLocation = matchedUserLocation && userDesiredLocations.includes(matchedUserLocation);
  const matchedUserWantsUserLocation = userLocation && matchedUserDesiredLocations.includes(userLocation);

  return !(userWantsMatchedLocation && matchedUserWantsUserLocation);
}

function isIndustryMatchStale(
  user: User,
  matchedUser: User,
  changes: ProfileChanges
): boolean {
  const { changedFields, oldProfile, newProfile } = changes;

  if (changedFields.includes('industry')) {
    const oldIndustry = (oldProfile.industry || '').toLowerCase().trim();
    const newIndustry = (newProfile.industry || '').toLowerCase().trim();
    const matchedUserIndustry = (matchedUser.industry || '').toLowerCase().trim();

    if (oldIndustry && matchedUserIndustry && 
        oldIndustry === matchedUserIndustry && 
        newIndustry !== matchedUserIndustry) {
      console.log(`[StaleMatchAnalyzer] User changed industry from "${oldIndustry}" to "${newIndustry}", no longer matches "${matchedUserIndustry}"`);
      return true;
    }
  }

  const userIndustry = (user.industry || '').toLowerCase().trim();
  const matchedUserIndustry = (matchedUser.industry || '').toLowerCase().trim();

  return !userIndustry || !matchedUserIndustry || userIndustry !== matchedUserIndustry;
}

function isMentorshipMatchStale(
  user: User,
  matchedUser: User,
  changes: ProfileChanges
): boolean {
  const { changedFields, oldProfile, newProfile } = changes;

  if (changedFields.includes('yearsOfExperience')) {
    const oldExperience = oldProfile.yearsOfExperience || 0;
    const newExperience = newProfile.yearsOfExperience || 0;
    const matchedUserExperience = matchedUser.yearsOfExperience || 0;

    const oldGap = Math.abs(oldExperience - matchedUserExperience);
    const newGap = Math.abs(newExperience - matchedUserExperience);

    if (oldGap >= 8 && newGap < 8) {
      console.log(`[StaleMatchAnalyzer] Experience gap changed from ${oldGap} to ${newGap} years - no longer qualifies for mentorship`);
      return true;
    }
  }

  const userExperience = user.yearsOfExperience || 0;
  const matchedUserExperience = matchedUser.yearsOfExperience || 0;
  const experienceGap = Math.abs(userExperience - matchedUserExperience);

  return experienceGap < 8;
}

function isRadiusMatchStale(
  user: User,
  matchedUser: User,
  changes: ProfileChanges
): boolean {
  const { changedFields } = changes;

  if (changedFields.includes('matchingRadius')) {
    console.log(`[StaleMatchAnalyzer] Matching radius changed - radius-based matches need re-evaluation`);
    return true;
  }

  if (changedFields.includes('currentLocation') || 
      changedFields.includes('currentLocationLat') || 
      changedFields.includes('currentLocationLng')) {
    console.log(`[StaleMatchAnalyzer] Location coordinates changed - radius-based matches need re-evaluation`);
    return true;
  }

  if (changedFields.includes('desiredLocations')) {
    console.log(`[StaleMatchAnalyzer] Desired locations changed - radius-based matches need re-evaluation`);
    return true;
  }

  return false;
}

function needsDescriptionUpdate(changedFields: string[]): boolean {
  const descriptionFields = [
    'title',
    'bio',
    'yearsOfExperience',
    'educationLevel',
    'institution',
    'interests',
    'professionalInterests',
    'languages',
    'photo',
    'fullName'
  ];

  const hasDescriptionFieldChange = changedFields.some(field => 
    descriptionFields.includes(field)
  );

  if (hasDescriptionFieldChange) {
    const changedDescriptionFields = changedFields.filter(f => descriptionFields.includes(f));
    console.log(`[StaleMatchAnalyzer] Match needs description update due to changed fields:`, changedDescriptionFields);
    return true;
  }

  return false;
}
