export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" className={className} aria-hidden>
      <path
        d="M6 9.5C6 6.5 8.5 4 11.5 4h25C39.5 4 42 6.5 42 9.5v19c0 3-2.5 5.5-5.5 5.5H22l-10.6 8.5c-1.1.9-2.9.1-2.9-1.4V34h-.5A2.5 2.5 0 0 1 6 31.5z"
        fill="currentColor"
      />
      <circle cx="24" cy="19" r="5.5" fill="var(--logo-dot, #6c5cf6)" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="font-extrabold tracking-tight">dc</span>
      <span className="font-extrabold tracking-tight text-brand">Point</span>
    </div>
  );
}
