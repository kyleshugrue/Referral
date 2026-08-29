import { User } from "@shared/schema";
import { Card, CardContent } from "./ui/card";
import { Building2, MapPin, Briefcase, FileText } from "lucide-react";
import { Badge } from "./ui/badge";
import { cn } from "@/lib/utils";
import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { useAuth } from "@/hooks/use-auth";
import { generateAvatarWithInitials } from "@/lib/avatar-utils";

interface ProfileCardProps {
  profile: User;
  className?: string;
  onProfileClick?: () => void;
}

export default function ProfileCard({ profile: initialProfile, className, onProfileClick }: ProfileCardProps) {
  // Keep local state to handle updates
  const [profile, setProfile] = useState<User>(initialProfile);
  const { user, refreshUserData } = useAuth();

  // Helper function to check if an interest matches the current user's interests
  const isInterestMatching = (interest: string, type: 'hobby' | 'professional'): boolean => {
    if (!user) return false;
    
    if (type === 'hobby') {
      return user.interests?.includes(interest) ?? false;
    } else {
      return user.professionalInterests?.includes(interest) ?? false;
    }
  };
  
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onProfileClick?.();
  };
  
  // Check if this is the current user's profile and keep it updated
  useEffect(() => {
    // Update profile when initialProfile changes
    setProfile(initialProfile);
    
    // If this is the current user's profile, listen for update events
    if (user?.id === initialProfile.id) {
      console.log("ProfileCard: Detected current user's profile, setting up update listeners");
      
      // Update when user data is refreshed
      const handleUserDataRefreshed = (event: Event) => {
        const freshUserData = (event as CustomEvent).detail;
        if (freshUserData && freshUserData.id === user.id) {
          console.log("ProfileCard: Updating with fresh user data from event");
          setProfile(freshUserData);
        }
      };
      
      // Listen for app-wide data refresh events
      const handleAppDataRefreshed = () => {
        console.log("ProfileCard: App data refreshed, updating current user profile");
        refreshUserData();
      };
      
      // Set up event listeners
      window.addEventListener('user-data-refreshed', handleUserDataRefreshed);
      window.addEventListener('app-data-refreshed', handleAppDataRefreshed);
      
      return () => {
        window.removeEventListener('user-data-refreshed', handleUserDataRefreshed);
        window.removeEventListener('app-data-refreshed', handleAppDataRefreshed);
      };
    }
  }, [initialProfile, user, refreshUserData]);

  // Use the utility function to generate the avatar with initials
  const defaultAvatar = generateAvatarWithInitials(profile.fullName);

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-transform hover:scale-[1.02] rounded-none sm:rounded-lg border-0 sm:border",
        "hover:shadow-lg",
        className
      )}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      <CardContent className="p-4 space-y-4">
        {/* Header Section */}
        <div className="flex items-start gap-3">
          <div className="relative w-12 h-12 flex-shrink-0">
            {/* Check for valid photo (not placeholder) */}
            {profile.photo && 
             !profile.photo.includes('placeholder') && 
             profile.photo !== '/placeholder.jpg' ? (
              <img
                src={profile.photo}
                alt={profile.fullName}
                className="w-full h-full object-cover border-2 border-muted"
              />
            ) : (
              <img
                src={defaultAvatar}
                alt={profile.fullName}
                className="w-full h-full object-cover border-2 border-muted"
              />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-base leading-tight truncate">{profile.fullName}</h2>
            <p className="text-sm text-muted-foreground truncate">{profile.title}</p>
          </div>
        </div>

        {/* Role Info */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Building2 className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{profile.currentCompany || "Not specified"}</span>
        </div>

        {/* Location */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">{profile.currentLocation || "Not specified"}</span>
        </div>

        {/* Industry & Experience */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Briefcase className="h-4 w-4 flex-shrink-0" />
          <span className="truncate">
            {profile.industry ? profile.industry.charAt(0).toUpperCase() + profile.industry.slice(1).toLowerCase() : ''}
            {profile.yearsOfExperience ? ` - ${profile.yearsOfExperience} years` : ''}
          </span>
        </div>

        {/* Bio Section */}
        {profile.bio && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">About Me</h3>
            <div className="prose prose-sm max-w-none text-muted-foreground">
              <ReactMarkdown
                allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li']}
                unwrapDisallowed
              >
                {profile.bio}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {/* Professional Interests */}
        {profile.professionalInterests && profile.professionalInterests.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Professional Interests</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.professionalInterests.map((interest, index) => {
                const isMatching = isInterestMatching(interest, 'professional');
                return (
                  <Badge 
                    key={index} 
                    variant={isMatching ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {interest}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Hobbies/Interests */}
        {profile.interests && profile.interests.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Hobbies</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.interests.map((interest, index) => {
                const isMatching = isInterestMatching(interest, 'hobby');
                return (
                  <Badge 
                    key={index} 
                    variant={isMatching ? "secondary" : "outline"}
                    className="text-xs"
                  >
                    {interest}
                  </Badge>
                );
              })}
            </div>
          </div>
        )}

        {/* Resume Preview */}
        {profile.resumeUrl && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Resume</span>
            </div>
            {profile.resumePreviewUrls && profile.resumePreviewUrls.length > 0 && (
              <div className="space-y-2">
                {profile.resumePreviewUrls.map((previewUrl, index) => (
                  <div 
                    key={index} 
                    className="rounded-md overflow-hidden border border-muted bg-white"
                  >
                    <img
                      src={previewUrl}
                      alt={`Resume page ${index + 1}`}
                      className="w-full h-auto"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Locations of Interest */}
        {profile.desiredLocations && profile.desiredLocations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Locations of Interest</h3>
            <div className="flex flex-wrap gap-1.5">
              {profile.desiredLocations.map((location, index) => (
                <Badge
                  key={index}
                  variant="outline"
                  className="text-xs flex items-center gap-1 max-w-[150px]"
                >
                  <MapPin className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate">{location}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}