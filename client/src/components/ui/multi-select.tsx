import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Command, CommandGroup, CommandItem } from "@/components/ui/command";
import { X, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export type Option = {
  label: string;
  value: string;
};

interface MultiSelectProps {
  options: Option[];
  value: Option[];
  onChange: (options: Option[]) => void;
  placeholder?: string;
  className?: string;
}

export function MultiSelect({
  options,
  value = [],
  onChange,
  placeholder = "Select items...",
  className,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isIOSNative, setIsIOSNative] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Detect iOS native environment and mobile screen size
  React.useEffect(() => {
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
    
    // Check if mobile screen size
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768); // Tailwind md breakpoint
    };
    
    checkIOSNative();
    checkMobile();
    
    // Listen for window resize to update mobile state
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Handle clicks outside to close dropdown
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
        const dropdownElement = document.querySelector('.multi-select-dropdown');
        if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
          setOpen(false);
          // Remove temporary padding when dropdown closes
          if (isIOSNative && document.body.dataset.temporaryPadding) {
            document.body.style.paddingBottom = '';
            delete document.body.dataset.temporaryPadding;
          }
        }
      }
    };

    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [open, isIOSNative]);

  // Filter options based on search query
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Handle selection of an option
  const handleSelect = (option: Option) => {
    const isSelected = value.some((item) => item.value === option.value);
    
    if (isSelected) {
      // If already selected, remove it
      onChange(value.filter((item) => item.value !== option.value));
    } else {
      // If not selected, add it
      onChange([...value, option]);
    }
  };

  // Handle removing an option by clicking the X
  const handleRemove = (optionValue: string) => {
    onChange(value.filter((item) => item.value !== optionValue));
  };

  // Mobile layout with clickable badges
  if (isMobile) {
    return (
      <div className={cn("space-y-3", className)}>
        {/* Selected items as badges */}
        {value.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {value.map((option) => (
              <Badge
                key={option.value}
                variant="secondary"
                className="flex items-center gap-1 px-3 py-1 bg-slate-100 text-slate-700 border border-slate-300"
              >
                <span className="text-sm">{option.label}</span>
                <button
                  className="ml-1 rounded-full hover:bg-slate-200 outline-none"
                  onClick={() => handleRemove(option.value)}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        
        {/* Available options as scrollable badges */}
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-600">
            {value.length > 0 ? "Add more..." : placeholder}
          </div>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-2 min-w-max">
              {options
                .filter(option => !value.some(v => v.value === option.value))
                .map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleSelect(option)}
                    className="flex-shrink-0 px-3 py-2 text-sm rounded-md border border-blue-200 text-blue-700 bg-transparent hover:bg-blue-50 transition-colors"
                  >
                    {option.label}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Desktop layout with dropdown (existing functionality)
  return (
    <div className={cn("space-y-1", className)}>
      <Button
        ref={buttonRef}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        className={cn(
          "w-full justify-between px-3 py-2 h-auto min-h-10 border-input",
          value.length > 0 ? "h-auto" : ""
        )}
        onClick={() => setOpen(!open)}
      >
        <div className="flex flex-wrap gap-1">
          {value.length > 0 ? (
            value.map((option) => (
              <Badge
                key={option.value}
                variant="secondary"
                className="flex items-center gap-1 max-w-[150px]"
              >
                <span className="truncate">{option.label}</span>
                <button
                  className="ml-1 rounded-full hover:bg-muted outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(option.value);
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
      </Button>
      
      {open && (
        <div className="multi-select-dropdown w-full border rounded-md bg-background shadow-sm p-0">
          <Command className="w-full">
            <div className="flex items-center border-b px-3">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search..."
                className="w-full py-2 outline-none placeholder:text-muted-foreground text-sm"
              />
            </div>
            <CommandGroup className="max-h-60 overflow-auto">
              {filteredOptions.length === 0 && (
                <p className="text-sm text-center py-2 text-muted-foreground">No results found</p>
              )}
              {filteredOptions.map((option) => {
                const isSelected = value.some((item) => item.value === option.value);
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => handleSelect(option)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div className={cn("flex-none", isSelected ? "opacity-100" : "opacity-0")}>
                        <Check className="h-4 w-4" />
                      </div>
                      <span className="flex-1 truncate">{option.label}</span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </Command>
        </div>
      )}
    </div>
  );
}