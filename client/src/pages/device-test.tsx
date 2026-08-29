import { useUserAgentDetection, getDeviceInfo } from "@/hooks/use-user-agent-detection";
import { Capacitor } from '@capacitor/core';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function DeviceTestPage() {
  // Hook-based detection (reactive)
  const hookDeviceInfo = useUserAgentDetection();
  
  // Synchronous detection
  const syncDeviceInfo = getDeviceInfo();
  
  // Capacitor detection
  const isCapacitor = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  
  return (
    <div className="container max-w-4xl mx-auto p-4 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Device Detection Test</h1>
        <p className="text-muted-foreground">
          Testing device detection for iOS native vs web
        </p>
      </div>

      {/* Capacitor Platform Information */}
      <Card>
        <CardHeader>
          <CardTitle>Capacitor Platform Detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium">Platform:</span>
            <Badge variant="outline">{platform}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Native Platform:</span>
            <Badge variant={isCapacitor ? "default" : "secondary"}>
              {isCapacitor ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">iOS Native App:</span>
            <Badge variant={platform === 'ios' && isCapacitor ? "default" : "secondary"}>
              {platform === 'ios' && isCapacitor ? "Yes" : "No"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Hook-based Device Detection */}
      <Card>
        <CardHeader>
          <CardTitle>Hook-based Device Detection (Reactive)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium">Device Type:</span>
            <Badge variant="outline">{hookDeviceInfo.deviceType}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Operating System:</span>
            <Badge variant="outline">{hookDeviceInfo.os}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Browser:</span>
            <Badge variant="outline">{hookDeviceInfo.browser}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Mobile:</span>
            <Badge variant={hookDeviceInfo.isMobile ? "default" : "secondary"}>
              {hookDeviceInfo.isMobile ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Tablet:</span>
            <Badge variant={hookDeviceInfo.isTablet ? "default" : "secondary"}>
              {hookDeviceInfo.isTablet ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Desktop:</span>
            <Badge variant={hookDeviceInfo.isDesktop ? "default" : "secondary"}>
              {hookDeviceInfo.isDesktop ? "Yes" : "No"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Synchronous Device Detection */}
      <Card>
        <CardHeader>
          <CardTitle>Synchronous Device Detection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium">Device Type:</span>
            <Badge variant="outline">{syncDeviceInfo.deviceType}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Operating System:</span>
            <Badge variant="outline">{syncDeviceInfo.os}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Browser:</span>
            <Badge variant="outline">{syncDeviceInfo.browser}</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Mobile:</span>
            <Badge variant={syncDeviceInfo.isMobile ? "default" : "secondary"}>
              {syncDeviceInfo.isMobile ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Tablet:</span>
            <Badge variant={syncDeviceInfo.isTablet ? "default" : "secondary"}>
              {syncDeviceInfo.isTablet ? "Yes" : "No"}
            </Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Is Desktop:</span>
            <Badge variant={syncDeviceInfo.isDesktop ? "default" : "secondary"}>
              {syncDeviceInfo.isDesktop ? "Yes" : "No"}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Window Information */}
      <Card>
        <CardHeader>
          <CardTitle>Window Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="font-medium">Window Width:</span>
            <Badge variant="outline">{typeof window !== 'undefined' ? window.innerWidth : 'N/A'}px</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">Window Height:</span>
            <Badge variant="outline">{typeof window !== 'undefined' ? window.innerHeight : 'N/A'}px</Badge>
          </div>
          <div className="flex justify-between items-center">
            <span className="font-medium">User Agent:</span>
            <Badge variant="outline" className="text-xs max-w-xs truncate">
              {typeof window !== 'undefined' ? navigator.userAgent : 'N/A'}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card className="border-2 border-primary">
        <CardHeader>
          <CardTitle>Expected Behavior</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="text-sm space-y-1">
            <p><strong>Web App:</strong> Should detect device type based on user agent and screen size</p>
            <p><strong>iOS Native App:</strong> Should always show "mobile" regardless of iPad size</p>
          </div>
          {platform === 'ios' && isCapacitor && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-medium">
                ✅ iOS Native App - Should be forced to mobile view
              </p>
              <p className="text-green-700 text-sm">
                Device Type: {hookDeviceInfo.deviceType} | Is Mobile: {hookDeviceInfo.isMobile ? 'Yes' : 'No'}
              </p>
            </div>
          )}
          {!isCapacitor && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-blue-800 font-medium">
                📱 Web App - Normal responsive detection
              </p>
              <p className="text-blue-700 text-sm">
                Device Type: {hookDeviceInfo.deviceType} | Is Mobile: {hookDeviceInfo.isMobile ? 'Yes' : 'No'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}