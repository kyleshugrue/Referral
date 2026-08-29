import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Redirect, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useViewportHeight } from "@/lib/use-viewport-height";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { IOSKeyboardAwareContainer } from '@/components/ios-keyboard-aware-container';

export default function ForgotPasswordPage() {
  const { user, resetPasswordMutation } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  // Use the viewport height hook
  useViewportHeight();

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setResetError(null);
      setResetSuccess(false);
      console.log("Attempting to send password reset email");
      await resetPasswordMutation.mutateAsync(email);
      console.log("Password reset email sent successfully");
      setResetSuccess(true);
      toast({
        title: "Email sent",
        description: "Check your email for password reset instructions",
      });
    } catch (error: unknown) {
      console.error("Password reset error:", error);
      setResetError(error instanceof Error ? error.message : "Failed to send password reset email");
    }
  };

  // If user is already logged in, redirect to home
  if (user) {
    return <Redirect to="/" />;
  }

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

      {/* Content */}
      <IOSKeyboardAwareContainer className="relative z-10 flex flex-col h-full pt-safe">
        {/* Add padding to account for the header plus safe area */}
        <div className="pt-[calc(env(safe-area-inset-top)+48px)] px-4">
          <div className="flex items-center">
            <Button
              variant="ghost"
              className="text-[hsl(215,25%,27%)]"
              onClick={() => setLocation('/auth/login')}
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
              <h2 className="text-2xl font-semibold text-white/90 mb-6">Reset your password</h2>
              <p className="text-white/80 mb-8">
                Enter your email address and we'll send you a link to reset your password
              </p>
            </div>

            {!resetSuccess ? (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Input
                    type="email"
                    placeholder="Email"
                    aria-label="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="h-12 bg-white/90 border-0 text-[hsl(215,25%,27%)] placeholder:text-[hsl(215,25%,27%)]/50"
                    required
                    data-testid="input-email"
                  />
                </div>

                <Button
                  type="submit"
                  className="w-full h-12 bg-white hover:bg-white/90 text-[hsl(215,25%,27%)] font-semibold border-0 transition-all duration-300"
                  disabled={resetPasswordMutation.isPending}
                  data-testid="button-reset-password"
                >
                  {resetPasswordMutation.isPending ? "Sending..." : "Send reset link"}
                </Button>

                {/* Error message display */}
                {resetError && (
                  <div role="alert" className="text-red-400 text-sm p-3 bg-red-400/10 rounded-md" data-testid="text-error">
                    {resetError}
                  </div>
                )}
              </form>
            ) : (
              <div className="space-y-4">
                <div className="bg-white/10 border border-white/20 rounded-lg p-6">
                  <p className="text-white/90 text-sm mb-4">
                    We've sent a password reset link to <span className="font-semibold">{email}</span>
                  </p>
                  <p className="text-white/80 text-sm">
                    Check your email and click the link to reset your password. The link will expire in 1 hour.
                  </p>
                </div>

                <Button
                  onClick={() => setLocation('/auth/login')}
                  className="w-full h-12 bg-white hover:bg-white/90 text-[hsl(215,25%,27%)] font-semibold border-0 transition-all duration-300"
                  data-testid="button-back-to-login"
                >
                  Back to sign in
                </Button>
              </div>
            )}

            <div className="text-center mt-6">
              <p className="text-white/90 text-sm">
                Remember your password?{" "}
                <button
                  onClick={() => setLocation('/auth/login')}
                  className="text-white font-semibold hover:underline"
                  data-testid="link-login"
                >
                  Sign in
                </button>
              </p>
            </div>
          </div>
        </div>
      </IOSKeyboardAwareContainer>
    </div>
  );
}
