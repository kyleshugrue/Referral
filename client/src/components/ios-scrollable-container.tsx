import { forwardRef, ReactNode } from 'react';
import { Capacitor } from '@capacitor/core';
import { cn } from '@/lib/utils';

interface IOSScrollableContainerProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  bottomPadding?: number;
}

const isNativeIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();

export const IOSScrollableContainer = forwardRef<HTMLDivElement, IOSScrollableContainerProps>(({
  children,
  className = '',
  contentClassName = '',
  bottomPadding = 100,
}, ref) => {
  return (
    <div
      ref={ref}
      className={cn(
        'ios-scrollable-container',
        'flex-1 overflow-y-auto overflow-x-hidden',
        isNativeIOS && 'ios-native-scroll',
        className
      )}
      style={{
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'none',
      }}
    >
      <div 
        className={cn('ios-scroll-content', contentClassName)}
        style={{ paddingBottom: `${bottomPadding}px` }}
      >
        {children}
      </div>
    </div>
  );
});

IOSScrollableContainer.displayName = 'IOSScrollableContainer';

export default IOSScrollableContainer;
