import { useProfiles } from "@/hooks/use-profiles.tsx";
import ProfileCard from "@/components/profile-card";
import { Loader2, Search, ChevronDown } from "lucide-react";
import ProtectedLayout from "@/components/protected-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { useForm } from "react-hook-form";
import { industries } from "@shared/schema";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem } from "cmdk";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useState } from "react";

interface SearchCriteriaForm {
  industry: string;
  desiredLocation: string;
  company: string;
  yearsOfExperience: number;
  title: string;
}

export default function HomePage() {
  // Move hooks to the top level
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const { profiles, isLoading, updateSearchCriteria } = useProfiles();
  const form = useForm<SearchCriteriaForm>({
    defaultValues: {
      industry: "",
      desiredLocation: "",
      company: "",
      yearsOfExperience: 0,
      title: "",
    },
  });

  // Extract rendering logic to separate functions to avoid conditional hook calls
  const renderLoader = () => (
    <div className="flex items-center justify-center min-h-[100dvh] bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );

  const renderProfiles = () => (
    profiles.length > 0 ? (
      <div className="grid grid-cols-1 gap-4">
        {profiles.map((profile) => (
          <ProfileCard key={profile.id} profile={profile} />
        ))}
      </div>
    ) : (
      <Card>
        <CardContent className="p-4">
          <div className="text-center py-6">
            <h2 className="text-lg font-semibold mb-2">
              No professionals found
            </h2>
            <p className="text-muted-foreground">
              Try adjusting your search criteria
            </p>
          </div>
        </CardContent>
      </Card>
    )
  );

  if (isLoading) {
    return renderLoader();
  }

  return (
    <ProtectedLayout>
      <div className="min-h-[100dvh] bg-background">
        <div className="py-4 px-4">
          <Collapsible
            open={isFiltersOpen}
            onOpenChange={setIsFiltersOpen}
            className="mb-4"
          >
            <Card className="bg-card">
              <CardContent className="p-4">
                <CollapsibleTrigger asChild>
                  <div className="flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-2">
                      <Search className="h-5 w-5" />
                      <h2 className="text-base font-semibold">Search Filters</h2>
                    </div>
                    <ChevronDown
                      className={`h-5 w-5 transition-transform duration-200 ${isFiltersOpen ? 'transform rotate-180' : ''}`}
                    />
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent className="mt-4">
                  <Form {...form}>
                    <form
                      onSubmit={form.handleSubmit((data) => {
                        updateSearchCriteria(data);
                      })}
                      className="flex flex-col gap-4"
                    >
                      <FormField
                        control={form.control}
                        name="industry"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Industry</FormLabel>
                            <Select
                              onValueChange={field.onChange}
                              value={field.value}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select industry" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent position="popper" sideOffset={4} className="max-h-[50vh]">
                                <Command>
                                  <CommandInput placeholder="Search industry..." />
                                  <CommandEmpty>No industry found.</CommandEmpty>
                                  <CommandGroup className="max-h-[40vh] overflow-y-auto">
                                    <CommandItem value="any" onSelect={() => field.onChange("")}>
                                      Any Industry
                                    </CommandItem>
                                    {industries.map((industry) => (
                                      <CommandItem
                                        key={industry}
                                        value={industry}
                                        onSelect={() => field.onChange(industry)}
                                      >
                                        {industry}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </Command>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Job Title</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Search by job title"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="desiredLocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Location</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Search by location"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="company"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Company</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Search by company"
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="yearsOfExperience"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Years of Experience</FormLabel>
                            <Select
                              onValueChange={(value) => field.onChange(parseInt(value))}
                              value={field.value.toString()}
                            >
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select experience range" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="0">Any Experience</SelectItem>
                                <SelectItem value="1">0-2 years</SelectItem>
                                <SelectItem value="3">3-5 years</SelectItem>
                                <SelectItem value="6">6-10 years</SelectItem>
                                <SelectItem value="11">10+ years</SelectItem>
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )}
                      />

                      <Button type="submit" className="w-full">
                        Apply Filters
                      </Button>
                    </form>
                  </Form>
                </CollapsibleContent>
              </CardContent>
            </Card>
          </Collapsible>

          {renderProfiles()}
        </div>
      </div>
    </ProtectedLayout>
  );
}