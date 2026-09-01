import { useState, useRef, useEffect } from "react";
import { Command } from "cmdk";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toTitleCase } from "@/utils/text-utils";
import { useUserAgentDetection } from "@/hooks/use-user-agent-detection";
import { Capacitor } from "@capacitor/core";

interface SearchableInterestSelectProps {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
  allowCustom?: boolean;
  badgeVariant?: "default" | "secondary" | "outline" | "destructive";
  applyTitleCase?: boolean; // New prop to control title case application
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export default function SearchableInterestSelect({
  options,
  selected,
  onChange,
  placeholder = "Search...",
  className,
  allowCustom = false,
  badgeVariant = "default",
  applyTitleCase = false,
  disabled = false,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: SearchableInterestSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [isIOSNative, setIsIOSNative] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Use the app's standard detection system
  const { isMobile } = useUserAgentDetection();

  // Detect iOS native environment 
  useEffect(() => {
    const checkIOSNative = () => {
      try {
        const isNative = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
        setIsIOSNative(isNative);
        return false; // Default until async check completes
      } catch {
        return false;
      }
    };
    
    checkIOSNative();
  }, []);

  const filteredOptions = options.filter(
    option => 
      !selected.some(s => s.toLowerCase() === option.toLowerCase()) && 
      option.toLowerCase().includes(search.toLowerCase())
  );

  const handleSelect = (value: string) => {
    const normalizedValue = value.trim();
    const isDuplicate = selected.some(s => s.toLowerCase() === normalizedValue.toLowerCase());
    if (!isDuplicate) {
      // Apply title case if enabled, otherwise use normalized value
      const formattedValue = applyTitleCase ? toTitleCase(normalizedValue) : normalizedValue;
      const updatedValues = [...selected, formattedValue];
      onChange(updatedValues);
      setSearch("");
      inputRef.current?.focus();
      
      // Force the navbar and save button to reappear
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
          detail: false 
        }));
        
        // Add a second event with a little delay to ensure the UI updates
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
            detail: false 
          }));
        }, 250);
      }, 50);
    }
  };

  const handleRemove = (valueToRemove: string) => {
    const updatedValues = selected.filter(value => value !== valueToRemove);
    onChange(updatedValues);
    
    // Force the navbar and save button to reappear
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
        detail: false 
      }));
      
      // Add a second event with a little delay to ensure the UI updates
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
          detail: false 
        }));
      }, 250);
    }, 50);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (allowCustom && e.key === 'Enter' && search.trim()) {
      e.preventDefault();
      const newValue = search.trim();
      const isDuplicate = selected.some(s => s.toLowerCase() === newValue.toLowerCase());
      if (!isDuplicate) {
        // Apply title case if enabled, otherwise just trim the value
        const formattedValue = applyTitleCase ? toTitleCase(newValue) : newValue;
        const updatedValues = [...selected, formattedValue];
        onChange(updatedValues);
        setSearch("");
        
        // Force the navbar and save button to reappear
        setTimeout(() => {
          window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
            detail: false 
          }));
          
          // Add a second event with a little delay to ensure the UI updates
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
              detail: false 
            }));
          }, 250);
        }, 50);
      }
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  // Mobile layout with clickable badges
  if (isMobile) {
    const filteredAvailableOptions = options
      .filter(option => !selected.some(s => s.toLowerCase() === option.toLowerCase()) &&
                       option.toLowerCase().includes(search.toLowerCase()));

    return (
      <div className={cn("space-y-3", className, disabled && "opacity-50 pointer-events-none")} data-keyboard-type="search-dropdown" data-has-dropdown="true">
        {/* Search input bubble - positioned above selected options */}
        <div className="relative">
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            id={id}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={ariaLabel || (id ? undefined : placeholder)}
            aria-labelledby={ariaLabelledBy}
            placeholder={selected.length > 0 ? "Search to add more..." : placeholder}
            className="w-full h-10 px-3 text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={disabled}
            onFocus={() => {
              // Ensure keyboard visibility is managed correctly to keep nav bar visible
              if (window.updateKeyboardVisibility) {
                window.updateKeyboardVisibility(true, true);
              }
            }}
          />
        </div>

        {/* Selected items as badges - using original theme */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((value) => (
              <Badge
                key={value}
                variant={badgeVariant}
                className="h-6 px-2 flex items-center gap-1"
              >
                {value}
                <button
                  type="button"
                  onClick={() => handleRemove(value)}
                  disabled={disabled}
                  className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <X className="h-3 w-3" />
                  <span className="sr-only">Remove {value}</span>
                </button>
              </Badge>
            ))}
          </div>
        )}
        
        {/* Available options as 2-row scrollable grid */}
        {filteredAvailableOptions.length > 0 && !disabled && (
          <div className="overflow-x-auto pb-2">
            <div 
              className="grid grid-rows-2 grid-flow-col gap-2 min-w-max"
              style={{ 
                gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
                height: '3.5rem' // h-14 equivalent for exactly 2 rows
              }}
            >
              {filteredAvailableOptions.map((option) => (
                <button
                  key={option}
                  onClick={() => handleSelect(option)}
                  disabled={disabled}
                  className="flex-shrink-0 h-6 px-2 text-xs font-semibold rounded-md border border-primary/30 text-primary bg-transparent hover:bg-primary/10 transition-colors flex items-center whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        )}
        
        {allowCustom && search.trim() && !options.some(o => o.toLowerCase() === search.toLowerCase()) && (
          <p className="text-xs text-muted-foreground">
            Press Enter to add "{search}"
          </p>
        )}
      </div>
    );
  }

  // Desktop layout with dropdown (existing functionality)
  return (
    <div className={cn("relative w-full", className, disabled && "opacity-50")} data-keyboard-type="search-dropdown" data-has-dropdown="true">
      <Command className="relative w-full">
        <div className="flex flex-wrap gap-2 p-3 rounded-md bg-background border border-input min-h-[44px]">
          {selected.map((value) => (
            <Badge
              key={value}
              variant={badgeVariant}
              className="h-6 px-2 flex items-center gap-1"
            >
              {value}
              <button
                type="button"
                onClick={() => handleRemove(value)}
                disabled={disabled}
                className="ml-1 ring-offset-background rounded-full outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove {value}</span>
              </button>
            </Badge>
          ))}
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setIsOpen(true);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => {
              setIsOpen(true);
              // Ensure keyboard visibility is managed correctly to keep nav bar visible
              if (window.updateKeyboardVisibility) {
                window.updateKeyboardVisibility(true, true);
              }
            }}
            disabled={disabled}
            id={id}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={ariaLabel || (id ? undefined : placeholder)}
            aria-labelledby={ariaLabelledBy}
            placeholder={selected.length === 0 ? placeholder : "Add more..."}
            className="flex-1 bg-transparent outline-none border-0 p-0 text-sm placeholder:text-muted-foreground min-w-[120px] disabled:cursor-not-allowed"
          />
        </div>
        {isOpen && filteredOptions.length > 0 && !allowCustom && (
          <div className={cn(
            "absolute py-1 bg-popover rounded-md border shadow-md z-10 max-h-[200px] overflow-y-auto",
            isIOSNative 
              ? "capacitor-ios-dropdown bottom-full mb-0.5" // Position above for iOS native
              : "top-full left-0 mt-1 w-full max-w-[min(400px,calc(100vw-2rem))]" // Responsive for web
          )}>
            {filteredOptions.map((option) => (
              <button
                key={option}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(option);
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 focus:bg-accent/50 outline-none"
              >
                {option}
              </button>
            ))}
          </div>
        )}
      </Command>
      {allowCustom && (
        <p className="text-xs text-muted-foreground mt-1.5 ml-1">
          Press Enter to add a company
        </p>
      )}
    </div>
  );
}