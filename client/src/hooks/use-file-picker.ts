import { useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useToast } from '@/hooks/use-toast';

export interface FilePickerResult {
  data: string; // Base64 data
  name: string;
  type: string;
  size: number;
}

export function useFilePicker() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();

  const pickDocument = async (): Promise<FilePickerResult | null> => {
    setIsLoading(true);
    
    try {
      if (isNative) {
        // Use native iOS document picker
        return await nativeDocumentPicker();
      } else {
        // Fallback to web file picker
        return await webFilePickerFallback();
      }
    } catch (error: unknown) {
      setIsLoading(false);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('User cancelled')) {
        // User cancelled file selection - don't show error
        return null;
      }
      
      console.error('File picker error:', error);
      toast({
        title: "File Selection Error",
        description: "Unable to access file picker. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  const nativeDocumentPicker = async (): Promise<FilePickerResult | null> => {
    try {
      console.log('[Native File Picker] Starting enhanced native document picker...');
      
      // Use enhanced HTML input that triggers native iOS document picker
      // This approach works well on iOS Capacitor apps
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        input.style.display = 'none';
        input.style.position = 'absolute';
        input.style.opacity = '0';
        input.style.left = '-9999px';
        
        let resolved = false;
        
        const resolveOnce = (result: FilePickerResult | null) => {
          if (!resolved) {
            resolved = true;
            setIsLoading(false);
            cleanup();
            resolve(result);
          }
        };
        
        const rejectOnce = (error: Error) => {
          if (!resolved) {
            resolved = true;
            setIsLoading(false);
            cleanup();
            reject(error);
          }
        };
        
        // Enhanced event handling for native iOS
        input.onchange = async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0];
          console.log('[Native File Picker] File selected:', file ? {
            name: file.name,
            size: file.size,
            type: file.type
          } : 'none');
          
          if (file) {
            try {
              // Validate file type
              if (!isValidDocumentType(file)) {
                toast({
                  title: "Invalid File Type",
                  description: "Please select a PDF, DOC, or DOCX file.",
                  variant: "destructive",
                });
                cleanup();
                setIsLoading(false);
                resolve(null);
                return;
              }

              // Validate file size (max 10MB)
              if (file.size > 10 * 1024 * 1024) {
                toast({
                  title: "File Too Large",
                  description: "Resume must be less than 10MB.",
                  variant: "destructive",
                });
                resolveOnce(null);
                return;
              }

              console.log('[Native File Picker] File validation passed, reading data...');
              const reader = new FileReader();
              reader.onload = () => {
                const base64Data = reader.result as string;
                console.log('[Native File Picker] File data read successfully');
                resolveOnce({
                  data: base64Data,
                  name: file.name,
                  type: file.type,
                  size: file.size
                });
              };
              reader.onerror = () => {
                console.error('[Native File Picker] Error reading file data');
                rejectOnce(new Error('Failed to read file'));
              };
              reader.readAsDataURL(file);
            } catch (error) {
              console.error('[Native File Picker] Error processing file:', error);
              rejectOnce(error instanceof Error ? error : new Error('Unknown error'));
            }
          } else {
            console.log('[Native File Picker] No file selected');
            resolveOnce(null);
          }
        };
        
        input.oncancel = () => {
          console.log('[Native File Picker] File selection cancelled');
          resolveOnce(null);
        };
        
        // Add focus/blur detection for more robust cancellation handling
        let focusLost = false;
        const handleFocusLoss = () => {
          focusLost = true;
          setTimeout(() => {
            if (focusLost && !resolved) {
              console.log('[Native File Picker] Focus lost, assuming cancellation');
              resolveOnce(null);
            }
          }, 1000); // Give 1 second for the picker to show
        };
        
        const handleFocusReturn = () => {
          focusLost = false;
        };
        
        window.addEventListener('blur', handleFocusLoss);
        window.addEventListener('focus', handleFocusReturn);
        
        // Timeout fallback to prevent infinite loading
        const timeoutId = setTimeout(() => {
          if (!resolved) {
            console.warn('[Native File Picker] Operation timed out, resolving with null');
            resolveOnce(null);
          }
        }, 30000); // 30 second timeout
        
        const cleanup = () => {
          clearTimeout(timeoutId);
          window.removeEventListener('blur', handleFocusLoss);
          window.removeEventListener('focus', handleFocusReturn);
          if (input.parentNode) {
            input.parentNode.removeChild(input);
          }
        };
        
        // Add to DOM and trigger click for native iOS picker
        document.body.appendChild(input);
        
        // Enhanced timing for iOS recognition
        setTimeout(() => {
          console.log('[Native File Picker] Triggering native file picker...');
          input.focus();
          input.click();
        }, 100);
      });

    } catch (error: unknown) {
      setIsLoading(false);
      console.error('[Native File Picker] Error:', error);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('cancelled') || errorMessage.includes('canceled')) {
        console.log('[Native File Picker] User cancelled file selection');
        return null;
      }
      
      throw error;
    }
  };


  const webFilePickerFallback = (): Promise<FilePickerResult | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            // Validate file type
            if (!isValidDocumentType(file)) {
              toast({
                title: "Invalid File Type",
                description: "Please select a PDF, DOC, or DOCX file.",
                variant: "destructive",
              });
              setIsLoading(false);
              resolve(null);
              return;
            }

            // Validate file size (max 10MB)
            if (file.size > 10 * 1024 * 1024) {
              toast({
                title: "File Too Large",
                description: "Resume must be less than 10MB.",
                variant: "destructive",
              });
              setIsLoading(false);
              resolve(null);
              return;
            }

            const reader = new FileReader();
            reader.onload = () => {
              setIsLoading(false);
              const base64Data = reader.result as string;
              resolve({
                data: base64Data,
                name: file.name,
                type: file.type,
                size: file.size
              });
            };
            reader.onerror = () => {
              setIsLoading(false);
              resolve(null);
            };
            reader.readAsDataURL(file);
          } catch {
            setIsLoading(false);
            resolve(null);
          }
        } else {
          setIsLoading(false);
          resolve(null);
        }
      };
      
      input.click();
    });
  };

  const isValidDocumentType = (file: File): boolean => {
    const validTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const validExtensions = ['.pdf', '.doc', '.docx'];
    const hasValidType = validTypes.includes(file.type);
    const hasValidExtension = validExtensions.some(ext => 
      file.name.toLowerCase().endsWith(ext)
    );
    
    return hasValidType || hasValidExtension;
  };

  return {
    pickDocument,
    isLoading,
    isNative
  };
}