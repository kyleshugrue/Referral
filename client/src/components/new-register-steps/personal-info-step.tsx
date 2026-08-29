import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import type { RegistrationFormData } from "./registration-types";
import SearchableInterestSelect from "@/components/searchable-interest-select";
import { professionalInterests, hobbyInterests, languages } from "@/lib/interests-options";

interface PersonalInfoStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  isSaving?: boolean;
}

// Data is already in the correct format for SearchableInterestSelect

export default function PersonalInfoStep({ 
  form, 
  onSubmit, 
  onBack,
  isSaving = false
}: PersonalInfoStepProps) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {/* Bio */}
        <FormField
          control={form.control}
          name="bio"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[hsl(215,25%,27%)]">About Me</FormLabel>
              <FormControl>
                <Textarea 
                  placeholder="Tell us about yourself, your career journey, and your professional aspirations..." 
                  className="min-h-[150px] border-[hsl(215,20%,65%)]"
                  {...field}
                />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        
        {/* Professional Interests */}
        <FormField
          control={form.control}
          name="professionalInterests"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Professional Interests</FormLabel>
              <FormControl>
                <SearchableInterestSelect
                  options={professionalInterests}
                  selected={field.value || []}
                  onChange={field.onChange}
                  placeholder="Search professional interests..."
                  className="w-full"
                  badgeVariant="secondary"
                />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        
        {/* Personal Interests */}
        <FormField
          control={form.control}
          name="interests"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Hobbies</FormLabel>
              <FormControl>
                <SearchableInterestSelect
                  options={hobbyInterests}
                  selected={field.value || []}
                  onChange={field.onChange}
                  placeholder="Search hobbies..."
                  className="w-full"
                  badgeVariant="secondary"
                />
              </FormControl>
              <FormMessage className="text-xs" />
            </FormItem>
          )}
        />
        
        {/* Languages */}
        <FormField
          control={form.control}
          name="languages"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-sm font-medium">Languages</FormLabel>
              <FormControl>
                <SearchableInterestSelect
                  options={languages}
                  selected={field.value || []}
                  onChange={field.onChange}
                  placeholder="Select languages you speak..."
                  className="w-full"
                  badgeVariant="secondary"
                />
              </FormControl>
              <FormMessage className="text-xs" />
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