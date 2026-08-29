import { Component, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      userAgent: navigator.userAgent,
    };
    
    console.error('[ErrorBoundary] ===== ERROR CAUGHT =====');
    console.error('[ErrorBoundary] Error:', error);
    console.error('[ErrorBoundary] Message:', error.message);
    console.error('[ErrorBoundary] Stack:', error.stack);
    console.error('[ErrorBoundary] Component Stack:', errorInfo.componentStack);
    console.error('[ErrorBoundary] Full Details:', errorDetails);
    console.error('[ErrorBoundary] ========================');
    
    // Persist error to localStorage for debugging
    try {
      const existingErrors = JSON.parse(localStorage.getItem('app_errors') || '[]');
      existingErrors.push(errorDetails);
      // Keep only last 10 errors
      if (existingErrors.length > 10) existingErrors.shift();
      localStorage.setItem('app_errors', JSON.stringify(existingErrors));
      console.log('[ErrorBoundary] Error logged to localStorage key: app_errors');
    } catch (e) {
      console.error('[ErrorBoundary] Failed to persist error to localStorage:', e);
    }
    
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    console.log('[ErrorBoundary] Resetting error state');
    
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      const errorMessage = this.state.error?.message || 'An unexpected error occurred';
      const customMessage = this.props.fallbackMessage || 'Something went wrong while loading this page.';

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full space-y-6">
            <div className="flex flex-col items-center text-center space-y-4">
              <div className="rounded-full bg-destructive/10 p-4">
                <AlertCircle className="w-12 h-12 text-destructive" />
              </div>
              
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight">
                  Oops! Something Went Wrong
                </h1>
                <p className="text-muted-foreground">
                  {customMessage}
                </p>
              </div>

              {process.env.NODE_ENV === 'development' && this.state.error && (
                <div className="w-full p-4 bg-muted rounded-lg text-left">
                  <p className="text-xs font-mono text-destructive break-words">
                    {errorMessage}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-3 w-full">
                <Button
                  onClick={this.handleReset}
                  className="w-full"
                  size="lg"
                  data-testid="button-error-retry"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
                
                <Button
                  variant="outline"
                  onClick={() => window.location.href = '/'}
                  className="w-full"
                  size="lg"
                  data-testid="button-error-home"
                >
                  Go to Home
                </Button>
              </div>

              <p className="text-xs text-muted-foreground">
                Your progress has been saved and will be restored when you try again.
              </p>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
