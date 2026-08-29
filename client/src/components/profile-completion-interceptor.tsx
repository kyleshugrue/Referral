import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/use-auth';

/**
 * This component intercepts the application flow and redirects users
 * to the registration process if their profile is incomplete.
 * It should be included at the top level of the application.
 */
export function ProfileCompletionInterceptor() {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    // DISABLED: Automatic redirects removed to prevent unwanted navigation
    // This component no longer performs automatic redirects to ensure users
    // can stay on their intended pages without being redirected
    console.log("ProfileCompletionInterceptor: Automatic redirects are disabled");
    return;
  }, [user, isLoading, setLocation]);

  // This component doesn't render anything
  return null;
}

export default ProfileCompletionInterceptor;