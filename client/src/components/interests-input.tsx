import { FC, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface InterestsInputProps {
  value: string[];
  onChange: (interests: string[]) => void;
  placeholder?: string;
  maxItems?: number;
  className?: string;
}

export const InterestsInput: FC<InterestsInputProps> = ({ 
  value, 
  onChange,
  placeholder = "Add interests...",
  maxItems = 10,
  className,
}) => {
  // Don't default to empty array - use what's provided or nothing
  const interests = value;
  const [inputValue, setInputValue] = useState("");

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && inputValue.trim()) {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleAdd = () => {
    // Handle the case where interests might be undefined
    const currentInterests = interests || [];
    if (inputValue.trim() && currentInterests.length < maxItems && !currentInterests.includes(inputValue.trim())) {
      onChange([...currentInterests, inputValue.trim()]);
      setInputValue("");
    }
  };

  const removeInterest = (indexToRemove: number) => {
    // Handle the case where interests might be undefined
    const currentInterests = interests || [];
    onChange(currentInterests.filter((_, index) => index !== indexToRemove));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
          disabled={(interests || []).length >= maxItems}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={handleAdd}
          disabled={(interests || []).length >= maxItems || !inputValue.trim()}
        >
          Add
        </Button>
      </div>

      {interests && interests.length > 0 && (
        <div className="flex flex-wrap gap-2 p-2 bg-muted/30 rounded-md min-h-[2.5rem]">
          {interests.map((interest, index) => (
            <div
              key={index}
              className="flex items-center gap-1 bg-primary/10 dark:bg-primary/20 px-2 py-1 rounded-md"
            >
              <span className="text-sm">{interest}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-4 w-4 p-0 hover:bg-transparent"
                onClick={() => removeInterest(index)}
              >
                <X className="h-3 w-3" />
                <span className="sr-only">Remove {interest}</span>
              </Button>
            </div>
          ))}
        </div>
      )}

      {interests && interests.length >= maxItems && (
        <p className="text-xs text-muted-foreground mt-1">
          Maximum number of items reached ({maxItems})
        </p>
      )}
    </div>
  );
};

export default InterestsInput;