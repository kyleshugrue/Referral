import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Redirect, useLocation } from "wouter";
import { useViewportHeight } from "@/lib/use-viewport-height";
import { useDeviceType } from "@/hooks/use-device-type";
import { MessageSquare, Search } from "lucide-react";
import { SynergyIcon } from "@/components/icons/synergy-icon";

// iPhone Mockup Component
function IPhoneMockup({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative ${className}`}>
      {/* iPhone 14 Frame - Exact aspect ratio (146.7mm x 71.5mm) with accurate corner radius */}
      <div className="relative bg-gray-900 rounded-[1.5rem] p-1" style={{ aspectRatio: '71.5/146.7' }}>
        {/* Screen with iPhone 14 bezels (2.42mm bezels) - sharp corners like real iPhone */}
        <div className="bg-white rounded-[1.25rem] overflow-hidden relative h-full">
          {/* iPhone 14 Notch - exact proportional dimensions */}
          <div className="absolute top-0 left-1/2 transform -translate-x-1/2 z-20">
            {/* Notch proportional to actual iPhone 14: ~160px wide × 30px tall on 390×844 viewport */}
            <div className="w-20 h-4 bg-gray-900 rounded-b-xl"></div>
          </div>
          {/* Content */}
          <div className="relative z-10 h-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// Mobile Auth Layout
function MobileAuthLayout() {
  const [, setLocation] = useLocation();
  
  return (
    <div 
      className="fixed inset-0 flex flex-col overflow-hidden bg-white"
      style={{ 
        minHeight: 'calc(var(--vh, 1vh) * 100)',
        height: 'calc(var(--vh, 1vh) * 100)'
      }}
    >
      {/* Fixed Gradient Background */}
      <div 
        className="absolute inset-x-0 bottom-0"
        style={{
          height: '100%',
          background: `
            linear-gradient(to top, 
              hsla(215,25%,27%,1) 0%, 
              hsla(215,20%,65%,0.8) 50%, 
              hsla(0,0%,100%,1) 100%
            )
          `
        }}
      />
      
      {/* Content Container */}
      <div className="relative z-10 flex flex-col justify-between h-full px-6 pt-safe">
        {/* Title Section (top third) */}
        <div className="flex-1 flex items-center justify-center">
          <h1 className="text-5xl font-bold text-primary">Referral</h1>
        </div>

        {/* Tagline Section (middle) */}
        <div className="text-3xl font-light text-white/90 text-center pb-12">
          It's all about <span className="font-semibold">connections</span>
        </div>

        {/* Buttons Section (bottom third) */}
        <div className="flex-1 flex items-end justify-center pb-6">
          <div className="w-full max-w-md space-y-4">
            <Button
              variant="outline"
              className="w-full h-14 bg-white/90 hover:bg-white text-[hsl(215,25%,27%)] font-semibold text-base border-0 transition-all duration-300"
              onClick={() => setLocation('/auth/register')}
            >
              Create account
            </Button>
            <Button
              variant="outline"
              className="w-full h-14 bg-white/90 hover:bg-white text-[hsl(215,25%,27%)] font-semibold text-base border-0 transition-all duration-300"
              onClick={() => setLocation('/auth/login')}
            >
              Sign in
            </Button>
          </div>
        </div>

        {/* Footer link (full-width, bottom of page) — server-rendered guide for SEO/discovery */}
        <div className="flex-shrink-0 w-full text-center pt-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          <a
            href="/guides"
            className="text-white/70 hover:text-white text-sm underline underline-offset-4"
          >
            Career &amp; referral guides
          </a>
        </div>
      </div>
    </div>
  );
}

// Desktop Auth Layout
function DesktopAuthLayout() {
  const [, setLocation] = useLocation();
  
  const screenshots = [
    {
      src: "/demo-screenshots/IMG_9824_1752622444512.PNG",
      alt: "Referral Synergy AI screen showing a professional profile and referral-focused connection details",
      title: "AI-Powered Networking",
      description: "Connect based on career and relocation goals",
      icon: SynergyIcon
    },
    {
      src: "/demo-screenshots/IMG_9825_1752622444512.PNG",
      alt: "Referral Network Search screen showing personalized matching features",
      title: "Browse the Platform",
      description: "Search for connections based on preferences and experience",
      icon: Search
    },
    {
      src: "/demo-screenshots/IMG_9827_1752622444513.PNG",
      alt: "Referral Connections screen showing demonstration conversations between professionals",
      title: "Exchange Referrals",
      description: "Grow your network, exchange referrals, and achieve your goals",
      icon: MessageSquare
    }
  ];
  
  return (
    <div 
      className="min-h-screen"
      style={{
        background: `
          linear-gradient(to top, 
            hsla(215,25%,27%,1) 0%, 
            hsla(215,20%,65%,0.8) 50%, 
            hsla(0,0%,100%,1) 100%
          )
        `
      }}
    >
      {/* Header */}
      <div className="text-center py-2">
        <h1 className="text-6xl font-bold text-primary mb-4">Referral</h1>
        <p className="text-2xl text-muted-foreground">
          It's all about <span className="font-semibold text-primary">connections</span>
        </p>
      </div>
      
      {/* Main Content Area */}
      {/* flex-wrap + a responsive gap keep this from forcing horizontal
          page overflow at narrow widths. useDeviceType() picks this layout
          based on User-Agent, not viewport width, so a narrow viewport can
          still render it (e.g. a resized desktop browser, some in-app/native
          WebViews, or a tablet in portrait) - the layout itself must not
          break in that case. */}
      <div className="flex flex-wrap items-center justify-center px-4 sm:px-8 pb-16 pt-16 gap-8 sm:gap-12 lg:gap-24">
        {/* Screenshots Display */}
        {screenshots.map((screenshot, index) => {
          const IconComponent = screenshot.icon;
          return (
            <div key={index} className="flex flex-col items-center text-center h-full">
              {/* Feature Description - fixed height container */}
              <div className="h-24 flex flex-col justify-center space-y-3 mb-6">
                <div className="flex items-center justify-center space-x-3">
                  <IconComponent className="h-6 w-6 text-primary" />
                  <h3 className="text-xl font-bold text-gray-900">{screenshot.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-64">
                  {screenshot.description}
                </p>
              </div>
              
              {/* Screenshot - aligned to bottom */}
              <div className="flex-shrink-0 mt-auto">
                <IPhoneMockup className="w-56 transform hover:scale-125 transition-transform duration-500 ease-out">
                  <img 
                    src={screenshot.src}
                    alt={screenshot.alt}
                    className="w-full h-auto"
                  />
                </IPhoneMockup>
              </div>
            </div>
          );
        })}

        {/* Auth Buttons Section */}
        <div className="flex items-center justify-center">
          <div className="w-full max-w-md px-8">
            <div className="space-y-8">
              <div className="text-center space-y-4">
                <h2 className="text-3xl font-bold text-white">Start Networking</h2>
                <p className="text-white/90">
                  Sign up and start strategically networking today
                </p>
              </div>

              <div className="space-y-4">
                <Button
                  size="lg"
                  className="w-full h-14 text-lg font-semibold"
                  onClick={() => setLocation('/auth/register')}
                >
                  Create account
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full h-14 text-lg font-semibold bg-white/90 hover:bg-white text-gray-900 border-0"
                  onClick={() => setLocation('/auth/login')}
                >
                  Sign in
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer link (full-width, bottom of page) — server-rendered guide for SEO/discovery */}
      <div className="text-center pb-6 pt-2">
        <a
          href="/guides"
          className="text-white/70 hover:text-white text-sm underline underline-offset-4"
        >
          Career &amp; referral guides
        </a>
      </div>
    </div>
  );
}

export default function AuthPage() {
  const { user } = useAuth();
  const deviceType = useDeviceType();
  const [location] = useLocation();

  // Use the viewport height hook for mobile
  useViewportHeight();

  // If user is authenticated and not on preview route, redirect to home
  if (user && location !== '/auth-preview') {
    return <Redirect to="/" />;
  }

  // Show mobile layout for mobile devices, desktop layout for desktop
  return deviceType === 'mobile' ? <MobileAuthLayout /> : <DesktopAuthLayout />;
}