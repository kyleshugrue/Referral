import React, { createContext, useContext, useState, ReactNode } from 'react';

declare global {
  interface Window {
    __PROFILE_DIALOG_OPEN?: boolean;
    __PROFILE_DIALOG_WAS_OPEN?: boolean;
  }
}

type ProfileDialogContextType = {
  isProfileDialogOpen: boolean;
  setProfileDialogOpen: (isOpen: boolean) => void;
};

const ProfileDialogContext = createContext<ProfileDialogContextType | undefined>(undefined);

export function ProfileDialogProvider({ children }: { children: ReactNode }) {
  const [isProfileDialogOpen, setProfileDialogOpenInternal] = useState(false);
  
  // Wrapper function to ensure state updates happen synchronously
  const setProfileDialogOpen = (isOpen: boolean) => {
    // Check if this is a component cleanup setting dialog to false
    if (!isOpen && typeof window !== 'undefined' && !window.__PROFILE_DIALOG_WAS_OPEN) {
      // Skip updating state when dialog wasn't actually open
      console.log("ProfileDialogProvider - Skipping close state update for cleanup/unmount");
      return;
    }
    
    // For all other cases, update the state
    console.log("ProfileDialogProvider - Setting isProfileDialogOpen to:", isOpen);
    setProfileDialogOpenInternal(isOpen);
    
    // Directly update global flags for components to check
    if (typeof window !== 'undefined') {
      window.__PROFILE_DIALOG_OPEN = isOpen;
      
      // Track if dialog was ever open (to detect cleanup calls)
      if (isOpen) {
        window.__PROFILE_DIALOG_WAS_OPEN = true;
      }
    }
  };
  
  return (
    <ProfileDialogContext.Provider value={{ isProfileDialogOpen, setProfileDialogOpen }}>
      {children}
    </ProfileDialogContext.Provider>
  );
}

export function useProfileDialog() {
  const context = useContext(ProfileDialogContext);
  
  if (context === undefined) {
    throw new Error('useProfileDialog must be used within a ProfileDialogProvider');
  }
  
  return context;
}