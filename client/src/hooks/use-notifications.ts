import { useQuery } from "@tanstack/react-query";
import { useGlobalWebSocket } from "./use-global-websocket";
import { apiRequest } from "@/lib/queryClient";

interface NotificationCounts {
  messages: number;
  connectionRequests: number;
  newConnections: number;
}

export function useNotificationCounts() {
  useGlobalWebSocket();

  return useQuery<NotificationCounts>({
    queryKey: ['/api/notifications/counts'],
    refetchInterval: 30000,
    staleTime: 0,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['/api/notifications'],
  });
}

export async function markNotificationAsRead(notificationId: number) {
  const response = await apiRequest('PATCH', `/api/notifications/${notificationId}`);
  
  if (!response.ok) {
    throw new Error('Failed to mark notification as read');
  }
  
  return response.json();
}

export async function markAllNotificationsAsRead(type?: string) {
  const url = type ? `/api/notifications/read-all/${type}` : '/api/notifications/read-all';
  
  const response = await apiRequest('PATCH', url);
  
  if (!response.ok) {
    throw new Error('Failed to mark all notifications as read');
  }
  
  return response.json();
}
