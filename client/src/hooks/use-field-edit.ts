import { useState, useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface UseFieldEditOptions<T> {
  fieldName: string;
  initialValue: T;
  userId: number | undefined;
  onSaveSuccess?: (newValue: T) => void;
  onCancel?: () => void;
  validateValue?: (value: T) => string | null;
}

interface UseFieldEditReturn<T> {
  currentValue: T;
  setCurrentValue: (value: T) => void;
  isEditing: boolean;
  isDirty: boolean;
  isSaving: boolean;
  error: string | null;
  startEditing: () => void;
  handleSave: () => Promise<void>;
  handleCancel: () => void;
  handleBlur: () => void;
}

export function useFieldEdit<T>({
  fieldName,
  initialValue,
  userId,
  onSaveSuccess,
  onCancel,
  validateValue,
}: UseFieldEditOptions<T>): UseFieldEditReturn<T> {
  const { toast } = useToast();
  const [currentValue, setCurrentValue] = useState<T>(initialValue);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const originalValueRef = useRef<T>(initialValue);
  const blurTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!isEditing) {
      setCurrentValue(initialValue);
      originalValueRef.current = initialValue;
    }
  }, [initialValue, isEditing]);

  const isDirty = JSON.stringify(currentValue) !== JSON.stringify(originalValueRef.current);

  const startEditing = useCallback(() => {
    originalValueRef.current = currentValue;
    setIsEditing(true);
    setError(null);
    
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
  }, [currentValue]);

  const handleSave = useCallback(async () => {
    if (!userId) {
      setError("User not found");
      return;
    }

    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    if (validateValue) {
      const validationError = validateValue(currentValue);
      if (validationError) {
        setError(validationError);
        toast({
          title: "Validation Error",
          description: validationError,
          variant: "destructive",
        });
        return;
      }
    }

    if (!isDirty) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [fieldName]: currentValue }),
        credentials: "include",
      });

      if (!response.ok) {
        let errorText = "Failed to save changes";
        try {
          const errorData = await response.json();
          errorText = errorData.message || errorData.error || errorText;
        } catch {
          errorText = response.statusText || errorText;
        }
        throw new Error(errorText);
      }

      const result = await response.json();
      
      queryClient.setQueryData(["/api/user"], result);
      
      if (result.matchRefreshQueued) {
        console.log(`[FieldEdit] Server queued match refresh job ${result.queuedJobId}`);
        localStorage.setItem("synergyMatchesRefreshing", "true");
        localStorage.setItem("synergyMatchesRefreshingStartTime", Date.now().toString());
        queryClient.invalidateQueries({ queryKey: ["/api/matches/synergy"] });
      }

      originalValueRef.current = currentValue;
      setIsEditing(false);
      
      toast({
        title: "Saved",
        description: "Your changes have been saved.",
        duration: 2000,
      });

      onSaveSuccess?.(currentValue);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to save changes";
      setError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  }, [userId, fieldName, currentValue, isDirty, validateValue, toast, onSaveSuccess]);

  const handleCancel = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    setCurrentValue(originalValueRef.current);
    setIsEditing(false);
    setError(null);
    onCancel?.();
  }, [onCancel]);

  const handleBlur = useCallback(() => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    
    blurTimeoutRef.current = setTimeout(() => {
      if (isEditing && !isSaving) {
        handleCancel();
      }
    }, 150);
  }, [isEditing, isSaving, handleCancel]);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  return {
    currentValue,
    setCurrentValue,
    isEditing,
    isDirty,
    isSaving,
    error,
    startEditing,
    handleSave,
    handleCancel,
    handleBlur,
  };
}

export default useFieldEdit;
