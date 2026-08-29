import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { CheckCircle } from "lucide-react";

export default function EmailVerifiedPage() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full space-y-8 p-8 bg-white dark:bg-slate-900 rounded-lg shadow-md">
        <div className="flex flex-col items-center text-center">
          <CheckCircle className="h-20 w-20 text-green-500 mb-4" />
          <h1 className="text-2xl font-bold text-primary mb-2">Email Verified Successfully</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Your email address has been successfully verified. You can now use this email for account-related communications.
          </p>
          <Button 
            className="w-full bg-primary text-white hover:bg-primary/90"
            onClick={() => setLocation('/settings')}
          >
            Return to Settings
          </Button>
        </div>
      </div>
    </div>
  );
}