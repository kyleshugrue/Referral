import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface LocationInputProps {
  value: string;
  onChange: (location: string) => void;
  placeholder?: string;
  className?: string;
  onBlur?: () => void;
}

export function LocationInput({
  value,
  onChange,
  placeholder = "Enter a location",
  className,
  onBlur
}: LocationInputProps) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isIOSNative, setIsIOSNative] = useState(false);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Scroll to input when focused on iOS native
  const scrollToInput = useCallback(() => {
    if (isIOSNative && containerRef.current) {
      setTimeout(() => {
        const element = containerRef.current;
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

  // Fetch location suggestions when the input changes
  useEffect(() => {
    const fetchSuggestions = async () => {
      if (!value || value.length < 2) {
        setSuggestions([]);
        return;
      }

      try {
        const response = await fetch(`/api/locations/suggest?query=${encodeURIComponent(value)}`);
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
        } else {
          console.error("Failed to fetch location suggestions");
          setSuggestions([]);
        }
      } catch (error) {
        console.error("Error fetching location suggestions:", error);
        setSuggestions([]);
      }
    };

    const debounce = setTimeout(() => {
      fetchSuggestions();
    }, 300);

    return () => clearTimeout(debounce);
  }, [value]);

  // Handle clicks outside the suggestions to close the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current && 
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current && 
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleLocationSelect = (location: string) => {
    onChange(location);
    setShowSuggestions(false);
  };

  return (
    <div ref={containerRef} className="w-full">
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          setShowSuggestions(true);
          if (isIOSNative) {
            scrollToInput();
          }
        }}
        onBlur={() => {
          // Delay hiding suggestions to allow click events to register
          setTimeout(() => {
            setShowSuggestions(false);
            if (onBlur) onBlur();
            
            // Remove temporary padding when input loses focus on iOS native
            if (isIOSNative && document.body.dataset.temporaryPadding) {
              document.body.style.paddingBottom = '';
              delete document.body.dataset.temporaryPadding;
            }
          }, 200);
        }}
        placeholder={placeholder}
        className={cn(className)}
      />
      
      {showSuggestions && suggestions.length > 0 && (
        <div 
          ref={suggestionsRef}
          className="w-full mt-1 max-h-60 overflow-auto bg-background border rounded-md shadow-sm"
        >
          {suggestions.map((suggestion, index) => (
            <div
              key={index}
              className="px-4 py-2 hover:bg-muted cursor-pointer border-b border-border last:border-b-0"
              onClick={() => handleLocationSelect(suggestion)}
            >
              {suggestion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}