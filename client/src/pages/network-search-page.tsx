import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { type User } from "@shared/schema";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SearchableMultiSelect } from "@/components/ui/searchable-multi-select";
import { 
  ChevronDown, 
  ChevronLeft, 
  X, 
  Search, 
  RefreshCw, 
  Loader2, 
  Eraser
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, QUERY_CONFIGS } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useGlobalWebSocket } from "@/hooks/use-global-websocket";
import { useDeviceType } from "@/hooks/use-device-type";
import ProfilePreviewCard from "@/components/profile-preview-card";
import ProfileDialog from "@/components/profile-dialog";
import { useProfiles, connectionRequestCache } from "@/hooks/use-profiles.tsx";
import { IOSKeyboardAwareContainer, useIOSKeyboardAware } from "@/components/ios-keyboard-aware-container";

const PROFILES_PER_PAGE = 40;

// Add type for filter values
interface FilterValues {
  locations: string[];
  companies: string[];
  institutions: string[];
  careerInterests: string[];
  interests: string[];
}

export default function NetworkSearchPage() {
  const [, setLocation] = useLocation();
  // States for filters and UI
  const [searchTerm, setSearchTerm] = useState("");
  const [industryFilters, setIndustryFilters] = useState<string[]>([]);
  const [locationFilters, setLocationFilters] = useState<string[]>([]);
  const [companyFilters, setCompanyFilters] = useState<string[]>([]);
  const [institutionFilters, setInstitutionFilters] = useState<string[]>([]);
  const [interestFilters, setInterestFilters] = useState<string[]>([]);
  const [careerInterestFilters, setCareerInterestFilters] = useState<string[]>([]);
  const [selectedProfile, setSelectedProfile] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [connectingIds, setConnectingIds] = useState<number[]>([]);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  useDeviceType();
  
  // Initialize WebSocket connection for real-time notifications
  useGlobalWebSocket();
  
  // Connect mutation for sending or canceling connection requests
  const connectMutation = useMutation({
    mutationFn: async (userId: number) => {
      // Check if this is a connect or cancel action based on connecting state
      const isAlreadyConnecting = connectingIds.includes(userId);
      
      if (isAlreadyConnecting) {
        // If already connecting, cancel the request
        await apiRequest(
          "DELETE",
          `/api/connections/request/${userId}`
        );
        return { userId, status: "canceled" };
      } else {
        // Otherwise send a new request
        try {
          await apiRequest(
            "POST",
            `/api/connections/request/${userId}`
          );
          return { userId, status: "success" };
        } catch (error) {
          // Check for DUPLICATE_REQUEST error
          if (error instanceof Error && error.message.includes("DUPLICATE_REQUEST")) {
            return { userId, status: "duplicate" };
          }
          throw error;
        }
      }
    },
    onMutate: (userId) => {
      // Check if already connecting to toggle state
      const isAlreadyConnecting = connectingIds.includes(userId);
      
      if (isAlreadyConnecting) {
        // Remove from local state for immediate UI feedback when canceling
        setConnectingIds(prev => prev.filter(id => id !== userId));
        
        // Remove from shared cache
        connectionRequestCache.removePendingRequest(userId);
      } else {
        // Add to local state for immediate UI feedback when connecting
        setConnectingIds(prev => [...prev, userId]);
        
        // Add to shared cache for persistence across page navigations
        connectionRequestCache.addPendingRequest(userId);
      }
    },
    onSuccess: (result) => {
      const { status } = result;
      
      // Handle different status results
      if (status === "duplicate") {
        toast({
          title: "Connection already requested",
          description: "You've already sent a connection request to this user."
        });
      } else if (status === "canceled") {
        toast({
          title: "Request canceled",
          description: "The connection request has been canceled."
        });
      } else {
        toast({
          title: "Connection request sent",
          description: "The user will be notified of your request."
        });
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
    },
    onError: (error, userId) => {
      console.error("Connection error:", error);
      
      // Check if we were trying to connect or cancel
      const wasConnecting = !connectingIds.includes(userId);
      
      toast({
        title: "Error",
        description: wasConnecting 
          ? "Failed to send connection request. Please try again."
          : "Failed to cancel connection request. Please try again.",
        variant: "destructive",
      });
      
      // Revert the local state changes we made in onMutate
      if (wasConnecting) {
        // If we were trying to connect, remove from local state
        setConnectingIds(prev => prev.filter(id => id !== userId));
        
        // Remove from shared cache
        connectionRequestCache.removePendingRequest(userId);
      } else {
        // If we were trying to cancel, add back to local state
        setConnectingIds(prev => [...prev, userId]);
        
        // Add back to shared cache
        connectionRequestCache.addPendingRequest(userId);
      }
    },
  });

  // Query hooks with stable configuration and retry logic
  const {
    profiles = [],
    isLoading: isLoadingProfiles,
    hasMore,
    error,
    refetch: refetchProfiles
  } = useProfiles(page, PROFILES_PER_PAGE);

  // Interface for incoming connection requests
  interface IncomingRequest {
    id: number;
    userId: number;
    senderId: number;
    status: string;
    createdAt: string;
    sender?: User;
  }

  // Requests queries with stable configurations and increased retry attempts
  const { data: incomingRequests = [] } = useQuery<IncomingRequest[]>({
    queryKey: ["/api/connections/requests"],
    ...QUERY_CONFIGS.CONNECTION_DATA
  });

  // Interface for outgoing connection requests (matches API response)
  interface OutgoingRequest {
    id: number;
    senderId: number;
    receiverId: number;
    status: string;
    createdAt: string;
  }

  const { data: outgoingRequests = [], isFetching: isFetchingOutgoing } = useQuery<OutgoingRequest[]>({
    queryKey: ["/api/connections/outgoing"],
    ...QUERY_CONFIGS.CONNECTION_DATA
  });

  // Load cached pending requests on mount
  useEffect(() => {
    const cachedIds = connectionRequestCache.getPendingRequests();
    if (cachedIds.length > 0) {
      setConnectingIds(cachedIds);
    }
  }, []);

  // Subscribe to cache updates for immediate UI refresh when WebSocket notifications arrive
  useEffect(() => {
    const unsubscribe = connectionRequestCache.subscribe((updatedUserIds) => {
      console.log('[NetworkSearchPage] Cache subscription triggered, updating connectingIds:', updatedUserIds);
      setConnectingIds(updatedUserIds);
    });
    return unsubscribe;
  }, []);
  
  // Sync connectingIds state with outgoing requests from the server
  // Wait until isFetching is false to ensure we have fresh server data
  useEffect(() => {
    if (isFetchingOutgoing) {
      console.log('[NetworkSearchPage] Skipping sync - still fetching from server');
      return;
    }
    
    if (Array.isArray(outgoingRequests)) {
      // Sync cache with server data - this prunes stale entries
      const receiverIds = outgoingRequests
        .filter(req => req.status === 'requested')
        .map(req => req.receiverId);
      console.log('[NetworkSearchPage] Syncing cache with fresh server data, receiverIds:', receiverIds);
      connectionRequestCache.syncWithServerData(receiverIds);
      
      // Update local state from the now-synced cache
      const cachedPendingIds = connectionRequestCache.getPendingRequests();
      setConnectingIds(cachedPendingIds);
    }
  }, [outgoingRequests, isFetchingOutgoing]);

  // Handle server errors
  useEffect(() => {
    if (error) {
      toast({
        title: "Connection Error",
        description: "Unable to load profiles. Please try again.",
        variant: "destructive",
      });
    }
  }, [error, toast]);

  // Track connection request status with stable memoization
  const pendingRequests = useMemo(() => {
    const requests = new Map<number, 'incoming' | 'outgoing'>();

    if (Array.isArray(incomingRequests)) {
      incomingRequests.forEach((req: IncomingRequest) => {
        if (req?.status === 'requested' && req?.userId) {
          requests.set(req.userId, 'incoming');
        }
      });
    }

    if (Array.isArray(outgoingRequests)) {
      outgoingRequests.forEach((req: OutgoingRequest) => {
        // Always mark outgoing requests as 'outgoing' to ensure connect buttons show as "Request Sent"
        if (req.status === 'requested' && req.receiverId) {
          requests.set(req.receiverId, 'outgoing');
        }
      });
    }

    // Also include any IDs from the connectingIds state
    connectingIds.forEach(id => {
      if (!requests.has(id)) {
        requests.set(id, 'outgoing');
      }
    });
    
    // Check shared cache for pending requests
    const cachedPendingIds = connectionRequestCache.getPendingRequests();
    cachedPendingIds.forEach((id: number) => {
      // If not already in the requests map, add it as outgoing
      if (!requests.has(id)) {
        console.log(`Adding cached connection request for user ${id} to pendingRequests map`);
        requests.set(id, 'outgoing');
      }
    });

    return requests;
  }, [incomingRequests, outgoingRequests, connectingIds]);

  // Extract unique filter values with error handling
  const filterValues: FilterValues = useMemo(() => {
    try {
      const allLocations = new Set<string>();
      const allCompanies = new Set<string>();
      const allInstitutions = new Set<string>();
      const allCareerInterests = new Set<string>();
      const allInterests = new Set<string>();

      // Add values from each profile to the appropriate set
      profiles.forEach((profile: User) => {
        if (profile.currentLocation) 
          allLocations.add(profile.currentLocation);
        
        if (profile.currentCompany) {
          // Normalize company names for case-insensitive comparison
          const normalizedCompany = profile.currentCompany.toLowerCase();
          // Find if we already have this company with different casing
          const existingCompany = Array.from(allCompanies).find(company => 
            company.toLowerCase() === normalizedCompany
          );
          if (!existingCompany) {
            allCompanies.add(profile.currentCompany);
          }
        }
        
        if (profile.institution) 
          allInstitutions.add(profile.institution);
        
        // Add all career interests
        if (Array.isArray(profile.professionalInterests)) {
          profile.professionalInterests.forEach(interest => {
            if (interest) allCareerInterests.add(interest);
          });
        }
        
        // Add all personal interests
        if (Array.isArray(profile.interests)) {
          profile.interests.forEach(interest => {
            if (interest) allInterests.add(interest);
          });
        }
      });

      return {
        locations: Array.from(allLocations).sort(),
        companies: Array.from(allCompanies).sort(),
        institutions: Array.from(allInstitutions).sort(),
        careerInterests: Array.from(allCareerInterests).sort(),
        interests: Array.from(allInterests).sort()
      };
    } catch (error) {
      console.error("Error extracting filter values:", error);
      return {
        locations: [],
        companies: [],
        institutions: [],
        careerInterests: [],
        interests: []
      };
    }
  }, [profiles]);

  // Observe the scroll position for intersection-based loading
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isLoadingProfiles) return;

    // Use simple intersection observer for loading more data
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          // If we're near the end, load more data
          // Only increment if not already loading and has more to load
          if (!isLoadingProfiles && hasMore) {
            setPage((prev) => prev + 1);
          }
        }
      },
      { threshold: 0.1 } // 10% visibility is enough to trigger
    );

    observer.observe(loadMoreRef.current);

    return () => {
      observer.disconnect();
    };
  }, [loadMoreRef, hasMore, isLoadingProfiles]);

  // Filter profiles based on current filter state
  const filteredProfiles = useMemo(() => {
    if (!profiles || profiles.length === 0) return [];

    return profiles.filter((profile: User) => {
      // Filter by name search term
      if (searchTerm && !profile.fullName.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }

      // Filter by industry
      if (industryFilters.length > 0 && (!profile.industry || !industryFilters.includes(profile.industry))) {
        return false;
      }

      // Filter by location
      if (locationFilters.length > 0 && (!profile.currentLocation || !locationFilters.includes(profile.currentLocation))) {
        return false;
      }

      // Filter by company (case-insensitive)
      if (companyFilters.length > 0 && (!profile.currentCompany || !companyFilters.some(filter => filter.toLowerCase() === profile.currentCompany?.toLowerCase()))) {
        return false;
      }

      // Filter by institution
      if (institutionFilters.length > 0 && (!profile.institution || !institutionFilters.includes(profile.institution))) {
        return false;
      }

      // Filter by career interests (professionalInterests)
      if (careerInterestFilters.length > 0) {
        if (!profile.professionalInterests || profile.professionalInterests.length === 0) {
          return false;
        }
        
        // Check if any of the selected interests are in the profile's interests
        const hasMatchingCareerInterest = careerInterestFilters.some(interest => 
          profile.professionalInterests?.includes(interest)
        );
        
        if (!hasMatchingCareerInterest) {
          return false;
        }
      }

      // Filter by personal interests
      if (interestFilters.length > 0) {
        if (!profile.interests || profile.interests.length === 0) {
          return false;
        }
        
        // Check if any of the selected interests are in the profile's interests
        const hasMatchingInterest = interestFilters.some(interest => 
          profile.interests?.includes(interest)
        );
        
        if (!hasMatchingInterest) {
          return false;
        }
      }

      // Profile passed all filters
      return true;
    });
  }, [
    profiles,
    searchTerm,
    industryFilters,
    locationFilters,
    companyFilters,
    institutionFilters,
    interestFilters,
    careerInterestFilters
  ]);

  // Toggle filter helper function
  const toggleFilter = useCallback((value: string, currentFilters: string[], setFilters: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (!value) return; // Don't do anything for empty values
    
    // For multi-select values, they come in as comma-separated
    if (value.includes(',')) {
      // This is a multi-select event, handle each value
      const values = value.split(',');
      const lastValue = values[values.length - 1];
      
      // Toggle the last value (most recently selected)
      if (currentFilters.includes(lastValue)) {
        // Remove if already there
        setFilters(prev => prev.filter(v => v !== lastValue));
      } else {
        // Add if not there
        setFilters(prev => [...prev, lastValue]);
      }
    } else {
      // Single value toggle
      if (currentFilters.includes(value)) {
        // Remove if already there
        setFilters(prev => prev.filter(v => v !== value));
      } else {
        // Add if not there
        setFilters(prev => [...prev, value]);
      }
    }
  }, []);

  // Handle connect button click
  const handleConnect = useCallback((userId: number) => {
    if (connectMutation.isPending) return; // Prevent multiple clicks during pending state
    connectMutation.mutate(userId);
  }, [connectMutation]);

  // Clear all filter states
  const clearAllFilters = useCallback(() => {
    setSearchTerm("");
    setIndustryFilters([]);
    setLocationFilters([]);
    setCompanyFilters([]);
    setInstitutionFilters([]);
    setInterestFilters([]);
    setCareerInterestFilters([]);
  }, []);

  // Define a list of industries
  const industries = [
    "technology", "healthcare", "finance", "education", "marketing", 
    "sales", "design", "engineering", "human resources", "business",
    "media", "arts", "science", "law", "government", "retail"
  ];

  // Initialize iOS keyboard handling
  useIOSKeyboardAware();

  return (
    <IOSKeyboardAwareContainer className="network-page-container flex flex-col h-[100dvh] max-w-full w-full overflow-hidden">
      {/* Header with back button and title - fixed height */}
      <div className="flex-shrink-0 p-2 pt-3 flex items-center relative">
        <Button
          variant="ghost"
          size="sm"
          className="p-1 font-bold flex items-center text-primary hover:text-primary hover:bg-transparent active:bg-transparent"
          onClick={() => setLocation('/')}
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={3.5} />
          <span className="hidden desktop:inline ml-1">Back</span>
        </Button>
        
        {/* Centered title */}
        <h1 className="text-lg font-bold absolute left-0 right-0 text-center pointer-events-none">
          Network Search
        </h1>
      </div>
      
      {/* Description has been removed as requested */}
      
      {/* Main content area - mobile and desktop views */}
      {/* iOS Capacitor scroll fix: flex-1 with min-h-0 allows proper height calculation */}
      <div 
        className="flex-1 min-h-0 flex flex-col overflow-y-auto overflow-x-hidden network-page-scrollable" 
        style={{ 
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'none'
        }}
      >
        {/* Mobile view (visible below lg breakpoint) */}
        {/* No overflow properties here - parent handles all scrolling */}
        <div className="desktop:hidden flex-1 flex flex-col">
          {/* Mobile filters card */}
          <Card className="mx-2 mb-2 rounded-xl">
            <CardContent className="p-2">
              {error ? (
                <div className="text-center py-6">
                  <p className="text-gray-500 mb-4">Unable to load network data</p>
                  <Button
                    variant="outline"
                    onClick={() => refetchProfiles()}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Try Again
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-2 relative w-full">
                      <button 
                        className="flex items-center cursor-pointer hover:text-primary transition-colors px-2"
                        onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                      >
                        <h3 className="font-medium text-base">Search Filters</h3>
                        <ChevronDown
                          className={`h-5 w-5 transition-transform duration-200 ml-1 ${isFiltersOpen ? 'transform rotate-180' : ''}`}
                        />
                      </button>
                      <div className="flex-1"></div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 px-3 text-muted-foreground flex items-center whitespace-nowrap mr-2"
                        onClick={clearAllFilters}
                      >
                        Clear All
                      </Button>
                    </div>
                  </div>
                  
                  <Collapsible
                    open={isFiltersOpen}
                    onOpenChange={setIsFiltersOpen}
                    className="mb-2"
                  >
                    <CollapsibleTrigger className="hidden">
                      {/* Hidden trigger, using button above instead */}
                    </CollapsibleTrigger>

                    <CollapsibleContent className="mt-4">
                      {/* Search by name input at the top */}
                      <div className="mb-4">
                        <Label htmlFor="searchByName" className="text-sm font-medium mb-1.5 block">
                          Search by name
                        </Label>
                        <div className="relative">
                          <Input
                            id="searchByName"
                            type="text"
                            placeholder="Enter name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="h-9 pr-8"
                          />
                          <Search className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="industry" className="text-sm font-medium mb-1.5 block">
                            Industry {industryFilters.length > 0 && `(${industryFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={industries}
                              selectedValues={industryFilters}
                              onValueChange={(value) => toggleFilter(value, industryFilters, setIndustryFilters)}
                              placeholder="Select Industries"
                              searchPlaceholder="Search industries..."
                              className="h-9"
                              formatDisplay={(industry) => industry.charAt(0).toUpperCase() + industry.slice(1).toLowerCase() + ' industry'}
                            />
                            <div className="flex flex-wrap gap-1">
                              {industryFilters.map((industry) => (
                                <Badge
                                  key={industry}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(industry, industryFilters, setIndustryFilters)}
                                >
                                  {industry.charAt(0).toUpperCase() + industry.slice(1).toLowerCase() + ' industry'}
                                  <X className="w-3 h-3 ml-1" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="location" className="text-sm font-medium mb-1.5 block">
                            Location {locationFilters.length > 0 && `(${locationFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={filterValues.locations}
                              selectedValues={locationFilters}
                              onValueChange={(value) => toggleFilter(value, locationFilters, setLocationFilters)}
                              placeholder="Select Locations"
                              searchPlaceholder="Search locations..."
                              className="h-9"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              {locationFilters.map((location) => (
                                <Badge
                                  key={location}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(location, locationFilters, setLocationFilters)}
                                >
                                  {location}
                                  <X className="w-3 h-3 ml-0.5" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="company" className="text-sm font-medium mb-1.5 block">
                            Company {companyFilters.length > 0 && `(${companyFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={filterValues.companies}
                              selectedValues={companyFilters}
                              onValueChange={(value) => toggleFilter(value, companyFilters, setCompanyFilters)}
                              placeholder="Select Companies"
                              searchPlaceholder="Search companies..."
                              className="h-9"
                            />
                            <div className="flex flex-wrap gap-1">
                              {companyFilters.map((company) => (
                                <Badge
                                  key={company}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(company, companyFilters, setCompanyFilters)}
                                >
                                  {company}
                                  <X className="w-3 h-3 ml-1" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="institution" className="text-sm font-medium mb-1.5 block">
                            Educational Institution {institutionFilters.length > 0 && `(${institutionFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={filterValues.institutions}
                              selectedValues={institutionFilters}
                              onValueChange={(value) => toggleFilter(value, institutionFilters, setInstitutionFilters)}
                              placeholder="Select Institutions"
                              searchPlaceholder="Search institutions..."
                              className="h-9"
                            />
                            <div className="flex flex-wrap gap-1">
                              {institutionFilters.map((institution) => (
                                <Badge
                                  key={institution}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(institution, institutionFilters, setInstitutionFilters)}
                                >
                                  {institution}
                                  <X className="w-3 h-3 ml-1" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="careerInterests" className="text-sm font-medium mb-1.5 block">
                            Professional Interests {careerInterestFilters.length > 0 && `(${careerInterestFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={filterValues.careerInterests}
                              selectedValues={careerInterestFilters}
                              onValueChange={(value) => toggleFilter(value, careerInterestFilters, setCareerInterestFilters)}
                              placeholder="Select Professional Interests"
                              searchPlaceholder="Search professional interests..."
                              className="h-9"
                            />
                            <div className="flex flex-wrap gap-1">
                              {careerInterestFilters.map((interest) => (
                                <Badge
                                  key={interest}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(interest, careerInterestFilters, setCareerInterestFilters)}
                                >
                                  {interest}
                                  <X className="w-3 h-3 ml-1" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div>
                          <Label htmlFor="interests" className="text-sm font-medium mb-1.5 block">
                            Personal Interests {interestFilters.length > 0 && `(${interestFilters.length})`}
                          </Label>
                          <div className="space-y-2">
                            <SearchableMultiSelect
                              options={filterValues.interests}
                              selectedValues={interestFilters}
                              onValueChange={(value) => toggleFilter(value, interestFilters, setInterestFilters)}
                              placeholder="Select Personal Interests"
                              searchPlaceholder="Search personal interests..."
                              className="h-9"
                            />
                            <div className="flex flex-wrap gap-1">
                              {interestFilters.map((interest) => (
                                <Badge
                                  key={interest}
                                  variant="secondary"
                                  className="cursor-pointer"
                                  onClick={() => toggleFilter(interest, interestFilters, setInterestFilters)}
                                >
                                  {interest}
                                  <X className="w-3 h-3 ml-1" />
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </>
              )}
            </CardContent>
          </Card>

          {/* Mobile search results */}
          {isLoadingProfiles && profiles.length === 0 ? (
            <div className="px-3 py-2">
              <div className="grid grid-cols-2 gap-4 w-full">
                {Array.from({ length: 8 }).map((_, index) => (
                  <div key={index} className="animate-pulse flex flex-col justify-start p-4 border border-[hsl(215,20%,75%)] rounded-lg h-[230px] w-full">
                    <div className="flex justify-center mb-2">
                      <div className="h-14 w-14 bg-gray-200 rounded-full"></div>
                    </div>
                    <div className="h-5 bg-gray-200 rounded w-1/2 mx-auto mb-2"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/3 mx-auto mb-4"></div>
                    <div className="space-y-2 mt-auto">
                      <div className="flex items-start">
                        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 ml-1"></div>
                      </div>
                      <div className="flex items-start">
                        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 ml-1"></div>
                      </div>
                      <div className="flex items-start">
                        <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 ml-1"></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : filteredProfiles.length === 0 && !isLoadingProfiles ? (
            <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
              <p className="text-muted-foreground mb-4">No profiles match your search criteria</p>
              <Button
                variant="outline"
                onClick={clearAllFilters}
                className="gap-2"
              >
                <X className="h-4 w-4" />
                Clear Filters
              </Button>
            </div>
          ) : (
            /* Simple grid layout similar to shared interests page */
            <div className="px-3 py-2 pb-40">
              <div className="grid grid-cols-2 gap-4 w-full">
                {filteredProfiles.map((profile) => (
                  <div key={profile.id}>
                    <ProfilePreviewCard
                      profile={profile}
                      requestStatus={pendingRequests.get(profile.id)}
                      onSelect={() => setSelectedProfile(profile)}
                      onConnect={() => handleConnect(profile.id)}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {/* Load more sentinel */}
          {hasMore && !isLoadingProfiles && (
            <div ref={loadMoreRef} className="h-1 w-full" /> 
          )}
          
          {/* Loading indicator for load more */}
          {isLoadingProfiles && page > 1 && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </div>
        
        {/* Desktop view with filters on left - only on large screens */}
        {/* No overflow-hidden here - parent scroll container handles scrolling */}
        <div className="hidden desktop:flex flex-1 max-w-full relative">
          {/* Full-width divider at the top */}
          <div className="absolute left-0 right-0 top-0 border-t border-gray-300 w-full z-10"></div>
          
          {/* Left column: Fixed Filters */}
          <div className="w-1/5 border-r bg-gray-50 flex flex-col flex-shrink-0 overflow-hidden">
            <div className="p-4 pt-3 pb-2 overflow-y-auto h-full" style={{ maxHeight: 'calc(100vh - 60px)' }}>
              <h3 className="font-medium text-base mb-1.5">Search Filters</h3>
              
              {/* Search by name input */}
              <div className="mb-2">
                <Label htmlFor="desktopSearchByName" className="text-sm font-medium mb-1 block">
                  Search by name
                </Label>
                <div className="relative">
                  <Input
                    id="desktopSearchByName"
                    type="text"
                    placeholder="Enter name..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-8 pr-8"
                  />
                  <Search className="absolute right-2 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                </div>
              </div>
              
              {/* All other filter sections */}
              {/* Industry filter */}
              <div className="mb-2.5">
                <Label htmlFor="desktopIndustry" className="text-sm font-medium mb-1 block">
                  Industry {industryFilters.length > 0 && `(${industryFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={industries}
                    selectedValues={industryFilters}
                    onValueChange={(value) => toggleFilter(value, industryFilters, setIndustryFilters)}
                    placeholder="Select Industries"
                    searchPlaceholder="Search industries..."
                    className="h-8 w-full"
                    formatDisplay={(industry) => industry.charAt(0).toUpperCase() + industry.slice(1).toLowerCase() + ' industry'}
                  />
                  <div className="flex flex-wrap gap-1">
                    {industryFilters.map((industry) => (
                      <Badge
                        key={industry}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(industry, industryFilters, setIndustryFilters)}
                      >
                        {industry.charAt(0).toUpperCase() + industry.slice(1).toLowerCase() + ' industry'}
                        <X className="w-3 h-3 ml-1" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Location filter - repeat same pattern */}
              <div className="mb-2.5">
                <Label htmlFor="desktopLocation" className="text-sm font-medium mb-1 block">
                  Location {locationFilters.length > 0 && `(${locationFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={filterValues.locations}
                    selectedValues={locationFilters}
                    onValueChange={(value) => toggleFilter(value, locationFilters, setLocationFilters)}
                    placeholder="Select Locations"
                    searchPlaceholder="Search locations..."
                    className="h-8 w-full"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {locationFilters.map((location) => (
                      <Badge
                        key={location}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(location, locationFilters, setLocationFilters)}
                      >
                        {location}
                        <X className="w-3 h-3 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Company filter */}
              <div className="mb-2.5">
                <Label htmlFor="desktopCompany" className="text-sm font-medium mb-1 block">
                  Company {companyFilters.length > 0 && `(${companyFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={filterValues.companies}
                    selectedValues={companyFilters}
                    onValueChange={(value) => toggleFilter(value, companyFilters, setCompanyFilters)}
                    placeholder="Select Companies"
                    searchPlaceholder="Search companies..."
                    className="h-8 w-full"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {companyFilters.map((company) => (
                      <Badge
                        key={company}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(company, companyFilters, setCompanyFilters)}
                      >
                        {company}
                        <X className="w-3 h-3 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Educational Institution filter */}
              <div className="mb-2.5">
                <Label htmlFor="desktopInstitution" className="text-sm font-medium mb-1 block">
                  Educational Institution {institutionFilters.length > 0 && `(${institutionFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={filterValues.institutions}
                    selectedValues={institutionFilters}
                    onValueChange={(value) => toggleFilter(value, institutionFilters, setInstitutionFilters)}
                    placeholder="Select Institutions"
                    searchPlaceholder="Search institutions..."
                    className="h-8 w-full"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {institutionFilters.map((institution) => (
                      <Badge
                        key={institution}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(institution, institutionFilters, setInstitutionFilters)}
                      >
                        {institution}
                        <X className="w-3 h-3 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Professional Interests filter */}
              <div className="mb-2.5">
                <Label htmlFor="desktopCareerInterests" className="text-sm font-medium mb-1 block">
                  Professional Interests {careerInterestFilters.length > 0 && `(${careerInterestFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={filterValues.careerInterests}
                    selectedValues={careerInterestFilters}
                    onValueChange={(value) => toggleFilter(value, careerInterestFilters, setCareerInterestFilters)}
                    placeholder="Select Professional Interests"
                    searchPlaceholder="Search professional interests..."
                    className="h-8 w-full"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {careerInterestFilters.map((interest) => (
                      <Badge
                        key={interest}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(interest, careerInterestFilters, setCareerInterestFilters)}
                      >
                        {interest}
                        <X className="w-3 h-3 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Hobbies filter */}
              <div className="mb-2.5">
                <Label htmlFor="desktopInterests" className="text-sm font-medium mb-1 block">
                  Hobbies {interestFilters.length > 0 && `(${interestFilters.length})`}
                </Label>
                <div className="space-y-2">
                  <SearchableMultiSelect
                    options={filterValues.interests}
                    selectedValues={interestFilters}
                    onValueChange={(value) => toggleFilter(value, interestFilters, setInterestFilters)}
                    placeholder="Select Hobbies"
                    searchPlaceholder="Search hobbies..."
                    className="h-8 w-full"
                  />
                  <div className="flex flex-wrap gap-1.5">
                    {interestFilters.map((interest) => (
                      <Badge
                        key={interest}
                        variant="secondary"
                        className="cursor-pointer"
                        onClick={() => toggleFilter(interest, interestFilters, setInterestFilters)}
                      >
                        {interest}
                        <X className="w-3 h-3 ml-0.5" />
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
              
              {/* Clear all button at the bottom */}
              <Button
                variant="outline"
                size="sm"
                onClick={clearAllFilters}
                className="mt-2 gap-1 w-full mb-0"
              >
                <Eraser className="h-3.5 w-3.5" />
                Clear All Filters
              </Button>
            </div>
          </div>
          
          {/* Right column: Scrollable Profiles */}
          <div className="flex-1 overflow-y-auto pb-40 w-4/5 md:w-5/6 lg:w-[95%] xl:w-[98%]" style={{ maxHeight: 'calc(100vh - 60px)' }}>
            {isLoadingProfiles && profiles.length === 0 ? (
              // Loading indicators for initial load
              <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 p-4 content-start">
                {Array.from({ length: 12 }).map((_, index) => (
                  <div key={index} className="rounded-lg overflow-hidden h-[240px] border bg-card">
                    <div className="w-full h-24 bg-muted animate-pulse" />
                    <div className="p-3 space-y-3">
                      <div className="h-5 bg-muted animate-pulse rounded w-2/3" />
                      <div className="h-4 bg-muted animate-pulse rounded w-1/2" />
                      <div className="h-8 bg-muted animate-pulse rounded w-full mt-2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : error ? (
              // Error state
              <div className="text-center py-12">
                <p className="text-destructive font-semibold mb-2">Unable to load connection data</p>
                <p className="text-muted-foreground mb-4">There was an error fetching network data</p>
                <Button
                  variant="outline"
                  onClick={() => refetchProfiles()}
                  className="gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  Try Again
                </Button>
              </div>
            ) : filteredProfiles.length === 0 ? (
              // Empty state for filtered results
              <div className="text-center py-12">
                <p className="text-muted-foreground mb-2">No profiles match your search criteria</p>
                <Button
                  variant="outline"
                  onClick={clearAllFilters}
                  className="gap-2"
                >
                  <X className="h-4 w-4" />
                  Clear Filters
                </Button>
              </div>
            ) : (
              // Grid layout for desktop
              <div className="grid grid-cols-2 desktop:grid-cols-4 gap-4 p-4 content-start">
                {filteredProfiles.map((profile) => (
                  <ProfilePreviewCard
                    key={profile.id}
                    profile={profile}
                    requestStatus={pendingRequests.get(profile.id)}
                    onSelect={() => setSelectedProfile(profile)}
                    onConnect={() => handleConnect(profile.id)}
                  />
                ))}
                
                {/* Load more sentinel for desktop */}
                {hasMore && !isLoadingProfiles && (
                  <div ref={loadMoreRef} className="h-1 col-span-full" /> 
                )}
                
                {/* Loading indicator for load more */}
                {isLoadingProfiles && page > 1 && (
                  <div className="col-span-full flex justify-center py-4">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Profile dialog - shows when a profile is selected */}
      {selectedProfile && (
        <ProfileDialog
          profile={selectedProfile}
          open={!!selectedProfile}
          onOpenChange={(open) => {
            if (!open) setSelectedProfile(null);
          }}
          requestPending={outgoingRequests.some((request) => 
            request.receiverId === selectedProfile.id && request.status === 'requested'
          ) || connectingIds.includes(selectedProfile.id)}
          onConnectionStatusChange={(profileId, isPending) => {
            if (isPending) {
              if (!connectingIds.includes(profileId)) {
                setConnectingIds(prev => [...prev, profileId]);
              }
            } else {
              setConnectingIds(prev => prev.filter(id => id !== profileId));
            }
          }}
          hasIncomingRequest={incomingRequests.some((request: IncomingRequest) =>
            request.senderId === selectedProfile.id && request.status === 'requested'
          )}
          incomingRequestId={incomingRequests.find((request: IncomingRequest) =>
            request.senderId === selectedProfile.id && request.status === 'requested'
          )?.id}
          onRequestHandled={() => {
            queryClient.invalidateQueries({ queryKey: ["/api/connections/requests"] });
            queryClient.invalidateQueries({ queryKey: ["/api/connections"] });
            queryClient.invalidateQueries({ queryKey: ["/api/connections/outgoing"] });
          }}
        />
      )}
    </IOSKeyboardAwareContainer>
  );
}