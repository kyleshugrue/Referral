import { useState } from 'react';
import { Camera, CameraResultType, CameraSource, Photo } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { useToast } from '@/hooks/use-toast';

export interface CameraOptions {
  quality?: number;
  allowEditing?: boolean;
  width?: number;
  height?: number;
}

export function useCamera() {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();
  const isNative = Capacitor.isNativePlatform();
  
  // Detect mobile browsers
  const isMobileWeb = !isNative && /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isTouchDevice = !isNative && 'ontouchstart' in window;

  const takePhoto = async (options: CameraOptions = {}) => {
    setIsLoading(true);
    
    try {
      // Default options optimized for profile photos
      const defaultOptions = {
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Uri,
        source: CameraSource.Prompt, // Let user choose camera or photo library
        width: 800,
        height: 800,
        ...options
      };

      let image: Photo;

      if (isNative) {
        // Check and request camera permissions for native platforms
        const permissions = await Camera.checkPermissions();
        
        if (permissions.camera === 'denied' || permissions.photos === 'denied') {
          toast({
            title: "Camera Permission Required",
            description: "Please enable camera and photo library access in your device settings.",
            variant: "destructive",
          });
          setIsLoading(false);
          return null;
        }

        if (permissions.camera !== 'granted' || permissions.photos !== 'granted') {
          const requestResult = await Camera.requestPermissions();
          if (requestResult.camera !== 'granted' || requestResult.photos !== 'granted') {
            toast({
              title: "Permission Denied",
              description: "Camera and photo library access is needed to upload profile photos.",
              variant: "destructive",
            });
            setIsLoading(false);
            return null;
          }
        }

        // Use native camera on iOS/Android
        image = await Camera.getPhoto(defaultOptions);
      } else {
        // Fallback to web file picker for desktop/web
        return await webFilePickerFallback();
      }

      setIsLoading(false);
      return image;

    } catch (error: unknown) {
      setIsLoading(false);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('User cancelled')) {
        // User cancelled photo selection - don't show error
        return null;
      }
      
      console.error('Camera error:', error);
      toast({
        title: "Photo Upload Error",
        description: "Unable to access camera or photo library. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  const takeCameraPhoto = async (options: CameraOptions = {}) => {
    setIsLoading(true);
    
    try {
      const cameraOptions = {
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Uri,
        source: CameraSource.Camera, // Force camera
        width: 800,
        height: 800,
        ...options
      };

      if (isNative) {
        const permissions = await Camera.checkPermissions();
        
        if (permissions.camera === 'denied') {
          toast({
            title: "Camera Permission Required",
            description: "Please enable camera access in your device settings.",
            variant: "destructive",
          });
          setIsLoading(false);
          return null;
        }

        if (permissions.camera !== 'granted') {
          const requestResult = await Camera.requestPermissions();
          if (requestResult.camera !== 'granted') {
            toast({
              title: "Permission Denied",
              description: "Camera access is needed to take photos.",
              variant: "destructive",
            });
            setIsLoading(false);
            return null;
          }
        }

        const image = await Camera.getPhoto(cameraOptions);
        setIsLoading(false);
        return image;
      } else {
        return await webFilePickerFallback();
      }

    } catch (error: unknown) {
      setIsLoading(false);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('User cancelled')) {
        return null;
      }
      
      console.error('Camera error:', error);
      toast({
        title: "Camera Error",
        description: "Unable to access camera. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  const selectFromLibrary = async (options: CameraOptions = {}) => {
    setIsLoading(true);
    
    try {
      const libraryOptions = {
        quality: 90,
        allowEditing: true,
        resultType: CameraResultType.Uri,
        source: CameraSource.Photos, // Force photo library
        width: 800,
        height: 800,
        ...options
      };

      if (isNative) {
        const permissions = await Camera.checkPermissions();
        
        if (permissions.photos === 'denied') {
          toast({
            title: "Photo Library Permission Required",
            description: "Please enable photo library access in your device settings.",
            variant: "destructive",
          });
          setIsLoading(false);
          return null;
        }

        if (permissions.photos !== 'granted') {
          const requestResult = await Camera.requestPermissions();
          if (requestResult.photos !== 'granted') {
            toast({
              title: "Permission Denied",
              description: "Photo library access is needed to select photos.",
              variant: "destructive",
            });
            setIsLoading(false);
            return null;
          }
        }

        const image = await Camera.getPhoto(libraryOptions);
        setIsLoading(false);
        return image;
      } else {
        return await webFilePickerFallback();
      }

    } catch (error: unknown) {
      setIsLoading(false);
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('User cancelled')) {
        return null;
      }
      
      console.error('Photo library error:', error);
      toast({
        title: "Photo Library Error",
        description: "Unable to access photo library. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  };

  // Fallback to web file picker for non-native platforms
  const webFilePickerFallback = (): Promise<Photo | null> => {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      
      // For mobile browsers, don't add capture attribute to allow user choice
      // This lets users choose between camera and photo library
      
      // Style the input for mobile compatibility
      input.style.position = 'fixed';
      input.style.top = '-1000px';
      input.style.left = '-1000px';
      input.style.opacity = '0';
      input.style.pointerEvents = 'none';
      
      // Append to body temporarily for mobile browsers
      document.body.appendChild(input);
      
      const cleanup = () => {
        if (document.body.contains(input)) {
          document.body.removeChild(input);
        }
      };
      
      input.onchange = (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = () => {
            setIsLoading(false);
            cleanup();
            resolve({
              webPath: reader.result as string,
              format: file.type.split('/')[1],
              saved: false
            });
          };
          reader.onerror = () => {
            setIsLoading(false);
            cleanup();
            resolve(null);
          };
          reader.readAsDataURL(file);
        } else {
          setIsLoading(false);
          cleanup();
          resolve(null);
        }
      };
      
      input.oncancel = () => {
        setIsLoading(false);
        cleanup();
        resolve(null);
      };
      
      // Focus and click for better mobile compatibility
      setTimeout(() => {
        input.focus();
        input.click();
      }, 100);
    });
  };

  return {
    takePhoto,
    takeCameraPhoto,
    selectFromLibrary,
    isLoading,
    isNative,
    isMobileWeb,
    isTouchDevice
  };
}