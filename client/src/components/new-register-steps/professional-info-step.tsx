import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import LocationInput from "@/components/location-input";
import { educationLevels } from "@shared/schema";
import type { RegistrationFormData } from "./registration-types";

interface ProfessionalInfoStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  isSaving?: boolean;
}

const capitalizeFirstLetter = (str: string): string => {
  // Return empty string as-is to allow field clearing
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export default function ProfessionalInfoStep({ 
  form, 
  onSubmit, 
  onBack,
  isSaving = false
}: ProfessionalInfoStepProps) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Full Name */}
        <FormField
          control={form.control}
          name="fullName"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Full Name</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Enter your full name" 
                  autoComplete="name"
                  className="border-[hsl(215,20%,65%)]"
                  {...field}
                  onBlur={(e) => {
                    field.onBlur();
                    // Capture value before event is pooled
                    const value = e.target.value;
                    // Defer capitalization slightly to allow iOS keyboard to close naturally
                    setTimeout(() => {
                      field.onChange(value ? capitalizeFirstLetter(value) : '');
                    }, 150);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Job Title */}
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Job Title</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Enter your job title" 
                  className="border-[hsl(215,20%,65%)]"
                  {...field}
                  onBlur={(e) => {
                    field.onBlur();
                    // Capture value before event is pooled
                    const value = e.target.value;
                    // Defer capitalization slightly to allow iOS keyboard to close naturally
                    setTimeout(() => {
                      field.onChange(value ? capitalizeFirstLetter(value) : '');
                    }, 150);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Current Company */}
        <FormField
          control={form.control}
          name="currentCompany"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Current Company</FormLabel>
              <FormControl>
                <Input 
                  placeholder="Enter your current company" 
                  className="border-[hsl(215,20%,65%)]"
                  {...field}
                  onBlur={(e) => {
                    field.onBlur();
                    // Capture value before event is pooled
                    const value = e.target.value;
                    // Defer capitalization slightly to allow iOS keyboard to close naturally
                    setTimeout(() => {
                      field.onChange(value ? capitalizeFirstLetter(value) : '');
                    }, 150);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Current Location */}
        <FormField
          control={form.control}
          name="currentLocation"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Current Location</FormLabel>
              <FormControl>
                <LocationInput
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Enter your current location"
                  className="border-[hsl(215,20%,65%)]"
                />
              </FormControl>
              <FormDescription className="text-xs">
                Start typing a city name (e.g., "San Francisco, CA") and select from the suggestions
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Years of Experience */}
        <FormField
          control={form.control}
          name="yearsOfExperience"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">Years of Experience</FormLabel>
              <FormControl>
                <Input 
                  type="number" 
                  min={0}
                  placeholder="Years of professional experience" 
                  className="border-[hsl(215,20%,65%)]"
                  value={field.value}
                  name={field.name}
                  onBlur={field.onBlur}
                  onChange={(e) => {
                    const value = e.target.value === '' ? 0 : (parseInt(e.target.value, 10) || 0);
                    field.onChange(value);
                  }}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Education */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Education Level */}
          <FormField
            control={form.control}
            name="educationLevel"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[hsl(215,25%,27%)]">Education Level</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
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
                <FormMessage />
              </FormItem>
            )}
          />
          
          {/* Institution */}
          <FormField
            control={form.control}
            name="institution"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="text-[hsl(215,25%,27%)]">Institution</FormLabel>
                <FormControl>
                  <Input 
                    placeholder="School or university name"
                    className="border-[hsl(215,20%,65%)]"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        
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
            type="submit"
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
            disabled={isSaving}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving Data...
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
    </Form>
  );
}
