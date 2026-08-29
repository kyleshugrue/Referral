import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, Camera, FileText, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import ImageCropper from "./image-cropper";
import { getRegistrationData, clearRegistrationData } from "@/lib/registration-helpers";
import * as firebaseLib from "@/lib/firebase";
import { logger } from "@/lib/logger";
import type { RegistrationFormData } from "./new-register-steps/registration-types";
import type { UseFormReturn } from "react-hook-form";

interface ProfileMediaStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onBack: () => void;
  handlePhotoChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleResumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveResume: () => void;
  tempPhotoUrl: string;
  showCropper: boolean;
  handleCropComplete: (croppedImageUrl: string) => Promise<void>;
  handleCropCancel: () => void;
}

export function ProfileMediaStepFixed({
  form,
  onBack,
  handlePhotoChange,
  handleResumeChange,
  handleRemoveResume,
  tempPhotoUrl,
  showCropper,
  handleCropComplete,
  handleCropCancel,
}: ProfileMediaStepProps) {
  const { toast } = useToast();
  const [creatingAccount, setCreatingAccount] = useState(false);

  const handleCreateAccount = async () => {
    logger.debug("Creating account...");
    setCreatingAccount(true);
    
    try {
      // Get current step data
      const currentStepData = form.getValues();
      
      // Get all accumulated data
      const allFormData = getRegistrationData() || {};
      
      // Merge current step data with previous data
      const finalFormData = { ...allFormData, ...currentStepData };
      
      // Validate required fields
      const firebaseUser = firebaseLib.auth?.currentUser;
      if (!finalFormData.email || !firebaseUser) {
        logger.error("Missing authenticated registration data");
        throw new Error("Your registration session expired. Please start the registration process from the beginning.");
      }
      
      // Simple registration data with essential fields
      const registrationData = {
        email: finalFormData.email,
        username: finalFormData.email,
        fullName: finalFormData.fullName || ""
      };
      
      logger.debug("Submitting registration data...");
      
      // Make direct API request
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${await firebaseUser.getIdToken()}`,
        },
        body: JSON.stringify(registrationData),
        credentials: 'include'
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || "Registration failed");
      }
      
      const user = await response.json();
      logger.debug("Account created successfully, userId:", user?.id);
      
      // Clear registration data
      clearRegistrationData();
      
      // Show success message
      toast({
        title: "Account created!",
        description: "Your account has been set up successfully. Redirecting...",
      });
      
      // Redirect after a brief delay
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
      
    } catch (error) {
      logger.error("Error creating account:", error);
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "There was an error creating your account.",
        variant: "destructive",
      });
    } finally {
      setCreatingAccount(false);
    }
  };

  return (
    <Form {...form}>
      <form className="space-y-6 overflow-y-auto max-h-[60vh]">
        <FormField
          control={form.control}
          name="photo"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Profile Picture (Optional)</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  <div className="flex justify-center">
                    <div className="relative w-32 h-32">
                      {/* Check if field value is available and not a placeholder */}
                      {field.value && 
                       !field.value.includes('placeholder') && 
                       field.value !== '/placeholder.jpg' ? (
                        <img
                          src={field.value}
                          alt="Profile"
                          className="w-full h-full rounded-full object-cover border-2 border-[hsl(215,20%,65%)]"
                        />
                      ) : (
                        // SVG with blue background and white user icon or text
                        <div className="w-full h-full rounded-full bg-primary flex items-center justify-center border-2 border-[hsl(215,20%,65%)]">
                          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                          </svg>
                        </div>
                      )}
                      <div className="absolute -bottom-2 right-0 flex gap-2">
                        <label
                          htmlFor="photo-upload"
                          className="p-1.5 bg-[hsl(215,25%,27%)] text-white rounded-full cursor-pointer hover:bg-[hsl(215,25%,32%)] transition-colors"
                        >
                          <Camera className="h-4 w-4" />
                          <input
                            id="photo-upload"
                            type="file"
                            accept="image/*"
                            onChange={handlePhotoChange}
                            className="hidden"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              </FormControl>
              <FormMessage className="text-[hsl(215,25%,27%)]" />
            </FormItem>
          )}
        />

        {showCropper && (
          <ImageCropper
            imageUrl={tempPhotoUrl}
            onComplete={handleCropComplete}
            onCancel={handleCropCancel}
            open={showCropper}
          />
        )}

        <FormField
          control={form.control}
          name="resumeUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Resume (Optional)</FormLabel>
              <FormControl>
                <div className="space-y-3">
                  {field.value ? (
                    <div className="flex items-center justify-between p-3 border rounded-md border-[hsl(215,20%,65%)]">
                      <div className="flex items-center">
                        <FileText className="h-5 w-5 text-[hsl(215,25%,27%)] mr-2" />
                        <span className="text-sm text-[hsl(215,25%,27%)]">Resume uploaded</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleRemoveResume}
                        className="h-8 px-2 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center p-6 border-2 border-dashed border-[hsl(215,20%,65%)] rounded-md">
                      <label
                        htmlFor="resume-upload"
                        className="flex flex-col items-center cursor-pointer"
                      >
                        <FileText className="h-8 w-8 text-[hsl(215,20%,65%)] mb-2" />
                        <span className="text-sm text-[hsl(215,20%,65%)]">Upload your resume</span>
                        <span className="text-xs text-[hsl(215,20%,65%)] mt-1">
                          PDF format recommended
                        </span>
                        <input
                          id="resume-upload"
                          type="file"
                          accept=".pdf,.doc,.docx"
                          onChange={handleResumeChange}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </div>
              </FormControl>
              <FormMessage className="text-[hsl(215,25%,27%)]" />
            </FormItem>
          )}
        />

        <div className="flex justify-between pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            type="button"
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
            disabled={creatingAccount}
            onClick={handleCreateAccount}
          >
            {creatingAccount ? "Creating Account..." : "Create Account"}
          </Button>
        </div>
      </form>
    </Form>
  );
}