import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Apple,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Lock,
  Monitor,
  Smartphone,
  Tablet,
  Zap,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';
import { useScrollReveal } from './useScrollReveal';

/* =========================================================================
   MOLDURAS DE DISPOSITIVOS APPLE (MACBOOK, IMAC, IPHONE, IPAD)
   Construídas em CSS e vetores de precisão industrial padrão Apple
   ========================================================================= */

// 1. Moldura do MacBook Pro (Modo Show em Tela Cheia)
function MacBookFrame({ img, alt }: { img: string; alt: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[860px] drop-shadow-[0_35px_60px_rgba(0,0,0,0.9)] group">
      {/* Luz ambiente de tela emitida no fundo */}
      <div className="absolute -inset-4 bg-gradient-to-t from-emerald-500/15 via-[#0071e3]/10 to-transparent blur-3xl opacity-60 group-hover:opacity-90 transition-opacity duration-700 pointer-events-none" />

      {/* Tampa Superior do MacBook */}
      <div className="relative rounded-t-[20px] sm:rounded-t-[24px] bg-[#1d1d1f] p-[7px] sm:p-[10px] pb-0 border-t border-x border-[#3a3a3c] shadow-2xl">
        {/* Entalhe da Câmera (Notch) */}
        <div className="absolute top-[7px] sm:top-[10px] left-1/2 -translate-x-1/2 w-24 sm:w-32 h-3.5 sm:h-4 bg-[#0a0a0c] rounded-b-md z-30 flex items-center justify-center">
          <div className="w-1.5 h-1.5 rounded-full bg-[#1c1c1e] border border-white/10" />
        </div>

        {/* Display Retina com Vidro e Imagem Real */}
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-[13px] sm:rounded-t-[16px] bg-[#000000] border border-black shadow-inner">
          <img src={img} alt={alt} className="w-full h-full object-cover select-none" loading="eager" />
          {/* Reflexo Especular de Vidro Apple */}
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.04] to-transparent pointer-events-none" />
        </div>
      </div>

      {/* Base / Teclado do MacBook Pro com rebaixo de abertura */}
      <div className="relative h-3 sm:h-4.5 bg-[#2d2d30] rounded-b-[10px] sm:rounded-b-[14px] border-t border-[#48484a] border-b-2 border-b-[#1c1c1e] shadow-lg flex items-start justify-center">
        <div className="w-16 sm:w-24 h-1.5 bg-[#1c1c1e] rounded-b-sm" />
      </div>

      {/* Sombra de Contato com o Piso do Palco */}
      <div className="h-6 w-[94%] mx-auto bg-black/80 blur-lg -mt-1 rounded-full pointer-events-none" />
    </div>
  );
}

// 2. Moldura do iMac 24" (Timeline Completa das Multitracks)
function IMacFrame({ img, alt }: { img: string; alt: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[920px] drop-shadow-[0_40px_70px_rgba(0,0,0,0.95)] group">
      {/* Display do iMac com borda fina de alumínio escuro */}
      <div className="relative rounded-[22px] bg-[#1c1d22] p-[9px] sm:p-[12px] pb-[40px] sm:pb-[56px] border border-white/15 shadow-2xl">
        {/* Câmera Central no Topo */}
        <div className="absolute top-2 sm:top-2.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-[#0d0e12] border border-white/20" />

        {/* Tela Retina do iMac */}
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[13px] bg-black border border-black shadow-inner">
          <img src={img} alt={alt} className="w-full h-full object-cover select-none" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.03] to-transparent pointer-events-none" />
        </div>

        {/* Queixo de Alumínio Inferior com Logo */}
        <div className="absolute bottom-2.5 sm:bottom-3.5 left-0 right-0 flex items-center justify-center opacity-40">
          <VsLogo size={20} />
        </div>
      </div>

      {/* Suporte Metálico / Pedestal do iMac */}
      <div className="mx-auto w-24 sm:w-32 h-14 sm:h-20 bg-gradient-to-b from-[#2a2c35] to-[#1a1b22] border-x border-[#3c3e4a] -mt-1" />
      <div className="mx-auto w-40 sm:w-56 h-2.5 bg-gradient-to-b from-[#3a3c48] to-[#1e2028] rounded-t-sm rounded-b-md shadow-2xl border-t border-white/20" />
      <div className="h-4 w-48 sm:w-64 mx-auto bg-black/90 blur-md rounded-full pointer-events-none" />
    </div>
  );
}

// 3. Moldura do iPhone 16 Pro (Área do Músico com Cifras ao Vivo)
function IPhoneFrame({ img, alt }: { img: string; alt: string }) {
  return (
    <div className="relative mx-auto w-[240px] sm:w-[280px] drop-shadow-[0_30px_50px_rgba(0,0,0,0.85)] group">
      {/* Chassi de Titânio do iPhone */}
      <div className="relative rounded-[44px] sm:rounded-[50px] bg-[#1f2026] p-[9px] sm:p-[11px] border-[2.5px] border-[#3f424e] shadow-2xl">
        {/* Antena bands sutis */}
        <div className="absolute top-20 -left-[3px] w-[3px] h-6 bg-[#2d2f38]" />
        <div className="absolute top-32 -left-[3px] w-[3px] h-10 bg-[#2d2f38]" />
        <div className="absolute top-24 -right-[3px] w-[3px] h-12 bg-[#2d2f38]" />

        {/* Tela Super Retina com Dynamic Island */}
        <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[36px] sm:rounded-[40px] bg-black">
          {/* Dynamic Island */}
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-20 sm:w-24 h-5 sm:h-6 bg-black rounded-full z-30 flex items-center justify-between px-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[#111] border border-white/10" />
            <div className="w-2 h-2 rounded-full bg-[#0a84ff] opacity-80" />
          </div>

          <img src={img} alt={alt} className="w-full h-full object-cover select-none" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.04] to-transparent pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

// 4. Moldura do iPad Pro (Teleprompter de Palco para TV/Tela)
function IPadFrame({ img, alt }: { img: string; alt: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[560px] drop-shadow-[0_35px_60px_rgba(0,0,0,0.9)] group">
      {/* Moldura Uniforme de Alumínio do iPad Pro */}
      <div className="relative rounded-[28px] sm:rounded-[34px] bg-[#1a1b22] p-[10px] sm:p-[14px] border border-[#383a45] shadow-2xl">
        {/* Câmera Frontal Discreta na Borda */}
        <div className="absolute top-1/2 -left-1.5 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-black border border-white/20 hidden" />
        <div className="absolute top-2.5 sm:top-3.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-black border border-white/20" />

        {/* Display Liquid Retina */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[18px] sm:rounded-[22px] bg-black border border-black">
          <img src={img} alt={alt} className="w-full h-full object-cover select-none" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.04] to-transparent pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   DADOS COMPARATIVOS E PERGUNTAS FREQUENTES (PADRÃO APPLE)
   ========================================================================= */

const COMPARISON = [
  {
    feature: 'Timeline individual por música',
    traditional: 'Um projeto pesado com todas as faixas na mesma régua ou carregar outro arquivo demorando minutos',
    vsStage: 'Cada música tem sua timeline exclusiva; transição em 0 segundos no show',
  },
  {
    feature: 'Importação e Roteamento',
    traditional: 'Arrastar track por track, nomear canal por canal e rotear na mão em cada música',
    vsStage: 'Arraste a pasta: a Inteligência Artificial reconhece os instrumentos e roteia pros faders certos',
  },
  {
    feature: 'Estabilidade no Palco',
    traditional: 'DAWs pesadas de estúdio com alto consumo de CPU e risco real de travamento ao vivo',
    vsStage: 'Motor nativo ultraleve focado em reprodução ao vivo sem falhas',
  },
  {
    feature: 'Controle de Tom e BPM',
    traditional: 'Plugins pesados de pitch shift que deformam o timbre e desalinham o click',
    vsStage: 'Afinador (Tuner) e andamento integrados que mudam o tom mantendo a velocidade',
  },
  {
    feature: 'Sincronismo com Iluminação (LTC)',
    traditional: 'Configurar plugins complexos de gerador SMPTE com risco de vazar sinal no som principal',
    vsStage: 'Canal Timecode LTC integrado com volume protegido a -6dB e saída isolada',
  },
  {
    feature: 'Letras e Cifras para a Banda',
    traditional: 'Papéis impressos, pastas avulsas ou aplicativos desconectados da música',
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
    a: 'O VS Stage Pro foi desenvolvido com máxima otimização para macOS (Apple Silicon M1/M2/M3/M4 e processadores Intel), garantindo latência quase zero e estabilidade ininterrupta em shows. A Área do Músico e o Teleprompter funcionam em qualquer celular, tablet ou TV com navegador via rede Wi-Fi local.',
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
    a: 'O canal TIMECODE (LTC) já vem configurado de fábrica na timeline e no mixer. Ele gera o sinal padrão SMPTE Linear Timecode pronto para sincronizar mesas de iluminação (GrandMA, Avolites, Chamsys, Daslight) e painéis de LED, com o volume protegido a -6dB e saída isolada para não vazar no som principal.',
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
          : 'opacity-100 sm:opacity-0 sm:translate-y-8 sm:scale-[0.99]'
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

      {/* =====================================================================
          1. APPLE STICKY LOCAL SUB-NAVIGATION
          ===================================================================== */}
      <header className="sticky top-0 z-50 bg-[#000000]/80 backdrop-blur-xl border-b border-white/[0.12] transition-colors">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2.5 text-white font-bold text-sm tracking-tight hover:opacity-85 transition-opacity">
            <VsLogo size={24} />
            <span className="text-white font-semibold">VS Stage Pro</span>
          </a>

          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-5 text-xs text-[#86868b] font-medium">
              <a href="#visao-geral" className="hover:text-white transition-colors">Visão Geral</a>
              <a href="#macbook" className="hover:text-white transition-colors">Modo Show</a>
              <a href="#imac" className="hover:text-white transition-colors">Timeline</a>
              <a href="#dispositivos" className="hover:text-white transition-colors">iPhone & iPad</a>
              <a href="#diferenciais" className="hover:text-white transition-colors">Por Que o VS Stage?</a>
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

      {/* =====================================================================
          2. HERO SECTION — ESTILO APPLE LOGIC PRO
          ===================================================================== */}
      <section id="visao-geral" className="relative pt-16 sm:pt-24 pb-20 sm:pb-32 overflow-hidden text-center">
        {/* Glow de palco atmosférico suave */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[450px] bg-gradient-to-b from-[#ff9f0a]/12 via-[#0a84ff]/6 to-transparent blur-[140px] pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          {/* Logo Oficial Centralizado */}
          <div className="mx-auto w-24 h-24 mb-6 transition-transform hover:scale-105 duration-300 drop-shadow-[0_16px_32px_rgba(255,159,10,0.3)]">
            <VsLogo size={96} />
          </div>

          <h2 className="text-xs sm:text-sm font-bold text-[#ff9f0a] tracking-widest uppercase mb-3">
            VS Stage Pro
          </h2>

          <h1 className="text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.05] max-w-4xl mx-auto">
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
              className="h-12 px-8 rounded-full bg-[#0071e3] hover:bg-[#0077ed] text-white text-base font-semibold tracking-tight transition-all active:scale-95 shadow-xl shadow-[#0071e3]/30 flex items-center justify-center gap-2"
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

          {/* ===================================================================
              COMPOSIÇÃO HERO DOS DISPOSITIVOS APPLE
              O MacBook Pro no centro rodando o Modo Show!
              =================================================================== */}
          <div className="mt-16 sm:mt-24">
            <MacBookFrame img="/shots/modo_show.jpg" alt="VS Stage Pro no Modo Show rodando em um MacBook Pro" />
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. MENU MODULAR DE NAVEGAÇÃO ("CONHEÇA O VS STAGE PRO")
          ===================================================================== */}
      <section className="border-y border-white/[0.1] bg-[#0c0d12]/90 backdrop-blur-xl py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8">
            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Conheça o VS Stage Pro.
            </h2>
            <p className="text-sm text-[#86868b] mt-1.5">
              Explore os quatro dispositivos sincronizados e as ferramentas de palco.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
            {[
              { id: '#macbook', icon: LaptopIcon, title: 'MacBook Pro', subtitle: 'Modo Show no Palco' },
              { id: '#imac', icon: Monitor, title: 'iMac', subtitle: 'Timeline & Arranjo' },
              { id: '#dispositivos', icon: Smartphone, title: 'iPhone', subtitle: 'Área do Músico (Cifras)' },
              { id: '#dispositivos', icon: Tablet, title: 'iPad Pro', subtitle: 'Teleprompter na TV' },
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

      {/* =====================================================================
          4. DISPOSITIVO 1: MACBOOK PRO NO MODO SHOW
          ===================================================================== */}
      <section id="macbook" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-xs font-bold text-[#ff9f0a] uppercase tracking-widest">
                No MacBook Pro • Modo Show
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                O comando absoluto na frente dos seus olhos.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Ao ativar o Modo Show no seu MacBook, a interface se transforma: o relógio gigante assume o controle, os faders são travados com cadeado contra acidentes e você transita de música sem engasgos.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <MacBookFrame img="/shots/modo_show.jpg" alt="Modo Show do VS Stage Pro em tela cheia no MacBook Pro" />
          </RevealBlock>

          <div className="grid sm:grid-cols-3 gap-6 mt-16">
            <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
              <div className="text-[#ff9f0a] font-bold text-lg mb-2 flex items-center gap-2">
                <Lock size={18} /> Trava de Segurança
              </div>
              <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                A barra de espaço é protegida contra toques involuntários e cada fader tem cadeado individual.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
              <div className="text-emerald-400 font-bold text-lg mb-2 flex items-center gap-2">
                <Clock size={18} /> Relógio & Restante
              </div>
              <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                Display LCD de alta visibilidade mostrando o tempo decorrido e a contagem regressiva da música.
              </p>
            </div>
            <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
              <div className="text-[#0a84ff] font-bold text-lg mb-2 flex items-center gap-2">
                <Zap size={18} /> Transição 0 Segundos
              </div>
              <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                Pule para qualquer música do show com dois cliques, sem esperar arquivos carregarem.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          5. DISPOSITIVO 2: IMAC COM A TIMELINE COMPLETA
          ===================================================================== */}
      <section id="imac" className="py-24 sm:py-32 bg-[#0c0d12]/90 border-y border-white/[0.1] relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-xs font-bold text-[#0a84ff] uppercase tracking-widest">
                No iMac • A Timeline Pro
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Uma timeline exclusiva por música.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                A tela ampla do iMac dá visibilidade cirúrgica para cada compasso, fatiamento de medleys e ondas de áudio de alta definição.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <IMacFrame img="/shots/timeline.jpg" alt="Timeline do VS Stage Pro em tela de iMac" />
          </RevealBlock>

          <div className="grid md:grid-cols-2 gap-6 mt-16">
            <div className="p-8 rounded-3xl bg-[#161618] border border-white/10">
              <h3 className="text-xl font-bold text-white mb-3">Arranjo de Medleys Não-Destrutivo</h3>
              <p className="text-sm text-[#86868b] leading-relaxed">
                Fatie pot-pourris e medleys diretamente no cursor com atalhos de estúdio (S / Split). Una duas músicas com transição perfeita e controle o andamento compasso a compasso.
              </p>
            </div>
            <div className="p-8 rounded-3xl bg-[#161618] border border-white/10">
              <h3 className="text-xl font-bold text-white mb-3">Detecção de BPM com IA & Tuner Integrado</h3>
              <p className="text-sm text-[#86868b] leading-relaxed">
                A Inteligência Artificial analisa as multitracks e calcula o BPM instantaneamente. Altere o tom da música (+/- semitons) para o vocalista sem perder o alinhamento da velocidade.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          6. DISPOSITIVOS 3 & 4: IPHONE (MÚSICO) E IPAD (TELEPROMPTER)
          ===================================================================== */}
      <section id="dispositivos" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-20">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest">
                No iPhone & iPad • Ecossistema Sem Fio
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                A banda inteira no mesmo compasso.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                O VS Stage Pro conecta todos os integrantes no palco em tempo real via rede Wi-Fi local, sem precisar de internet.
              </p>
            </div>
          </RevealBlock>

          {/* Grid Lado a Lado: iPhone e iPad */}
          <div className="grid lg:grid-cols-12 gap-12 sm:gap-16 items-center">
            {/* iPhone - Área do Músico */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <RevealBlock delay={80}>
                <div className="mb-6 text-center">
                  <span className="text-[11px] font-bold text-[#ff9f0a] px-3 py-1 rounded-full bg-[#ff9f0a]/10 border border-[#ff9f0a]/20 uppercase tracking-wider">
                    No iPhone • Cifras em Tempo Real
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-3">Área do Músico</h3>
                  <p className="text-xs sm:text-sm text-[#86868b] mt-2 max-w-xs mx-auto">
                    O músico escaneia o QR Code e acompanha a cifra rolando automaticamente compasso a compasso.
                  </p>
                </div>
                <IPhoneFrame img="/shots/area_do_musico.jpg" alt="Área do músico no iPhone com cifras" />
              </RevealBlock>
            </div>

            {/* iPad Pro - Teleprompter para TV e Telão */}
            <div className="lg:col-span-7 flex flex-col items-center">
              <RevealBlock delay={160}>
                <div className="mb-6 text-center">
                  <span className="text-[11px] font-bold text-emerald-400 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 uppercase tracking-wider">
                    No iPad Pro • TV & Telão do Palco
                  </span>
                  <h3 className="text-2xl font-bold text-white mt-3">Teleprompter de Palco</h3>
                  <p className="text-xs sm:text-sm text-[#86868b] mt-2 max-w-sm mx-auto">
                    Letras gigantes sincronizadas, avisos ao vivo do diretor musical e contagem regressiva para os cantores.
                  </p>
                </div>
                <IPadFrame img="/shots/teleprompt.jpg" alt="Teleprompter do VS Stage Pro em tela de iPad Pro" />
              </RevealBlock>
            </div>
          </div>
        </div>
      </section>

      {/* =====================================================================
          7. TABELA COMPARATIVA ESTILO APPLE
          ===================================================================== */}
      <section id="diferenciais" className="py-24 sm:py-32 border-t border-white/[0.1] bg-[#0c0d12]/90 relative">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
                Por que o VS Stage Pro no lugar de uma DAW comum?
              </h2>
              <p className="text-base text-[#86868b] mt-4">
                Programas como Logic Pro, Ableton e Reaper foram feitos para estúdio. O VS Stage Pro foi feito para a pressão do palco.
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

      {/* =====================================================================
          8. FAQ RETRÁTIL ESTILO APPLE
          ===================================================================== */}
      <section id="faq" className="py-24 sm:py-32 border-t border-white/[0.1] relative">
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

      {/* =====================================================================
          9. CTA FINAL — ESTILO APPLE LOGIC PRO
          ===================================================================== */}
      <section className="py-28 sm:py-36 relative text-center border-t border-white/[0.1] overflow-hidden">
        <div className="absolute inset-0 bg-radial from-[#0071e3]/12 via-transparent to-transparent pointer-events-none" />

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

      {/* =====================================================================
          10. APPLE DIRECTORY FOOTER
          ===================================================================== */}
      <footer className="border-t border-white/[0.1] bg-[#000000] py-14 text-xs text-[#86868b]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-6 pb-8 border-b border-white/[0.08]">
            <div className="flex items-center gap-3 text-white font-bold text-sm">
              <VsLogo size={24} />
              <span>VS Stage Pro — Live Performance Engine</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-[#86868b]">
              <a href="#visao-geral" className="hover:text-white transition-colors">Visão Geral</a>
              <a href="#macbook" className="hover:text-white transition-colors">Modo Show</a>
              <a href="#imac" className="hover:text-white transition-colors">Timeline</a>
              <a href="#dispositivos" className="hover:text-white transition-colors">iPhone & iPad</a>
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

function LaptopIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <line x1="2" y1="20" x2="22" y2="20" />
    </svg>
  );
}
