import * as React from "react"
import { Capacitor } from "@capacitor/core"

import { cn } from "@/lib/utils"

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, onFocus, ...props }, ref) => {
    // Custom focus handler to position cursor at the end of textarea and handle mobile keyboard
    const handleFocus = React.useCallback(
      (e: React.FocusEvent<HTMLTextAreaElement>) => {
        // Position cursor at the end of text
        const length = e.target.value.length;
        e.target.setSelectionRange(length, length);

        // Add mobile keyboard scroll handling for textarea fields
        // For iOS native apps, let the native keyboard handle scrolling behavior
        const isIOSNativeApp = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
        if (!isIOSNativeApp) {
          setTimeout(() => {
            const target = e.target as HTMLTextAreaElement;
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
      [onFocus]
    );

    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        onFocus={handleFocus}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
