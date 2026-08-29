import { useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Info } from "lucide-react";

export default function ResetPasswordActionPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    // Redirect to login after showing the message briefly
    const timer = setTimeout(() => {
      setLocation('/auth/login');
    }, 5000);

    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-r from-[#213159] to-[#213159] p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl text-center">Password Reset Not Available</CardTitle>
          <CardDescription className="text-center">
            We've updated our authentication system
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle>Authentication Update</AlertTitle>
            <AlertDescription>
              We've moved to a more secure authentication method using Google sign-in. 
              Password authentication is no longer supported.
            </AlertDescription>
          </Alert>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <p>To access your account:</p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>Use Google sign-in with your registered email</li>
              <li>Your account will be automatically linked</li>
            </ul>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button 
            className="w-full" 
            onClick={() => setLocation('/auth/login')}
            data-testid="button-go-to-login"
          >
            Go to Sign In
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            You will be redirected automatically in 5 seconds...
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
