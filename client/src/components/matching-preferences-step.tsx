import React from "react";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import LocationInput from "@/components/location-input";
import { toTitleCase } from "@/utils/text-utils";
import type { RegistrationData } from "@/lib/registration-helpers";
import type { UseFormReturn } from "react-hook-form";

/**
 * Matching Preferences Step component for the registration flow
 * - No skip button as per requirement
 * - Support for multiple desired locations
 */
export function MatchingPreferencesStep({ 
  form, 
  onSubmit, 
  onBack,
  setNewLocation,
  newLocation,
  setNewCompany,
  newCompany
}: { 
  form: UseFormReturn<RegistrationData>;
  onSubmit: (data: RegistrationData) => void;
  onBack: () => void;
  setNewLocation: (location: string) => void;
  newLocation: string;
  setNewCompany: (company: string) => void;
  newCompany: string;
}) {
  
  // Location handling moved to the onChange handler of LocationInput component
  
  const handleRemoveLocation = (location: string) => {
    const currentLocations = form.getValues().desiredLocations || [];
    form.setValue("desiredLocations", currentLocations.filter((l: string) => l !== location));
  };
  
  const handleAddCompany = () => {
    if (!newCompany.trim()) return;
    
    const currentCompanies = form.getValues().desiredCompanies || [];
    // Check if the company already exists (case-insensitive check)
    const companyExists = currentCompanies.some(
      (company: string) => company.toLowerCase() === newCompany.toLowerCase()
    );
    
    if (!companyExists) {
      const titleCasedCompany = toTitleCase(newCompany);
      form.setValue("desiredCompanies", [...currentCompanies, titleCasedCompany]);
      setNewCompany("");
    }
  };
  
  const handleRemoveCompany = (company: string) => {
    const currentCompanies = form.getValues().desiredCompanies || [];
    form.setValue("desiredCompanies", currentCompanies.filter((c: string) => c !== company));
  };

  // Enter key handling for locations is no longer needed as locations
  // are added automatically when selected from the dropdown
  
  return (
    <Form {...form}>
      {/* Skip button removed as requested */}
      <form onSubmit={form.handleSubmit((data: RegistrationData) => {
        console.log("AI Matching Preferences form submission - Raw form data:", data);
        console.log("Desired locations from form:", data.desiredLocations);
        console.log("Desired companies from form:", data.desiredCompanies);
        console.log("Form values from getValues():", form.getValues());
        onSubmit(data);
      })} className="space-y-3 px-0.5 mt-4" style={{ paddingBottom: '40px' }}>
        <div className="space-y-3">
          <label className="text-sm font-medium text-[hsl(215,25%,27%)]">
            Locations of Interest
          </label>
          <div className="flex space-x-2">
            <div className="flex-1">
              <LocationInput
                value={newLocation}
                onChange={(location) => {
                  if (location && location.trim()) {
                    const currentLocations = form.getValues().desiredLocations || [];
                    // Check if location already exists (case-insensitive check)
                    const locationExists = currentLocations.some(
                      (loc: string) => loc.toLowerCase() === location.toLowerCase()
                    );
                    
                    if (!locationExists) {
                      // Add the new location to the array
                      form.setValue("desiredLocations", [...currentLocations, location]);
                    }
                    // Clear input field
                    setNewLocation('');
                  } else {
                    setNewLocation(location);
                  }
                }}
                placeholder="Enter a location"
                className="w-full border-[hsl(215,20%,65%)]"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {form.watch("desiredLocations")?.map((location: string) => (
              <Badge 
                key={location} 
                className="bg-[hsla(215,25%,27%,0.1)] text-[hsl(215,25%,27%)] hover:bg-[hsla(215,25%,27%,0.2)]"
              >
                {location}
                <X 
                  className="h-3 w-3 ml-1 cursor-pointer" 
                  onClick={() => handleRemoveLocation(location)}
                />
              </Badge>
            ))}
          </div>
        </div>
        
        <div className="space-y-3">
          <label className="text-sm font-medium text-[hsl(215,25%,27%)]">
            Matching Radius
          </label>
          <p className="text-xs text-[hsl(215,20%,50%)] mb-3">
            How far from your target cities are you willing to live?
          </p>
          <FormField
            control={form.control}
            name="matchingRadius"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <div className="space-y-3">
                    <Slider
                      min={0}
                      max={100}
                      step={5}
                      value={[field.value ?? 0]}
                      onValueChange={(value) => field.onChange(value[0])}
                      className="w-full [&_[data-radix-slider-track]]:bg-[hsl(215,20%,85%)] [&_[data-radix-slider-range]]:bg-[hsl(215,25%,27%)] [&_[data-radix-slider-thumb]]:border-[hsl(215,25%,27%)] [&_[data-radix-slider-thumb]]:bg-white [&_[data-radix-slider-thumb]]:ring-[hsl(215,25%,27%)]"
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
        </div>
        
        <div className="space-y-3">
          <label className="text-sm font-medium text-[hsl(215,25%,27%)]">
            Companies of Interest
          </label>
          <p className="text-xs text-[hsl(215,20%,50%)] mb-3">
            Add companies you would like to work for so our AI can match you with relevant professionals
          </p>
          <div className="flex space-x-2">
            <Input
              type="text"
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              placeholder="Add a company you're interested in"
              className="flex-1 border-[hsl(215,20%,65%)]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleAddCompany();
                }
              }}
            />
            <Button 
              type="button" 
              size="sm" 
              onClick={handleAddCompany} 
              className="bg-[hsl(215,25%,27%)]"
            >
              <div className="flex items-center justify-center w-5 h-5 rounded-full border border-current mr-1">
                <span className="text-xs">+</span>
              </div>
            </Button>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            {form.watch("desiredCompanies")?.map((company: string) => (
              <Badge 
                key={company} 
                className="bg-[hsla(215,25%,27%,0.1)] text-[hsl(215,25%,27%)] hover:bg-[hsla(215,25%,27%,0.2)]"
              >
                {company}
                <X 
                  className="h-3 w-3 ml-1 cursor-pointer" 
                  onClick={() => handleRemoveCompany(company)}
                />
              </Badge>
            ))}
          </div>
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
            className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)]"
          >
            Next
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </form>
    </Form>
  );
}