import type { LucideIcon } from 'lucide-react';

const inputCls = 'w-full bg-logic-bg-deep text-sm text-logic-text pl-9 pr-3 py-2.5 rounded-lg border border-logic-border-light outline-none focus:border-logic-accent transition-colors placeholder:text-logic-text-muted';

export default function Field({ icon: Icon, className = '', ...props }: { icon: LucideIcon } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-logic-text-muted pointer-events-none" />
      <input {...props} className={`${inputCls} ${className}`} />
    </div>
  );
}
