import React from 'react';

interface MetalribLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const MetalribLogo: React.FC<MetalribLogoProps> = ({
  className = '',
  size = 'md'
}) => {
  const dimensions = {
    sm: { width: 140, height: 46, fontSizeMain: 22, fontSizeSub: 9.5, strokeWidth: 1.5 },
    md: { width: 190, height: 62, fontSizeMain: 30, fontSizeSub: 13, strokeWidth: 2 },
    lg: { width: 250, height: 82, fontSizeMain: 40, fontSizeSub: 17, strokeWidth: 2.5 },
    xl: { width: 320, height: 104, fontSizeMain: 52, fontSizeSub: 22, strokeWidth: 3 }
  }[size];

  return (
    <div className={`inline-flex items-center select-none ${className}`} title="Metalrib Portas Frigoríficas">
      <svg
        viewBox="0 0 260 84"
        width={dimensions.width}
        height={dimensions.height}
        xmlns="http://www.w3.org/2000/svg"
        className="drop-shadow-md"
      >
        {/* Borda Externa Sutil */}
        <rect
          x="3"
          y="3"
          width="254"
          height="78"
          rx="12"
          ry="12"
          fill="#1C2F8A"
          stroke="#090E26"
          strokeWidth="4"
        />

        {/* Linha Interna de Contorno Fina */}
        <rect
          x="6"
          y="6"
          width="248"
          height="72"
          rx="9"
          ry="9"
          fill="none"
          stroke="rgba(255, 255, 255, 0.2)"
          strokeWidth="1"
        />

        {/* Texto METALRIB Principal */}
        <text
          x="130"
          y="42"
          fill="#FFFFFF"
          textAnchor="middle"
          fontSize="37"
          fontWeight="700"
          fontFamily="'Plus Jakarta Sans', 'Arial', sans-serif"
          letterSpacing="2.5px"
        >
          METALRIB
        </text>

        {/* Linha Horizontal Sublinhada de Destaque */}
        <line
          x1="28"
          y1="49"
          x2="232"
          y2="49"
          stroke="#FFFFFF"
          strokeWidth="2.4"
          strokeLinecap="square"
        />

        {/* Subtítulo PORTAS FRIGORÍFICAS */}
        <text
          x="130"
          y="68"
          fill="#FFFFFF"
          textAnchor="middle"
          fontSize="15"
          fontWeight="500"
          fontFamily="'Plus Jakarta Sans', 'Arial', sans-serif"
          letterSpacing="4.2px"
        >
          PORTAS FRIGORÍFICAS
        </text>
      </svg>
    </div>
  );
};
