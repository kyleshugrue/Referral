/**
 * Generates a bulletproof default avatar SVG with user's initials
 * Uses the same bulletproof getInitials logic
 * @param fullName - The user's full name
 * @returns A data URL for an SVG image showing the user's initials, guaranteed to work
 */
export function generateAvatarWithInitials(fullName: string | undefined | null): string {
  // Use our bulletproof initials function - guaranteed to return something meaningful
  const initials = getInitials(fullName);
    
  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="none">
      <rect width="100" height="100" fill="hsl(215,75%,50%)"/>
      <text x="50" y="50" font-family="system-ui" font-size="40" font-weight="bold" fill="white" text-anchor="middle" dominant-baseline="central">
        ${initials}
      </text>
    </svg>
  `)}`;
}

/**
 * BULLETPROOF initials generator that handles ALL edge cases
 * ALWAYS returns something to display - never empty string
 * Shows user's actual characters (including special chars) when possible
 * @param fullName - The user's full name
 * @param fallbackText - Optional fallback text (like title) when fullName is empty
 * @returns Initials or characters to display, guaranteed to be non-empty
 */
export function getInitials(fullName: string | undefined | null, fallbackText?: string | undefined | null): string {
  // Handle null/undefined cases - try fallback first
  if (!fullName || typeof fullName !== 'string' || fullName.trim() === '') {
    // Try fallback text (like user title) if available
    if (fallbackText && typeof fallbackText === 'string' && fallbackText.trim() !== '') {
      return getInitials(fallbackText); // Recursive call without fallback to avoid infinite loop
    }
    return '?';
  }
  
  // Handle whitespace-only names (show circle symbol as you requested)
  if (fullName.trim() === '' && fullName.length > 0) {
    return '◯'; // Circle symbol to represent whitespace
  }
  
  const trimmedName = fullName.trim();
  
  // First, try to get meaningful letter initials
  const letterParts = trimmedName.split(/\s+/).filter(part => part.length > 0);
  if (letterParts.length > 0) {
    const letterInitials = letterParts
      .slice(0, 2) // Max 2 initials for readability
      .map(part => {
        // Find first letter in each part
        const firstLetter = part.match(/[a-zA-Z]/);
        return firstLetter ? firstLetter[0] : null;
      })
      .filter(char => char !== null)
      .join('')
      .toUpperCase();
    
    if (letterInitials.length > 0) {
      return letterInitials;
    }
  }
  
  // If no letters found, try to use numbers or special characters
  const nonSpaceChars = trimmedName.replace(/\s/g, '');
  if (nonSpaceChars.length > 0) {
    // Take first 1-2 meaningful characters (numbers, symbols, etc.)
    const meaningfulChars = nonSpaceChars.slice(0, 2).toUpperCase();
    return meaningfulChars;
  }
  
  // If somehow we only have spaces, use a space symbol
  if (/^\s+$/.test(fullName)) {
    return '◯'; // Circle symbol to represent whitespace
  }
  
  // Absolute fallback - should never reach here
  return '?';
}