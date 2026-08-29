import React from "react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { ArrowLeft, Camera, FileText, Trash2 } from "lucide-react";
import ImageCropper from "./image-cropper";
import { RegisterLetGoButton } from "./register-let-go-button";
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
  handleCreateAccount: () => Promise<void>;
  creatingAccount: boolean;
}

export function RegisterFormFinalStep({
  form,
  onBack,
  handlePhotoChange,
  handleResumeChange,
  handleRemoveResume,
  tempPhotoUrl,
  showCropper,
  handleCropComplete,
  handleCropCancel,
  handleCreateAccount
}: ProfileMediaStepProps) {
  // Use the account-creation callback supplied by the parent.

  return (
    <Form {...form}>
      <form 
        onSubmit={(e) => {
          e.preventDefault();
          console.log("Form submitted, calling handleCreateAccount");
          handleCreateAccount();
        }}
        // Add a fallback action for the form in case JavaScript is disabled or something interrupts it
        action="/network"
        method="get"
      >
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
                      <img
                        src={field.value || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2'/%3E%3Ccircle cx='12' cy='7' r='4'/%3E%3C/svg%3E"}
                        alt="Profile"
                        className="w-full h-full rounded-full object-cover border-2 border-[hsl(215,20%,65%)]"
                      />
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

        <div className="flex justify-between pt-4 mt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          {/* Pass the parent's handleCreateAccount function to the RegisterLetGoButton */}
          <RegisterLetGoButton parentHandleCreateAccount={handleCreateAccount} />
        </div>
      </form>
    </Form>
  );
}