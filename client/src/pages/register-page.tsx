import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecureInput } from "@/components/ui/secure-input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Redirect, useLocation } from "wouter";
import { ArrowLeft, ArrowRight, MailCheck, Loader2 } from "lucide-react";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import PasswordStrengthChecker from "@/components/password-strength-checker";
import * as firebaseLib from "../lib/firebase";
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { IOSKeyboardAwareContainer } from '@/components/ios-keyboard-aware-container';
import { logger } from '@/lib/logger';
import { savePendingRegistrationData } from '@/lib/registration-helpers';

// Create a simplified schema for the registration form
const registrationFormSchema = z.object({
  birthday: z.string().optional(),
  email: z.string().email("Please enter a valid email address"),
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number")
    .regex(/[!@#$%^&*(),.?":{}|<>]/, "Password must contain at least one special character"),
  confirmPassword: z.string().min(1, "Please confirm your password")
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type RegistrationFormValues = z.infer<typeof registrationFormSchema>;

export default function RegisterPage() {
  const { user, registerMutation } = useAuth();
  const [, setLocation] = useLocation();
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const { toast } = useToast();
  
  const formContainerRef = useRef<HTMLDivElement>(null);

  const form = useForm<RegistrationFormValues>({
    resolver: zodResolver(registrationFormSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
      birthday: ""
    },
  });

  if (user) {
    return <Redirect to="/" />;
  }

  const onSubmit = async (formData: RegistrationFormValues) => {
    try {
      logger.debug("Registration form submission started", { hasEmail: !!formData.email });

      // Show toast to indicate form submission is starting
      toast({
        title: "Processing registration",
        description: "Creating your account...",
      });

      // Extract only fields needed by registration; confirmPassword is validation-only.
      const { email, password, birthday } = formData;

      // Include only the basic required fields for registration
      const userData = {
        email,
        password,
        fullName: "",
        birthday,
        matchingRadius: 0,
        yearsOfExperience: 0,
        interests: [],
        professionalInterests: [],
        languages: [],
        photo: "/placeholder.jpg",
        profileVisible: true,
        emailNotifications: true,
        readReceipts: true,
        desiredLocations: [],
        desiredCompanies: []
      };

      // Validate required fields
      if (!userData.email || !userData.password) {
        throw new Error("Email and password are required");
      }

      logger.debug("Submitting registration data with Firebase email verification");
      
      try {
        // First, register with Firebase (this will send verification email)
        logger.debug("Starting Firebase registration mutation");
        const result = await registerMutation.mutateAsync(userData);
        logger.debug("Registration mutation completed successfully", { hasResult: !!result });
        
        // The redirect will happen automatically in the auth hook, 
        // but we'll still show the verification UI as a fallback
        toast({
          title: "Account created",
          description: "Please check your email to verify your account.",
        });
        
        // In case the automatic redirect in the hook fails, 
        // set our own redirect with a longer delay
        setTimeout(() => {
          // Only redirect if we're still on this page
          if (window.location.pathname.includes('/register')) {
            logger.debug("Manual redirect to verification page");
            const user = firebaseLib.auth?.currentUser;
            if (user) {
              window.location.href = '/verify-email';
            }
          }
        }, 1500);
        
        // Show verification sent UI as a fallback
        setEmailVerificationSent(true);
      } catch (mutationError: unknown) {
        logger.error("Firebase mutation failed:", mutationError);
        throw new Error(
          mutationError instanceof Error ? mutationError.message : "Firebase registration failed",
          { cause: mutationError },
        );
      }
    } catch (error) {
      logger.error('Registration error:', error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "There was a problem creating your account. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Email verification sent screen
  if (emailVerificationSent) {
    const handleVerificationCheck = async () => {
      setCheckingStatus(true);
      try {
        // Direct redirect to the verification page with email parameter
        // This should solve the issue where users are redirected to the auth page
        const user = firebaseLib.auth?.currentUser;
        
        if (user) {
          logger.debug("Redirecting to verification page");
          
          // Add a small delay to make sure the form state is saved
          setTimeout(() => {
            // Direct navigation to verify-email page
              window.location.href = '/verify-email';
          }, 500);
        } else {
          // If we can't find the current user, try to use the form data
          const email = form.getValues().email;
          
          if (email) {
            logger.warn("No Firebase user found during verification check");
            
            // Create a minimal pending registration data
            const pendingData = {
              email: email,
              fullName: "",
              firebaseUid: ""
            };
            
            // Save the pending data before redirecting
            savePendingRegistrationData(pendingData);
            
            // Direct navigation without user ID
            window.location.href = '/verify-email';
          } else {
            toast({
              title: "Not logged in",
              description: "You need to be logged in to check verification status.",
              variant: "destructive",
            });
          }
        }
      } catch (error) {
        logger.error("Error checking verification:", error);
        toast({
          title: "Verification check failed",
          description: "There was a problem checking your verification status.",
          variant: "destructive",
        });
      } finally {
        setCheckingStatus(false);
      }
    };
    
    const handleResendEmail = async () => {
      setSendingEmail(true);
      try {
        if (firebaseLib.auth?.currentUser) {
          await firebaseLib.sendVerificationEmail(firebaseLib.auth?.currentUser);
          toast({
            title: "Email sent",
            description: "Verification email has been sent. Please check your inbox.",
          });
        } else {
          toast({
            title: "Not logged in",
            description: "You need to be logged in to resend the verification email.",
            variant: "destructive",
          });
        }
      } catch (error) {
        logger.error("Error sending verification email:", error);
        toast({
          title: "Failed to send email",
          description: "Unable to send verification email. Please try again later.",
          variant: "destructive",
        });
      } finally {
        setSendingEmail(false);
      }
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
                onClick={() => setEmailVerificationSent(false)}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
              
              <h2 className="text-2xl font-bold text-[hsl(215,25%,27%)] text-center">
                Email Verification
              </h2>
              
              <div className="w-[60px]"></div>
            </div>
            
            <div className="flex flex-col items-center mb-6">
              <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <MailCheck className="w-10 h-10 text-[hsl(215,25%,27%)]" />
              </div>
              
              <p className="text-center mb-2">
                We've sent a verification email to:
              </p>
              <p className="font-semibold text-[hsl(215,25%,27%)] text-lg mb-4">
                {form.getValues('email')}
              </p>
              
              <p className="text-center text-sm text-[hsl(215,25%,40%)] mb-6">
                Please check your inbox and click the verification link in the email.
                Don't see it? Check your spam folder or click "Resend Email" below.
                After clicking the verification link, return here and click "Check verification status".
              </p>
              
              <div className="space-y-4 w-full">
                <Button
                  variant="outline"
                  className="w-full border-[hsl(215,20%,65%)] text-[hsl(215,25%,27%)]"
                  onClick={handleResendEmail}
                  disabled={sendingEmail}
                >
                  {sendingEmail ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending verification email...
                    </>
                  ) : (
                    "Resend verification email"
                  )}
                </Button>
              </div>
            </div>
            
            {/* Dual-purpose button: Check verification and/or continue */}
            <Button
              className="w-full bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white mt-4"
              onClick={handleVerificationCheck}
              disabled={checkingStatus}
            >
              {checkingStatus ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Checking verification status...
                </>
              ) : (
                <>
                  Check verification status
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
            
            {/* Login button */}
            <Button
              variant="outline"
              className="w-full mt-4 border-[hsl(215,20%,65%)] text-[hsl(215,25%,27%)]"
              onClick={() => {
                // Log the user out before going to login
                try {
                  firebaseLib.logoutUser().then(() => {
                    setLocation('/login');
                  });
                } catch (error) {
                  logger.error("Error logging out:", error);
                  setLocation('/login');
                }
              }}
            >
              Go to Login
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleFormSubmit = async (formData: RegistrationFormValues) => {
    const isNativeIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
    if (isNativeIOS) {
      try {
        await Keyboard.hide();
      } catch {
        // Keyboard may be unavailable while the native view is transitioning.
      }
    }
    return onSubmit(formData);
  };

  // Main registration form
  return (
    <div 
      className="fixed inset-0 flex flex-col bg-white"
      style={{ 
        minHeight: 'calc(var(--vh, 1vh) * 100)',
        height: 'calc(var(--vh, 1vh) * 100)',
        overflow: 'hidden',
      }}
    >
      <div 
        className="absolute inset-x-0 bottom-0 pointer-events-none"
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
      
      <IOSKeyboardAwareContainer
        ref={formContainerRef}
        className="relative z-10 flex-1 overflow-auto pt-[calc(env(safe-area-inset-top)+16px)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="max-w-md mx-auto px-4">
          <div className="flex items-center">
            <Button
              variant="ghost"
              className="text-[hsl(215,25%,27%)]"
              onClick={() => setLocation('/auth')}
              data-testid="button-back"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>

          <h1 className="text-2xl font-bold text-[hsl(215,25%,27%)] mb-2 text-center">
            Referral
          </h1>
          <div className="bg-white/95 rounded-lg p-6 shadow-lg mt-4 mb-8">
            <h2 className="text-2xl font-bold mb-6 text-[hsl(215,25%,27%)]">Create your profile</h2>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleFormSubmit)} className="space-y-6">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Email</FormLabel>
                      <FormControl>
                        <Input 
                          type="email" 
                          placeholder="Enter your email" 
                          autoComplete="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          enterKeyHint="next"
                          className="bg-white border-[hsl(215,20%,65%)]"
                          data-testid="input-email"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="birthday"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Birthday</FormLabel>
                      <FormControl>
                        <Input 
                          type="date"
                          placeholder="Select your birthday" 
                          className="bg-white border-[hsl(215,20%,65%)]"
                          data-testid="input-birthday"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Password</FormLabel>
                      <FormControl>
                        <div className="space-y-2">
                          <SecureInput 
                            aria-label="Password"
                            placeholder="Create a password" 
                            autoComplete="new-password"
                            enterKeyHint="next"
                            className="bg-white border-[hsl(215,20%,65%)]"
                            data-testid="input-password"
                            {...field} 
                          />
                          <PasswordStrengthChecker password={field.value} />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Confirm Password</FormLabel>
                      <FormControl>
                        <SecureInput 
                          aria-label="Confirm Password"
                          placeholder="Confirm your password" 
                          autoComplete="new-password"
                          enterKeyHint="done"
                          className="bg-white border-[hsl(215,20%,65%)]"
                          data-testid="input-confirm-password"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
                  disabled={registerMutation.isPending}
                  data-testid="button-submit"
                >
                  {registerMutation.isPending ? "Verifying Email..." : "Verify Email"}
                </Button>
              </form>
            </Form>
          </div>
        </div>
      </IOSKeyboardAwareContainer>
    </div>
  );
}
