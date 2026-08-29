import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';

interface APIService {
  available: boolean;
  service: string;
}

interface APIStatus {
  api_proxy: string;
  services: {
    geocoding: APIService;
    ai_matching: APIService;
    firebase: APIService;
  };
  timestamp: string;
}

export function APIStatusCard() {
  const [status, setStatus] = useState<APIStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkStatus = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await apiClient.getAPIStatus();
        
        if (result) {
          setStatus(result);
        } else {
          setError('Unable to check API status');
        }
      } catch (err) {
        setError('Failed to connect to API proxy');
        console.error('[API Status] Error:', err);
      } finally {
        setLoading(false);
      }
    };

    checkStatus();
    
    // Check status every 30 seconds
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = (available: boolean) => {
    return (
      <Badge variant={available ? "default" : "destructive"}>
        {available ? "Available" : "Unavailable"}
      </Badge>
    );
  };

  if (loading) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>API Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">Checking services...</p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>API Status</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!status) {
    return null;
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>API Services Status</CardTitle>
        <p className="text-sm text-muted-foreground">
          Last updated: {new Date(status.timestamp).toLocaleTimeString()}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between items-center">
          <span className="font-medium">API Proxy</span>
          <Badge variant="default">Operational</Badge>
        </div>
        
        <div className="flex justify-between items-center">
          <span>Location Services</span>
          {getStatusBadge(status.services.geocoding.available)}
        </div>
        
        <div className="flex justify-between items-center">
          <span>AI Matching</span>
          {getStatusBadge(status.services.ai_matching.available)}
        </div>
        
        <div className="flex justify-between items-center">
          <span>Firebase Storage</span>
          {getStatusBadge(status.services.firebase.available)}
        </div>

        {!status.services.geocoding.available && (
          <p className="text-sm text-muted-foreground mt-4">
            ℹ️ Some features may use fallback data when services are unavailable.
          </p>
        )}
      </CardContent>
    </Card>
  );
}