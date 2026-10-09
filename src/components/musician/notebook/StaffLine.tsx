import { barBeats, noteBeats, type NotebookLine, type StaffNote } from '@/lib/notebook';

type StaffData = Extract<NotebookLine, { kind: 'staff' }>;

const TOP = 40;
const GAP = 10;
const BOTTOM = TOP + GAP * 4;
const HEIGHT = 124;
const START_X = 84;
const NOTE_W = 34;
const BAR_W = 16;
const MIN_STEP = -5;
const MAX_STEP = 13;

const yOf = (step: number) => BOTTOM - step * (GAP / 2);
export const clampStep = (s: number) => Math.max(MIN_STEP, Math.min(MAX_STEP, s));

function layout(staff: StaffData) {
  const per = barBeats(staff.time);
  let x = START_X;
  let beats = 0;
  const notes: { note: StaffNote; x: number }[] = [];
  const bars: number[] = [];
  staff.notes.forEach((n) => {
    notes.push({ note: n, x });
    x += NOTE_W * (n.dur === 'w' ? 1.6 : n.dur === 'h' ? 1.25 : 1);
    beats += noteBeats(n);
    if (beats >= per - 1e-6) {
      bars.push(x - NOTE_W / 2 + BAR_W / 2);
      x += BAR_W;
      beats = 0;
    }
  });
  return { notes, bars, end: x + NOTE_W };
}

function Rest({ n, x, color }: { n: StaffNote; x: number; color: string }) {
  if (n.dur === 'w') return <rect x={x - 7} y={TOP + GAP} width={14} height={5} fill={color} />;
  if (n.dur === 'h') return <rect x={x - 7} y={TOP + GAP * 2 - 5} width={14} height={5} fill={color} />;
  if (n.dur === 'q') {
    return <path d={`M${x - 3} ${TOP + 6} l7 9 l-6 7 l7 9 c-6 -3 -10 1 -4 7 c-10 -4 -8 -12 0 -9 l-7 -8 l6 -7 z`} fill={color} />;
  }
  const flags = n.dur === 'e' ? 1 : 2;
  return (
    <g stroke={color} strokeWidth={1.6} fill={color}>
      <line x1={x + 4} y1={TOP + 12} x2={x - 2} y2={TOP + 34} />
      {Array.from({ length: flags }, (_, i) => (
        <g key={i}>
          <circle cx={x - 3} cy={TOP + 13 + i * 8} r={2.6} stroke="none" />
          <path d={`M${x - 3} ${TOP + 13 + i * 8} q4 3 7 -1`} fill="none" />
        </g>
      ))}
    </g>
  );
}

function Note({ n, x, color }: { n: StaffNote; x: number; color: string }) {
  const y = yOf(n.step);
  const filled = n.dur !== 'w' && n.dur !== 'h';
  const up = n.step < 4;
  const ledgers: number[] = [];
  for (let s = -2; s >= n.step; s -= 2) ledgers.push(s);
  for (let s = 10; s <= n.step; s += 2) ledgers.push(s);
  const stemX = up ? x + 5.6 : x - 5.6;
  const stemEnd = up ? y - 30 : y + 30;
  const flags = n.dur === 'e' ? 1 : n.dur === 's' ? 2 : 0;
  return (
    <g>
      {ledgers.map((s) => <line key={s} x1={x - 10} x2={x + 10} y1={yOf(s)} y2={yOf(s)} stroke={color} strokeWidth={1.2} />)}
      {n.acc && (
        <text x={x - 17} y={y + 5} fontSize={15} fill={color} textAnchor="middle" fontWeight={700}>
          {n.acc === '#' ? '♯' : '♭'}
        </text>
      )}
      <ellipse
        cx={x} cy={y} rx={6.2} ry={4.4} transform={`rotate(-20 ${x} ${y})`}
        fill={filled ? color : 'none'} stroke={color} strokeWidth={filled ? 0 : 1.8}
      />
      {n.dur !== 'w' && <line x1={stemX} x2={stemX} y1={y} y2={stemEnd} stroke={color} strokeWidth={1.4} />}
      {Array.from({ length: flags }, (_, i) => (
        <path
          key={i}
          d={up
            ? `M${stemX} ${stemEnd + i * 7} q3 8 9 12 q-2 -6 -9 -6`
            : `M${stemX} ${stemEnd - i * 7} q3 -8 9 -12 q-2 6 -9 6`}
          fill={color}
        />
      ))}
      {n.dot && <circle cx={x + 10} cy={n.step % 2 === 0 ? y - 3 : y} r={1.8} fill={color} />}
    </g>
  );
}

export default function StaffLine({ staff, ink, selectedNote, interactive, onTap, onSelectNote }: {
  staff: StaffData;
  ink: string;
  selectedNote: string | null;
  interactive: boolean;
  onTap: (step: number) => void;
  onSelectNote: (id: string) => void;
}) {
  if (staff.mode === 'blank') {
    return (
      <svg width="100%" height={HEIGHT} className="block" aria-label="Pauta em branco">
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1="0" x2="100%" y1={TOP + i * GAP} y2={TOP + i * GAP} stroke={ink} strokeOpacity={0.55} strokeWidth={1} />
        ))}
        <line x1="0.5" x2="0.5" y1={TOP} y2={BOTTOM} stroke={ink} strokeOpacity={0.55} />
      </svg>
    );
  }

  const { notes, bars, end } = layout(staff);
  const [top, bottom] = staff.time.split('/');
  const width = Math.max(end, 320);

  const tap = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!interactive) return;
    const r = e.currentTarget.getBoundingClientRect();
    const y = ((e.clientY - r.top) / r.height) * HEIGHT;
    onTap(clampStep(Math.round((BOTTOM - y) / (GAP / 2))));
  };

  return (
    <div className="overflow-x-auto logic-scroll">
      <svg
        width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`}
        onClick={tap}
        className={`block ${interactive ? 'cursor-pointer' : ''}`}
        aria-label="Partitura"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={0} x2={width} y1={TOP + i * GAP} y2={TOP + i * GAP} stroke={ink} strokeOpacity={0.6} strokeWidth={1} />
        ))}
        <line x1={0.5} x2={0.5} y1={TOP} y2={BOTTOM} stroke={ink} strokeOpacity={0.6} />
        {staff.clef === 'treble' ? (
          <text x={6} y={BOTTOM + 9} fontSize={58} fill={ink} style={{ fontFamily: '"Noto Music", "Bravura", "Segoe UI Symbol", "Apple Symbols", serif' }}>𝄞</text>
        ) : (
          <text x={8} y={TOP + 26} fontSize={36} fill={ink} style={{ fontFamily: '"Noto Music", "Bravura", "Segoe UI Symbol", "Apple Symbols", serif' }}>𝄢</text>
        )}
        <text x={56} y={TOP + 18} fontSize={20} fontWeight={700} fill={ink} textAnchor="middle" fontFamily="Georgia, serif">{top}</text>
        <text x={56} y={BOTTOM - 2} fontSize={20} fontWeight={700} fill={ink} textAnchor="middle" fontFamily="Georgia, serif">{bottom}</text>
        {bars.map((x, i) => <line key={i} x1={x} x2={x} y1={TOP} y2={BOTTOM} stroke={ink} strokeOpacity={0.8} strokeWidth={1.2} />)}
        {notes.map(({ note, x }) => {
          const color = note.id === selectedNote ? '#ffd60a' : ink;
          return (
            <g
              key={note.id}
              onClick={(e) => { if (!interactive) return; e.stopPropagation(); onSelectNote(note.id); }}
              className={interactive ? 'cursor-pointer' : ''}
            >
              <rect x={x - 14} y={TOP - 24} width={28} height={GAP * 4 + 48} fill="transparent" />
              {note.rest ? <Rest n={note} x={x} color={color} /> : <Note n={note} x={x} color={color} />}
            </g>
          );
        })}
        {interactive && (
          <g opacity={0.45}>
            <line x1={end - NOTE_W} x2={end - NOTE_W} y1={TOP - 6} y2={BOTTOM + 6} stroke="#ffd60a" strokeDasharray="3 3" />
          </g>
        )}
      </svg>
    </div>
  );
}
