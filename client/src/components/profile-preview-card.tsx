import { Card } from "@/components/ui/card";
import { type User } from "@shared/schema";
import { UserAvatar } from "@/components/user-avatar";

interface ProfilePreviewCardProps {
  profile: User;
  onSelect?: () => void;
  onViewProfile?: () => void;
  requestStatus?: 'incoming' | 'outgoing';
  onConnect?: () => void;
  isConnecting?: boolean;
  isPending?: boolean;
  isIncoming?: boolean;
  preventClick?: boolean;
}

export default function ProfilePreviewCard({ 
  profile, 
  onSelect,
  onViewProfile,
  preventClick 
}: ProfilePreviewCardProps) {
  // Use onViewProfile if provided, fallback to onSelect
  const handleCardClick = onViewProfile || onSelect;
  
  return (
    <Card 
      className="flex flex-col p-4 bg-card cursor-pointer touch-manipulation active:bg-muted/50 transition-colors overflow-hidden overscroll-none select-none border-[1px] border-[hsl(215,20%,65%)] rounded-lg shadow-[0_0_10px_-2px_hsl(215,20%,65%),0_0_15px_-5px_hsl(215,20%,65%)] h-[230px] w-full relative"
      onClick={(e) => {
        e.preventDefault();
        if (!preventClick && typeof handleCardClick === 'function') {
          handleCardClick();
        }
      }}
    >
      {/* Profile Image and Name Section - Centered at top */}
      <div className="flex flex-col items-center mb-3">
        <div className="mb-1">
          <UserAvatar 
            user={profile} 
            className="w-14 h-14 rounded-full"
            fallbackClassName="text-lg font-medium bg-primary text-white"
          />
        </div>
        <div className="text-center w-full">
          <h3 className="font-medium text-base leading-tight truncate max-w-full">{profile.fullName}</h3>
          <p className="text-xs text-muted-foreground truncate max-w-full">
            {profile.title || ""}
          </p>
        </div>
      </div>

      {/* Info Cards Section - Information inline with titles, vertically aligned at top */}
      <div className="flex flex-col mt-auto space-y-1.5">
        <div className="flex text-sm items-start">
          <span className="font-medium whitespace-nowrap">Location:</span>
          <span className="ml-1 truncate">
            {profile.currentLocation || "Not specified"}
          </span>
        </div>
        <div className="flex text-sm items-start">
          <span className="font-medium whitespace-nowrap">Company:</span>
          <span className="ml-1 truncate">
            {profile.currentCompany || "Not specified"}
          </span>
        </div>
        <div className="flex text-sm items-start">
          <span className="font-medium whitespace-nowrap">Industry:</span>
          <span className="ml-1 truncate">
            {profile.industry ? profile.industry.charAt(0).toUpperCase() + profile.industry.slice(1).toLowerCase() + ' industry' : "Not specified"}
          </span>
        </div>
        <div className="flex text-sm items-start">
          <span className="font-medium whitespace-nowrap">Education:</span>
          <span className="ml-1 truncate">
            {profile.institution && profile.educationLevel 
              ? `${profile.institution} - ${profile.educationLevel}`
              : profile.institution || profile.educationLevel || "Not specified"
            }
          </span>
        </div>
      </div>
      
      {/* Glow effect on hover */}
      <div className="absolute -inset-0 bg-primary/5 rounded-lg blur-[0.5px] opacity-0 group-hover:opacity-100 transition duration-300 pointer-events-none mt-2"></div>
    </Card>
  );
}