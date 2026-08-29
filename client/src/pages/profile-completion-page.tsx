import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Redirect, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight } from "lucide-react";
import { Capacitor } from '@capacitor/core';
import { IOSKeyboardAwareScrollView } from "@/components/ios-keyboard-aware-container";
import { IOSSelectWrapper } from "@/components/ui/ios-select";

// Profile completion schema
const profileCompletionSchema = z.object({
  title: z.string().min(1, "Job title is required"),
  currentLocation: z.string().min(1, "Current location is required"),
  industry: z.string().min(1, "Industry is required"),
  currentCompany: z.string().min(1, "Current company is required"),
  yearsOfExperience: z.coerce.number().min(0, "Years of experience must be 0 or more"),
  bio: z.string().optional(),
});

type ProfileCompletionValues = z.infer<typeof profileCompletionSchema>;

const industries = [
  "Technology",
  "Finance",
  "Healthcare",
  "Education",
  "Retail",
  "Manufacturing",
  "Construction",
  "Transportation",
  "Entertainment",
  "Hospitality",
  "Media",
  "Energy",
  "Agriculture",
  "Legal",
  "Government",
  "Non-profit",
  "Other"
];

export default function ProfileCompletionPage() {
  const { user, refreshUserData } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isNativeIOSApp, setIsNativeIOSApp] = useState(false);

  useEffect(() => {
    const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
    setIsNativeIOSApp(isIOS);
  }, []);

  const form = useForm<ProfileCompletionValues>({
    resolver: zodResolver(profileCompletionSchema),
    defaultValues: {
      title: user?.title || "",
      currentLocation: user?.currentLocation || "",
      industry: user?.industry || "",
      currentCompany: user?.currentCompany || "",
      yearsOfExperience: user?.yearsOfExperience || 0,
      bio: "",
    },
  });

  // If no user is logged in, redirect to login
  if (!user) {
    return <Redirect to="/login" />;
  }

  // If user already has a complete profile, redirect to home
  if (user.title && 
      user.currentLocation && 
      user.industry &&
      user.currentCompany) {
    return <Redirect to="/" />;
  }

  const onSubmit = async (formData: ProfileCompletionValues) => {
    try {
      setIsSubmitting(true);

      console.log("Submitting profile completion data:", formData);

      // Update user profile in database
      const response = await apiRequest("PATCH", "/api/user", formData);

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || "Failed to update profile");
      }

      // Get updated user data
      const updatedUser = await response.json();
      
      // Update user in cache
      queryClient.setQueryData(["/api/user"], updatedUser);
      
      // Force refresh user data
      await refreshUserData();

      toast({
        title: "Profile updated",
        description: "Your profile has been successfully updated.",
      });

      // Redirect to home page
      setLocation("/");
    } catch (error) {
      console.error("Profile completion error:", error);
      toast({
        title: "Update failed",
        description: error instanceof Error ? error.message : "Failed to update profile. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 flex flex-col overflow-hidden bg-white"
      style={{ 
        minHeight: 'calc(var(--vh, 1vh) * 100)',
        height: 'calc(var(--vh, 1vh) * 100)'
      }}
    >
      {/* Fixed Gradient Background */}
      <div 
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '100%',
          background: `
            linear-gradient(to top, 
              hsla(215,25%,27%,1) 0%, 
              hsla(215,20%,65%,0.8) 50%, 
              hsla(0,0%,100%,1) 100%
            )
          `
        }}
      />
      
      <IOSKeyboardAwareScrollView
        enabled={isNativeIOSApp}
        className="relative z-10 flex-1 pt-[calc(env(safe-area-inset-top)+16px)] pb-[env(safe-area-inset-bottom)]"
        contentClassName="max-w-md mx-auto px-4"
        paddingBottom={120}
      >
        <h1 className="text-2xl font-bold text-[hsl(215,25%,27%)] mb-2 text-center">
          Referral
        </h1>
        
        <div className="bg-white/95 rounded-lg p-6 shadow-lg mt-4 mb-8">
            <h2 className="text-2xl font-bold mb-6 text-[hsl(215,25%,27%)]">Complete your profile</h2>
            <p className="text-[hsl(215,25%,40%)] mb-8">
              Please provide some professional information to help us connect you with the right opportunities.
            </p>
            
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Job Title */}
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Job Title</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="E.g., Software Engineer" 
                          className="bg-white border-[hsl(215,20%,65%)]"
                          {...field} 
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
                          placeholder="E.g., Acme Inc." 
                          className="bg-white border-[hsl(215,20%,65%)]"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Industry */}
                <FormField
                  control={form.control}
                  name="industry"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Industry</FormLabel>
                      <IOSSelectWrapper
                        value={field.value || ''}
                        onValueChange={field.onChange}
                        options={industries.map(ind => ({ value: ind, label: ind }))}
                        placeholder="Select your industry"
                        title="Select Industry"
                        triggerClassName="bg-white border-[hsl(215,20%,65%)]"
                      >
                        <Select
                          onValueChange={field.onChange}
                          defaultValue={field.value}
                        >
                          <FormControl>
                            <SelectTrigger className="bg-white border-[hsl(215,20%,65%)]">
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
                      </IOSSelectWrapper>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Location */}
                <FormField
                  control={form.control}
                  name="currentLocation"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Current Location</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="E.g., San Francisco, CA" 
                          className="bg-white border-[hsl(215,20%,65%)]"
                          {...field} 
                        />
                      </FormControl>
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
                          min="0"
                          placeholder="E.g., 5" 
                          className="bg-white border-[hsl(215,20%,65%)]"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Bio */}
                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-[hsl(215,25%,27%)]">Short Bio (Optional)</FormLabel>
                      <FormControl>
                        <Textarea 
                          placeholder="Tell us a bit about yourself and your career journey"
                          className="bg-white border-[hsl(215,20%,65%)] min-h-[100px]"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,32%)] text-white"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    "Updating Profile..."
                  ) : (
                    <span className="flex items-center justify-center">
                      Complete Profile
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </span>
                  )}
                </Button>
              </form>
            </Form>
          </div>
      </IOSKeyboardAwareScrollView>
    </div>
  );
}