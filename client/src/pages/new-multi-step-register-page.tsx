import React, { useState, useEffect, useRef, useCallback } from "react";
import { Capacitor } from '@capacitor/core';
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { 
  markRegistrationComplete, 
  saveRegistrationData, 
  savePartialRegistrationToServer,
  saveRegistrationStep,
  determineStartingStepForVerifiedUser
} from "@/lib/registration-helpers";
import ImageCropper from "@/components/image-cropper";
import { IOSKeyboardAwareContainer, useIOSKeyboardAware } from "@/components/ios-keyboard-aware-container";
import ErrorBoundary from "@/components/error-boundary";

// Import steps
import AIMatchingPreferencesStep1 from "@/components/new-register-steps/ai-matching-preferences-step1";
import AIMatchingPreferencesStep2 from "@/components/new-register-steps/ai-matching-preferences-step2";
import ProfessionalInfoStep from "@/components/new-register-steps/professional-info-step";
import PersonalInfoStep from "@/components/new-register-steps/personal-info-step";
import ProfileMediaStep from "@/components/new-register-steps/profile-media-step";
import { User } from '@shared/schema';
import { logger } from '@/lib/logger';
import type { RegistrationFormData } from "@/components/new-register-steps/registration-types";

// CRITICAL: Filter out system defaults to only return user's actual entries
function filterOutSystemDefaults(user: User): Partial<RegistrationFormData> {
  const SYSTEM_DEFAULTS = {
    title: "Professional",
    currentLocation: "Remote", 
    industry: "Technology",
    currentCompany: "Not Specified"
  };
  
  const safeData: Partial<RegistrationFormData> = {};
  
  // Only include fields that are NOT system defaults and have actual user content
  if (user.title && user.title !== SYSTEM_DEFAULTS.title) {
    safeData.title = user.title;
  }
  if (user.currentLocation && user.currentLocation !== SYSTEM_DEFAULTS.currentLocation) {
    safeData.currentLocation = user.currentLocation;
  }
  if (user.industry && user.industry !== SYSTEM_DEFAULTS.industry) {
    safeData.industry = user.industry;
  }
  if (user.currentCompany && user.currentCompany !== SYSTEM_DEFAULTS.currentCompany) {
    safeData.currentCompany = user.currentCompany;
  }
  
  // Always include these fields as they don't have problematic defaults
  if (user.fullName) {
    safeData.fullName = user.fullName;
  }
  if (user.desiredCompanies && user.desiredCompanies.length > 0) {
    safeData.desiredCompanies = user.desiredCompanies;
  }
  if (user.desiredLocations && user.desiredLocations.length > 0) {
    safeData.desiredLocations = user.desiredLocations;
  }
  if (user.matchingRadius !== undefined) {
    safeData.matchingRadius = user.matchingRadius;
  }
  if (user.yearsOfExperience !== undefined) {
    safeData.yearsOfExperience = user.yearsOfExperience;
  }
  if (user.bio) {
    safeData.bio = user.bio;
  }
  if (user.photo) {
    safeData.photo = user.photo;
  }
  if (user.resumeUrl) {
    safeData.resumeUrl = user.resumeUrl;
  }
  if (user.interests && user.interests.length > 0) {
    safeData.interests = user.interests;
  }
  if (user.professionalInterests && user.professionalInterests.length > 0) {
    safeData.professionalInterests = user.professionalInterests;
  }
  if (user.languages && user.languages.length > 0) {
    safeData.languages = user.languages;
  }
  if (user.educationLevel) {
    safeData.educationLevel = user.educationLevel;
  }
  if (user.institution) {
    safeData.institution = user.institution;
  }
  
  return safeData;
}

// Step 1: AI Matching Preferences Part 1 Schema (Companies & Industry)
const AIMatchingPreferences1Schema = z.object({
  desiredCompanies: z.array(z.string()).min(1, "At least one company of interest is required"),
  industry: z.string().min(1, "Industry is required"),
});

// Step 2: AI Matching Preferences Part 2 Schema (Locations & Radius)
const AIMatchingPreferences2Schema = z.object({
  desiredLocations: z.array(z.string()).min(1, "At least one location of interest is required"),
  matchingRadius: z.coerce.number().int().min(0).max(100).default(25),
});

// Step 3: Professional Information Schema
const ProfessionalInfoSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  title: z.string().min(1, "Job title is required"),
  currentCompany: z.string().min(1, "Current company is required"),
  currentLocation: z.string().min(1, "Current location is required"),
  yearsOfExperience: z.preprocess(
    (val) => (val === '' || val === undefined || val === null) ? 0 : Number(val),
    z.number().int().min(0, "Years of experience must be a non-negative number").optional().default(0)
  ),
  institution: z.string().optional().default(""),
  educationLevel: z.string().optional(),
});

// Step 4: Personal Information Schema
const PersonalInfoSchema = z.object({
  bio: z.string().optional().default(""),
  professionalInterests: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  interests: z.array(z.string()).default([]),
});

// Step 5: Profile Media Schema
const ProfileMediaSchema = z.object({
  photo: z.string().optional(),
  resumeUrl: z.string().optional(),
  resumePreviewUrls: z.array(z.string()).optional(),
});

// Step type definition
type StepType = {
  title: string;
  schema: z.ZodTypeAny;
  componentName: string;
};

const steps: StepType[] = [
  { 
    title: "AI Matching Preferences", 
    schema: AIMatchingPreferences1Schema,
    componentName: "AIMatchingPreferencesStep1"
  },
  { 
    title: "AI Matching Preferences", 
    schema: AIMatchingPreferences2Schema,
    componentName: "AIMatchingPreferencesStep2"
  },
  { 
    title: "Professional Information", 
    schema: ProfessionalInfoSchema,
    componentName: "ProfessionalInfoStep"
  },
  { 
    title: "Personal Information", 
    schema: PersonalInfoSchema,
    componentName: "PersonalInfoStep"
  },
  { 
    title: "Profile Photo & Resume", 
    schema: ProfileMediaSchema,
    componentName: "ProfileMediaStep"
  }
];

function NewMultiStepRegisterPage() {
  const { user, firebaseUser } = useAuth();
  const [, setLocation] = useLocation();
  
  // Defensive check: Ensure currentStep is always within valid range
  const [currentStep, setCurrentStep] = useState(0);
  const safeCurrentStep = Math.max(0, Math.min(currentStep, steps.length - 1));
  const [formData, setFormData] = useState<RegistrationFormData>({
    // Always start with empty form data
    fullName: "",
    birthday: "",
    email: "",
    password: "",
    title: "",
    currentCompany: "",
    currentLocation: "",
    industry: "",
    yearsOfExperience: 0,
    institution: "",
    educationLevel: "",
    bio: "",
    professionalInterests: [],
    languages: [],
    interests: [],
    desiredLocations: [],
    desiredCompanies: [],
    matchingRadius: 25,
    photo: "",
    resumeUrl: "",
    resumePreviewUrls: []
  });
  
  const [tempPhotoUrl, setTempPhotoUrl] = useState<string | null>(null);
  const [showCropper, setShowCropper] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [, setSavedSuccess] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const [photoUploading, setPhotoUploading] = useState(false);
  const { toast } = useToast();
  
  // iOS keyboard handling using the new pro approach
  const { isNativeIOS } = useIOSKeyboardAware();
  
  // Ref for scrollable content container
  const contentContainerRef = useRef<HTMLDivElement>(null);

  // Scroll to top whenever step changes
  useEffect(() => {
    // Use requestAnimationFrame to ensure scroll happens after DOM updates
    requestAnimationFrame(() => {
      // Scroll the window to top
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        window.scrollTo(0, 0);
      }
      
      // Scroll the content container to top (where the actual form content is)
      if (contentContainerRef.current) {
        try {
          contentContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        } catch {
          // Fallback for older iOS WebViews that don't support scrollTo with options
          contentContainerRef.current.scrollTop = 0;
        }
      }
    });
  }, [currentStep]);

  
  // For file upload handling
  const [, setSelectedFile] = useState<File | null>(null);
  
  // Check if email is verified
  const [, setIsVerified] = useState(false);
  
  useEffect(() => {
    // Check URL parameters for verification status and step
    const urlParams = new URLSearchParams(window.location.search);
    const verifiedFromEmail = urlParams.get('verified') === 'true';
    const isUserVerified = firebaseUser?.emailVerified || verifiedFromEmail;
    
    setIsVerified(isUserVerified);
    
    logger.debug("MultiStepRegisterPage: Initializing with user verification status:", isUserVerified);
    logger.debug("MultiStepRegisterPage: User data:", user);
    
    if (isUserVerified && user) {
      // For verified users, determine appropriate starting step and pre-populate with existing data
      const stepParam = urlParams.get('step');
      let targetStep = 0; // Default to step 0 (AI Matching) for verified users
      
      if (stepParam) {
        // Use step from URL if provided
        const urlStep = parseInt(stepParam, 10);
        if (!isNaN(urlStep) && urlStep >= 0 && urlStep < steps.length) {
          targetStep = urlStep;
        }
      } else {
        // Determine step based on existing user data
        const determinedStep = determineStartingStepForVerifiedUser(user);
        if (determinedStep >= 0) {
          targetStep = determinedStep;
        }
      }
      
      logger.debug("MultiStepRegisterPage: Setting current step to", targetStep, "for verified user");
      setCurrentStep(targetStep);
      
      // CRITICAL: Restore user's actual previous entries (NOT system defaults)
      // Pre-populate with user's real data to prevent data loss from crashes
      logger.debug("MultiStepRegisterPage: Restoring user's actual previous entries to forms");
      
      // Filter out system defaults and only use real user data
      const safeUserData = filterOutSystemDefaults(user);
      if (Object.keys(safeUserData).length > 0) {
        logger.debug("MultiStepRegisterPage: Found actual user data to restore:", Object.keys(safeUserData));
        setFormData((prev) => ({ ...prev, ...safeUserData }));
      } else {
        logger.debug("MultiStepRegisterPage: No real user data found, starting with blank forms");
      }
      
      // Save step tracking
      saveRegistrationStep(targetStep);
      
      // Update URL to reflect current step
      const url = new URL(window.location.href);
      url.searchParams.set('step', targetStep.toString());
      url.searchParams.delete('verified'); // Clean up verification parameter
      window.history.replaceState({}, '', url.toString());
      
    } else {
      // For unverified/new users, start from AI Matching step
      logger.debug("MultiStepRegisterPage: Starting from step 0 (AI Matching) for new/unverified user");
      
      // Check URL for step parameter for new users
      const stepParam = urlParams.get('step');
      if (stepParam) {
        const stepNumber = parseInt(stepParam, 10);
        if (!isNaN(stepNumber) && stepNumber >= 0 && stepNumber < steps.length) {
          setCurrentStep(stepNumber);
        }
      }
      
      // Clear any previous registration data to ensure empty forms for new users
      try {
        localStorage.removeItem('registrationData');
        localStorage.removeItem('pendingRegistrationData');
        logger.debug("Registration data cleared - starting with empty forms for new user");
      } catch (error) {
        logger.error("Error clearing registration data:", error);
      }
    }
  }, [firebaseUser?.emailVerified, user]);
  
  // Initialize form with the right schema for the current step
  // Defensive check: Use safeCurrentStep to prevent array out of bounds
  const currentSchema = steps[safeCurrentStep]?.schema || steps[0].schema;
  const form = useForm({
    resolver: zodResolver(currentSchema),
    defaultValues: formData,
    mode: "onChange",
  });
  
  // Update form data when currentStep changes
  useEffect(() => {
    if (currentStep >= 0) {
      form.reset(formData);
    }
  }, [currentStep, form, formData]);
  
  // Profile page auto-save logic - identical to profile page implementation
  const updateProfileMutation = useMutation({
    mutationFn: async (data: Partial<RegistrationFormData>) => {
      if (!user?.id) throw new Error("No user found");
      
      logger.debug("Update profile mutation called with data:", data);
      
      // Clean data to remove undefined values
      const cleanedData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      );
      
      logger.debug("Cleaned data for update:", cleanedData);
      
      if (Object.keys(cleanedData).length === 0) {
        logger.debug("No valid data to update, skipping API call");
        return null;
      }

      const response = await fetch("/api/user", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(cleanedData),
      });

      if (!response.ok) {
        throw new Error(`Failed to update profile: ${response.statusText}`);
      }

      return response.json();
    },
    onSuccess: (data) => {
      logger.debug("Update mutation succeeded, updating cache with:", data);
      // Use only optimistic cache update, no invalidation to prevent redirects during registration
      queryClient.setQueryData(["/api/user"], data);
    },
    onError: (error: Error) => {
      logger.error("Error updating profile:", error);
    },
  });

  // Handle auto-save identical to profile page
  const handleAutoSave = useCallback(async (data: Partial<RegistrationFormData>) => {
    try {
      logger.debug("Autosaving registration data:", data);
      
      setIsSaving(true);
      
      if (!data || Object.keys(data).length === 0) {
        logger.warn("No data to autosave, skipping update");
        setIsSaving(false);
        return;
      }
      
      // Clean data to remove undefined values
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined)
      );
      
      if (Object.keys(cleanData).length === 0) {
        logger.warn("No valid data to autosave after cleaning, skipping update");
        setIsSaving(false);
        return;
      }
      
      logger.debug("Calling update mutation with clean data:", cleanData);
      const result = await updateProfileMutation.mutateAsync(cleanData);
      logger.debug("Registration autosave successful, response:", result);
      
      if (result) {
        // Use optimistic cache update instead of invalidation to prevent redirect issues
        queryClient.setQueryData(["/api/user"], result);
        setSavedSuccess(true);
        setTimeout(() => setSavedSuccess(false), 2000);
      }
      
      setIsSaving(false);
    } catch (error) {
      logger.error("Error auto-saving registration data:", error);
      setIsSaving(false);
      
      toast({
        title: "Auto-save failed",
        description: "Don't worry, your progress is saved locally and will sync when possible.",
        variant: "destructive",
      });
    }
  }, [updateProfileMutation, toast]);

  // Auto-save completely disabled for registration to ensure empty forms
  // useEffect(() => {
  //   // Auto-save disabled for registration
  //   return;
  // }, [form, user?.id, handleAutoSave]);
  
  const totalSteps = steps.length;
  const progressPercentage = ((currentStep + 1) / totalSteps) * 100;
  
  // Function to handle photo upload and cropping
  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      
      // Create a temp URL for the cropper
      const url = URL.createObjectURL(file);
      setTempPhotoUrl(url);
      setShowCropper(true);
    }
  };

  // Function to handle native photo selection from PhotoSelection component
  const handlePhotoSelected = (photoData: string) => {
    // Set the temp photo URL and show cropper
    setTempPhotoUrl(photoData);
    setShowCropper(true);
  };
  
  // Function to handle crop completion
  const handleCropComplete = async (croppedImageUrl: string) => {
    // Store the current tempPhotoUrl to clean up later
    const currentTempUrl = tempPhotoUrl;
    
    setShowCropper(false);
    setPhotoUploading(true);
    
    // Immediately show the cropped image in the form
    form.setValue("photo", croppedImageUrl);
    
    // Update the form data state
    setFormData((prev) => ({
      ...prev,
      photo: croppedImageUrl
    }));
    
    try {
      // Convert blob URL to actual file and upload it in the background
      logger.debug("[PHOTO UPLOAD] Starting blob conversion...", {
        croppedImageUrl: croppedImageUrl.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      });
      
      const response = await fetch(croppedImageUrl);
      logger.debug("[PHOTO UPLOAD] Fetch response:", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      logger.debug("[PHOTO UPLOAD] Blob created:", {
        size: blob.size,
        type: blob.type,
        timestamp: new Date().toISOString()
      });
      
      if (blob.size === 0) {
        throw new Error("Generated blob is empty");
      }
      
      const file = new File([blob], 'profile-picture.jpg', { type: 'image/jpeg' });
      logger.debug("[PHOTO UPLOAD] File created:", {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
      
      // Upload the cropped image to server
      const uploadFormData = new FormData();
      uploadFormData.append('photo', file);
      
      logger.debug("[PHOTO UPLOAD] Making upload request to server...");
      const uploadResponse = await fetch('/api/upload/photo', {
        method: 'POST',
        body: uploadFormData,
        credentials: 'include'
      });
      
      logger.debug("[PHOTO UPLOAD] Upload response received:", {
        ok: uploadResponse.ok,
        status: uploadResponse.status,
        statusText: uploadResponse.statusText,
        headers: Object.fromEntries(uploadResponse.headers.entries())
      });
      
      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        logger.error("[PHOTO UPLOAD] Upload failed with response:", errorText);
        throw new Error(`Profile picture upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
      }
      
      const uploadData = await uploadResponse.json();
      logger.debug("[PHOTO UPLOAD] Profile picture uploaded successfully:", uploadData);
      
      // Update the form data with the server URL after upload completes
      form.setValue("photo", uploadData.url);
      
      // Update the form data state
      setFormData((prev) => ({
        ...prev,
        photo: uploadData.url
      }));
      
      // Save to database using the unified approach
      if (user?.id) {
        await handleAutoSave({ photo: uploadData.url });
      }
      
      toast({
        title: "Profile picture uploaded",
        description: "Your profile picture has been saved successfully.",
      });
      
    } catch (error) {
      logger.error("Error uploading profile picture:", error);
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: "There was an error uploading your profile picture. Please try again.",
      });
    } finally {
      setPhotoUploading(false);
      
      // Clean up any temporary photo URL if it exists
      if (currentTempUrl) {
        URL.revokeObjectURL(currentTempUrl);
      }
      setTempPhotoUrl(null);
    }
  };
  
  // Function to cancel cropping
  const handleCropCancel = () => {
    // Store the current tempPhotoUrl to clean up
    const currentTempUrl = tempPhotoUrl;
    
    setShowCropper(false);
    setPhotoUploading(false);
    
    // Clean up resources
    if (currentTempUrl) {
      URL.revokeObjectURL(currentTempUrl);
    }
    setTempPhotoUrl(null);
    setSelectedFile(null);
    
    // Save current form state even when canceling crop to prevent data loss
    // Defensive check: Ensure form data is valid before saving
    const currentFormData = form.getValues() || {};
    saveRegistrationData({
      ...formData,
      ...currentFormData
    });
  };
  
  // Function to handle resume upload
  const handleResumeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    logger.debug("[REGISTRATION-RESUME] Resume upload triggered", {
      hasFile: !!e.target.files?.[0],
      fileName: e.target.files?.[0]?.name,
      fileSize: e.target.files?.[0]?.size,
      fileType: e.target.files?.[0]?.type,
      timestamp: new Date().toISOString()
    });
    
    const file = e.target.files?.[0];
    if (file) {
      try {
        // Set uploading state
        setResumeUploading(true);
        logger.debug("[REGISTRATION-RESUME] Starting upload process...");
        
        // Upload the resume to server
        const formData = new FormData();
        formData.append('resume', file);
        
        logger.debug("[REGISTRATION-RESUME] Making upload request to server...");
        const uploadResponse = await fetch('/api/upload/resume', {
          method: 'POST',
          body: formData,
          credentials: 'include',
        });
        
        logger.debug("[REGISTRATION-RESUME] Upload response received", {
          status: uploadResponse.status,
          statusText: uploadResponse.statusText,
          ok: uploadResponse.ok,
          headers: Object.fromEntries(uploadResponse.headers.entries())
        });
        
        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          logger.error("[REGISTRATION-RESUME] Upload failed with response:", errorText);
          throw new Error(`Resume upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
        }
        
        const uploadData = await uploadResponse.json();
        logger.debug("[REGISTRATION-RESUME] Resume uploaded successfully:", uploadData);
        
        // Update form with the server URLs
        form.setValue("resumeUrl", uploadData.url);
        form.setValue("resumePreviewUrls", uploadData.previewUrls || []);
        
        // Update form data state
        setFormData((prev) => ({
          ...prev,
          resumeUrl: uploadData.url,
          resumePreviewUrls: uploadData.previewUrls || []
        }));
        
        // Save to database using the unified approach
        logger.debug("[REGISTRATION-RESUME] Saving to database...", {
          userId: user?.id,
          resumeUrl: uploadData.url,
          previewUrls: uploadData.previewUrls?.length || 0
        });
        
        if (user?.id) {
          await handleAutoSave({ 
            resumeUrl: uploadData.url,
            resumePreviewUrls: uploadData.previewUrls || []
          });
          logger.debug("[REGISTRATION-RESUME] Database save completed successfully");
        } else {
          logger.warn("[REGISTRATION-RESUME] No user ID available, skipping database save");
        }
        
        logger.debug("[REGISTRATION-RESUME] Resume upload process completed successfully");
        toast({
          title: "Resume uploaded",
          description: "Your resume has been uploaded and saved successfully.",
        });
      } catch (error) {
        logger.error("[REGISTRATION-RESUME] Error during resume upload:", error);
        logger.error("[REGISTRATION-RESUME] Error stack:", error instanceof Error ? error.stack : 'No stack trace');
        toast({
          variant: "destructive",
          title: "Upload failed",
          description: error instanceof Error ? error.message : "There was an error uploading your resume. Please try again.",
        });
      } finally {
        // Clear uploading state
        logger.debug("[REGISTRATION-RESUME] Clearing upload state");
        setResumeUploading(false);
      }
    } else {
      logger.warn("[REGISTRATION-RESUME] No file selected in input change event");
    }
  };
  
  // Function to handle resume removal
  const handleRemoveResume = () => {
    form.setValue("resumeUrl", "");
    form.setValue("resumePreviewUrls", []);
    
    // Update form data
    setFormData((prev) => ({
      ...prev,
      resumeUrl: "",
      resumePreviewUrls: []
    }));
    
    // Store the updated data using our helper
    const updatedData = {
      ...formData,
      resumeUrl: "",
      resumePreviewUrls: []
    };
    saveRegistrationData(updatedData);
    
    toast({
      title: "Resume removed",
      description: "Your resume has been removed.",
    });
  };
  
  // Function to save data to server - using same logic as profile page
  const saveDataToServer = async (data: Partial<RegistrationFormData>) => {
    if (!user?.id) return;
    
    // Use the same handleAutoSave function from the profile page logic
    await handleAutoSave(data);
  };
  
  // Firebase account creation and data saving
  const handleCreateAccount = async () => {
    try {
      setCreatingAccount(true);
      
      // Set registrationCompleted in database
      logger.debug("Setting registrationCompleted in database before redirect");
      
      const updateResponse = await fetch('/api/user', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ registrationCompleted: true }),
        credentials: 'include'
      });
      
      if (!updateResponse.ok) {
        throw new Error(`Failed to update registration status: ${updateResponse.status}`);
      }
      
      const updatedUser = await updateResponse.json();
      queryClient.setQueryData(["/api/user"], updatedUser);
      logger.debug('Database updated - registrationCompleted set to true');
      
      // Set localStorage for immediate effect
      markRegistrationComplete();
      
      // Navigate to network page
      logger.debug("Registration completed, redirecting to network page");
      setLocation("/");
    } catch (error) {
      logger.error("Error completing registration:", error);
      
      // Reset loading state on error
      setCreatingAccount(false);
      
      toast({
        variant: "destructive",
        title: "Error",
        description: "There was an error completing your registration. Your data is saved, please try again.",
      });
    }
  };
  
  // Function to go back to the previous step
  const goToPreviousStep = () => {
    if (currentStep > 0) {
      // Save current form data before navigating
      // Defensive check: Ensure form data is valid
      const currentFormData = form.getValues() || {};
      const updatedData = {
        ...formData,
        ...currentFormData
      };
      
      // Save to both state and localStorage using our helper
      setFormData(updatedData);
      saveRegistrationData(updatedData);
      
      // Navigate to previous step
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
      
      // Update URL parameter
      const url = new URL(window.location.href);
      url.searchParams.set('step', newStep.toString());
      window.history.replaceState({}, '', url.toString());
    } else {
      // If on first step (AI Matching), go back to registration page
      setLocation('/auth/register');
    }
  };
  
  // Function to handle step submission
  const handleStepSubmit = async (data: Partial<RegistrationFormData>) => {
    try {
      // Ensure arrays are properly formatted
      const formattedStepData = {
        ...data,
        // Process array fields to ensure they're always properly formatted arrays
        interests: Array.isArray(data.interests) ? data.interests : 
          (data.interests ? [data.interests] : []),
        professionalInterests: Array.isArray(data.professionalInterests) ? data.professionalInterests : 
          (data.professionalInterests ? [data.professionalInterests] : []),
        languages: Array.isArray(data.languages) ? data.languages : 
          (data.languages ? [data.languages] : []),
        desiredLocations: Array.isArray(data.desiredLocations) ? data.desiredLocations : 
          (data.desiredLocations ? [data.desiredLocations] : []),
        desiredCompanies: Array.isArray(data.desiredCompanies) ? data.desiredCompanies : 
          (data.desiredCompanies ? [data.desiredCompanies] : [])
      };
      
      // Merge the new data with existing form data
      const updatedData = {
        ...formData,
        ...formattedStepData
      };
      
      // Log array values being saved for the current step
      if (formattedStepData.desiredLocations || formattedStepData.desiredCompanies) {
        logger.debug("Step data with formatted arrays:", {
          desiredLocations: formattedStepData.desiredLocations,
          desiredCompanies: formattedStepData.desiredCompanies
        });
      }
      
      // Update form data state
      setFormData(updatedData);
      
      // Save to localStorage for persistence using our helper
      saveRegistrationData(updatedData);
      
      // Save data to server for all steps
      let saveSuccessful = false;
      try {
        setIsSaving(true);
        let savedUser = null;
        
        // Set saved success to false before starting save
        setSavedSuccess(false);
        
        // CRITICAL: Ensure session is valid before making any API calls
        // Refresh Firebase session and sync with backend for existing users
        if (user?.id && firebaseUser) {
          try {
            logger.debug("[REGISTRATION] Refreshing session before saving data");
            
            // Get fresh Firebase token to ensure session is valid
            const token = await firebaseUser.getIdToken(true);
            
            // Detect platform for JWT token flow
            const isIOSNative = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
            
            // Sync with backend to ensure session cookie is fresh
            const syncResponse = await fetch('/api/firebase-auth', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: JSON.stringify({
                token,
                email: firebaseUser.email,
                displayName: firebaseUser.displayName || updatedData.fullName || user.fullName,
                platform: isIOSNative ? 'ios' : 'web' // Include platform for iOS token generation
              }),
              credentials: 'include'
            });
            
            if (!syncResponse.ok) {
              throw new Error(`Session refresh failed: ${syncResponse.status}`);
            }
            
            logger.debug("[REGISTRATION] Session refreshed successfully");
          } catch (sessionError) {
            logger.error("[REGISTRATION] Failed to refresh session:", sessionError);
            setIsSaving(false);
            
            toast({
              variant: "destructive",
              title: "Session expired",
              description: "Your session has expired. Please click Continue again to refresh your session and continue.",
            });
            
            return; // Don't throw, just return to allow retry
          }
        } else if (user?.id && !firebaseUser) {
          // Edge case: user exists but Firebase hasn't rehydrated yet
          // Wait a bit and try to get Firebase user
          logger.warn("[REGISTRATION] User exists but firebaseUser is null, waiting for Firebase rehydration");
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // If still no Firebase user after waiting, show helpful error
          if (!firebaseUser) {
            setIsSaving(false);
            
            toast({
              variant: "destructive",
              title: "Authentication loading",
              description: "Please wait a moment and click Continue again.",
            });
            
            return; // Allow retry instead of blocking
          }
        }
        
        // If user is already registered in our system, use the regular API
        if (user?.id) {
          // For AI preferences step (currentStep === 0), we need to save the complete updated data
          // because desiredLocations and desiredCompanies are arrays that need to be fully replaced
          if (currentStep === 0) {
            logger.debug("Saving AI preferences with complete data:", updatedData);
            await saveDataToServer(updatedData);
          } else {
            // For other steps, save only the step-specific data
            logger.debug(`[REGISTRATION] Saving step ${currentStep} data to server`);
            await saveDataToServer(formattedStepData);
          }
          
          // Force a refresh of user data to ensure we have the latest
          await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
          
          // Mark save as successful
          saveSuccessful = true;
          
          // Show success indicator
          setSavedSuccess(true);
          
          // Hide saved indicator after 3 seconds
          setTimeout(() => {
            setSavedSuccess(false);
          }, 3000);
        } 
        // Otherwise use our partial registration endpoint if we have a Firebase UID
        else if (firebaseUser?.uid || updatedData.firebaseUid) {
          // Save with Firebase UID (from either authenticated user or saved in form data)
          const dataToSave = {
            ...updatedData,
            firebaseUid: firebaseUser?.uid || updatedData.firebaseUid
          };
          
          // Use true for showToast parameter to give visual feedback
          savedUser = await savePartialRegistrationToServer(dataToSave, true);
          
          // Show success indicator (in addition to toast)
          if (savedUser && savedUser.id) {
            setSavedSuccess(true);
            
            // Hide saved indicator after 3 seconds
            setTimeout(() => {
              setSavedSuccess(false);
            }, 3000);
          }
          
          // After saving data to server, ensure we're properly connected to the user session
          if (savedUser && savedUser.id && firebaseUser) {
            logger.debug("Data saved during step, syncing with user session:", savedUser.id);
            
            try {
              // Get fresh Firebase token
              const token = await firebaseUser.getIdToken(true);
              
              // Detect platform for JWT token flow
              const isIOSSync = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
              
              // Call our server endpoint to sync
              const response = await fetch('/api/firebase-auth', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                  token,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName || updatedData.fullName,
                  platform: isIOSSync ? 'ios' : 'web' // Include platform for iOS token generation
                }),
                credentials: 'include'
              });
              
              if (response.ok) {
                const userData = await response.json();
                logger.debug("Session synced successfully:", userData);
                
                // Update user data in query client
                queryClient.setQueryData(["/api/user"], userData);
                
                // Mark save as successful
                saveSuccessful = true;
              } else {
                logger.error("Session sync failed with status:", response.status);
                throw new Error(`Session sync failed: ${response.status}`);
              }
            } catch (syncError) {
              logger.error("Error syncing user session:", syncError);
              throw syncError; // Re-throw to prevent navigation on auth failure
            }
          } else if (savedUser && savedUser.id) {
            // Mark save as successful for non-Firebase users
            saveSuccessful = true;
          }
        }
        
        // SYNERGY MATCH TRIGGER: After Professional Information step (step 2), trigger background match processing
        // IMPORTANT: Only trigger if save was successful and we have the latest data
        if (currentStep === 2 && saveSuccessful && user?.id) {
          try {
            logger.debug("[REGISTRATION] Data persisted successfully, triggering synergy match calculation");
            // Trigger synergy match calculation in the background - don't wait for response
            fetch('/api/matches/synergy/trigger', {
              method: 'POST',
              credentials: 'include',
            }).then(response => {
              if (response.ok) {
                logger.debug("[REGISTRATION] Synergy match calculation triggered successfully");
              } else {
                logger.warn("[REGISTRATION] Failed to trigger synergy match calculation:", response.status);
              }
            }).catch(error => {
              logger.warn("[REGISTRATION] Error triggering synergy match calculation:", error);
            });
          } catch (error) {
            // Don't block registration flow if match triggering fails
            logger.warn("[REGISTRATION] Error setting up synergy match trigger:", error);
          }
        }
      } catch (saveError) {
        logger.error("Error saving data to server:", saveError);
        setIsSaving(false);
        
        toast({
          variant: "destructive",
          title: "Error saving data",
          description: "There was an error saving your data. Please check your connection and try again.",
        });
        
        // CRITICAL: Don't navigate to next step if save failed
        return;
      } finally {
        setIsSaving(false);
      }
      
      // Only proceed to next step if save was successful
      if (!saveSuccessful) {
        logger.error("[REGISTRATION] Save was not successful, blocking navigation");
        toast({
          variant: "destructive",
          title: "Cannot continue",
          description: "Please ensure your data is saved before continuing to the next step.",
        });
        return;
      }
      
      // Check if this is the final step
      if (currentStep === totalSteps - 1) {
        // Final step - create account
        await handleCreateAccount();
      } else {
        // Force refresh user data before moving to next step
        if (user?.id || firebaseUser?.uid) {
          try {
            await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
          } catch (refreshError) {
            logger.error("Error refreshing user data:", refreshError);
            // Don't block navigation for refresh errors, data is already saved
          }
        }
        
        // Move to the next step
        const newStep = currentStep + 1;
        logger.debug(`[REGISTRATION] Moving from step ${currentStep} to step ${newStep}`);
        
        // Validate step number before setting
        if (newStep < 0 || newStep >= totalSteps) {
          logger.error(`[REGISTRATION] Invalid step number: ${newStep}. Total steps: ${totalSteps}`);
          toast({
            variant: "destructive",
            title: "Navigation Error",
            description: "There was an error moving to the next step. Please try again.",
          });
          return;
        }
        
        setCurrentStep(newStep);
        
        // Update URL parameter
        const url = new URL(window.location.href);
        url.searchParams.set('step', newStep.toString());
        window.history.replaceState({}, '', url.toString());
        
        logger.debug(`[REGISTRATION] Successfully moved to step ${newStep}: ${steps[newStep]?.title || 'Unknown'}`);
      }
    } catch (error) {
      logger.error("Error submitting step:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "There was an error submitting the form. Please try again.",
      });
    }
  };
  
  // Render the appropriate step component
  const renderStepComponent = () => {
    // Safety check: Ensure currentStep is valid
    if (safeCurrentStep < 0 || safeCurrentStep >= steps.length) {
      logger.error(`[REGISTRATION] Invalid currentStep: ${currentStep}. Resetting to 0.`);
      setCurrentStep(0);
      return (
        <div className="text-center p-4">
          <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
          <p className="text-sm text-gray-600">Loading registration form...</p>
        </div>
      );
    }
    
    // Render the normal component for the current step
    // Defensive check: Use safeCurrentStep to prevent array out of bounds
    const stepInfo = steps[safeCurrentStep];
    if (!stepInfo) {
      logger.error(`[REGISTRATION] No step configuration found for step ${safeCurrentStep}`);
      return (
        <div className="text-center p-4">
          <p className="text-sm text-red-600">Error loading registration step</p>
        </div>
      );
    }
    
    logger.debug(`[REGISTRATION] Rendering step ${currentStep}: ${stepInfo.componentName}`);
    
    switch (stepInfo.componentName) {
      case "ProfessionalInfoStep":
        return (
          <ProfessionalInfoStep 
            form={form} 
            onSubmit={handleStepSubmit}
            onBack={goToPreviousStep}
            isSaving={isSaving}
          />
        );
      case "PersonalInfoStep":
        return (
          <PersonalInfoStep 
            form={form} 
            onSubmit={handleStepSubmit}
            onBack={goToPreviousStep}
            isSaving={isSaving}
          />
        );
      case "AIMatchingPreferencesStep1":
        return (
          <AIMatchingPreferencesStep1 
            form={form} 
            onSubmit={handleStepSubmit}
            onBack={goToPreviousStep}
            isSaving={isSaving}
          />
        );
      case "AIMatchingPreferencesStep2":
        return (
          <AIMatchingPreferencesStep2 
            form={form} 
            onSubmit={handleStepSubmit}
            onBack={goToPreviousStep}
            isSaving={isSaving}
          />
        );
      case "ProfileMediaStep":
        return (
          <ProfileMediaStep
            form={form} 
            onSubmit={handleCreateAccount}
            onBack={goToPreviousStep}
            handlePhotoChange={handlePhotoChange}
            handlePhotoSelected={handlePhotoSelected}
            handleResumeChange={handleResumeChange}
            handleRemoveResume={handleRemoveResume}
            tempPhotoUrl={tempPhotoUrl}
            showCropper={showCropper}
            handleCropComplete={handleCropComplete}
            handleCropCancel={handleCropCancel}
            setTempPhotoUrl={setTempPhotoUrl}
            setShowCropper={setShowCropper}
            isLastStep={true}
            isCreatingAccount={creatingAccount}
            isSaving={isSaving}
            resumeUploading={resumeUploading}
            photoUploading={photoUploading}
          />
        );

      default:
        return null;
    }
  };
  
  // CRITICAL ACCESS REVOCATION: Absolutely block completed users from registration flow
  // Users who have pressed "Complete Registration" button are PERMANENTLY blocked
  // DEV MODE: Allow testing with ?testMode=true query parameter in development
  const isDevelopment = import.meta.env.DEV;
  const isTestMode = isDevelopment && window.location.search.includes('testMode=true');
  
  // FIXED: Move useEffect to top level to comply with Rules of Hooks
  // Hooks must always be called in the same order on every render
  useEffect(() => {
    if (user && user.registrationCompleted === true && !isTestMode) {
      logger.debug("ENFORCING ACCESS BLOCK: Redirecting completed user away from registration");
      setLocation("/");
    }
  }, [user, isTestMode, setLocation]);
  
  // Render access denied message if registration is complete
  if (user && user.registrationCompleted === true && !isTestMode) {
    logger.debug("CRITICAL ACCESS REVOCATION: Registration completed, user permanently blocked from registration flow");
    
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <div className="text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
          <p className="text-gray-600 mb-4">Your registration is already complete.</p>
          <p className="text-sm text-gray-500">You cannot access the registration flow again.</p>
          {isDevelopment && (
            <p className="text-xs text-blue-500 mt-4">Dev tip: Add ?testMode=true to the URL to test the registration flow</p>
          )}
        </div>
      </div>
    );
  }
  
  if (isTestMode) {
    logger.debug("DEV MODE: Test mode enabled, allowing completed user to access registration flow");
  }

  return (
    <div className={`min-h-screen flex flex-col bg-gray-50 dark:bg-slate-950 registration-form-container ${isNativeIOS ? 'ios-capacitor-app' : ''}`}>
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-white dark:bg-slate-900 border-b sticky top-0 z-10">
          <div className="h-[env(safe-area-inset-top)] bg-white dark:bg-slate-900"></div>
          <div className="container mx-auto px-4 py-6">
            <div className="flex justify-between items-center">
              {steps[safeCurrentStep]?.title && (
                <h1 className="text-xl font-semibold" style={{ color: 'hsl(215, 25%, 27%)' }}>
                  {steps[safeCurrentStep].title}
                </h1>
              )}
            </div>
            
            {/* Progress bar */}
            <div className="h-1 w-full bg-gray-200 mt-4">
              <div
                className="h-1 bg-[hsl(215,25%,27%)] transition-all duration-300 ease-in-out"
                style={{ width: `${progressPercentage}%` }}
              ></div>
            </div>
          </div>
        </div>
        
        {/* Main content wrapped with IOSKeyboardAwareContainer for smooth keyboard handling */}
        <IOSKeyboardAwareContainer
          className={`flex-1 container mx-auto px-3 pt-12 pb-6 max-w-md lg:max-w-lg registration-step-content overflow-y-auto`}
          ref={contentContainerRef}
        >
          <div className="bg-white dark:bg-slate-900 rounded-lg shadow-md p-4 sm:p-6 min-h-0">
            <div id="multistep-register-form">
              {renderStepComponent()}
            </div>
          </div>
        </IOSKeyboardAwareContainer>
      </div>
      
      {/* Image Cropper Dialog */}
      {showCropper && tempPhotoUrl && (
        <ImageCropper
          imageUrl={tempPhotoUrl}
          onComplete={handleCropComplete}
          onCancel={handleCropCancel}
          aspectRatio={1}
          open={showCropper}
        />
      )}
    </div>
  );
}

// Export the component wrapped in ErrorBoundary for production-ready error handling
// Forward all route props to the inner component
export default function NewMultiStepRegisterPageWithErrorBoundary(props: { params: Record<number, string | undefined> }) {
  void props;
  const [resetKey, setResetKey] = React.useState(0);
  
  return (
    <ErrorBoundary 
      key={resetKey}
      fallbackMessage="We encountered an issue loading the registration page. Don't worry - your progress has been saved. Please try again."
      onReset={() => {
        // Reset by unmounting and remounting the component instead of reloading the page
        // This prevents triggering the registration guard for completed users
        setResetKey(prev => prev + 1);
      }}
    >
      <NewMultiStepRegisterPage />
    </ErrorBoundary>
  );
}