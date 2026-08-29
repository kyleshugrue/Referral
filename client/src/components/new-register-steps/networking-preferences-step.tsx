import { useState } from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowRight, PlusCircle, X, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import { Badge } from "@/components/ui/badge";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import LocationInput from "@/components/location-input";
import { toTitleCase } from "@/utils/text-utils";
import { industries } from "@shared/schema";
import type { RegistrationFormData } from "./registration-types";

interface NetworkingPreferencesStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  isSaving?: boolean;
}

export default function NetworkingPreferencesStep({ 
  form, 
  onSubmit, 
  onBack,
  isSaving = false
}: NetworkingPreferencesStepProps) {
  const [newLocation, setNewLocation] = useState("");
  const [newCompany, setNewCompany] = useState("");
  
  const handleAddLocation = (location: string, fieldOnChange?: (value: string[]) => void) => {
    if (!location.trim()) return;
    
    const currentLocations = form.getValues().desiredLocations || [];
    if (!currentLocations.includes(location)) {
      const newLocations = [...currentLocations, location];
      form.setValue("desiredLocations", newLocations);
      // Call field.onChange to properly register the change with react-hook-form
      if (fieldOnChange) {
        fieldOnChange(newLocations);
      }
      // Trigger form validation to ensure the field is registered as dirty
      form.trigger("desiredLocations");
      setNewLocation("");
      console.log("Added location:", location, "Current locations:", newLocations);
    }
  };
  
  const handleRemoveLocation = (location: string, fieldOnChange?: (value: string[]) => void) => {
    const currentLocations = form.getValues().desiredLocations || [];
    const newLocations = currentLocations.filter((l: string) => l !== location);
    form.setValue("desiredLocations", newLocations);
    // Call field.onChange to properly register the change with react-hook-form
    if (fieldOnChange) {
      fieldOnChange(newLocations);
    }
    form.trigger("desiredLocations");
  };
  
  const handleAddCompany = (fieldOnChange?: (value: string[]) => void) => {
    if (!newCompany.trim()) return;
    
    // Apply title case to properly format company names
    const titleCasedCompany = toTitleCase(newCompany);
    
    const currentCompanies = form.getValues().desiredCompanies || [];
    // Check if company already exists (case-insensitive)
    const companyExists = currentCompanies.some(
      (company: string) => company.toLowerCase() === newCompany.toLowerCase()
    );
    
    if (!companyExists) {
      const newCompanies = [...currentCompanies, titleCasedCompany];
      form.setValue("desiredCompanies", newCompanies);
      // Call field.onChange to properly register the change with react-hook-form
      if (fieldOnChange) {
        fieldOnChange(newCompanies);
      }
      // Trigger form validation to ensure the field is registered as dirty
      form.trigger("desiredCompanies");
      setNewCompany("");
      console.log("Added company:", titleCasedCompany, "Current companies:", newCompanies);
    }
  };
  
  const handleRemoveCompany = (company: string, fieldOnChange?: (value: string[]) => void) => {
    const currentCompanies = form.getValues().desiredCompanies || [];
    const newCompanies = currentCompanies.filter((c: string) => c !== company);
    form.setValue("desiredCompanies", newCompanies);
    // Call field.onChange to properly register the change with react-hook-form
    if (fieldOnChange) {
      fieldOnChange(newCompanies);
    }
    form.trigger("desiredCompanies");
  };
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((data) => {
        console.log("NetworkingPreferencesStep - Form submission data:", data);
        console.log("NetworkingPreferencesStep - desiredLocations:", data.desiredLocations);
        console.log("NetworkingPreferencesStep - desiredCompanies:", data.desiredCompanies);
        console.log("NetworkingPreferencesStep - Form getValues():", form.getValues());
        onSubmit(data);
      })} className="space-y-4">
        {/* Desired Companies */}
        <FormField
          control={form.control}
          name="desiredCompanies"
          render={({ field }) => {
            // Ensure field value is always an array
            if (!Array.isArray(field.value)) {
              field.onChange([]);
            }
            return (
              <FormItem className="space-y-4 form-field-container">
                <FormLabel className="text-[hsl(215,25%,27%)]">Companies of Interest</FormLabel>
                <FormDescription className="text-xs">
                  Add companies you would like to work for so our AI can match you with relevant professionals
                </FormDescription>
                
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input 
                      value={newCompany}
                      onChange={(e) => setNewCompany(e.target.value)}
                      placeholder="Add a company you're interested in"
                      className="border-[hsl(215,20%,65%)]"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCompany(field.onChange);
                        }
                      }}
                    />
                  </div>
                  <Button 
                    type="button" 
                    variant="outline" 
                    className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
                    onClick={() => handleAddCompany(field.onChange)}
                  >
                    <PlusCircle className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="flex flex-wrap gap-2 pt-2">
                  {field.value?.map((company: string, index: number) => (
                    <Badge 
                      key={index} 
                      variant="secondary"
                      className="flex items-center gap-1 px-3 py-1.5 bg-[#f0f4f8] text-[hsl(215,25%,27%)]"
                    >
                      {company}
                      <X 
                        className="h-3 w-3 ml-1 cursor-pointer" 
                        onClick={() => handleRemoveCompany(company, field.onChange)}
                      />
                    </Badge>
                  ))}
                </div>
                
                <FormMessage />
              </FormItem>
            );
          }}
        />
        
        {/* Industry */}
        <FormField
          control={form.control}
          name="industry"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <FormLabel className="text-[hsl(215,25%,27%)]">Industry</FormLabel>
              <FormDescription className="text-xs">
                Select your industry to help our AI match you with relevant professionals
              </FormDescription>
              <Select
                onValueChange={field.onChange}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger className="border-[hsl(215,20%,65%)]">
                    <SelectValue placeholder="Select your industry" />
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
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Desired Locations */}
        <FormField
          control={form.control}
          name="desiredLocations"
          render={({ field }) => {
            // Ensure field value is always an array
            if (!Array.isArray(field.value)) {
              field.onChange([]);
            }
            return (
              <FormItem className="space-y-4 form-field-container">
              <FormLabel className="text-[hsl(215,25%,27%)]">Locations of Interest</FormLabel>
              <FormDescription className="text-xs">
                Add locations where you'd like our AI to find you meaningful professional connections
              </FormDescription>
              
              <div className="flex gap-2">
                <div className="flex-1">
                  <LocationInput
                    value={newLocation}
                    onChange={(location) => {
                      setNewLocation(location);
                      if (location && location.trim()) {
                        handleAddLocation(location, field.onChange);
                      }
                    }}
                    placeholder="Add a location of interest"
                    className="border-[hsl(215,20%,65%)]"
                  />
                </div>
                <Button 
                  type="button" 
                  variant="outline" 
                  className="border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)]"
                  onClick={() => handleAddLocation(newLocation, field.onChange)}
                >
                  <PlusCircle className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-2 pt-2">
                {field.value?.map((location: string, index: number) => (
                  <Badge 
                    key={index} 
                    variant="secondary"
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#f0f4f8] text-[hsl(215,25%,27%)]"
                  >
                    {location}
                    <X 
                      className="h-3 w-3 ml-1 cursor-pointer" 
                      onClick={() => handleRemoveLocation(location, field.onChange)}
                    />
                  </Badge>
                ))}
              </div>
              
                <FormMessage />
              </FormItem>
            );
          }}
        />
        
        {/* Matching Radius */}
        <FormField
          control={form.control}
          name="matchingRadius"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <FormLabel className="text-[hsl(215,25%,27%)]">Matching Radius</FormLabel>
              <FormDescription className="text-xs">
                How far from your target cities are you willing to live?
              </FormDescription>
              
              <FormControl>
                <div className="space-y-3">
                  <Slider
                    min={0}
                    max={100}
                    step={5}
                    value={[field.value ?? 0]}
                    onValueChange={(value) => {
                      // Update the form value immediately for visual feedback
                      form.setValue("matchingRadius", value[0], { shouldValidate: false, shouldDirty: false });
                    }}
                    onValueCommit={(value) => field.onChange(value[0])}
                    className="w-full [&_[data-radix-slider-track]]:bg-[hsl(215,20%,85%)] [&_[data-radix-slider-range]]:bg-[hsl(215,25%,27%)] [&_[data-radix-slider-thumb]]:border-[hsl(215,25%,27%)] [&_[data-radix-slider-thumb]]:bg-white"
                  />
                  <div className="flex justify-between text-xs text-[hsl(215,20%,50%)]">
                    <span>0 miles</span>
                    <span className="font-medium text-[hsl(215,25%,27%)]">
                      {field.value ?? 0} miles
                    </span>
                    <span>100 miles</span>
                  </div>
                </div>
              </FormControl>
              
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