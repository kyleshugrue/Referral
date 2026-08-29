import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight } from "lucide-react";
import LocationInput from "@/components/location-input";
import { industries, educationLevels } from "@shared/schema";

// Safely capitalize the first letter of a string (handling empty values)
import { toTitleCase } from "@/utils/text-utils";
import { getRegistrationData, saveRegistrationData } from "@/lib/registration-helpers";
import type { RegistrationFormData } from "@/components/new-register-steps/registration-types";
import { logger } from "@/lib/logger";
import type { UseFormReturn } from "react-hook-form";

export default function ProfessionalInfoStep({ 
  form, 
  onSubmit, 
  onBack
}: { 
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  setNewLocation: (location: string) => void;
  newLocation: string;
}) {
  useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Enhanced form submission handler with better validation and error handling
  const handleFormSubmit = async (data: RegistrationFormData) => {
    try {
      setIsSubmitting(true);
      logger.debug("ProfessionalInfoStep - Form submitted");
      
      // Validate required fields
      const requiredFields = ["currentLocation", "industry"] as const;
      const missingFields = requiredFields.filter(field => !data[field]);
      
      if (missingFields.length > 0) {
        logger.debug("Missing required fields:", missingFields);
        
        // Show validation errors for each missing field
        missingFields.forEach(field => {
          form.setError(field, {
            type: "required",
            message: `${field === 'currentLocation' ? 'Current location' : 'Industry'} is required`
          });
        });
        
        toast({
          title: "Missing required information",
          description: `Please fill in the following fields: ${missingFields.map(f => f === 'currentLocation' ? 'Current location' : 'Industry').join(', ')}`,
          variant: "destructive",
        });
        
        setIsSubmitting(false);
        return;
      }
      
      logger.debug("All required fields present, submitting form");
      
      // Ensure keyboard is dismissed on mobile before navigating
      if (window.dispatchEvent) {
        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
          detail: false 
        }));
      }
      
      // Save to localStorage in production mode as backup
      try {
        // Get existing data (if any)
        const existingData = getRegistrationData() || {};
          
        // Merge with new data
        const combinedData = { ...existingData, ...data };
        
        // Save to localStorage
        saveRegistrationData(combinedData);
        logger.debug("Saved professional info to localStorage");
      } catch (storageError) {
        logger.error("Error saving to localStorage:", storageError);
      }
      
      // Call the parent submission handler
      onSubmit(data);
    } catch (error) {
      logger.error("Error in professional info form submission:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "An error occurred while saving your information",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  // Direct handler for continue button click
  const handleContinueClick = () => {
    // Add extra debugging
    logger.debug("Continue button clicked directly - ProfessionalInfoStep");
    
    try {
      // Get current form values
      const data = form.getValues();
      logger.debug("Current form values captured");
      
      // Check required fields directly
      if (!data.currentLocation) {
        logger.debug("Missing currentLocation");
        form.setError("currentLocation", {
          type: "required",
          message: "Current location is required"
        });
        toast({
          title: "Missing Required Field",
          description: "Please enter your current location",
          variant: "destructive",
        });
        return;
      }
      
      if (!data.industry) {
        logger.debug("Missing industry");
        form.setError("industry", {
          type: "required",
          message: "Industry is required"
        });
        toast({
          title: "Missing Required Field",
          description: "Please select your industry",
          variant: "destructive",
        });
        return;
      }
      
      // Force blur any active element
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      
      logger.debug("All validations passed, calling submission handler");
      
      // Call our enhanced submission handler
      handleFormSubmit(data);
    } catch (error) {
      logger.error("Error in button click handler:", error);
      toast({
        title: "Error",
        description: "There was a problem processing your information",
        variant: "destructive",
      });
    }
  };
  
  return (
    <Form {...form}>
      <form 
        onSubmit={(e) => {
          e.preventDefault(); // Prevent default form submission
          
          // Dismiss keyboard and active element focus
          if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
          }
          
          if (window.dispatchEvent) {
            window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
              detail: false 
            }));
          }
          
          // Get current form values
          const data = form.getValues();
          
          // Call our enhanced submission handler
          handleFormSubmit(data);
        }} 
        className="space-y-3 px-0.5" 
        style={{ paddingBottom: '40px' }}
      >
        {/* Hidden fullName field - using the value provided in Step 1 */}
        <input 
          type="hidden" 
          {...form.register("fullName")} 
          defaultValue={form.getValues().fullName || ""} 
        />
        
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem className="form-field-container">
              <FormLabel className="text-[hsl(215,25%,27%)]">Job Title</FormLabel>
              <FormControl>
                <Input 
                  {...field} 
                  className="border-[hsl(215,20%,65%)]" 
                  placeholder="Enter your job title"
                />
              </FormControl>
              <FormMessage className="text-[hsl(215,25%,27%)]" />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="currentCompany"
          render={({ field }) => (
            <FormItem className="form-field-container">
              <FormLabel className="text-[hsl(215,25%,27%)]">Current Employer</FormLabel>
              <FormControl>
                <Input 
                  {...field}
                  onChange={(e) => {
                    const titleCasedValue = toTitleCase(e.target.value);
                    field.onChange(titleCasedValue);
                  }}
                  className="border-[hsl(215,20%,65%)]" 
                  placeholder="Enter your current employer"
                />
              </FormControl>
              <FormMessage className="text-[hsl(215,25%,27%)]" />
            </FormItem>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="currentLocation"
            render={({ field }) => (
              <FormItem className="form-field-container">
                <FormLabel className="text-[hsl(215,25%,27%)]">Current Location</FormLabel>
                <FormControl>
                  <LocationInput
                    value={field.value}
                    onChange={(value) => field.onChange(value)}
                    placeholder="Enter your location"
                    className="w-full border-[hsl(215,20%,65%)]"
                  />
                </FormControl>
                <FormMessage className="text-[hsl(215,25%,27%)]" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="industry"
            render={({ field }) => (
              <FormItem className="form-field-container">
                <FormLabel className="text-[hsl(215,25%,27%)]">Industry</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className="border-[hsl(215,20%,65%)]">
                      <SelectValue placeholder="Select an industry" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {industries.map((industry) => (
                      <SelectItem key={industry} value={industry}>
                        {industry}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[hsl(215,25%,27%)]" />
              </FormItem>
            )}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="yearsOfExperience"
            render={({ field }) => (
              <FormItem className="form-field-container">
                <FormLabel className="text-[hsl(215,25%,27%)]">Years of Experience</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    {...field}
                    className="border-[hsl(215,20%,65%)]"
                  />
                </FormControl>
                <FormMessage className="text-[hsl(215,25%,27%)]" />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="educationLevel"
            render={({ field }) => (
              <FormItem className="form-field-container">
                <FormLabel className="text-[hsl(215,25%,27%)]">Education Level</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger className="border-[hsl(215,20%,65%)]">
                      <SelectValue placeholder="Select education level" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {educationLevels.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage className="text-[hsl(215,25%,27%)]" />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="institution"
          render={({ field }) => (
            <FormItem className="form-field-container">
              <FormLabel className="text-[hsl(215,25%,27%)]">Educational Institution</FormLabel>
              <FormControl>
                <Input {...field} className="border-[hsl(215,20%,65%)]" />
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
            onClick={handleContinueClick}
            disabled={isSubmitting}
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
          >
            {isSubmitting ? "Saving..." : "Continue"}
            {!isSubmitting && <ArrowRight className="ml-2 h-4 w-4" />}
          </Button>
        </div>
      </form>
    </Form>
  );
}