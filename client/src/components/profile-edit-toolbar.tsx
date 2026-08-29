import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { IOS_ACCESSORY_TOOLBAR_HEIGHT } from "@/hooks/use-ios-keyboard-pro";

interface ProfileEditToolbarProps {
  hasChanges: boolean;
  isSaving: boolean;
  onSave: () => void;
  onCancel: () => void;
  isNativeIOSApp?: boolean;
  isIOSKeyboardVisible?: boolean;
  keyboardHeight?: number;
}

export function ProfileEditToolbar({
  hasChanges,
  isSaving,
  onSave,
  onCancel,
  isNativeIOSApp = false,
  isIOSKeyboardVisible = false,
  keyboardHeight = 0,
}: ProfileEditToolbarProps) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const checkDesktop = () => {
      setIsDesktop(window.innerWidth >= 768);
    };
    checkDesktop();
    window.addEventListener("resize", checkDesktop);

    return () => {
      window.removeEventListener("resize", checkDesktop);
    };
  }, []);

  const shouldShow = hasChanges;

  if (!shouldShow) {
    return null;
  }

  const bottomPosition = isDesktop
    ? "0px"
    : isNativeIOSApp
      ? isIOSKeyboardVisible && keyboardHeight > 0 
        ? `${keyboardHeight + IOS_ACCESSORY_TOOLBAR_HEIGHT}px`
        : "calc(4rem + calc(env(safe-area-inset-bottom, 0px) * 0.5))"
      : "calc(4rem + env(safe-area-inset-bottom, 0px))";

  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-[200] bg-background border-t border-border",
        "flex items-center justify-between px-4 py-3",
        "transition-all duration-200 ease-in-out",
        "shadow-[0_-2px_10px_rgba(0,0,0,0.1)]"
      )}
      style={{ bottom: bottomPosition }}
      data-testid="profile-edit-toolbar"
    >
      <Button
        type="button"
        variant="secondary"
        onClick={onCancel}
        disabled={isSaving}
        className="bg-gray-200 hover:bg-gray-300 text-[hsl(215,25%,27%)] font-medium px-6"
        data-testid="button-cancel-profile"
      >
        Cancel
      </Button>

      <Button
        type="button"
        onClick={onSave}
        disabled={isSaving || !hasChanges}
        className="bg-[hsl(215,25%,27%)] hover:bg-[hsl(215,25%,22%)] text-white font-medium px-8"
        data-testid="button-save-profile"
      >
        {isSaving ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Saving...
          </>
        ) : (
          "Save"
        )}
      </Button>
    </div>
  );
}
