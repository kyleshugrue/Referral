import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Loader2 } from 'lucide-react';

interface Point {
  x: number;
  y: number;
}

interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropperProps {
  imageUrl: string;
  onComplete: (croppedImageUrl: string) => Promise<void>;
  onCancel: () => void;
  aspectRatio?: number;
  open: boolean;
}

export default function ImageCropper({
  imageUrl,
  onComplete,
  onCancel,
  aspectRatio = 1,
  open
}: ImageCropperProps) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const onCropChange = (crop: Point) => {
    setCrop(crop);
  };

  const onZoomChange = (zoom: number) => {
    setZoom(zoom);
  };

  const onCropAreaChange = useCallback((_: Area, croppedAreaPixels: Area) => {
    setCroppedAreaPixels(croppedAreaPixels);
  }, []);

  const createCroppedImage = async () => {
    setIsProcessing(true);
    
    try {
      console.log("Starting image crop process...");
      
      if (!croppedAreaPixels) {
        console.error("No cropped area pixels available");
        setIsProcessing(false);
        return;
      }
      
      const image = new Image();
      image.crossOrigin = "anonymous"; // Add this to handle cross-origin images
      image.src = imageUrl;

      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = (e) => {
          console.error("Error loading image:", e);
          reject(new Error("Failed to load image"));
        };
      });

      console.log("Image loaded successfully, creating canvas...");
      
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        console.error("Failed to get canvas context");
        setIsProcessing(false);
        return;
      }

      // Set dimensions
      canvas.width = croppedAreaPixels.width;
      canvas.height = croppedAreaPixels.height;
      
      console.log("Drawing image to canvas with dimensions:", {
        width: croppedAreaPixels.width,
        height: croppedAreaPixels.height,
        x: croppedAreaPixels.x,
        y: croppedAreaPixels.y
      });

      // Draw the image to the canvas
      ctx.drawImage(
        image,
        croppedAreaPixels.x,
        croppedAreaPixels.y,
        croppedAreaPixels.width,
        croppedAreaPixels.height,
        0,
        0,
        croppedAreaPixels.width,
        croppedAreaPixels.height
      );

      // Convert canvas to data URL
      const croppedImageUrl = canvas.toDataURL('image/jpeg', 0.9);
      console.log("Image cropped successfully, sending result...");
      
      // Pass the cropped image URL to the parent component and await its completion
      await onComplete(croppedImageUrl);
      
      // Now we can reset the processing state since the parent's async operation is complete
      setIsProcessing(false);
    } catch (e) {
      console.error("Error in createCroppedImage:", e);
      setIsProcessing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Center and Crop Your Profile Picture</DialogTitle>
        </DialogHeader>
        <div className="relative w-full" style={{ height: '500px' }}>
          <Cropper
            image={imageUrl}
            crop={crop}
            zoom={zoom}
            aspect={aspectRatio}
            onCropChange={onCropChange}
            onZoomChange={onZoomChange}
            onCropComplete={onCropAreaChange}
            cropShape="round"
            showGrid={false}
            style={{
              containerStyle: {
                width: '100%',
                height: '100%',
                backgroundColor: 'rgb(0, 0, 0, 0.7)'
              }
            }}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button 
            variant="outline" 
            onClick={onCancel}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button 
            onClick={createCroppedImage}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}