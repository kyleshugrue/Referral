import { Textarea } from "@/components/ui/textarea";

interface BioEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}

export default function BioEditor({
  value,
  onChange,
  disabled,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: BioEditorProps) {
  const MAX_LENGTH = 500;

  return (
    <div className="space-y-2" data-keyboard-type="textarea">
      <Textarea
        value={value}
        onChange={(e) => {
          const newValue = e.target.value;
          if (newValue.length <= MAX_LENGTH) {
            onChange(newValue);
          }
        }}
        placeholder="Write a brief bio about yourself..."
        className="min-h-[200px] resize-none"
        disabled={disabled}
        id={id}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        data-keyboard-type="textarea"
      />
      <div className="text-xs text-muted-foreground text-right">
        {value?.length || 0}/{MAX_LENGTH} characters
      </div>
    </div>
  );
}