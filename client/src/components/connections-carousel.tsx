import { useCallback, useEffect, useState, useMemo } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { type User } from "@shared/schema";
import { useDeviceType } from "@/hooks/use-device-type";
import { UserAvatar } from "@/components/user-avatar";

interface Connection {
  otherUser: User;
  id: number;
  createdAt: string;
  isNew?: boolean; // Add isNew flag to highlight new connections
}

interface ConnectionsCarouselProps {
  connections: Connection[];
  onSelectProfile: (profile: User) => void;
  onConnectionClick?: (connection: Connection) => void;
  isSearchFiltered?: boolean; // New prop to indicate if connections are filtered by search
}

export default function ConnectionsCarousel({ 
  connections, 
  onSelectProfile,
  onConnectionClick,
  isSearchFiltered = false
}: ConnectionsCarouselProps) {
  // Get device type
  const deviceType = useDeviceType();
  
  // Initialize carousel
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    loop: false,
    dragFree: true,
    containScroll: "trimSnaps",
    inViewThreshold: 0,
    skipSnaps: true
  });

  // State hooks
  const [scrollState, setScrollState] = useState({
    prevBtnEnabled: false,
    nextBtnEnabled: false
  });

  // Memoized connections with basic validation and sorting
  const validConnections = useMemo(() => 
    (connections || [])
      .filter(conn => conn?.otherUser)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), 
    [connections]
  );

  // Memoized callbacks
  const updateScrollButtons = useCallback(() => {
    if (!emblaApi) return;

    setScrollState({
      prevBtnEnabled: emblaApi.canScrollPrev(),
      nextBtnEnabled: emblaApi.canScrollNext()
    });
  }, [emblaApi]);

  const scrollPrev = useCallback(() => {
    if (emblaApi) emblaApi.scrollPrev();
  }, [emblaApi]);

  const scrollNext = useCallback(() => {
    if (emblaApi) emblaApi.scrollNext();
  }, [emblaApi]);

  const handleSelectProfile = useCallback((profile: User) => {
    if (onConnectionClick) {
      const connection = validConnections.find(conn => conn.otherUser.id === profile.id);
      if (connection) {
        onConnectionClick(connection);
        return;
      }
    }
    onSelectProfile(profile);
  }, [onSelectProfile, onConnectionClick, validConnections]);

  // Effects
  useEffect(() => {
    if (!emblaApi) return;

    updateScrollButtons();
    emblaApi.on("select", updateScrollButtons);
    emblaApi.on("reInit", updateScrollButtons);

    return () => {
      emblaApi.off("select", updateScrollButtons);
      emblaApi.off("reInit", updateScrollButtons);
    };
  }, [emblaApi, updateScrollButtons]);

  // Show empty state only if there are truly no connections
  if (!validConnections.length) {
    // If this is a search filter situation, show a smaller empty state
    if (isSearchFiltered) {
      return (
        <div className="overflow-visible">
          <div className="flex gap-3 min-h-[115px] pt-3" style={{ paddingRight: '8px', maxWidth: '1536px', margin: '0' }}>
            {/* Empty - maintain same height as normal carousel but show nothing */}
          </div>
        </div>
      );
    }
    
    // Show the full "No connections yet" message only when user truly has no connections
    return (
      <div className="flex items-center justify-center min-h-[65vh]">
        <div className="text-center px-4 mx-4">
          <h2 className="text-xl font-semibold mb-2">
            No connections yet
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Start connecting with other professionals to build your network
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-visible">
      <div className="overflow-x-scroll overflow-y-visible" ref={emblaRef}>
        {/* Added extra padding-top to ensure blue glow isn't cut off by elements above */}
        <div className="flex gap-3 min-h-[115px] pt-3" style={{ paddingRight: '8px', maxWidth: '1536px', margin: '0' }}>
          {validConnections.map(({ otherUser, id, isNew }, index) => (
            <div 
              key={id} 
              className={`flex-[0_0_80px] min-w-0 cursor-pointer py-1 z-10 ${index === 0 ? 'ml-4' : ''}`}
              onClick={() => handleSelectProfile(otherUser)}
            >
              <div className="flex flex-col items-center gap-1">
                <div className={`h-14 w-14 rounded-full overflow-hidden relative ${isNew ? 'shadow-[0_0_10px_3px_rgba(96,165,250,0.7)]' : ''}`}>
                  <UserAvatar 
                    user={otherUser}
                    className="h-full w-full rounded-full"
                    fallbackClassName="text-xl font-medium bg-primary text-white"
                  />
                  
                  {/* Removed blue dot indicator as requested, keeping only the blue glow effect */}
                </div>
                <p className={`text-sm text-center truncate w-full ${isNew ? 'font-bold' : 'font-medium'}`}>
                  {otherUser.fullName || 'Unknown'}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Only show navigation arrows on desktop */}
      {deviceType === 'desktop' && (
        <div className="flex justify-between absolute top-1/2 transform -translate-y-1/2 w-full left-0 right-0 pointer-events-none z-20 px-1">
          {scrollState.prevBtnEnabled ? (
            <Button
              variant="secondary"
              size="icon"
              onClick={scrollPrev}
              className="rounded-full shadow-md pointer-events-auto transition-all h-8 w-8 bg-background/90 hover:bg-background border border-gray-200"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : <div className="w-8"></div>}
          <div className="flex-1"></div>
          {scrollState.nextBtnEnabled ? (
            <Button
              variant="secondary"
              size="icon"
              onClick={scrollNext}
              className="rounded-full shadow-md pointer-events-auto transition-all h-8 w-8 bg-background/90 hover:bg-background border border-gray-200"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          ) : <div className="w-8"></div>}
        </div>
      )}
    </div>
  );
}