import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";

export type SecureInputProps = React.InputHTMLAttributes<HTMLInputElement>

const SecureInput = React.forwardRef<HTMLInputElement, SecureInputProps>(
  ({ className, onFocus, ...props }, ref) => {
    // Custom focus handler to position cursor at the end of input
    const handleFocus = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        // Position cursor at the end of text
        const length = e.target.value.length;
        e.target.setSelectionRange(length, length);
        
        // Call the original onFocus handler if it exists
        onFocus?.(e);
      },
      [onFocus]
    );

    return (
      <div className="relative">
        <Input
          type="password"
          className={cn(className)}
          ref={ref}
          onFocus={handleFocus}
          {...props}
        />
      </div>
    );
  }
);

SecureInput.displayName = "SecureInput";

export { SecureInput };
