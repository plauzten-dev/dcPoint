import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Label({ children, error, required, htmlFor }: { children: ReactNode; error?: string; required?: boolean; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn('mb-2 block text-xs font-bold uppercase tracking-wide', error ? 'text-[#fa777c]' : 'text-header-2')}>
      {children}
      {required && !error && <span className="pl-1 text-[#f23f43]">*</span>}
      {error && <span className="font-medium normal-case italic tracking-normal"> – {error}</span>}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(function Input(
  { className, invalid, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      {...rest}
      className={cn(
        'h-10 w-full rounded-[3px] bg-input-strong px-2.5 text-base text-text outline-none placeholder:text-icon-muted',
        invalid && 'ring-1 ring-[#f23f43]',
        className,
      )}
    />
  );
});

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      {...rest}
      className={cn('w-full resize-none rounded-[3px] bg-input-strong p-2.5 text-base text-text outline-none placeholder:text-icon-muted', className)}
    />
  );
});

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200', checked ? 'bg-online' : 'bg-[#80848e]')}
    >
      <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] duration-200', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn('h-px w-full bg-divider', className)} />;
}
