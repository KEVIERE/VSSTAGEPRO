import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Apple,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Compass,
  Cpu,
  Gauge,
  Layers,
  Lock,
  Mic2,
  ShieldCheck,
  SlidersVertical,
  Sparkles,
  Tablet,
  Tv,
  Zap,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import { useScrollReveal } from './useScrollReveal';

interface Shot {
  img: string;
  alt: string;
  title: string;
  tag: string;
}

const HERO_SLIDES: Shot[] = [
  { img: '/shots/vs_stage.jpg', title: 'DAW & MIXER PRINCIPAL', tag: 'EDITOR COMPLETO', alt: 'Playlist e mixer do VS Stage Pro em ação' },
  { img: '/shots/modo_show.jpg', title: 'MODO SHOW EM TELA CHEIA', tag: 'CONTROLE NO PALCO', alt: 'Modo Show com playlist em tela cheia e contador do restante da música' },
  { img: '/shots/area_do_musico.jpg', title: 'ÁREA DO MÚSICO NO CELULAR', tag: 'CIFRAS EM TEMPO REAL', alt: 'Área do músico no celular com cifras e letras do show' },
  { img: '/shots/teleprompt.jpg', title: 'TELEPROMPTER PARA A TV DO PALCO', tag: 'LETRAS & AVISOS', alt: 'Tela do produtor: teleprompter, avisos e letras na TV ligada ao palco' },
  { img: '/shots/timeline.jpg', title: 'TIMELINE INDIVIDUAL POR MÚSICA', tag: 'ORGANIZAÇÃO TOTAL', alt: 'Timeline exclusiva de cada música no VS Stage' },
];

function HeroCarousel() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setIndex((i) => (i + 1) % HERO_SLIDES.length);
    }, 4500);
    return () => clearInterval(t);
  }, []);

  const slide = HERO_SLIDES[index];

  return (
    <div className="relative w-full rounded-2xl overflow-hidden bg-[#0c0d12] shadow-2xl border border-white/10 group">
      <div className="aspect-[16/10] sm:aspect-[16/9] w-full overflow-hidden relative">
        <img
          src={slide.img}
          alt={slide.alt}
          className="w-full h-full object-cover transition-opacity duration-700 ease-in-out"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent pointer-events-none" />

        {/* Legenda Estilo Apple */}
        <div className="absolute bottom-4 sm:bottom-6 left-4 sm:left-6 right-4 sm:right-6 flex items-center justify-between text-white">
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full bg-white/15 backdrop-blur-md uppercase text-emerald-300 border border-white/10">
              {slide.tag}
            </span>
            <span className="text-xs sm:text-sm font-semibold text-white/90 drop-shadow">
              {slide.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            {HERO_SLIDES.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === index ? 'w-6 bg-white' : 'w-1.5 bg-white/30 hover:bg-white/50'
                }`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const COMPARISON = [
  {
    feature: 'Timeline individual por música',
    traditional: 'Um projeto pesado com todas as músicas na mesma régua ou carregar outro arquivo demorando minutos',
    vsStage: 'Cada música tem sua timeline exclusiva; transição em 0 segundos no show',
  },
  {
    feature: 'Importação e Roteamento',
    traditional: 'Arrastar track por track, nomear canal por canal e rotear na mão em cada música',
    vsStage: 'Arraste a pasta e pronto: IA reconhece os instrumentos e roteia pros canais certos',
  },
  {
    feature: 'Estabilidade no Palco',
    traditional: 'Plugins pesados de estúdio que consomem CPU e correm risco de travar no meio do show',
    vsStage: 'Motor nativo ultraleve focado em reprodução ao vivo sem travamento',
  },
  {
    feature: 'Controle de Tom e BPM',
    traditional: 'Plugins de pitch shift que deformam o áudio e desalinhamento de click',
    vsStage: 'Afinador (Tuner) e andamento integrados que mudam o tom mantendo a velocidade',
  },
  {
    feature: 'Sincronismo com Iluminação (LTC)',
    traditional: 'Configurar plugins complexos de gerador de SMPTE com risco de enviar sinal nos fones',
    vsStage: 'Canal Timecode LTC integrado com volume protegido a -6dB e saída isolada',
  },
  {
    feature: 'Letras e Cifras para a Banda',
    traditional: 'Papéis impressos, iPads avulsos desordenados ou apps externos desconectados',
    vsStage: 'Rede local integrada: cifras no celular do músico e teleprompter na TV do palco',
  },
];

const FAQS = [
  {
    q: 'O que exatamente é o VS Stage Pro?',
    a: 'O VS Stage Pro é uma Estação de Trabalho de Áudio Digital (DAW) completa e profissional projetada especificamente para o palco ao vivo. Ele gerencia e dispara multitracks (stems), faixas de click, guia do maestro e timecode LTC para mesas de luz, transmitindo em tempo real cifras para os músicos e teleprompter com letras na TV.',
  },
  {
    q: 'Ele roda em computadores Windows ou apenas Mac?',
    a: 'O VS Stage Pro foi desenvolvido com máxima otimização para macOS (Apple Silicon M1/M2/M3/M4 e Intel), garantindo latência quase zero e estabilidade ininterrupta em shows. A Área do Músico e o Teleprompter funcionam em qualquer celular, tablet ou TV com navegador via rede Wi-Fi.',
  },
  {
    q: 'Como funciona o teste gratuito de 48 horas?',
    a: 'Você baixa o aplicativo, cria sua conta em poucos segundos e tem 48 horas de acesso total, sem precisar cadastrar cartão de crédito. Todas as ferramentas de áudio, IA, mixer e palco ficam liberadas para você ensaiar e testar na prática.',
  },
  {
    q: 'Preciso de internet no palco para fazer o show?',
    a: 'Não! O VS Stage Pro funciona 100% offline. Para conectar o celular dos músicos ou a TV do palco no teleprompter, basta conectar o computador e os celulares no mesmo roteador Wi-Fi (mesmo sem sinal de internet). O show acontece com total privacidade e velocidade local instantânea.',
  },
  {
    q: 'Como funciona o canal de Timecode LTC para iluminação?',
    a: 'O canal TIMECODE (LTC) já vem configurado de fábrica na timeline e no mixer. Ele gera o sinal padrão SMPTE Linear Timecode pronto para sincronizar mesas de iluminação (GrandMA, Avolites, Chamsys, Daslight) e telões de LED, com o volume protegido a -6dB e saída isolada para não vazar no som principal.',
  },
  {
    q: 'Como funciona a detecção de BPM e a masterização vocal com IA?',
    a: 'Ao importar seus arquivos de áudio, a Inteligência Artificial analisa instantaneamente as pistas percussivas e detecta o andamento exato (BPM) da música. Na faixa Maestro, o processador de voz inteligente aplica equalização cirúrgica de presença, compressor óptico e limiter para que os comandos do maestro sejam ouvidos com clareza cristalina no meio da banda.',
  },
];

function RevealBlock({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const { ref, revealed } = useScrollReveal();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        revealed
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-100 sm:opacity-0 sm:translate-y-6 sm:scale-[0.99]'
      } ${className}`}
    >
      {children}
    </div>
  );
}

export default function SalesPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const subscribe = () => { window.location.hash = '#planos'; };

  return (
    <div className="min-h-screen bg-[#000000] text-[#f5f5f7] font-sans selection:bg-[#0071e3] selection:text-white overflow-x-hidden antialiased">

      {/* 1. APPLE-STYLE STICKY LOCAL SUB-NAVIGATION */}
      <header className="sticky top-0 z-50 bg-[#000000]/80 backdrop-blur-xl border-b border-white/[0.12] transition-colors">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 text-white font-bold text-sm tracking-tight hover:opacity-85 transition-opacity">
            <VsLogo size={22} />
            <span>VS Stage Pro</span>
          </a>

          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-5 text-xs text-[#86868b] font-medium">
              <a href="#visao-geral" className="hover:text-white transition-colors">Visão Geral</a>
              <a href="#fluxos" className="hover:text-white transition-colors">Fluxos de Trabalho</a>
              <a href="#inteligencia" className="hover:text-white transition-colors">Inteligência</a>
              <a href="#mixagem" className="hover:text-white transition-colors">Mixagem</a>
              <a href="#mobilidade" className="hover:text-white transition-colors">Palco & Rede</a>
              <a href="#faq" className="hover:text-white transition-colors">Dúvidas</a>
            </nav>

            <div className="flex items-center gap-2.5">
              <a
                href="#baixar"
                className="hidden sm:inline-block text-xs font-medium text-[#86868b] hover:text-white transition-colors"
              >
                Teste gratuito
              </a>
              <button
                type="button"
                onClick={subscribe}
                className="h-7 px-3.5 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-xs font-semibold tracking-tight transition-all active:scale-95 shadow-sm"
              >
                Assinar
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* 2. HERO SECTION — ESTILO APPLE LOGIC PRO */}
      <section id="visao-geral" className="relative pt-16 sm:pt-24 pb-20 sm:pb-32 overflow-hidden text-center">
        {/* Glow atmosférico suave no topo */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-gradient-to-b from-[#ff9f0a]/10 via-[#0a84ff]/5 to-transparent blur-[140px] pointer-events-none" />

        <div className="max-w-5xl mx-auto px-4 sm:px-6 relative z-10">
          {/* Logo Oficial Centralizado */}
          <div className="mx-auto w-24 h-24 mb-6 transition-transform hover:scale-105 duration-300 drop-shadow-[0_12px_28px_rgba(255,159,10,0.25)]">
            <VsLogo size={96} />
          </div>

          <h2 className="text-sm sm:text-base font-bold text-[#ff9f0a] tracking-wider uppercase mb-3">
            VS Stage Pro
          </h2>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.06] max-w-4xl mx-auto">
            Suas ideias soam bem no palco.
          </h1>

          <p className="mt-6 text-lg sm:text-xl text-[#86868b] max-w-3xl mx-auto font-normal leading-relaxed">
            A estação de trabalho de áudio digital completa projetada para a pressão do show ao vivo. Multitracks com timeline exclusiva por música, roteamento inteligente, BPM e afinação por IA, Timecode LTC na saída de fone e teleprompter com cifras ao vivo em qualquer tela.
          </p>

          {/* Links e Botões de Chamada Estilo Apple */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-9">
            <button
              type="button"
              onClick={subscribe}
              className="h-12 px-7 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-base font-semibold tracking-tight transition-all active:scale-95 shadow-lg shadow-[#0071e3]/25 flex items-center justify-center gap-2"
            >
              <span>Começar Teste Grátis</span>
              <ChevronRight size={16} />
            </button>

            <a
              href="#diferenciais"
              className="text-base font-medium text-[#2997ff] hover:underline flex items-center gap-1 group"
            >
              <span>Por que o VS Stage Pro no palco?</span>
              <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          {/* Banner de Compatibilidade Apple macOS */}
          <div className="flex items-center justify-center gap-2 mt-8 text-xs text-[#86868b]">
            <Apple size={14} className="text-white/80" />
            <span>Otimizado para macOS Sonoma, Sequoia e Apple Silicon (M1/M2/M3/M4)</span>
          </div>

          {/* MOCKUP DO PROGRAMA EM ALTA DEFINIÇÃO */}
          <div className="mt-14 sm:mt-20 max-w-5xl mx-auto">
            <div className="relative rounded-2xl sm:rounded-3xl border border-white/15 bg-[#161618] p-2 sm:p-3.5 shadow-2xl shadow-black/90">
              {/* Barra superior de janela Mac */}
              <div className="flex items-center justify-between px-3 pb-3 pt-1 border-b border-white/[0.08] mb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                  <span className="w-3 h-3 rounded-full bg-[#27c93f]" />
                  <span className="ml-3 text-[11px] font-bold text-white/50 tracking-wider uppercase hidden sm:inline">
                    VS Stage Pro — Live Performance Engine
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-[#86868b]">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold text-[11px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> MOTOR ATIVO
                  </span>
                </div>
              </div>

              <HeroCarousel />
            </div>
          </div>
        </div>
      </section>

      {/* 3. MENU MODULAR DE NAVEGAÇÃO RÁPIDA (CONHEÇA O VS STAGE PRO) */}
      <section className="border-y border-white/[0.1] bg-[#0c0d12]/90 backdrop-blur-xl py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Conheça o VS Stage Pro.
            </h2>
            <p className="text-sm text-[#86868b] mt-1.5">
              Explore as ferramentas criadas para transformar seu show.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
            {[
              { id: '#fluxos', icon: Zap, title: 'Fluxos', subtitle: 'Importação & Timeline' },
              { id: '#inteligencia', icon: Sparkles, title: 'Inteligência', subtitle: 'BPM, Tuner & Voz' },
              { id: '#mixagem', icon: SlidersVertical, title: 'Mixagem', subtitle: '16 Canais & Faders' },
              { id: '#timecode', icon: Clock, title: 'Sincronismo', subtitle: 'Timecode LTC' },
              { id: '#mobilidade', icon: Tablet, title: 'Palco & Rede', subtitle: 'Cifras & TV' },
              { id: '#diferenciais', icon: ShieldCheck, title: 'Confiabilidade', subtitle: 'Zero Travamentos' },
            ].map(({ id, icon: Icon, title, subtitle }) => (
              <a
                key={title}
                href={id}
                className="p-4 rounded-2xl bg-[#161618] border border-white/10 hover:border-white/25 hover:bg-[#1d1d20] transition-all flex flex-col items-center text-center group"
              >
                <div className="w-10 h-10 rounded-xl bg-white/[0.06] text-white flex items-center justify-center mb-2.5 group-hover:scale-110 group-hover:text-[#ff9f0a] transition-all">
                  <Icon size={18} />
                </div>
                <span className="text-xs font-bold text-white group-hover:text-[#ff9f0a] transition-colors">{title}</span>
                <span className="text-[10px] text-[#86868b] mt-0.5 leading-tight">{subtitle}</span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* 4. SEÇÃO: FLUXOS DE TRABALHO / "CRIE NA VELOCIDADE DO SOM" */}
      <section id="fluxos" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="max-w-3xl mb-16">
              <span className="text-xs font-bold text-[#ff9f0a] uppercase tracking-widest">
                Fluxos de trabalho
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Crie na velocidade do som.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Cada segundo conta no ensaio e na turnê. O VS Stage Pro elimina horas de edição manual e permite montar repertórios completos com transição imediata entre faixas.
              </p>
            </div>
          </RevealBlock>

          <div className="grid md:grid-cols-2 gap-6">
            <RevealBlock delay={80}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full flex flex-col justify-between">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 text-[#ff9f0a] flex items-center justify-center mb-6">
                    <Layers size={22} />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Uma Timeline Exclusiva por Música</h3>
                  <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                    Chega de arrastar todas as músicas para a mesma régua infinita de 2 horas. No VS Stage, cada música tem sua timeline independente com compassos, clipes e volume próprios. Mude a ordem do show na hora com arrastar e soltar.
                  </p>
                </div>
                <div className="mt-8 pt-6 border-t border-white/[0.08] text-xs font-semibold text-white/90 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span>Transição instantânea de áudio sem congelamento de tela</span>
                </div>
              </div>
            </RevealBlock>

            <RevealBlock delay={160}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full flex flex-col justify-between">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-[#0a84ff]/10 text-[#0a84ff] flex items-center justify-center mb-6">
                    <Compass size={22} />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Medleys e Transições Perfeitas</h3>
                  <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                    Fatie pot-pourris e medleys diretamente no cursor com um clique. Alterne compassos, compassos em branco ou junções de duas músicas com marcadores visuais claros e sem cortes abruptos nos fones da banda.
                  </p>
                </div>
                <div className="mt-8 pt-6 border-t border-white/[0.08] text-xs font-semibold text-white/90 flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span>Edição não-destrutiva com atalhos de estúdio (S / Split)</span>
                </div>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* 5. SEÇÃO: INTELIGÊNCIA ARTIFICIAL / "UMA SONORA MESA DE SOM" */}
      <section id="inteligencia" className="py-24 sm:py-32 bg-[#0c0d12]/90 border-y border-white/[0.1] relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="max-w-3xl mb-16">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                Inteligência
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Uma sonora mesa de som inteligente.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Algoritmos treinados especificamente para engenharia de áudio ao vivo reconhecem instrumentos, detectam andamentos e tratam a voz do maestro.
              </p>
            </div>
          </RevealBlock>

          <div className="grid md:grid-cols-3 gap-6">
            <RevealBlock delay={50}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6">
                  <Cpu size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Roteamento por Nome & Stems</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  Basta arrastar a pasta das multitracks: o motor reconhece as palavras nos nomes dos arquivos (Bateria, Baixo, Teclados, Guitarras, Metais, Vozes, Guia e Click) e encaminha cada pista para seu fader correto automaticamente.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock delay={150}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 text-[#ff9f0a] flex items-center justify-center mb-6">
                  <Gauge size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Detecção de BPM & Afinador (Tuner)</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  A IA calcula o BPM exato analisando o click ou as faixas rítmicas. Com a Torre de BPM e o Afinador nativo, você ajusta o andamento e transpõe o tom (+/- semitons) para o cantor na hora do show, sem mudar a velocidade.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock delay={250}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-[#a855f7]/10 text-[#a855f7] flex items-center justify-center mb-6">
                  <Mic2 size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Masterização Vocal do Maestro</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  Grave contagens e guias diretamente no microfone: o motor de masterização aplica corte de subgraves a 85Hz, realce de presença em 3.5kHz e compressor óptico com limiter broadcast para a voz cortar com força no fone da banda.
                </p>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* 6. SEÇÃO: MIXAGEM & TIMECODE / "DÊ UM TOQUE NO SEU MIX" */}
      <section id="mixagem" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="max-w-3xl mb-16">
              <span className="text-xs font-bold text-[#0a84ff] uppercase tracking-widest">
                Mixagem e Saídas
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Dê um toque no seu mix ao vivo.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Mixer completo com faders de precisão de 100mm, medidores VU estéreo em tempo real e saídas físicas mapeadas para sua interface de áudio.
              </p>
            </div>
          </RevealBlock>

          <div className="grid lg:grid-cols-2 gap-8 items-center">
            <RevealBlock>
              <div className="space-y-6 text-[#86868b] text-base leading-relaxed">
                <p>
                  O mixer do VS Stage Pro oferece controle total sobre os subgrupos essenciais da banda (Bateria, Baixo, Teclados, Guitarras, Metais, Vozes, Click e Guia), permitindo mutar ou solar canais durante a passagem de som em segundos.
                </p>
                <div className="p-6 rounded-2xl bg-[#161618] border border-white/10 space-y-3">
                  <div className="flex items-center gap-3 text-white font-bold text-lg">
                    <Lock size={18} className="text-[#ff9f0a]" />
                    <span>Trava de Faders contra Acidentes</span>
                  </div>
                  <p className="text-sm text-[#86868b]">
                    No palco, um esbarrão no mouse não pode estragar a mixagem. Cada fader conta com trava de segurança individual (cadeado) para impedir qualquer mudança involuntária de volume durante o show.
                  </p>
                </div>

                <div className="p-6 rounded-2xl bg-[#161618] border border-white/10 space-y-3">
                  <div className="flex items-center gap-3 text-white font-bold text-lg">
                    <Clock size={18} className="text-[#0a84ff]" />
                    <span>Timecode LTC Dedicado para Iluminação</span>
                  </div>
                  <p className="text-sm text-[#86868b]">
                    Gere código de tempo SMPTE Linear Timecode na saída de fone ou em canal dedicado da placa de som para sincronizar mesas GrandMA, Avolites, Chamsys e painéis de LED em sincronia de milissegundos com as músicas.
                  </p>
                </div>
              </div>
            </RevealBlock>

            <RevealBlock delay={100}>
              <div className="p-6 rounded-3xl bg-[#161618] border border-white/10 shadow-2xl flex flex-col items-center justify-center">
                <img
                  src="/shots/vs_stage.jpg"
                  alt="Mixer e canais do VS Stage Pro"
                  className="w-full h-auto rounded-xl object-cover shadow-2xl"
                />
                <span className="text-xs text-[#86868b] mt-4 font-mono">
                  Console de 16 canais com roteamento direto e faders calibrados
                </span>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* 7. SEÇÃO: PALCO & REDE LOCAL / "A BANDA NO MESMO COMPASSO" */}
      <section id="mobilidade" className="py-24 sm:py-32 bg-[#0c0d12]/90 border-t border-white/[0.1] relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="max-w-3xl mb-16">
              <span className="text-xs font-bold text-[#ff9f0a] uppercase tracking-widest">
                Mobilidade e Palco
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                A banda inteira no mesmo compasso.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Esqueça pastas com papel amassado e letras desatualizadas. O VS Stage Pro transmite cifras e teleprompter em tempo real para qualquer tela conectada.
              </p>
            </div>
          </RevealBlock>

          <div className="grid md:grid-cols-2 gap-8">
            <RevealBlock delay={80}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between h-full">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 text-[#ff9f0a] flex items-center justify-center mb-6">
                    <Tablet size={22} />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Área do Músico no Celular</h3>
                  <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                    Basta escanear o QR Code no roteador Wi-Fi local (mesmo sem internet): o celular de cada integrante abre a cifra exata da música em execução, avançando compasso a compasso com o tom atualizado automaticamente.
                  </p>
                </div>
                <div className="mt-8 rounded-xl overflow-hidden border border-white/10">
                  <img src="/shots/area_do_musico.jpg" alt="Área do músico no celular" className="w-full h-auto object-cover" />
                </div>
              </div>
            </RevealBlock>

            <RevealBlock delay={160}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all flex flex-col justify-between h-full">
                <div>
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6">
                    <Tv size={22} />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Teleprompter na TV do Palco</h3>
                  <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                    Conecte uma TV ou monitor virado para os cantores: a tela do teleprompter exibe as letras sincronizadas com o andamento, contagens regressivas e avisos enviados na hora pelo diretor musical.
                  </p>
                </div>
                <div className="mt-8 rounded-xl overflow-hidden border border-white/10">
                  <img src="/shots/teleprompt.jpg" alt="Teleprompter para TV do palco" className="w-full h-auto object-cover" />
                </div>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* 8. TABELA COMPARATIVA ESTILO APPLE */}
      <section id="diferenciais" className="py-24 sm:py-32 border-t border-white/[0.1] relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
                Por que o VS Stage Pro no lugar de uma DAW comum?
              </h2>
              <p className="text-base text-[#86868b] mt-4">
                Programas como Logic, Ableton e Reaper foram feitos para estúdio. O VS Stage Pro foi feito para a pressão do palco.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <div className="rounded-3xl border border-white/15 bg-[#161618] overflow-hidden shadow-2xl">
              <div className="grid grid-cols-12 border-b border-white/10 p-5 bg-white/[0.02] text-xs font-bold uppercase tracking-wider">
                <div className="col-span-4 text-[#86868b]">Recurso</div>
                <div className="col-span-4 text-rose-400/80 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> DAWs de Estúdio
                </div>
                <div className="col-span-4 text-emerald-400 flex items-center gap-1.5 font-bold">
                  <CheckCircle2 size={14} /> VS Stage Pro
                </div>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {COMPARISON.map((row, idx) => (
                  <div key={row.feature} className={`grid grid-cols-12 p-5 text-sm items-center ${idx % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                    <div className="col-span-4 font-semibold text-white/95 pr-3">{row.feature}</div>
                    <div className="col-span-4 text-[#86868b] pr-4 leading-relaxed text-xs">
                      <span className="line-through text-white/30 mr-1.5">✕</span> {row.traditional}
                    </div>
                    <div className="col-span-4 text-white font-medium pl-1 leading-relaxed text-xs flex items-start gap-2">
                      <Check size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                      <span>{row.vsStage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </RevealBlock>
        </div>
      </section>

      {/* 9. FAQ RETRÁTIL ESTILO APPLE */}
      <section id="faq" className="py-24 sm:py-32 bg-[#0c0d12]/90 border-t border-white/[0.1] relative">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center mb-16">
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
                Perguntas? Nós temos as respostas.
              </h2>
              <p className="text-base text-[#86868b] mt-3">
                Tudo o que você precisa saber antes de levar o VS Stage Pro para o seu show.
              </p>
            </div>
          </RevealBlock>

          <div className="divide-y divide-white/[0.1]">
            {FAQS.map((faq, i) => (
              <RevealBlock key={faq.q} delay={i * 50}>
                <div className="py-6">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full text-left font-bold text-lg sm:text-xl text-white flex items-center justify-between gap-4 hover:text-[#2997ff] transition-colors"
                  >
                    <span>{faq.q}</span>
                    <span className={`text-[#86868b] transition-transform duration-300 shrink-0 ${openFaq === i ? 'rotate-180 text-[#2997ff]' : ''}`}>
                      <ChevronDown size={20} />
                    </span>
                  </button>
                  {openFaq === i && (
                    <div className="mt-4 text-sm sm:text-base text-[#86868b] leading-relaxed pr-8 animate-[fadeIn_200ms_ease-out]">
                      {faq.a}
                    </div>
                  )}
                </div>
              </RevealBlock>
            ))}
          </div>
        </div>
      </section>

      {/* 10. CTA FINAL — ESTILO APPLE LOGIC PRO */}
      <section className="py-28 sm:py-36 relative text-center border-t border-white/[0.1] overflow-hidden">
        <div className="absolute inset-0 bg-radial from-[#0071e3]/10 via-transparent to-transparent pointer-events-none" />

        <div className="max-w-4xl mx-auto px-4 sm:px-6 relative z-10">
          <RevealBlock>
            <div className="mx-auto w-20 h-20 mb-6 drop-shadow-[0_12px_24px_rgba(255,159,10,0.3)]">
              <VsLogo size={80} />
            </div>

            <h2 className="text-4xl sm:text-6xl font-extrabold text-white tracking-tight leading-tight">
              Faça seu próximo show com o VS Stage Pro.
            </h2>

            <p className="mt-5 text-lg sm:text-xl text-[#86868b] max-w-2xl mx-auto font-normal leading-relaxed">
              Crie sua conta na hora e desfrute de 48 horas de teste gratuito completo, sem necessidade de cartão de crédito.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-10">
              <button
                type="button"
                onClick={subscribe}
                className="h-12 px-8 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-base font-semibold tracking-tight transition-all active:scale-95 shadow-xl shadow-[#0071e3]/30 flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                <span>Ver Planos e Assinatura</span>
                <ChevronRight size={16} />
              </button>

              <a
                href="#baixar"
                className="h-12 px-8 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white text-base font-semibold border border-white/15 transition-all active:scale-95 flex items-center justify-center gap-2 w-full sm:w-auto"
              >
                <Apple size={18} />
                <span>Baixar para Mac</span>
              </a>
            </div>
          </RevealBlock>
        </div>
      </section>

      {/* 11. APPLE DIRECTORY FOOTER */}
      <footer className="border-t border-white/[0.1] bg-[#000000] py-14 text-xs text-[#86868b]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pb-8 border-b border-white/[0.08]">
            <div className="flex items-center gap-3 text-white font-bold text-sm">
              <VsLogo size={24} />
              <span>VS Stage Pro — Live Performance Engine</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-[#86868b]">
              <a href="#visao-geral" className="hover:text-white transition-colors">Visão Geral</a>
              <a href="#fluxos" className="hover:text-white transition-colors">Recursos</a>
              <a href="#faq" className="hover:text-white transition-colors">Dúvidas</a>
              <button type="button" onClick={subscribe} className="hover:text-white transition-colors">Planos</button>
            </div>
          </div>

          <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] text-[#6e6e73]">
            <div>
              Copyright © 2026 VS Stage Pro. Todos os direitos reservados.
            </div>
            <div className="flex items-center gap-4">
              <span>Termos de Uso</span>
              <span>•</span>
              <span>Privacidade</span>
              <span>•</span>
              <span>Suporte ao Diretor Musical</span>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
