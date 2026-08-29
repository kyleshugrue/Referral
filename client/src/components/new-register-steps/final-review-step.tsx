import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import type { RegistrationFormData } from "./registration-types";

interface FinalReviewStepProps {
  form: UseFormReturn<RegistrationFormData>;
  formData: RegistrationFormData;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  creatingAccount: boolean;
}

export default function FinalReviewStep({ 
  form, 
  formData,
  onSubmit, 
  onBack,
  creatingAccount
}: FinalReviewStepProps) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div className="space-y-2">
          <h2 className="text-lg font-medium text-[hsl(215,25%,27%)]">Review Your Profile</h2>
          <p className="text-sm text-muted-foreground">
            Please review your information before completing registration.
          </p>
        </div>
        
        {/* Account Information */}
        <div className="border rounded-md p-4">
          <h3 className="font-medium mb-2 text-[hsl(215,25%,27%)]">Account Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span className="font-medium text-muted-foreground">Full Name:</span> {formData.fullName}
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Email:</span> {formData.email}
            </div>
          </div>
        </div>
        
        {/* Professional Information */}
        <div className="border rounded-md p-4">
          <h3 className="font-medium mb-2 text-[hsl(215,25%,27%)]">Professional Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <span className="font-medium text-muted-foreground">Job Title:</span> {formData.title || "Not provided"}
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Company:</span> {formData.currentCompany || "Not provided"}
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Location:</span> {formData.currentLocation || "Not provided"}
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Industry:</span> {formData.industry || "Not provided"}
            </div>
            <div>
              <span className="font-medium text-muted-foreground">Experience:</span> {formData.yearsOfExperience} years
            </div>
            {formData.educationLevel && (
              <div>
                <span className="font-medium text-muted-foreground">Education:</span> {formData.educationLevel}
                {formData.institution ? ` (${formData.institution})` : ""}
              </div>
            )}
          </div>
        </div>
        
        {/* About You */}
        <div className="border rounded-md p-4">
          <h3 className="font-medium mb-2 text-[hsl(215,25%,27%)]">About You</h3>
          {formData.bio ? (
            <div className="text-sm mb-3">
              <span className="font-medium text-muted-foreground">Bio:</span>
              <div className="mt-1 whitespace-pre-wrap">{formData.bio}</div>
            </div>
          ) : (
            <div className="text-sm mb-3">
              <span className="font-medium text-muted-foreground">Bio:</span> <span className="text-muted-foreground">Not provided</span>
            </div>
          )}
          
          <div className="space-y-2 text-sm">
            {formData.professionalInterests && formData.professionalInterests.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Professional Interests:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {formData.professionalInterests.map((interest: string, i: number) => (
                    <span key={i} className="bg-blue-50 text-blue-700 rounded-full px-2 py-0.5 text-xs">
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {formData.languages && formData.languages.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Languages:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {formData.languages.map((language: string, i: number) => (
                    <span key={i} className="bg-green-50 text-green-700 rounded-full px-2 py-0.5 text-xs">
                      {language}
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {formData.interests && formData.interests.length > 0 && (
              <div>
                <span className="font-medium text-muted-foreground">Personal Interests:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {formData.interests.map((interest: string, i: number) => (
                    <span key={i} className="bg-purple-50 text-purple-700 rounded-full px-2 py-0.5 text-xs">
                      {interest}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Networking Preferences */}
        <div className="border rounded-md p-4">
          <h3 className="font-medium mb-2 text-[hsl(215,25%,27%)]">Networking Preferences</h3>
          <div className="space-y-2 text-sm">
            {formData.desiredLocations && formData.desiredLocations.length > 0 ? (
              <div>
                <span className="font-medium text-muted-foreground">Desired Locations:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {formData.desiredLocations.map((location: string, i: number) => (
                    <span key={i} className="bg-amber-50 text-amber-700 rounded-full px-2 py-0.5 text-xs">
                      {location}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <span className="font-medium text-muted-foreground">Desired Locations:</span> <span className="text-muted-foreground">None specified</span>
              </div>
            )}
            
            {formData.desiredCompanies && formData.desiredCompanies.length > 0 ? (
              <div>
                <span className="font-medium text-muted-foreground">Desired Companies:</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {formData.desiredCompanies.map((company: string, i: number) => (
                    <span key={i} className="bg-rose-50 text-rose-700 rounded-full px-2 py-0.5 text-xs">
                      {company}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <span className="font-medium text-muted-foreground">Desired Companies:</span> <span className="text-muted-foreground">None specified</span>
              </div>
            )}
          </div>
        </div>
        
        {/* Profile Media */}
        <div className="border rounded-md p-4">
          <h3 className="font-medium mb-2 text-[hsl(215,25%,27%)]">Profile Media</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center">
              <span className="font-medium text-muted-foreground">Profile Photo:</span>
              <span className="ml-2">
                {formData.photo && !formData.photo.includes('placeholder') && formData.photo !== '/placeholder.jpg' ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <span className="text-muted-foreground">Not uploaded</span>
                )}
              </span>
            </div>
            <div className="flex items-center">
              <span className="font-medium text-muted-foreground">Resume:</span>
              <span className="ml-2">
                {formData.resumeUrl ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                ) : (
                  <span className="text-muted-foreground">Not uploaded</span>
                )}
              </span>
            </div>
          </div>
        </div>
        
        <div className="my-4 text-sm text-muted-foreground">
          <p>By clicking "Complete Registration", you agree to our Terms of Service and Privacy Policy.</p>
        </div>
        
        <div className="flex justify-between pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
            disabled={creatingAccount}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            type="submit"
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
            disabled={creatingAccount}
          >
            {creatingAccount ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating Account...
              </>
            ) : (
              <>
                Complete Registration
                <ArrowRight className="ml-2 h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}