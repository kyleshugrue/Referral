import { useState, useEffect, useCallback, useRef } from "react";
import { Check, ChevronsUpDown, Loader2, MapPin, Crosshair } from "lucide-react";
import { hybridLocationService } from "@/services/hybrid-location-service";

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

interface HybridLocationInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

interface PlaceResult {
  description: string;
  place_id?: string;
  structured_formatting?: {
    main_text: string;
    secondary_text: string;
  };
}

export default function HybridLocationInput({
  value,
  onChange,
  placeholder = "Search locations...",
  className,
  disabled,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: HybridLocationInputProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [predictions, setPredictions] = useState<PlaceResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGettingLocation, setIsGettingLocation] = useState(false);
  const [isIOSNative, setIsIOSNative] = useState(false);
  const [serviceAvailable, setServiceAvailable] = useState(false);
  const { toast } = useToast();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Initialize and check service availability
  useEffect(() => {
    const initializeService = async () => {
      try {
        const platformInfo = hybridLocationService.getPlatformInfo();
        setIsIOSNative(platformInfo.isIOSNative);
        
        const available = await hybridLocationService.checkAvailability();
        setServiceAvailable(available);
        
        console.log('[HybridLocationInput] Service initialized:', {
          platform: platformInfo.platform,
          isIOSNative: platformInfo.isIOSNative,
          usingAppleMaps: platformInfo.usingAppleMaps,
          usingGoogleMaps: platformInfo.usingGoogleMaps,
          available
        });
      } catch (error) {
        console.error('[HybridLocationInput] Failed to initialize service:', error);
        setServiceAvailable(false);
      }
    };
    
    initializeService();
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

  const getCurrentLocation = useCallback(async () => {
    console.log('[HybridLocationInput] getCurrentLocation called');
    
    if (!serviceAvailable) {
      console.log('[HybridLocationInput] Service not available');
      toast({
        title: "Service Unavailable",
        description: "Location service is not available. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    console.log('[HybridLocationInput] Starting location request');
    setIsGettingLocation(true);

    try {
      // Get current coordinates
      console.log('[HybridLocationInput] Getting current position...');
      const coordinates = await hybridLocationService.getCurrentLocation();
      console.log('[HybridLocationInput] Coordinates received:', coordinates);

      // Reverse geocode to get address
      console.log('[HybridLocationInput] Reverse geocoding...');
      const geocodingResult = await hybridLocationService.reverseGeocode(coordinates);
      console.log('[HybridLocationInput] Geocoding result:', geocodingResult);

      if (geocodingResult && geocodingResult.city && geocodingResult.state) {
        const locationString = `${geocodingResult.city}, ${geocodingResult.state}, USA`;
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
  }, [serviceAvailable, onChange, toast]);

  const searchPlaces = useCallback(async (input: string) => {
    if (!input || !serviceAvailable) return;

    setIsSearching(true);
    try {
      console.log('[HybridLocationInput] Searching places:', input);
      
      const results = await hybridLocationService.searchPlaces(input, {
        types: ['(cities)'],
        country: 'us'
      });

      console.log('[HybridLocationInput] Search results:', results.length);
      setPredictions(results.map(result => ({
        description: result.description,
        place_id: result.place_id,
        structured_formatting: result.structured_formatting
      })));
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
  }, [serviceAvailable, toast]);

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

  const handleSelect = async (prediction: PlaceResult) => {
    console.log('[HybridLocationInput] Place selected:', prediction);
    
    try {
      // Get coordinates for the selected place
      const coordinates = await hybridLocationService.getPlaceCoordinates(
        prediction.place_id,
        prediction.description
      );
      
      if (coordinates) {
        // Use the description as the location string
        onChange(prediction.description);
        setOpen(false);
        
        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
          detail: false 
        }));
        
        console.log('[HybridLocationInput] Location set:', prediction.description);
      } else {
        console.warn('[HybridLocationInput] Could not get coordinates for selected place');
        // Still use the description even if we couldn't get coordinates
        onChange(prediction.description);
        setOpen(false);
      }
    } catch (error) {
      console.error('[HybridLocationInput] Error handling place selection:', error);
      // Fallback to just using the description
      onChange(prediction.description);
      setOpen(false);
    }
  };

  if (!serviceAvailable) {
    return (
      <div className="text-destructive">
        Location services are not available
      </div>
    );
  }

  return (
    <div className={cn("w-full", className)} data-keyboard-type="location" data-has-dropdown="true">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        role="combobox"
        aria-expanded={open}
         id={id}
         aria-describedby={ariaDescribedBy}
         aria-invalid={ariaInvalid}
         aria-label={ariaLabel || (id ? undefined : placeholder)}
         aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        className="w-full justify-between h-10 px-3 text-sm font-normal border-[hsl(215,20%,65%)]"
        onClick={() => {
          if (disabled) return;
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
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                <span className="text-sm text-muted-foreground">Searching...</span>
              </div>
            )}
            
            {!isSearching && predictions.length === 0 && search.length > 1 && (
              <CommandEmpty>No locations found.</CommandEmpty>
            )}
            
            {!isSearching && predictions.length > 0 && (
              <CommandGroup>
                {predictions.map((prediction, index) => (
                  <CommandItem
                    key={prediction.place_id || `${prediction.description}-${index}`}
                    value={prediction.description}
                    onSelect={() => handleSelect(prediction)}
                    className="cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4",
                        value === prediction.description ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <MapPin className="mr-2 h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-sm">
                        {prediction.structured_formatting?.main_text || prediction.description}
                      </span>
                      {prediction.structured_formatting?.secondary_text && (
                        <span className="text-xs text-muted-foreground">
                          {prediction.structured_formatting.secondary_text}
                        </span>
                      )}
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