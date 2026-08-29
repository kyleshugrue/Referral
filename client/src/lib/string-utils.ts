/**
 * Utility functions for string manipulation
 */

/**
 * Capitalizes the first letter of every word in a string
 * Preserves existing capitalization of remaining letters (e.g., KPMG stays KPMG)
 * @param str The string to capitalize
 * @returns The capitalized string
 */
export function capitalizeWords(str: string): string {
  if (!str) return '';
  
  return str.replace(/\b\w/g, match => match.toUpperCase());
}

/**
 * Converts a string to lowercase, and replaces spaces with dashes
 * @param str The string to slugify
 * @returns The slugified string
 */
export function slugify(str: string): string {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '');
}

/**
 * Formats a string to title case (capitalize first letter of each word)
 * Preserves existing capitalization of remaining letters (e.g., KPMG stays KPMG)
 * @param str The string to format
 * @returns The formatted string
 */
export function toTitleCase(str: string): string {
  if (!str) return '';
  
  return str.replace(
    /\b\w/g,
    match => match.toUpperCase()
  );
}

/**
 * Truncates a string to a maximum length and adds an ellipsis if necessary
 * @param str The string to truncate
 * @param maxLength The maximum length of the string
 * @returns The truncated string
 */
export function truncate(str: string, maxLength: number): string {
  if (!str) return '';
  if (str.length <= maxLength) return str;
  
  return str.slice(0, maxLength) + '...';
}

/**
 * Removes HTML tags from a string
 * @param html The HTML string to strip
 * @returns The plain text string
 */
export function stripHtml(html: string): string {
  if (!html) return '';
  
  return html.replace(/<[^>]*>/g, '');
}

/**
 * Normalizes a string by removing special characters and converting to lowercase
 * Useful for comparison or search operations
 * @param str The string to normalize
 * @returns The normalized string
 */
export function normalizeString(str: string): string {
  if (!str) return '';
  
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // Remove diacritics
}