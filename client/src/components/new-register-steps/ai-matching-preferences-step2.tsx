import { useState } from "react";
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, ArrowRight, X, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import type { RegistrationFormData } from "./registration-types";
import { Badge } from "@/components/ui/badge";
import LocationInput from "@/components/location-input";
import { toTitleCase } from "@/utils/text-utils";

interface AIMatchingPreferencesStep2Props {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  isSaving?: boolean;
}

export default function AIMatchingPreferencesStep2({ 
  form, 
  onSubmit, 
  onBack,
  isSaving = false
}: AIMatchingPreferencesStep2Props) {
  const [newLocation, setNewLocation] = useState("");

  const removeLocation = (locationToRemove: string) => {
    const currentLocations = form.getValues("desiredLocations") || [];
    form.setValue("desiredLocations", currentLocations.filter((location: string) => location !== locationToRemove));
  };

  const desiredLocations = form.watch("desiredLocations") || [];
  const matchingRadius = form.watch("matchingRadius") || 25;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Desired Locations */}
        <FormField
          control={form.control}
          name="desiredLocations"
          render={() => (
            <FormItem className="space-y-4">
              <FormLabel className="text-[hsl(215,25%,27%)]">Locations of Interest</FormLabel>
              <FormDescription className="text-xs">
                Add cities or regions where you'd like to work or connect with professionals
              </FormDescription>
              
              <LocationInput
                value={newLocation}
                onChange={(location) => {
                  if (location && location.trim()) {
                    const currentLocations = form.getValues("desiredLocations") || [];
                    const formattedLocation = toTitleCase(location.trim());
                    
                    // Check if location already exists (case-insensitive check)
                    const locationExists = currentLocations.some(
                      (loc: string) => loc.toLowerCase() === formattedLocation.toLowerCase()
                    );
                    
                    if (!locationExists) {
                      // Add the new location to the array
                      const updatedLocations = [...currentLocations, formattedLocation];
                      // Update form value
                      form.setValue("desiredLocations", updatedLocations);
                      // Reset input field
                      setNewLocation("");
                    } else {
                      // Just clear the input if location already exists
                      setNewLocation("");
                    }
                  }
                }}
                placeholder="Start typing a city name (e.g., San Fr...)"
                className="w-full"
              />
              
              {desiredLocations.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {desiredLocations.map((location: string, index: number) => (
                    <Badge 
                      key={index} 
                      variant="secondary" 
                      className="flex items-center gap-1 px-3 py-1.5 bg-[#f0f4f8] text-[hsl(215,25%,27%)]"
                    >
                      {location}
                      <X
                        className="h-3 w-3 ml-1 cursor-pointer hover:text-red-500"
                        onClick={() => removeLocation(location)}
                      />
                    </Badge>
                  ))}
                </div>
              )}
              
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Matching Radius */}
        <FormField
          control={form.control}
          name="matchingRadius"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <FormLabel className="text-[hsl(215,25%,27%)]">
                Matching Radius: {matchingRadius} miles
              </FormLabel>
              <FormDescription className="text-xs">
                How far from your target cities are you willing to live
              </FormDescription>
              <FormControl>
                <Slider
                  min={0}
                  max={100}
                  step={5}
                  value={[field.value]}
                  onValueChange={(values) => {
                    // Update the form value immediately for visual feedback
                    form.setValue("matchingRadius", values[0], { shouldValidate: false, shouldDirty: false });
                  }}
                  onValueCommit={(values) => field.onChange(values[0])}
                  className="w-full"
                />
              </FormControl>
              <div className="flex justify-between text-xs text-gray-500">
                <span>0 miles</span>
                <span>100 miles</span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Navigation Buttons */}
        <div className="flex gap-3 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            className="flex-1 border-[hsl(215,20%,65%)] text-[hsl(215,25%,27%)]"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <Button
            type="submit"
            disabled={isSaving}
            className="flex-1 bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
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