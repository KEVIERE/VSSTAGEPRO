import type { LucideIcon } from 'lucide-react';

const inputCls = 'w-full bg-black/40 text-sm text-white pl-9 pr-3 py-2.5 rounded-lg border border-white/15 outline-none focus:border-[#0071e3] transition-colors placeholder:text-apple-text-secondary';

export default function Field({ icon: Icon, className = '', ...props }: { icon: LucideIcon } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-apple-text-secondary pointer-events-none" />
      <input {...props} className={`${inputCls} ${className}`} />
    </div>
  );
}
