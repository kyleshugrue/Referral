import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { User as SelectUser, InsertUser } from "@shared/schema";
import { getQueryFn, apiRequest, queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import * as firebaseLib from "../lib/firebase";
import { User as FirebaseUser, onAuthStateChanged } from "firebase/auth";
import { disconnectGlobalWebSocket } from "@/hooks/use-global-websocket";
import { logger } from "@/lib/logger";
import { loadTokens, setTokens, clearTokens, onAccessTokenChange } from "@/lib/token-manager";
import { decidePostRegistrationFlow } from "@/lib/verification-ui-state";
import { savePendingRegistrationData } from "@/lib/registration-helpers";
import { Capacitor } from "@capacitor/core";

type LoginData = { email: string; password: string };

type RegisterData = InsertUser & { password: string };

type AuthContextType = {
  user: SelectUser | null;
  firebaseUser: FirebaseUser | null;
  isLoading: boolean;
  error: Error | null;
  accessToken: string | null;
  loginMutation: UseMutationResult<SelectUser, Error, LoginData>;
  loginWithGoogleMutation: UseMutationResult<SelectUser, Error, void>;
  logoutMutation: UseMutationResult<void, Error, void>;
  registerMutation: UseMutationResult<SelectUser, Error, RegisterData>;
  resetPasswordMutation: UseMutationResult<void, Error, string>;
  sendPasswordResetEmail: (email: string) => Promise<void>;
};

export const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [firebaseLoading, setFirebaseLoading] = useState(true);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [tokenLoadingComplete, setTokenLoadingComplete] = useState(false);
  
  // Hydrate tokens on mount (iOS only - web uses session cookies)
  useEffect(() => {
    logger.debug('[AuthProvider] Starting token initialization...');
    
    // Load tokens from SecureStorage (iOS) or skip (web)
    loadTokens().then(tokens => {
      if (tokens) {
        logger.debug('[AuthProvider] Tokens loaded from storage');
        setAccessToken(tokens.accessToken);
      } else {
        logger.debug('[AuthProvider] No tokens found (web uses session cookies)');
      }
      
      // Mark token loading as complete
      logger.debug('[AuthProvider] Token initialization complete');
      setTokenLoadingComplete(true);
    }).catch(error => {
      logger.error('[AuthProvider] Error loading tokens:', error);
      // Mark as complete even on error so app doesn't hang
      setTokenLoadingComplete(true);
    });
    
    // Subscribe to token changes
    const unsubscribe = onAccessTokenChange(token => {
      logger.debug('[AuthProvider] Access token changed:', { hasToken: !!token });
      setAccessToken(token);
      
      // CRITICAL FIX: Only clear user data on iOS native when token is null
      // On web, accessToken is ALWAYS null because web uses session cookies for authentication
      // This prevents the bug where page refreshes on web would incorrectly trigger logout
      const isNativeIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
      
      if (isNativeIOS) {
        // iOS Native: If token is cleared (null) and user data exists, trigger logout
        // This handles automatic logout when token refresh fails on mobile
        const currentUser = queryClient.getQueryData(['/api/user']);
        if (token === null && currentUser) {
          logger.warn('[Auth] Access token cleared on iOS native, triggering logout');
          // Clear user state to trigger logout flow
          queryClient.setQueryData(['/api/user'], null);
        }
      } else {
        logger.debug('[Auth] Web platform - ignoring null token (web uses session cookies)');
      }
    });
    
    return unsubscribe;
  }, []);
  
  // Sync Firebase user with our backend
  const syncUserWithBackend = useCallback(async (fbUser: FirebaseUser) => {
    logger.debug("🔄 [SYNC DEBUG] Starting syncUserWithBackend...", {
      uid: fbUser.uid,
      email: fbUser.email,
      emailVerified: fbUser.emailVerified,
      displayName: fbUser.displayName,
      timestamp: new Date().toISOString()
    });
    
    try {
      // Get Firebase auth token
      logger.debug("🎟️ [SYNC DEBUG] Getting Firebase ID token...");
      const token = await fbUser.getIdToken();
      logger.debug("✅ [SYNC DEBUG] Firebase ID token obtained successfully");
      
      // Check email verification status
      const isEmailVerified = fbUser.emailVerified;
      logger.debug(`📧 [SYNC DEBUG] Initial email verification status: ${isEmailVerified ? 'Verified' : 'Not Verified'}`);
      
      // Force reload the user to get the latest verification status
      logger.debug("🔄 [SYNC DEBUG] Reloading Firebase user for latest verification status...");
      await fbUser.reload();
      const currentUser = firebaseLib.auth?.currentUser;
      const updatedVerificationStatus = currentUser?.emailVerified || false;
      
      logger.debug(`📧 [SYNC DEBUG] After reload - verification status: ${updatedVerificationStatus ? 'Verified' : 'Not Verified'}`);
      
      if (updatedVerificationStatus !== isEmailVerified) {
        logger.debug(`📧 [SYNC DEBUG] Email verification status changed from ${isEmailVerified} to ${updatedVerificationStatus}`);
      }
      
      // Email is verified, proceed with normal authentication
      if (updatedVerificationStatus) {
        logger.debug("✅ [SYNC DEBUG] Email is verified, proceeding with authentication");
        logger.debug("🧹 [SYNC DEBUG] Clearing old bypass flags to ensure clean state");
      }
      
      // BINARY AUTHENTICATION: Only proceed with backend sync if email is verified
      if (!updatedVerificationStatus) {
        logger.debug("🚫 [SYNC DEBUG] Email not verified, cannot proceed with backend sync");
        logger.debug("🌐 [SYNC DEBUG] Current pathname:", window.location.pathname);

        // Allow user to stay logged in on verification page to resend email
        if (window.location.pathname === '/verify-email') {
          logger.debug("✅ [SYNC DEBUG] User on verification page, staying logged in for email resend");
          return; // Don't proceed with backend sync
        }

        // For other pages, user should be on verification page
        logger.debug("🔄 [SYNC DEBUG] User should be redirected to email verification page");
        return;
      }

      // Only proceed with backend sync if email is verified
      logger.debug("🚀 [SYNC DEBUG] Making POST request to /api/firebase-auth...");
      
      // Detect platform for JWT token flow
      const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
      const requestPayload = { 
        token,
        email: fbUser.email,
        displayName: fbUser.displayName || "",
        photoURL: fbUser.photoURL || "",
        emailVerified: updatedVerificationStatus,
        platform: isIOS ? 'ios' : 'web' // Include platform for iOS token generation
      };
      logger.debug("📤 [SYNC DEBUG] Request payload:", { 
        ...requestPayload, 
        hasToken: !!token
      });
      
      const res = await apiRequest("POST", "/api/firebase-auth", requestPayload);
      
      logger.debug("📡 [SYNC DEBUG] Backend response:", {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText
      });
      
      if (!res.ok) {
        const errorText = await res.text();
        logger.error("❌ [SYNC DEBUG] Backend sync failed:", {
          status: res.status,
          statusText: res.statusText,
          errorText
        });
        logger.error("❌ [SYNC DEBUG] This is likely the source of the auth issue!");
        return;
      }
      
      // Update the user data in our cache
      logger.debug("📥 [SYNC DEBUG] Parsing successful backend response...");
      const responseData = await res.json();
      
      // Extract JWT tokens from response and get user data
      // Response structure: { ...userFields, accessToken, refreshToken, deviceId }
      const { accessToken: jwtAccessToken, refreshToken: jwtRefreshToken, deviceId: jwtDeviceId, ...userData } = responseData;
      
      logger.debug("✅ [SYNC DEBUG] Backend sync successful! User data received");
      
      // Save JWT tokens if present (iOS native only - web uses session cookies)
      if (jwtAccessToken && jwtRefreshToken) {
        try {
          logger.debug("🔐 [SYNC DEBUG] Saving JWT tokens to SecureStorage...", { hasDeviceId: !!jwtDeviceId });
          await setTokens({
            accessToken: jwtAccessToken,
            refreshToken: jwtRefreshToken,
            deviceId: jwtDeviceId, // Include deviceId for token refresh
            expiresAt: Date.now() + 15 * 60 * 1000 // Default 15 min, setTokens will extract from JWT
          });
          
          // Update AuthContext state so API client uses JWT tokens
          setAccessToken(jwtAccessToken);
          
          logger.debug("✅ [SYNC DEBUG] JWT tokens saved successfully");
        } catch (tokenError) {
          logger.error("❌ [SYNC DEBUG] Failed to save JWT tokens:", tokenError);
          
          // Fall back to clearing tokens on error
          await clearTokens();
          setAccessToken(null);
          
          toast({
            variant: "destructive",
            title: "Authentication Error",
            description: "Failed to save authentication tokens. Please try logging in again."
          });
          
          return;
        }
      } else {
        logger.debug("ℹ️ [SYNC DEBUG] No JWT tokens in response (web uses session cookies)");
      }
      
      // CRITICAL: Set the cache data and mark it as fresh
      logger.debug("💾 [SYNC DEBUG] Updating React Query cache with user data...");
      queryClient.setQueryData(["/api/user"], userData);
      logger.debug("✅ [SYNC DEBUG] Cache updated successfully - sync complete!");
      
    } catch (error) {
      logger.error("💥 [SYNC DEBUG] Critical error in syncUserWithBackend:", {
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      });
      logger.error("💥 [SYNC DEBUG] This error prevents backend session establishment!");
    }
  }, [toast]);

  // Listen for Firebase auth state changes
  useEffect(() => {
    const fbAuth = firebaseLib.auth;
    if (fbAuth) {
      const unsubscribe = onAuthStateChanged(fbAuth, (user) => {
        logger.debug("🔐 [AUTH DEBUG] Firebase auth state changed:", {
          userExists: !!user,
          uid: user?.uid,
          email: user?.email,
          emailVerified: user?.emailVerified,
          timestamp: new Date().toISOString()
        });

        setFirebaseUser(user);
        setFirebaseLoading(false);

        // If Firebase user is logged in but we don't have user data,
        // sync with our backend
        if (user) {
          logger.debug("🔄 [AUTH DEBUG] Firebase user detected, starting backend sync...");
          syncUserWithBackend(user);
        } else {
          logger.debug("🚫 [AUTH DEBUG] No Firebase user, skipping backend sync");
        }
      });

      return () => unsubscribe();
    } else {
      logger.debug("⚠️ [AUTH DEBUG] Firebase auth not available, setting loading to false");
      setFirebaseLoading(false);
    }
  }, [syncUserWithBackend]);
  
  // Provide fallback implementations for Firebase functions in case they aren't available
  const safeLoginWithEmail = async (email: string, password: string) => {
    try {
      if (typeof firebaseLib.signInWithEmail === 'function') {
        return await firebaseLib.signInWithEmail(email, password);
      } else {
        throw new Error("Firebase authentication is not available");
      }
    } catch (error) {
      logger.error("Firebase login error:", error);
      throw error;
    }
  };
  
  const safeLoginWithGoogle = async (): Promise<FirebaseUser | null> => {
    try {
      if (typeof firebaseLib.signInWithGoogle === 'function') {
        return await firebaseLib.signInWithGoogle();
      } else {
        throw new Error("Firebase authentication is not available");
      }
    } catch (error) {
      logger.error("Firebase Google login error:", error);
      throw error;
    }
  };
  
  const safeRegisterWithEmail = async (email: string, password: string) => {
    try {
      if (typeof firebaseLib.registerWithEmail === 'function') {
        return await firebaseLib.registerWithEmail(email, password);
      } else {
        throw new Error("Firebase authentication is not available");
      }
    } catch (error) {
      logger.error("Firebase registration error:", error);
      throw error;
    }
  };
  
  const safeLogoutUser = async () => {
    try {
      if (typeof firebaseLib.logout === 'function') {
        return await firebaseLib.logout();
      } else {
        throw new Error("Firebase authentication is not available");
      }
    } catch (error) {
      logger.error("Firebase logout error:", error);
      throw error;
    }
  };

  const safeResetPassword = async (email: string) => {
    try {
      if (typeof firebaseLib.safeResetPassword === 'function') {
        return await firebaseLib.safeResetPassword(email);
      } else {
        throw new Error("Firebase authentication is not available");
      }
    } catch (error) {
      logger.error("Firebase reset password error:", error);
      throw error;
    }
  };
  
  const {
    data: user,
    error,
    isLoading: userDataLoading,
  } = useQuery<SelectUser | null, Error>({
    queryKey: ["/api/user"],
    queryFn: async (context) => {
      const originalFn = getQueryFn<SelectUser | null>({ on401: "returnNull" });
      logger.debug("📊 [QUERY DEBUG] Fetching /api/user data...", {
        timestamp: new Date().toISOString(),
        firebaseLoading,
        firebaseUser: firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email } : null
      });
      
      try {
        const result = await originalFn(context);
        logger.debug("✅ [QUERY DEBUG] /api/user fetch successful:", {
          hasResult: !!result,
          userId: result?.id,
          registrationCompleted: result?.registrationCompleted,
          emailVerified: result?.emailVerified
        });
        return result;
      } catch (error) {
        logger.error("❌ [QUERY DEBUG] /api/user fetch failed:", {
          error: error instanceof Error ? error.message : error,
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    },
    staleTime: 30000, // 30 seconds - prevents duplicate parallel requests on page load
    refetchOnMount: 'always', // Refetch when component mounts but deduplicate in-flight requests
    refetchOnWindowFocus: true,
    enabled: !firebaseLoading && tokenLoadingComplete, // Wait for both Firebase auth and token loading
  });

  const isLoading = firebaseLoading || !tokenLoadingComplete || userDataLoading;

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginData) => {
      logger.debug("Attempting login with:", { email: credentials.email, password: '[REDACTED]' });
      
      // Login with Firebase
      try {
        const userCredential = await safeLoginWithEmail(credentials.email, credentials.password);
        
        // Validate userCredential first
        if (!userCredential) {
          throw new Error("Authentication failed - please try again");
        }

        // CRITICAL: Check email verification status - no bypasses allowed
        if (!userCredential.emailVerified) {
          logger.debug("User's email is not verified, redirecting to verification page while keeping user logged in");
          
          // Clear any bypass flags that might exist
          try {
            localStorage.removeItem('emailVerificationUiComplete');
            localStorage.removeItem('emailVerificationHandled');
            localStorage.removeItem('emailVerified');
            localStorage.removeItem('registrationComplete');
          } catch (e) {
            logger.error("Error clearing bypass flags:", e);
          }
          
          // DON'T sign out the user - keep them logged in so they can resend verification email
          // Redirect without putting identity values in browser history, logs,
          // referrers, or copied URLs.
          window.location.href = '/verify-email';
          
          throw new Error("Please verify your email before logging in.");
        }

        // Get Firebase token and authenticate with backend
        let token;
        try {
          token = await userCredential.getIdToken();
        } catch (tokenError) {
          logger.error("Failed to get Firebase token:", tokenError);
           throw new Error("Authentication token error - please try again", { cause: tokenError });
        }
        
        // Send Firebase token to backend to establish session
        // Detect platform for JWT token flow
        const isIOSLogin = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
        const authRes = await apiRequest("POST", "/api/firebase-auth", {
          token,
          email: userCredential.email,
          displayName: userCredential.displayName,
          photoURL: userCredential.photoURL,
          platform: isIOSLogin ? 'ios' : 'web' // Include platform for iOS token generation
        });
        
        if (!authRes.ok) {
          const errorData = await authRes.json();
          throw new Error(errorData.message || "Failed to authenticate with server");
        }
        
        const userData = await authRes.json();
        
        // If user needs registration (new user), redirect to complete profile
        if (userData.needsRegistration) {
          throw new Error("Account not found. Please register first.");
        }
        
        return userData;
      } catch (error: unknown) {
        logger.error("Login error:", error);
        
        // Handle Firebase specific errors
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
        let errorMessage = error instanceof Error ? error.message : "Login failed. Please try again.";
        
        if (errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password') {
          errorMessage = "Invalid email or password";
        } else if (errorCode === 'auth/too-many-requests') {
          errorMessage = "Too many unsuccessful login attempts. Please try again later.";
        } else if (errorCode === 'auth/user-disabled') {
          errorMessage = "This account has been disabled";
        }
        
         throw new Error(errorMessage, { cause: error });
      }
    },
    onSuccess: async (userData: SelectUser & { accessToken?: string; refreshToken?: string; deviceId?: string; expiresAt?: number }) => {
      logger.debug("Login successful for user, id:", userData.id);
      
      // Check if backend returned JWT tokens (mobile flow)
      if (userData.accessToken && userData.refreshToken) {
        logger.debug('[AuthProvider] JWT tokens received from backend (mobile flow)', { hasDeviceId: !!userData.deviceId });
        
        try {
          await setTokens({
            accessToken: userData.accessToken,
            refreshToken: userData.refreshToken,
            deviceId: userData.deviceId, // Include deviceId for token refresh
            expiresAt: userData.expiresAt || Date.now() + 15 * 60 * 1000, // Default 15 min
          });
          setAccessToken(userData.accessToken);
          logger.debug('[AuthProvider] JWT tokens stored successfully');
        } catch (error) {
          logger.error('[AuthProvider] Error storing JWT tokens:', error);
        }
      } else {
        logger.debug('[AuthProvider] No JWT tokens in response (web session-only flow)');
      }
      
      // BINARY SYSTEM: Registration completion is stored in database, not localStorage
      logger.debug("LOGIN: User authentication completed, registration status from database:", {
        emailVerificationStarted: userData.emailVerificationStarted,
        emailVerified: userData.emailVerified,
        registrationCompleted: userData.registrationCompleted,
        userId: userData.id
      });
      
      // CRITICAL: Ensure the user data with registration status is properly cached
      queryClient.setQueryData(["/api/user"], userData);
      
      // AUTO-CORRECTION: Fix inconsistent registration states
      
      // Clear any stale localStorage flags that might conflict with database state
      try {
        const conflictingFlags = ['registrationComplete', 'forceRegistrationFlow'];
        conflictingFlags.forEach(flag => {
          if (localStorage.getItem(flag)) {
            logger.debug(`LOGIN: Clearing potentially conflicting localStorage flag: ${flag}`);
            localStorage.removeItem(flag);
          }
        });
      } catch (e) {
        logger.error("Error clearing conflicting localStorage flags:", e);
      }
    },
    onError: (error: Error) => {
      logger.error("Login error:", error);
      // Don't show any toast errors during the login process - let the form handle it
    },
  });

  const loginWithGoogleMutation = useMutation({
    mutationFn: async () => {
      logger.debug("Attempting Google login/signup");
      
      // Check if it's a login from login page or signup from register page
      const isSignup = window.location.pathname.includes('register');
      logger.debug("Is this a signup attempt?", isSignup);
      
      // Get previous auth state for comparison
      const previousUser = firebaseLib.auth?.currentUser;
      const previousUid = previousUser?.uid;
      
      // Login with Google via Firebase
      try {
        // This will either sign in an existing user or create a new one
        const googleResult = await safeLoginWithGoogle();
        const isNewUser = previousUid !== googleResult?.uid;
        
        logger.debug("Google auth result:", {
          uid: googleResult?.uid,
          isNewUser: isNewUser,
          emailVerified: googleResult?.emailVerified
        });
        
        // If this is a signup (from register page) and appears to be a new user
        if (isSignup || isNewUser) {
          logger.debug("This appears to be a new user signup via Google");
          
          // For new users in the signup flow, we want to treat this like a regular signup
          // Google accounts are pre-verified, but we want to enforce our registration flow
          // Save registration data to continue with profile setup
          try {
            const userData = {
              email: googleResult?.email,
              fullName: googleResult?.displayName || "New User",
              firebaseUid: googleResult?.uid,
              emailVerified: true, // Google accounts are pre-verified
              photo: googleResult?.photoURL || "/placeholder.jpg"
            };
            
            // Store pending registration data for multi-step process
            savePendingRegistrationData(userData);
            
            // Since Google accounts are pre-verified, mark the verification UI step as done
            localStorage.setItem('emailVerificationUiComplete', 'true');
            localStorage.setItem('emailVerificationHandled', 'true');
            
            // Redirect to multi-step registration at step 1 (AI preferences) since email is verified
            setTimeout(() => {
              window.location.href = '/multi-step-register?step=1&verified=true';
            }, 1000);
            
            // Return simplified user data for the mutation result
            return { email: googleResult?.email, id: 0 };
          } catch (storageError) {
            logger.error("Error saving Google user data for registration:", storageError);
          }
        }
        
        // For existing users or login flow, proceed normally
        const res = await apiRequest("GET", "/api/user");
        if (!res.ok) {
          throw new Error("Failed to get user data from server");
        }
        return await res.json();
      } catch (error: unknown) {
        logger.error("Google login error:", error);
        throw new Error(error instanceof Error ? error.message : "Google login failed", { cause: error });
      }
    },
    onSuccess: (user: SelectUser) => {
      logger.debug("Google login successful for user, id:", user.id);
      queryClient.setQueryData(["/api/user"], user);
      
      // Check if this is a new user registration (id will be 0)
      if (user.id === 0) {
        logger.debug("This is a new Google user registration, redirecting to multi-step flow");
        // Redirect is already handled in the mutationFn
        return;
      }
      
      // For existing users, check if profile is complete
      if (user.title === "New User" || 
          user.currentLocation === "Not specified" || 
          user.industry === "Other" ||
          user.currentCompany === "Not specified") {
        logger.debug("Redirecting to multi-step registration");
        // Redirect to multi-step registration page instead of profile completion
        window.location.href = "/multi-step-register?step=1&verified=true";
      }
    },
    onError: (error: Error) => {
      logger.error("Google login error:", error);
      toast({
        title: "Google login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (userData: RegisterData) => {
      logger.debug("Attempting registration with:", { ...userData, password: '[REDACTED]' });
      
      // Register with Firebase
      try {
        logger.debug("Calling Firebase registerWithEmail");
        const userCredential = await safeRegisterWithEmail(userData.email, userData.password);
        logger.debug("Firebase registerWithEmail successful, has credential:", !!userCredential);
        
        // Get the current user
        const currentUser = firebaseLib.auth?.currentUser;
        if (currentUser) {
          const fbUser = currentUser;
          
          // Send verification email
          logger.debug("Sending verification email");
          try {
            if (currentUser) {
              // Use sendVerificationEmail helper function
              await firebaseLib.sendVerificationEmail(currentUser);
              logger.debug("Verification email sent successfully");
              
              // Create a pending registration data to store in localStorage
              const pendingData = {
                email: userData.email,
                fullName: userData.fullName,
                firebaseUid: fbUser.uid
              };
              
              // Save the pending registration data
              savePendingRegistrationData(pendingData);
              
              // Save verification information but don't redirect
              logger.debug("Verification email sent, proceeding with registration");
              
              // Flag for any other components that might need to know
              localStorage.setItem('emailVerificationSent', 'true');
            } else {
              logger.warn("currentUser is null, cannot send verification email");
            }
          } catch (verifyError) {
            logger.error("Error sending verification email:", verifyError);
            // Continue with registration even if email verification fails
          }
          
          // Do NOT create user in backend yet - wait for email verification
          logger.debug("Skipping backend user creation until email verification is complete");
          
          // Store all the registration data for later use after verification
          const { password, ...registrationFields } = userData;
          void password;
          const completeUserData = {
            ...registrationFields,
            firebaseUid: fbUser.uid,
            // CRITICAL: Never add fake defaults - only use actual user input
            title: userData.title || "",
            currentLocation: userData.currentLocation || "",
            industry: userData.industry || "", 
            currentCompany: userData.currentCompany || "",
            yearsOfExperience: userData.yearsOfExperience || 0,
            // Ensure array fields are properly included
            interests: Array.isArray(userData.interests) ? userData.interests : (userData.interests ? [userData.interests] : []),
            professionalInterests: Array.isArray(userData.professionalInterests) ? userData.professionalInterests : (userData.professionalInterests ? [userData.professionalInterests] : []),
            languages: Array.isArray(userData.languages) ? userData.languages : (userData.languages ? [userData.languages] : []),
            desiredLocations: Array.isArray(userData.desiredLocations) ? userData.desiredLocations : (userData.desiredLocations ? [userData.desiredLocations] : []),
            desiredCompanies: Array.isArray(userData.desiredCompanies) ? userData.desiredCompanies : (userData.desiredCompanies ? [userData.desiredCompanies] : [])
          };
          
          // Store this in localStorage so we can complete registration after verification
          savePendingRegistrationData(completeUserData);
          
          // Return minimal data to indicate we need verification
          // Cast to SelectUser type but mark for verification
          return {
            id: 0, // Temporary ID since user isn't created in backend yet
            email: userData.email,
            fullName: userData.fullName,
            firebaseUid: fbUser.uid,
            password: '', // Password not stored in client
            title: '',
            currentLocation: '',
            industry: '',
            currentCompany: '',
            yearsOfExperience: 0,
            bio: '',
            photo: '',
            resumeUrl: '',
            desiredLocations: [],
            desiredCompanies: [],
            interests: [],
            professionalInterests: [],
            languages: [],
            institution: '',
            resumePreviewUrls: [],
            lastSeen: new Date().toISOString(),
            isOnline: false,
            lastMessageTime: null,
            profileViews: 0,
            connectionCount: 0,
            hideFromSearch: false,
            readReceipts: true,
            redirectingToVerification: true,
            needsEmailVerification: true
          } as unknown as SelectUser & { redirectingToVerification: boolean; needsEmailVerification: boolean };
        } else {
          logger.error("No current user after registration");
          throw new Error("Failed to create user account");
        }
      } catch (error: unknown) {
        logger.error("Firebase registration error:", error);
        
        // Handle Firebase specific errors
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
        let errorMessage = "Registration failed. Please try again.";
        
        if (errorCode === 'auth/email-already-in-use') {
          errorMessage = "Email is already in use";
        } else if (errorCode === 'auth/invalid-email') {
          errorMessage = "Invalid email address";
        } else if (errorCode === 'auth/weak-password') {
          errorMessage = "Password is too weak";
        }
        
         throw new Error(errorMessage, { cause: error });
      }
    },
    onSuccess: (user: SelectUser) => {
      logger.debug("Registration successful for user, id:", user.id);
      
      // Clear any existing connection request cache for a clean slate
      try {
        localStorage.removeItem('pendingConnectionRequests');
        logger.debug("Cleared connection request cache for new user");
      } catch (e) {
        logger.error("Error clearing connection request cache:", e);
      }
      
      // If the redirectingToVerification flag was set in the mutation function,
      // we're already redirecting, so don't do anything else
      if ('redirectingToVerification' in user) {
        logger.debug("Registration mutation completed successfully, redirecting to verification page");
        toast({
          title: "Account created!",
          description: "Please check your email to verify your account before continuing.",
        });
        
        // Force redirect to verification page
        setTimeout(() => {
          window.location.href = '/verify-email';
        }, 1500);
        return;
      }
      
      // Double-check if the user's email is verified from Firebase
      const currentUser = firebaseLib.auth?.currentUser;
      
      // Read client-side verification UI state (UX hints only — never a
      // security boundary; the server enforces real verification).
      const emailVerificationUiComplete = localStorage.getItem('emailVerificationUiComplete') === 'true';
      const emailVerificationHandled = localStorage.getItem('emailVerificationHandled') === 'true';
      const forceNavigateToNetwork = 
        localStorage.getItem('forceNavigateToNetwork') === 'true' || 
        sessionStorage.getItem('forceNavigateToNetwork') === 'true';
      const emailVerifiedFlag = localStorage.getItem('emailVerified') === 'true';
      const registrationRedirectReady = 
        localStorage.getItem('registrationRedirectReady') === 'true' || 
        sessionStorage.getItem('registrationRedirectReady') === 'true';
      
      // Once the in-app verification UI is complete, remember it so the user
      // is not re-prompted on future visits
      if ((currentUser && currentUser.emailVerified) || emailVerificationUiComplete) {
        localStorage.setItem('emailVerificationUiComplete', 'true');
      }
      
      const postRegistrationDecision = decidePostRegistrationFlow(
        currentUser ? currentUser.emailVerified : null,
        {
          emailVerificationHandled,
          emailVerificationUiComplete,
          registrationRedirectReady,
          emailVerifiedFlag,
          forceNavigateToNetwork,
        }
      );
      
      // Redirect flags take priority: the flow already finished
      if (forceNavigateToNetwork || registrationRedirectReady) {
        logger.debug("Registration flow already complete - skipping verification prompt and navigating to network");
        // Skip the verification check and proceed directly to the next block with network navigation
      }
      // Otherwise, prompt for email verification only when it is actually needed
      else if (postRegistrationDecision === 'verify-email') {
        logger.debug("New user email needs verification, redirecting to verification page");
        toast({
          title: "Account created!",
          description: "Please check your email to verify your account before continuing.",
        });
        
        // Store data for when the user returns after verification
        const pendingData = {
          email: user.email,
          fullName: user.fullName,
          firebaseUid: user.firebaseUid
        };
        
        try {
            savePendingRegistrationData(pendingData);
        } catch (storageError) {
          logger.error("Error saving pending registration data:", storageError);
        }
        
        // Immediately redirect to verification page - do not wait
        window.location.href = '/verify-email';
        return; // Return early to prevent setting user data in cache
      }
      
      // DISABLED: Automatic navigation to network page removed to prevent unwanted redirects
      if (forceNavigateToNetwork) {
        logger.debug("Force navigate to network page flag detected - but automatic navigation is disabled");
        // Clear the localStorage flag to prevent this from triggering again
        localStorage.removeItem('forceNavigateToNetwork');
        // (but keep the window.__forceRedirectToNetwork flag for the App.tsx handler)
        localStorage.removeItem('forceNavigateToNetwork');
        
        // Return early to prevent further processing
        return;
      }
      
      queryClient.setQueryData(["/api/user"], user);
    },
    onError: (error: Error) => {
      logger.error("Registration error:", error);
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      logger.debug("Attempting logout");
      try {
        // STEP 1: Revoke all refresh tokens on server (JWT mobile flow)
        if (accessToken) {
          try {
            logger.debug('[Auth] Revoking all refresh tokens on server');
            await fetch('/api/auth/revoke-all', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${accessToken}`,
              },
              credentials: 'include',
            });
            logger.debug('[Auth] All refresh tokens revoked successfully');
          } catch (error) {
            logger.error('[Auth] Error revoking tokens:', error);
            // Continue with logout even if revoke fails (e.g., network error)
          }
        }
        
        // STEP 2: Clear JWT tokens locally (mobile flow)
        logger.debug('[AuthProvider] Clearing JWT tokens');
        await clearTokens();
        setAccessToken(null);
        logger.debug('[AuthProvider] JWT tokens cleared');
        
        // STEP 3: Logout from Firebase
        await safeLogoutUser();
        
        // STEP 4: Logout from our backend session
        const res = await apiRequest("POST", "/api/logout");
        if (!res.ok) {
          logger.warn("Backend logout failed, but Firebase logout succeeded");
        }
      } catch (error) {
        logger.error("Logout error:", error);
        throw error;
      }
    },
    onSuccess: () => {
      logger.debug("Logout successful");
      
      // Clear all registration-related localStorage flags to prevent state mismatch on next login
      try {
        const registrationFlags = [
          'registrationComplete',
          'forceRegistrationFlow',
          'registrationData',
          'pendingRegistrationData',
          'emailVerificationUiComplete',
          'emailVerificationHandled',
          'emailVerified',
          'registrationRedirectReady',
          'forceNavigateToNetwork',
          'emailVerificationSent',
          'pendingConnectionRequests',
          'synergyMatchesRefreshing',
          'synergyMatchesRefreshingStartTime'
        ];
        
        registrationFlags.forEach(flag => {
          localStorage.removeItem(flag);
        });
        
        logger.debug("Logout: Cleared all registration-related localStorage flags");
      } catch (storageError) {
        logger.error("Error clearing localStorage flags during logout:", storageError);
      }

      // Clear all query cache to prevent stale data on next login
      try {
        queryClient.clear();
        logger.debug("Logout: Cleared all cached query data");
      } catch (cacheError) {
        logger.error("Error clearing query cache during logout:", cacheError);
      }

      // Disconnect WebSocket to prevent connection issues on next login
      try {
        disconnectGlobalWebSocket();
        logger.debug("Logout: Disconnected WebSocket connection");
      } catch (wsError) {
        logger.error("Error disconnecting WebSocket during logout:", wsError);
      }
      
      queryClient.setQueryData(["/api/user"], null);
    },
    onError: (error: Error) => {
      logger.error("Logout error:", error);
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (email: string) => {
      logger.debug("Attempting password reset");
      try {
        await safeResetPassword(email);
      } catch (error: unknown) {
        logger.error("Password reset error:", error);
        
        // Handle Firebase specific errors
        const errorCode = error && typeof error === 'object' && 'code' in error ? (error as { code: string }).code : undefined;
        let errorMessage = "Password reset failed. Please try again.";
        
        if (errorCode === 'auth/user-not-found') {
          errorMessage = "No account found with this email address";
        } else if (errorCode === 'auth/invalid-email') {
          errorMessage = "Invalid email address";
        }
        
         throw new Error(errorMessage, { cause: error });
      }
    },
    onSuccess: () => {
      logger.debug("Password reset email sent successfully");
      toast({
        title: "Password reset email sent",
        description: "Check your email for instructions to reset your password",
      });
    },
    onError: (error: Error) => {
      logger.error("Password reset error:", error);
      toast({
        title: "Password reset failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        firebaseUser,
        isLoading,
        error,
        accessToken,
        loginMutation,
        loginWithGoogleMutation,
        logoutMutation,
        registerMutation,
        resetPasswordMutation,
        sendPasswordResetEmail: async (email: string) => {
          logger.debug("sendPasswordResetEmail called in auth hook");
          return await resetPasswordMutation.mutateAsync(email);
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  
  // Create a function to manually refresh user data with forced fetch
  const refreshUserData = async () => {
    logger.debug("Manually refreshing user data with force fetch");
    
    // Always try to refresh if we have either a user or a Firebase user
    if (context.user || context.firebaseUser) {
      // First synchronize Firebase with the server if we have a Firebase user
      if (context.firebaseUser) {
        try {
          // Get fresh token
          const token = await context.firebaseUser.getIdToken(true);
          logger.debug("🎫 [REFRESH DEBUG] Got fresh Firebase token for user data refresh");
          
          // Call Firebase auth endpoint to sync Firebase session with our server session
          logger.debug("🔄 [REFRESH DEBUG] Calling /api/firebase-auth to sync session...");
          // Detect platform for JWT token flow
          const isIOSRefresh = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
          const syncResponse = await fetch('/api/firebase-auth', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token,
              email: context.firebaseUser.email,
              displayName: context.firebaseUser.displayName || "",
              photoURL: context.firebaseUser.photoURL || "",
              emailVerified: context.firebaseUser.emailVerified,
              platform: isIOSRefresh ? 'ios' : 'web' // Include platform for iOS token generation
            }),
            credentials: 'include'
          });
          
          logger.debug("📡 [REFRESH DEBUG] Firebase auth sync response:", {
            ok: syncResponse.ok,
            status: syncResponse.status,
            statusText: syncResponse.statusText
          });
          
          if (syncResponse.ok) {
            logger.debug("✅ [REFRESH DEBUG] Firebase session synced successfully!");
          } else {
            const errorText = await syncResponse.text();
            logger.error("❌ [REFRESH DEBUG] Firebase session sync failed:", {
              status: syncResponse.status,
              statusText: syncResponse.statusText,
              errorText,
              email: context.firebaseUser.email,
              emailVerified: context.firebaseUser.emailVerified
            });
            logger.error("❌ [REFRESH DEBUG] This failed sync will cause 401 errors!");
          }
        } catch (syncError) {
          logger.error("💥 [REFRESH DEBUG] Exception during Firebase session sync:", {
            error: syncError instanceof Error ? syncError.message : syncError,
            stack: syncError instanceof Error ? syncError.stack : undefined
          });
          // Continue with refresh even if sync fails
        }
      }
      
      // Next invalidate the query to clear any cache
      await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      // Then fetch fresh data and update it in the cache with cache-busting headers
      try {
        logger.debug("📥 [REFRESH DEBUG] Calling /api/user after successful session sync...");
        // Create a fetch function manually with cache-busting headers
        const response = await fetch("/api/user", {
          credentials: "include",
          cache: 'no-cache',
          headers: {
            'Pragma': 'no-cache',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
          }
        });
        
        logger.debug("📡 [REFRESH DEBUG] /api/user response:", {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: {
            'set-cookie': response.headers.get('set-cookie'),
            'content-type': response.headers.get('content-type')
          }
        });
        
        if (response.status === 401) {
          logger.error("❌ [REFRESH DEBUG] /api/user returned 401 AFTER successful session sync!");
          logger.error("❌ [REFRESH DEBUG] This indicates a session cookie/timing issue!");
          return null;
        }
        
        if (!response.ok) {
          throw new Error(`Failed to refresh user data: ${response.status}`);
        }
        
        const freshUserData = await response.json();
        
        if (freshUserData) {
          // Update the cache with the fresh data
          queryClient.setQueryData(["/api/user"], freshUserData);
          logger.debug("User data refreshed successfully:", freshUserData);
          
          // Broadcast a custom event to notify components to refresh
          window.dispatchEvent(new CustomEvent('user-data-refreshed', { detail: freshUserData }));
          
          return freshUserData;
        }
      } catch (error) {
        logger.error("Error refreshing user data:", error);
      }
    }
    
    return context.user;
  };
  
  // Function to send password reset email
  const sendPasswordResetEmail = async (email: string) => {
    logger.debug("sendPasswordResetEmail called in auth hook");
    return await context.resetPasswordMutation.mutateAsync(email);
  };
  
  // Function to login with Google
  const loginWithGoogle = async () => {
    return await context.loginWithGoogleMutation.mutateAsync();
  };
  
  return {
    ...context,
    refreshUserData,
    sendPasswordResetEmail,
    loginWithGoogle
  };
}