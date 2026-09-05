import { useState, useMemo, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertUserSchema, industries, educationLevels, type User } from "@shared/schema";
import { Trash2, PencilIcon, EyeIcon, Camera, FileText, X, MapPin, Settings } from "lucide-react";
import { useLocation, Link } from "wouter";
import BioEditor from "@/components/bio-editor";
import { ProfileEditToolbar } from "@/components/profile-edit-toolbar";
import HybridLocationInput from "@/components/hybrid-location-input";
import ProtectedLayout from "@/components/protected-layout";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { capitalizeWords, cn } from "@/lib/utils";
import { UserAvatar } from "@/components/user-avatar";
import { getInitials } from "@/lib/avatar-utils";
import { Building2, Briefcase } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import SearchableInterestSelect from "@/components/searchable-interest-select";
import { professionalInterests, hobbyInterests, languages } from "@/lib/interests-options";
import ImageCropper from "@/components/image-cropper";
import { toTitleCase } from "@/utils/text-utils";
import { useDeviceType } from "@/hooks/use-device-type";
import { Capacitor } from '@capacitor/core';
import { useProfileState } from "@/contexts/profile-state-context";
import { useProfileSave } from "@/hooks/use-profile-save";
import { IOSSelectWrapper } from "@/components/ui/ios-select";
import { useIOSKeyboardPro } from "@/hooks/use-ios-keyboard-pro";
import { IOSKeyboardAwareScrollView } from "@/components/ios-keyboard-aware-container";
import { IOSInputAccessoryToolbar } from "@/components/ios-input-accessory-toolbar";
import { useIOSFieldNavigation } from "@/hooks/use-ios-field-navigation";

declare global {
  interface Window {
    saveProfileData?: () => void;
    profileSaveStatus?: string;
  }
}

// Safely capitalize the first letter of a string (handling empty values)
const capitalizeFirstLetter = (str: string): string => {
  // Return empty string as-is to allow field clearing
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// Define the form data type based on User schema
type ProfileFormData = Omit<User, 'id' | 'password'>;

// Create a schema for profile updates that makes all fields optional
const updateProfileSchema = insertUserSchema
  .partial();

export default function ProfilePage() {
  const { user, refreshUserData } = useAuth();
  const { toast } = useToast();
  const { currentProfileTab, setCurrentProfileTab, setProfileCropperActive } = useProfileState();
  const [showCropper, setShowCropper] = useState(false);
  const [tempPhotoUrl, setTempPhotoUrl] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [location, setLocation] = useLocation();
  const [, setIsKeyboardVisible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [avatarRefreshKey, setAvatarRefreshKey] = useState(0);
  const deviceType = useDeviceType();
  const [isNativeIOSApp, setIsNativeIOSApp] = useState(false);
  const [showPhotoButtons, setShowPhotoButtons] = useState(false);
  const photoContainerRef = useRef<HTMLDivElement>(null);
  
  // Professional-grade iOS keyboard handling (Bumble/Tinder style)
  // This hook manages all keyboard events and auto-scrolling for native iOS
  const { 
    isNativeIOSApp: isIOSFromKeyboardHook, 
    keyboardHeight, 
    isKeyboardVisible: isIOSKeyboardVisible,
    scrollInputToCenter,
  } = useIOSKeyboardPro();
  
  // Professional-grade field navigation (Previous/Next/Done toolbar)
  // Tracks all form fields and enables Bumble/Tinder-style navigation
  // Now includes auto-scroll to keep focused fields visible when keyboard is open
  const fieldNavigation = useIOSFieldNavigation({
    enabled: isIOSFromKeyboardHook,
    scrollInputToCenter,
    isKeyboardVisible: isIOSKeyboardVisible,
    onFieldChange: (fieldId, index) => {
      console.log('[ProfilePage] Field focus changed:', fieldId, 'index:', index);
    }
  });
  
  // Professional-grade profile save hook with debouncing, retry, and optimistic updates
  const { flushPendingSave, saveStatus, cancelPendingSave, getCachedUser, hasUnsavedChanges: hookHasUnsavedChanges, uploadPhoto, deletePhoto, uploadResume, deleteResume, lastSaveTimestamp, saveOperationVersion, shouldBlockFormReset } = useProfileSave();

  // Derived boolean to disable form inputs during save operations
  const isSaving = saveStatus === 'saving' || saveStatus === 'retrying';

  // Check if we're running in a native iOS Capacitor app
  useEffect(() => {
    const isIOS = Capacitor.getPlatform() === 'ios' && Capacitor.isNativePlatform();
    setIsNativeIOSApp(isIOS);
  }, []);

  // Handle click outside to hide photo buttons
  useEffect(() => {
    const handleClickOutside = (event: Event) => {
      if (photoContainerRef.current && !photoContainerRef.current.contains(event.target as Node)) {
        setShowPhotoButtons(false);
      }
    };

    if (showPhotoButtons) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [showPhotoButtons]);

  // Scroll to top on mobile when navigating to this page
  useEffect(() => {
    if (deviceType !== 'desktop' && location.startsWith('/profile')) {
      window.scrollTo(0, 0);
    }
  }, [location, deviceType]);
  
  // Handle potential errors for newly registered users with incomplete profiles
  useEffect(() => {
    if (user) {
      setIsLoading(false);
    }
  }, [user]);
  
  // Function to get the initial tab value based on URL parameters
  const getTabFromUrl = () => {
    // Check if the URL has a tab parameter
    const urlParams = new URLSearchParams(window.location.search);
    const tabParam = urlParams.get('tab');
    
    // Return the tab parameter if it's valid, otherwise default to 'edit'
    return tabParam === 'preview' ? 'preview' : 'edit';
  };
  
  // Store the current tab state in a local state variable to ensure component updates properly
  const [activeTab, setActiveTab] = useState(getTabFromUrl());
  
  // Effect to update tab when URL changes
  useEffect(() => {
    // Parse URL parameters anytime they change
    const newTab = getTabFromUrl();
    console.log("URL parameters changed, updating tab to:", newTab);
    setActiveTab(newTab);
    
    // Update context state to ensure consistency across components
    setCurrentProfileTab(newTab);
    
    // Update the URL to include the tab parameter if it doesn't already
    // This ensures the URL state is always consistent with the component state
    const url = new URL(window.location.href);
    if (!url.searchParams.has('tab') || url.searchParams.get('tab') !== newTab) {
      url.searchParams.set('tab', newTab);
      // Use history API to update URL without reload
      window.history.replaceState({}, '', url.toString());
      console.log("Updated URL with tab parameter:", url.toString());
    }
    
    // Dispatch a custom event for any listeners
    const tabChangeEvent = new CustomEvent('profile-tab-changed', { detail: newTab });
    window.dispatchEvent(tabChangeEvent);
  }, [location, setCurrentProfileTab]);
  
  // Function to update keyboard visibility and dispatch custom event (WEB ONLY)
  // On native iOS, keyboard visibility is managed by useIOSKeyboardPro and synced via effect
  // This function is only used for web/mobile web browsers
  const updateKeyboardVisibility = useCallback((isVisible: boolean, forceVisible = false) => {
    // On native iOS, keyboard visibility is managed by the hook - don't use this function
    if (isIOSFromKeyboardHook) {
      return;
    }
    
    // Defensive guard: On desktop, ignore requests to show keyboard visibility
    if (deviceType === 'desktop' && isVisible) {
      console.log("[ProfilePage] Desktop detected - ignoring keyboard visibility request (no on-screen keyboard)");
      return;
    }
    
    // For text inputs (open-ended questions), hide the nav bar when keyboard is visible
    // For select elements, keep the nav bar visible (forceVisible = true)
    const finalVisibility = forceVisible ? false : isVisible;
    
    setIsKeyboardVisible(finalVisibility);
    
    // Dispatch custom event for mobile-nav component to listen to
    window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
      detail: finalVisibility 
    }));
    
    console.log("[ProfilePage] Keyboard visibility updated:", finalVisibility, forceVisible ? "(nav bar forced visible)" : "");
  }, [deviceType, isIOSFromKeyboardHook]);
  
  // Make updateKeyboardVisibility available globally so LocationInput can use it directly
  // IMPORTANT: Use useLayoutEffect to register synchronously before paint
  // This ensures external callers always get the guarded version from the very first render
  useLayoutEffect(() => {
    window.updateKeyboardVisibility = updateKeyboardVisibility;
    console.log("[ProfilePage] Registered global updateKeyboardVisibility (deviceType:", deviceType + ")");
    
    return () => {
      // Clean up on unmount
      delete window.updateKeyboardVisibility;
    };
  }, [updateKeyboardVisibility, deviceType]);
  
  // Sync iOS keyboard visibility with the mobile nav event system
  // This ensures the mobile nav hides/shows correctly based on the iOS keyboard hook state
  useEffect(() => {
    if (!isIOSFromKeyboardHook) return;
    
    // Dispatch event whenever iOS keyboard visibility changes
    window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
      detail: isIOSKeyboardVisible 
    }));
    
    // Also sync the local state for any legacy consumers
    setIsKeyboardVisible(isIOSKeyboardVisible);
  }, [isIOSFromKeyboardHook, isIOSKeyboardVisible]);
  
  // Tap-to-dismiss keyboard handler for iOS (Bumble/Tinder pattern)
  // This dismisses the keyboard when the user taps outside of input fields
  // Use refs to access stable function references and avoid dependency issues
  const dismissKeyboardRef = useRef(fieldNavigation.dismissKeyboard);
  dismissKeyboardRef.current = fieldNavigation.dismissKeyboard;
  
  useEffect(() => {
    if (!isIOSFromKeyboardHook || !isIOSKeyboardVisible) return;

    const handleTapOutside = (e: Event) => {
      const target = e.target as HTMLElement;
      
      // Check if tapped element is an input, textarea, select, or button
      const isInteractiveElement = 
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'SELECT' ||
        target.closest('button') ||
        target.closest('[role="combobox"]') ||
        target.closest('[role="listbox"]') ||
        target.closest('.ios-input-accessory-toolbar') ||
        target.closest('.ios-bottom-sheet');
      
      if (!isInteractiveElement) {
        // Dismiss keyboard and blur active element
        dismissKeyboardRef.current();
        // Dispatch event to hide mobile nav overlay when keyboard dismisses
        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { detail: false }));
      }
    };

    // Use touchstart for better iOS responsiveness
    document.addEventListener('touchstart', handleTapOutside, { passive: true });
    
    return () => {
      document.removeEventListener('touchstart', handleTapOutside);
    };
  }, [isIOSFromKeyboardHook, isIOSKeyboardVisible, updateKeyboardVisibility]);

  // Use refs to store the stable function references to avoid effect re-runs
  const registerFieldRef = useRef(fieldNavigation.registerField);
  const clearAllFieldsRef = useRef(fieldNavigation.clearAllFields);
  registerFieldRef.current = fieldNavigation.registerField;
  clearAllFieldsRef.current = fieldNavigation.clearAllFields;
  
  // Track if we've registered fields for this tab session
  const hasRegisteredRef = useRef(false);
  const lastActiveTabRef = useRef<string | null>(null);
  
  // Auto-discover and register form fields for iOS keyboard navigation
  // This provides the Previous/Next navigation in the accessory toolbar
  useEffect(() => {
    // Reset registration flag when tab changes
    if (lastActiveTabRef.current !== activeTab) {
      lastActiveTabRef.current = activeTab;
      hasRegisteredRef.current = false;
      clearAllFieldsRef.current();
    }
    
    if (!isIOSFromKeyboardHook || activeTab !== 'edit') return;
    
    // Only register once per tab session
    if (hasRegisteredRef.current) return;

    // Wait for form to render
    const registerFields = () => {
      const formContainer = document.getElementById('profile-edit-form');
      if (!formContainer) return;

      // Find all focusable inputs in order
      const inputs = formContainer.querySelectorAll('input:not([type="hidden"]), textarea');
      
      inputs.forEach((input, index) => {
        const element = input as HTMLElement;
        const name = element.getAttribute('name') || `field-${index}`;
        
        // Try to find the label from FormLabel
        const formItem = element.closest('[class*="FormItem"]') || element.closest('.space-y-2')?.parentElement;
        let label = '';
        if (formItem) {
          const labelElement = formItem.querySelector('label');
          if (labelElement) {
            label = labelElement.textContent || '';
          }
        }
        
        registerFieldRef.current(name, element, { 
          label: label || name, 
          order: index,
          type: element.tagName === 'TEXTAREA' ? 'textarea' : 'input'
        });
      });

      hasRegisteredRef.current = true;
      console.log('[ProfilePage] Registered', inputs.length, 'fields for iOS keyboard navigation');
    };

    // Register after a short delay to ensure form is rendered
    const timer = setTimeout(registerFields, 100);
    
    return () => {
      clearTimeout(timer);
    };
  }, [isIOSFromKeyboardHook, activeTab]); // Minimal deps - use refs for stable function access
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearAllFieldsRef.current();
    };
  }, []);
  
  // Use a ref to track editing state to prevent automatic refreshes from overriding user input
  const isUserEditing = useRef<boolean>(false);
  
  // Track form initialization state
  const [isFormInitialized, setIsFormInitialized] = useState(false);
  
  // Create default form values safely for new users
  const defaultFormValues = useMemo(() => ({
    email: user?.email ?? '',
    fullName: user?.fullName ?? '',
    title: user?.title ?? '',
    currentLocation: user?.currentLocation ?? '',
    desiredLocations: user?.desiredLocations ?? [],
    industry: user?.industry ?? '',
    currentCompany: user?.currentCompany ?? '',
    yearsOfExperience: user?.yearsOfExperience ?? 0,
    bio: user?.bio ?? '',
    photo: user?.photo ?? '',
    resumeUrl: user?.resumeUrl ?? '',
    interests: user?.interests ?? [],
    professionalInterests: user?.professionalInterests ?? [],
    languages: user?.languages ?? [],
    institution: user?.institution ?? '',
    resumePreviewUrls: user?.resumePreviewUrls ?? [],
    desiredCompanies: user?.desiredCompanies ?? [],
    matchingRadius: user?.matchingRadius ?? 0,
  }), [user]);
  
  const form = useForm<ProfileFormData>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: defaultFormValues
  });
  
  // Reset form when user data changes (server-driven updates)
  // React Query cache is the source of truth - no need for separate originalValuesRef
  // PRODUCTION-GRADE: Uses shouldBlockFormReset() for robust race condition prevention
  useEffect(() => {
    // CRITICAL: Use the hook's shouldBlockFormReset method which checks multiple conditions
    // This prevents the form reset from reverting user's edits during save operations
    if (shouldBlockFormReset()) {
      console.log("[ProfilePage] 🛡️ Form reset BLOCKED by shouldBlockFormReset() - save in progress or recently completed");
      return;
    }
    
    // Additional check: skip if user is actively editing
    if (isUserEditing.current) {
      console.log("[ProfilePage] Skipping form reset - user is actively editing");
      return;
    }
    
    if (user) {
      form.reset(defaultFormValues);
      setIsFormInitialized(true);
      console.log("[ProfilePage] ✅ Form reset from server data (saveOperationVersion:", saveOperationVersion + ")");
    }
  }, [form, user, defaultFormValues, saveStatus, lastSaveTimestamp, saveOperationVersion, shouldBlockFormReset]);
  
  // Handle manual save from the save button in bottom nav
  // Uses flushPendingSave for immediate execution (no debounce delay)
  // Returns { success, savedData } so callers can use server response data
  const handleManualSave = useCallback(async (data: Partial<ProfileFormData>): Promise<{ success: boolean; savedData: User | null }> => {
    console.log("Manual save triggered from save button");
    console.log("Current tab:", currentProfileTab);
    console.log("Form data to save:", data);
    
    // Make sure we have valid data to save
    if (!data || Object.keys(data).length === 0) {
      console.warn("No data to save, skipping update");
      return { success: true, savedData: null };
    }
    
    // Ensure we don't send undefined values
    const cleanData = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined)
    );
    
    if (Object.keys(cleanData).length === 0) {
      console.warn("No valid data to save after cleaning, skipping update");
      return { success: true, savedData: null };
    }
    
    console.log("Calling flushPendingSave hook with clean data:", cleanData);
    // flushPendingSave executes immediately (no debounce) and returns a promise
    // The hook handles retries, optimistic updates, status, toasts, and lastSaveTimestamp
    const result = await flushPendingSave(cleanData);
    console.log("Save completed with result:", result);
    
    return result;
  }, [currentProfileTab, flushPendingSave]);
  
  // Effect to handle URL parameters and update tab state
  useEffect(() => {
    // Get the initial tab based on current URL parameters
    const initialTab = getTabFromUrl();
    console.log(`Setting tab state to ${initialTab} on mount or URL change`);
    
    // Update both our local state and the context state
    setActiveTab(initialTab);
    setCurrentProfileTab(initialTab);
    
    // Define saveProfileData property on window
    Object.defineProperty(window, 'saveProfileData', {
      value: () => {
        const formData = form.getValues();
        console.log("Global save function called with form data:", formData);
        handleManualSave(formData);
      },
      configurable: true
    });
    
    // Also expose the save status for the mobile nav to access
    Object.defineProperty(window, 'profileSaveStatus', {
      get: () => {
        return saveStatus;
      },
      configurable: true
    });
    
    // Explicitly dispatch a tab change event to ensure mobile-nav updates
    const tabChangeEvent = new CustomEvent('profile-tab-changed', { detail: initialTab });
    window.dispatchEvent(tabChangeEvent);
    
    // Log the current tab state
    console.log("Profile page mounted. Current tab state:", currentProfileTab);
    
    return () => {
      // Remove properties from window
      if ('saveProfileData' in window) {
        delete window.saveProfileData;
      }
      if ('profileSaveStatus' in window) {
        delete window.profileSaveStatus;
      }
      
      // Reset to default tab state when unmounting
      setCurrentProfileTab('edit');
      
      // Dispatch a final tab change event to ensure all components are in a consistent state
      const tabChangeEvent = new CustomEvent('profile-tab-changed', { detail: 'edit' });
      window.dispatchEvent(tabChangeEvent);
      
      console.log("Profile page unmounting, setting default tab state to 'edit'");
    };
  }, [form, handleManualSave, saveStatus, location, setCurrentProfileTab, currentProfileTab]);


  // Sync showCropper state with context and dispatch events for mobile-nav
  useEffect(() => {
    // Update context state when showCropper changes
    setProfileCropperActive(showCropper);
    
    // Dispatch event for mobile-nav to listen to
    const cropperStatusEvent = new CustomEvent('profile-cropper-status-change', { 
      detail: showCropper 
    });
    window.dispatchEvent(cropperStatusEvent);
    
    console.log('[ProfilePage] Cropper status changed:', showCropper);
  }, [showCropper, setProfileCropperActive]);

  // Watch all form values for change detection using deep equality
  const watchedValues = useWatch({ control: form.control });
  
  // Detect unsaved changes using the hook's comparison (uses React Query cache as source of truth)
  // This is purely for UI state (toolbar visibility) - no automatic saves
  const hasUnsavedChanges = useMemo(() => {
    if (!isFormInitialized) {
      console.log("[ProfilePage] hasUnsavedChanges: form not initialized, returning false");
      return false;
    }
    
    // iOS NATIVE ONLY: Exclude fields that are saved through separate processes (photo upload, resume upload)
    // These fields should not trigger the main save toolbar on iOS native
    // Web versions (desktop/mobile) keep the original behavior
    let valuesToCheck = watchedValues as Partial<Omit<User, 'id' | 'password'>>;
    
    if (isNativeIOSApp) {
      // Create a copy without photo-related and resume-related fields for iOS native
      const editableFields = { ...(valuesToCheck as Record<string, unknown>) };
      delete editableFields.photo;
      delete editableFields.resumeUrl;
      delete editableFields.resumePreviewUrls;
      valuesToCheck = editableFields as Partial<Omit<User, 'id' | 'password'>>;
      console.log("[ProfilePage] iOS native: excluding photo/resume fields from change detection");
    }
    
    const result = hookHasUnsavedChanges(valuesToCheck);
    console.log("[ProfilePage] hasUnsavedChanges computed:", result, isNativeIOSApp ? "(iOS native mode)" : "");
    return result;
  }, [watchedValues, isFormInitialized, hookHasUnsavedChanges, isNativeIOSApp]);
  
  // Warn user about unsaved changes before leaving the page
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges || saveStatus === 'saving' || saveStatus === 'pending') {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };
    
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges, saveStatus]);
  
  // Handle cancel - reset form to the cached server values (React Query cache is source of truth)
  const handleCancel = useCallback(() => {
    console.log("Cancel button pressed, resetting form to cached server values");
    
    // Cancel any pending or in-flight save operations and rollback optimistic updates
    cancelPendingSave();
    
    // Get the cached user data from React Query (single source of truth)
    const cachedUser = getCachedUser();
    const valuesToRestore = cachedUser ? {
      email: cachedUser.email ?? '',
      fullName: cachedUser.fullName ?? '',
      title: cachedUser.title ?? '',
      currentLocation: cachedUser.currentLocation ?? '',
      desiredLocations: cachedUser.desiredLocations ?? [],
      industry: cachedUser.industry ?? '',
      currentCompany: cachedUser.currentCompany ?? '',
      yearsOfExperience: cachedUser.yearsOfExperience ?? 0,
      bio: cachedUser.bio ?? '',
      photo: cachedUser.photo ?? '',
      resumeUrl: cachedUser.resumeUrl ?? '',
      interests: cachedUser.interests ?? [],
      professionalInterests: cachedUser.professionalInterests ?? [],
      languages: cachedUser.languages ?? [],
      institution: cachedUser.institution ?? '',
      resumePreviewUrls: cachedUser.resumePreviewUrls ?? [],
      desiredCompanies: cachedUser.desiredCompanies ?? [],
      matchingRadius: cachedUser.matchingRadius ?? 0,
    } as ProfileFormData : defaultFormValues;
    
    form.reset(valuesToRestore);
    console.log("Form reset to cached values");
    
    // Hide keyboard and dispatch event
    updateKeyboardVisibility(false, false);
    
    // Blur any focused element
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    
    toast({
      title: "Changes discarded",
      description: "Your changes have been cancelled.",
      duration: 2000,
    });
  }, [form, defaultFormValues, toast, updateKeyboardVisibility, cancelPendingSave, getCachedUser]);
  
  // Handle save - save form data, React Query cache is updated by the hook
  // Only resets form state AFTER save succeeds to prevent data loss
  const handleSaveFromToolbar = useCallback(async () => {
    const formData = form.getValues();
    console.log("[ProfilePage] handleSaveFromToolbar called");
    console.log("[ProfilePage] formData keys:", Object.keys(formData));
    console.log("[ProfilePage] formData values:", JSON.stringify(formData, null, 2));
    
    // IMPORTANT: Keep isUserEditing.current = true during save to prevent
    // the form reset effect from reverting changes while save is in progress
    // We'll clear it in finally block so it clears whether save succeeds or fails
    
    try {
      // handleManualSave returns { success, savedData } with server response
      // The hook automatically updates React Query cache with server response
      const result = await handleManualSave(formData);
      console.log("[ProfilePage] handleManualSave result:", result);
      
      if (result.success) {
        // Note: lastSaveTimestamp is now managed by useProfileSave hook
        // It's automatically set on every successful save to prevent form reset race conditions
        
        // Get the updated cached user data (hook already updated the cache)
        const cachedUser = getCachedUser();
        if (cachedUser) {
          // Reset form to cached server data for full consistency
          const normalizedServerData = {
            email: cachedUser.email ?? '',
            fullName: cachedUser.fullName ?? '',
            title: cachedUser.title ?? '',
            currentLocation: cachedUser.currentLocation ?? '',
            desiredLocations: cachedUser.desiredLocations ?? [],
            industry: cachedUser.industry ?? '',
            currentCompany: cachedUser.currentCompany ?? '',
            yearsOfExperience: cachedUser.yearsOfExperience ?? 0,
            bio: cachedUser.bio ?? '',
            photo: cachedUser.photo ?? '',
            resumeUrl: cachedUser.resumeUrl ?? '',
            interests: cachedUser.interests ?? [],
            professionalInterests: cachedUser.professionalInterests ?? [],
            languages: cachedUser.languages ?? [],
            institution: cachedUser.institution ?? '',
            resumePreviewUrls: cachedUser.resumePreviewUrls ?? [],
            desiredCompanies: cachedUser.desiredCompanies ?? [],
            matchingRadius: cachedUser.matchingRadius ?? 0,
          } as ProfileFormData;
          form.reset(normalizedServerData);
          console.log("[ProfilePage] Save successful - form reset from cache");
        }
        
        // Hide keyboard
        updateKeyboardVisibility(false, false);
        
        // Blur any focused element  
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
      } else {
        // Save failed - keep form state as-is so user can retry
        // Error toast is already shown by the hook
        console.log("[ProfilePage] Save failed - form state preserved, user can retry");
      }
    } finally {
      // Always clear the editing flag after save completes (success or failure)
      // This ensures future server-driven updates can refresh the form
      isUserEditing.current = false;
      console.log("[ProfilePage] Cleared isUserEditing flag in finally block");
    }
  }, [form, handleManualSave, updateKeyboardVisibility, getCachedUser]);

  // Set up event handlers to track when fields are being edited
  useEffect(() => {
    // Track when any field gets focus (user starts editing)
    const handleFieldFocus = () => {
      console.log("Field focused - user is actively editing");
      isUserEditing.current = true;
    };

    // Track when any field loses focus (user may have finished editing)
    const handleFieldBlur = () => {
      console.log("Field blurred - user may have stopped editing");
      // Short delay before we consider editing complete, in case they're moving between fields
      setTimeout(() => {
        if (!document.activeElement || 
            !document.activeElement.tagName || 
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          console.log("No form fields focused - user has stopped editing");
          isUserEditing.current = false;
        }
      }, 200);
    };

    // Add listeners to the form container
    const formElement = document.getElementById('profile-edit-form');
    if (formElement) {
      formElement.addEventListener('focusin', handleFieldFocus);
      formElement.addEventListener('focusout', handleFieldBlur);
      
      // Clean up listeners
      return () => {
        formElement.removeEventListener('focusin', handleFieldFocus);
        formElement.removeEventListener('focusout', handleFieldBlur);
      };
    }
  }, []);

  // Effect to handle keyboard visibility and navigation bar
  // Note: We've also added cursor positioning logic to Input, Textarea, and LocationInput components
  // This ensures the cursor appears at the end of text when a field receives focus
  // 
  // PROFESSIONAL iOS KEYBOARD HANDLING (Bumble/Tinder pattern):
  // On native iOS, we use the useIOSKeyboardPro hook which handles auto-scrolling in keyboardDidShow.
  // This provides smooth, professional scroll behavior that waits for keyboard animation to complete.
  // On web/mobile web, we use scrollIntoView as a fallback.
  useEffect(() => {
    const handleFocus = (e: FocusEvent) => {
      console.log("Input focused:", e.target);
      
      // Set the user editing flag to true
      isUserEditing.current = true;
      
      // Check if this is a Select element
      const target = e.target as HTMLElement;
      const isSelectElement = target.closest('.select-container') !== null || 
                             target.tagName === 'SELECT' ||
                             target.getAttribute('role') === 'combobox';
      
      // PROFESSIONAL iOS KEYBOARD HANDLING:
      // On native iOS Capacitor, the useIOSKeyboardPro hook handles scrolling automatically
      // in the keyboardDidShow event, which fires AFTER the keyboard animation completes.
      // This provides smooth, professional scroll behavior like Bumble/Tinder.
      // We skip manual scrollIntoView on native iOS to avoid conflicting scroll operations.
      if (!isIOSFromKeyboardHook) {
        // Fallback for web/mobile web: use scrollIntoView
        setTimeout(() => {
          if (target && target.scrollIntoView) {
            target.scrollIntoView({ 
              behavior: 'smooth', 
              block: 'center',
              inline: 'nearest'
            });
          }
        }, 100);
      }
      // On native iOS, useIOSKeyboardPro handles the scroll automatically via keyboardDidShow
      
      // ONLY set keyboard visibility on mobile/native platforms
      // On desktop, there's no on-screen keyboard, so we should NOT trigger this
      // The toolbar on desktop should ONLY show when hasUnsavedChanges is true
      if (deviceType === 'mobile') {
        // For text inputs (open-ended), hide nav bar. For selects, keep it visible
        updateKeyboardVisibility(true, isSelectElement);
        console.log("Input focused on mobile, isSelectElement:", isSelectElement, isSelectElement ? "(nav bar will stay visible)" : "(nav bar will hide)");
      } else {
        console.log("Input focused on desktop - skipping keyboard visibility (no on-screen keyboard)");
      }
    };

    const handleBlur = () => {
      // Use setTimeout to check if focus moved to another input element
      setTimeout(() => {
        if (!document.activeElement || 
            !document.activeElement.tagName || 
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          
          console.log("All inputs blurred, showing navigation bar");
          
          // Hide keyboard and show navigation bar when no inputs are focused
          updateKeyboardVisibility(false, false);
          
          // Only clear editing state if no form element is focused
          setTimeout(() => {
            if (!document.activeElement || 
                !document.activeElement.tagName || 
                !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
              isUserEditing.current = false;
            }
          }, 500);
        }
      }, 100);
    };

    // Add event delegation to the form container itself instead of individual inputs
    const formElement = document.getElementById('profile-edit-form');
    if (formElement) {
      formElement.addEventListener('focusin', handleFocus);
      formElement.addEventListener('focusout', handleBlur);
      
      return () => {
        formElement.removeEventListener('focusin', handleFocus);
        formElement.removeEventListener('focusout', handleBlur);
      };
    }
  }, [deviceType, isIOSFromKeyboardHook, updateKeyboardVisibility]);

  // Effect to handle page navigation and data synchronization
  useEffect(() => {
    // On component mount, refresh user data to ensure we have the latest
    refreshUserData();
    
    // Handler for the custom event when user data is refreshed elsewhere
    const handleUserDataRefreshed = (event: Event) => {
      console.log("User data refreshed event detected, checking for changes", event);
      
      // Skip refresh while save is in progress to prevent race condition
      // that reverts user edits before the save completes
      if (saveStatus === 'saving' || saveStatus === 'retrying') {
        console.log("[ProfilePage] Skipping event refresh during save operation");
        return;
      }
      
      // Don't automatically refresh data while editing
      if (isUserEditing.current) {
        console.log("User is actively editing, blocking automatic data refresh");
        return;
      }
      
      // Additional protection: don't refresh if any form field has been modified
      const formState = form.formState;
      if (formState.isDirty) {
        console.log("Form has unsaved changes, blocking automatic data refresh");
        return;
      }
      
      const userData = (event as CustomEvent<Partial<ProfileFormData>>).detail;
      if (!userData || !form) return;
      
      console.log("Applying refreshed user data to form");
      
      // Get the currently focused element
      const activeElement = document.activeElement;
      const activeFieldName = activeElement?.id || null;
      
      // Update form with latest values from refreshed data
      // React Query cache is already updated - we just need to sync form fields
      Object.entries(userData).forEach(([key, value]) => {
        // Skip the field that is currently focused/being edited
        if (activeFieldName && activeFieldName.includes(key)) {
          console.log(`Skipping refresh for field ${key} as it's currently being edited`);
          return;
        }
        
        if (key in form.getValues()) {
          const fieldName = key as keyof ProfileFormData;
          const currentValue = form.getValues(fieldName);
          if (JSON.stringify(currentValue) !== JSON.stringify(value)) {
            console.log(`Updating field ${key} with new value from refresh`);
            form.setValue(fieldName, value);
          }
        }
      });
      
      console.log("[ProfilePage] Server data refresh complete");
    };
    
    window.addEventListener('user-data-refreshed', handleUserDataRefreshed);
    
    return () => {
      window.removeEventListener('user-data-refreshed', handleUserDataRefreshed);
    };
  }, [refreshUserData, form, saveStatus]);

  const handleRemoveLocation = (index: number) => {
    // Get current locations and make a proper copy
    const newLocations = [...(form.getValues('desiredLocations') || [])];
    // Remove the location at the specified index
    newLocations.splice(index, 1);
    // Update form value - user will need to click Save to persist
    form.setValue('desiredLocations', newLocations, { shouldDirty: true });
    
    // Ensure UI elements remain visible by dispatching a single event
    window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
      detail: false 
    }));
  };

  // Using UserAvatar component instead of generating SVG directly
  // Photo upload/delete is now handled through the unified useProfileSave hook (uploadPhoto, deletePhoto methods)

  const resumeField = (
    <FormField
      control={form.control}
      name="resumeUrl"
      render={({ field }) => (
        <FormItem>
          <FormLabel className="text-sm font-medium">Resume</FormLabel>
          <FormControl>
            <div className="space-y-2">
              <Input
                type="file"
                accept=".pdf,.doc,.docx"
                aria-label="Upload resume"
                className="h-10 bg-white dark:bg-slate-900 border"
                disabled={isSaving}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const result = await uploadResume(file);
                    if (result.success && result.savedData) {
                      form.setValue('resumeUrl', result.savedData.resumeUrl || '');
                      form.setValue('resumePreviewUrls', result.savedData.resumePreviewUrls || []);
                    }
                  }
                }}
              />
              {field.value && (
                <div className="flex flex-col gap-2 p-2 bg-gray-50 rounded-md">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[hsl(215,25%,27%)]" />
                    <span className="text-sm text-[hsl(215,25%,27%)] truncate">
                      Resume uploaded
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="ml-auto hover:bg-destructive hover:text-destructive-foreground"
                      disabled={isSaving}
                      onClick={async () => {
                        const result = await deleteResume();
                        if (result.success) {
                          form.setValue('resumeUrl', '');
                          form.setValue('resumePreviewUrls', []);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Remove resume</span>
                    </Button>
                  </div>
                  {form && Array.isArray(form.watch('resumePreviewUrls')) && form.watch('resumePreviewUrls')?.map((previewUrl, index) => (
                    <div key={index} className="rounded-md overflow-hidden border border-gray-200">
                      <img
                        src={previewUrl}
                        alt={`Resume page ${index + 1}`}
                        className="w-full h-auto"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </FormControl>
          <FormMessage className="text-xs" />
        </FormItem>
      )}
    />
  );

  // Resume upload/delete is now handled through the unified useProfileSave hook (uploadResume method)

  // Error handling for the profile page
  if (isLoading || !user || !isFormInitialized) {
    return (
      <ProtectedLayout>
        <div className="container mx-auto px-4 flex items-center justify-center h-screen">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
            <p className="text-muted-foreground">Loading your profile...</p>
          </div>
        </div>
      </ProtectedLayout>
    );
  }

  try {
    return (
      <ProtectedLayout>
        <div className={`container mx-auto px-4 bg-background relative flex flex-col ${deviceType === 'desktop' ? 'pt-16' : 'pt-10'}`}>
        {/* Settings button positioned below the header */}
        <div className={`absolute right-0 z-10 mr-4 ${deviceType === 'desktop' ? 'top-[4.5rem]' : 'top-2'}`}>
          <Button
            size="icon"
            className="h-12 rounded-none p-0 hover:bg-transparent bg-transparent"
            asChild
          >
            <Link href="/settings">
              <Settings className="h-5 w-5" style={{ color: 'hsl(215, 25%, 27%)' }} />
              <span className="sr-only">Settings</span>
            </Link>
          </Button>
        </div>

        <div className="max-w-2xl mx-auto w-full flex flex-col pb-4">
          {/* Profile header section - mt-[60px] creates gap below settings button */}
          <div className="flex flex-col items-center relative mt-[60px]">
            <div className="text-center">
              <div 
                ref={photoContainerRef}
                role="button"
                tabIndex={0}
                aria-label="Change profile photo"
                className="relative w-24 h-24 mx-auto mb-3 group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
                onClick={() => setShowPhotoButtons(!showPhotoButtons)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setShowPhotoButtons(!showPhotoButtons);
                  }
                }}
              >
                <UserAvatar 
                  key={`avatar-${avatarRefreshKey}`}
                  user={{
                    ...user,
                    photo: form.watch('photo') || user.photo,
                    fullName: form.watch('fullName') || user.fullName
                  }}
                  className="w-24 h-24 rounded-full border-2 border-muted"
                  fallbackClassName="text-xl font-medium bg-primary text-white"
                />
                <div className={`absolute inset-0 flex items-center justify-center gap-2 bg-black/60 rounded-full transition-opacity ${showPhotoButtons ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                  <label
                    htmlFor="photo-upload"
                    className={cn(
                      "p-1.5 bg-primary text-primary-foreground rounded-full cursor-pointer hover:bg-primary/90 transition-colors",
                      isSaving && "pointer-events-none opacity-50"
                    )}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Camera className="h-4 w-4" />
                    <span className="sr-only">Upload new picture</span>
                  </label>
                  {form.watch('photo') && (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon"
                      className="h-8 w-8"
                      disabled={isSaving}
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (window.confirm('Are you sure you want to delete your profile picture?')) {
                          const result = await deletePhoto();
                          if (result.success) {
                            form.setValue('photo', '', { shouldDirty: true, shouldTouch: true, shouldValidate: true });
                            form.trigger('photo');
                            form.trigger('fullName');
                            setAvatarRefreshKey(prev => prev + 1);
                          }
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="sr-only">Delete picture</span>
                    </Button>
                  )}
                </div>
                <input
                  id="photo-upload"
                  type="file"
                  accept="image/*"
                  aria-label="Upload profile picture"
                  className="hidden"
                  disabled={isSaving}
                  onChange={(e) => {
                    try {
                      const file = e.target.files?.[0];
                      if (!file) {
                        console.log("No file selected");
                        return;
                      }
                      
                      console.log("Selected file:", {
                        name: file.name,
                        type: file.type,
                        size: file.size
                      });

                      if (!file.type.startsWith('image/')) {
                        console.error("Invalid file type:", file.type);
                        toast({
                          title: "Invalid file type",
                          description: "Please select an image file (JPG, PNG, etc.)",
                          variant: "destructive",
                        });
                        // Reset the input value
                        e.target.value = '';
                        return;
                      }
                      
                      if (file.size > 25 * 1024 * 1024) {
                        console.error("File too large:", file.size);
                        toast({
                          title: "File too large",
                          description: "Please select an image smaller than 25MB",
                          variant: "destructive",
                        });
                        // Reset the input value
                        e.target.value = '';
                        return;
                      }
                      
                      // Create temp URL for the cropper
                      const tempUrl = URL.createObjectURL(file);
                      console.log("Created temp URL for cropping:", tempUrl);
                      setTempPhotoUrl(tempUrl);
                      setShowCropper(true);
                      
                      // Reset the input value so the same file can be selected again if needed
                      e.target.value = '';
                    } catch (error) {
                      console.error("Error handling photo upload:", error);
                      toast({
                        title: "Upload error",
                        description: "There was an error processing your photo. Please try again.",
                        variant: "destructive",
                      });
                      // Reset the input value
                      if (e.target) {
                        e.target.value = '';
                      }
                    }
                  }}
                />
              </div>
              <h1 className="text-xl font-bold mb-1">{form.watch('fullName')}</h1>
              {form.watch('currentCompany') && (
                <p className="text-muted-foreground text-sm mb-1">{form.watch('currentCompany')}</p>
              )}
              <p className="text-muted-foreground text-sm">{form.watch('title')}</p>
            </div>
          </div>


          <Tabs 
            defaultValue="edit" 
            value={activeTab}
            className="w-full"
            onValueChange={(value) => {
              // Update our local state
              setActiveTab(value);
              
              // Update context state for mobile-nav to access
              console.log("Tab changed to:", value);
              setCurrentProfileTab(value as 'edit' | 'preview');
              
              // Update the URL to include the tab parameter without causing a full navigation
              const url = new URL(window.location.href);
              url.searchParams.set('tab', value);
              // Use history API to update URL without reload
              window.history.replaceState({}, '', url.toString());
              
              // Dispatch a custom event for any listeners
              const tabChangeEvent = new CustomEvent('profile-tab-changed', { detail: value });
              window.dispatchEvent(tabChangeEvent);
            }}
          >
            <div className="relative">
              <TabsList className="grid w-full grid-cols-2 mb-4 sticky top-14 bg-background z-10">
                <TabsTrigger value="edit" className="gap-1.5 py-2 text-sm">
                  <PencilIcon className="h-3.5 w-3.5" />
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="gap-1.5 py-2 text-sm">
                  <EyeIcon className="h-3.5 w-3.5" />
                  Preview
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="edit">
              <IOSKeyboardAwareScrollView
                enabled={isIOSFromKeyboardHook}
                className="profile-form-container"
                paddingBottom={160}
              >
                <div id="profile-edit-form" className="p-6 pb-24 md:pb-20">
                  <Form {...form}>
                    <div className="space-y-6">
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold" style={{ color: 'hsl(215, 25%, 27%)' }}>Professional Information</h3>

                      {/* Job Title */}
                      <FormField
                        control={form.control}
                        name="title"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Job Title</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                className="h-10 bg-white dark:bg-slate-900 border"
                                disabled={isSaving}
                                data-keyboard-type="text"
                                onBlur={(e) => {
                                  field.onBlur();
                                  // Only apply capitalization if there's a value, otherwise preserve empty string
                                  const normalizedValue = e.target.value ? capitalizeFirstLetter(e.target.value) : '';
                                  // iOS NATIVE FIX: Only call onChange if value actually changed to prevent false dirty state
                                  if (!isNativeIOSApp || normalizedValue !== field.value) {
                                    field.onChange(normalizedValue);
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Current Employer */}
                      <FormField
                        control={form.control}
                        name="currentCompany"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Current Employer</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ''}
                                placeholder="Enter your current employer"
                                className="h-10 bg-white dark:bg-slate-900 border"
                                disabled={isSaving}
                                data-keyboard-type="text"
                                onBlur={(e) => {
                                  field.onBlur();
                                  // Only apply title case if there's a value, otherwise preserve empty string
                                  const normalizedValue = e.target.value ? toTitleCase(e.target.value) : '';
                                  // iOS NATIVE FIX: Only call onChange if value actually changed to prevent false dirty state
                                  if (!isNativeIOSApp || normalizedValue !== field.value) {
                                    field.onChange(normalizedValue);
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Current Location */}
                      <FormField
                        control={form.control}
                        name="currentLocation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Current Location</FormLabel>
                            <FormControl>
                              <HybridLocationInput
                                value={field.value || ''}
                                onChange={field.onChange}
                                placeholder="Search for a city..."
                                disabled={isSaving}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Industry */}
                      <FormField
                        control={form.control}
                        name="industry"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Industry</FormLabel>
                            <IOSSelectWrapper
                              value={field.value || ''}
                              onValueChange={(value) => {
                                updateKeyboardVisibility(false, true);
                                field.onChange(value);
                              }}
                              options={industries.map(ind => ({ value: ind, label: ind }))}
                              placeholder="Select industry"
                              disabled={isSaving}
                              title="Select Industry"
                              triggerClassName="h-10 bg-white dark:bg-slate-900 border capitalize"
                            >
                              <Select
                                onValueChange={(value) => {
                                  updateKeyboardVisibility(false, true);
                                  field.onChange(value);
                                }}
                                defaultValue={field.value || undefined}
                                disabled={isSaving}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-10 bg-white dark:bg-slate-900 border capitalize">
                                    <SelectValue placeholder="Select industry" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {industries.map((industry) => (
                                    <SelectItem key={industry} value={industry}>
                                      {industry}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </IOSSelectWrapper>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Years of Experience */}
                      <FormField
                        control={form.control}
                        name="yearsOfExperience"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Years of Experience</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                className="h-10 bg-white dark:bg-slate-900 border capitalize"
                                {...field}
                                disabled={isSaving}
                                data-keyboard-type="number"
                                onChange={(e) => {
                                  const value = Math.max(0, parseInt(e.target.value) || 0);
                                  field.onChange(value);
                                }}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Add Education fields after the Years of Experience field */}

                      {/* Education Level */}
                      <FormField
                        control={form.control}
                        name="educationLevel"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Education Level</FormLabel>
                            <IOSSelectWrapper
                              value={field.value || ''}
                              onValueChange={(value) => {
                                updateKeyboardVisibility(false, true);
                                field.onChange(value);
                              }}
                              options={educationLevels.map(level => ({ value: level, label: level }))}
                              placeholder="Select education level"
                              disabled={isSaving}
                              title="Select Education Level"
                              triggerClassName="h-10 bg-white dark:bg-slate-900 border"
                            >
                              <Select
                                onValueChange={(value) => {
                                  updateKeyboardVisibility(false, true);
                                  field.onChange(value);
                                }}
                                value={field.value || ""}
                                disabled={isSaving}
                              >
                                <FormControl>
                                  <SelectTrigger className="h-10 bg-white dark:bg-slate-900 border">
                                    <SelectValue placeholder="Select education level" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {educationLevels.map((level) => (
                                    <SelectItem key={level} value={level}>
                                      {level}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </IOSSelectWrapper>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Educational Institution */}
                      <FormField
                        control={form.control}
                        name="institution"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Educational Institution</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                placeholder="Enter your educational institution"
                                className="h-10 bg-white dark:bg-slate-900 border"
                                value={typeof field.value === 'string' ? field.value : ''}
                                disabled={isSaving}
                                data-keyboard-type="text"
                                onBlur={(e) => {
                                  field.onBlur();
                                  // Only apply capitalization if there's a value, otherwise preserve empty string
                                  const normalizedValue = e.target.value ? capitalizeWords(e.target.value) : '';
                                  // iOS NATIVE FIX: Only call onChange if value actually changed to prevent false dirty state
                                  if (!isNativeIOSApp || normalizedValue !== field.value) {
                                    field.onChange(normalizedValue);
                                  }
                                }}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />


                      {/* About Me Section */}
                      <h3 className="text-lg font-semibold mt-8" style={{ color: 'hsl(215, 25%, 27%)' }}>About Me</h3>
                      
                      {/* Bio */}
                      <FormField
                        control={form.control}
                        name="bio"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Bio</FormLabel>
                            <FormControl>
                              <div className="bg-white dark:bg-slate-900 rounded-md">
                                <BioEditor
                                  value={field.value || ''}
                                  onChange={field.onChange}
                                  disabled={isSaving}
                                  aria-label="Bio"
                                />
                              </div>
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Professional Interests */}
                      <FormField
                        control={form.control}
                        name="professionalInterests"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Professional Interests</FormLabel>
                            <FormControl>
                              <SearchableInterestSelect
                                options={professionalInterests}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Search professional interests..."
                                className="w-full"
                                badgeVariant="secondary"
                                disabled={isSaving}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Hobbies */}
                      <FormField
                        control={form.control}
                        name="interests"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Hobbies</FormLabel>
                            <FormControl>
                              <SearchableInterestSelect
                                options={hobbyInterests}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Search hobbies..."
                                className="w-full"
                                badgeVariant="secondary"
                                disabled={isSaving}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Languages */}
                      <FormField
                        control={form.control}
                        name="languages"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Languages</FormLabel>
                            <FormControl>
                              <SearchableInterestSelect
                                options={languages}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Select languages you speak..."
                                className="w-full"
                                badgeVariant="secondary"
                                disabled={isSaving}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* AI Matching Preferences Section */}
                      <h3 className="text-lg font-semibold mt-8" style={{ color: 'hsl(215, 25%, 27%)' }}>AI Matching Preferences</h3>
                      
                      {/* Companies of Interest */}
                      <FormField
                        control={form.control}
                        name="desiredCompanies"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Companies of Interest</FormLabel>
                            <FormControl>
                              <SearchableInterestSelect
                                options={[]}
                                selected={field.value || []}
                                onChange={field.onChange}
                                placeholder="Enter companies you're interested in..."
                                className="w-full"
                                allowCustom={true}
                                badgeVariant="secondary"
                                applyTitleCase={true}
                                disabled={isSaving}
                              />
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Relocation Destinations */}
                      <FormField
                        control={form.control}
                        name="desiredLocations"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-sm font-medium">Locations of Interest</FormLabel>
                            <FormControl>
                              <div className="space-y-2">
                                <HybridLocationInput
                                  value={newLocation}
                                  onChange={(location) => {
                                    if (location && location.trim()) {
                                      const currentLocations = form.getValues('desiredLocations') || [];
                                      // Check if location already exists (case-insensitive check)
                                      const locationExists = currentLocations.some(
                                        loc => loc.toLowerCase() === location.toLowerCase()
                                      );
                                      
                                      if (!locationExists) {
                                        // Add the new location to the array
                                        const updatedLocations = [...currentLocations, location];
                                        // Update form value (this will trigger auto-save via the form watcher)
                                        form.setValue('desiredLocations', updatedLocations);
                                        // Reset input field
                                        setNewLocation('');
                                        
                                        // Ensure UI elements remain visible with a single event
                                        window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { 
                                          detail: false 
                                        }));
                                      } else {
                                        // Just clear the input if location already exists
                                        setNewLocation('');
                                      }
                                    }
                                  }}
                                  placeholder="Search for a city..."
                                  disabled={isSaving}
                                />
                                <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-md min-h-[2.5rem]">
                                  {Array.isArray(field.value) && field.value.map((location, index) => (
                                    <Badge
                                      key={index}
                                      variant="secondary"
                                      className="flex items-center gap-1"
                                    >
                                      <MapPin className="w-3 h-3" />
                                      {location}
                                      <button
                                        type="button"
                                        className={cn(
                                          "ml-1 hover:bg-muted rounded-full p-0.5",
                                          isSaving && "pointer-events-none opacity-50"
                                        )}
                                        disabled={isSaving}
                                        onClick={() => handleRemoveLocation(index)}
                                      >
                                        <X className="w-3 h-3" />
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                            </FormControl>
                            <FormMessage className="text-xs" />
                          </FormItem>
                        )}
                      />

                      {/* Matching Radius */}
                      <FormField
                        control={form.control}
                        name="matchingRadius"
                        render={({ field }) => (
                          <FormItem className="space-y-4">
                            <FormLabel className="text-[hsl(215,25%,27%)]">
                              Matching Radius: {field.value ?? 0} miles
                            </FormLabel>
                            <FormDescription className="text-xs">
                              How far from your target cities are you willing to live
                            </FormDescription>
                            <FormControl>
                              <Slider
                                min={0}
                                max={100}
                                step={5}
                                value={[field.value ?? 0]}
                                onValueChange={(value) => {
                                  // Update the form value immediately for visual feedback
                                  form.setValue("matchingRadius", value[0], { shouldValidate: false, shouldDirty: false });
                                }}
                                onValueCommit={(value) => field.onChange(value[0])}
                                className="w-full"
                                disabled={isSaving}
                              />
                            </FormControl>
                            <div className="flex justify-between text-xs text-gray-500">
                              <span>0 miles</span>
                              <span>100 miles</span>
                            </div>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {/* Files Section */}
                      <h3 className="text-lg font-semibold mt-8" style={{ color: 'hsl(215, 25%, 27%)' }}>Files</h3>
                      
                      {/* Resume */}
                      {resumeField}
                    </div>
                  </div>
                  </Form>
                </div>
              </IOSKeyboardAwareScrollView>
            </TabsContent>

            <TabsContent
              value="preview"
              className="relative -mx-4 px-4 py-6 pb-24 sm:-mx-8 sm:px-8 sm:pb-16 transition-colors duration-300 ease-in-out"
            >
              <div className="w-[90%] max-w-md sm:max-w-lg md:max-w-xl overflow-hidden rounded-lg bg-background border-0 shadow-[0_1px_3px_0_rgba(0,0,0,0.1),0_0_20px_-2px_hsl(215,20%,65%),0_0_30px_-5px_hsl(215,20%,65%)] transition-shadow mx-auto">
                {/* Profile Hero Section with full-screen image - matches profile popup */}
                <div className="relative w-full h-[40vh] min-h-[320px] max-h-[550px] desktop-profile-hero bg-black overflow-hidden">
                  {/* Profile Image Background or Initials Background */}
                  {/* Check for valid photo (not placeholder) */}
                  {form.watch('photo') && 
                   !form.watch('photo').includes('placeholder') && 
                   form.watch('photo') !== '/placeholder.jpg' ? (
                    <div className="w-full h-full overflow-hidden relative" style={{ minHeight: "100%" }}>
                      <img
                        src={form.watch('photo')}
                        alt={form.watch('fullName')}
                        className="w-full h-full object-cover"
                        style={{ objectPosition: "center 20%" }}
                      />
                      {/* Gradient overlay that fades to 0% opacity at the 1/4 point */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/25 to-transparent" 
                           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 25%)' }}></div>
                    </div>
                  ) : (
                    <div className="w-full h-full bg-primary flex items-center justify-center relative">
                      <span className="text-white text-9xl font-bold">
                        {getInitials(form.watch('fullName') || '')}
                      </span>
                      {/* Gradient overlay that fades from 70% at bottom to 0% at top */}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" 
                           style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0) 100%)' }}></div>
                    </div>
                  )}
                  
                  {/* Name and Position - Overlay at bottom of image */}
                  <div className="absolute bottom-4 left-0 right-0 px-6 text-white">
                    <h2 className="text-xl font-bold">{form.watch('fullName')}</h2>
                    <p className="text-sm opacity-90">{form.watch('title') || ""}</p>
                  </div>
                </div>
                
                <div className="overflow-y-auto scrollbar-hide p-6">
                  <div className="space-y-6">
                    {/* Location, Company, and Industry Section */}
                    <div className="flex flex-col gap-2 bg-muted/10 rounded-lg p-3">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {form.watch('currentLocation') || "Location not specified"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {form.watch('currentCompany') || "Company not specified"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Briefcase className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">
                          {form.watch('industry') ? `${form.watch('industry')} - ${form.watch('yearsOfExperience')} years` : "Industry not specified"}
                        </span>
                      </div>
                    </div>

                    {/* Education Section */}
                    {(form.watch('institution') || form.watch('educationLevel')) && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">Education</h3>
                        <div className="text-sm text-muted-foreground">
                          {form.watch('institution') && form.watch('educationLevel') ? (
                            <p>{form.watch('institution')} - {form.watch('educationLevel')}</p>
                          ) : form.watch('institution') ? (
                            <p>{form.watch('institution')}</p>
                          ) : form.watch('educationLevel') ? (
                            <p>{form.watch('educationLevel')}</p>
                          ) : null}
                        </div>
                      </div>
                    )}

                    {/* About Me Section */}
                    {form.watch('bio') && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">About Me</h3>
                        <div className="prose prose-sm max-w-none text-muted-foreground whitespace-pre-wrap">
                          <ReactMarkdown
                            allowedElements={['p', 'strong', 'em', 'ul', 'ol', 'li']}
                            unwrapDisallowed
                          >
                            {form.watch('bio')}
                          </ReactMarkdown>
                        </div>
                      </div>
                    )}

                    {/* Professional Interests Section */}
                    {Array.isArray(form.watch('professionalInterests')) && form.watch('professionalInterests').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">Professional Interests</h3>
                        <div className="flex flex-wrap gap-2">
                          {form.watch('professionalInterests').map((interest, index) => (
                            <Badge key={index} variant="outline">
                              {interest}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hobbies Section */}
                    {Array.isArray(form.watch('interests')) && form.watch('interests').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">Hobbies</h3>
                        <div className="flex flex-wrap gap-2">
                          {form.watch('interests').map((interest, index) => (
                            <Badge key={index} variant="outline">
                              {interest}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Languages Section */}
                    {Array.isArray(form.watch('languages')) && form.watch('languages').length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">Languages</h3>
                        <div className="flex flex-wrap gap-2">
                          {form.watch('languages').map((language, index) => (
                            <Badge key={index} variant="outline">
                              {language}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Resume Section */}
                    {typeof form.watch('resumeUrl') === 'string' && form.watch('resumeUrl') !== '' && (
                      <div className="space-y-2">
                        <h3 className="text-base font-semibold">Resume</h3>
                        <div className="flex flex-col gap-4">
                          {/* Resume Previews */}
                          {(() => {
                            // Get preview URLs from the form
                            const previewUrls = form.watch('resumePreviewUrls');
                            
                            // Skip rendering if there are no preview URLs
                            if (!Array.isArray(previewUrls) || previewUrls.length === 0) {
                              return null;
                            }
                            
                            // Return the JSX element if we have preview URLs
                            return (
                              <div className="grid gap-2">
                                <div 
                                  role="button"
                                  tabIndex={0}
                                  aria-label="View full resume"
                                  className="relative border rounded-lg overflow-hidden aspect-[3/4] cursor-pointer"
                                  onClick={() => {
                                    // Get current location to use as return path
                                    const currentLocation = window.location.pathname;
                                    const encodedReturnPath = encodeURIComponent(currentLocation);
                                    
                                    // Navigate to the resume view page with userId and return path
                                    setLocation(`/resume/${user?.id}/${encodedReturnPath}`);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      const currentLocation = window.location.pathname;
                                      const encodedReturnPath = encodeURIComponent(currentLocation);
                                      setLocation(`/resume/${user?.id}/${encodedReturnPath}`);
                                    }
                                  }}
                                >
                                  <img
                                    src={previewUrls[0] || ''}
                                    alt={`${form.watch('fullName') || 'User'}'s resume page 1`}
                                    className="w-full h-full object-cover"
                                  />
                                  {previewUrls.length > 1 && (
                                    <div className="absolute bottom-2 right-2 bg-black/75 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                      <FileText className="w-3 h-3" />
                                      +{previewUrls.length - 1} pages
                                    </div>
                                  )}
                                  <div className="absolute bottom-2 left-2 bg-primary/80 text-white text-xs px-2 py-1 rounded-md flex items-center gap-1">
                                    <FileText className="w-3 h-3" />
                                    Tap to view full resume
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <ImageCropper
        imageUrl={tempPhotoUrl}
        open={showCropper}
        onCancel={() => {
          console.log("Cancel button clicked, closing cropper");
          setShowCropper(false);
          URL.revokeObjectURL(tempPhotoUrl);
        }}
        onComplete={async (croppedImageUrl: string) => {
          console.log("Crop complete callback received with data URL");
          
          try {
            // Comprehensive validation of the cropped image URL
            if (!croppedImageUrl) {
              console.error("No cropped image URL provided");
              toast({
                title: "Cropping failed",
                description: "No image data received from cropper. Please try again.",
                variant: "destructive",
              });
              setShowCropper(false);
              if (tempPhotoUrl) {
                URL.revokeObjectURL(tempPhotoUrl);
              }
              return;
            }

            if (!croppedImageUrl.startsWith('data:image/')) {
              console.error("Invalid cropped image URL format:", 
                croppedImageUrl.substring(0, 50) + "...");
              toast({
                title: "Cropping failed",
                description: "Invalid image format from cropper. Please try again.",
                variant: "destructive",
              });
              setShowCropper(false);
              if (tempPhotoUrl) {
                URL.revokeObjectURL(tempPhotoUrl);
              }
              return;
            }
            
            // Convert base64 to blob with error handling
            console.log("Converting data URL to blob...");
            let response, blob;
            
            try {
              response = await fetch(croppedImageUrl);
              if (!response.ok) {
                throw new Error(`Failed to fetch image data: ${response.status}`);
              }
              blob = await response.blob();
            } catch (fetchError) {
              console.error("Error fetching/converting image data:", fetchError);
              toast({
                title: "Image processing failed",
                description: "Could not process the cropped image. Please try again.",
                variant: "destructive",
              });
              setShowCropper(false);
              if (tempPhotoUrl) {
                URL.revokeObjectURL(tempPhotoUrl);
              }
              return;
            }
            
            console.log("Blob created successfully:", {
              type: blob.type,
              size: blob.size,
            });
            
            // Validate blob
            if (!blob || blob.size === 0) {
              console.error("Empty or invalid blob created from image data URL");
              toast({
                title: "Upload failed",
                description: "Could not process the image. Please try a different image.",
                variant: "destructive",
              });
              setShowCropper(false);
              if (tempPhotoUrl) {
                URL.revokeObjectURL(tempPhotoUrl);
              }
              return;
            }

            // Validate blob size (should be less than 5MB)
            if (blob.size > 5 * 1024 * 1024) {
              console.error("Blob too large:", blob.size);
              toast({
                title: "File too large",
                description: "The processed image is too large. Please try a smaller image.",
                variant: "destructive",
              });
              setShowCropper(false);
              if (tempPhotoUrl) {
                URL.revokeObjectURL(tempPhotoUrl);
              }
              return;
            }

            // Convert blob to File for the unified upload flow
            console.log("Converting blob to File for upload...");
            const timestamp = Date.now();
            
            // Determine file extension based on blob type
            let extension = '.jpg'; // default
            if (blob.type === 'image/png') {
              extension = '.png';
            } else if (blob.type === 'image/webp') {
              extension = '.webp';
            } else if (blob.type === 'image/gif') {
              extension = '.gif';
            }
            
            const filename = `profile-picture-${timestamp}${extension}`;
            const file = new File([blob], filename, { type: blob.type });
            
            console.log("File created:", { name: file.name, size: file.size, type: file.type });
            console.log("Starting profile picture upload via unified hook...");
            
            // Upload using the unified hook method
            const result = await uploadPhoto(file);
            
            if (result.success) {
              console.log("Profile picture upload completed successfully");
              // Update form with new photo URL from server response
              if (result.savedData?.photo) {
                form.setValue('photo', result.savedData.photo);
              }
            } else {
              throw new Error('Failed to upload profile picture');
            }

            // Close the cropper
            console.log("Closing image cropper");
            setShowCropper(false);
            if (tempPhotoUrl) {
              URL.revokeObjectURL(tempPhotoUrl);
            }
          } catch (error) {
            console.error('Error during profile picture crop and upload:', error);
            
            // Ensure cleanup happens even on error
            setShowCropper(false);
            if (tempPhotoUrl) {
              URL.revokeObjectURL(tempPhotoUrl);
            }
            // Error toast is already handled by the uploadPhoto hook method
          }
        }}
        aspectRatio={1}
      />
      
      {/* iOS Input Accessory Toolbar - Previous/Next/Done navigation above keyboard */}
      {isIOSFromKeyboardHook && activeTab === 'edit' && !showCropper && (
        <IOSInputAccessoryToolbar
          visible={isIOSKeyboardVisible}
          keyboardHeight={keyboardHeight}
          canGoPrevious={fieldNavigation.canGoPrevious}
          canGoNext={fieldNavigation.canGoNext}
          onPrevious={fieldNavigation.focusPrevious}
          onNext={fieldNavigation.focusNext}
          onDone={() => {
            fieldNavigation.dismissKeyboard();
            // Dispatch event to hide mobile nav overlay when keyboard dismisses
            window.dispatchEvent(new CustomEvent('keyboard-visibility-change', { detail: false }));
          }}
          fieldLabel={fieldNavigation.currentFieldId ? fieldNavigation.getFieldLabel(fieldNavigation.currentFieldId) : undefined}
        />
      )}
      
      {/* Profile Edit Toolbar - appears when there are unsaved changes */}
      {/* Receives keyboard state from useIOSKeyboardPro to position above accessory toolbar */}
      {activeTab === 'edit' && !showCropper && (
        <ProfileEditToolbar
          hasChanges={hasUnsavedChanges}
          isSaving={saveStatus === 'saving' || saveStatus === 'retrying'}
          onSave={handleSaveFromToolbar}
          onCancel={handleCancel}
          isNativeIOSApp={isIOSFromKeyboardHook}
          isIOSKeyboardVisible={isIOSKeyboardVisible}
          keyboardHeight={keyboardHeight}
        />
      )}
    </ProtectedLayout>
  );
  } catch (error) {
    // If something goes wrong during rendering, show an error state
    console.error("Error rendering profile page:", error);
    return (
      <ProtectedLayout>
        <div className="container mx-auto px-4 flex flex-col items-center justify-center min-h-screen">
          <div className="p-6 max-w-md bg-background rounded-lg border shadow-md">
            <h2 className="text-lg font-semibold mb-4">There was an issue loading your profile</h2>
            <p className="text-muted-foreground mb-4">We encountered a problem while loading your profile data. This may happen for new accounts.</p>
            <div className="flex gap-4">
              <Button onClick={() => refreshUserData()}>
                Try Again
              </Button>
              <Button variant="outline" asChild>
                <Link href="/network">
                  Go to Network
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </ProtectedLayout>
    );
  }
}