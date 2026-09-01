import { getRedirectResult, GoogleAuthProvider } from "firebase/auth";
import { auth as firebaseAuth } from "./firebase";
import { logger } from "./logger";

// Call this function on page load when the user is redirected back to your site
export async function handleRedirect() {
  try {
    // Use the imported auth instance
    const auth = firebaseAuth;
    if (!auth) {
      logger.error("Firebase auth not initialized");
      return null;
    }
    
    const result = await getRedirectResult(auth);
    
    if (!result) {
      // No redirect result, user did not sign in with redirect
      return null;
    }
    
    // This gives you a Google Access Token. You can use it to access Google APIs.
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;

    // The signed-in user info.
    const user = result.user;
    
    // Return the user info
    return {
      user,
      token,
      // Add additional user info if needed
    };
  } catch (error: unknown) {
    // Handle Errors here.
    const errorCode = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const customData = error && typeof error === 'object' && 'customData' in error ? error.customData : undefined;
    const hasEmail = typeof customData === 'object' && customData !== null && 'email' in customData;
    
    logger.error("Error in authentication redirect:", {
      errorCode,
      errorMessage,
      hasEmail
    });
    
    // Just log the error instead of showing a toast
    // This is because we can't use hooks outside of components
    logger.error("Authentication Error:", errorMessage || "There was a problem with the sign-in process.");
    
    return null;
  }
}