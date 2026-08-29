import { type User } from "@shared/schema";
import ProfileDialog from "./profile-dialog";

interface ChatProfileDialogProps {
  profile: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMessageClick?: () => void;
}

/**
 * A wrapper around ProfileDialog specifically for the chat page
 * that renders the dialog with full-height styling.
 */
export function ChatProfileDialog({
  profile,
  open,
  onOpenChange,
  onMessageClick,
}: ChatProfileDialogProps) {
  return (
    <ProfileDialog
      profile={profile}
      open={open}
      onOpenChange={onOpenChange}
      onMessageClick={onMessageClick}
      isConnected={true}
      hideButtons={true}
      dialogContentClassName="chat-profile-dialog"
    />
  );
}