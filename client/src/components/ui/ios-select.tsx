import { useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { lockBodyScroll, unlockBodyScroll } from '@/lib/ios-overlay-lock';

export interface IOSSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface IOSSelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: IOSSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  title?: string;
}

const isNativeIOS = () => 
  Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();

export function IOSSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Select...',
  disabled = false,
  className = '',
  triggerClassName = '',
  title = 'Select',
}: IOSSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const wasOpenRef = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

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

  useEffect(() => {
    if (isOpen && selectedRef.current && contentRef.current) {
      requestAnimationFrame(() => {
        if (selectedRef.current && contentRef.current) {
          const container = contentRef.current;
          const selected = selectedRef.current;
          const containerHeight = container.clientHeight;
          const selectedTop = selected.offsetTop;
          const selectedHeight = selected.offsetHeight;
          
          const targetScroll = selectedTop - (containerHeight / 2) + (selectedHeight / 2);
          
          container.scrollTo({
            top: Math.max(0, targetScroll),
            behavior: 'smooth'
          });
        }
      });
    }
  }, [isOpen]);

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
    wasOpenRef.current = true;
    lockBodyScroll();
  }, [disabled, isNative]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    wasOpenRef.current = false;
    unlockBodyScroll();
  }, []);

  const handleSelect = useCallback((optionValue: string) => {
    onValueChange?.(optionValue);
    handleClose();
  }, [onValueChange, handleClose]);

  const selectedOption = options.find(opt => opt.value === value);

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
          'flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background',
          'focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
          'disabled:cursor-not-allowed disabled:opacity-50',
          triggerClassName
        )}
        data-testid="ios-select-trigger"
      >
        <span className={cn(
          'line-clamp-1',
          !selectedOption && 'text-muted-foreground'
        )}>
          {selectedOption?.label || placeholder}
        </span>
        <ChevronDown className="h-4 w-4 opacity-50 flex-shrink-0" />
      </button>

      {isOpen && (
        <>
          <div
            className="ios-bottom-sheet-backdrop visible"
            onClick={handleClose}
            data-testid="ios-select-backdrop"
          />
          <div className="ios-bottom-sheet visible" data-testid="ios-select-sheet">
            <div className="ios-bottom-sheet-handle" />
            <div className="ios-bottom-sheet-header">
              <span className="ios-bottom-sheet-title">{title}</span>
              <button
                type="button"
                onClick={handleClose}
                className="ios-bottom-sheet-done"
                data-testid="ios-select-done"
              >
                Done
              </button>
            </div>
            <div 
              ref={contentRef}
              className="ios-bottom-sheet-content"
            >
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <button
                    key={option.value}
                    ref={isSelected ? selectedRef : undefined}
                    type="button"
                    onClick={() => !option.disabled && handleSelect(option.value)}
                    disabled={option.disabled}
                    className={cn(
                      'ios-bottom-sheet-option',
                      isSelected && 'selected',
                      option.disabled && 'opacity-50'
                    )}
                    data-testid={`ios-select-option-${option.value}`}
                  >
                    <span className="ios-bottom-sheet-option-text">{option.label}</span>
                    {isSelected && (
                      <Check className="ios-bottom-sheet-check" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface IOSSelectWrapperProps {
  value?: string;
  onValueChange?: (value: string) => void;
  options: IOSSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  triggerClassName?: string;
  title?: string;
  children: ReactNode;
}

export function IOSSelectWrapper({
  value,
  onValueChange,
  options,
  placeholder,
  disabled,
  className,
  triggerClassName,
  title,
  children,
}: IOSSelectWrapperProps) {
  const [isNative, setIsNative] = useState(false);

  useEffect(() => {
    setIsNative(isNativeIOS());
  }, []);

  if (isNative) {
    return (
      <IOSSelect
        value={value}
        onValueChange={onValueChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        triggerClassName={triggerClassName}
        title={title}
      />
    );
  }

  return <>{children}</>;
}

export default IOSSelect;
