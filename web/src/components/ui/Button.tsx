import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

type Variant = 'brand' | 'secondary' | 'danger' | 'link' | 'success' | 'outline';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  grow?: boolean;
}

const variants: Record<Variant, string> = {
  brand: 'bg-brand text-white hover:bg-brand-hover active:bg-brand-active',
  secondary: 'bg-[#4e5058] text-white hover:bg-[#6d6f78] active:bg-[#80848e]',
  danger: 'bg-danger text-white hover:bg-danger-hover',
  success: 'bg-[#248046] text-white hover:bg-[#1a6334]',
  outline: 'border border-[#4e5058] text-text hover:border-[#6d6f78] hover:bg-hover',
  link: 'bg-transparent text-text hover:underline',
};

const sizes = { sm: 'h-8 min-w-[60px] px-4 text-sm', md: 'h-[38px] min-w-[96px] px-4 text-sm', lg: 'h-11 min-w-[130px] px-5 text-base' };

export function Button({ variant = 'brand', size = 'md', loading, grow, className, children, disabled, ...rest }: Props) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cn(
        'relative inline-flex items-center justify-center rounded-[3px] font-medium transition-colors duration-150 disabled:opacity-50',
        variants[variant],
        sizes[size],
        grow && 'w-full',
        className,
      )}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>{children}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center gap-1" aria-label="Lädt">
          {[0, 1, 2].map((i) => (
            <span key={i} className="size-1.5 animate-pulse rounded-full bg-current" style={{ animationDelay: `${i * 150}ms` }} />
          ))}
        </span>
      )}
    </button>
  );
}
