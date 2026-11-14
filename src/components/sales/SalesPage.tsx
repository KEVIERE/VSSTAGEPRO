import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, Globe, Wifi } from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import SegmentDisplay from '@/components/SegmentDisplay';
import WhatsAppButton from './WhatsAppButton';
import { SITE_SUPPORT_MESSAGE, supportWhatsAppUrl } from '@/lib/support';
import SiteIntro from './SiteIntro';
import { IMac, IPhone, MacBook, Tablet } from './Devices';
import { MaestroTyping, ToolVisual } from './ToolVisuals';
import { useScrollReveal } from './useScrollReveal';
import { prefersReducedMotion, useScrollScene } from './useScrollScene';
import {
  AI_STEPS, BAND_POINTS, COMPARISON, FAQS, HIGHLIGHTS, MANIFESTO, MIXER_POINTS, NEWS, NUMBERS,
  PRICES, SHOW_STEPS, SPOTS, STEMS, TIMELINE_POINTS, TOOLS, TV_POINTS, type ShowStep,
} from './siteContent';
import './sales.css';

// Página de vendas (vsstagepro.com.br). Fundo de palco, textos creme como a serigrafia da mesa e
// LEDs âmbar e verde só onde algo acende. As fotos do programa ficam em public/site/ e saem da
// página de testes site-shots.html (dados de exemplo: "Música 01", "Música 02"...).

const INTRO_KEY = 'vs_site_intro_v1';

const goPlans = () => { window.location.hash = '#planos'; };
const goDownload = () => { window.location.hash = '#baixar'; };

function scrollToId(e: MouseEvent<HTMLElement>, id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  e.preventDefault();
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

export default function SalesPage() {
  const [intro, setIntro] = useState<'playing' | 'revealed' | 'done'>(() => {
    if (prefersReducedMotion()) return 'done';
    try { if (sessionStorage.getItem(INTRO_KEY) === '1') return 'done'; } catch { /* sem armazenamento: mostra a abertura */ }
    return 'playing';
  });
  const heroOn = intro !== 'playing';

  useEffect(() => { window.scrollTo(0, 0); }, []);

  const onReveal = useCallback(() => setIntro('revealed'), []);
  const onDone = useCallback(() => {
    try { sessionStorage.setItem(INTRO_KEY, '1'); } catch { /* só conveniência */ }
    setIntro('done');
  }, []);

  return (
    <div className="vs-site">
      {intro !== 'done' && <SiteIntro onReveal={onReveal} onDone={onDone} />}
      <Nav />
      <main>
        <Hero on={heroOn} />
        <Highlights />
        <Manifesto />
        <ShowScene />
        <Readouts />
        <ToolsSection />
        <AiScene />
        <TimelineSection />
        <MaestroSection />
        <MixerSection />
        <BandSection />
        <TvSection />
        <OfflineSection />
        <NewsSection />
        <CompareSection />
        <PlansSection />
        <FaqSection />
        <FinalCta />
      </main>
      <Footer />
      <WhatsAppButton />
    </div>
  );
}

/* ------------------------------------------------------------------ */

const NAV_LINKS = [
  { id: 'ferramentas', label: 'Ferramentas' },
  { id: 'modo-show', label: 'Modo Show' },
  { id: 'ia', label: 'IA' },
  { id: 'maestro', label: 'Maestro' },
  { id: 'mixer', label: 'Mixer' },
  { id: 'banda', label: 'Banda' },
  { id: 'tv', label: 'TV do palco' },
  { id: 'precos', label: 'Preços' },
];

function Nav() {
  return (
    <header className="vs-nav">
      <div className="vs-wrap h-14 flex items-center gap-6">
        <a href="#" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' }); }} className="flex items-center gap-2.5 shrink-0">
          <VsLogo size={26} />
          <span className="vs-wordmark">VS Stage Pro</span>
        </a>
        <nav className="hidden lg:flex items-center gap-7 mx-auto text-[0.875rem]" aria-label="Seções do site">
          {NAV_LINKS.map((l) => (
            <a key={l.id} href={`#${l.id}`} onClick={(e) => scrollToId(e, l.id)} className="vs-nav-link">{l.label}</a>
          ))}
        </nav>
        <div className="ml-auto lg:ml-0 flex items-center gap-2">
          <button type="button" onClick={goPlans} className="vs-key vs-key-sm vs-key-steel hidden sm:inline-flex">Assinar</button>
          <button type="button" onClick={goDownload} className="vs-key vs-key-sm vs-key-amber">Testar grátis</button>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ */

function Hero({ on }: { on: boolean }) {
  const tilt = useScrollScene<HTMLDivElement>();
  return (
    <section className={`vs-hero ${on ? 'is-on' : ''}`} aria-labelledby="hero-title">
      <div className="vs-beams" aria-hidden="true"><span className="vs-beam" /><span className="vs-beam" /><span className="vs-beam" /></div>
      <div className="vs-wrap flex flex-col items-center">
        <div className="vs-rise" style={{ '--d': '0ms' } as CSSProperties}>
          <VsLogo size={84} className="drop-shadow-[0_18px_40px_rgba(34,166,255,0.25)]" />
        </div>
        <p className="vs-hero-pill mt-7 vs-rise" style={{ '--d': '60ms' } as CSSProperties}>
          <span className="vs-led is-amber" />
          O primeiro motor de áudio construído exclusivamente para palco
        </p>
        <h1 id="hero-title" className="vs-display vs-h1-hero vs-cream-gradient mt-6 vs-rise" style={{ '--d': '120ms' } as CSSProperties}>
          Uma timeline por música. <br className="hidden sm:inline" />Todo o show na sua mão.
        </h1>
        <p className="vs-lead mt-7 mx-auto vs-rise" style={{ '--d': '220ms' } as CSSProperties}>
          Esqueça DAWs de estúdio que travam. Suba uma faixa pronta: a <strong className="text-[color:var(--cream)]">Inteligência Artificial</strong> separa
          os stems, acerta o BPM e devolve um <strong className="text-[color:var(--cream)]">VS Stage Pro</strong> completo — com timeline por música,
          controle de tom, mixer com Timecode LTC, cifras no celular da banda e teleprompter na TV do palco.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row items-center gap-3 vs-rise" style={{ '--d': '320ms' } as CSSProperties}>
          <button type="button" onClick={goDownload} className="vs-key vs-key-amber w-full sm:w-auto">
            <Download size={19} strokeWidth={2.4} /> Começar teste grátis
          </button>
          <a href="#por-que" onClick={(e) => scrollToId(e, 'por-que')} className="vs-key vs-key-steel w-full sm:w-auto">Por que o VS Stage Pro no palco?</a>
        </div>
        <p className="mt-5 text-[0.85rem] text-[color:var(--muted)] vs-rise" style={{ '--d': '400ms' } as CSSProperties}>
          Otimizado para macOS Sonoma, Sequoia e Apple Silicon (M1/M2/M3/M4). Teste grátis de 48 horas, sem cartão.
        </p>
      </div>

      <div ref={tilt} className="vs-devices" role="group" aria-label="O VS Stage Pro no computador de mesa, no notebook, no celular e no tablet">
        <div className="vs-dev vs-dev-imac"><div style={{ '--dd': '380ms' } as CSSProperties}>
          <IMac src="/site/imac.jpg" width={3200} height={1800} eager alt="Computador de mesa com o VS Stage Pro: playlist, linha do tempo com as faixas e o mixer" />
        </div></div>
        <div className="vs-dev vs-dev-tab"><div style={{ '--dd': '560ms' } as CSSProperties}>
          <Tablet src="/site/tablet.jpg" width={2732} height={2048} alt="Tablet com a Área do Produtor do teleprompter: prévia da TV do palco com um aviso no ar, o que aparece na tela e os avisos prontos" />
        </div></div>
        <div className="vs-dev vs-dev-mbook"><div style={{ '--dd': '480ms' } as CSSProperties}>
          <MacBook src="/site/show.jpg" width={3200} height={2000} alt="Notebook no Modo Show do Show Prefeitura, com o relógio de LED" />
        </div></div>
        <div className="vs-dev vs-dev-phone"><div style={{ '--dd': '660ms' } as CSSProperties}>
          <IPhone src="/site/iphone-palco.jpg" width={1179} height={2556} alt="Celular com a Área do Músico e a partitura da música no ar" />
        </div></div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

// Folga no começo e no fim da cena dos destaques: o primeiro e o último cartão ficam parados um
// pouco antes de a fila andar e antes de a página seguir. O mesmo número está no sales.css (.vs-hl).
const HL_HOLD = 0.06;

function Highlights() {
  const rail = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  // Rolar a página faz a fila de cartões andar para o lado (cena grudada). Quem pediu menos
  // movimento ao sistema fica com o carrossel normal, de arrastar para o lado.
  const [pinned] = useState(() => !prefersReducedMotion());
  const geo = useRef({ dist: 0, offsets: [] as number[] });

  // destaque mais perto da posição atual da fila
  const nearest = (x: number) => {
    const { offsets } = geo.current;
    let best = 0;
    offsets.forEach((o, i) => { if (Math.abs(o - x) < Math.abs(offsets[best] - x)) best = i; });
    return best;
  };

  const section = useScrollScene<HTMLElement>(({ sp }) => {
    if (!pinned) return;
    const { dist } = geo.current;
    const x = Math.min(1, Math.max(0, (sp - HL_HOLD) / (1 - 2 * HL_HOLD))) * dist;
    // no fim da fila vale o último cartão, mesmo que ele não chegue ao começo da tela
    setActive(x >= dist - 1 ? HIGHLIGHTS.length - 1 : nearest(x));
  });

  // Mede quanto a fila precisa andar para o último cartão aparecer inteiro. A altura da cena sai daí.
  useEffect(() => {
    const sec = section.current;
    const tr = track.current;
    const rl = rail.current;
    if (!pinned || !sec || !tr || !rl) return;
    const measure = () => {
      const tiles = Array.from(tr.children) as HTMLElement[];
      const first = tiles[0]?.offsetLeft ?? 0;
      const dist = Math.max(0, tr.scrollWidth - rl.clientWidth);
      geo.current = { dist, offsets: tiles.map((t) => Math.min(dist, t.offsetLeft - first)) };
      sec.style.setProperty('--dist', String(dist));
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(tr);
    ro?.observe(rl);
    window.addEventListener('resize', measure);
    return () => { ro?.disconnect(); window.removeEventListener('resize', measure); };
  }, [pinned, section]);

  // Carrossel normal: o destaque ativo segue o arrasto para o lado
  useEffect(() => {
    const el = rail.current;
    if (pinned || !el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const tiles = Array.from(track.current?.children ?? []) as HTMLElement[];
        const step = tiles[1] && tiles[0] ? tiles[1].offsetLeft - tiles[0].offsetLeft : 1;
        setActive(Math.max(0, Math.min(HIGHLIGHTS.length - 1, Math.round(el.scrollLeft / step))));
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); cancelAnimationFrame(raf); };
  }, [pinned]);

  // Setas e bolinhas: na cena grudada, rola a página até o ponto em que aquele cartão aparece
  const go = (i: number) => {
    const n = Math.max(0, Math.min(HIGHLIGHTS.length - 1, i));
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    if (!pinned) {
      const tiles = Array.from(track.current?.children ?? []) as HTMLElement[];
      const step = tiles[1] && tiles[0] ? tiles[1].offsetLeft - tiles[0].offsetLeft : 0;
      rail.current?.scrollTo({ left: n * step, behavior });
      return;
    }
    const sec = section.current;
    const { dist, offsets } = geo.current;
    if (!sec) return;
    const range = sec.offsetHeight - window.innerHeight;
    const x = dist > 0 ? (n === HIGHLIGHTS.length - 1 ? 1 : (offsets[n] ?? 0) / dist) : 0;
    const top = sec.getBoundingClientRect().top + window.scrollY;
    window.scrollTo({ top: top + (HL_HOLD + x * (1 - 2 * HL_HOLD)) * range + 1, behavior });
  };

  return (
    <section ref={section} className={`vs-hl ${pinned ? 'is-pinned' : 'vs-section pb-0'}`} aria-labelledby="destaques-title">
      <div className={pinned ? 'vs-sticky' : undefined}>
        <div className="w-full">
      <div className="vs-wrap"><Kicker label="Destaques" n={1} /></div>
      <div className="vs-wrap flex items-end justify-between gap-6 mb-10">
        <h2 id="destaques-title" className="vs-display vs-h2 max-w-[14em]">Seis razões para levar o VS Stage ao palco.</h2>
        <div className="hidden sm:flex gap-2 shrink-0">
          <button type="button" className="vs-arrow" onClick={() => go(active - 1)} disabled={active === 0} aria-label="Destaque anterior"><ChevronLeft size={20} /></button>
          <button type="button" className="vs-arrow" onClick={() => go(active + 1)} disabled={active === HIGHLIGHTS.length - 1} aria-label="Próximo destaque"><ChevronRight size={20} /></button>
        </div>
      </div>
      <div ref={rail} className="vs-rail" tabIndex={pinned ? undefined : 0} aria-label="Destaques do VS Stage Pro">
        <div ref={track} className="vs-track">
        {HIGHLIGHTS.map((h) => (
          <article key={h.title} className={`vs-tile ${h.phone ? 'has-phone' : ''}`} style={{ '--pos': h.position ?? 'center' } as CSSProperties}>
            {h.phone ? (
              <div className="vs-tile-phone"><IPhone src={h.img} alt={h.alt} width={1179} height={2556} /></div>
            ) : (
              <img className="vs-tile-cover" src={h.img} alt={h.alt} loading="lazy" decoding="async" style={{ objectPosition: h.position ?? 'center' }} />
            )}
            <div className="vs-tile-caption">
              <h3 className="vs-display vs-h3 max-w-[18em]">{h.title}</h3>
              <p className="mt-2 text-[0.98rem] text-[color:var(--cream-dim)]">{h.text}</p>
            </div>
          </article>
        ))}
        </div>
      </div>
      <div className="vs-pager mt-2" role="group" aria-label="Escolher destaque">
        {HIGHLIGHTS.map((h, i) => (
          <button key={h.title} type="button" onClick={() => go(i)} aria-label={`Destaque ${i + 1}: ${h.title}`} aria-current={i === active}>
            <span className={`vs-led ${i === active ? 'is-amber' : ''}`} />
          </button>
        ))}
      </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Manifesto() {
  const ref = useScrollScene<HTMLElement>();
  const words = MANIFESTO.split(' ');
  return (
    <section ref={ref} className="vs-manifesto" aria-label="Sobre o VS Stage Pro">
      <div className="vs-sticky">
        <div className="vs-wrap">
          <p className="vs-manifesto-text">
            {words.map((w, i) => (
              <span key={i} className="vs-word" style={{ '--i': (i / words.length).toFixed(3) } as CSSProperties}>{w} </span>
            ))}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function zoomStyle(f: ShowStep['focus']): CSSProperties {
  const half = 1 / (2 * f.scale);
  const x = Math.min(Math.max(f.x, half), 1 - half);
  const y = Math.min(Math.max(f.y, half), 1 - half);
  return {
    transformOrigin: `${x * 100}% ${y * 100}%`,
    transform: `translate(${(0.5 - x) * 100}%, ${(0.5 - y) * 100}%) scale(${f.scale})`,
  };
}

function ShowScene() {
  const [step, setStep] = useState(0);
  const ref = useScrollScene<HTMLElement>(({ sp }) => setStep(Math.min(SHOW_STEPS.length - 1, Math.floor(sp * SHOW_STEPS.length))));
  return (
    <section id="modo-show" ref={ref} className="vs-scene" aria-labelledby="show-title">
      <div className="vs-sticky">
        <div className="vs-wrap vs-scene-grid">
          <div>
            <Kicker label="Modo Show" n={2} />
            <h2 id="show-title" className="vs-display vs-h2">Modo Show.</h2>
            <p className="vs-lead mt-4">A tela que trabalha por você quando as luzes acendem e não existe segunda chance.</p>
            <div className="flex gap-2 mt-8 mb-6" aria-hidden="true">
              {SHOW_STEPS.map((s, i) => <span key={s.title} className={`vs-led ${i === step ? 'is-amber' : i < step ? 'is-green' : ''}`} />)}
            </div>
            <div className="vs-steps">
              {SHOW_STEPS.map((s, i) => (
                <div key={s.title} className={`vs-step ${i === step ? 'is-active' : ''}`} aria-hidden={i !== step}>
                  <h3 className="vs-display vs-h3">{s.title}</h3>
                  <p className="vs-body mt-3 max-w-[30em]">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
          <div className="vs-scene-media">
            <div className="vs-screen">
              <div className="vs-zoom-frame">
                <img
                  className="vs-zoom-img"
                  src="/site/show.jpg"
                  width={3200}
                  height={2000}
                  alt="Modo Show: playlist em tela cheia, displays de Tocando e Próxima e o relógio de LED"
                  loading="lazy"
                  decoding="async"
                  style={zoomStyle(SHOW_STEPS[step].focus)}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CountUp({ value, className }: { value: number; className: string }) {
  const { ref, revealed } = useScrollReveal<HTMLDivElement>();
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
  useEffect(() => {
    if (!revealed || prefersReducedMotion()) { if (revealed) setShown(value); return; }
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(Math.round(value * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [revealed, value]);
  return (
    <div ref={ref} className="vs-lcd">
      <SegmentDisplay text={String(shown).padStart(2, ' ')} className={className} label={String(value)} />
    </div>
  );
}

function Readouts() {
  return (
    <section className="vs-wrap pb-[clamp(4rem,10vh,7rem)]" aria-label="O VS Stage Pro em números">
      <div className="vs-readouts vs-panel">
        {NUMBERS.map((n) => (
          <div key={n.label} className="vs-readout">
            <CountUp value={n.value} className={n.color === 'amber' ? 'text-[#ffab1f]' : 'text-[#3ee26e]'} />
            <p className="text-[0.95rem] leading-snug text-[color:var(--cream-dim)]">{n.label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

// Desenho das barras de cada instrumento (o número também fixa o sorteio, para o desenho não mudar)
const STEM_SHAPE = { voz: 0, bateria: 1, baixo: 2, guitarra: 3, teclado: 4, outros: 5, click: 6 } as const;

// Alturas das barras de cada faixa (sempre iguais: gerador fixo)
function stemBars(kind: number, count: number): number[] {
  let s = 97 + kind * 131;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  return Array.from({ length: count }, (_, i) => {
    const section = i < count * 0.18 ? 0.45 : i < count * 0.55 ? 0.7 : 1;
    switch (kind) {
      case 0: return (i % 8) < 6 && i > 4 ? (0.45 + 0.4 * rnd()) * section : 0.06; // voz: frases e respiros
      case 1: return (i % 2 === 0 ? 0.75 + 0.25 * rnd() : 0.25 + 0.2 * rnd()) * section; // bateria
      case 2: return (0.45 + 0.2 * rnd()) * section; // baixo
      case 3: return i < count * 0.18 ? 0.12 : (0.35 + 0.45 * rnd()) * section; // guitarra
      case 4: return 0.35 + 0.25 * Math.sin(i / 6) * 0.5 + 0.15 * section; // teclado
      case 5: return (0.18 + 0.25 * rnd()) * section; // outros
      default: return i % 4 === 0 ? 0.7 : 0.18; // click
    }
  });
}
const BAR_COUNT = 56;
const STEM_BARS = STEMS.map((s) => stemBars(STEM_SHAPE[s.kind], BAR_COUNT));

function AiScene() {
  const [lit, setLit] = useState(0);
  const ref = useScrollScene<HTMLElement>(({ sp }) => setLit(sp > 0.62 ? 3 : sp > 0.32 ? 2 : sp > 0.04 ? 1 : 0));
  // no celular a cena não gruda (não cabe na altura): as faixas se separam pela posição delas na tela
  const stems = useScrollScene<HTMLDivElement>(undefined, { p: '--p2', sp: '--sp2' });
  const done = lit >= 3;
  return (
    <section id="ia" ref={ref} className="vs-ai" aria-labelledby="ia-title">
      <div className="vs-sticky">
        <div className="vs-wrap vs-ai-grid">
          <div>
            <Kicker label="Inteligência artificial" n={4} />
            <h2 id="ia-title" className="vs-display vs-h2 vs-h2-side">Suba a música pronta. Receba o VS.</h2>
            <p className="vs-body mt-5 max-w-[34em] text-[1.05rem]">
              Não achou a multitrack daquela música que todo mundo canta? Mande só o áudio mixado. A IA separa a música e entrega
              o VS com voz, click, bateria, baixo, guitarra/violão, teclado e outros. Ela ainda divide a bateria em bumbo, caixa,
              pratos e tons, mede o BPM e coloca tudo numa timeline própria. E tudo roda no seu Mac: a sua música não sai do
              computador.
            </p>
            <ol className="mt-6">
              {AI_STEPS.map((s, i) => (
                <li key={s} className={`vs-ai-step ${lit > i ? 'is-lit' : ''}`}>
                  <b>{i + 1}</b>
                  <span className="pt-1">{s}</span>
                </li>
              ))}
            </ol>
            <p className="vs-body mt-5 text-[0.95rem] max-w-[34em]">
              Já tem as multitracks? Arraste a pasta: a IA reconhece cada arquivo e roteia sozinha cada faixa para o fader certo.
            </p>
          </div>
          <div>
            <div className="vs-file-chip vs-panel mb-6">
              <span className={`vs-led ${done ? 'is-green' : 'is-amber'}`} />
              <span className="font-medium">musica-02.wav</span>
              <span className="text-[color:var(--muted)]">{done ? 'VS pronto' : 'Separando os instrumentos'}</span>
            </div>
            <div ref={stems} className="vs-stems" role="img" aria-label="Uma única onda de áudio se divide em sete faixas: voz, click, bateria, baixo, guitarra/violão, teclado e outros">
              {STEMS.map((stem, row) => (
                <div key={stem.name} className="vs-stem" style={{ '--row': row, '--c': stem.color } as CSSProperties}>
                  <span className="vs-stem-label">{stem.name}</span>
                  <span className="vs-stem-bars">
                    {STEM_BARS[row].map((h, i) => <i key={i} style={{ '--h': h.toFixed(3) } as CSSProperties} />)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function Points({ items, led = 'amber', className = '' }: { items: { title: string; text: string }[]; led?: 'amber' | 'green'; className?: string }) {
  return (
    <ul className={`vs-points ${className}`}>
      {items.map((it) => (
        <li key={it.title} className="vs-point">
          <span className={`vs-led ${led === 'green' ? 'is-green' : 'is-amber'}`} />
          <div>
            <h3>{it.title}</h3>
            <p>{it.text}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

// Abertura de cada seção: linha fina com o nome à esquerda e o número à direita, como a
// serigrafia que separa os módulos de uma mesa
function Kicker({ label, n }: { label: string; n: number }) {
  return (
    <p className="vs-kicker">
      <span className="vs-led is-amber" aria-hidden="true" />
      {label}
      <span className="vs-kicker-n" aria-hidden="true">{String(n).padStart(2, '0')}</span>
    </p>
  );
}

function SectionHead({ id, title, kicker, n, children }: { id: string; title: string; kicker: string; n: number; children?: ReactNode }) {
  return (
    <>
      <Kicker label={kicker} n={n} />
      <div className="max-w-[46rem]">
        <h2 id={id} className="vs-display vs-h2">{title}</h2>
        {children && <p className="vs-lead mt-5">{children}</p>}
      </div>
    </>
  );
}

function TimelineSection() {
  const grow = useScrollScene<HTMLDivElement>();
  const keys = useScrollReveal<HTMLDivElement>();
  return (
    <section className="vs-section" aria-labelledby="timeline-title">
      <div className="vs-wrap">
        <SectionHead id="timeline-title" kicker="Timeline" n={5} title="Cada parte da música vira um botão.">
          Marque intro, verso, refrão, ponte e solo. No show, um toque repete o refrão, pula a ponte ou segura um loop enquanto
          o momento pedir, sempre no tempo e sem nenhum corte fora do lugar.
        </SectionHead>
        <div ref={keys.ref} className={`mt-7 flex flex-wrap items-center gap-4 ${keys.revealed ? 'is-in' : ''}`}>
          <div className="vs-keycaps" aria-label="Atalhos do teclado: L e N">
            {['L', 'N'].map((k, i) => (
              <span key={k} className="vs-keycap" style={{ '--k': i } as CSSProperties}>{k}</span>
            ))}
          </div>
          <span className="text-[0.92rem] text-[color:var(--cream-dim)]">Também pelo teclado do computador.</span>
        </div>
        <div ref={grow} className="vs-grow mt-12">
          <div className="vs-screen">
            <img src="/site/timeline.jpg" width={2480} height={1264} alt="Linha do tempo com as partes da música coloridas e as faixas de cada instrumento" loading="lazy" decoding="async" />
          </div>
        </div>
        <Points items={TIMELINE_POINTS} led="green" className="mt-12 md:grid-cols-3" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function FaderVideo() {
  const ref = useRef<HTMLVideoElement>(null);
  const reduce = prefersReducedMotion();
  // só toca quando aparece na tela (economiza bateria no celular)
  useEffect(() => {
    const el = ref.current;
    if (!el || reduce || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) void el.play().catch(() => {});
      else el.pause();
    }, { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, [reduce]);
  return (
    <video
      ref={ref}
      src="/site/faders.mp4?v=2"
      poster="/site/faders-poster.jpg?v=2"
      width={2036}
      height={534}
      muted
      loop
      playsInline
      preload="metadata"
      controls={reduce}
      aria-label="Vídeo: os faders do mixer do VS Stage sobem e descem em onda, como numa mesa de som"
    />
  );
}

function MixerSection() {
  const pan = useScrollScene<HTMLDivElement>();
  return (
    <section id="mixer" className="vs-section pt-0" aria-labelledby="mixer-title">
      <div className="vs-wrap">
        <SectionHead id="mixer-title" kicker="Mixer" n={7} title="Uma mesa de som de verdade.">
          Faders, medidores em dB, master e timecode com o visual de uma mesa analógica: qualquer técnico entende de primeira, e
          qualquer músico aprende em minutos.
        </SectionHead>
        <div ref={pan} className="vs-console mt-12">
          <div className="vs-console-inner"><FaderVideo /></div>
        </div>
        <div className="vs-spots mt-6">
          {SPOTS.map((sp) => (
            <div key={sp.title} className="vs-spot vs-panel">
              <div className="vs-spot-img" style={{ '--glow': sp.glow } as CSSProperties}>
                <img src={sp.img} width={sp.w} height={sp.h} alt={sp.alt} loading="lazy" decoding="async" />
              </div>
              <div>
                <h3 className="vs-display vs-h3">{sp.title}</h3>
                <p className="vs-body mt-3">{sp.text}</p>
              </div>
            </div>
          ))}
        </div>
        <Points items={MIXER_POINTS} className="mt-12 md:grid-cols-2" />
      </div>
    </section>
  );
}

function MaestroSection() {
  const box = useScrollReveal<HTMLDivElement>({ rootMargin: '0px' });
  const grow = useScrollScene<HTMLDivElement>();
  return (
    <section id="maestro" className="vs-section pt-0" aria-labelledby="maestro-title">
      <div className="vs-wrap">
        <SectionHead id="maestro-title" kicker="Maestro com IA" n={6} title="Um maestro que fala por você.">
          Escreva a regência e a inteligência artificial transforma o texto em voz, encaixada no tempo da música: a contagem, as
          preparações, as viradas e os avisos que a banda precisa ouvir no fone. Você dirige o show sem tirar as mãos do teclado.
        </SectionHead>
        <div ref={box.ref} className="mt-10 max-w-[40rem]">
          <MaestroTyping active={box.revealed} big />
        </div>
        <div ref={grow} className="vs-grow mt-10">
          <div className="vs-screen">
            <img src="/site/maestro.jpg" width={3200} height={720} alt="Faixa Maestro IA na linha do tempo, com as falas em azul: um, dois, três, quatro e prepara o verso" loading="lazy" decoding="async" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function BandSection() {
  const ref = useScrollScene<HTMLDivElement>();
  return (
    <section id="banda" className="vs-section overflow-hidden" aria-labelledby="banda-title">
      <div className="vs-wrap vs-band-grid">
        <div className="vs-band-head">
          <SectionHead id="banda-title" kicker="Área do Músico" n={8} title="A banda inteira na mesma página.">
            Cada músico abre a Área do Músico no próprio celular ou tablet e acompanha você em tempo real: a música no ar, a
            próxima, o tom e o BPM. No Modo show, a partitura dele ocupa a tela inteira e troca sozinha quando a música muda. Sem
            papel voando, sem pasta, sem ninguém perguntando qual é a próxima.
          </SectionHead>
        </div>
        <div ref={ref} className="vs-band-phones flex justify-center gap-[4vw] lg:gap-8 pb-16">
          <div className="vs-phone-slot vs-phone-a">
            <IPhone src="/site/iphone-palco.jpg" width={1179} height={2556} alt="Modo show do músico: displays de Tocando e Próxima e a partitura em foto" />
          </div>
          <div className="vs-phone-slot vs-phone-b">
            <IPhone src="/site/iphone-lista.jpg" width={1179} height={2556} time="20:46" alt="Área do Músico com a playlist do show, tom e BPM" />
          </div>
        </div>
        <div className="vs-band-points"><Points items={BAND_POINTS} led="green" /></div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function TvSection() {
  const ref = useScrollScene<HTMLDivElement>();
  return (
    <section id="tv" className="vs-section pt-0" aria-labelledby="tv-title">
      <div className="vs-wrap">
        <SectionHead id="tv-title" kicker="TV do palco" n={9} title="A letra na TV, um instante antes de cantar.">
          O teleprompter usa os mesmos displays do programa: relógio, tempo de show, a música no ar e a próxima com tom e BPM, a
          playlist do show e a letra, que aparece um instante antes da hora de cantar. O produtor técnico controla tudo pelo
          tablet, conectado direto ao computador do diretor.
        </SectionHead>
        <div ref={ref} className="vs-tv-wrap mt-12">
          <div className="vs-tv">
            <div className="vs-tv-screen">
              <img src="/site/tv.jpg" width={3200} height={1800} alt="Teleprompter na TV: playlist do show, relógio, tempo de show e a letra do refrão" loading="lazy" decoding="async" />
              <div className="vs-notice" aria-label="Exemplo de aviso ao vivo na TV">
                <b>ATENÇÃO</b>
                <span>Mais uma vez o refrão</span>
              </div>
            </div>
          </div>
          <div className="vs-tv-stand" aria-hidden="true" />
        </div>
        <Points items={TV_POINTS} className="mt-12 md:grid-cols-3" />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function NetDiagram({ online }: { online: boolean }) {
  // computador no centro ligado a celulares e TV (rede local) ou à internet (show online)
  const nodes = online
    ? [{ x: 40, y: 34, l: 'Casa' }, { x: 160, y: 22, l: 'Outra sala' }, { x: 280, y: 34, l: 'Viagem' }]
    : [{ x: 40, y: 34, l: 'Celulares' }, { x: 160, y: 22, l: 'Tablet' }, { x: 280, y: 34, l: 'TV' }];
  return (
    <svg viewBox="0 0 320 150" className="w-full h-auto" aria-hidden="true">
      {nodes.map((n) => (
        <line key={n.l} x1={160} y1={112} x2={n.x} y2={n.y + 10} stroke={online ? '#ffab1f' : '#3ee26e'} strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray={online ? '4 5' : undefined} />
      ))}
      {online && (
        <g>
          <rect x={126} y={58} width={68} height={24} rx={12} fill="#0c0e0d" stroke="#ffab1f" strokeOpacity={0.6} />
          <text x={160} y={74} textAnchor="middle" fontSize="11" fill="#ffab1f" fontFamily="Inter, sans-serif">Internet</text>
        </g>
      )}
      {nodes.map((n) => (
        <g key={`${n.l}-n`}>
          <circle cx={n.x} cy={n.y + 10} r={5} fill={online ? '#ffab1f' : '#3ee26e'} />
          <text x={n.x} y={n.y - 4} textAnchor="middle" fontSize="12" fill="#a7a297" fontFamily="Inter, sans-serif">{n.l}</text>
        </g>
      ))}
      <rect x={128} y={104} width={64} height={36} rx={6} fill="#24282d" stroke="#3b4148" />
      <text x={160} y={127} textAnchor="middle" fontSize="12" fill="#e7e2d6" fontFamily="Inter, sans-serif">Mac</text>
    </svg>
  );
}

function OfflineSection() {
  return (
    <section className="vs-section pt-0" aria-labelledby="offline-title">
      <div className="vs-wrap">
        <SectionHead id="offline-title" kicker="Rede local" n={10} title="Sem internet? O show continua." />
        <div className="mt-12 grid md:grid-cols-2 gap-5">
          <div className="vs-panel vs-card p-[clamp(1.5rem,3vw,2.4rem)]">
            <div className="flex items-center gap-3 text-[color:var(--green)]"><Wifi size={22} /><span className="vs-display text-[1.6rem] text-[color:var(--cream)]">Rede local</span></div>
            <p className="vs-body mt-3">Computador, celulares, tablets e TV no mesmo Wi-Fi, mesmo sem um único sinal de internet. Tudo responde na hora, e nada sai do palco.</p>
            <div className="mt-6 max-w-[22rem]"><NetDiagram online={false} /></div>
          </div>
          <div className="vs-panel vs-card p-[clamp(1.5rem,3vw,2.4rem)]">
            <div className="flex items-center gap-3 text-[color:var(--amber)]"><Globe size={22} /><span className="vs-display text-[1.6rem] text-[color:var(--cream)]">Show online</span></div>
            <p className="vs-body mt-3">Quando quiser, publique o show: os músicos acompanham pela internet de casa, da sala de ensaio ou da estrada, com convite e aprovação sua.</p>
            <div className="mt-6 max-w-[22rem]"><NetDiagram online /></div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function NewsSection() {
  return (
    <section id="novidades" className="vs-section pt-0" aria-labelledby="novidades-title">
      <div className="vs-wrap">
        <SectionHead id="novidades-title" kicker="Novidades" n={11} title="Novidades desta versão.">
          O VS Stage Pro evolui o tempo todo, ouvindo quem está no palco. Estas chegaram agora, sem custo extra para quem assina.
        </SectionHead>
        <ul className="vs-news mt-12">
          {NEWS.map((n) => (
            <li key={n.title}>
              <span className="vs-new-tag"><span className="vs-led is-green" />Novo</span>
              <div>
                <h3 className="vs-display text-[1.35rem] leading-tight">{n.title}</h3>
                <p className="vs-body mt-1 text-[0.97rem]">{n.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function CompareSection() {
  return (
    <section id="por-que" className="vs-section pt-0" aria-labelledby="compare-title">
      <div className="vs-wrap">
        <SectionHead id="compare-title" kicker="Palco × estúdio" n={12} title="Feito para tocar, não para gravar.">
          Programas de estúdio foram feitos para gravar e editar com calma. O palco não tem calma: tem pressa, luz baixa e zero
          margem para erro. Foi para esse lugar que o VS Stage Pro nasceu.
        </SectionHead>
        <div className="vs-compare vs-panel mt-12" role="table" aria-label="Comparação entre um programa de estúdio e o VS Stage Pro">
          <div className="vs-compare-row vs-compare-head text-[0.85rem] text-[color:var(--muted)]" role="row">
            <span role="columnheader">Na prática</span>
            <span role="columnheader">Programa de estúdio</span>
            <span role="columnheader" className="vs-brand text-[color:var(--amber)]">VS Stage Pro</span>
          </div>
          {COMPARISON.map((r) => (
            <div key={r.topic} className="vs-compare-row" role="row">
              <span role="cell" className="vs-display text-[1.2rem] leading-tight">{r.topic}</span>
              <span role="cell" className="text-[0.95rem] leading-relaxed text-[color:var(--muted)]">{r.studio}</span>
              <span role="cell" className="text-[0.98rem] leading-relaxed text-[color:var(--cream)] flex gap-2.5">
                <span className="vs-led is-green mt-[0.45rem]" />{r.vs}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function ToolsSection() {
  const { ref, revealed } = useScrollReveal<HTMLDivElement>({ rootMargin: '0px 0px -10% 0px' });
  return (
    <section id="ferramentas" className="vs-section pt-0" aria-labelledby="tools-title">
      <div className="vs-wrap">
        <SectionHead id="tools-title" kicker="Ferramentas" n={3} title="Inúmeras ferramentas. Um só objetivo: o show perfeito.">
          Cada recurso do VS Stage nasceu de um aperto real de quem toca ao vivo. Menos cliques, menos risco e mais tempo para o
          que importa: a música.
        </SectionHead>
        <div ref={ref} className={`vs-bento mt-12 ${revealed ? 'is-in' : ''}`}>
          {TOOLS.map((t) => (
            <article key={t.title} className={`vs-cell vs-panel ${t.wide ? 'is-wide' : ''}`}>
              <h3>{t.title}</h3>
              <p>{t.text}</p>
              <div className="vs-cell-viz"><ToolVisual viz={t.viz} active={revealed} /></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function PlansSection() {
  return (
    <section id="precos" className="vs-section pt-0" aria-labelledby="precos-title">
      <div className="vs-wrap">
        <SectionHead id="precos-title" kicker="Planos" n={13} title="Um preço simples.">
          Todas as ferramentas liberadas em qualquer plano, sem versão capada. Teste 48 horas antes de decidir, sem cartão.
        </SectionHead>
        <div className="vs-plans mt-12">
          <div className="vs-plan vs-panel">
            <h3 className="vs-display text-[1.6rem]">Mensal</h3>
            <p><span className="vs-display text-[3.4rem] leading-none">{PRICES.monthly}</span><span className="text-[color:var(--cream-dim)]"> por mês</span></p>
            <p className="vs-body">Sem fidelidade e sem cobrança automática.</p>
            <button type="button" onClick={goPlans} className="vs-key vs-key-steel mt-auto self-start">Assinar o mensal</button>
          </div>
          <div className="vs-plan vs-panel is-best">
            <h3 className="vs-display text-[1.6rem] flex items-center gap-3">Anual <span className="flex items-center gap-1.5 text-[0.95rem] font-semibold text-[color:var(--amber)] font-sans"><span className="vs-led is-amber" />Economize {PRICES.yearlySavings}</span></h3>
            <p><span className="vs-display text-[3.4rem] leading-none">{PRICES.yearly}</span><span className="text-[color:var(--cream-dim)]"> por ano</span></p>
            <p className="vs-body">Sai por {PRICES.yearlyPerMonth} por mês, com suporte prioritário.</p>
            <button type="button" onClick={goPlans} className="vs-key vs-key-amber mt-auto self-start">Assinar o anual</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function FaqSection() {
  return (
    <section className="vs-section pt-0" aria-labelledby="faq-title">
      <div className="vs-wrap">
        <SectionHead id="faq-title" kicker="Dúvidas" n={14} title="Perguntas frequentes." />
        <div className="vs-faq mt-10 max-w-[60rem]">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>{f.q}<span className="vs-plus" aria-hidden="true" /></summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

function FinalCta() {
  return (
    <section className="vs-section text-center relative isolate overflow-hidden" aria-labelledby="final-title">
      <div className="vs-wrap">
        <div className="vs-final-logo"><VsLogo size={150} className="w-full h-auto" /></div>
        <h2 id="final-title" className="vs-display vs-h2 vs-cream-gradient mt-8">Faça seu próximo show com o VS Stage Pro.</h2>
        <p className="vs-lead mx-auto mt-5">
          Baixe agora, crie sua conta e tenha 48 horas de acesso completo, sem cartão de crédito. Monte o repertório, ensaie com
          a banda e sinta a diferença já no primeiro culto ou show.
        </p>
        <div className="mt-9 flex flex-col sm:flex-row justify-center gap-3">
          <button type="button" onClick={goDownload} className="vs-key vs-key-amber"><Download size={19} strokeWidth={2.4} /> Começar teste grátis</button>
          <button type="button" onClick={goPlans} className="vs-key vs-key-steel">Ver planos</button>
        </div>
      </div>
    </section>
  );
}

const FOOTER_COLS: { title: string; links: { label: string; id?: string; go?: () => void }[] }[] = [
  { title: 'Produto', links: [
    { label: 'Ferramentas', id: 'ferramentas' }, { label: 'Modo Show', id: 'modo-show' }, { label: 'IA', id: 'ia' },
    { label: 'Maestro', id: 'maestro' }, { label: 'Mixer', id: 'mixer' },
  ] },
  { title: 'Palco', links: [
    { label: 'Área do Músico', id: 'banda' }, { label: 'TV do palco', id: 'tv' }, { label: 'Novidades', id: 'novidades' },
    { label: 'Palco × estúdio', id: 'por-que' },
  ] },
  { title: 'Assinatura', links: [
    { label: 'Preços', id: 'precos' }, { label: 'Planos', go: goPlans }, { label: 'Teste grátis de 48 horas', go: goDownload },
  ] },
];

function Footer() {
  return (
    <footer className="vs-footer">
      <div className="vs-wrap">
        <div className="vs-footer-grid">
          <div className="vs-footer-brand">
            <div className="flex items-center gap-3">
              <VsLogo size={30} />
              <span className="vs-wordmark">VS Stage Pro</span>
            </div>
            <p className="mt-4 max-w-[19rem]">O primeiro motor de áudio construído exclusivamente para palco.</p>
            {/* O contato fica no botão "Fale conosco" (pedido do dono: sem o número à mostra) */}
            <a href={supportWhatsAppUrl(SITE_SUPPORT_MESSAGE)} target="_blank" rel="noopener noreferrer" className="vs-key vs-key-sm vs-key-steel mt-6">
              <span className="vs-led is-green" aria-hidden="true" />Fale conosco
            </a>
          </div>
          {FOOTER_COLS.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <p className="vs-footer-title">{col.title}</p>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    {l.id
                      ? <a href={`#${l.id}`} onClick={(e) => scrollToId(e, l.id!)} className="vs-footer-link">{l.label}</a>
                      : <button type="button" onClick={l.go} className="vs-footer-link">{l.label}</button>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="vs-footer-base">
          <p>© 2026 VS Stage Pro. Todos os direitos reservados.</p>
          <p>Para macOS Sonoma e Sequoia, em Macs com Apple Silicon.</p>
        </div>
      </div>
    </footer>
  );
}
