import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle2, XCircle } from "lucide-react";

interface EmailVerificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string;
  userId: number;
  onSuccess: () => void;
}

export default function EmailVerificationDialog({
  open,
  onOpenChange,
  email,
  userId,
  onSuccess
}: EmailVerificationDialogProps) {
  const [verificationCode, setVerificationCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const { toast } = useToast();

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setVerificationCode("");
      setStatus("idle");
      setErrorMessage("");
    }
  }, [open]);

  const handleCodeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Only allow numbers and limit to 6 digits
    const value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
    setVerificationCode(value);
    
    // Clear error when code changes
    if (status === "error") {
      setStatus("idle");
      setErrorMessage("");
    }
  };

  const handleCodeResend = async () => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      const response = await apiRequest("POST", "/api/email-verification-code/request", { 
        newEmail: email,
        userId: userId
      });
      
      if (response.ok) {
        toast({
          title: "Verification code sent",
          description: "Please check your email for the new verification code.",
        });
      } else {
        const data = await response.json();
        toast({
          title: "Failed to send code",
          description: data.message || "Please try again later.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Failed to send code",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerification = async () => {
    if (verificationCode.length !== 6 || status === "verifying") return;
    
    setStatus("verifying");
    try {
      const response = await apiRequest("POST", "/api/email-verification-code/verify", {
        email,
        code: verificationCode,
        userId,
      });
      
      const data = await response.json();
      
      if (response.ok) {
        setStatus("success");
        toast({
          title: "Email verified",
          description: "Your email address has been successfully updated.",
        });
        setTimeout(() => {
          onOpenChange(false);
          onSuccess();
        }, 1500);
      } else {
        setStatus("error");
        setErrorMessage(data.message || "Verification failed. Please check the code and try again.");
        toast({
          title: "Verification failed",
          description: data.message || "Please check the code and try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      setStatus("error");
      const errorMsg = error instanceof Error ? error.message : "An unexpected error occurred.";
      setErrorMessage(errorMsg);
      toast({
        title: "Verification error",
        description: errorMsg,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-center">Verify your email address</DialogTitle>
        </DialogHeader>
        
        <div className="py-4">
          <p className="text-center text-muted-foreground mb-4">
            We've sent a 6-digit verification code to <span className="font-semibold">{email}</span>. 
            Please enter it below to verify your email address.
          </p>
          
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="verificationCode">Verification Code</Label>
              <Input
                id="verificationCode"
                placeholder="Enter 6-digit code"
                value={verificationCode}
                onChange={handleCodeChange}
                className={`text-center tracking-widest text-lg ${status === "error" ? "border-red-500" : ""}`}
                maxLength={6}
                autoComplete="off"
                disabled={status === "verifying" || status === "success"}
              />
              {status === "error" && (
                <p className="text-sm text-red-500 mt-1 flex items-center">
                  <XCircle className="mr-1 h-4 w-4" /> {errorMessage}
                </p>
              )}
              {status === "success" && (
                <p className="text-sm text-green-500 mt-1 flex items-center">
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Email verified successfully!
                </p>
              )}
            </div>
          </div>
        </div>
        
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:justify-between sm:space-x-2">
          <Button 
            variant="outline" 
            onClick={handleCodeResend}
            disabled={isLoading || status === "verifying" || status === "success"}
            className="mt-2 sm:mt-0"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Resend Code
          </Button>
          
          <Button 
            onClick={handleVerification}
            disabled={verificationCode.length !== 6 || status === "verifying" || status === "success"}
            className={status === "success" ? "bg-green-600 hover:bg-green-700" : ""}
          >
            {status === "verifying" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {status === "success" ? "Verified!" : "Verify Email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}