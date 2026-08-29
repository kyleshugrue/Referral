/**
 * Utility functions for handling user names, particularly removing numbered suffixes
 * that are added for AI disambiguation purposes.
 */

/**
 * Removes numbered suffixes (1 or 2) from user names that were added for AI disambiguation.
 * For example: "Kyle2" becomes "Kyle", "Sarah1" becomes "Sarah"
 * 
 * @param name - The name that may contain numbered suffixes
 * @returns The name with numbered suffixes removed
 */
export function removeNumberedSuffixes(name: string): string {
  if (!name || typeof name !== 'string') {
    return name || '';
  }
  
  // Remove "1" and "2" suffixes from names
  // Pattern: word followed by 1 or 2 at word boundary
  return name.replace(/\b([A-Za-z]+)[12]\b/g, '$1');
}

/**
 * Gets a display-friendly version of a user's full name by removing any numbered suffixes.
 * This is useful when displaying names in the UI where the AI disambiguation numbers
 * should not be visible to users.
 * 
 * @param fullName - The user's full name that may contain numbered suffixes
 * @returns The cleaned full name suitable for display
 */
export function getDisplayName(fullName: string | undefined | null): string {
  if (!fullName || typeof fullName !== 'string') {
    return '';
  }
  
  return removeNumberedSuffixes(fullName);
}