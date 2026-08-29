import { ChevronLeft, FileText } from "lucide-react";
import { useLocation, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { User } from "@shared/schema";

// Zoomable Image Component
const ZoomableImage = ({ src, alt, isLoaded, onLoad }: {
  src: string;
  alt: string;
  isLoaded: boolean;
  onLoad: () => void;
}) => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [lastDistance, setLastDistance] = useState(0);
  const [lastCenter, setLastCenter] = useState({ x: 0, y: 0 });
  const [isGestureActive, setIsGestureActive] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [isTransitioning] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const velocityRef = useRef({ x: 0, y: 0 });
  const lastMoveTimeRef = useRef(0);
  const animationRef = useRef<number>();

  // Get distance between two touch points
  const getDistance = (touch1: React.Touch, touch2: React.Touch) => {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Get center point between two touches
  const getCenter = (touch1: React.Touch, touch2: React.Touch) => {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  };

  // Constrain translation within bounds
  const constrainTranslation = (x: number, y: number, currentScale: number) => {
    if (currentScale <= 1) return { x: 0, y: 0 };
    
    const container = containerRef.current;
    if (!container) return { x, y };
    
    const rect = container.getBoundingClientRect();
    const maxX = (rect.width * (currentScale - 1)) / 2;
    const maxY = (rect.height * (currentScale - 1)) / 2;
    
    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y))
    };
  };

  // Apply momentum to panning
  const applyMomentum = () => {
    if (!isPanning && (Math.abs(velocityRef.current.x) > 1 || Math.abs(velocityRef.current.y) > 1)) {
      const friction = 0.95;
      velocityRef.current.x *= friction;
      velocityRef.current.y *= friction;
      
      const newX = translateX + velocityRef.current.x;
      const newY = translateY + velocityRef.current.y;
      const constrained = constrainTranslation(newX, newY, scale);
      
      setTranslateX(constrained.x);
      setTranslateY(constrained.y);
      
      if (Math.abs(velocityRef.current.x) > 0.5 || Math.abs(velocityRef.current.y) > 0.5) {
        animationRef.current = requestAnimationFrame(applyMomentum);
      }
    }
  };

  // Handle touch start
  const handleTouchStart = (e: React.TouchEvent) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }
    velocityRef.current = { x: 0, y: 0 };
    
    if (e.touches.length === 2) {
      e.preventDefault(); // Prevent default for two-finger gestures
      e.stopPropagation(); // Stop event from bubbling up
      setIsGestureActive(true);
      setIsPanning(false);
      const distance = getDistance(e.touches[0], e.touches[1]);
      const center = getCenter(e.touches[0], e.touches[1]);
      setLastDistance(distance);
      setLastCenter(center);
    } else if (e.touches.length === 1) {
      // Single finger touch - always allow normal page scrolling
      setIsPanning(false);
      setIsGestureActive(false);
      // Don't prevent default - let normal scrolling work
    }
  };

  // Handle touch move
  const handleTouchMove = (e: React.TouchEvent) => {
    const now = Date.now();
    const timeDelta = now - lastMoveTimeRef.current;
    
    // Only handle two-finger gestures, let single-finger pass through
    if (e.touches.length === 2 && (isGestureActive || scale > 1)) {
      e.preventDefault(); // Prevent default for two-finger gestures
      e.stopPropagation(); // Stop event from bubbling up
      
      if (isGestureActive) {
        // Two-finger zoom
        const currentDistance = getDistance(e.touches[0], e.touches[1]);
        const currentCenter = getCenter(e.touches[0], e.touches[1]);
        
        if (lastDistance > 0) {
          // Smooth scale change with damping
          const scaleChange = currentDistance / lastDistance;
          const dampedScaleChange = 1 + (scaleChange - 1) * 0.8;
          const newScale = Math.min(Math.max(scale * dampedScaleChange, 0.5), 4);
          
          // Smooth translation
          const deltaX = (currentCenter.x - lastCenter.x) * 0.8;
          const deltaY = (currentCenter.y - lastCenter.y) * 0.8;
          
          const newX = translateX + deltaX;
          const newY = translateY + deltaY;
          const constrained = constrainTranslation(newX, newY, newScale);
          
          setScale(newScale);
          setTranslateX(constrained.x);
          setTranslateY(constrained.y);
        }
        
        setLastDistance(currentDistance);
        setLastCenter(currentCenter);
      } else if (scale > 1) {
        // Two-finger panning when zoomed in
        const center = getCenter(e.touches[0], e.touches[1]);
        const deltaX = center.x - lastCenter.x;
        const deltaY = center.y - lastCenter.y;
        
        // Calculate velocity for momentum
        if (timeDelta > 0) {
          velocityRef.current.x = deltaX / timeDelta * 16;
          velocityRef.current.y = deltaY / timeDelta * 16;
        }
        
        const newX = translateX + deltaX;
        const newY = translateY + deltaY;
        const constrained = constrainTranslation(newX, newY, scale);
        
        setTranslateX(constrained.x);
        setTranslateY(constrained.y);
        setLastCenter(center);
        setIsPanning(true);
      }
    }
    // All single finger touches pass through normally for page scrolling
    
    lastMoveTimeRef.current = now;
  };

  // Handle touch end
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (e.touches.length < 2 && (isGestureActive || isPanning)) {
      e.preventDefault(); // Only prevent default when ending our gestures
      e.stopPropagation();
      setIsGestureActive(false);
      setLastDistance(0);
    }
    
    if (e.touches.length === 0) {
      setIsPanning(false);
      // Start momentum animation
      if (scale > 1 && (isGestureActive || isPanning)) {
        animationRef.current = requestAnimationFrame(applyMomentum);
      }
    }
  };



  // Reset on image change and cleanup
  useEffect(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    setIsGestureActive(false);
    setIsPanning(false);
    velocityRef.current = { x: 0, y: 0 };
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [src]);

  return (
    <div 
      ref={containerRef}
      className="relative overflow-hidden select-none"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{ 
        cursor: isPanning ? 'grabbing' : scale > 1 ? 'grab' : 'zoom-in',
        touchAction: 'pan-y' // Always allow vertical scrolling
      }}
    >
      <img
        ref={imageRef}
        src={src}
        alt={alt}
        className={`w-full h-auto ${!isLoaded ? 'hidden' : ''} ${
          isTransitioning ? 'transition-transform duration-300 ease-out' : 'transition-none'
        }`}
        loading="eager"
        onLoad={onLoad}
        style={{
          transform: `scale(${scale}) translate(${translateX / scale}px, ${translateY / scale}px)`,
          transformOrigin: 'center center',
          willChange: isGestureActive || isPanning ? 'transform' : 'auto',
        }}
        draggable={false}
      />
      
      {/* Zoom indicator */}
      {scale > 1 && (
        <div className="absolute top-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded-md">
          {Math.round(scale * 100)}%
        </div>
      )}
      
      {/* Instructions overlay */}
      {scale === 1 && (
        <div className="absolute bottom-2 left-2 bg-black/75 text-white text-xs px-2 py-1 rounded-md">
          Pinch to zoom • Two fingers to pan
        </div>
      )}
      
      {/* Zoomed instructions */}
      {scale > 1 && (
        <div className="absolute bottom-2 left-2 bg-black/75 text-white text-xs px-2 py-1 rounded-md">
          Use two fingers to pan around
        </div>
      )}
    </div>
  );
};

const ResumeViewPage = () => {
  const [, params] = useRoute<{ userId: string, returnPath?: string }>("/resume/:userId/:returnPath?");
  const [, setLocation] = useLocation();
  const [resumeUrls, setResumeUrls] = useState<string[]>([]);
  const [imagesLoaded, setImagesLoaded] = useState<Record<number, boolean>>({});
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const preloadedImages = useRef<HTMLImageElement[]>([]);
  const userId = params?.userId;
  const returnPath = params?.returnPath || "/network/search";

  // Debug info
  console.log("ResumeViewPage - userId:", userId);
  console.log("ResumeViewPage - returnPath:", returnPath);

  // Fetch user profile to get resume URLs
  const { data: user, isLoading, error } = useQuery<User>({
    queryKey: [`/api/users/${userId}`],
    enabled: !!userId,
  });

  // Debug info
  console.log("ResumeViewPage - user data:", user);
  console.log("ResumeViewPage - error:", error);

  // Preload images for smoother rendering
  const preloadImages = (urls: string[]) => {
    preloadedImages.current = [];
    const newLoadedState: Record<number, boolean> = {};

    urls.forEach((url, index) => {
      newLoadedState[index] = false;
      const img = new Image();

      img.onload = () => {
        setImagesLoaded(prev => ({
          ...prev,
          [index]: true
        }));
      };

      img.src = url;
      preloadedImages.current.push(img);
    });

    setImagesLoaded(newLoadedState);
  };

  useEffect(() => {
    if (user?.resumePreviewUrls && user.resumePreviewUrls.length > 0) {
      console.log("ResumeViewPage - Setting resume URLs:", user.resumePreviewUrls);
      setResumeUrls(user.resumePreviewUrls);
      preloadImages(user.resumePreviewUrls);
      // Mark that we've received valid data to prevent flashing the "not available" message
      setInitialLoadComplete(true);
    } else if (user && (!user.resumePreviewUrls || user.resumePreviewUrls.length === 0)) {
      // Only show "not available" when we've confirmed the user has no resume URLs
      setInitialLoadComplete(true);
    }
  }, [user]);

  const handleBack = () => {
    // Get the decoded return path
    const decodedPath = decodeURIComponent(returnPath);

    // If returning to the profile page, ensure we go to the preview tab
    if (decodedPath.includes('/profile')) {
      // Add '?tab=preview' to ensure it opens in preview mode
      setLocation(`${decodedPath}?tab=preview`);
    } else {
      // For network or other pages where the user was likely viewing a profile dialog
      if (userId) {
        // Store the ID of the profile that should be reopened
        sessionStorage.setItem('reopenProfileId', userId);

        // Also store a flag that indicates we're coming from resume view
        // This will be used to show the dialog immediately without a flash of the network page
        sessionStorage.setItem('instantReopenProfile', 'true');

        // Store the current page path so we can handle the correct page reopening
        // This is especially important for the requests page and other specific pages
        sessionStorage.setItem('returnPathSource', decodedPath);

        console.log(`Storing profile ID ${userId} to reopen dialog immediately. Return path: ${decodedPath}`);

        // Create a small delay before navigation to ensure storage is set
        setTimeout(() => {
          // Use the return path as is
          setLocation(decodedPath);
        }, 50);
      } else {
        // If no user ID, just navigate back normally
        setLocation(decodedPath);
      }
    }
  };

  // Always show loading state until we've completed initial data fetch and processing
  if (isLoading || !initialLoadComplete) {
    return (
      <div className="min-h-screen bg-slate-800">
        {/* Fixed header with safe area padding */}
        <div className="sticky top-0 bg-white z-10 shadow-md safe-area-top">
          <div className="p-4 pt-8 flex items-center">
            <button 
              onClick={handleBack}
              className="flex items-center text-primary"
            >
              <ChevronLeft className="mr-2" size={20} />
              Back to Profile
            </button>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
          <div className="animate-spin h-10 w-10 border-4 border-primary/20 border-t-primary rounded-full"></div>
          <p className="text-white text-sm">Loading resume...</p>
        </div>
      </div>
    );
  }

  // Only show the "Resume Not Available" message after initial load is complete
  if (!resumeUrls.length && initialLoadComplete) {
    return (
      <div className="min-h-screen bg-slate-800">
        {/* Fixed header with safe area padding */}
        <div className="sticky top-0 bg-white z-10 shadow-md safe-area-top">
          <div className="p-4 pt-8 flex items-center">
            <button 
              onClick={handleBack}
              className="flex items-center text-primary"
            >
              <ChevronLeft className="mr-2" size={20} />
              Back to Profile
            </button>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center h-[50vh] p-6">
          <div className="bg-white rounded-lg p-8 text-center max-w-md shadow-lg">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Resume Not Available</h2>
            <p className="text-muted-foreground">
              The resume you're looking for is not available or could not be loaded.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800 min-h-screen">
      {/* Fixed header - extra top padding to prevent being cut off by status bar on mobile */}
      <div className="sticky top-0 bg-white z-10 shadow-md safe-area-top">
        <div className="p-4 pt-8 flex items-center">
          <button 
            onClick={handleBack}
            className="flex items-center text-primary"
          >
            <ChevronLeft className="mr-2" size={20} />
            Back to Profile
          </button>
        </div>
      </div>

      {/* Scrollable content area - no extra bottom padding */}
      <div className="px-4 pt-6 pb-safe">
        {resumeUrls.map((url, i, arr) => (
          <div 
            key={i} 
            className={`bg-white rounded-lg overflow-hidden max-w-2xl mx-auto shadow-xl ${
              i < arr.length - 1 ? 'mb-8' : 'mb-2'
            }`}
          >
            {/* Show loading skeleton until the specific image is loaded */}
            {!imagesLoaded[i] && (
              <div className="w-full aspect-[3/4] bg-gray-200 animate-pulse flex items-center justify-center">
                <FileText className="h-12 w-12 text-gray-400" />
              </div>
            )}

            <ZoomableImage
              src={url}
              alt={`Resume page ${i + 1}`}
              isLoaded={imagesLoaded[i]}
              onLoad={() => {
                // Mark this specific image as loaded on render
                setImagesLoaded(prev => ({
                  ...prev,
                  [i]: true
                }));
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default ResumeViewPage;