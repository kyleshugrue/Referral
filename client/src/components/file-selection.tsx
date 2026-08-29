import { Button } from "@/components/ui/button";
import { Upload } from "lucide-react";
import { useFilePicker, FilePickerResult } from "@/hooks/use-file-picker";
import { useToast } from "@/hooks/use-toast";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

interface FileSelectionProps {
  onFileSelected: (fileData: FilePickerResult) => void;
  trigger?: React.ReactNode;
  className?: string;
  acceptedTypes?: string[];
  maxSize?: number; // in MB
}

export default function FileSelection({ 
  onFileSelected, 
  trigger, 
  className
}: FileSelectionProps) {
  const { pickDocument, isLoading, isNative } = useFilePicker();
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

  const handleSelectDocument = async () => {
    await handleHapticFeedback();
    
    try {
      console.log('[File Selection] Starting web file picker...');
      const file = await pickDocument();
      console.log('[File Selection] Web file picker result:', file ? {
        name: file.name,
        size: file.size,
        type: file.type
      } : 'null');
      
      if (file) {
        onFileSelected(file);
      } else {
        console.log('[File Selection] No file selected or operation cancelled');
      }
    } catch (error: unknown) {
      console.error('[File Selection] Web file picker error:', error);
      
      // Don't show error for user cancellation
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        console.log('[File Selection] User cancelled file selection');
        return;
      }
      
      // Show error for actual failures
      toast({
        title: "File Selection Failed",
        description: "Unable to access file picker. Please try again.",
        variant: "destructive",
      });
    }
  };

  // For native iOS, directly trigger the native file picker without showing custom dialog
  const handleDirectIOSFilePicker = async () => {
    await handleHapticFeedback();
    
    try {
      console.log('[File Selection] Starting native iOS file picker...');
      const file = await pickDocument();
      console.log('[File Selection] Native file picker result:', file ? {
        name: file.name,
        size: file.size,
        type: file.type
      } : 'null');
      
      if (file) {
        onFileSelected(file);
      } else {
        console.log('[File Selection] No file selected or operation cancelled');
      }
    } catch (error: unknown) {
      console.error('[File Selection] Native iOS file picker error:', error);
      
      // Don't show error for user cancellation
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        console.log('[File Selection] User cancelled file selection');
        return;
      }
      
      // Show error for actual failures
      toast({
        title: "File Selection Failed",
        description: "Unable to access file picker. Please try again.",
        variant: "destructive",
      });
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
      {isLoading ? "Loading..." : "Upload Document"}
    </Button>
  );

  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

  // For both iOS native and web, handle click directly without showing dialog
  // This removes the intermediate screen and goes straight to file selection
  const handleDirectSelection = async () => {
    if (isNativeIOS) {
      await handleDirectIOSFilePicker();
    } else {
      // For web and Android, also go directly to file selection
      await handleSelectDocument();
    }
  };

  return (
    <div onClick={handleDirectSelection}>
      {trigger || defaultTrigger}
    </div>
  );

}