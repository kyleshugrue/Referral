/**
 * Capitalizes the first letter of a string
 */
export const capitalizeFirstLetter = (str: string): string => {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

/**
 * Converts a string to title case (first letter of each word capitalized)
 * Preserves existing capitalization of remaining letters (e.g., KPMG stays KPMG)
 */
export const toTitleCase = (str: string): string => {
  if (!str) return str;
  
  return str.replace(/\b\w/g, match => match.toUpperCase());
};