import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { LogOut, Trash2, ChevronLeft, Shield, Bell } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useState, useEffect, useRef, useCallback } from "react";
import { IOSKeyboardAwareContainer, useIOSKeyboardAware } from "@/components/ios-keyboard-aware-container";

import { usePushNotifications } from '@/hooks/use-push-notifications';

const settingsSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
});

type SettingsFormData = z.infer<typeof settingsSchema>;

export default function SettingsPage() {
  const { user, firebaseUser, logoutMutation } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [pushNotificationsEnabled, setPushNotificationsEnabled] = useState(false);
  const [isiOSNative, setIsiOSNative] = useState(false);
  const [pushNotificationError, setPushNotificationError] = useState<string | null>(null);
  const { checkPermissionStatus, initializePushNotifications } = usePushNotifications();
  // Use a ref to track editing state
  const isUserEditing = useRef<boolean>(false);
  
  // Handle push notification permission and registration for settings page
  useEffect(() => {
    const checkAndUpdatePushNotificationStatus = async () => {
      console.log('[Settings] Checking push notification status...');
      
      // Check current permission status
      const currentPermission = await checkPermissionStatus();
      
      if (currentPermission === null) {
        console.log('[Settings] Not iOS native platform, hiding push notification settings');
        setIsiOSNative(false);
        return;
      }
      
      console.log('[Settings] iOS native platform detected');
      setIsiOSNative(true);
      
      console.log('[Settings] Current permission status:', currentPermission);
      
      // Check backend registration status
      try {
        const response = await fetch('/api/push-notifications/status', {
          credentials: 'include'
        });
        
        if (response.ok) {
          const status = await response.json();
          console.log('[Settings] Backend token registration status:', status);
          
          // Set toggle based on backend registration, not just FCM permission
          setPushNotificationsEnabled(status.hasRegisteredToken);
          setPushNotificationError(null);
        } else if (response.status === 401) {
          console.error('[Settings] Not authenticated with backend');
          setPushNotificationError('not_authenticated');
          setPushNotificationsEnabled(false);
        } else {
          console.error('[Settings] Failed to check backend status:', response.status);
          // Fall back to FCM permission state
          setPushNotificationsEnabled(currentPermission);
          setPushNotificationError(null);
        }
      } catch (error) {
        console.error('[Settings] Error checking backend status:', error);
        // Fall back to FCM permission state
        setPushNotificationsEnabled(currentPermission);
        setPushNotificationError(null);
      }
    };
    
    checkAndUpdatePushNotificationStatus();
  }, [checkPermissionStatus, toast]);

  // Handle toggle change for push notifications
  const handlePushNotificationToggle = async (enabled: boolean) => {
    // Prevent toggle if there's an authentication error
    if (pushNotificationError === 'not_authenticated') {
      toast({
        title: "Authentication required",
        description: "Please log in again to enable push notifications.",
        variant: "destructive"
      });
      return;
    }
    
    try {
      if (enabled) {
        console.log('[Settings] User toggled push notifications ON');
        const success = await initializePushNotifications();
        
        if (success) {
          setPushNotificationsEnabled(true);
          toast({
            title: "Push notifications enabled",
            description: "You'll now receive notifications for connections and messages.",
          });
        } else {
          setPushNotificationsEnabled(false);
          toast({
            title: "Permission denied",
            description: "Push notifications require permission to be enabled.",
            variant: "destructive"
          });
        }
      } else {
        console.log('[Settings] User toggled push notifications OFF');
        setPushNotificationsEnabled(false);
        // Note: iOS doesn't allow programmatic disabling of notifications once granted
        toast({
          title: "Push notifications disabled",
          description: "To fully disable, go to iOS Settings > Notifications > This App.",
        });
      }
    } catch (error) {
      console.error('[Settings] Error handling push notifications:', error);
      setPushNotificationsEnabled(false);
      toast({
        title: "Error",
        description: "Failed to update push notification settings.",
        variant: "destructive"
      });
    }
  };

  // Check if a pending email change has been verified
  useEffect(() => {
    if (firebaseUser && user?.id) {
      const pendingEmail = localStorage.getItem('pendingEmailChange');
      
      // If there's a pending email change and the current Firebase email matches it,
      // then the verification was successful
      if (pendingEmail && firebaseUser.email === pendingEmail) {
        // Update our backend database with the new verified email
        const updateEmail = async () => {
          try {
            await apiRequest("PATCH", `/api/users/${user.id}`, {
              email: pendingEmail,
              pendingEmail: null // Clear the pending email
            });
            
            // Clear the pending email change from local storage
            localStorage.removeItem('pendingEmailChange');
            
            // Refresh user data
            queryClient.invalidateQueries({ queryKey: ["/api/user"] });
            
            toast({
              title: "Email updated",
              description: "Your email has been successfully updated.",
            });
          } catch (error) {
            console.error("Error updating email in database:", error);
          }
        };
        
        updateEmail();
      }
    }
  }, [firebaseUser, user?.id, toast]);

  const form = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      fullName: user?.fullName || "",
      email: user?.email || "",
    },
  });

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<SettingsFormData>) => {
      if (!user?.id) throw new Error("No user found");
      const res = await apiRequest("PATCH", `/api/users/${user.id}`, data);
      if (!res.ok) throw new Error("Failed to update settings");
      return res.json();
    },
    onSuccess: (data) => {
      // Update the user data in the cache
      queryClient.setQueryData(["/api/user"], data);
      // Also invalidate to ensure data is in sync
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      
      if (saveStatus === 'saving') {
        // Reset status after a delay for auto-save
        setSaveStatus('saved');
        setTimeout(() => {
          setSaveStatus('idle');
        }, 2000);
      } else {
        // Manual save (form submission)
        toast({
          title: "Settings updated",
          description: "Your settings have been saved successfully.",
        });
      }
    },
    onError: (error: Error) => {
      console.error("Error updating settings:", error);
      setSaveStatus('error');
      
      // Reset status after a delay
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
      
      toast({
        title: "Failed to save changes",
        description: error.message || "Please try again later.",
        variant: "destructive",
      });
    }
  });
  
  // Handle immediate save for settings fields
  const handleImmediateSave = useCallback(async (data: Partial<SettingsFormData>) => {
    try {
      // Ensure we don't send undefined values
      const cleanData = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined)
      );
      
      if (Object.keys(cleanData).length === 0) {
        return;
      }
      
      // Update save status to indicate saving in progress
      setSaveStatus('saving');
      
      // Call the mutation and wait for result
      const result = await updateSettingsMutation.mutateAsync(cleanData);
      
      // If successful, update the UI to reflect the save
      if (result) {
        // Force a refresh to ensure all data is in sync
        await queryClient.invalidateQueries({ queryKey: ["/api/user"] });
      }
      
      // Update save status to indicate success
      setSaveStatus('saved');
      
      // Reset status after a delay
      setTimeout(() => {
        setSaveStatus('idle');
      }, 2000);
      
      // Show a subtle success toast
      toast({
        title: "Settings updated",
        description: "Your changes have been saved automatically.",
        duration: 2000,
      });
    } catch (error) {
      console.error("Error auto-saving settings:", error);
      
      // Update save status to indicate error
      setSaveStatus('error');
      
      // Reset status after a delay
      setTimeout(() => {
        setSaveStatus('idle');
      }, 3000);
      
      toast({
        title: "Failed to save changes",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive",
      });
    }
  }, [updateSettingsMutation, toast, setSaveStatus]);

  // Remove the debounced update as we're using immediate save instead
  
  // Watch for form changes and trigger immediate auto-save
  useEffect(() => {
    if (!user?.id) return;
    
    // Watch for form changes
    const subscription = form.watch((value, { name, type }) => {
      // Set the editing flag when changes are detected
      isUserEditing.current = true;
      
      // If it's a specific field change
      if (type === "change" && name) {
        const fieldValue = form.getValues(name as keyof SettingsFormData);
        // Use immediate save instead of debounced update
        handleImmediateSave({ [name]: fieldValue });
      } 
      // If it's a multi-field change
      else if (type === "change") {
        const formData = form.getValues();
        // Use immediate save instead of debounced update
        handleImmediateSave(formData);
      }
      
      // Clear editing flag after a delay
      setTimeout(() => {
        if (!document.activeElement || 
            !document.activeElement.tagName || 
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          isUserEditing.current = false;
        }
      }, 1000);
    });
    
    return () => {
      // Clean up subscription
      subscription.unsubscribe();
    };
  }, [form, handleImmediateSave, user?.id]);

  // Set up event handlers to track when fields are being edited
  useEffect(() => {
    // Track when any field gets focus
    const handleFieldFocus = () => {
      isUserEditing.current = true;
    };

    // Track when any field loses focus
    const handleFieldBlur = () => {
      setTimeout(() => {
        if (!document.activeElement || 
            !document.activeElement.tagName || 
            !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
          isUserEditing.current = false;
        }
      }, 200);
    };

    // Add listeners to the form container
    const formElement = document.getElementById('settings-form');
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

  const deleteAccountMutation = useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error("No user found");
      await apiRequest("DELETE", `/api/users/${user.id}`);
      // Redirect immediately after deletion, before logout
      setLocation("/auth");
      // Then logout
      await logoutMutation.mutateAsync();
    },
    onError: (error) => {
      toast({
        title: "Failed to delete account",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive"
      });
    },
  });
  


  async function onSubmit(data: SettingsFormData) {
    const updateData: Partial<SettingsFormData> = {
      fullName: data.fullName,
      // Email is read-only and can't be changed
    };

    try {
      await updateSettingsMutation.mutateAsync(updateData);
    } catch (error) {
      toast({
        title: "Failed to save changes",
        description: error instanceof Error ? error.message : "Please try again later.",
        variant: "destructive"
      });
    }
  }

  // Initialize iOS keyboard handling
  const { handleInputFocus } = useIOSKeyboardAware();

  if (!user) {
    return null;
  }

  return (
    <IOSKeyboardAwareContainer className="min-h-[100dvh] bg-background pb-32">
      <div className="px-4">
        <div className="flex justify-start pt-4 [transition:none!important]">
          <button
            className="flex items-center gap-2 text-[hsl(215, 25%, 27%)] text-sm font-medium rounded-md py-2 px-4 [transition:none!important] focus:outline-none"
            onClick={() => setLocation('/profile')}
          >
            <ChevronLeft className="h-5 w-5 [transition:none!important]" />
            Back to Profile
          </button>
        </div>

        <div className="max-w-2xl mx-auto">
          <div className="p-6 rounded-lg">
            <h1 className="text-2xl font-bold mb-6" style={{ color: 'hsl(215, 25%, 27%)' }}>Account Settings</h1>

            <Form {...form}>
              <form id="settings-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                <div className="space-y-4">
                  <FormField
                    control={form.control}
                    name="fullName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary">Full Name</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            className="bg-white dark:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-0"
                            onFocus={handleInputFocus}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-primary">Email</FormLabel>
                        <FormControl>
                          <Input type="email" {...field} className="bg-white dark:bg-slate-900" readOnly disabled />
                        </FormControl>
                        <FormMessage />
{/* Email verification button removed as email is now read-only */}
                      </FormItem>
                    )}
                  />





                </div>
              </form>
            </Form>
            
            {/* Push Notifications Section - iOS Native Only */}
            {isiOSNative && (
              <div className="pt-4 mt-4">
                <h2 className="text-lg font-semibold text-primary mb-4">Push Notifications</h2>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-3 bg-white dark:bg-slate-900 rounded-lg border">
                    <div className="flex items-center space-x-3">
                      <Bell className="h-5 w-5 text-primary" />
                      <div>
                        <p className="text-sm font-medium text-primary">Enable Push Notifications</p>
                        <p className="text-xs text-muted-foreground">
                          Get notified about new connections, messages, and networking opportunities
                        </p>
                        {pushNotificationError === 'not_authenticated' && (
                          <p className="text-xs text-destructive mt-1" data-testid="text-push-notification-error">
                            ⚠️ Please log in again to enable push notifications
                          </p>
                        )}
                      </div>
                    </div>
                    <Switch
                      checked={pushNotificationsEnabled}
                      onCheckedChange={handlePushNotificationToggle}
                      disabled={pushNotificationError !== null}
                      data-testid="switch-push-notifications"
                    />
                  </div>
                </div>
              </div>
            )}
            
            <div className="pt-4 mt-4">
              <h2 className="text-lg font-semibold text-primary mb-4">Accessibility</h2>
              <div className="space-y-4">
                <Button
                  className="w-full bg-[hsl(215,25%,27%)] text-white hover:bg-[hsl(215,25%,22%)]"
                  onClick={() => setLocation('/settings/blocked-accounts')}
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Blocked Accounts
                </Button>
              </div>
            </div>

            <div className="space-y-4 mt-8">
              <Button
                variant="outline"
                className="w-full text-primary hover:bg-accent/10"
                onClick={() => logoutMutation.mutate()}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </Button>

              <Button
                variant="destructive"
                className="w-full"
                onClick={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Profile
              </Button>
            </div>
          </div>
        </div>
      </div>



      {/* Delete Account Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent className="bg-background">
          <DialogHeader>
            <DialogTitle className="text-primary">Delete Profile</DialogTitle>
            <DialogDescription className="text-primary/80">
              Are you sure you want to delete your profile? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
              className="text-primary hover:bg-accent/10"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setShowDeleteDialog(false);
                deleteAccountMutation.mutate();
              }}
              disabled={deleteAccountMutation.isPending}
            >
              Delete Profile
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </IOSKeyboardAwareContainer>
  );
}