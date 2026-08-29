import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { getDeviceInfo } from "@/hooks/use-user-agent-detection"

import { cn } from "@/lib/utils"

const CustomDialog = DialogPrimitive.Root

const CustomDialogTrigger = DialogPrimitive.Trigger

const CustomDialogPortal = DialogPrimitive.Portal

const CustomDialogClose = DialogPrimitive.Close

const CustomDialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[150] bg-black/80 backdrop-blur-[0.5px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
CustomDialogOverlay.displayName = DialogPrimitive.Overlay.displayName

const CustomDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => {
  // Detect if we're on desktop or mobile using User-Agent only
  const deviceInfo = typeof window !== 'undefined' ? getDeviceInfo() : { isMobile: false };
  const isMobile = deviceInfo.isMobile;
  
  return (
    <CustomDialogPortal>
      <CustomDialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] z-[160] w-[95%] p-0 m-0 max-w-none overflow-hidden flex flex-col border-0 mx-auto translate-x-[-50%] bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=open]:slide-in-from-left-1/2",
          // Mobile specific styles
          isMobile ? 
            "top-[47%] translate-y-[-50%] h-[80vh] max-h-[calc(100vh-env(safe-area-inset-top, 0px)-16px-env(safe-area-inset-bottom, 16px)-4.2rem)] rounded-lg data-[state=closed]:slide-out-to-top-[45%] data-[state=open]:slide-in-from-top-[45%]" :
            // Desktop specific styles - 90% viewport height
            "top-[50%] translate-y-[-50%] h-[90vh] max-h-[90vh] rounded-lg",
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </CustomDialogPortal>
  );
})
CustomDialogContent.displayName = DialogPrimitive.Content.displayName

const CustomDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
CustomDialogHeader.displayName = "CustomDialogHeader"

const CustomDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
CustomDialogFooter.displayName = "CustomDialogFooter"

const CustomDialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
CustomDialogTitle.displayName = DialogPrimitive.Title.displayName

const CustomDialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
CustomDialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  CustomDialog,
  CustomDialogTrigger,
  CustomDialogPortal,
  CustomDialogOverlay,
  CustomDialogClose,
  CustomDialogHeader,
  CustomDialogFooter,
  CustomDialogTitle,
  CustomDialogDescription,
  CustomDialogContent,
}