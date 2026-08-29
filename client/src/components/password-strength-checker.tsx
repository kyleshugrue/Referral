import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

interface PasswordRequirement {
  id: string;
  label: string;
  check: (password: string) => boolean;
}

interface PasswordStrengthCheckerProps {
  password: string;
  showChecker?: boolean;
}

const PASSWORD_REQUIREMENTS: PasswordRequirement[] = [
  {
    id: "min-length",
    label: "At least 8 characters",
    check: (password) => password.length >= 8,
  },
  {
    id: "uppercase",
    label: "At least one uppercase letter",
    check: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "At least one lowercase letter",
    check: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "At least one number",
    check: (password) => /[0-9]/.test(password),
  },
  {
    id: "special",
    label: "At least one special character",
    check: (password) => /[!@#$%^&*(),.?":{}|<>]/.test(password),
  },
];

export default function PasswordStrengthChecker({ password, showChecker = true }: PasswordStrengthCheckerProps) {
  const [failedRequirements, setFailedRequirements] = useState<string[]>([]);

  useEffect(() => {
    if (!password) {
      setFailedRequirements(PASSWORD_REQUIREMENTS.map(req => req.id));
      return;
    }

    // Check which requirements are not met
    const newFailedReqs = PASSWORD_REQUIREMENTS
      .filter(req => !req.check(password))
      .map(req => req.id);
    
    setFailedRequirements(newFailedReqs);
  }, [password]);

  // Don't show the component if:
  // 1. showChecker is false
  // 2. there's no password (user hasn't started typing)
  // 3. all requirements are met
  if (!showChecker || !password || (password && failedRequirements.length === 0)) {
    return null;
  }

  return (
    <div className="space-y-2 mt-2 p-3 bg-gray-50 rounded border border-gray-200 text-sm">
      <div className="font-medium text-[hsl(215,25%,27%)] mb-1">Password must have:</div>
      {PASSWORD_REQUIREMENTS.map((req) => {
        const isFailed = failedRequirements.includes(req.id);
        
        return (
          <div key={req.id} className="flex items-center gap-2">
            {isFailed ? (
              <X className="h-4 w-4 text-[hsl(0,72%,51%)]" aria-hidden="true" />
            ) : (
              <Check className="h-4 w-4 text-[hsl(142,76%,36%)]" aria-hidden="true" />
            )}
            <span className={isFailed ? "text-[hsl(0,72%,51%)]" : "text-[hsl(142,76%,36%)]"}>
              {req.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}