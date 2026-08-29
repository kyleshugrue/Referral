import { useRef } from "react";
import { FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Upload, X, Camera, File, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import type { RegistrationFormData } from "./registration-types";
import { AspectRatio } from "@/components/ui/aspect-ratio";
import ImageCropper from "@/components/image-cropper";
import PhotoSelection from "@/components/photo-selection";

interface ProfileMediaStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  handlePhotoChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handlePhotoSelected?: (photoData: string) => void;
  handleResumeChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleRemoveResume: () => void;
  tempPhotoUrl: string | null;
  showCropper: boolean;
  handleCropComplete: (croppedImageUrl: string) => Promise<void>;
  handleCropCancel: () => void;
  setTempPhotoUrl?: (url: string) => void;
  setShowCropper?: (show: boolean) => void;
  isLastStep?: boolean;
  isCreatingAccount?: boolean;
  isSaving?: boolean;
  resumeUploading?: boolean;
  photoUploading?: boolean;
}

export default function ProfileMediaStep({ 
  form, 
  onSubmit, 
  onBack,
  handlePhotoChange,
  handlePhotoSelected,
  handleResumeChange,
  handleRemoveResume,
  tempPhotoUrl,
  showCropper,
  handleCropComplete,
  handleCropCancel,
  setTempPhotoUrl,
  setShowCropper,
  isLastStep = false,
  isCreatingAccount = false,
  isSaving = false,
  resumeUploading = false,
  photoUploading = false
}: ProfileMediaStepProps) {
  const photoInputRef = useRef<HTMLInputElement>(null);
  const resumeInputRef = useRef<HTMLInputElement>(null);
  
  const triggerResumeUpload = () => {
    if (resumeInputRef.current) {
      resumeInputRef.current.click();
    }
  };
  
  // Check if we have a photo
  const photoValue = form.watch('photo');
  const hasPhoto = photoValue && 
                  typeof photoValue === 'string' &&
                  !photoValue.includes('placeholder') && 
                  photoValue !== '/placeholder.jpg';
  
  // Check if we have a resume
  const resumeValue = form.watch('resumeUrl');
  const hasResume = resumeValue && typeof resumeValue === 'string' && resumeValue.length > 0;
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Profile Photo */}
        <FormField
          control={form.control}
          name="photo"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Profile Photo</FormLabel>
              <FormDescription className="text-xs mb-2">
                Upload a professional photo to make your profile more engaging
              </FormDescription>
              
              <div className="flex flex-col items-center space-y-4">
                <div className="relative">
                  <div className="w-40 h-40 mx-auto overflow-hidden rounded-full border-2 border-[hsl(215,20%,65%)]">
                    <AspectRatio ratio={1/1}>
                      {hasPhoto ? (
                        <img
                          src={field.value}
                          alt="Profile"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-primary flex items-center justify-center">
                          <Camera className="w-12 h-12 text-white" />
                        </div>
                      )}
                    </AspectRatio>
                  </div>
                  
                  {/* Photo upload loading overlay */}
                  {photoUploading && (
                    <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                      <div className="flex flex-col items-center text-white">
                        <Loader2 className="h-6 w-6 animate-spin mb-1" />
                        <span className="text-xs">Uploading...</span>
                      </div>
                    </div>
                  )}
                </div>
                
                {/* Unified file input for all platforms */}
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePhotoChange}
                />
                
                {/* Use PhotoSelection for native platforms, direct input for web */}
                <PhotoSelection
                  onPhotoSelected={(photoData: string) => {
                    console.log('[ProfileMediaStep] Photo selected:', photoData ? 'Data received' : 'No data');
                    if (handlePhotoSelected) {
                      handlePhotoSelected(photoData);
                    } else if (setTempPhotoUrl && setShowCropper) {
                      // Fallback to manual crop trigger for compatibility
                      setTempPhotoUrl(photoData);
                      setShowCropper(true);
                    }
                  }}
                  fallbackInputRef={photoInputRef}
                  trigger={
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
                      disabled={photoUploading || resumeUploading}
                    >
                      {photoUploading ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Uploading...
                        </>
                      ) : (
                        <>
                          <Upload className="mr-2 h-4 w-4" />
                          {hasPhoto ? "Change Photo" : "Upload Photo"}
                        </>
                      )}
                    </Button>
                  }
                />
              </div>
              
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Resume Upload */}
        <FormField
          control={form.control}
          name="resumeUrl"
          render={() => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Resume</FormLabel>
              <FormDescription className="text-xs mb-2">
                Upload your resume to showcase your experience and skills (PDF format recommended)
              </FormDescription>
              
              <div className="border border-[hsl(215,20%,65%)] rounded-md p-4">
                {resumeUploading ? (
                  <div className="flex items-center justify-center py-6">
                    <div className="flex flex-col items-center">
                      <Loader2 className="h-8 w-8 text-primary animate-spin mb-2" />
                      <p className="text-sm font-medium text-[hsl(215,25%,27%)]">Uploading resume...</p>
                      <p className="text-xs text-muted-foreground">Please wait while we process your file</p>
                    </div>
                  </div>
                ) : hasResume ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <File className="h-6 w-6 text-[hsl(215,25%,27%)] mr-2" />
                      <div>
                        <p className="text-sm font-medium">Resume uploaded</p>
                        <p className="text-xs text-muted-foreground">Your resume is ready</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleRemoveResume}
                      className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      disabled={resumeUploading}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6">
                    <File className="h-10 w-10 text-[hsl(215,20%,65%)] mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">No resume uploaded yet</p>
                    
                    <input
                      ref={resumeInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx"
                      className="hidden"
                      onChange={handleResumeChange}
                      disabled={resumeUploading}
                    />
                    
                    {/* Use direct HTML file input for both web and iOS native - matches working profile page approach */}
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
                      disabled={resumeUploading}
                      onClick={triggerResumeUpload}
                    >
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Resume
                    </Button>
                  </div>
                )}
              </div>
              
              <FormMessage />
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
            type={isLastStep ? "button" : "submit"}
            onClick={isLastStep ? () => {
              // For the final step, call the parent's create account handler
              if (typeof onSubmit === 'function') {
                onSubmit(form.getValues());
              }
            } : undefined}
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
            disabled={isCreatingAccount || isSaving || photoUploading || resumeUploading}
          >
            {isCreatingAccount ? (
              <>
                <span className="mr-2">Creating account...</span>
                <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </>
            ) : isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving Data...
              </>
            ) : isLastStep ? (
              <>
                Complete Registration
              </>
            ) : (
              <>
                Continue
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
      
      {/* Image Cropper */}
      {showCropper && tempPhotoUrl && (
        <ImageCropper
          imageUrl={tempPhotoUrl}
          onComplete={async (croppedImage) => {
            await handleCropComplete(croppedImage);
          }}
          onCancel={handleCropCancel}
          open={showCropper}
        />
      )}
    </Form>
  );
}