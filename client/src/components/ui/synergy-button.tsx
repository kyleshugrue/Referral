import React from 'react';
import { Button } from "@/components/ui/button";
import { SynergyIcon } from '@/components/icons/synergy-icon';
import { SynergyPattern } from '@/components/patterns/synergy-pattern';
import { SynergyComplexIcon } from '@/components/patterns/synergy-complex-icon';
import { cn } from '@/lib/utils';

interface SynergyButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'variant'> {
  variant?: 'default' | 'subtle' | 'complex';
  iconPosition?: 'left' | 'right' | 'none';
  fullWidth?: boolean;
  size?: 'default' | 'sm' | 'lg' | 'icon';
  className?: string;
}

export const SynergyButton: React.FC<SynergyButtonProps> = ({
  children,
  variant = 'default',
  iconPosition = 'left',
  fullWidth = false,
  size = 'default',
  className,
  ...props
}) => {
  // Set colors based on variant
  const accentColor = '#ffffff';
  
  return (
    <Button 
      variant="default"
      size={size}
      className={cn(
        'relative overflow-hidden group transition-all duration-300',
        variant === 'subtle' ? 'bg-indigo-600 hover:bg-indigo-700 text-white' : 
        variant === 'complex' ? 'bg-gradient-to-br from-slate-700 to-slate-900 hover:from-slate-800 hover:to-slate-950 text-white' : 
        'bg-gradient-to-br from-[hsl(215,20%,65%)] to-[hsl(215,25%,27%)] hover:from-[hsl(215,20%,60%)] hover:to-[hsl(215,25%,22%)] text-white',
        fullWidth ? 'w-full' : '',
        size === 'lg' ? 'py-6' : '',
        className
      )}
      {...props}
    >
      <div className="relative z-10 flex items-center justify-center gap-2">
        {iconPosition === 'left' && (
          variant === 'complex' ? 
          <SynergyComplexIcon size={24} primaryColor={accentColor} secondaryColor={accentColor} accentColor={accentColor} /> :
          <SynergyIcon size={24} />
        )}
        <span className="font-medium">{children}</span>
        {iconPosition === 'right' && (
          variant === 'complex' ? 
          <SynergyComplexIcon size={24} primaryColor={accentColor} secondaryColor={accentColor} accentColor={accentColor} /> :
          <SynergyIcon size={24} />
        )}
      </div>
      
      <div className="absolute inset-0 z-0 transition-opacity duration-300 opacity-30 group-hover:opacity-60">
        <SynergyPattern 
          primaryColor={accentColor} 
          secondaryColor={accentColor} 
          opacity={1}
        />
      </div>
      
      {/* Animated hover effect */}
      <div className="absolute inset-0 z-0 bg-white opacity-0 group-hover:opacity-5 transition-opacity duration-300"></div>
    </Button>
  );
};

export default SynergyButton;