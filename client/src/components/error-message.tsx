import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorMessageProps {
  title: string;
  description?: string;
  onRetry?: () => void;
}

export default function ErrorMessage({ 
  title = "Error loading messages", 
  onRetry 
}: ErrorMessageProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full p-4 text-center">
      {/* Tinder uses a filled red circle with exclamation mark */}
      <div className="w-12 h-12 rounded-full mb-5 flex items-center justify-center">
        <AlertCircle className="h-12 w-12 text-red-500" />
      </div>
      
      {/* Simple error title - no description in Tinder UI */}
      <h3 className="text-base font-normal text-red-500 mb-5">{title}</h3>
      
      {/* Try Again button that matches Tinder's styling */}
      {onRetry && (
        <Button 
          onClick={onRetry}
          variant="outline"
          className="rounded-full px-6 py-2 text-sm border-gray-300 text-gray-700 hover:bg-gray-50 flex items-center gap-2"
        >
          <RefreshCw className="h-4 w-4" /> 
          Try Again
        </Button>
      )}
    </div>
  );
}