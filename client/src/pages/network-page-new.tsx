import { Card, CardContent } from "@/components/ui/card";
import { useLocation } from "wouter";
import { Search, MapPin, Clock } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { type User } from "@shared/schema";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { SynergyIcon } from "@/components/icons/synergy-icon";
import { SynergyPattern } from "@/components/patterns/synergy-pattern";
import { SynergyComplexIcon } from "@/components/patterns/synergy-complex-icon";
import { useDeviceType } from "@/hooks/use-device-type";
import useEmblaCarousel from 'embla-carousel-react';
import ProfileDialog from "@/components/profile-dialog";
import { usePushNotifications } from "@/hooks/use-push-notifications";

// Define interfaces for match data
interface MatchWithDescription extends User {
  matchDescription?: string;
  matchScore?: number;
  matchReasons?: string[];
  jobTitle?: string;
  location?: string;
}

interface MatchesResponse {
  matches: MatchWithDescription[];
  apiConnectionIssue: boolean;
}

export default function NetworkPage() {
  const [, setLocation] = useLocation();
  const [, setMountedScrollPos] = useState(0);
  const deviceType = useDeviceType();
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [, emblaApi] = useEmblaCarousel({
    align: 'start',
    loop: false,
    dragFree: true,
    skipSnaps: false,
    containScroll: 'trimSnaps',
    breakpoints: {
      '(min-width: 1280px)': { slidesToScroll: 3 },
      '(min-width: 768px)': { slidesToScroll: 2 }
    }
  });
  
  const [, setCanScrollPrev] = useState(false);
  const [, setCanScrollNext] = useState(true);
  
  // Initialize push notifications when user first visits network page
  const { initializePushNotifications } = usePushNotifications();

  // Update scroll button states
  useEffect(() => {
    if (!emblaApi) return;
    
    const onSelect = () => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    };
    
    // Update scroll state on various events
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    emblaApi.on("resize", onSelect);
    
    // Initial check
    onSelect();
    
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
      emblaApi.off("resize", onSelect);
    };
  }, [emblaApi]);

  // Get current user for displaying information
  const { data: currentUser, isLoading } = useQuery<User>({
    queryKey: ["/api/user"],
  });
  
  // Get Synergy AI match results
  useQuery<MatchesResponse>({
    queryKey: ["/api/matches/synergy"],
    refetchOnMount: true,
  });

  // Log mount/unmount for debugging
  useEffect(() => {
    const scrollPos = window.scrollY;
    console.log('NetworkPage mounted, scroll position:', scrollPos);
    setMountedScrollPos(scrollPos);

    return () => {
      console.log('NetworkPage unmounted, final scroll position:', window.scrollY);
    };
  }, []);

  // Ensure page resets to top when loaded
  useEffect(() => {
    console.log('Page number changed, resetting scroll');
    window.scrollTo(0, 0);
  }, []);

  // Initialize push notifications when user first visits network page
  useEffect(() => {
    const initializeNotifications = async () => {
      // Check if we've already asked for permission permanently (localStorage)
      const hasAskedForPermission = localStorage.getItem('pushNotificationRequested');
      
      if (!hasAskedForPermission) {
        console.log('[NetworkPage] First visit to network page - requesting push notification permission');
        
        // Mark that we've asked for permission permanently
        localStorage.setItem('pushNotificationRequested', 'true');
        
        // Request push notification permission
        const success = await initializePushNotifications();
        
        if (success) {
          console.log('[NetworkPage] Push notifications successfully initialized');
        } else {
          console.log('[NetworkPage] Push notifications not initialized (permission denied or not iOS native)');
        }
      } else {
        console.log('[NetworkPage] Push notification permission already requested previously');
      }
    };

    // Only run if user data is loaded to ensure they're authenticated
    if (currentUser) {
      initializeNotifications();
    }
  }, [currentUser, initializePushNotifications]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-4rem)]">
        <Loader2 className="h-8 w-8 animate-spin mb-4 text-primary" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  // Render the desktop layout
  if (deviceType === 'desktop') {
    return (
      <>
        {/* Profile dialog for desktop view */}
        {selectedProfile && (
          <ProfileDialog
            profile={selectedProfile}
            open={!!selectedProfile}
            onOpenChange={(open) => {
              if (!open) setSelectedProfile(null);
            }}
          />
        )}
        
        <div className="flex flex-col items-center p-6 max-w-7xl mx-auto space-y-4 mt-4 pb-8">
          {/* Network layout with Synergy AI on left, Search+Specialty on right */}
          <div className="w-full flex gap-6">
            {/* Left column: Synergy AI section */}
            <div className="w-2/3">
              {/* Synergy AI Title and Description Section */}
              <div style={{ 
                padding: '4px 16px 4px 16px',
                backgroundColor: 'white'
              }}>
                <div className="flex justify-between items-start">
                  <div>
                    <h1 style={{ 
                      fontSize: '24px', 
                      fontWeight: 'bold',
                      color: 'hsl(215, 25%, 27%)',
                      marginBottom: '4px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <SynergyIcon style={{ height: '28px', width: '28px' }} />
                        <span>Synergy AI</span>
                      </div>
                    </h1>
                    <p style={{
                      color: '#666',
                      fontSize: '14px',
                      marginTop: '2px'
                    }}>
                      Connect with industry professionals who share your relocation interests or work at companies you're interested in joining
                    </p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Right column: Network Search + Specialty Matching */}
            <div className="w-1/3 flex flex-col gap-4">
              {/* Network Search section */}
              <div>
                <h1 className="text-2xl font-bold mb-3 text-primary">Network Search</h1>
                <Card 
                  className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0 w-full"
                  onClick={() => setLocation('/network/search')}
                  style={{
                    backgroundColor: 'hsl(215, 20%, 65%)'
                  }}
                >
                  <CardContent className="p-4 flex items-center gap-4">
                    <Search className="h-6 w-6 text-white" />
                    <p className="text-white text-sm">
                      Browse all professionals on the platform
                    </p>
                  </CardContent>
                </Card>
              </div>
              
              {/* Specialty Matching section */}
              <div className="mt-4">
                <h1 className="text-2xl font-bold mb-3 text-primary">Specialty Matching</h1>
                
                {/* Shared interests card */}
                <Card 
                  className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-64 mb-4"
                  onClick={() => setLocation('/network/shared-interests')}
                  style={{
                    background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                    color: 'white'
                  }}
                >
                  <CardContent className="p-6 flex flex-col h-full relative">
                    {/* Large icon centered in top 75% of button */}
                    <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                      <MapPin className="h-32 w-32 text-white opacity-20" />
                    </div>
                    
                    {/* Text at bottom left with lower title */}
                    <div className="mt-auto">
                      <div className="h-4"></div> {/* Extra space to push title lower */}
                      <h2 className="text-lg font-medium mb-1">Shared Interests</h2>
                      <p className="text-white/90 text-sm">
                        People in your area with shared professional interests and hobbies
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* Shared experience card */}
                <Card 
                  className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-64"
                  onClick={() => setLocation('/network/shared-experience')}
                  style={{
                    background: 'linear-gradient(to bottom, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
                    color: 'white'
                  }}
                >
                  <CardContent className="p-6 flex flex-col h-full relative">
                    {/* Large icon centered in top 75% of button */}
                    <div className="absolute top-0 left-0 right-0 h-3/4 flex items-center justify-center">
                      <Clock className="h-32 w-32 text-white opacity-20" />
                    </div>
                    
                    {/* Text at bottom left with lower title */}
                    <div className="mt-auto">
                      <div className="h-4"></div> {/* Extra space to push title lower */}
                      <h2 className="text-lg font-medium mb-1">Shared Experience</h2>
                      <p className="text-white/90 text-sm">
                        Industry veterans with experience similar to yours
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Mobile layout for smaller screens
  return (
    <>
      {/* Profile dialog for mobile view */}
      {selectedProfile && (
        <ProfileDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => {
            if (!open) setSelectedProfile(null);
          }}
        />
      )}
      
      <div className="flex flex-col items-center p-4 max-w-lg mx-auto mt-2 pb-28">
        {/* Search all users - full width */}
        <div className="w-full mt-0">
          <h1 className="text-2xl font-bold mb-3 text-primary">Network Search</h1>
          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0 w-full"
            onClick={() => setLocation('/network/search')}
            style={{
              backgroundColor: 'hsl(215, 20%, 65%)'
            }}
          >
            <CardContent className="p-4 flex items-center gap-3">
              <Search className="h-5 w-5 text-white" />
              <p className="text-white text-sm">
                Browse all professionals on the platform
              </p>
            </CardContent>
          </Card>
        </div>
        
        {/* Specialty Matching title for mobile - reducing margin */}
        <div className="w-full mt-4">
          <h1 className="text-2xl font-bold mb-2 text-primary">Specialty Matching</h1>
        </div>
        
        {/* Synergy AI button - between Specialty Matching title and specialty cards */}
        <div className="w-full mb-2">
          <Card 
            className="w-full cursor-pointer hover:shadow-md transition-shadow rounded-xl border-0 relative overflow-hidden"
            onClick={() => setLocation('/matches/suggestions')}
            style={{
              background: 'hsl(215, 20%, 65%)',
              color: 'white',
              minHeight: '210px'
            }}
          >
            <div className="relative h-full">
              {/* Fixed height container for the title and icons */}
              <div className="flex flex-col justify-center items-center h-full pt-2">
                {/* Icons with title overlay, fixed position in the center */}
                <div className="relative flex items-center justify-center" style={{ height: '140px', marginBottom: '10px' }}>
                  {/* Background icons */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    {/* First icon (left) */}
                    <div 
                      className="absolute z-0" 
                      style={{ 
                        opacity: 0.3,
                        transform: 'translateX(-70px)'
                      }}
                    >
                      <SynergyPattern style={{ height: '130px', width: '130px', color: 'white' }} />
                    </div>
                    
                    {/* Second icon (right) */}
                    <div 
                      className="absolute z-0" 
                      style={{ 
                        opacity: 0.3,
                        transform: 'translateX(70px)'
                      }}
                    >
                      <SynergyComplexIcon style={{ height: '130px', width: '130px', color: 'white' }} />
                    </div>
                  </div>
                  
                  {/* Center title with effects */}
                  <div className="z-10 flex flex-col items-center justify-center relative">
                    <div className="mb-3">
                      <SynergyIcon style={{ height: '60px', width: '60px' }} />
                    </div>
                    <h2 className="text-2xl font-bold text-center relative z-10 whitespace-nowrap">Synergy AI</h2>
                  </div>
                </div>
                
                {/* Description text */}
                <div className="px-6 text-center mb-5">
                  <p className="text-sm">
                    Discover professionals who match your career interests, experience, or relocation preferences
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
        
        {/* Specialty cards section for mobile - now in a 1x2 grid */}
        <div className="grid grid-cols-1 gap-4 w-full">
          {/* Shared interests - first card */}
          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-28"
            onClick={() => setLocation('/network/shared-interests')}
            style={{
              background: 'linear-gradient(to right, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
              color: 'white'
            }}
          >
            <CardContent className="p-4 flex items-center h-full relative">
              {/* Large icon left side */}
              <div className="flex justify-center items-center h-full mr-4">
                <MapPin className="h-16 w-16 text-white opacity-20 absolute left-4" />
              </div>
              
              {/* Text at right side */}
              <div className="ml-12">
                <h2 className="text-lg font-medium mb-1">Shared Interests</h2>
                <p className="text-white/90 text-sm">
                  People in your area with similar interests
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Shared experience - second card */}
          <Card 
            className="cursor-pointer hover:shadow-md transition-shadow rounded-xl overflow-hidden border-0 h-28"
            onClick={() => setLocation('/network/shared-experience')}
            style={{
              background: 'linear-gradient(to right, hsl(215, 20%, 65%), hsl(215, 25%, 27%))',
              color: 'white'
            }}
          >
            <CardContent className="p-4 flex items-center h-full relative">
              {/* Large icon left side */}
              <div className="flex justify-center items-center h-full mr-4">
                <Clock className="h-16 w-16 text-white opacity-20 absolute left-4" />
              </div>
              
              {/* Text at right side */}
              <div className="ml-12">
                <h2 className="text-lg font-medium mb-1">Shared Experience</h2>
                <p className="text-white/90 text-sm">
                  Professionals with similar backgrounds
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}