import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import ProfileCompletionWrapper from "@/components/profile-completion-wrapper";

import { AuthProvider } from "@/hooks/use-auth";
import { ProfileStateProvider } from "@/contexts/profile-state-context";

import { ProtectedRoute } from "./lib/protected-route";
import { SidebarProvider } from "@/components/ui/sidebar";
import ProtectedLayout from "@/components/protected-layout";
import { SplashScreen } from "@/components/splash-screen";
import { ProfileDialogProvider } from "@/hooks/use-profile-dialog";
import ProfileCompletionInterceptor from "@/components/profile-completion-interceptor";

import { lazy, Suspense, useState, useEffect, useRef } from "react";
import { useCapacitor } from "@/hooks/use-capacitor";
import { initGA } from "./lib/analytics";
import { useAnalytics } from "./hooks/use-analytics";
import { usePushNotifications } from "@/hooks/use-push-notifications";

const NotFound = lazy(() => import("@/pages/not-found"));
const NetworkPage = lazy(() => import("@/pages/network-page"));
const NetworkSearchPage = lazy(() => import("@/pages/network-search-page"));
const NetworkSharedInterestsPage = lazy(() => import("@/pages/network-shared-interests-page"));
const NetworkSharedExperiencePage = lazy(() => import("@/pages/network-shared-experience-page"));
const AuthPage = lazy(() => import("@/pages/auth-page"));
const LoginPage = lazy(() => import("@/pages/login-page"));
const RegisterPage = lazy(() => import("@/pages/register-page"));
const NewMultiStepRegisterPage = lazy(() => import("@/pages/new-multi-step-register-page"));
const ProfilePage = lazy(() => import("@/pages/profile-page"));
const ConnectionsPage = lazy(() => import("@/pages/connections-page"));
const RequestsPage = lazy(() => import("@/pages/requests-page"));
const SettingsPage = lazy(() => import("@/pages/settings-page"));
const BlockedAccountsPage = lazy(() => import("@/pages/blocked-accounts-page"));
const MatchesSuggestionsPage = lazy(() => import("@/pages/matches-suggestions-page"));
const ChatPage = lazy(() => import("@/pages/chat-page"));
const ResumeViewPage = lazy(() => import("@/pages/resume-view-page"));
const KeyboardTestPage = lazy(() => import("@/pages/keyboard-test"));
const DeviceTestPage = lazy(() => import("@/pages/device-test"));
const EmailVerifiedPage = lazy(() => import("@/pages/email-verified-page"));
const ForgotPasswordPage = lazy(() => import("@/pages/forgot-password-page"));
const VerifyEmailPage = lazy(() => import("@/pages/verify-email-page"));
const SynergyButtonDemoPage = lazy(() => import("@/pages/synergy-button-demo"));

// Global window properties for navigation handling
declare global {
  interface Window {
    __networkFallbackLink?: HTMLAnchorElement;
    __forceRedirectToNetwork?: boolean;
    __networkNavigationInitiated?: boolean;
    __networkRedirectTimeouts?: NodeJS.Timeout[];
  }
}

// Initialize the global arrays if they don't exist
if (typeof window !== 'undefined') {
  window.__networkRedirectTimeouts = window.__networkRedirectTimeouts || [];
}

function Router() {
  // Track page views when routes change
  useAnalytics();
  
  return (
    <div className="min-w-[100vw] min-h-[100dvh]">
      <Suspense fallback={<div className="min-h-[100dvh] bg-background" aria-label="Loading page" />}>
      <Switch>
        <Route path="/auth" component={AuthPage} />
        <Route path="/auth/login" component={LoginPage} />
        <Route path="/auth/register" component={RegisterPage} />
        <Route path="/auth/email-verified" component={EmailVerifiedPage} />
        <Route path="/auth/forgot-password" component={ForgotPasswordPage} />
        <Route path="/verify-email" component={VerifyEmailPage} />
        <Route path="/multi-step-register" component={NewMultiStepRegisterPage} />
        {import.meta.env.DEV && <Route path="/auth-preview" component={AuthPage} />}
        <ProtectedRoute path="/profile-completion" component={ProfileCompletionWrapper} />

        <ProtectedRoute 
          path="/matches/suggestions"
          component={() => (
            <ProtectedLayout>
              <MatchesSuggestionsPage />
            </ProtectedLayout>
          )}
        />
        <ProtectedRoute 
          path="/" 
          component={() => (
            <ProtectedLayout>
              <NetworkPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/network/search" 
          component={() => (
            <ProtectedLayout>
              <NetworkSearchPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/network/shared-interests" 
          component={() => (
            <ProtectedLayout>
              <NetworkSharedInterestsPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/network/shared-experience" 
          component={() => (
            <ProtectedLayout>
              <NetworkSharedExperiencePage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/profile" 
          component={() => (
            <ProtectedLayout>
              <ProfilePage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/connections" 
          component={() => (
            <ProtectedLayout>
              <ConnectionsPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/chat/:id" 
          component={() => <ChatPage />} 
        />
        {import.meta.env.DEV && (
          <ProtectedRoute 
            path="/keyboard-test" 
            component={() => <KeyboardTestPage />} 
          />
        )}
        {import.meta.env.DEV && (
          <ProtectedRoute 
            path="/device-test" 
            component={() => <DeviceTestPage />} 
          />
        )}
        <ProtectedRoute 
          path="/requests" 
          component={() => (
            <ProtectedLayout>
              <RequestsPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/settings" 
          component={() => (
            <ProtectedLayout>
              <SettingsPage />
            </ProtectedLayout>
          )} 
        />
        <ProtectedRoute 
          path="/settings/blocked-accounts" 
          component={() => (
            <ProtectedLayout>
              <BlockedAccountsPage />
            </ProtectedLayout>
          )} 
        />
        {/* Resume View Route - No Layout wrapper to allow full screen and native scrolling */}
        <ProtectedRoute 
          path="/resume/:userId/:returnPath?" 
          component={() => <ResumeViewPage />}
        />
        {/* Synergy Button Demo Route (dev only) */}
        {import.meta.env.DEV && (
          <Route 
            path="/synergy-button-demo" 
            component={SynergyButtonDemoPage} 
          />
        )}

        <Route component={NotFound} />
      </Switch>
      </Suspense>
    </div>
  );
}

function App() {
  const [showingSplash, setShowingSplash] = useState(true);
  const { isNative, platform, hideSplashScreen } = useCapacitor();
  const { hasPermission, isInitialized, updateBadgeCount } = usePushNotifications();
  const appReadyRef = useRef(false);

  useEffect(() => {
    // Initialize Google Analytics when app loads
    if (!import.meta.env.VITE_GA_MEASUREMENT_ID) {
      console.warn('Missing required Google Analytics key: VITE_GA_MEASUREMENT_ID');
    } else {
      initGA();
    }

    // DISABLED: Force navigate logic removed to prevent automatic redirects
    const forceNavigate = localStorage.getItem('forceNavigateToNetwork') === 'true';
    if (forceNavigate) {
      console.log("App: Force navigate flag detected - but automatic navigation is disabled");
      // Clear the flag to prevent any future attempts
      localStorage.removeItem('forceNavigateToNetwork');
    }
    
    // Check if this is the first load of the session
    const hasLoadedThisSession = sessionStorage.getItem('hasLoadedApp');
    if (hasLoadedThisSession) {
      setShowingSplash(false);
    } else {
      // Set the flag for this session
      sessionStorage.setItem('hasLoadedApp', 'true');
    }
  }, []);

  useEffect(() => {
    // Add mobile-specific CSS classes once Capacitor reports the platform.
    if (isNative) {
      document.body.classList.add('mobile-app', platform);
      document.documentElement.classList.add('mobile-app', platform);
    }

    // Push notifications are managed through Settings page.
    // Update the badge when an already-authorized iOS app becomes ready.
    if (isNative && platform === 'ios' && hasPermission && isInitialized) {
      updateBadgeCount().then(() => {
        console.log('[App] Badge count updated on launch');
      }).catch((error) => {
        console.error('[App] Error updating badge count on launch:', error);
      });
    }
  }, [hasPermission, isInitialized, isNative, platform, updateBadgeCount]);

  useEffect(() => {
    if (!showingSplash && isNative && !appReadyRef.current) {
      appReadyRef.current = true;
      hideSplashScreen();
    }
  }, [showingSplash, isNative, hideSplashScreen]);

  return (
    <div className="min-w-[100vw] min-h-[100dvh]">
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProfileStateProvider>
            <ProfileDialogProvider>
              <SidebarProvider defaultOpen={false}>
                <SplashScreen onVisibilityChange={setShowingSplash} />
                {!showingSplash && (
                  <>
                    <ProfileCompletionInterceptor />
                    <Router />
                  </>
                )}
                <Toaster />
              </SidebarProvider>
            </ProfileDialogProvider>
          </ProfileStateProvider>
        </AuthProvider>
      </QueryClientProvider>
    </div>
  );
}

export default App;