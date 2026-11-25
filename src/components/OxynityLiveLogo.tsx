import React, { useEffect, useState } from 'react';
import oxynityLogoImg from '../assets/oxynity-logo.png';
import { LOGO_BUBBLES } from '../data/oxynityAdminData';

export const OxynityLiveLogo: React.FC<{ size?: number; className?: string }> = ({
  size = 50,
  className = '',
}) => {
  const scale = (size / 284).toFixed(4);
  const animDelay = `-${((Date.now() % 2000) / 1000).toFixed(3)}s`;

  return (
    <div
      className={`relative select-none shrink-0 overflow-visible ${className}`}
      style={{ width: `${size}px`, height: `${size}px` }}
      role="img"
      aria-label="Oxynity Logo"
    >
      <div
        className="oxlogo origin-top-left absolute inset-0"
        style={{
          width: '284px',
          height: '284px',
          transform: `scale(${scale})`,
        }}
      >
        <img
          src={oxynityLogoImg}
          alt="Oxynity"
          className="absolute inset-0 w-[284px] h-[284px] object-contain select-none"
        />
        {LOGO_BUBBLES.map((b, i) => {
          const style = {
            left: `${(b[0] - b[2]).toFixed(1)}px`,
            top: `${(b[1] - b[2]).toFixed(1)}px`,
            width: `${(b[2] * 2).toFixed(1)}px`,
            height: `${(b[2] * 2).toFixed(1)}px`,
            '--dx': `${b[3]}px`,
            '--dy': `${b[4]}px`,
            '--k': b[5],
            '--ad': animDelay,
          } as React.CSSProperties;
          const cls = b[6] ? 'e' : 'f';
          return (
            <span
              key={`b-${i}`}
              className={`${cls} absolute rounded-full bg-[#6CCBF2]`}
              style={style}
            />
          );
        })}
      </div>
    </div>
  );
};

export const OxynitySplashScreen: React.FC<{ onDismiss: () => void }> = ({ onDismiss }) => {
  const [fading, setFading] = useState(false);
  // The parent re-renders every second (live data). Keep the latest callback in a ref so the
  // 2.8 s timer is started once and is not restarted on every render (it used to never close).
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  const done = React.useRef(false);
  const close = () => {
    if (done.current) return;
    done.current = true;
    setFading(true);
    setTimeout(() => dismissRef.current(), 500);
  };

  useEffect(() => {
    const timer = setTimeout(close, 2800);
    return () => clearTimeout(timer);
  }, []);

  const handleClick = close;

  return (
    <div
      id="splash"
      onClick={handleClick}
      className={`fixed inset-0 z-[5000] flex flex-col items-center justify-center gap-6 cursor-pointer transition-opacity duration-500 ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        background: 'linear-gradient(160deg, #0E4D7A 0%, #0B2440 55%, #061528 100%)',
      }}
      role="dialog"
      aria-label="Oxynity Smart"
    >
      <div
        className="absolute left-1/2 top-[42%] w-[520px] h-[520px] -ml-[260px] -mt-[260px] rounded-full pointer-events-none animate-pulse"
        style={{
          background: 'radial-gradient(circle, rgba(108,203,242,0.28) 0%, rgba(108,203,242,0) 65%)',
        }}
      />
      <div className="relative">
        <OxynityLiveLogo size={180} />
      </div>
      <div className="flex flex-col items-center leading-none select-none">
        <b className="font-black italic text-white text-5xl tracking-wide">OXYNITY</b>
        <i className="font-bold italic text-[#6CCBF2] text-2xl tracking-[0.34em] mt-2 pl-2">
          SMART
        </i>
      </div>
      <span className="absolute bottom-10 text-xs text-[#7FA6C4] tracking-wide animate-bounce">
        Tap to continue
      </span>
    </div>
  );
};
