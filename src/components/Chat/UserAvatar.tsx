'use client';

type UserAvatarProps = {
  size?: number; // Size in pixels, defaults to 32
  className?: string;
  noTransform?: boolean; // If true, don't apply translateY transform (for button use)
};

export default function UserAvatar({ 
  size = 32, 
  className = '', 
  noTransform = false 
}: UserAvatarProps) {
  return (
    <div 
      className={`relative ${className}`} 
      style={{ 
        width: `${size}px`, 
        height: `${size}px`,
        transform: noTransform ? 'none' : 'translateY(4px)'
      }}
    >
      {/* Layered gradient icon - white to light grey gradient with layers */}
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: `
            radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.6) 0%, transparent 50%),
            radial-gradient(circle at 70% 70%, rgba(255, 255, 255, 0.3) 0%, transparent 50%),
            linear-gradient(135deg, #FFFFFF 0%, #E5E7EB 50%, #D1D5DB 100%)
          `,
          boxShadow: `
            inset 0 2px 4px rgba(255, 255, 255, 0.5),
            inset 0 -2px 4px rgba(0, 0, 0, 0.1),
            0 2px 8px rgba(0, 0, 0, 0.1)
          `,
        }}
      />
      {/* Clear grey outline border */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `1px solid #D1D5DB`,
          pointerEvents: 'none',
        }}
      />
    </div>
  );
}

