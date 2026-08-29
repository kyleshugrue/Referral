import { db } from "../db";
import { synergyMatches, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Database cleanup script to remove mentoring content from saved matches
 * where the viewing user is more experienced than the matched user
 */

/**
 * Filters mentoring and experience-related content from a description
 */
function filterMentoringContent(description: string): string {
  let filteredDescription = description;

  // Comprehensive patterns for mentoring/experience content
  const mentoringPatterns = [
    /mentor(ing|ship)?/gi,
    /experience\s*(gap|difference)/gi,
    /\b\d+\s*years?\s*(of\s*)?experience/gi,
    /\b\d+\s*years?\s*more\s*(experience|experienced)/gi,
    /with\s*your\s*\d+\s*years?\s*more\s*experience/gi,
    /given\s*your\s*\d+\s*years?\s*more\s*experience/gi,
    /senior(ity)?/gi,
    /junior/gi,
    /guidance/gi,
    /coaching/gi,
    /\bguide\b/gi,
    /years?\s*(more|less)\s*experienced?/gi,
    /more\s*experienced?/gi,
    /less\s*experienced?/gi,
    /learning\s*(from|opportunity)/gi,
    /career\s*guidance/gi,
    /professional\s*development/gi,
    /skills?\s*development/gi,
    /knowledge\s*sharing/gi,
    /industry\s*insights?\s*from/gi,
    /you'd\s*make\s*a\s*great\s*mentor/gi,
    /great\s*mentor/gi,
    /provide\s*valuable\s*mentorship/gi,
    /mentor\s*to/gi,
    /you\s*can\s*provide\s*valuable/gi
  ];

  // Remove sentences containing mentoring patterns
  const sentences = filteredDescription.split(/[.!?]+/);
  const cleanSentences = sentences.filter(sentence => {
    const trimmedSentence = sentence.trim();
    if (trimmedSentence.length < 5) return true; // Keep short connecting words
    return !mentoringPatterns.some(pattern => pattern.test(trimmedSentence));
  });

  filteredDescription = cleanSentences.join('. ').trim();
  
  // Additional direct content removal for specific problematic phrases
  filteredDescription = filteredDescription
    .replace(/,?\s*and\s*you\s*can\s*provide\s*valuable[^.!?]*/gi, '')
    .replace(/,?\s*given\s*your\s*\d+\s*years?[^.!?]*/gi, '')
    .replace(/,?\s*with\s*your\s*\d+\s*years?[^.!?]*/gi, '')
    .replace(/\.\s*You'd\s*make[^.!?]*/gi, '')
    .replace(/\.\s*Given\s*your[^.!?]*/gi, '');

  // Clean up any double periods, spaces, or orphaned connectors
  filteredDescription = filteredDescription
    .replace(/\.\s*\./g, '.')
    .replace(/\s+/g, ' ')
    .replace(/^[,\s]+|[,\s]+$/g, '')
    .trim();

  // If we removed too much content, provide a safe fallback
  if (filteredDescription.length < 30) {
    filteredDescription = "Professional connection with valuable networking potential and mutual career interests";
  }

  // Ensure proper sentence ending
  if (filteredDescription && !filteredDescription.match(/[.!?]$/)) {
    filteredDescription += '.';
  }
  
  return filteredDescription;
}

async function cleanMentoringDescriptions() {
  console.log('[Mentoring Cleanup] Starting database cleanup for mentoring descriptions...');

  try {
    // Get all synergy matches with user data
    const matches = await db
      .select({
        matchId: synergyMatches.id,
        userId: synergyMatches.userId,
        matchedUserId: synergyMatches.matchedUserId,
        description: synergyMatches.description,
        userExperience: users.yearsOfExperience,
        matchedUserExperience: sql`matched_user.years_of_experience`.as('matched_user_experience')
      })
      .from(synergyMatches)
      .innerJoin(users, eq(synergyMatches.userId, users.id))
      .innerJoin(sql`${users} as matched_user`, sql`${synergyMatches.matchedUserId} = matched_user.id`)
      .where(sql`${synergyMatches.description} IS NOT NULL AND ${synergyMatches.description} != ''`);

    console.log(`[Mentoring Cleanup] Found ${matches.length} saved matches to analyze`);

    let cleanedCount = 0;
    let totalMentoringMatches = 0;

    for (const match of matches) {
      const userExperience = match.userExperience || 0;
      const matchedUserExperience = Number(match.matchedUserExperience) || 0;
      const experienceGap = Math.abs(userExperience - matchedUserExperience);
      const isUserMoreExperienced = userExperience > matchedUserExperience;
      const isMentoringMatch = experienceGap >= 10;

      if (isMentoringMatch) {
        totalMentoringMatches++;

        if (isUserMoreExperienced) {
          // This user should not see mentoring content
          const originalDescription = match.description || '';
          const cleanedDescription = filterMentoringContent(originalDescription);

          if (cleanedDescription !== originalDescription) {
            // Update the database with cleaned description
            await db
              .update(synergyMatches)
              .set({ description: cleanedDescription })
              .where(eq(synergyMatches.id, match.matchId));

            console.log(`[Mentoring Cleanup] Cleaned match ${match.matchId} for more experienced user ${match.userId}:`);
            console.log(`  Original: "${originalDescription}"`);
            console.log(`  Cleaned:  "${cleanedDescription}"`);
            cleanedCount++;
          }
        } else {
          // Less experienced user can keep mentoring content
          console.log(`[Mentoring Cleanup] Keeping mentoring content for less experienced user ${match.userId} (${userExperience} vs ${matchedUserExperience} years)`);
        }
      }
    }

    console.log(`[Mentoring Cleanup] Cleanup complete!`);
    console.log(`  Total matches analyzed: ${matches.length}`);
    console.log(`  Mentoring matches found: ${totalMentoringMatches}`);
    console.log(`  Descriptions cleaned: ${cleanedCount}`);

  } catch (error) {
    console.error('[Mentoring Cleanup] Error during cleanup:', error);
    throw error;
  }
}

// Export the function for potential reuse
export { cleanMentoringDescriptions };

// Run the cleanup immediately
cleanMentoringDescriptions()
  .then(() => {
    console.log('[Mentoring Cleanup] Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('[Mentoring Cleanup] Script failed:', error);
    process.exit(1);
  });