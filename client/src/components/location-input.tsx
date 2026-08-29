import { useState, useEffect, useCallback, useRef } from "react";
import { ChevronsUpDown, Loader2, MapPin, Crosshair } from "lucide-react";
import { locationService } from "@/utils/location-service";

// Add TypeScript definition for the global function
declare global {
  interface Window {
    updateKeyboardVisibility?: (isVisible: boolean, forceVisible?: boolean) => void;
  }
}
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  useLoadScript,
  Libraries
} from "@react-google-maps/api";

interface LocationInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

interface PlaceResult {
  description: string;
  place_id: string;
  structured_formatting: {
    main_text: string;
    secondary_text: string;
  };
}

const libraries: Libraries = ["places"];

export default function LocationInput({
  value,
  onChange,
  placeholder = "Search locations...",
  className,
}: LocationInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [predictions, setPredictions] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isIOSNative, setIsIOSNative] = useState(false);
  const { toast } = useToast();
  const autocompleteService = useRef<google.maps.places.AutocompleteService | null>(null);
  const geocoder = useRef<google.maps.Geocoder | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Detect iOS native environment
  useEffect(() => {
    const checkIOSNative = () => {
      try {
        // Import dynamically to avoid issues if Capacitor is not available
        import('@capacitor/core').then(({ Capacitor }) => {
          const isNative = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
          setIsIOSNative(isNative);
        }).catch(() => {
          setIsIOSNative(false);
        });
        return false; // Default until async check completes
      } catch {
        return false;
      }
    };
    checkIOSNative();
  }, []);

  // Scroll to input when dropdown opens on iOS native
  const scrollToInput = useCallback(() => {
    if (isIOSNative && buttonRef.current) {
      setTimeout(() => {
        const element = buttonRef.current;
        if (element) {
          const rect = element.getBoundingClientRect();
          const currentScrollTop = window.pageYOffset;
          const viewportHeight = window.innerHeight;
          
          // Check if page is short (not enough content to scroll)
          const documentHeight = document.documentElement.scrollHeight;
          const pageIsShort = documentHeight <= viewportHeight + 200; // 200px buffer
          
          if (pageIsShort) {
            // For short pages, add temporary padding to create scroll space
            const existingPadding = document.body.dataset.temporaryPadding;
            if (!existingPadding) {
              const paddingAmount = Math.max(400, viewportHeight * 0.6); // Minimum 400px or 60% of viewport
              document.body.style.paddingBottom = `${paddingAmount}px`;
              document.body.dataset.temporaryPadding = 'true';
              
              // Now scroll to position the input near the top
              setTimeout(() => {
                const newRect = element.getBoundingClientRect();
                const targetScrollTop = window.pageYOffset + newRect.top - 120;
                window.scrollTo({
                  top: Math.max(0, targetScrollTop),
                  behavior: 'smooth'
                });
              }, 100);
            }
          } else {
            // For longer pages, use regular scroll
            const scrollTop = currentScrollTop + rect.top - 100;
            window.scrollTo({
              top: Math.max(0, scrollTop),
              behavior: 'smooth'
            });
          }
        }
      }, 150);
    }
  }, [isIOSNative]);

  // Handle dropdown open with scroll
  const handleOpenChange = useCallback((newOpen: boolean) => {
    setOpen(newOpen);
    if (newOpen && isIOSNative) {
      scrollToInput();
    } else if (!newOpen && isIOSNative) {
      // Remove temporary padding when dropdown closes
      if (document.body.dataset.temporaryPadding) {
        document.body.style.paddingBottom = '';
        delete document.body.dataset.temporaryPadding;
      }
    }
  }, [isIOSNative, scrollToInput]);

  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || "",
    libraries,
  });

  useEffect(() => {
    if (isLoaded && !autocompleteService.current) {
      try {
        autocompleteService.current = new window.google.maps.places.AutocompleteService();
        geocoder.current = new window.google.maps.Geocoder();
      } catch (error) {
        console.error("Error initializing Google Maps services:", error);
        toast({
          title: "Service Error",
          description: "Failed to initialize location services. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [isLoaded, toast]);

  const getCurrentLocation = useCallback(async () => {
    console.log('[LocationInput] getCurrentLocation called');
    
    if (!isLoaded || !geocoder.current) {
      console.log('[LocationInput] Service not ready:', { isLoaded, hasGeocoder: !!geocoder.current });
      toast({
        title: "Service Unavailable",
        description: "Location service is not available. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    console.log('[LocationInput] Starting location request');
    setIsGettingLocation(true);

    try {
      // Check location permissions first
      console.log('[LocationInput] Checking permissions...');
      const permissions = await locationService.checkPermissions();
      console.log('[LocationInput] Permission result:', permissions);
      
      if (permissions.state === 'denied') {
        console.log('[LocationInput] Permission denied');
        toast({
          title: "Location Access Denied",
          description: "Please enable location access in your device settings to use this feature.",
          variant: "destructive",
        });
        setIsGettingLocation(false);
        return;
      }

      // For web, we proceed with getCurrentPosition even if permissions are 'prompt'
      // because the browser will handle the permission request automatically
      if (permissions.state !== 'granted' && permissions.state !== 'prompt') {
        console.log('[LocationInput] Requesting permissions...');
        const requestResult = await locationService.requestPermissions();
        console.log('[LocationInput] Permission request result:', requestResult);
        if (requestResult.state === 'denied') {
          toast({
            title: "Location Permission Required",
            description: "Location access is needed to find your current city.",
            variant: "destructive",
          });
          setIsGettingLocation(false);
          return;
        }
      }

      // Get current position using platform-aware location service
      console.log('[LocationInput] Getting current position...');
      const position = await locationService.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 600000 // 10 minutes (optimized for performance)
      });
      console.log('[LocationInput] Position received:', position);

      const { latitude, longitude } = position;

      const results = await geocoder.current.geocode({
        location: { lat: latitude, lng: longitude }
      });

      if (results.results.length > 0) {
        const cityComponent = results.results[0].address_components.find(
          component => component.types.includes('locality')
        );
        const stateComponent = results.results[0].address_components.find(
          component => component.types.includes('administrative_area_level_1')
        );

        if (cityComponent && stateComponent) {
          const locationString = `${cityComponent.long_name}, ${stateComponent.short_name}, USA`;
          onChange(locationString);
          setOpen(false);
          
          // Update UI state with a single event dispatch
          window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
            detail: false 
          }));
          
          toast({
            title: "Success",
            description: "Your location has been updated",
          });
        } else {
          throw new Error('Could not determine your city location');
        }
      } else {
        throw new Error('Could not find your location');
      }
    } catch (error) {
      console.error('Error getting current location:', error);
      toast({
        title: "Location Error",
        description: error instanceof Error ? error.message : "Failed to get your location",
        variant: "destructive",
      });
    } finally {
      setIsGettingLocation(false);
    }
  }, [isLoaded, onChange, toast]);

  const searchPlaces = useCallback(async (input: string) => {
    if (!input || !autocompleteService.current) return;

    setIsSearching(true);
    try {
      const request: google.maps.places.AutocompletionRequest = {
        input,
        types: ['(cities)'],
        componentRestrictions: { country: 'us' }
      };

      const response = await new Promise<google.maps.places.AutocompletePrediction[]>((resolve, reject) => {
        autocompleteService.current!.getPlacePredictions(
          request,
          (predictions, status) => {
            if (status === google.maps.places.PlacesServiceStatus.OK && predictions) {
              resolve(predictions);
            } else {
              reject(new Error(`Places API error: ${status}`));
            }
          }
        );
      });

      setPredictions(response as unknown as PlaceResult[]);
    } catch (error) {
      console.error('Error fetching predictions:', error);
      toast({
        title: "Error",
        description: "Failed to fetch location suggestions. Please try again.",
        variant: "destructive",
      });
      setPredictions([]);
    } finally {
      setIsSearching(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.length > 1) {
        searchPlaces(search);
      } else {
        setPredictions([]);
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [search, searchPlaces]);

  useEffect(() => {
    if (!open) {
      // Clear search state
      setSearch("");
      // Reset predictions
      setPredictions([]);
      
      // Notify the UI that the keyboard should be hidden
      // Using a single event dispatch for more reliable behavior
      window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
        detail: false 
      }));
    }
  }, [open]);

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        const dropdownElement = document.querySelector('.location-dropdown');
        if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
          setOpen(false);
        }
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [open]);

  if (loadError) {
    console.error("Error loading Google Maps:", loadError);
    return (
      <div className="text-destructive">
        Error loading location services
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className="w-full justify-between h-10 px-3 text-sm font-normal border-[hsl(215,20%,65%)]"
        onClick={() => {
          handleOpenChange(!open);
          
          // Ensure keyboard visibility is managed correctly to keep nav bar visible
          if (window.updateKeyboardVisibility) {
            window.updateKeyboardVisibility(true, true);
          }
          
          // When opening the location input, we'll focus the search input by default
          setTimeout(() => {
            const searchInput = document.querySelector('.location-search-input') as HTMLInputElement;
            if (searchInput) {
              searchInput.focus();
              // Position cursor at the end of text
              const length = searchInput.value.length;
              searchInput.setSelectionRange(length, length);
            }
          }, 100);
        }}
      >
        <span className="truncate text-left">
          {value || placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
      
      {open && (
        <div className="location-dropdown w-full mt-1 border rounded-md bg-background shadow-sm p-0">
          <Command shouldFilter={false}>
            <div className="flex gap-2 p-3">
              <CommandInput
                placeholder="Search for a city..."
                value={search}
                onValueChange={setSearch}
                className="h-9 flex-1 location-search-input border-[hsl(215,20%,65%)]"
                onFocus={(e) => {
                  // Position cursor at the end when focusing
                  const length = e.target.value.length;
                  e.target.setSelectionRange(length, length);
                  
                  // Ensure keyboard visibility is managed correctly to keep nav bar visible
                  if (window.updateKeyboardVisibility) {
                    window.updateKeyboardVisibility(true, true);
                  }

                  // For iOS native apps, let the native keyboard handle scrolling behavior
                  if (!isIOSNative) {
                    setTimeout(() => {
                      const target = e.target as HTMLInputElement;
                      const popoverContent = target.closest('[role="dialog"]') || target.closest('.popover-content');
                      
                      if (popoverContent) {
                        // Scroll the popover content into view to prevent keyboard blocking
                        popoverContent.scrollIntoView({ 
                          behavior: 'smooth', 
                          block: 'center',
                          inline: 'nearest'
                        });
                      } else {
                        // Fallback: scroll the input itself
                        target.scrollIntoView({ 
                          behavior: 'smooth', 
                          block: 'center',
                          inline: 'nearest'
                        });
                      }
                    }, 150);
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 border-[hsl(215,20%,65%)]"
                onClick={getCurrentLocation}
                disabled={isGettingLocation}
              >
                {isGettingLocation ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Crosshair className="h-4 w-4" />
                )}
                <span className="sr-only">Use current location</span>
              </Button>
            </div>
            {isSearching && (
              <div className="py-6 text-center text-sm">
                <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                <span className="mt-2 block text-muted-foreground">Searching...</span>
              </div>
            )}
            {!isSearching && predictions.length === 0 && search.length > 1 && (
              <CommandEmpty>No locations found</CommandEmpty>
            )}
            {!isSearching && predictions.length > 0 && (
              <CommandGroup className="overflow-auto max-h-[250px]">
                {predictions.map((prediction) => (
                  <CommandItem
                    key={prediction.place_id}
                    value={prediction.description}
                    onSelect={() => {
                      // Update with selected location
                      onChange(prediction.description);
                      // Close the popover
                      setOpen(false);
                      // Clear search state
                      setSearch("");
                      // Reset predictions
                      setPredictions([]);
                      
                      // Update keyboard visibility in a single call without nested timeouts
                      window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
                        detail: false 
                      }));
                    }}
                    className="flex items-center gap-2 py-3 px-3"
                  >
                    <MapPin className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="font-medium">
                        {prediction.structured_formatting.main_text}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {prediction.structured_formatting.secondary_text}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </Command>
        </div>
      )}
    </div>
  );
}