import { type MouseEvent } from "react";
import { ChevronLeft } from "lucide-react";
import { useLocation } from "wouter";

export const AlwaysVisibleBackButton = () => {
  const [, navigate] = useLocation();

  const goToConnections = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setTimeout(() => {
      navigate("/connections");
    }, 0);
  };

  return (
    <button
      type="button"
      aria-label="Back to connections"
      onClick={goToConnections}
      className="flex items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{
        background: "transparent",
        border: "none",
        color: "hsl(215,25%,27%)",
        cursor: "pointer",
        padding: 0,
        width: "36px",
        height: "36px",
      }}
    >
      <ChevronLeft width={30} height={30} strokeWidth={3} />
    </button>
  );
};