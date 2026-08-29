import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";
import typography from "@tailwindcss/typography";

export default {
  darkMode: ["class"],
  content: ["./client/index.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    screens: {
      'desktop': '1024px',
    },
    extend: {
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      colors: {
        background: "white",
        foreground: "hsl(215, 25%, 27%)",
        card: {
          DEFAULT: "white",
          foreground: "hsl(215, 25%, 27%)",
        },
        popover: {
          DEFAULT: "white",
          foreground: "hsl(215, 25%, 27%)",
        },
        primary: {
          DEFAULT: "hsl(215, 25%, 27%)",
          foreground: "white",
        },
        secondary: {
          DEFAULT: "hsl(215, 20%, 65%)",
          foreground: "white",
        },
        muted: {
          DEFAULT: "hsl(215, 20%, 95%)",
          foreground: "hsl(215, 25%, 27%)",
        },
        accent: {
          DEFAULT: "hsl(215, 20%, 65%)",
          foreground: "white",
        },
        destructive: {
          DEFAULT: "hsl(0, 84%, 60%)",
          foreground: "white",
        },
        border: "hsl(215, 20%, 65%)",
        input: "hsl(215, 20%, 95%)",
        ring: "hsl(215, 25%, 27%)",
        chart: {
          "1": "hsl(215, 25%, 27%)",
          "2": "hsl(215, 20%, 65%)",
          "3": "hsl(215, 20%, 45%)",
          "4": "hsl(215, 25%, 35%)",
          "5": "hsl(215, 25%, 55%)",
        },
        sidebar: {
          DEFAULT: "white",
          foreground: "hsl(215, 25%, 27%)",
          primary: "hsl(215, 25%, 27%)",
          "primary-foreground": "white",
          accent: "hsl(215, 20%, 65%)",
          "accent-foreground": "white",
          border: "hsl(215, 20%, 65%)",
          ring: "hsl(215, 25%, 27%)",
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "shine": {
          "0%": { transform: "translateX(-100%)" },
          "50%, 100%": { transform: "translateX(100%)" },
        },
        "shine-slow": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "shine": "shine 3s infinite",
        "shine-slow": "shine-slow 5s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate, typography],
} satisfies Config;