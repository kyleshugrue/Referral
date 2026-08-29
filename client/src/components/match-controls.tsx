import { Button } from "./ui/button";
import { X, Check } from "lucide-react";

interface MatchControlsProps {
  onMatch: () => void;
  onSkip: () => void;
}

export default function MatchControls({ onMatch, onSkip }: MatchControlsProps) {
  return (
    <div className="flex justify-center gap-4">
      <Button
        size="lg"
        variant="outline"
        className="rounded-full w-16 h-16"
        onClick={onSkip}
      >
        <X className="h-8 w-8" />
      </Button>
      <Button
        size="lg"
        className="rounded-full w-16 h-16"
        onClick={onMatch}
      >
        <Check className="h-8 w-8" />
      </Button>
    </div>
  );
}
