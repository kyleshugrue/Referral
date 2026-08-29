import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  initializeAuth,
  indexedDBLocalPersistence,
  signInWithRedirect, 
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  confirmPasswordReset,
  verifyPasswordResetCode,
  signOut,
  Auth,
  User as FirebaseUser
} from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { logger } from "@/lib/logger";

// Platform-specific Firebase configuration
// Both native and web platforms now use environment variables for security
const getFirebaseConfig = () => {
  if (Capacitor.isNativePlatform()) {
    logger.debug("Using environment variables for native platform (iOS/Android)");
    return {
      apiKey: import.meta.env.VITE_FIREBASE_NATIVE_API_KEY || import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
      appId: import.meta.env.VITE_FIREBASE_NATIVE_APP_ID || import.meta.env.VITE_FIREBASE_APP_ID,
    };
  } else {
    logger.debug("Using environment variables for web platform");
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
  }
};

const firebaseConfig = getFirebaseConfig();
const isSmokeTestBuild = import.meta.env.VITE_SMOKE_TEST === 'true';

// Initialize Firebase
let app;
let auth: Auth | null = null;

if (isSmokeTestBuild) {
  // The smoke journey never submits auth. Skipping Firebase initialization
  // keeps synthetic CI configuration from making an external project-config
  // request with a deliberately non-functional API key.
  logger.debug("Skipping Firebase initialization for the browser smoke build");
} else {
  try {
    logger.debug("Initializing Firebase with config:", {
      projectId: firebaseConfig.projectId,
      authDomain: firebaseConfig.authDomain,
      platform: Capacitor.isNativePlatform() ? 'native' : 'web'
    });

    app = initializeApp(firebaseConfig);

    // Use platform-specific auth initialization
    // On iOS/Android native platforms, use initializeAuth with indexedDB persistence
    // On web, use the standard getAuth
    if (Capacitor.isNativePlatform()) {
      logger.debug("Initializing Firebase Auth for native platform (iOS/Android)");
      auth = initializeAuth(app, {
        persistence: indexedDBLocalPersistence
      });
    } else {
      logger.debug("Initializing Firebase Auth for web platform");
      auth = getAuth(app);
    }

    logger.debug("Firebase initialized successfully");
  } catch (error) {
    logger.error("Error initializing Firebase:", error);
  }
}

// Google Auth Provider
const googleProvider = new GoogleAuthProvider();

// Function to sign in with Google
export function signInWithGoogle() {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  return signInWithRedirect(auth, googleProvider);
}

// Function to register with email/password
export async function registerWithEmail(email: string, password: string) {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    logger.debug("User registered successfully");
    return userCredential.user;
  } catch (error) {
    logger.error("Error registering user:", error);
    throw error;
  }
}

// Function to sign in with email/password
export async function signInWithEmail(email: string, password: string) {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    logger.debug("User signed in successfully");
    return userCredential.user;
  } catch (error) {
    logger.error("Error signing in user:", error);
    throw error;
  }
}

// Function to send verification email
export async function sendVerificationEmail(user?: FirebaseUser) {
  // If user is provided, use it, otherwise use current user
  const userToVerify = user || (auth && auth.currentUser);
  
  if (!userToVerify) {
    logger.error("No user is signed in or provided");
    return Promise.reject(new Error("No user is signed in or provided"));
  }
  
  try {
    await sendEmailVerification(userToVerify);
    logger.debug("Verification email sent");
    return true;
  } catch (error) {
    logger.error("Error sending verification email:", error);
    throw error;
  }
}

// Function to sign out
export async function logout() {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    await signOut(auth);
    logger.debug("User signed out successfully");
    return true;
  } catch (error) {
    logger.error("Error signing out:", error);
    throw error;
  }
}

// Alias for compatibility
export async function logoutUser() {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    await signOut(auth);
    logger.debug("User signed out successfully");
    return true;
  } catch (error) {
    logger.error("Error signing out:", error);
    throw error;
  }
}

// Function to send password reset email
export async function resetPassword(email: string) {
  logger.debug("resetPassword called");
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    logger.debug("Calling Firebase sendPasswordResetEmail...");
    await sendPasswordResetEmail(auth, email);
    logger.debug("Firebase sendPasswordResetEmail completed successfully");
    return true;
  } catch (error) {
    logger.error("Error sending password reset email:", error);
    throw error;
  }
}

// Function to verify password reset code
export async function verifyResetCode(actionCode: string) {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    const email = await verifyPasswordResetCode(auth, actionCode);
    logger.debug("Password reset code verified");
    return email;
  } catch (error) {
    logger.error("Error verifying reset code:", error);
    throw error;
  }
}

// Function to confirm password reset
export async function confirmResetPassword(actionCode: string, newPassword: string) {
  if (!auth) {
    logger.error("Firebase Auth not initialized");
    return Promise.reject(new Error("Firebase Auth not initialized"));
  }
  try {
    await confirmPasswordReset(auth, actionCode, newPassword);
    logger.debug("Password reset confirmed");
    return true;
  } catch (error) {
    logger.error("Error confirming password reset:", error);
    throw error;
  }
}

// Safe wrapper functions that handle Firebase not being initialized
export async function safeResetPassword(email: string) {
  try {
    return await resetPassword(email);
  } catch (error) {
    logger.error("Safe reset password error:", error);
    throw error;
  }
}

export async function safeRegisterWithEmail(email: string, password: string) {
  try {
    return await registerWithEmail(email, password);
  } catch (error) {
    logger.error("Safe register error:", error);
    throw error;
  }
}

export async function safeSignInWithEmail(email: string, password: string) {
  try {
    return await signInWithEmail(email, password);
  } catch (error) {
    logger.error("Safe sign in error:", error);
    throw error;
  }
}

export async function safeLogoutUser() {
  try {
    return await logout();
  } catch (error) {
    logger.error("Safe logout error:", error);
    throw error;
  }
}

// Sync password with database function
export async function syncPasswordWithDatabase(email: string, newPassword: string) {
  try {
    void email;
    void newPassword;
    // This would typically send the new password to your backend to update the user's password
    // For now, this is a placeholder - you might want to implement actual backend sync
    logger.debug("Syncing password with database");
    return true;
  } catch (error) {
    logger.error("Error syncing password with database:", error);
    throw error;
  }
}

// Format Firebase error messages
export function formatFirebaseError(error: unknown): string {
  if (!error) return "An unknown error occurred";
  
  // Handle Firebase AuthError
  if (typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string') {
    const errorCode = error.code;
    
    // Map common Firebase error codes to user-friendly messages
    const errorMessages: Record<string, string> = {
      'auth/email-already-in-use': 'This email is already registered. Please sign in instead.',
      'auth/invalid-email': 'Please enter a valid email address.',
      'auth/user-disabled': 'This account has been disabled. Please contact support.',
      'auth/user-not-found': 'No account found with this email address.',
      'auth/wrong-password': 'Incorrect password. Please try again.',
      'auth/weak-password': 'Password is too weak. Please use a stronger password.',
      'auth/popup-closed-by-user': 'The sign-in popup was closed before completing the sign in.',
      'auth/requires-recent-login': 'Please sign in again to complete this action.',
      'auth/too-many-requests': 'Too many unsuccessful attempts. Please try again later.',
      'auth/network-request-failed': 'A network error occurred. Please check your connection and try again.',
    };
    
    return errorMessages[errorCode] || `Authentication error: ${errorCode}`;
  }
  
  // Handle general error with message property
  if (error instanceof Error) {
    return error.message;
  }
  
  // Fall back to stringifying the error
  return String(error);
}

export {
  app,
  auth,
  googleProvider
};