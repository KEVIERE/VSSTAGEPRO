import { useMeterLevel } from '@/lib/meterBus';

export default function MeterMask({ id, className }: { id: string; className: string }) {
  const level = useMeterLevel(id);
  const db = level > 0 ? 20 * Math.log10(level) : -Infinity;
  const meterPct = db <= -48 ? 0 : Math.min(100, ((db + 48) / 48) * 100);
  if (meterPct >= 100) return null;
  return <div className={`absolute top-0 left-0 right-0 ${className}`} style={{ height: `${100 - meterPct}%` }} />;
}
