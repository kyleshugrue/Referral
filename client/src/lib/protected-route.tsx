import React from "react";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { Redirect, Route } from "wouter";
import { determineStartingStepForVerifiedUser } from "./registration-helpers";
import { logger } from "@/lib/logger";

export function ProtectedRoute({
  path,
  component: Component,
}: {
  path: string;
  component: () => React.JSX.Element;
}) {
  const { user, firebaseUser, isLoading } = useAuth();
  
  logger.debug("🛡️ [PROTECTED-ROUTE DEBUG] Evaluating protection for path:", path, {
    timestamp: new Date().toISOString(),
    isLoading,
    hasFirebaseUser: !!firebaseUser,
    hasBackendUser: !!user,
    backendUserDetails: user ? {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      registrationCompleted: user.registrationCompleted
    } : null
  });

  const allowedPathsWithoutRegistration = [
    '/multi-step-register', 
    '/verify-email', 
    '/auth', 
    '/auth/login', 
    '/auth/register', 
    '/auth/forgot-password',
    '/auth/email-verified',
    '/register'
  ];
  
  const isAllowedPathWithoutRegistration = allowedPathsWithoutRegistration.some(allowedPath => 
    path === allowedPath || path.startsWith(allowedPath + '?')
  );

  if (isLoading && !user) {
    logger.debug("⏳ [PROTECTED-ROUTE DEBUG] Authentication state is loading with no cached user - blocking access");
    return (
      <Route path={path}>
        <div className="flex items-center justify-center min-h-[100dvh]">
          <Loader2 className="h-6 w-6 sm:h-8 sm:w-8 animate-spin text-border" />
        </div>
      </Route>
    );
  }

  if (!user) {
    logger.debug("🚫 [PROTECTED-ROUTE DEBUG] No backend user found - redirecting to auth");
    return (
      <Route path={path}>
        <Redirect to="/auth" />
      </Route>
    );
  }

  const allowedUnverifiedPaths = [
    '/verify-email', 
    '/auth', 
    '/auth/login', 
    '/auth/register', 
    '/auth/forgot-password',
    '/register'
  ];
  
  const isAllowedUnverifiedPath = allowedUnverifiedPaths.some(allowedPath => 
    path === allowedPath || path.startsWith(allowedPath + '?')
  );
  
  if (!user.emailVerified && !isAllowedUnverifiedPath) {
    logger.debug("📧 [PROTECTED-ROUTE DEBUG] Email not verified - redirecting to verification");
    return (
      <Route path={path}>
        <Redirect to="/verify-email" />
      </Route>
    );
  }

  if (user.registrationCompleted !== true && !isAllowedPathWithoutRegistration) {
    logger.debug("📝 [PROTECTED-ROUTE DEBUG] Registration not completed - redirecting to registration");
    
    const currentStep = determineStartingStepForVerifiedUser(user);
    logger.debug(`Registration incomplete, redirecting to step ${currentStep}`);
    
    return (
      <Route path={path}>
        <Redirect to={`/multi-step-register?step=${currentStep}`} />
      </Route>
    );
  }

  logger.debug("✅ [PROTECTED-ROUTE DEBUG] All security checks passed - rendering protected component");
  return <Route path={path}><Component /></Route>;
}
