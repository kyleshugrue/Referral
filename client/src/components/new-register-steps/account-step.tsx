import { FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Loader2 } from "lucide-react";
import { Form } from "@/components/ui/form";
import { UseFormReturn } from "react-hook-form";
import type { RegistrationFormData } from "./registration-types";
import { useIOSKeyboard } from "@/hooks/use-ios-keyboard";

interface AccountStepProps {
  form: UseFormReturn<RegistrationFormData>;
  onSubmit: (data: RegistrationFormData) => void;
  onBack: () => void;
  isVerified?: boolean;
  isSaving?: boolean;
}

export default function AccountStep({ 
  form, 
  onSubmit, 
  onBack,
  isVerified = false,
  isSaving = false
}: AccountStepProps) {
  const { isNativeIOSApp, hideKeyboard } = useIOSKeyboard();

  return (
    <div className="create-account-form">
      <Form {...form}>
        <form 
          onSubmit={form.handleSubmit(onSubmit)} 
          className="space-y-4"
        >
          <div className="space-y-4">
            {/* Email */}
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[hsl(215,25%,27%)]">Email</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Enter your email" 
                      type="email"
                      autoComplete="email"
                      className="border-[hsl(215,20%,65%)]"
                      readOnly={isVerified}
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            {/* Birthday */}
            <FormField
              control={form.control}
              name="birthday"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-[hsl(215,25%,27%)]">Birthday</FormLabel>
                  <FormControl>
                    <Input 
                      type="date"
                      placeholder="Select your birthday" 
                      autoComplete="bday"
                      className="border-[hsl(215,20%,65%)]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <div className="rounded-md bg-blue-50 p-4 mt-4">
              <div className="flex">
                <div className="text-sm text-blue-700">
                  <p>
                    Note: Password authentication has been replaced with Google sign-in for enhanced security.
                    Please use the main registration page to sign up with Google.
                  </p>
                </div>
              </div>
            </div>
          </div>
        
        <div className="flex justify-between pt-4 create-account-buttons">
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
            onClick={() => {
              // Hide keyboard on iOS when form is submitted
              if (isNativeIOSApp) {
                hideKeyboard();
              }
            }}
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
    </div>
  );
}
