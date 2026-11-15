import React from 'react';
import { DeviceTelemetry } from '../types/iot';
import { Waves, AlertTriangle } from 'lucide-react';

interface AnimatedTankBannerProps {
  device: DeviceTelemetry;
  isOnline?: boolean;
}

export const AnimatedTankBanner: React.FC<AnimatedTankBannerProps> = ({
  device,
  isOnline = true,
}) => {
  const isRunning = device.status === 'ON';
  const minDoAlert = device.minDoAlert ?? 5.0;
  const isLowDo = device.doSensorConnected !== false && device.doLevel > 0 && device.doLevel < minDoAlert;

  // Determine tank state
  const tankState: 'ok' | 'calm' | 'low' = isLowDo ? 'low' : isRunning ? 'ok' : 'calm';

  return (
    <div
      className={`w-full relative rounded-[18px] overflow-hidden border-2 border-[#0E7C86] dark:border-[#19C3D1] shadow-xs select-none transition-all ${
        !isOnline ? 'filter grayscale brightness-75' : ''
      }`}
    >
      <div className="w-full h-[84px] sm:h-[96px]">
        {/* ── State 1: Generator ON (OK / Active Aeration) ────────────────── */}
        {tankState === 'ok' && (
          <svg
            className="w-full h-full block"
            viewBox="0 0 350 84"
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-label="Fish tank active aeration"
          >
            <defs>
              <linearGradient id="wga" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--wt, #CFEFF3)" />
                <stop offset="1" stopColor="var(--wb, #7CC7D2)" />
              </linearGradient>
              <linearGradient id="fga" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5F8C80" />
                <stop offset=".55" stopColor="#A9C4B9" />
                <stop offset="1" stopColor="#E6EEE8" />
              </linearGradient>

              {/* Shrimp Definition */}
              <g id="sha">
                <g transform="scale(.5)">
                  <defs>
                    <linearGradient id="sga" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#F6C4AC" />
                      <stop offset="1" stopColor="#E8957A" />
                    </linearGradient>
                    <clipPath id="sba">
                      <path d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z" />
                    </clipPath>
                  </defs>
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      values="-3 60 25;3 60 25;-3 60 25"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                    <path
                      d="M92 19C104 6 116 4 128 10M92 21C106 20 120 28 134 38M93 18C100 12 106 12 112 16"
                      fill="none"
                      stroke="#D4705A"
                      strokeWidth="1"
                      strokeLinecap="round"
                    />
                    <path d="M62 26Q60 36 54 40" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M70 28Q70 38 65 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M78 28Q80 37 76 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M85 26Q90 34 86 41" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <ellipse cx="30" cy="30" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(35 30 30)" />
                    <ellipse cx="40" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(20 40 28)" />
                    <ellipse cx="50" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(10 50 28)" />
                    <ellipse cx="60" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(5 60 28)" />
                    <g>
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        values="-10 11 44;10 11 44;-10 11 44"
                        dur=".8s"
                        repeatCount="indefinite"
                      />
                      <ellipse cx="9.9" cy="51.4" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(100 9.9 51.4)" />
                      <ellipse cx="7.0" cy="51.4" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(122 7.0 51.4)" />
                      <ellipse cx="4.4" cy="49.6" rx="8.0" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(145 4.4 49.6)" />
                      <ellipse cx="3.7" cy="46.6" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(168 3.7 46.6)" />
                      <ellipse cx="4.6" cy="43.9" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(190 4.6 43.9)" />
                    </g>
                    <path
                      d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z"
                      fill="url(#sga)"
                      stroke="#D4705A"
                      strokeWidth="1"
                    />
                    <g clipPath="url(#sba)" stroke="#D4705A" strokeWidth="1.2" opacity=".7" fill="none">
                      <path d="M60 0V34" />
                      <path d="M50 0L49 34" />
                      <path d="M40 0L37 34" />
                      <path d="M31 2L24 36" />
                      <path d="M24 8L14 38" />
                      <path d="M18 18L8 42" />
                      <path d="M67 4Q73 17 67 30" />
                    </g>
                    <path d="M90 16C82 9 70 6 58 7C42 8 26 16 19 30" fill="none" stroke="#FFE3D6" strokeWidth="3" strokeLinecap="round" opacity=".55" />
                    <path d="M88 16L108 11L92 23Z" fill="#E9967B" />
                    <circle cx="85" cy="14" r="3" fill="#1B1B1B" />
                    <circle cx="84" cy="13" r="1" fill="#fff" />
                  </g>
                </g>
              </g>

              {/* Fish Definition */}
              <g id="fsa">
                <g transform="scale(.8)">
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      values="-12 -22 0;12 -22 0;-12 -22 0"
                      dur="0.6s"
                      repeatCount="indefinite"
                    />
                    <path d="M-22 0L-42 -12C-37 -4 -37 4 -42 12Z" fill="#5F8C80" />
                  </g>
                  <path d="M-8 -11C0 -21 13 -18 15 -9Z" fill="#7FA79B" />
                  <path d="M-24 0C-18 -11 8 -13 22 -3C27 1 27 3 22 6C8 14 -18 11 -24 0Z" fill="url(#fga)" />
                  <path d="M-4 10L-11 18L5 11Z" fill="#7FA79B" />
                  <path d="M9 3L-2 10L11 8Z" fill="#7FA79B" />
                  <circle cx="16" cy="-3" r="2.6" fill="#fff" />
                  <circle cx="16.6" cy="-3" r="1.4" fill="#0B2B33" />
                  <path d="M19 4Q22 6 24 3" fill="none" stroke="#0B2B33" strokeWidth="1.2" strokeLinecap="round" />
                </g>
              </g>
            </defs>

            {/* Water and Sandy Bed */}
            <rect width="350" height="84" fill="url(#wga)" />
            <rect y="74" width="350" height="10" style={{ fill: 'var(--sand, #E9D9B5)' }} />

            {/* Oxygen Aerator Diffuser Tube */}
            <rect x="160" y="70" width="30" height="8" rx="4" fill="#0E7C86" />

            {/* Seaweeds with gentle current sway */}
            <g style={{ transformOrigin: '18px 76px', animation: 'sway 3s ease-in-out infinite alternate' }}>
              <path d="M18 76C10 62 26 50 18 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '30px 76px', animation: 'sway 4s ease-in-out infinite alternate' }}>
              <path d="M30 76C22 62 38 50 30 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '326px 76px', animation: 'sway 3.5s ease-in-out infinite alternate' }}>
              <path d="M326 76C318 62 334 50 326 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>

            {/* Rising Active Oxygen Nano-Bubbles */}
            <circle cx="180" cy="70" r="2.9" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.1s" begin="-0.2s" repeatCount="indefinite" />
              <animate attributeName="cx" values="180;192;188" dur="3.1s" begin="-0.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.1s" begin="-0.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="166" cy="70" r="1.9" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.5s" begin="-2.0s" repeatCount="indefinite" />
              <animate attributeName="cx" values="166;153;145" dur="2.5s" begin="-2.0s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.5s" begin="-2.0s" repeatCount="indefinite" />
            </circle>
            <circle cx="187" cy="70" r="2.0" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
              <animate attributeName="cx" values="187;174;213" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="167" cy="70" r="2.9" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.5s" begin="-2.3s" repeatCount="indefinite" />
              <animate attributeName="cx" values="167;154;177" dur="3.5s" begin="-2.3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.5s" begin="-2.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="185" cy="70" r="1.3" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
              <animate attributeName="cx" values="185;175;177" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.8s" begin="-2.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="186" cy="70" r="1.5" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.6s" begin="-1.2s" repeatCount="indefinite" />
              <animate attributeName="cx" values="186;198;203" dur="2.6s" begin="-1.2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.6s" begin="-1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="171" cy="70" r="1.4" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.4s" begin="-0.8s" repeatCount="indefinite" />
              <animate attributeName="cx" values="171;160;180" dur="3.4s" begin="-0.8s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.4s" begin="-0.8s" repeatCount="indefinite" />
            </circle>
            <circle cx="164" cy="70" r="2.2" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.5s" begin="-2.0s" repeatCount="indefinite" />
              <animate attributeName="cx" values="164;167;165" dur="3.5s" begin="-2.0s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.5s" begin="-2.0s" repeatCount="indefinite" />
            </circle>
            <circle cx="180" cy="70" r="2.0" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="4.1s" begin="-1.4s" repeatCount="indefinite" />
              <animate attributeName="cx" values="180;173;204" dur="4.1s" begin="-1.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="4.1s" begin="-1.4s" repeatCount="indefinite" />
            </circle>
            <circle cx="171" cy="70" r="2.5" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.8s" begin="-2.3s" repeatCount="indefinite" />
              <animate attributeName="cx" values="171;173;176" dur="2.8s" begin="-2.3s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.8s" begin="-2.3s" repeatCount="indefinite" />
            </circle>

            {/* Swimming Shrimp and Fish paths */}
            <use href="#sha">
              <animateMotion
                dur="24.0s"
                begin="0s"
                repeatCount="indefinite"
                path="M-100 50C60 48 200 54 330 50C380 49 420 51 450 50"
              />
            </use>
            <use href="#fsa">
              <animateMotion
                dur="14.0s"
                begin="0s"
                repeatCount="indefinite"
                path="M-60 26C80 18 200 40 340 26C380 22 410 26 430 28"
              />
            </use>
            <g transform="scale(-1,1)">
              <use href="#fsa" transform="scale(.75)">
                <animateMotion
                  dur="19.0s"
                  begin="-5s"
                  repeatCount="indefinite"
                  path="M-430 46C-300 54 -150 38 80 48"
                />
              </use>
            </g>
          </svg>
        )}

        {/* ── State 2: Generator OFF (Calm Water) ────────────────────────── */}
        {tankState === 'calm' && (
          <svg
            className="w-full h-full block"
            viewBox="0 0 350 84"
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-label="Fish tank calm water"
          >
            <defs>
              <linearGradient id="wgb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--wt, #CFEFF3)" />
                <stop offset="1" stopColor="var(--wb, #7CC7D2)" />
              </linearGradient>
              <linearGradient id="fgb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5F8C80" />
                <stop offset=".55" stopColor="#A9C4B9" />
                <stop offset="1" stopColor="#E6EEE8" />
              </linearGradient>
              <g id="shb">
                <g transform="scale(.5)">
                  <defs>
                    <linearGradient id="sgb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#F6C4AC" />
                      <stop offset="1" stopColor="#E8957A" />
                    </linearGradient>
                    <clipPath id="sbb">
                      <path d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z" />
                    </clipPath>
                  </defs>
                  <g>
                    <animateTransform
                      attributeName="transform"
                      type="rotate"
                      values="-3 60 25;3 60 25;-3 60 25"
                      dur="1.2s"
                      repeatCount="indefinite"
                    />
                    <path d="M92 19C104 6 116 4 128 10M92 21C106 20 120 28 134 38M93 18C100 12 106 12 112 16" fill="none" stroke="#D4705A" strokeWidth="1" strokeLinecap="round" />
                    <path d="M62 26Q60 36 54 40" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M70 28Q70 38 65 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M78 28Q80 37 76 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M85 26Q90 34 86 41" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <ellipse cx="30" cy="30" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(35 30 30)" />
                    <ellipse cx="40" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(20 40 28)" />
                    <ellipse cx="50" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(10 50 28)" />
                    <ellipse cx="60" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(5 60 28)" />
                    <g>
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        values="-10 11 44;10 11 44;-10 11 44"
                        dur=".8s"
                        repeatCount="indefinite"
                      />
                      <ellipse cx="9.9" cy="51.4" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(100 9.9 51.4)" />
                      <ellipse cx="7.0" cy="51.4" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(122 7.0 51.4)" />
                      <ellipse cx="4.4" cy="49.6" rx="8.0" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(145 4.4 49.6)" />
                      <ellipse cx="3.7" cy="46.6" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(168 3.7 46.6)" />
                      <ellipse cx="4.6" cy="43.9" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(190 4.6 43.9)" />
                    </g>
                    <path d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z" fill="url(#sgb)" stroke="#D4705A" strokeWidth="1" />
                    <g clipPath="url(#sbb)" stroke="#D4705A" strokeWidth="1.2" opacity=".7" fill="none">
                      <path d="M60 0V34" />
                      <path d="M50 0L49 34" />
                      <path d="M40 0L37 34" />
                      <path d="M31 2L24 36" />
                      <path d="M24 8L14 38" />
                      <path d="M18 18L8 42" />
                      <path d="M67 4Q73 17 67 30" />
                    </g>
                    <path d="M90 16C82 9 70 6 58 7C42 8 26 16 19 30" fill="none" stroke="#FFE3D6" strokeWidth="3" strokeLinecap="round" opacity=".55" />
                    <path d="M88 16L108 11L92 23Z" fill="#E9967B" />
                    <circle cx="85" cy="14" r="3" fill="#1B1B1B" />
                    <circle cx="84" cy="13" r="1" fill="#fff" />
                  </g>
                </g>
              </g>
              <g id="fsb">
                <g transform="scale(.8)">
                  <g>
                    <animateTransform attributeName="transform" type="rotate" values="-12 -22 0;12 -22 0;-12 -22 0" dur="0.6s" repeatCount="indefinite" />
                    <path d="M-22 0L-42 -12C-37 -4 -37 4 -42 12Z" fill="#5F8C80" />
                  </g>
                  <path d="M-8 -11C0 -21 13 -18 15 -9Z" fill="#7FA79B" />
                  <path d="M-24 0C-18 -11 8 -13 22 -3C27 1 27 3 22 6C8 14 -18 11 -24 0Z" fill="url(#fgb)" />
                  <path d="M-4 10L-11 18L5 11Z" fill="#7FA79B" />
                  <path d="M9 3L-2 10L11 8Z" fill="#7FA79B" />
                  <circle cx="16" cy="-3" r="2.6" fill="#fff" />
                  <circle cx="16.6" cy="-3" r="1.4" fill="#0B2B33" />
                  <path d="M19 4Q22 6 24 3" fill="none" stroke="#0B2B33" strokeWidth="1.2" strokeLinecap="round" />
                </g>
              </g>
            </defs>

            <rect width="350" height="84" fill="url(#wgb)" />
            <rect y="74" width="350" height="10" style={{ fill: 'var(--sand, #E9D9B5)' }} />

            {/* Inactive Diffuser */}
            <rect x="160" y="70" width="30" height="8" rx="4" fill="#5B7479" />

            {/* Seaweeds */}
            <g style={{ transformOrigin: '18px 76px', animation: 'sway 3s ease-in-out infinite alternate' }}>
              <path d="M18 76C10 62 26 50 18 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '30px 76px', animation: 'sway 4s ease-in-out infinite alternate' }}>
              <path d="M30 76C22 62 38 50 30 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '326px 76px', animation: 'sway 3.5s ease-in-out infinite alternate' }}>
              <path d="M326 76C318 62 334 50 326 30" fill="none" stroke="#2F8F5B" strokeWidth="4" strokeLinecap="round" />
            </g>

            {/* Slower, calmer swimming */}
            <use href="#shb">
              <animateMotion dur="43.2s" begin="0s" repeatCount="indefinite" path="M-100 50C60 48 200 54 330 50C380 49 420 51 450 50" />
            </use>
            <use href="#fsb">
              <animateMotion dur="25.2s" begin="0s" repeatCount="indefinite" path="M-60 26C80 18 200 40 340 26C380 22 410 26 430 28" />
            </use>
            <g transform="scale(-1,1)">
              <use href="#fsb" transform="scale(.75)">
                <animateMotion dur="34.2s" begin="-5s" repeatCount="indefinite" path="M-430 46C-300 54 -150 38 80 48" />
              </use>
            </g>
          </svg>
        )}

        {/* ── State 3: Low DO Stress Alert (Frantic Swim + Red Alert Badges) ── */}
        {tankState === 'low' && (
          <svg
            className="w-full h-full block"
            viewBox="0 0 350 84"
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-label="Fish tank low oxygen stress"
          >
            <defs>
              <linearGradient id="wgc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--wtx, #D8E6C9)" />
                <stop offset="1" stopColor="var(--wbx, #86AD93)" />
              </linearGradient>
              <linearGradient id="fgc" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5F8C80" />
                <stop offset=".55" stopColor="#A9C4B9" />
                <stop offset="1" stopColor="#E6EEE8" />
              </linearGradient>

              {/* Stressed Shrimp with Exclamation Badge */}
              <g id="shc">
                <g transform="scale(.5)">
                  <defs>
                    <linearGradient id="sgc" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0" stopColor="#F6C4AC" />
                      <stop offset="1" stopColor="#E8957A" />
                    </linearGradient>
                    <clipPath id="sbc">
                      <path d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z" />
                    </clipPath>
                  </defs>
                  <g>
                    <animateTransform attributeName="transform" type="rotate" values="-9 60 25;9 60 25;-9 60 25" dur=".3s" repeatCount="indefinite" />
                    <path d="M92 19C104 6 116 4 128 10M92 21C106 20 120 28 134 38M93 18C100 12 106 12 112 16" fill="none" stroke="#D4705A" strokeWidth="1" strokeLinecap="round" />
                    <path d="M62 26Q60 36 54 40" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M70 28Q70 38 65 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M78 28Q80 37 76 43" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M85 26Q90 34 86 41" fill="none" stroke="#D4705A" strokeWidth="1.5" strokeLinecap="round" />
                    <ellipse cx="30" cy="30" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(35 30 30)" />
                    <ellipse cx="40" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(20 40 28)" />
                    <ellipse cx="50" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(10 50 28)" />
                    <ellipse cx="60" cy="28" rx="1.8" ry="4.6" fill="#EE8E70" transform="rotate(5 60 28)" />
                    <g>
                      <animateTransform attributeName="transform" type="rotate" values="-22 11 44;22 11 44;-22 11 44" dur=".22s" repeatCount="indefinite" />
                      <ellipse cx="9.9" cy="51.4" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(100 9.9 51.4)" />
                      <ellipse cx="7.0" cy="51.4" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(122 7.0 51.4)" />
                      <ellipse cx="4.4" cy="49.6" rx="8.0" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(145 4.4 49.6)" />
                      <ellipse cx="3.7" cy="46.6" rx="7.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(168 3.7 46.6)" />
                      <ellipse cx="4.6" cy="43.9" rx="6.5" ry="3.4" fill="#EE8E70" stroke="#C85F48" strokeWidth=".6" transform="rotate(190 4.6 43.9)" />
                    </g>
                    <path d="M94 18C86 8 72 2 58 3C40 4 22 12 14 28C12 34 10 40 8 46L14 46C18 40 24 30 34 24C44 20 56 22 66 26C74 28 84 28 90 24Z" fill="url(#sgc)" stroke="#D4705A" strokeWidth="1" />
                    <g clipPath="url(#sbc)" stroke="#D4705A" strokeWidth="1.2" opacity=".7" fill="none">
                      <path d="M60 0V34" />
                      <path d="M50 0L49 34" />
                      <path d="M40 0L37 34" />
                      <path d="M31 2L24 36" />
                      <path d="M24 8L14 38" />
                      <path d="M18 18L8 42" />
                      <path d="M67 4Q73 17 67 30" />
                    </g>
                    <path d="M90 16C82 9 70 6 58 7C42 8 26 16 19 30" fill="none" stroke="#FFE3D6" strokeWidth="3" strokeLinecap="round" opacity=".55" />
                    <path d="M88 16L108 11L92 23Z" fill="#E9967B" />
                    <circle cx="85" cy="14" r="3" fill="#1B1B1B" />
                    <circle cx="84" cy="13" r="1" fill="#fff" />
                  </g>
                </g>
                {/* Shrimp Alert Icon */}
                <g>
                  <circle cx="52" cy="-3" r="5.5" fill="#E5484D" />
                  <text x="52" y="0.8" textAnchor="middle" fontSize="9" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">!</text>
                  <animate attributeName="opacity" values="1;.2;1" dur="0.6s" repeatCount="indefinite" />
                </g>
              </g>

              {/* Stressed Fish with Exclamation Badge */}
              <g id="fsc">
                <g transform="scale(.8)">
                  <g>
                    <animateTransform attributeName="transform" type="rotate" values="-7 0 0;7 0 0;-7 0 0" dur="0.25s" repeatCount="indefinite" />
                    <animateTransform attributeName="transform" type="rotate" values="-16 -22 0;16 -22 0;-16 -22 0" dur="0.2s" repeatCount="indefinite" />
                    <path d="M-22 0L-42 -12C-37 -4 -37 4 -42 12Z" fill="#5F8C80" />
                  </g>
                  <path d="M-8 -11C0 -21 13 -18 15 -9Z" fill="#7FA79B" />
                  <path d="M-24 0C-18 -11 8 -13 22 -3C27 1 27 3 22 6C8 14 -18 11 -24 0Z" fill="url(#fgc)" />
                  <path d="M-4 10L-11 18L5 11Z" fill="#7FA79B" />
                  <path d="M9 3L-2 10L11 8Z" fill="#7FA79B" />
                  <ellipse cx="23.5" cy="3" rx="2" ry="1.6" fill="#7A2E2E" />
                  <circle cx="16" cy="-3" r="3.4" fill="#fff" />
                  <circle cx="16.6" cy="-3" r="1" fill="#0B2B33" />
                  <path d="M12 -9L20 -7" stroke="#0B2B33" strokeWidth="1.3" strokeLinecap="round" />
                </g>
                {/* Fish Alert Icon */}
                <g>
                  <circle cx="12" cy="-26" r="7" fill="#E5484D" />
                  <text x="12" y="-22" textAnchor="middle" fontSize="11" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">!</text>
                  <animate attributeName="opacity" values="1;.2;1" dur="0.6s" repeatCount="indefinite" />
                </g>
              </g>
            </defs>

            <rect width="350" height="84" fill="url(#wgc)" />
            <rect y="74" width="350" height="10" style={{ fill: 'var(--sand, #E9D9B5)' }} />

            {/* Aerator Active in Emergency */}
            <rect x="160" y="70" width="30" height="8" rx="4" fill="#0E7C86" />

            {/* Yellowish stressed Seaweed */}
            <g style={{ transformOrigin: '18px 76px', animation: 'sway 3s ease-in-out infinite alternate' }}>
              <path d="M18 76C10 62 26 50 18 30" fill="none" stroke="#7A8A55" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '30px 76px', animation: 'sway 4s ease-in-out infinite alternate' }}>
              <path d="M30 76C22 62 38 50 30 30" fill="none" stroke="#7A8A55" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g style={{ transformOrigin: '326px 76px', animation: 'sway 3.5s ease-in-out infinite alternate' }}>
              <path d="M326 76C318 62 334 50 326 30" fill="none" stroke="#7A8A55" strokeWidth="4" strokeLinecap="round" />
            </g>

            {/* Aeration bubbles */}
            <circle cx="181" cy="70" r="2.5" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="2.9s" begin="-3.9s" repeatCount="indefinite" />
              <animate attributeName="cx" values="181;170;187" dur="2.9s" begin="-3.9s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="2.9s" begin="-3.9s" repeatCount="indefinite" />
            </circle>
            <circle cx="186" cy="70" r="1.5" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.0s" begin="-3.7s" repeatCount="indefinite" />
              <animate attributeName="cx" values="186;185;162" dur="3.0s" begin="-3.7s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.0s" begin="-3.7s" repeatCount="indefinite" />
            </circle>
            <circle cx="164" cy="70" r="2.6" fill="#fff" opacity="0">
              <animate attributeName="cy" values="72;4" dur="3.4s" begin="-3.5s" repeatCount="indefinite" />
              <animate attributeName="cx" values="164;160;159" dur="3.4s" begin="-3.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0;.85;0" dur="3.4s" begin="-3.5s" repeatCount="indefinite" />
            </circle>

            {/* Amber emergency water tint pulse */}
            <rect width="350" height="84" fill="#E8A33D" opacity="0">
              <animate attributeName="opacity" values="0;.22;0" dur="1.2s" repeatCount="indefinite" />
            </rect>

            {/* Frantic Fast Movement Paths */}
            <use href="#shc">
              <animateMotion
                dur="7.0s"
                begin="0s"
                repeatCount="indefinite"
                path="M-60 56C-20 36 20 56 60 28S140 54 180 24S260 56 300 32S370 52 420 54"
              />
            </use>
            <use href="#fsc">
              <animateMotion
                dur="4.5s"
                begin="0s"
                repeatCount="indefinite"
                path="M-70 12C-20 24 30 6 80 20S180 6 230 18S330 8 430 16"
              />
            </use>
            <g transform="scale(-1,1)">
              <use href="#fsc" transform="scale(.75)">
                <animateMotion
                  dur="5.5s"
                  begin="-2s"
                  repeatCount="indefinite"
                  path="M-430 20C-360 8 -300 28 -230 10S-120 28 -60 12S20 24 80 16"
                />
              </use>
            </g>
          </svg>
        )}
      </div>
    </div>
  );
};
