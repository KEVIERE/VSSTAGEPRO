import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Apple,
  ArrowRight,
  AudioLines,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Flame,
  Headphones,
  HelpCircle,
  Layers,
  Lock,
  MessageCircle,
  Mic2,
  MonitorPlay,
  Music,
  Play,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
  Tablet,
  Tv,
  Users,
  Volume2,
  Wifi,
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
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % HERO_SLIDES.length), 4000);
    return () => window.clearInterval(id);
  }, [paused, index]);

  const go = (delta: number) => setIndex((i) => (i + delta + HERO_SLIDES.length) % HERO_SLIDES.length);

  return (
    <div
      className="relative aspect-video rounded-xl border border-white/10 overflow-hidden bg-black/60 shadow-2xl group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {HERO_SLIDES.map((slide, i) => (
        <div
          key={slide.img}
          className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${i === index ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
          aria-hidden={i !== index}
        >
          <img
            src={slide.img}
            alt={slide.alt}
            className="w-full h-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
          />
          {i === index && (
            <div className="absolute top-3 sm:top-4 left-3 sm:left-4 z-20 flex items-center gap-2">
              <span className="px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-white/15 text-2xs sm:text-xs font-bold text-logic-lcd-green tracking-wider uppercase">
                {slide.tag}
              </span>
              <span className="hidden sm:inline-block px-3 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 text-xs font-semibold text-white/90">
                {slide.title}
              </span>
            </div>
          )}
        </div>
      ))}

      {/* Controles do carrossel */}
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Imagem anterior"
        className="absolute left-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:bg-black/90 hover:scale-105"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Próxima imagem"
        className="absolute right-3 top-1/2 -translate-y-1/2 z-30 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/60 backdrop-blur-md border border-white/15 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all hover:bg-black/90 hover:scale-105"
      >
        <ChevronRight size={22} />
      </button>

      {/* Indicadores inferiores */}
      <div className="absolute bottom-3.5 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/50 backdrop-blur-md border border-white/10">
        {HERO_SLIDES.map((slide, i) => (
          <button
            key={slide.img}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Ver ${slide.title}`}
            className={`h-1.5 rounded-full transition-all duration-300 ${i === index ? 'w-7 bg-logic-lcd-green shadow-sm shadow-logic-lcd-green' : 'w-1.5 bg-white/30 hover:bg-white/60'}`}
          />
        ))}
      </div>
    </div>
  );
}

const STATS = [
  { value: '100% Offline', label: 'Funciona no palco sem depender de internet', icon: Wifi, color: 'text-logic-lcd-green' },
  { value: 'LTC Integrado', label: 'Canal Timecode travado para luzes e LED', icon: Radio, color: 'text-logic-lcd-amber' },
  { value: 'Master L/R Mágico', label: 'Split instantâneo em caso de falha de cabo', icon: ShieldAlert, color: 'text-logic-lcd-green' },
  { value: '48h Grátis Real', label: 'O tempo só conta ao abrir o app no Mac', icon: Clock, color: 'text-logic-lcd-amber' },
];

const MAIN_PILLARS = [
  {
    icon: AudioLines,
    tag: 'ARQUITETURA INTELIGENTE',
    title: 'Uma timeline limpa por música. Chega de projetos gigantes travando.',
    desc: 'Esqueça as DAWs de estúdio que empilham 30 músicas e 50 faixas em uma única timeline de duas horas pesada e propensa a travar. No VS Stage Pro, cada música tem sua timeline exclusiva, limpa e independente. Você troca de música na playlist instantaneamente sem carregar novos arquivos na memória.',
    color: 'from-emerald-500/10 to-transparent',
    border: 'border-emerald-500/20',
    badge: 'text-logic-lcd-green bg-logic-lcd-green/10',
    shot: '/shots/vs-playlist.png',
  },
  {
    icon: Layers,
    tag: 'ROTEAMENTO INTELIGENTE & IA',
    title: 'Reconhece o nome dos clipes, detecta o BPM com IA e inclui Afinador (Tuner).',
    desc: 'Basta arrastar a pasta dos multitracks: o VS Stage Pro reconhece os nomes dos clipes de áudio e roteia automaticamente cada instrumento para seu canal e multigrupo (Bateria, Baixo, Teclados, Guitarras, Metais, Vozes). O BPM é detectado instantaneamente por Inteligência Artificial, e você ajusta o andamento e afina o tom no Tuner (+/- semitons) sem alterar a velocidade nem desalinhar o Timecode LTC.',
    color: 'from-amber-500/10 to-transparent',
    border: 'border-amber-500/20',
    badge: 'text-logic-lcd-amber bg-logic-lcd-amber/10',
    shot: '/shots/vs-groups.png',
  },
  {
    icon: Radio,
    tag: 'SINCRONIA COM ILUMINAÇÃO & LED',
    title: 'Canal TIMECODE (LTC) blindado e travado a −6.0 dB.',
    desc: 'O canal 1 do mixer é exclusivo para Timecode LTC: configurado nativamente com "Sem Saída" no master para nunca vazar no som do PA, e com volume travado a −6.0 dB. Ligue a saída de áudio direto na mesa de iluminação (GrandMA, Avolites) ou painéis de LED e tenha o show visual sincronizado sem sustos.',
    color: 'from-amber-500/10 to-transparent',
    border: 'border-amber-500/20',
    badge: 'text-logic-lcd-amber bg-logic-lcd-amber/10',
    shot: '/shots/vs-timecode.png',
  },
  {
    icon: ShieldAlert,
    tag: 'RECURSO DE EMERGÊNCIA EXCLUSIVO',
    title: 'Botão Master Mágico: sobreviva a falhas no palco com 1 toque.',
    desc: 'Se uma via da multicabo falhar ou se o técnico da casa só disponibilizar um canal estéreo (L/R) no mixer de emergência, aperte um botão no Master: o VS Stage Pro roteia Click e Maestro 100% para o lado Esquerdo (L, fones) e toda a banda e multitracks para o Direito (R, PA). O show continua sem parar um segundo.',
    color: 'from-emerald-500/10 to-transparent',
    border: 'border-emerald-500/20',
    badge: 'text-logic-lcd-green bg-logic-lcd-green/10',
    shot: '/shots/vs-master.png',
  },
  {
    icon: Lock,
    tag: 'SEGURANÇA TOTAL NO PALCO',
    title: 'Modo Show Blindado: sem acidentes por esbarrões no teclado.',
    desc: 'No Modo Show, a barra de espaço do Mac é desativada para não pausar o show acidentalmente com cotoveladas ou esbarrões. O visor exibe um cronômetro gigante do restante da música, painéis TOCANDO e PRÓXIMA em destaque, tom, andamento e contagem total do setlist para o diretor musical.',
    color: 'from-emerald-500/10 to-transparent',
    border: 'border-emerald-500/20',
    badge: 'text-logic-lcd-green bg-logic-lcd-green/10',
    shot: '/shots/MODO_SHOW_PLAYLIST.png',
  },
  {
    icon: Sliders,
    tag: 'IMPROVISO CONTROLADO',
    title: 'Pads de Regions e Loops ao vivo (Teclas 1 a 9, L e P).',
    desc: 'Marque na timeline REFRÃO, SOLO e FINAL. Se a banda ou o cantor quiser repetir o refrão mais uma vez porque a plateia está cantando, acione o pad ou aperte a tecla rápida correspondente: o VS Stage entra em loop no compasso exato, sem desafinar o click da banda nem interromper a contagem do show.',
    color: 'from-amber-500/10 to-transparent',
    border: 'border-amber-500/20',
    badge: 'text-logic-lcd-amber bg-logic-lcd-amber/10',
    shot: '/shots/vs-loops-show.png',
  },
  {
    icon: Tablet,
    tag: 'ECOSSISTEMA DE PALCO INTEGRADO',
    title: 'Área do Músico no celular e Teleprompter na TV do palco.',
    desc: 'O computador do diretor musical cria uma rede local no palco. Os músicos abrem no celular suas cifras e partituras que mudam sozinhas assim que cada música começa. Ao mesmo tempo, a TV do palco exibe a letra sincronizada, cronômetro de show e avisos rápidos enviados pelo produtor ("Últimas 2 músicas", "Alô para a cidade").',
    color: 'from-emerald-500/10 to-transparent',
    border: 'border-emerald-500/20',
    badge: 'text-logic-lcd-green bg-logic-lcd-green/10',
    shot: '/shots/teleprompt.jpg',
  },
];

const COMPARISON = [
  { feature: 'Estrutura das músicas', traditional: '30 músicas empilhadas numa única timeline bagunçada', vsStage: 'Uma timeline independente e limpa para cada música' },
  { feature: 'Roteamento de instrumentos', traditional: 'Criação manual de dezenas de pastas e canais de áudio', vsStage: 'Reconhecimento do nome dos clipes com roteamento automático' },
  { feature: 'Detecção de BPM & Afinação', traditional: 'Tap tempo impreciso e plugins externos pesados para mudar o tom', vsStage: 'Detecção de BPM por IA, ajuste de andamento e Afinador (Tuner) nativos' },
  { feature: 'Segurança contra acidentes', traditional: 'Barra de espaço pausa o show se alguém esbarrar no teclado', vsStage: 'Modo Show blindado com barra de espaço travada para o palco' },
  { feature: 'Timecode para luzes (LTC)', traditional: 'Configuração manual complexa com risco de vazar no som principal', vsStage: 'Canal 1 LTC dedicado, travado a −6.0 dB e isolado do master' },
  { feature: 'Imprevistos no cabeamento', traditional: 'Sem solução rápida; necessita reconfigurar o mixer no meio do show', vsStage: 'Botão Master Mágico que divide Click (L) e Banda (R) em 1 clique' },
  { feature: 'Cifras para os músicos', traditional: 'Pastas de papel, PDFs impressos ou apps desconectados', vsStage: 'Área do Músico via Wi-Fi local sincronizada com o play da música' },
  { feature: 'Teleprompter de palco', traditional: 'Necessita de um segundo computador ou software à parte', vsStage: 'Tela do Produtor nativa com teleprompter, avisos e TV do palco' },
  { feature: 'Dependência de internet', traditional: 'Muitos serviços em nuvem exigem conexão ativa no evento', vsStage: '100% offline no palco usando qualquer roteador Wi-Fi local' },
];

const FAQS = [
  {
    q: 'O VS Stage Pro precisa de internet para funcionar no palco?',
    a: 'Não! O programa foi projetado para a realidade dos palcos brasileiros. Todo o motor de áudio, o Modo Show, a área do músico no celular e o teleprompter na TV funcionam 100% offline através de qualquer roteador Wi-Fi comum no palco, sem precisar de dados móveis ou internet.',
  },
  {
    q: 'Como funciona o teste grátis de 48 horas?',
    a: 'O teste de 48 horas é real e transparente: ele NÃO exige cartão de crédito no cadastro e o cronômetro só começa a contar a partir do momento exato em que você abrir o aplicativo instalado no seu Mac. Você pode testar todos os recursos antes de decidir assinar.',
  },
  {
    q: 'Posso usar minha interface de áudio multicanal?',
    a: 'Sim! O VS Stage Pro é compatível com qualquer placa de som ou interface de áudio USB, Thunderbolt ou Dante (Focusrite, Behringer, MOTU, M-Audio, Presonus, etc.). Você pode endereçar canais individuais ou grupos conforme desejar.',
  },
  {
    q: 'O que acontece se meu show tiver que mudar de ordem na hora?',
    a: 'Você pode reordenar músicas na playlist arrastando, ou simplesmente dar dois cliques em qualquer música da lista para ela ser a próxima. No Modo Show, a transição entre músicas é instantânea, sem atraso de carregamento.',
  },
  {
    q: 'Como funciona o roteamento inteligente e a detecção de BPM por IA?',
    a: 'Ao importar os multitracks, o motor analisa o nome dos clipes de áudio e reconhece automaticamente cada instrumento (Bateria, Baixo, Teclados, Guitarras, Metais, Vozes, Guia e Click), roteando tudo para os multigrupos corretos no mixer. A Inteligência Artificial detecta o BPM exato da música na hora, e você conta com o Afinador (Tuner) para alterar o tom (+/- semitons) e ajustar o andamento ao vivo sem engasgar o som.',
  },
  {
    q: 'Como funciona o canal de Timecode LTC?',
    a: 'O canal TIMECODE (LTC) já vem configurado no início do mixer. Ele gera o sinal SMPTE Linear Timecode pronto para sincronizar mesas de iluminação (GrandMA, Avolites, Chamsys) e painéis de LED, com o volume protegido a −6dB e sem saída no som principal.',
  },
];

function RevealBlock({
  children,
  className = '',
  delay = 0,
  direction = 'up',
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  direction?: 'up' | 'down' | 'left' | 'right' | 'zoom';
}) {
  const { ref, revealed } = useScrollReveal();

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
        revealed
          ? 'opacity-100 translate-x-0 translate-y-0 scale-100'
          : 'opacity-100 sm:opacity-0 sm:translate-y-4 sm:scale-[0.99]'
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
    <div
      className="min-h-screen bg-[#090a0d] text-logic-text selection:bg-logic-lcd-green selection:text-black overflow-x-hidden w-full max-w-full"
      style={{ background: 'radial-gradient(ellipse at 50% 0%, #13151f 0%, #090a0d 70%)' }}
    >
      {/* Luzes de Fundo Ambientais Dinâmicas (apenas em telas maiores para evitar travamento de GPU no mobile) */}
      <div className="hidden sm:block fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        <div className="absolute top-0 left-1/4 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-logic-lcd-green/8 blur-[160px] animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute top-1/3 right-1/4 translate-x-1/2 w-[650px] h-[650px] rounded-full bg-logic-lcd-amber/7 blur-[180px] animate-pulse" style={{ animationDuration: '10s' }} />
        <div className="absolute bottom-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-emerald-500/5 blur-[200px]" />
      </div>

      {/* Header Fixo Profissional */}
      <header className="sticky top-0 z-50 bg-[#0c0d12]/85 backdrop-blur-xl border-b border-white/[0.08] transition-all">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="#" className="flex items-center gap-3 group">
            <div className="transition-transform group-hover:scale-105">
              <VsLogo size={36} />
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-wider text-white flex items-center gap-2">
                VS STAGE <span className="text-2xs font-black px-1.5 py-0.5 rounded bg-logic-lcd-green/15 text-logic-lcd-green border border-logic-lcd-green/30">PRO</span>
              </span>
              <span className="text-[9px] tracking-widest text-logic-text-muted font-semibold uppercase">Live Performance Engine</span>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-7 text-xs font-semibold text-logic-text-dim">
            <a href="#recursos" className="hover:text-white transition-colors">Recursos do Palco</a>
            <a href="#diferenciais" className="hover:text-white transition-colors">Por que o VS Stage?</a>
            <a href="#como-funciona" className="hover:text-white transition-colors">Como Funciona</a>
            <a href="#faq" className="hover:text-white transition-colors">Dúvidas</a>
          </nav>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 pt-16 sm:pt-24 pb-16 overflow-hidden">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          {/* Badge de Destaque */}
          <div className="inline-flex max-w-full items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.04] border border-white/10 backdrop-blur-md mb-8 animate-[fadeIn_400ms_ease-out]">
            <span className="w-2 h-2 rounded-full bg-logic-lcd-green animate-ping shrink-0" />
            <span className="text-[10px] sm:text-xs font-bold tracking-wider text-logic-text-dim uppercase text-center leading-normal">
              O Primeiro Motor de Áudio Construído Exclusivamente para Palco
            </span>
          </div>

          <h1 className="text-3xl xs:text-4xl sm:text-6xl lg:text-7xl font-black text-white tracking-tight leading-[1.08] max-w-4xl mx-auto break-words">
            Uma timeline por música. <br className="hidden sm:inline" />
            <span className="bg-gradient-to-r from-logic-lcd-green via-emerald-300 to-logic-lcd-amber bg-clip-text text-transparent">
              Todo o show na sua mão.
            </span>
          </h1>

          <p className="text-logic-text-dim text-base sm:text-lg sm:leading-relaxed max-w-3xl mx-auto mt-6 font-normal">
            Esqueça DAWs de estúdio que travam com timelines gigantescas. O <strong className="text-white">VS Stage Pro</strong> reúne editor multitracks com timeline independente por música, <strong className="text-white">roteamento automático de instrumentos</strong> com reconhecimento do nome dos clipes de áudio, <strong className="text-white">detecção de BPM com inteligência artificial</strong>, controle de andamento e <strong className="text-white">afinador (tuner) integrado</strong>, mixer com Timecode LTC blindado, Modo Show à prova de acidentes, cifras sincronizadas no celular da banda e teleprompter na TV do palco.
          </p>

          {/* Botões de Ação Hero - DESTAQUE PRINCIPAL EM PLANOS & ASSINATURA */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5 mt-10">
            {/* Botão Primário (DESTAQUE MÁXIMO): Ver Planos & Assinatura */}
            <div className="relative group w-full sm:w-auto">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-logic-lcd-green via-emerald-400 to-teal-300 opacity-60 blur-lg group-hover:opacity-100 group-hover:blur-xl transition duration-500 animate-pulse pointer-events-none" />

              <button
                onClick={subscribe}
                className="relative overflow-hidden w-full sm:w-auto min-w-0 sm:min-w-[340px] max-w-full h-[64px] px-5 sm:px-8 rounded-2xl btn-neon-green text-black flex items-center justify-between gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/55 to-transparent -skew-x-12 animate-btn-sheen pointer-events-none" />

                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-black/15 backdrop-blur-sm border border-black/10 flex items-center justify-center text-black shadow-sm group-hover:scale-105 transition-transform shrink-0">
                    <Sparkles size={22} className="text-black" />
                  </div>
                  <div className="text-left flex flex-col justify-center">
                    <span className="text-[15px] sm:text-base font-black tracking-tight text-black leading-tight">
                      VER PLANOS & ASSINATURA
                    </span>
                    <span className="text-[11px] font-extrabold text-black/80 leading-tight tracking-wide mt-0.5">
                      A partir de R$ 49,92/mês • Sem fidelidade
                    </span>
                  </div>
                </div>

                <div className="w-9 h-9 rounded-xl bg-black/15 flex items-center justify-center group-hover:bg-black/25 group-hover:translate-x-1 transition-all shrink-0">
                  <ArrowRight size={18} className="text-black" />
                </div>
              </button>
            </div>

            {/* Botão Secundário: Baixar e Testar no Mac */}
            <a
              href="#baixar"
              className="relative group w-full sm:w-auto min-w-0 sm:min-w-[290px] max-w-full h-[64px] px-5 sm:px-6 rounded-2xl btn-glass-secondary text-white flex items-center justify-between gap-3 sm:gap-3.5 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center text-white group-hover:bg-white/[0.15] group-hover:scale-105 transition-all shrink-0">
                  <Apple size={22} />
                </div>
                <div className="text-left flex flex-col justify-center">
                  <span className="text-[14px] sm:text-[15px] font-bold text-white group-hover:text-emerald-300 transition-colors leading-tight">
                    Baixar e Testar no Mac
                  </span>
                  <span className="text-[11px] font-medium text-logic-text-dim leading-tight tracking-wide mt-0.5">
                    48h de teste grátis sem cartão
                  </span>
                </div>
              </div>
              <ChevronRight size={18} className="text-white/40 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0" />
            </a>
          </div>

          {/* Selos de Confiança */}
          <div className="flex flex-wrap items-center justify-center gap-x-6 sm:gap-x-8 gap-y-3 mt-10 text-xs text-logic-text-dim">
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-logic-lcd-green" /> 48h de teste grátis sem cartão
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-logic-lcd-green" /> Roteamento por Nome & BPM por IA
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-logic-lcd-green" /> Torre de BPM & Afinador (Tuner)
            </span>
            <span className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-logic-lcd-green" /> 100% offline no palco via Wi-Fi local
            </span>
          </div>

          {/* Mockup do Programa (Moldura macOS Retina) */}
          <div className="mt-14 max-w-5xl mx-auto relative group">
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-b from-logic-lcd-green/20 via-transparent to-logic-lcd-amber/10 blur-xl opacity-75 group-hover:opacity-100 transition duration-1000" />
            <div className="relative rounded-2xl border border-white/15 bg-[#14151a] p-2.5 sm:p-4 shadow-2xl shadow-black">
              {/* Barra superior de janela Mac */}
              <div className="flex items-center justify-between px-2 pb-3 pt-1 border-b border-white/[0.08] mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-[#ff5f56] inline-block" />
                  <span className="w-3 h-3 rounded-full bg-[#ffbd2e] inline-block" />
                  <span className="w-3 h-3 rounded-full bg-[#27c93f] inline-block" />
                  <span className="ml-3 text-2xs font-bold text-white/50 tracking-widest uppercase hidden sm:inline">
                    VS Stage Pro — Live Performance Engine
                  </span>
                </div>
                <div className="flex items-center gap-2 text-2xs text-logic-text-dim">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-logic-lcd-green/10 text-logic-lcd-green font-bold">
                    <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-green animate-pulse" /> ENGINE ONLINE
                  </span>
                </div>
              </div>

              <HeroCarousel />
            </div>
          </div>
        </div>
      </section>

      {/* Faixa de Estatísticas & Destaques */}
      <section className="relative z-10 border-y border-white/[0.08] bg-[#0c0d12]/90 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-2 lg:grid-cols-4 gap-6 sm:gap-8">
          {STATS.map(({ value, label, icon: Icon, color }, i) => (
            <RevealBlock key={value} delay={i * 90} direction="up">
              <div className="flex items-start gap-3.5">
                <div className={`p-2.5 rounded-xl bg-white/[0.04] border border-white/10 ${color} shrink-0`}>
                  <Icon size={22} />
                </div>
                <div>
                  <div className="text-lg sm:text-xl font-extrabold text-white tracking-tight">{value}</div>
                  <div className="text-xs text-logic-text-dim mt-0.5 leading-snug">{label}</div>
                </div>
              </div>
            </RevealBlock>
          ))}
        </div>
      </section>

      {/* Seção dos Pilares Profissionais (O Que Torna o VS Stage Único) */}
      <section id="recursos" className="relative z-10 py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock direction="up">
            <div className="text-center max-w-3xl mx-auto mb-20">
              <span className="px-3 py-1 rounded-full bg-logic-lcd-green/10 border border-logic-lcd-green/20 text-logic-lcd-green text-xs font-bold tracking-widest uppercase">
                Recursos de Alta Performance
              </span>
              <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight mt-4">
                Projetado para eliminar todas as falhas no palco
              </h2>
              <p className="text-logic-text-dim text-base mt-4 leading-relaxed">
                Cada detalhe do VS Stage Pro foi desenvolvido pensando na pressão do show ao vivo, onde um segundo de silêncio ou um clique errado custa caro.
              </p>
            </div>
          </RevealBlock>

          <div className="space-y-24">
            {MAIN_PILLARS.map((p, i) => (
              <div key={p.title} className={`grid lg:grid-cols-12 gap-8 sm:gap-12 items-center ${i % 2 === 1 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
                {/* Imagem do Print desliza com movimento ao rolar */}
                <RevealBlock delay={60} direction={i % 2 === 0 ? 'left' : 'right'} className="lg:col-span-7">
                  <div className="relative group">
                    <div className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-logic-lcd-green/15 to-logic-lcd-amber/15 blur-xl opacity-0 group-hover:opacity-100 transition duration-500" />
                    {p.shot.includes("vs-timecode") || p.shot.includes("vs-master") ? (
                      /* Faders / canais verticais com tamanho reduzido em 60% e centralizados em pedestal DAW */
                      <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#161720] via-[#101116] to-[#0a0b0e] p-6 sm:p-8 min-h-[300px] flex items-center justify-center shadow-2xl overflow-hidden group-hover:border-white/20 transition max-w-md mx-auto">
                        <div className="relative">
                          <div className="absolute -inset-4 rounded-2xl bg-gradient-to-b from-white/10 to-transparent blur-xl opacity-50" />
                          <img
                            src={p.shot}
                            alt={p.title}
                            className="relative w-auto h-auto max-w-[110px] sm:max-w-[125px] max-h-[300px] rounded-xl shadow-2xl drop-shadow-[0_16px_36px_rgba(0,0,0,0.9)] border border-white/10 transition-transform duration-500 group-hover:scale-105"
                            loading="lazy"
                            decoding="async"
                          />
                        </div>
                      </div>
                    ) : p.shot.includes("vs-playlist") ? (
                      /* Imagem da Playlist reduzida adicionalmente conforme solicitado */
                      <div className="relative rounded-2xl border border-white/10 bg-[#14151a] p-2.5 shadow-2xl overflow-hidden group-hover:border-white/20 transition max-w-[280px] sm:max-w-[340px] mx-auto">
                        <img
                          src={p.shot}
                          alt={p.title}
                          className="w-full h-auto rounded-xl object-cover transition-transform duration-500 group-hover:scale-[1.01]"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div className="relative rounded-2xl border border-white/10 bg-[#14151a] p-2.5 shadow-2xl overflow-hidden group-hover:border-white/20 transition">
                        <img
                          src={p.shot}
                          alt={p.title}
                          className="w-full h-auto rounded-xl object-cover transition-transform duration-500 group-hover:scale-[1.01]"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    )}
                  </div>
                </RevealBlock>

                {/* Texto Explicativo desliza do lado oposto */}
                <RevealBlock delay={140} direction={i % 2 === 0 ? 'right' : 'left'} className="lg:col-span-5">
                  <div className="space-y-4">
                    <span className={`inline-block px-3 py-1 rounded-md text-2xs font-extrabold tracking-wider uppercase ${p.badge}`}>
                      {p.tag}
                    </span>
                    <h3 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">
                      {p.title}
                    </h3>
                    <p className="text-sm text-logic-text-dim leading-relaxed font-normal">
                      {p.desc}
                    </p>
                  </div>
                </RevealBlock>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Tabela Comparativa: DAW de Estúdio vs. VS Stage Pro */}
      <section id="diferenciais" className="relative z-10 py-20 border-y border-white/[0.08] bg-[#0c0d12]/95 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <RevealBlock direction="up">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <span className="text-2xs font-extrabold tracking-widest text-logic-lcd-amber uppercase px-3 py-1 rounded-full bg-logic-lcd-amber/10 border border-logic-lcd-amber/20">
                Comparativo de Palco
              </span>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3">
                Por que DAWs comuns falham no show ao vivo?
              </h2>
              <p className="text-sm text-logic-text-dim mt-3">
                Programas como Ableton Live, Reaper e Logic foram criados para estúdio e gravação. O VS Stage Pro foi desenhado para o palco.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock direction="zoom" delay={100}>
            <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
              <div className="min-w-[560px] sm:min-w-0 rounded-2xl border border-white/10 bg-[#121318] overflow-hidden shadow-2xl">
              <div className="grid grid-cols-12 border-b border-white/10 p-4 sm:p-5 bg-white/[0.02] text-xs font-bold uppercase tracking-wider">
                <div className="col-span-4 text-logic-text-muted">Recurso</div>
                <div className="col-span-4 text-rose-400/90 flex items-center gap-1.5">
                  <AlertTriangle size={14} /> DAWs de Estúdio
                </div>
                <div className="col-span-4 text-logic-lcd-green flex items-center gap-1.5 font-black">
                  <CheckCircle2 size={14} /> VS Stage Pro
                </div>
              </div>

              <div className="divide-y divide-white/[0.06]">
                {COMPARISON.map((row, idx) => (
                  <div key={row.feature} className={`grid grid-cols-12 p-4 sm:p-5 text-xs sm:text-sm items-center ${idx % 2 === 1 ? 'bg-white/[0.01]' : ''}`}>
                    <div className="col-span-4 font-semibold text-white/90 pr-2">{row.feature}</div>
                    <div className="col-span-4 text-logic-text-dim pr-3 leading-relaxed text-xs">
                      <span className="line-through text-white/30 mr-1.5">✕</span> {row.traditional}
                    </div>
                    <div className="col-span-4 text-white font-medium pl-1 leading-relaxed text-xs flex items-start gap-1.5">
                      <Check size={14} className="text-logic-lcd-green shrink-0 mt-0.5" />
                      <span>{row.vsStage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            </div>
          </RevealBlock>
        </div>
      </section>

      {/* Como Funciona em 3 Passos */}
      <section id="como-funciona" className="relative z-10 py-24 sm:py-32">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock direction="up">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
                Do ensaio ao palco em 3 passos simples
              </h2>
              <p className="text-logic-text-dim text-sm mt-3">
                Fluxo prático sem complicação técnica.
              </p>
            </div>
          </RevealBlock>

          <div className="grid md:grid-cols-3 gap-6">
            <RevealBlock direction="up" delay={50}>
              <div className="p-7 rounded-2xl bg-[#121318] border border-white/10 hover:border-logic-lcd-green/40 transition group h-full">
                <div className="w-12 h-12 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  1
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Arraste seus Multitracks</h3>
                <p className="text-xs sm:text-sm text-logic-text-dim leading-relaxed">
                  Importe os arquivos da música: o VS Stage reconhece os nomes dos clipes de áudio, roteia os instrumentos para os canais corretos, detecta o BPM com IA e prepara o Afinador (Tuner) e o Timecode LTC.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock direction="up" delay={150}>
              <div className="p-7 rounded-2xl bg-[#121318] border border-white/10 hover:border-logic-lcd-amber/40 transition group h-full">
                <div className="w-12 h-12 rounded-xl bg-logic-lcd-amber/15 text-logic-lcd-amber font-black text-xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  2
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Conecte a Banda & Palco</h3>
                <p className="text-xs sm:text-sm text-logic-text-dim leading-relaxed">
                  Abra a rede local no app: os músicos escaneiam o QR code no celular para ver as cifras, e a TV do palco conecta no teleprompter de letras ao vivo.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock direction="up" delay={250}>
              <div className="p-7 rounded-2xl bg-[#121318] border border-white/10 hover:border-logic-lcd-green/40 transition group h-full">
                <div className="w-12 h-12 rounded-xl bg-logic-lcd-green/15 text-logic-lcd-green font-black text-xl flex items-center justify-center mb-6 group-hover:scale-110 transition">
                  3
                </div>
                <h3 className="text-lg font-bold text-white mb-2">Dê o Play no Modo Show</h3>
                <p className="text-xs sm:text-sm text-logic-text-dim leading-relaxed">
                  Ative o Modo Show: a barra de espaço é travada contra acidentes, o relógio gigante assume o controle e você comanda o show com tranquilidade absoluta.
                </p>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* FAQ Retrátil */}
      <section id="faq" className="relative z-10 py-20 border-t border-white/[0.08] bg-[#0c0d12]/90 backdrop-blur-xl">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <RevealBlock direction="up">
            <div className="text-center mb-14">
              <span className="text-2xs font-extrabold tracking-widest text-logic-lcd-green uppercase px-3 py-1 rounded-full bg-logic-lcd-green/10 border border-logic-lcd-green/20">
                Dúvidas Frequentes
              </span>
              <h2 className="text-3xl sm:text-4xl font-black text-white tracking-tight mt-3">
                Perguntas e respostas sobre o VS Stage
              </h2>
            </div>
          </RevealBlock>

          <div className="space-y-3.5">
            {FAQS.map((faq, i) => (
              <RevealBlock key={faq.q} direction="up" delay={i * 60}>
                <div className="rounded-xl border border-white/10 bg-[#121318] overflow-hidden transition">
                  <button
                    type="button"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                    className="w-full p-5 text-left font-bold text-sm sm:text-base text-white flex items-center justify-between gap-4 hover:text-logic-lcd-green transition"
                  >
                    <span>{faq.q}</span>
                    <span className={`text-logic-text-muted transition-transform duration-300 ${openFaq === i ? 'rotate-180 text-logic-lcd-green' : ''}`}>
                      ▼
                    </span>
                  </button>
                  {openFaq === i && (
                    <div className="px-5 pb-5 pt-1 text-xs sm:text-sm text-logic-text-dim leading-relaxed border-t border-white/[0.06] animate-[fadeIn_200ms_ease-out]">
                      {faq.a}
                    </div>
                  )}
                </div>
              </RevealBlock>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Final */}
      <section className="relative z-10 py-24 sm:py-32 overflow-hidden text-center">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[700px] h-[350px] bg-gradient-to-t from-logic-lcd-green/15 to-transparent blur-3xl" />
        </div>

        <div className="max-w-4xl mx-auto px-4 sm:px-6 relative">
          <RevealBlock direction="zoom">
            <div className="mx-auto w-20 h-20 mb-6">
              <VsLogo size={80} />
            </div>

            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
              Pronto para levar seu palco para o próximo nível?
            </h2>
            <p className="text-logic-text-dim text-base max-w-xl mx-auto mt-4 leading-relaxed">
              Baixe o VS Stage Pro agora mesmo. Crie sua conta na hora e desfrute de 48 horas de teste grátis com acesso completo e irrestrito.
            </p>
          </RevealBlock>

          <RevealBlock direction="up" delay={120}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-5 mt-10">
            {/* Botão Primário: Assinar Agora */}
            <div className="relative group w-full sm:w-auto">
              <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-logic-lcd-green via-emerald-400 to-teal-300 opacity-60 blur-lg group-hover:opacity-100 group-hover:blur-xl transition duration-500 animate-pulse pointer-events-none" />

              <button
                onClick={subscribe}
                className="relative overflow-hidden w-full sm:w-auto min-w-0 sm:min-w-[340px] max-w-full h-[64px] px-5 sm:px-8 rounded-2xl btn-neon-green text-black flex items-center justify-between gap-3 sm:gap-4 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
              >
                <span className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/55 to-transparent -skew-x-12 animate-btn-sheen pointer-events-none" />

                <div className="flex items-center gap-3.5">
                  <div className="w-11 h-11 rounded-xl bg-black/15 backdrop-blur-sm border border-black/10 flex items-center justify-center text-black shadow-sm group-hover:scale-105 transition-transform shrink-0">
                    <Sparkles size={22} className="text-black" />
                  </div>
                  <div className="text-left flex flex-col justify-center">
                    <span className="text-[15px] sm:text-base font-black tracking-tight text-black leading-tight">
                      ASSINAR AGORA
                    </span>
                    <span className="text-[11px] font-extrabold text-black/80 leading-tight tracking-wide mt-0.5">
                      Comece hoje com acesso total
                    </span>
                  </div>
                </div>

                <div className="w-9 h-9 rounded-xl bg-black/15 flex items-center justify-center group-hover:bg-black/25 group-hover:translate-x-1 transition-all shrink-0">
                  <ArrowRight size={18} className="text-black" />
                </div>
              </button>
            </div>

            {/* Botão Secundário: Baixar para Mac */}
            <a
              href="#baixar"
              className="w-full sm:w-auto min-w-[240px] h-[64px] px-7 rounded-2xl btn-glass-secondary text-white font-bold text-base flex items-center justify-center gap-2.5 transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
            >
              <Apple size={20} className="text-white/80" />
              <span>Baixar (48h Grátis)</span>
            </a>
          </div>
        </RevealBlock>
      </div>
      </section>

      {/* Rodapé do Site */}
      <footer className="relative z-10 border-t border-white/[0.08] bg-[#08090b] py-12 text-xs text-logic-text-muted">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <VsLogo size={28} />
            <div>
              <span className="font-extrabold text-white text-sm">VS STAGE PRO</span>
              <p className="text-2xs text-logic-text-muted mt-0.5">© 2026 VS Stage. Todos os direitos reservados.</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <a href="mailto:suporte.vssategepro@gmail.com" className="hover:text-white transition flex items-center gap-1.5">
              <MessageCircle size={14} /> Suporte Oficial
            </a>
            <a href="#baixar" className="hover:text-white transition">
              Download Mac
            </a>
            <button onClick={subscribe} className="hover:text-white transition">
              Planos & Assinaturas
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
