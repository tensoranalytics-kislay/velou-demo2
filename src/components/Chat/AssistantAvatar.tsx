'use client';

type AssistantAvatarProps = {
  size?: number; // Size in pixels, defaults to 32
  className?: string;
  noTransform?: boolean; // If true, don't apply translateY transform (for button use)
};

export default function AssistantAvatar({ 
  size = 32, 
  className = '', 
  noTransform = false 
}: AssistantAvatarProps) {
  return (
    <div 
      className={`relative ${className}`} 
      style={{ 
        width: `${size}px`, 
        height: `${size}px`,
        transform: noTransform ? 'none' : 'translateY(-5px)'
      }}
    >
      {/* Layered gradient icon - simple circular gradient with layers */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.4) 0%, transparent 50%),
            radial-gradient(circle at 70% 70%, rgba(255, 255, 255, 0.2) 0%, transparent 50%),
            linear-gradient(135deg, #FF2157 0%, #D61F2B 50%, #FF2157 100%)
          `,
          boxShadow: `
            inset 0 2px 4px rgba(255, 255, 255, 0.3),
            inset 0 -2px 4px rgba(0, 0, 0, 0.1),
            0 2px 8px rgba(214, 31, 43, 0.2)
          `,
        }}
      />
      {/* Optional: Add a subtle border ring */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2px solid rgba(255, 255, 255, 0.3)`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}
