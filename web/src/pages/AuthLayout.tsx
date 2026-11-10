import type { ReactNode } from 'react';
import { LogoMark, Wordmark } from '../components/ui/Logo';

/** Full-screen auth backdrop with an original geometric illustration. */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-full items-center justify-center overflow-auto bg-[#1b1640] p-4">
      <svg className="pointer-events-none absolute inset-0 size-full" preserveAspectRatio="xMidYMid slice" viewBox="0 0 1600 900" aria-hidden>
        <defs>
          <linearGradient id="auth-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#2a1f6b" />
            <stop offset="0.55" stopColor="#4b3bc4" />
            <stop offset="1" stopColor="#0f8b8d" />
          </linearGradient>
        </defs>
        <rect width="1600" height="900" fill="url(#auth-bg)" />
        <g fill="none" stroke="#ffffff" strokeOpacity="0.08" strokeWidth="2">
          {Array.from({ length: 9 }, (_, i) => (
            <circle key={i} cx="1300" cy="120" r={90 + i * 85} />
          ))}
        </g>
        <g fill="#ffffff" fillOpacity="0.06">
          <rect x="120" y="620" width="220" height="140" rx="36" transform="rotate(-12 230 690)" />
          <rect x="1180" y="640" width="160" height="110" rx="28" transform="rotate(10 1260 695)" />
          <circle cx="260" cy="190" r="70" />
        </g>
      </svg>
      <div className="absolute left-8 top-7 flex items-center gap-2 text-2xl text-white max-sm:hidden">
        <LogoMark size={34} />
        <Wordmark />
      </div>
      <div className="relative w-full max-w-[480px] animate-modal-in rounded-[5px] bg-chat p-8 text-text shadow-[0_2px_10px_0_rgb(0_0_0/0.2)]">{children}</div>
    </div>
  );
}
