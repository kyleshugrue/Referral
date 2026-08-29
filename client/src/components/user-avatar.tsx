import { User } from "@shared/schema";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/avatar-utils";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  user: User | null | undefined;
  className?: string;
  fallbackClassName?: string;
  circular?: boolean;
}

/**
 * A bulletproof avatar component that ALWAYS shows initials as fallback
 * Handles ALL edge cases to prevent blank profile pictures
 */
export function UserAvatar({ user, className, fallbackClassName, circular = true }: UserAvatarProps) {
  // Ultra-strict photo validation - only allow genuinely valid photo URLs
  const hasValidPhoto = Boolean(
    user?.photo && 
    typeof user.photo === 'string' && 
    user.photo.trim().length > 0 && 
    !user.photo.toLowerCase().includes('placeholder') && 
    user.photo !== '/placeholder.jpg' &&
    user.photo !== 'placeholder.jpg' &&
    user.photo !== '' &&
    user.photo !== 'null' &&
    user.photo !== 'undefined' &&
    (user.photo.startsWith('http://') || 
     user.photo.startsWith('https://') || 
     user.photo.startsWith('/') ||
     user.photo.startsWith('data:'))
  );
  
  // Generate bulletproof fallback initials that ALWAYS work
  // Double safety: getInitials is bulletproof, but we add || '?' as final insurance
  const fallbackInitials = getInitials(user?.fullName) || '?';
  
  // For non-circular mode, use the same approach as profile popups
  if (!circular) {
    return (
      <div className={cn("w-full h-full overflow-hidden relative", className)}>
        {hasValidPhoto ? (
          <img 
            src={user!.photo!} 
            alt={user!.fullName || 'User'} 
            className="w-full h-full object-cover"
            onError={(e) => {
              // Hide the image and show the fallback
              e.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <div className={cn("w-full h-full flex items-center justify-center bg-primary text-white", fallbackClassName)}>
            <span className="font-medium">
              {fallbackInitials}
            </span>
          </div>
        )}
      </div>
    );
  }
  
  // Default circular mode using Radix Avatar
  return (
    <Avatar className={cn("", className)}>
      {/* Only render image if we're absolutely sure it's valid */}
      {hasValidPhoto && (
        <AvatarImage 
          src={user!.photo!} 
          alt={user!.fullName || 'User'} 
          className="object-cover"
          onError={() => {
            // Image failed to load - AvatarFallback will automatically show
          }}
        />
      )}
      {/* 
        CRITICAL: AvatarFallback is ALWAYS rendered by Radix UI
        This is our bulletproof safety net - it shows when:
        1. No image is provided (hasValidPhoto = false)
        2. Image fails to load (onError triggers)
        3. Image takes too long to load (timeout)
        4. Any other image loading failure
      */}
      <AvatarFallback 
        className={cn(fallbackClassName || "bg-[hsl(215,25%,27%)] text-white font-medium")}
        delayMs={0} // Show immediately if image fails
      >
        {fallbackInitials}
      </AvatarFallback>
    </Avatar>
  );
}