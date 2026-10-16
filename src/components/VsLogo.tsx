interface VsLogoProps {
  size?: number;
  className?: string;
  rounded?: boolean;
}

export default function VsLogo({ size = 40, className = '', rounded = true }: VsLogoProps) {
  return (
    <img
      src="/vs-stage-icon.png"
      alt="VS Stage Pro"
      width={size}
      height={size}
      style={{ width: `${size}px`, height: `${size}px` }}
      className={`object-contain select-none shrink-0 drop-shadow-[0_4px_16px_rgba(255,159,10,0.35)] transition-transform duration-200 ${rounded ? 'rounded-[22%]' : ''} ${className}`}
      draggable={false}
    />
  );
}

export function VsFullLogo({ height = 48, className = '' }: { height?: number; className?: string }) {
  return (
    <img
      src="/vs-stage-logo.png"
      alt="VS Stage Pro"
      style={{ height: `${height}px` }}
      className={`object-contain select-none drop-shadow-[0_6px_20px_rgba(255,159,10,0.4)] ${className}`}
      draggable={false}
    />
  );
}
