import React from "react";
import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useCamera } from "@/hooks/use-camera";
import { useToast } from "@/hooks/use-toast";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

interface PhotoSelectionProps {
  onPhotoSelected: (photoData: string) => void;
  trigger?: React.ReactNode;
  className?: string;
  fallbackInputRef?: React.RefObject<HTMLInputElement>;
}

type TriggerProps = React.HTMLAttributes<HTMLElement> & {
  disabled?: boolean;
};

export default function PhotoSelection({ onPhotoSelected, trigger, className, fallbackInputRef }: PhotoSelectionProps) {
  const { takePhoto, isLoading, isNative, isMobileWeb, isTouchDevice } = useCamera();
  const { toast } = useToast();

  const handleHapticFeedback = async () => {
    if (isNative) {
      try {
        await Haptics.impact({ style: ImpactStyle.Light });
      } catch {
        // Haptic feedback not available, continue silently
      }
    }
  };

  const handleAutoSelect = async () => {
    await handleHapticFeedback();
    
    // Let the OS decide (camera or library)
    const photo = await takePhoto();
    if (photo?.webPath) {
      onPhotoSelected(photo.webPath);
    } else if (photo?.dataUrl) {
      // Handle base64 data URLs
      onPhotoSelected(photo.dataUrl);
    }
  };

  // iOS native photo selection using Capacitor with user choice
  const handleIOSNativeSelection = async () => {
    console.log('[Photo Selection] iOS native photo selection triggered');
    await handleHapticFeedback();
    
    try {
      // takePhoto() uses CameraSource.Prompt which shows camera/library choice on iOS
      const photo = await takePhoto();
      console.log('[Photo Selection] Photo received from Capacitor:', photo);
      
      if (photo?.webPath) {
        console.log('[Photo Selection] Using webPath from Capacitor');
        onPhotoSelected(photo.webPath);
      } else if (photo?.dataUrl) {
        console.log('[Photo Selection] Using dataUrl from Capacitor');
        onPhotoSelected(photo.dataUrl);
      } else {
        console.warn('[Photo Selection] No valid photo data received from Capacitor');
      }
    } catch (error: unknown) {
      console.error('[Photo Selection] iOS photo selection error:', error);
      
      // Don't show error for user cancellation
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('User cancelled')) {
        console.log('[Photo Selection] User cancelled photo selection');
        return;
      }
      
      // Show error for actual failures
      if (toast) {
        toast({
          title: "Photo Selection Failed",
          description: "Unable to access camera or photo library. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const defaultTrigger = (
    <Button 
      type="button" 
      variant="outline" 
      className={`border-[hsl(215,25%,27%)] text-[hsl(215,25%,27%)] ${className}`}
      disabled={isLoading}
    >
      <Upload className="mr-2 h-4 w-4" />
      {isLoading ? "Loading..." : "Upload Photo"}
    </Button>
  );

  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';
  const shouldUseMobileApproach = isMobileWeb || isTouchDevice;

  // Handle photo selection with improved mobile detection
  const handleSelection = async () => {
    if (isLoading) return;
    
    if (isNativeIOS) {
      await handleIOSNativeSelection();
    } else if (shouldUseMobileApproach && fallbackInputRef?.current) {
      // For mobile web browsers, use the provided fallback input ref
      console.log('Using fallback input for mobile web');
      fallbackInputRef.current.click();
      return;
    } else {
      // Desktop web browsers or when no fallback ref is provided
      await handleAutoSelect();
    }
  };

  // Simple trigger handling
  const triggerElement = trigger || defaultTrigger;
  
  const handleClick = async (e: React.MouseEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (isLoading) {
      return;
    }
    
    console.log('PhotoSelection clicked - platform detection:', {
      isNative,
      isNativeIOS,
      isMobileWeb,
      isTouchDevice,
      shouldUseMobileApproach,
      userAgent: navigator.userAgent
    });
    
    await handleSelection();
  };
  
  if (isNativeIOS && React.isValidElement<TriggerProps>(trigger)) {
    return React.cloneElement(trigger, {
      onClick: handleClick,
      disabled: isLoading || trigger.props.disabled
    });
  }

  return (
    <div onClick={handleClick} style={{ cursor: 'pointer' }}>
      {triggerElement}
    </div>
  );

}