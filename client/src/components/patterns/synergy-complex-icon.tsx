import React from 'react';

interface SynergyComplexIconProps {
  className?: string;
  size?: number;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  style?: React.CSSProperties;
}

export const SynergyComplexIcon: React.FC<SynergyComplexIconProps> = ({
  className,
  size = 24,
  primaryColor = '#4A5568',
  secondaryColor = '#A0AEC0',
  accentColor = '#fff',
  style
}) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 800 800"
      className={className}
      style={style}
    >
      {/* Background network grid */}
      <g>
        {/* Core network pattern */}
        {/* Main nodes */}
        <circle cx="400" cy="400" r="16" fill={accentColor} />
        <circle cx="300" cy="300" r="10" fill={accentColor} />
        <circle cx="500" cy="500" r="10" fill={accentColor} />
        <circle cx="300" cy="500" r="10" fill={accentColor} />
        <circle cx="500" cy="300" r="10" fill={accentColor} />
        
        {/* Smaller connected nodes */}
        <circle cx="250" cy="250" r="6" fill={accentColor} />
        <circle cx="550" cy="550" r="6" fill={accentColor} />
        <circle cx="250" cy="550" r="6" fill={accentColor} />
        <circle cx="550" cy="250" r="6" fill={accentColor} />
        <circle cx="400" cy="200" r="6" fill={accentColor} />
        <circle cx="400" cy="600" r="6" fill={accentColor} />
        <circle cx="200" cy="400" r="6" fill={accentColor} />
        <circle cx="600" cy="400" r="6" fill={accentColor} />
        
        {/* Primary connections - from center */}
        <line x1="400" y1="400" x2="300" y2="300" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="500" y2="500" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="300" y2="500" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="500" y2="300" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="400" y2="200" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="400" y2="600" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="200" y2="400" stroke={secondaryColor} strokeWidth="2" />
        <line x1="400" y1="400" x2="600" y2="400" stroke={secondaryColor} strokeWidth="2" />
        
        {/* Secondary connections */}
        <line x1="300" y1="300" x2="250" y2="250" stroke={secondaryColor} strokeWidth="1.5" opacity="0.8" />
        <line x1="500" y1="500" x2="550" y2="550" stroke={secondaryColor} strokeWidth="1.5" opacity="0.8" />
        <line x1="300" y1="500" x2="250" y2="550" stroke={secondaryColor} strokeWidth="1.5" opacity="0.8" />
        <line x1="500" y1="300" x2="550" y2="250" stroke={secondaryColor} strokeWidth="1.5" opacity="0.8" />
        
        {/* Cross connections */}
        <line x1="300" y1="300" x2="500" y2="300" stroke={secondaryColor} strokeWidth="1" opacity="0.6" strokeDasharray="5,5" />
        <line x1="300" y1="500" x2="500" y2="500" stroke={secondaryColor} strokeWidth="1" opacity="0.6" strokeDasharray="5,5" />
        <line x1="300" y1="300" x2="300" y2="500" stroke={secondaryColor} strokeWidth="1" opacity="0.6" strokeDasharray="5,5" />
        <line x1="500" y1="300" x2="500" y2="500" stroke={secondaryColor} strokeWidth="1" opacity="0.6" strokeDasharray="5,5" />
        <line x1="300" y1="300" x2="500" y2="500" stroke={secondaryColor} strokeWidth="1" opacity="0.4" strokeDasharray="3,3" />
        <line x1="300" y1="500" x2="500" y2="300" stroke={secondaryColor} strokeWidth="1" opacity="0.4" strokeDasharray="3,3" />
      </g>
      
      {/* Central Synergy icon, scaled down and positioned */}
      <g transform="translate(340,340) scale(0.012,-0.012)" fill={primaryColor}>
        <path d="M2153 4474 c-53 -19 -138 -94 -163 -144 -10 -20 -52 -169 -94 -331 -41 -162 -86 -337 -99 -389 -14 -52 -55 -212 -92 -355 -37 -143 -73 -271 -80 -285 -15 -28 -60 -73 -90 -88 -23 -11 -210 -61 -900 -237 -354 -90 -402 -104 -440 -119 -46 -20 -111 -81 -143 -135 -24 -41 -27 -56 -27 -136 0 -78 4 -97 27 -141 28 -53 77 -103 128 -129 17 -9 178 -54 358 -100 180 -46 408 -104 507 -130 517 -133 489 -124 531 -157 41 -33 59 -82 129 -353 37 -143 78 -303 91 -355 14 -52 59 -228 100 -389 42 -162 82 -307 90 -323 40 -76 118 -136 210 -159 108 -26 236 28 306 131 33 49 46 88 113 355 42 165 114 444 160 620 45 176 86 335 90 353 4 17 9 32 12 32 3 0 125 -116 271 -257 145 -142 308 -299 361 -350 l96 -91 -31 -34 c-46 -48 -64 -90 -64 -146 0 -93 61 -169 157 -195 37 -10 43 -15 52 -52 24 -94 100 -155 194 -155 90 0 170 61 192 145 11 44 14 48 64 65 152 51 199 222 89 332 -21 21 -55 42 -80 49 -56 16 -65 24 -72 62 -28 150 -217 203 -332 93 l-43 -41 -88 84 c-288 275 -634 614 -630 617 1 2 73 21 160 43 86 23 228 59 315 82 86 22 306 78 487 125 363 93 394 106 456 188 44 58 59 104 59 181 0 77 -15 123 -59 181 -58 76 -103 94 -456 184 -176 45 -389 99 -473 121 -84 22 -217 55 -295 75 -78 20 -143 37 -145 39 -4 3 595 454 612 461 10 4 15 -11 18 -55 6 -81 39 -130 113 -166 42 -21 64 -26 92 -22 66 11 125 49 157 100 28 45 30 56 34 177 l5 130 116 0 c120 0 177 15 224 58 52 47 73 154 43 225 -17 43 -76 93 -123 106 -21 6 -89 11 -150 11 -62 0 -113 3 -114 8 -1 4 -2 61 -3 127 -2 137 -14 173 -69 222 -88 77 -237 55 -299 -45 -20 -32 -24 -54 -28 -172 l-5 -135 -130 -5 c-152 -6 -197 -23 -242 -92 -24 -35 -28 -52 -28 -108 0 -56 4 -73 28 -109 37 -55 110 -91 187 -91 54 0 54 0 35 -19 -51 -48 -639 -481 -649 -478 -6 2 -34 93 -62 203 -28 109 -88 343 -133 519 -46 176 -97 379 -115 451 -18 71 -41 147 -51 167 -23 50 -86 111 -142 138 -59 29 -171 35 -230 13z" />
      </g>
    </svg>
  );
};

export default SynergyComplexIcon;