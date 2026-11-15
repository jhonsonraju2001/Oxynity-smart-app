import React from 'react';
import oxynityLogoImg from '../assets/oxynity-logo.png';

interface OxynityLogoProps {
  compact?: boolean;
  className?: string;
  lightBackground?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export const OxynityLogo: React.FC<OxynityLogoProps> = ({
  compact = false,
  className = '',
  lightBackground = true,
  size = 'md',
}) => {
  const sizeClasses = {
    sm: { img: 'w-7 h-7', text: 'text-lg', badge: 'text-[9px]', sub: 'text-[7px]' },
    md: { img: 'w-10 h-10', text: 'text-xl', badge: 'text-[10px]', sub: 'text-[8px]' },
    lg: { img: 'w-14 h-14', text: 'text-2xl', badge: 'text-xs', sub: 'text-[9px]' },
    xl: { img: 'w-20 h-20', text: 'text-3xl', badge: 'text-sm', sub: 'text-[10px]' },
  }[size];

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {/* Official Oxynity Logo Graphic */}
      <div className={`relative ${sizeClasses.img} shrink-0 flex items-center justify-center`}>
        <img
          src={oxynityLogoImg}
          alt="Oxynity Logo"
          className="w-full h-full object-contain drop-shadow-sm select-none"
        />
      </div>

      {!compact && (
        <div className="flex flex-col select-none">
          <div className="flex items-center gap-1.5 leading-none">
            <span
              className={`font-black tracking-tight italic font-sans ${sizeClasses.text} ${
                lightBackground ? 'text-sky-700' : 'text-sky-400'
              }`}
            >
              OXYNITY
            </span>
            <span
              className={`font-black uppercase tracking-wider px-1.5 py-0.5 rounded-md leading-none ${
                sizeClasses.badge
              } ${
                lightBackground
                  ? 'bg-sky-100 text-sky-800 border border-sky-200'
                  : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
              }`}
            >
              SMART
            </span>
          </div>
          <span
            className={`font-bold tracking-widest uppercase leading-tight mt-1 ${
              sizeClasses.sub
            } ${lightBackground ? 'text-slate-500' : 'text-slate-400'}`}
          >
            MICRO - NANO BUBBLE GENERATORS
          </span>
        </div>
      )}
    </div>
  );
};
