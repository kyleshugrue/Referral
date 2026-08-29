import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";

interface EditFieldToolbarProps {
  isVisible: boolean;
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  disabled?: boolean;
  saveLabel?: string;
  cancelLabel?: string;
}

export function EditFieldToolbar({
  isVisible,
  onSave,
  onCancel,
  isSaving = false,
  disabled = false,
  saveLabel = "Save",
  cancelLabel = "Cancel",
}: EditFieldToolbarProps) {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [isNativeIOS, setIsNativeIOS] = useState(false);

  useEffect(() => {
    const checkPlatform = () => {
      const isIOS = Capacitor.getPlatform() === "ios" && Capacitor.isNativePlatform();
      setIsNativeIOS(isIOS);
    };
    checkPlatform();
  }, []);

  useEffect(() => {
    const handleKeyboardShow = (event: CustomEvent) => {
      const height = event.detail?.keyboardHeight || 0;
      setKeyboardHeight(height);
    };

    const handleKeyboardHide = () => {
      setKeyboardHeight(0);
    };

    window.addEventListener("keyboardWillShow", handleKeyboardShow as EventListener);
    window.addEventListener("keyboardDidShow", handleKeyboardShow as EventListener);
    window.addEventListener("keyboardWillHide", handleKeyboardHide);
    window.addEventListener("keyboardDidHide", handleKeyboardHide);

    return () => {
      window.removeEventListener("keyboardWillShow", handleKeyboardShow as EventListener);
      window.removeEventListener("keyboardDidShow", handleKeyboardShow as EventListener);
      window.removeEventListener("keyboardWillHide", handleKeyboardHide);
      window.removeEventListener("keyboardDidHide", handleKeyboardHide);
    };
  }, []);

  const bottomOffset = isNativeIOS && keyboardHeight > 0 
    ? keyboardHeight 
    : "env(safe-area-inset-bottom, 0px)";

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="fixed left-0 right-0 z-[9999] px-4 pb-2"
          style={{
            bottom: typeof bottomOffset === "number" ? `${bottomOffset}px` : `calc(${bottomOffset} + 8px)`,
          }}
          data-testid="edit-field-toolbar"
        >
          <div className="flex items-center justify-between gap-3 bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 max-w-lg mx-auto">
            <Button
              type="button"
              variant="outline"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onCancel();
              }}
              disabled={isSaving}
              className="flex-1 h-11 text-base font-medium rounded-lg border-gray-300 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors"
              data-testid="button-cancel-edit"
            >
              {cancelLabel}
            </Button>
            
            <Button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onSave();
              }}
              disabled={disabled || isSaving}
              className="flex-1 h-11 text-base font-medium rounded-lg bg-gray-900 hover:bg-gray-800 active:bg-gray-700 text-white transition-colors"
              data-testid="button-save-edit"
            >
              {isSaving ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving...
                </span>
              ) : (
                saveLabel
              )}
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default EditFieldToolbar;
