import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ArrowLeft, ArrowRight, MailCheck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import * as firebaseLib from "../lib/firebase";
import { logger } from "@/lib/logger";
import {
  getPendingRegistrationData,
  saveRegistrationData,
  updatePendingRegistrationData,
} from "@/lib/registration-helpers";

export default function VerifyEmailPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { firebaseUser } = useAuth();
  const [emailVerified, setEmailVerified] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [resendingEmail, setResendingEmail] = useState(false);
  const [emailFromUrl, setEmailFromUrl] = useState('');
  
  // Read the email from the authenticated Firebase user or the short-lived
  // allowlisted registration state, never from the URL.
  useEffect(() => {
    try {
      const pendingData = getPendingRegistrationData();
      const email = firebaseUser?.email || (typeof pendingData?.email === 'string' ? pendingData.email : '');
      
      if (email) {
        setEmailFromUrl(email);
      } else {
        logger.warn("No registration email available for verification page");
        toast({
          title: "Missing information",
          description: "Email address not found. Please go back and try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      logger.error("Error loading verification state:", error);
    }
  }, [firebaseUser?.email, toast]);
  
  // Define handleContinue function
  const handleContinue = useCallback(async () => {
    logger.debug("handleContinue called - preparing to redirect to registration");
    
    // Ensure we have a valid Firebase user before proceeding
    if (!firebaseUser) {
      logger.error("No Firebase user found when trying to continue");
      toast({
        title: "Authentication Error",
        description: "Please log in again to continue registration.",
        variant: "destructive",
      });
      setLocation('/auth/login');
      return;
    }

    // Refresh the Firebase user to ensure we have the latest token
    try {
      await firebaseUser.reload();
      logger.debug("Firebase user refreshed successfully");
    } catch (error) {
      logger.error("Error refreshing Firebase user:", error);
    }

    // Set verification flags
    localStorage.setItem('emailVerificationUiComplete', 'true');
    localStorage.setItem('emailVerificationHandled', 'true');
    
    // Check if we have pending registration data
    try {
      const pendingData = getPendingRegistrationData();
      if (pendingData) {
        // We have pending data, so the user was in the middle of registration
        logger.debug("Found pending registration data, completing backend user creation");
        
        try {
          const parsedData = { ...pendingData, emailVerified: true };
          
          // Create the user in the backend now that email is verified
          logger.debug("Creating user in backend after email verification");
          
          const response = await fetch('/api/register', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              // Force-refresh so the token carries the fresh email_verified claim
              'Authorization': `Bearer ${await firebaseUser.getIdToken(true)}`
            },
            credentials: 'include',
            body: JSON.stringify(parsedData)
          });
          
          if (!response.ok) {
            const errorData = await response.json();
            logger.error("Backend user creation failed:", errorData);
            throw new Error(errorData.message || "Failed to create user account");
          }
          
        await response.json();
          logger.debug("Backend user created successfully");
          
          // Save the complete registration data
          saveRegistrationData(parsedData);
          
          logger.debug("User account created, proceeding to profile completion");
        } catch (parseError) {
          logger.error("Error creating backend user:", parseError);
          toast({
            title: "Registration Error",
            description: "Failed to complete account creation. Please try again.",
            variant: "destructive",
          });
          return;
        }
      }
      
      // Always redirect to multi-step registration regardless of pending data
      logger.debug("Redirecting to multi-step registration with verified=true");
      setLocation('/multi-step-register?step=0&verified=true');
      
    } catch (error) {
      logger.error("Error processing registration after verification:", error);
      // Default to multi-step registration if there's an error
      logger.debug("Error processing registration data, redirecting to multi-step registration");
      setLocation('/multi-step-register?step=0&verified=true');
    }
  }, [setLocation, firebaseUser, toast]);
  
  // Check email verification status on component mount
  useEffect(() => {
    const checkInitialVerificationStatus = async () => {
      // Try to get Firebase user from useAuth hook first, then fallback to direct Firebase auth
      let currentFirebaseUser = firebaseUser;
      
      if (!currentFirebaseUser && firebaseLib.auth) {
        logger.debug("No firebaseUser from useAuth on mount, checking Firebase auth directly");
        currentFirebaseUser = firebaseLib.auth?.currentUser ?? null;
      }
      
      if (currentFirebaseUser) {
        try {
          // Always reload the Firebase user first to get latest status
          await currentFirebaseUser.reload();
          logger.debug("Firebase user reloaded in verify-email-page, verification status:", 
            currentFirebaseUser.emailVerified ? "Verified" : "Not Verified");
          
          // If already verified, update state and auto-continue
          if (currentFirebaseUser.emailVerified) {
            setEmailVerified(true);
            
            // Set the permanent flag to disable email verification redirects
            localStorage.setItem('emailVerificationUiComplete', 'true');
            localStorage.setItem('emailVerificationHandled', 'true');
            
            // Show success message
            toast({
              title: "Email already verified!",
              description: "Your email has been verified. Proceeding to next step...",
            });
            
            // Auto-continue after a short delay
            setTimeout(() => {
              handleContinue();
            }, 1500);
          }
        } catch (error) {
          logger.error("Error reloading Firebase user in verify-email-page:", error);
        }
      } else {
        logger.debug("No Firebase user found on component mount");
      }
    };
    
    checkInitialVerificationStatus();
  }, [firebaseUser, handleContinue, toast]);
  
  // Additional check that runs on interval to keep checking verification status
  useEffect(() => {
    // Only set up timer if not already verified
    if (emailVerified) return;
    
    logger.debug("Setting up periodic verification check");
    
    // Set up a timer to periodically check verification status
    const checkTimer = setInterval(() => {
      // Try to get Firebase user from useAuth hook first, then fallback to direct Firebase auth
      let currentFirebaseUser = firebaseUser;
      
      if (!currentFirebaseUser && firebaseLib.auth) {
        currentFirebaseUser = firebaseLib.auth?.currentUser ?? null;
      }
      
      if (currentFirebaseUser && !emailVerified) {
        logger.debug("Periodic verification check running...");
        currentFirebaseUser.reload()
          .then(() => {
            if (currentFirebaseUser.emailVerified) {
              logger.debug("Email verified during periodic check!");
              setEmailVerified(true);
              
              toast({
                title: "Email verified!",
                description: "Your email has been successfully verified.",
              });
              
              // Set the flag to permanently disable email verification redirects
              localStorage.setItem('emailVerificationUiComplete', 'true');
              localStorage.setItem('emailVerificationHandled', 'true');
              
              // Update any pending registration data
              if (getPendingRegistrationData()) {
                try {
                  updatePendingRegistrationData({ emailVerified: true });
                  logger.debug("Updated pending registration state during periodic check");
                } catch (e) {
                  logger.error("Error updating pending data during periodic check:", e);
                }
              }
              
              // Automatically redirect after verification
              setTimeout(() => {
                handleContinue();
              }, 2000);
            }
          })
          .catch(error => {
            logger.error("Error during periodic verification check:", error);
          });
      }
    }, 5000); // Check every 5 seconds
    
    return () => {
      logger.debug("Clearing periodic verification check");
      clearInterval(checkTimer);
    };
  }, [firebaseUser, emailVerified, toast, handleContinue]);
  
  // Check if email is verified
  const checkEmailVerification = async () => {
    logger.debug("checkEmailVerification called");
    
    // Try to get Firebase user from useAuth hook first, then fallback to direct Firebase auth
    let currentFirebaseUser = firebaseUser;
    
    if (!currentFirebaseUser && firebaseLib.auth) {
      logger.debug("No firebaseUser from useAuth, checking Firebase auth directly");
      currentFirebaseUser = firebaseLib.auth?.currentUser ?? null;
      logger.debug("Direct Firebase auth currentUser:", !!currentFirebaseUser);
    }
    
    if (!currentFirebaseUser) {
      logger.debug("No firebase user found in either useAuth or direct Firebase auth");
      toast({
        title: "Not logged in",
        description: "You need to be logged in to check verification status. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }
    
    setCheckingStatus(true);
    try {
      logger.debug("Reloading firebase user to check verification status");
      
      // Force refresh the token to get the latest email verification status
      await currentFirebaseUser.reload();
      const refreshedUser = firebaseLib.auth?.currentUser;
      
      logger.debug("Current Firebase user after reload, has user:", !!refreshedUser);
      logger.debug("Verification status:", refreshedUser?.emailVerified ? "VERIFIED" : "NOT VERIFIED");
      
      if (refreshedUser?.emailVerified) {
        logger.debug("SUCCESS: Email is verified!");
        setEmailVerified(true);
        
        // Set the permanent flag to disable email verification redirects
        localStorage.setItem('emailVerificationUiComplete', 'true');
        localStorage.setItem('emailVerificationHandled', 'true');
        
        // Update pending registration data if it exists
        if (getPendingRegistrationData()) {
          logger.debug("User is verified, saving email verification status");
          
          try {
            updatePendingRegistrationData({ emailVerified: true });
          } catch (error) {
            logger.error("Error updating pending registration data:", error);
          }
        }
        
        toast({
          title: "Email verified!",
          description: "Your email has been successfully verified. You can now continue.",
        });
        
        // Automatically proceed after a short delay
        setTimeout(() => {
          handleContinue();
        }, 2000);
        
      } else {
        logger.debug("Email still not verified after reload");
        toast({
          title: "Email not verified yet",
          description: "Please check your inbox and click the verification link.",
          variant: "destructive",
        });
      }
    } catch (error) {
      logger.error("Error checking verification status:", error);
      toast({
        title: "Verification check failed",
        description: "Unable to check verification status. Please try again.",
        variant: "destructive",
      });
    } finally {
      setCheckingStatus(false);
    }
  };
  
  // Resend verification email
  const resendVerificationEmail = async () => {
    const fbUser = firebaseLib.auth?.currentUser;
    if (!fbUser) {
      logger.error("No current Firebase user when trying to resend verification email");
      toast({
        title: "Error",
        description: "Not currently signed in. Please refresh the page and try again.",
        variant: "destructive",
      });
      return;
    }
    
    setResendingEmail(true);
    try {
      logger.debug("Resending verification email for current user");
      await firebaseLib.sendVerificationEmail(fbUser);
      
      toast({
        title: "Verification email sent!",
        description: "Please check your inbox for the verification link.",
      });
    } catch (error) {
      logger.error("Error sending verification email:", error);
      toast({
        title: "Failed to send email",
        description: "Unable to send verification email. Please try again later.",
        variant: "destructive",
      });
    } finally {
      setResendingEmail(false);
    }
  };
  
  // Go back to registration
  const handleBack = () => {
    // Go back to the account registration page where Firebase account creation happens
    setLocation('/auth/register');
  };
  
  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-white">
      <div 
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '100%',
          background: `
            linear-gradient(to top, 
              hsla(215,25%,27%,1) 0%, 
              hsla(215,20%,65%,0.8) 50%, 
              hsla(0,0%,100%,1) 100%
            )
          `
        }}
      />
      
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center p-6">
        <div className="bg-white/95 rounded-lg p-8 shadow-lg max-w-md w-full">
          <div className="flex items-center justify-between mb-6">
            <Button
              variant="ghost"
              className="text-[hsl(215,25%,27%)] p-0 h-auto"
              onClick={handleBack}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
            
            <h2 className="text-2xl font-bold text-[hsl(215,25%,27%)] text-center">
              Email Verification
            </h2>
            
            <div className="w-[60px]"></div> {/* Spacer for alignment */}
          </div>
          
          <div className="flex flex-col items-center mb-6">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <MailCheck className="w-10 h-10 text-[hsl(215,25%,27%)]" />
            </div>
            
            <p className="text-center mb-2">
              We've sent a verification email to:
            </p>
            <p className="font-semibold text-[hsl(215,25%,27%)] text-lg mb-4">
              {emailFromUrl}
            </p>
            
            <p className="text-center text-sm text-[hsl(215,25%,40%)] mb-6">
              Please check your inbox and click the verification link in the email.
              Don't see it? Check your spam folder or click "Resend Email" below.
              After clicking the verification link, return here and click "Check verification status".
            </p>
            
            <div className="space-y-4 w-full">
              {/* Resend Email Button */}
              <Button
                variant="outline"
                className="w-full border-[hsl(215,20%,65%)] text-[hsl(215,25%,27%)]"
                onClick={resendVerificationEmail}
                disabled={resendingEmail}
              >
                {resendingEmail ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Resend verification email"
                )}
              </Button>
            </div>
          </div>
          
          {/* Continue Button - Serves as both verification check and continue */}
          <Button
            className={`w-full ${emailVerified 
              ? 'bg-green-600 hover:bg-green-700' 
              : 'bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)]'} text-white mt-4`}
            onClick={emailVerified ? handleContinue : checkEmailVerification}
            disabled={checkingStatus}
          >
            {checkingStatus ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Checking verification status...
              </>
            ) : emailVerified ? (
              <>
                Continue to profile setup
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            ) : (
              <>
                Check verification status
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
