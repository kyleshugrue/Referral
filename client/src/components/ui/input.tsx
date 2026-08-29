import * as React from "react"
import { Capacitor } from "@capacitor/core"

import { cn } from "@/lib/utils"

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, onFocus, ...props }, ref) => {
    // Custom focus handler to position cursor at the end of input and handle mobile keyboard
    const handleFocus = React.useCallback(
      (e: React.FocusEvent<HTMLInputElement>) => {
        try {
          // Position cursor at the end of text
          // Skip for email inputs as they don't support selection on iOS
          if (type !== 'email') {
            const length = e.target.value.length;
            e.target.setSelectionRange(length, length);
          }
        } catch {
          // Silently handle iOS selection errors
          console.debug('Selection not supported for this input type');
        }

        // Add mobile keyboard scroll handling for input fields
        // For iOS native apps, let the native keyboard handle scrolling behavior
        const isIOSNativeApp = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
        if (!isIOSNativeApp) {
          setTimeout(() => {
            const target = e.target as HTMLInputElement;
            target.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center',
              inline: 'nearest'
            });
          }, 150);
        }
        
        // Call the original onFocus handler if it exists
        onFocus?.(e);
      },
      [onFocus, type]
    );

    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onFocus={handleFocus}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
