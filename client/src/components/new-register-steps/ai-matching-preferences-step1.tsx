import { useState } from "react";
import type { RegistrationFormData } from "./registration-types";
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowRight, PlusCircle, X, Loader2 } from "lucide-react";
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
import { toTitleCase } from "@/utils/text-utils";
import { industries } from "@shared/schema";
import { getCompaniesByIndustry } from "@shared/industry-companies";

interface AIMatchingPreferencesStep1Props {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack?: () => void;
  isSaving?: boolean;
}

export default function AIMatchingPreferencesStep1({ 
  form, 
  onSubmit, 
  isSaving = false
}: AIMatchingPreferencesStep1Props) {
  const [newCompany, setNewCompany] = useState("");

  const addCompany = () => {
    if (newCompany.trim()) {
      const currentCompanies = form.getValues("desiredCompanies") || [];
      const formattedCompany = toTitleCase(newCompany.trim());
      
      if (!currentCompanies.includes(formattedCompany)) {
        form.setValue("desiredCompanies", [...currentCompanies, formattedCompany]);
      }
      setNewCompany("");
    }
  };

  const removeCompany = (companyToRemove: string) => {
    const currentCompanies = form.getValues("desiredCompanies") || [];
    form.setValue("desiredCompanies", currentCompanies.filter((company: string) => company !== companyToRemove));
  };

  const addSuggestedCompany = (company: string) => {
    const currentCompanies = form.getValues("desiredCompanies") || [];
    if (!currentCompanies.includes(company)) {
      form.setValue("desiredCompanies", [...currentCompanies, company]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addCompany();
    }
  };

  const desiredCompanies = form.watch("desiredCompanies") || [];
  const selectedIndustry = form.watch("industry");
  
  // Get suggested companies based on selected industry
  const suggestedCompanies = selectedIndustry ? getCompaniesByIndustry(selectedIndustry) : [];
  
  // Filter out companies that are already added
  const availableSuggestions = suggestedCompanies.filter(company => 
    !desiredCompanies.includes(company)
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
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
        
        {/* Companies of Interest */}
        <FormField
          control={form.control}
          name="desiredCompanies"
          render={() => (
            <FormItem className="space-y-4">
              <FormLabel className="text-[hsl(215,25%,27%)]">Companies of Interest</FormLabel>
              <FormDescription className="text-xs">
                Add companies you're interested in working for or connecting with professionals from
              </FormDescription>
              
              <div className="flex gap-2">
                <Input
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Enter company name"
                  className="border-[hsl(215,20%,65%)]"
                />
                <Button
                  type="button"
                  onClick={addCompany}
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                >
                  <PlusCircle className="h-4 w-4" />
                </Button>
              </div>
              
              {desiredCompanies.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {desiredCompanies.map((company: string, index: number) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      {company}
                      <X
                        className="h-3 w-3 cursor-pointer hover:text-red-500"
                        onClick={() => removeCompany(company)}
                      />
                    </Badge>
                  ))}
                </div>
              )}

              {/* Quick Add Suggestions */}
              {selectedIndustry && availableSuggestions.length > 0 && (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2">
                    {availableSuggestions.map((company: string, index: number) => (
                      <Badge 
                        key={index} 
                        variant="outline" 
                        className="flex items-center gap-1 cursor-pointer hover:bg-[hsl(215,25%,27%)] hover:text-white transition-colors border-[hsl(215,20%,65%)]"
                        onClick={() => addSuggestedCompany(company)}
                      >
                        {company}
                        <PlusCircle className="h-3 w-3" />
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Navigation Buttons */}
        <div className="flex gap-2 pt-4">
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