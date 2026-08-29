import { useState } from 'react';
import { MapPin, Monitor, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useLocation } from '@/hooks/use-location';

/**
 * Demo component showing platform-aware location tracking
 * Displays different UI based on web vs native platform
 */
export default function LocationDemo() {
  const {
    position,
    error,
    loading,
    permissions,
    getCurrentLocation,
    requestPermissions,
    clearError,
    platformInfo
  } = useLocation();

  const [showDetails, setShowDetails] = useState(false);

  const getPlatformIcon = () => {
    if (platformInfo.isNative) {
      return <Smartphone className="h-4 w-4" />;
    }
    return <Monitor className="h-4 w-4" />;
  };

  const getPlatformBadgeVariant = () => {
    return platformInfo.isNative ? 'default' : 'secondary';
  };

  const getPermissionBadgeVariant = () => {
    switch (permissions) {
      case 'granted':
        return 'default';
      case 'denied':
        return 'destructive';
      case 'prompt':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MapPin className="h-5 w-5" />
          Location Service Demo
        </CardTitle>
        <CardDescription>
          Platform-aware location tracking for web and native apps
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Platform Information */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Platform:</span>
          <Badge variant={getPlatformBadgeVariant()} className="flex items-center gap-1">
            {getPlatformIcon()}
            {platformInfo.isNative ? `Native (${platformInfo.platform})` : 'Web'}
          </Badge>
        </div>

        {/* Permission Status */}
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Permissions:</span>
          <Badge variant={getPermissionBadgeVariant()}>
            {permissions.charAt(0).toUpperCase() + permissions.slice(1)}
          </Badge>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          {permissions !== 'granted' && (
            <Button
              variant="outline"
              onClick={requestPermissions}
              disabled={loading}
              className="flex-1"
            >
              Request Permission
            </Button>
          )}
          <Button
            onClick={getCurrentLocation}
            disabled={loading || permissions === 'denied'}
            className="flex-1"
          >
            {loading ? 'Getting Location...' : 'Get Location'}
          </Button>
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearError}
              className="mt-2 h-6 text-xs"
            >
              Clear Error
            </Button>
          </div>
        )}

        {/* Location Display */}
        {position && (
          <div className="p-3 bg-green-50 border border-green-200 rounded-md">
            <div className="flex items-center justify-between mb-2">
              <h4 className="font-medium text-green-900">Location Found</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowDetails(!showDetails)}
                className="h-6 text-xs text-green-700"
              >
                {showDetails ? 'Hide' : 'Show'} Details
              </Button>
            </div>
            
            {showDetails && (
              <div className="text-sm text-green-800 space-y-1">
                <div>Latitude: {position.latitude.toFixed(6)}</div>
                <div>Longitude: {position.longitude.toFixed(6)}</div>
                {position.accuracy && (
                  <div>Accuracy: {position.accuracy.toFixed(0)}m</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Implementation Notes */}
        <div className="text-xs text-muted-foreground space-y-1">
          <p>
            <strong>Web:</strong> Uses navigator.geolocation API
          </p>
          <p>
            <strong>Native:</strong> Uses Capacitor Geolocation plugin
          </p>
          <p>Platform detection is automatic and seamless.</p>
        </div>
      </CardContent>
    </Card>
  );
}