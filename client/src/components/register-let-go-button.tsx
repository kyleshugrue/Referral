import React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { getRegistrationData, clearRegistrationData } from "@/lib/registration-helpers";
import * as firebaseLib from "@/lib/firebase";
import { logger } from "@/lib/logger";

// Add type declaration for window property
declare global {
  interface Window {
    __networkFallbackLink?: HTMLAnchorElement;
    __forceRedirectToNetwork?: boolean;
    __networkNavigationInitiated?: boolean;
    __networkRedirectTimeouts?: NodeJS.Timeout[];
  }
}

interface RegisterLetGoButtonProps {
  parentHandleCreateAccount?: () => Promise<void>;
}

/**
 * A standalone component for the "Let's Go" button that completes the registration process
 * Can work independently or with the parent component's handleCreateAccount function
 *
 * SECURITY NOTE: the localStorage flags set below (`emailVerified`,
 * `emailVerificationHandled`, `registrationRedirectReady`, etc.) are CLIENT-SIDE UX
 * hints only — they suppress redundant verification redirects/screens during
 * the registration flow. They are NOT a security boundary: all actual
 * verification and authorization is enforced server-side, and the backend
 * never trusts these values.
 */
export function RegisterLetGoButton({ parentHandleCreateAccount }: RegisterLetGoButtonProps) {
  const { toast } = useToast();
  const { registerMutation } = useAuth();
  const [loading, setLoading] = React.useState(false);
  
  // Mark the verification step as handled in this flow (UI hint only)
  React.useEffect(() => {
    localStorage.setItem('emailVerificationHandled', 'true');
  }, []);
  
  // Simplified navigation function that avoids multiple redirects
  const navigateToNetwork = () => {
    try {
      logger.debug("NAVIGATION: Let's Go button navigation function triggered");
      
      // Record UI-state hints so the user isn't re-prompted mid-flow
      localStorage.setItem('registrationComplete', 'true');
      localStorage.setItem('emailVerificationHandled', 'true');
      localStorage.setItem('emailVerificationUiComplete', 'true');
      localStorage.setItem('registrationRedirectReady', 'true');
      
      // Clear all registration-related flags
      localStorage.removeItem('registrationInProgress');
      localStorage.removeItem('profileCompletion');
      localStorage.removeItem('pendingRegistrationData');
      localStorage.removeItem('tempUserData');
      localStorage.removeItem('emailVerificationSent');
      localStorage.removeItem('forceRegistrationFlow'); // Clear our production safeguard flag
      
      // Cancel any existing navigation timeouts
      if (window.__networkRedirectTimeouts) {
        window.__networkRedirectTimeouts.forEach(timeout => clearTimeout(timeout));
        window.__networkRedirectTimeouts = [];
      }
      
      // Mark navigation as initiated to prevent multiple redirects
      window.__networkNavigationInitiated = true;
      
      // SINGLE NAVIGATION METHOD: Use history API for smoother transition
      // This avoids page reloads and provides a cleaner user experience
      logger.debug("NAVIGATION: Using history API for smooth transition to root path");
      window.history.pushState({}, "Network", "/");
      window.dispatchEvent(new PopStateEvent('popstate'));
      
      // Set a single backup method with a longer timeout
      // This will only trigger if the history API navigation doesn't work
      const backupTimeout = setTimeout(() => {
        if (window.location.pathname !== '/') {
          logger.debug("NAVIGATION: History API navigation failed, using fallback");
          window.location.replace('/');
        }
      }, 300);
      
      window.__networkRedirectTimeouts = [backupTimeout];
      
    } catch (err) {
      logger.error("Navigation failed:", err);
      
      // Last resort - use replace to avoid adding to history
      window.location.replace('/');
    }
  };
  
  const handleClick = async () => {
    try {
      setLoading(true);
      
      // If the parent component provided a handleCreateAccount function, use it
      if (parentHandleCreateAccount) {
        logger.debug("Using parent component's handleCreateAccount function");
        await parentHandleCreateAccount();
        
        // Record UI-state hints to ensure smooth navigation
        localStorage.setItem('emailVerificationUiComplete', 'true');
        localStorage.setItem('emailVerificationHandled', 'true');
        
        // Navigate to the network page
        navigateToNetwork();
        return;
      }
      
      // Fallback to the standalone implementation if no parent handler is provided
      logger.debug("Using standalone registration implementation");
      
      // Get all registration data from localStorage
      const formData = getRegistrationData();
      if (!formData) {
        toast({
          title: "Missing registration data",
          description: "Could not find your registration information. Please restart the registration process.",
          variant: "destructive"
        });
        return;
      }
      
      // Parse the stored data
      logger.debug("Retrieved safe registration fields:", Object.keys(formData));
      
      // Create user data for registration with all required fields
      const userData = {
        email: formData.email,
        username: formData.email,
        fullName: formData.fullName || "",
        birthday: formData.birthday || "",
        
        // Required fields with defaults if missing
        title: formData.title || "Professional",
        currentLocation: formData.currentLocation || "Remote",
        industry: formData.industry || "Software Development",
        currentCompany: formData.currentCompany || "Not Specified",
        yearsOfExperience: formData.yearsOfExperience || 0,
        matchingRadius: formData.matchingRadius || 0,
        
        // Optional arrays with defaults
        interests: formData.interests || [],
        professionalInterests: formData.professionalInterests || [],
        languages: formData.languages || [],
        desiredLocations: formData.desiredLocations || [],
        desiredCompanies: formData.desiredCompanies || [],
        
        // Optional fields
        bio: formData.bio || "",
        photo: formData.photo || "",
        resumeUrl: formData.resumeUrl || "",
        resumePreviewUrls: formData.resumePreviewUrls || [],
        institution: formData.institution || "",
        educationLevel: formData.educationLevel,
        
        // Boolean flags
        profileVisible: true,
        emailNotifications: true,
        readReceipts: true,
      };
      
      if (!registerMutation || typeof registerMutation.mutateAsync !== 'function') {
        logger.error("Registration mutation is not available");
        throw new Error("Registration service is not available");
      }
      
      // First, check if we already have a user account and we're just updating the profile
      logger.debug("DEBUG: Checking if we're updating an existing profile or creating a new one");
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      const hasExistingUser = user && user.id;
      
      logger.debug("DEBUG: Has existing user?", hasExistingUser, "User ID:", user?.id);
      
      // If we already have a user account, skip the registration call
      if (hasExistingUser) {
        logger.debug("DEBUG: User already exists, skipping registration mutation");
        
        // Verification step already handled — record the UI hints
        localStorage.setItem('emailVerificationUiComplete', 'true');
        localStorage.setItem('emailVerificationHandled', 'true');
      } else {
        try {
          const firebaseUser = firebaseLib.auth?.currentUser;
          if (!firebaseUser) {
            throw new Error("Your registration session expired. Please restart registration.");
          }
          logger.debug("DEBUG: Creating the verified Firebase user profile");
          const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${await firebaseUser.getIdToken(true)}`,
            },
            body: JSON.stringify(userData),
            credentials: 'include',
          });
          if (!response.ok) {
            throw new Error("Registration could not be completed. Please try again.");
          }
          
          // Record the UI hints immediately
          localStorage.setItem('emailVerificationUiComplete', 'true');
          localStorage.setItem('emailVerificationHandled', 'true');
        } catch (mutationError) {
          logger.error("Error in registration:", mutationError);
          throw mutationError; // Re-throw to be caught by the outer try/catch
        }
      }
      
      // Clear all registration data from localStorage
      clearRegistrationData();
      localStorage.removeItem('tempUserData');
      
      // Show success message
      toast({
        title: "Registration complete!",
        description: "Your profile has been saved and your account is now fully set up. Welcome to the platform!",
      });
      
      // Call the dedicated navigation function
      // CRITICAL: This will break out of the async flow and execute navigation synchronously
      navigateToNetwork();
      
      // In case everything fails, try one more approach with a longer timeout
      // This gives the server more time to process the registration before redirecting
      setTimeout(() => {
        logger.debug("LAST RESORT: Final navigation attempt after 2 seconds");
        window.location.replace('/network');
      }, 2000);
      
    } catch (error: unknown) {
      logger.error("Error during registration:", error);
      const errorMessage = error instanceof Error ? error.message : undefined;
      toast({
        title: "Registration failed",
        description: errorMessage || "Failed to complete registration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };
  
  // We no longer need this handler since we cleaned up the test button
  // Keeping the declaration to avoid needing to make additional changes

  return (
    <>
      {loading ? (
        <Button
          type="button"
          className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
          disabled={true}
        >
          Processing...
        </Button>
      ) : (
        <div className="relative">
          {/* Hidden link that will be programmatically clicked as a fallback */}
          <a 
            href="/network" 
            id="network-fallback-link" 
            className="hidden" 
            ref={(el) => {
              if (el) {
                // Store reference to the element for potential use
                window.__networkFallbackLink = el;
              }
            }}
          >
            Network Page
          </a>
          
          <Button
            type="button"
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
            onClick={handleClick}
            data-testid="register-let-go-button" // Add test ID for easier testing
          >
            Let's Go!
          </Button>
        </div>
      )}
    </>
  );
}