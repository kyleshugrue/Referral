import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SecureInput } from "@/components/ui/secure-input";
import { Form, FormControl, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { Redirect, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useViewportHeight } from "@/lib/use-viewport-height";
import { useState, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { IOSKeyboardAwareContainer } from '@/components/ios-keyboard-aware-container';
import { logger } from '@/lib/logger';

export default function LoginPage() {
  const { 
    user, 
    loginMutation
  } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [loginError, setLoginError] = useState<string | null>(null);
  
  const formContainerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useViewportHeight();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const handleSubmit = async (data: { email: string; password: string }) => {
    try {
      setLoginError(null);
      
      const isNativeIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
      if (isNativeIOS) {
        try {
          await Keyboard.hide();
        } catch {
          // Keyboard may be unavailable while the native view is transitioning.
        }
      }
      
      logger.debug("Attempting to sign in with email/password");
      await loginMutation.mutateAsync(data);
      
      logger.info("Email/password sign in successful");
      toast({
        title: "Sign in successful",
        description: "Welcome back!",
      });
    } catch (error: unknown) {
      logger.error("Login error:", error);
      setLoginError(error instanceof Error ? error.message : "Failed to sign in. Please try again.");
    }
  };

  if (user) {
    return <Redirect to="/" />;
  }

  return (
    <div 
      ref={scrollContainerRef}
      className="fixed inset-0 flex flex-col bg-white"
      style={{ 
        minHeight: 'calc(var(--vh, 1vh) * 100)',
        height: 'calc(var(--vh, 1vh) * 100)',
        overflow: 'hidden',
      }}
    >
      <div 
        className="absolute inset-x-0 bottom-0 pointer-events-none"
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
      
      <IOSKeyboardAwareContainer
        ref={formContainerRef}
        className="relative z-10 flex flex-col h-full pt-safe"
      >
        <div className="pt-[calc(env(safe-area-inset-top)+48px)] px-4">
          <div className="flex items-center">
            <Button
              variant="ghost"
              className="text-[hsl(215,25%,27%)]"
              onClick={() => setLocation('/auth')}
              data-testid="button-back"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back
            </Button>
          </div>
        </div>

        <div className="flex-1 flex flex-col items-center justify-center w-full px-4 pb-[env(safe-area-inset-bottom)]">
          <div className="w-full max-w-md space-y-8">
            <div className="text-center">
              <h1 className="text-4xl font-bold text-white mb-2">Referral</h1>
              <h2 className="text-2xl font-semibold text-white/90 mb-6">Sign in</h2>
            </div>

            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(handleSubmit)}
                className="space-y-4 w-full"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Input 
                          type="email" 
                          placeholder="Email"
                          aria-label="Email"
                          autoComplete="email"
                          autoCapitalize="none"
                          autoCorrect="off"
                          enterKeyHint="next"
                          {...field}
                          className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/70"
                          data-testid="input-email"
                        />
                      </FormControl>
                      <FormMessage className="text-white" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <SecureInput 
                          placeholder="Password"
                          aria-label="Password"
                          autoComplete="current-password"
                          enterKeyHint="done"
                          {...field}
                          className="h-12 bg-white/10 border-white/20 text-white placeholder:text-white/70"
                          data-testid="input-password"
                        />
                      </FormControl>
                      <FormMessage className="text-white" />
                    </FormItem>
                  )}
                />
                <Button
                  type="submit"
                  className="w-full h-12 bg-white/90 hover:bg-white text-[hsl(215,25%,27%)] border-0 transition-all duration-300"
                  disabled={loginMutation.isPending}
                  data-testid="button-submit"
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign in"}
                </Button>
                
                {loginError && (
                  <div role="alert" className="text-red-400 text-sm p-2 bg-red-400/10 rounded-md mt-4" data-testid="text-error">
                    {loginError}
                  </div>
                )}
                
                <button 
                  type="button"
                  className="w-full text-center text-white/90 text-sm mt-4 hover:text-white transition-colors"
                  onClick={() => setLocation('/auth/forgot-password')}
                  data-testid="link-forgot-password"
                >
                  Trouble signing in?
                </button>
              </form>
            </Form>
          </div>
        </div>
      </IOSKeyboardAwareContainer>
    </div>
  );
}
