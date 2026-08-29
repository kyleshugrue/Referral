import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Users, UserPlus } from "lucide-react";
import { Link, useLocation } from "wouter";
import { UserAvatar } from "@/components/user-avatar";
import { SynergyIcon } from "./icons/synergy-icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function NavBar() {
  const { user } = useAuth();
  const [location] = useLocation();

  return (
    <header className="bg-white sticky top-0 z-[100]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-12 flex items-center justify-between relative bg-white">
        {location === "/" ? (
          <div className="w-10"></div> /* Empty div for network landing page only */
        ) : (
          <h1 className="text-xl font-semibold text-primary relative hover:scale-105 transition-transform">
            Referral
          </h1>
        )}

        <div className="flex items-center gap-2">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/matches/suggestions">
                  <Button 
                    variant="ghost"
                    size="sm"
                    aria-label="AI Match Suggestions"
                    className={location === "/matches/suggestions" ? "text-primary" : "text-accent hover:text-primary"}
                  >
                    <SynergyIcon className="h-4 w-4" />
                  </Button>
                </Link>
              </TooltipTrigger>
              <TooltipContent>
                <p>AI Match Suggestions</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>

          <Link href="/">
            <Button 
              variant="ghost"
              size="sm"
              className={location === "/" ? "text-primary" : "text-accent hover:text-primary"}
            >
              <Users className="h-4 w-4" />
            </Button>
          </Link>

          <Link href="/requests">
            <Button 
              variant="ghost"
              size="sm"
              className={location === "/requests" ? "text-primary" : "text-accent hover:text-primary"}
            >
              <UserPlus className="h-4 w-4" />
            </Button>
          </Link>

          <Link href="/connections">
            <Button 
              variant="ghost"
              size="sm"
              className={location === "/connections" ? "text-primary" : "text-accent hover:text-primary"}
            >
              <Users className="h-4 w-4" />
            </Button>
          </Link>

          <div className="h-5 w-px bg-accent/30" />

          <span className="text-sm text-accent">Welcome, {user?.fullName}</span>

          <Link href="/profile">
            <Button 
              variant="ghost" 
              size="sm"
              className={`p-0 ${location === "/profile" ? "ring-2 ring-primary ring-offset-2" : ""}`}
            >
              <UserAvatar
                user={user}
                className="h-7 w-7 rounded-full"
              />
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}