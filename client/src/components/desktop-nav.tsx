import { Share2, Users2, MessageSquare } from "lucide-react";
import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useNotificationCounts } from "@/hooks/use-notifications";
import { UserAvatar } from "@/components/user-avatar";

interface DesktopNavProps {
  children: React.ReactNode;
}

export default function DesktopNav({ children }: DesktopNavProps) {
  const [location] = useLocation();
  const { user } = useAuth();
  
  // Get notification counts
  const { data: notificationCounts, isLoading: notificationsLoading } = useNotificationCounts();

  // Create navigation items with labels for desktop
  const navItems = [
    { icon: Share2, label: "Network", href: "/" },
    { icon: Users2, label: "Requests", href: "/requests" },
    { icon: MessageSquare, label: "Connections", href: "/connections" },
    { href: "/profile", label: "Profile", isAvatar: true }
  ];

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      {/* Top Navigation Bar - Fixed position */}
      <header className="fixed top-0 left-0 right-0 z-30 bg-white shadow-md">
        <div className="h-16 flex items-center justify-between" style={{paddingRight: '1rem'}}>
          {/* Logo/Brand with slight padding from left edge */}
          <div className="text-primary font-semibold text-xl pl-4">Referral</div>
          
          {/* Main Navigation */}
          <nav className="flex items-center space-x-4">
            {navItems.map((item) => {
              // Check if the current location is a network-related page for the Network icon
              const isNetworkPage = item.href === "/" && 
                (location === "/" || location.startsWith("/network/"));
              
              // For other icons, just check for exact match but don't let it affect the badge visibility
              const isActive = item.href !== "/" ? 
                location === item.href || 
                (item.href === "/connections" && location.startsWith("/chat")) : 
                isNetworkPage;
                
              if (item.isAvatar) {
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-[hsl(215,25%,27%)]/10 transition-colors",
                      isActive ? "text-white bg-[hsl(215,25%,27%)]" : "text-[hsl(215,25%,27%)]"
                    )}
                  >
                    <UserAvatar 
                      user={user}
                      className={cn(
                        "h-8 w-8 rounded-full transition-all duration-200",
                        isActive && "ring-1 ring-[hsl(215,25%,27%)]"
                      )}
                      fallbackClassName="bg-[hsl(215,25%,27%)] text-white font-medium"
                    />
                    <span>{item.label}</span>
                  </Link>
                );
              }
              
              const Icon = item.icon!;
              
              // Determine if we need to show a notification badge
              let notificationCount = 0;
              
              // Always show notification badges when counts are greater than zero
              // This ensures badges persist regardless of active/inactive state
              if (item.href === "/requests") {
                // For connection requests, always show the badge if count > 0
                notificationCount = notificationCounts?.connectionRequests || 0;
              } else if (item.href === "/connections") {
                // For connections, show combined count of messages and new connections
                notificationCount = (notificationCounts?.messages || 0) + (notificationCounts?.newConnections || 0);
              }
              
              return (
                <div key={item.href} className="relative">
                  <Link
                    href={item.href}
                    className={cn(
                      "flex items-center space-x-2 px-3 py-2 rounded-md hover:bg-[hsl(215,25%,27%)]/10 transition-colors relative", // Added relative here
                      isActive ? "text-white bg-[hsl(215,25%,27%)]" : "text-[hsl(215,25%,27%)]"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                    <span className="relative">
                      {item.label}
                      
                      {/* Notification Badge aligned with top right of text label - always show if count > 0 */}
                      {!notificationsLoading && notificationCount > 0 && (
                        <div className="absolute top-0 right-0 -translate-y-1/2 translate-x-1/2 flex items-center justify-center min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-xs font-semibold">
                          {notificationCount}
                        </div>
                      )}
                    </span>
                  </Link>
                </div>
              );
            })}
          </nav>
        </div>
      </header>

      {/* Main content area with adjusted padding for top nav (no padding for profile page) */}
      <main className={`flex-1 overflow-y-auto ${location === "/profile" ? "" : "pt-16"}`}>
        {children}
      </main>
    </div>
  );
}