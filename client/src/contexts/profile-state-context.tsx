import { createContext, useContext, useState, ReactNode } from 'react';

interface ProfileStateContextType {
  currentProfileTab: 'edit' | 'preview';
  setCurrentProfileTab: (tab: 'edit' | 'preview') => void;
  profileCropperActive: boolean;
  setProfileCropperActive: (active: boolean) => void;
}

const ProfileStateContext = createContext<ProfileStateContextType | undefined>(undefined);

export function ProfileStateProvider({ children }: { children: ReactNode }) {
  const [currentProfileTab, setCurrentProfileTab] = useState<'edit' | 'preview'>('edit');
  const [profileCropperActive, setProfileCropperActive] = useState(false);

  return (
    <ProfileStateContext.Provider value={{
      currentProfileTab,
      setCurrentProfileTab,
      profileCropperActive,
      setProfileCropperActive
    }}>
      {children}
    </ProfileStateContext.Provider>
  );
}

export function useProfileState() {
  const context = useContext(ProfileStateContext);
  if (!context) {
    throw new Error('useProfileState must be used within ProfileStateProvider');
  }
  return context;
}
