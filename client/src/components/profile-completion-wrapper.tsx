import { useEffect } from 'react';
import { useAuth } from '@/hooks/use-auth';
import ProfileCompletionPage from '@/pages/profile-completion-page';
import { Loader2 } from 'lucide-react';
import { getPendingRegistrationData, getRegistrationData } from '@/lib/registration-helpers';
import { logger } from '@/lib/logger';

/**
 * This wrapper intercepts the profile-completion page rendering
 * and redirects verified users to the multi-step registration instead.
 */
export default function ProfileCompletionWrapper() {
  const { user, isLoading } = useAuth();

  // Check if registration is in progress based on localStorage data
  const isRegistrationInProgress = () => {
    try {
      // Check for existing registration data in localStorage
      const pendingData = getPendingRegistrationData();
      const savedData = getRegistrationData();
      
      // If we have one of these data items, registration is in progress
      const inProgress = !!(pendingData || savedData);
      logger.debug("ProfileCompletionWrapper: Registration in progress check:", { inProgress, hasLocalData: !!(pendingData || savedData) });
      
      return inProgress;
    } catch (e) {
      logger.error("Error checking registration progress:", e);
      return false;
    }
  };

  useEffect(() => {
    if (user) {
      logger.debug('ProfileCompletionWrapper: Checking if user needs to be redirected');
      
      // Check for incomplete profile or registration in progress
      if (user.title === "New User" || 
          user.currentLocation === "Not specified" || 
          user.industry === "Other" ||
          user.currentCompany === "Not specified" ||
          isRegistrationInProgress()) {
        
        logger.debug('ProfileCompletionWrapper: User has incomplete profile or registration in progress, redirecting to multi-step');
      }
    }
  }, [user]);

  // If still loading auth, show loading indicator
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[100dvh]">
        <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-border" />
      </div>
    );
  }
  
  // DISABLED: Automatic redirects removed to prevent unwanted navigation
  // Users can now access the profile completion page without being automatically redirected
  logger.debug('ProfileCompletionWrapper: Automatic redirects are disabled');

  // Otherwise, show the regular profile completion page
  return <ProfileCompletionPage />;
}