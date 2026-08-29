import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { Check, ChevronDown, X, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/ios-overlay-lock';

export interface IOSSearchableOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface IOSSearchableSelectProps {
  values: string[];
  onValuesChange: (values: string[]) => void;
  options: IOSSearchableOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  title?: string;
  maxSelections?: number;
  showTags?: boolean;
}

const isNativeIOS = () => 
  Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();

export function IOSSearchableSelect({
  values = [],
  onValuesChange,
  options,
  placeholder = 'Select items...',
  searchPlaceholder = 'Search...',
  disabled = false,
  className = '',
  triggerClassName = '',
  title = 'Select',
  maxSelections,
  showTags = true,
}: IOSSearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    setIsNative(isNativeIOS());
  }, []);

  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        unlockBodyScroll();
      }
    };
  }, []);

  const filteredOptions = useMemo(() => {
    if (!searchQuery.trim()) return options;
    const query = searchQuery.toLowerCase();
    return options.filter(opt => 
      opt.label.toLowerCase().includes(query)
    );
  }, [options, searchQuery]);

  const handleOpen = useCallback(async () => {
    if (disabled) return;
    
    if (isNative) {
      try {
        await Keyboard.hide();
        } catch {
         // Keyboard may be unavailable while the native view is transitioning.
       }
    }
    
    setIsOpen(true);
    setSearchQuery('');
    wasOpenRef.current = true;
    lockBodyScroll();
  }, [disabled, isNative]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    wasOpenRef.current = false;
    unlockBodyScroll();
  }, []);

  const handleToggle = useCallback((optionValue: string) => {
    const isSelected = values.includes(optionValue);
    
    if (isSelected) {
      onValuesChange(values.filter(v => v !== optionValue));
    } else {
      if (maxSelections && values.length >= maxSelections) {
        return;
      }
      onValuesChange([...values, optionValue]);
    }
  }, [values, onValuesChange, maxSelections]);

  const handleRemoveTag = useCallback((optionValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    onValuesChange(values.filter(v => v !== optionValue));
  }, [values, onValuesChange]);

  const selectedLabels = useMemo(() => {
    return values
      .map(v => options.find(opt => opt.value === v)?.label)
      .filter(Boolean) as string[];
  }, [values, options]);

  if (!isNative) {
    return null;
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          'flex min-h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName
        )}
        data-testid="ios-searchable-select-trigger"
      >
        {showTags && values.length > 0 ? (
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedLabels.slice(0, 3).map((label, idx) => (
              <span
                key={values[idx]}
                className="ios-bottom-sheet-tag"
              >
                {label}
                <button
                  type="button"
                  onClick={(e) => handleRemoveTag(values[idx], e)}
                  className="ios-bottom-sheet-tag-remove"
                  data-testid={`ios-tag-remove-${values[idx]}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
            {values.length > 3 && (
              <span className="text-muted-foreground text-xs self-center">
                +{values.length - 3} more
              </span>
            )}
          </div>
        ) : (
          <span className={cn(
            'line-clamp-1',
            values.length === 0 && 'text-muted-foreground'
          )}>
            {values.length > 0 ? `${values.length} selected` : placeholder}
          </span>
        )}
        <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0 ml-2" />
      </button>

      {isOpen && (
        <>
          <div
            className="ios-bottom-sheet-backdrop visible"
            onClick={handleClose}
            data-testid="ios-searchable-select-backdrop"
          />
          <div className="ios-bottom-sheet visible" style={{ maxHeight: '70vh' }} data-testid="ios-searchable-select-sheet">
            <div className="ios-bottom-sheet-handle" />
            <div className="ios-bottom-sheet-header">
              <span className="ios-bottom-sheet-title">{title}</span>
              <button
                type="button"
                onClick={handleClose}
                className="ios-bottom-sheet-done"
                data-testid="ios-searchable-select-done"
              >
                Done
              </button>
            </div>
            
            <div className="px-4 pb-2 relative">
              <Search className="absolute left-7 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="ios-bottom-sheet-search pl-9"
                data-testid="ios-searchable-select-search"
              />
            </div>

            {values.length > 0 && (
              <div className="ios-bottom-sheet-tags">
                {selectedLabels.map((label, idx) => (
                  <span key={values[idx]} className="ios-bottom-sheet-tag">
                    {label}
                    <button
                      type="button"
                      onClick={() => handleToggle(values[idx])}
                      className="ios-bottom-sheet-tag-remove"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div className="ios-bottom-sheet-content">
              {filteredOptions.length === 0 ? (
                <div className="py-4 text-center text-muted-foreground text-sm">
                  No options found
                </div>
              ) : (
                filteredOptions.map((option) => {
                  const isSelected = values.includes(option.value);
                  const isMaxReached = !!(maxSelections && values.length >= maxSelections && !isSelected);
                  
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => !option.disabled && !isMaxReached && handleToggle(option.value)}
                      disabled={option.disabled || isMaxReached}
                      className={cn(
                        'ios-bottom-sheet-option',
                        isSelected && 'selected',
                        (option.disabled || isMaxReached) && 'opacity-50'
                      )}
                      data-testid={`ios-searchable-option-${option.value}`}
                    >
                      <span className="ios-bottom-sheet-option-text">{option.label}</span>
                      {isSelected && (
                        <Check className="ios-bottom-sheet-check" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default IOSSearchableSelect;
