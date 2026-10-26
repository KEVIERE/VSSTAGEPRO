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
  Mic2,
  Monitor,
  Smartphone,
  Sparkles,
  Tablet,
  Wand2,
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
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-t-[13px] sm:rounded-t-[16px] bg-[#0e0e0e] border border-black shadow-inner">
          <img src={img} alt={alt} className="w-full h-full object-contain select-none" loading="eager" />
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
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-[13px] bg-[#0e0e0e] border border-black shadow-inner">
          <img src={img} alt={alt} className="w-full h-full object-contain select-none" loading="lazy" />
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
        <div className="absolute top-20 -left-[3px] w-[3px] h-6 bg-[#2d2f38]" />
        <div className="absolute top-32 -left-[3px] w-[3px] h-10 bg-[#2d2f38]" />
        <div className="absolute top-24 -right-[3px] w-[3px] h-12 bg-[#2d2f38]" />

        {/* Tela Super Retina com Dynamic Island */}
        <div className="relative aspect-[9/19.5] w-full overflow-hidden rounded-[36px] sm:rounded-[40px] bg-black">
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
        <div className="absolute top-2.5 sm:top-3.5 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-black border border-white/20" />

        {/* Display Liquid Retina */}
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[18px] sm:rounded-[22px] bg-[#0e0e0e] border border-black">
          <img src={img} alt={alt} className="w-full h-full object-contain select-none" loading="lazy" />
          <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/[0.04] to-transparent pointer-events-none" />
        </div>
      </div>
    </div>
  );
}

/* =========================================================================
   COMPOSIÇÃO HERO DOS DISPOSITIVOS APPLE (TODOS JUNTOS NA FRENTE)
   ========================================================================= */
function HeroAppleEcosystemStage() {
  const [activeTab, setActiveTab] = useState<'all' | 'macbook' | 'imac' | 'iphone' | 'ipad'>('all');

  return (
    <div className="relative w-full max-w-6xl mx-auto mt-12 sm:mt-16">
      {/* Seletor de visualização estilo Apple Pill */}
      <div className="flex items-center justify-center gap-1.5 sm:gap-2 mb-8 sm:mb-12 overflow-x-auto p-1.5 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-xl max-w-fit mx-auto">
        {[
          { key: 'all', label: 'Todos os Dispositivos' },
          { key: 'macbook', label: 'Computador • Modo Show' },
          { key: 'imac', label: 'Estúdio • Timeline' },
          { key: 'iphone', label: 'Celular • Cifras' },
          { key: 'ipad', label: 'TV do Palco • Teleprompter' },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-3.5 sm:px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-white text-black shadow-md'
                : 'text-[#86868b] hover:text-white hover:bg-white/[0.04]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* COMPOSIÇÃO DOS 4 DISPOSITIVOS JUNTOS NO PALCO */}
      {activeTab === 'all' && (
        <div className="relative w-full min-h-[460px] sm:min-h-[580px] lg:min-h-[660px] flex items-end justify-center pb-6 sm:pb-12 animate-[fadeIn_600ms_ease-out]">
          {/* Fundo Atmosférico de Cores Apple (Preto, Laranja, Vermelho, Roxo, Azul) */}
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[92%] max-w-[850px] h-[380px] sm:h-[480px] rounded-full bg-gradient-to-r from-orange-500/20 via-purple-600/25 to-blue-500/25 blur-[120px] pointer-events-none animate-pulse"
            style={{ animationDuration: '6s' }}
          />

          {/* 1. IMAC (Em segundo plano, centralizado, mostrando a Timeline) */}
          <div className="relative z-10 w-[84%] sm:w-[72%] lg:w-[65%] -mb-4 sm:-mb-6 opacity-90 transition-transform duration-500 hover:scale-[1.01]">
            <IMacFrame img="/shots/device-imac.png" alt="Timeline completa do VS Stage Pro no estúdio" />
          </div>

          {/* 2. MACBOOK PRO 16" (Em primeiro plano central, aberto no Modo Show) */}
          <div className="absolute z-20 bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 w-[74%] sm:w-[60%] lg:w-[52%] transition-transform duration-500 hover:scale-[1.02]">
            <MacBookFrame img="/shots/device-macbook.png" alt="Modo Show no computador" />
          </div>

          {/* 3. IPAD PRO (Flanqueando o lado esquerdo com o Teleprompter, em destaque acima da base) */}
          <div className="absolute z-25 bottom-14 sm:bottom-20 lg:bottom-24 left-[-4%] sm:left-0 lg:left-0 w-[40%] sm:w-[32%] lg:w-[28%] block transition-transform duration-500 hover:scale-105 hover:-translate-y-1">
            <IPadFrame img="/shots/device-ipad.png" alt="Teleprompter na TV do palco" />
          </div>

          {/* 4. IPHONE 16 PRO (Flanqueando o lado direito com a Área do Músico) */}
          <div className="absolute z-30 bottom-2 sm:bottom-6 right-2 sm:right-6 lg:right-14 w-[18%] sm:w-[15%] lg:w-[13%] transition-transform duration-500 hover:scale-105">
            <IPhoneFrame img="/shots/device-iphone.png" alt="Área do Músico no celular" />
          </div>
        </div>
      )}

      {/* Visualização focada por dispositivo */}
      {activeTab === 'macbook' && (
        <div className="animate-[fadeIn_400ms_ease-out]">
          <MacBookFrame img="/shots/device-macbook.png" alt="Modo Show no computador" />
          <div className="text-center mt-6 text-sm text-[#86868b]">
            <strong className="text-white">Seu computador</strong> rodando o <span className="text-[#ff9f0a]">Modo Show</span> em tela cheia com trava de segurança e contagem regressiva.
          </div>
        </div>
      )}

      {activeTab === 'imac' && (
        <div className="animate-[fadeIn_400ms_ease-out]">
          <IMacFrame img="/shots/device-imac.png" alt="Timeline no estúdio" />
          <div className="text-center mt-6 text-sm text-[#86868b]">
            <strong className="text-white">A tela do seu estúdio</strong> exibindo a <span className="text-[#0a84ff]">Timeline Pro</span> com arranjo de medleys, detecção de BPM e formas de onda em alta resolução.
          </div>
        </div>
      )}

      {activeTab === 'iphone' && (
        <div className="animate-[fadeIn_400ms_ease-out]">
          <IPhoneFrame img="/shots/device-iphone.png" alt="Área do Músico no celular" />
          <div className="text-center mt-6 text-sm text-[#86868b]">
            <strong className="text-white">O celular de cada músico</strong> com a <span className="text-emerald-400">Área do Músico</span> transmitindo cifras sincronizadas via rede Wi-Fi local sem internet.
          </div>
        </div>
      )}

      {activeTab === 'ipad' && (
        <div className="animate-[fadeIn_400ms_ease-out]">
          <IPadFrame img="/shots/device-ipad.png" alt="Teleprompter na TV do palco" />
          <div className="text-center mt-6 text-sm text-[#86868b]">
            <strong className="text-white">A TV do palco</strong> exibindo o <span className="text-[#a855f7]">Teleprompter de Palco</span> com letras em tempo real e avisos ao vivo para os cantores.
          </div>
        </div>
      )}
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
  {
    q: 'Como funciona a criação de VS com Inteligência Artificial?',
    a: 'Você sobe um único arquivo de áudio (a música mixada, em MP3 ou WAV) e a IA faz o resto: separa as stems de Bateria, Contrabaixo, Guitarras, Teclados, Voz/Guia e Outros, detecta o BPM exato, gera a faixa de Click e organiza tudo numa timeline própria, já roteada nos faders certos. Em cerca de 2 minutos o VS sai pronto pra entrar na playlist do show — sem precisar caçar multitracks ou editar faixa por faixa.',
  },
  {
    q: 'A separação por IA tem qualidade boa o bastante pra tocar no show?',
    a: 'Sim. A separação roda sobre o mesmo motor usado por ferramentas profissionais de estúdio (Demucs v4 / HTDemucs da Meta AI), com um padrão fixo de processamento aplicado igual em toda música que você sobe — não é uma IA genérica improvisando: é o mesmo pipeline testado, sempre entregando as mesmas 6 stems organizadas do mesmo jeito. Para a esmagadora maioria das músicas o resultado já sai pronto pra tocar ao vivo; em trechos pontuais mais complexos (muitos instrumentos tocando juntos na mesma frequência, por exemplo), pode valer a pena um ajuste fino antes do show — e qualquer faixa pode ser re-roteada manualmente a qualquer momento, puxando na hora que quiser.',
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
  // once: false => o bloco também anima ao sair/voltar à tela quando o usuário
  // rola para cima, não só na primeira vez que aparece descendo a página.
  const { ref, revealed } = useScrollReveal({ once: false });

  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-[1100ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
    <div className="min-h-screen bg-[#000000] text-[#f5f5f7] font-apple selection:bg-[#0071e3] selection:text-white overflow-x-hidden antialiased">

      {/* =====================================================================
          1. APPLE STICKY LOCAL SUB-NAVIGATION
          ===================================================================== */}
      <header className="sticky top-0 z-50 bg-[#000000]/80 backdrop-blur-xl border-b border-white/[0.12] transition-colors">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-12 flex items-center">
          {/* Zona esquerda: logo. flex-1 espelha a zona direita para que a nav
              central fique exatamente no meio da barra, não "colada" nos botões. */}
          <div className="flex-1 flex items-center">
            <a href="#" className="flex items-center gap-2.5 text-white font-bold text-sm tracking-tight hover:opacity-85 transition-opacity">
              <VsLogo size={24} />
              <span className="text-white font-semibold">VS Stage Pro</span>
            </a>
          </div>

          {/* Zona central: links de seção, verdadeiramente centralizados na barra
              (padrão apple.com/logic-pro), e não agrupados junto ao CTA. */}
          <nav className="hidden md:flex items-center gap-5 text-xs text-[#86868b] font-medium shrink-0">
            <a href="#visao-geral" className="hover:text-white transition-colors">Visão Geral</a>
            <a href="#dispositivos-show" className="hover:text-white transition-colors">Dispositivos de Palco</a>
            <a href="#fluxos" className="hover:text-white transition-colors">Fluxos</a>
            <a href="#inteligencia" className="hover:text-white transition-colors">Inteligência</a>
            <a href="#diferenciais" className="hover:text-white transition-colors">Por Que o VS Stage?</a>
            <a href="#faq" className="hover:text-white transition-colors">Dúvidas</a>
          </nav>

          {/* Zona direita: CTA, sempre encostado na borda direita. */}
          <div className="flex-1 flex items-center justify-end gap-2.5">
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
      </header>

      {/* =====================================================================
          2. HERO SECTION — ESTILO APPLE LOGIC PRO
          ===================================================================== */}
      <section id="visao-geral" className="relative pt-16 sm:pt-24 pb-20 sm:pb-32 overflow-hidden text-center">
        {/* Glow de palco atmosférico suave estilo Apple (Cores se misturando) */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[950px] h-[480px] bg-gradient-to-b from-[#ff9f0a]/14 via-purple-600/10 to-transparent blur-[140px] pointer-events-none" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 relative z-10">
          {/* Logo Oficial Centralizado */}
          <div
            className="sales-rise mx-auto w-24 h-24 mb-6 transition-transform hover:scale-105 duration-300 drop-shadow-[0_16px_32px_rgba(255,159,10,0.3)]"
            style={{ animationDelay: '0ms' }}
          >
            <VsLogo size={96} />
          </div>

          <div
            className="sales-rise inline-flex max-w-full items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] border border-white/10 mb-6"
            style={{ animationDelay: '80ms' }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#ff9f0a] animate-pulse shrink-0" />
            <span className="text-[10px] sm:text-xs font-semibold tracking-wide text-[#ff9f0a] uppercase text-center leading-normal">
              O Primeiro Motor de Áudio Construído Exclusivamente para Palco
            </span>
          </div>

          <h1
            className="sales-rise text-4xl sm:text-6xl md:text-7xl font-extrabold text-white tracking-tight leading-[1.05] max-w-4xl mx-auto"
            style={{ animationDelay: '160ms' }}
          >
            Uma timeline por música. <br className="hidden sm:inline" />
            Todo o show na sua mão.
          </h1>

          <p
            className="sales-rise mt-6 text-lg sm:text-xl text-[#86868b] max-w-3xl mx-auto font-normal leading-relaxed"
            style={{ animationDelay: '240ms' }}
          >
            Esqueça DAWs de estúdio que travam. Suba uma faixa pronta: a <strong className="text-white">Inteligência Artificial</strong> separa os stems, acerta o BPM e devolve um <strong className="text-white">VS Stage Pro</strong> completo — com timeline por música, controle de tom, mixer com Timecode LTC, cifras no celular da banda e teleprompter na TV do palco.
          </p>

          {/* Links e Botões de Chamada Estilo Apple */}
          <div
            className="sales-rise flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mt-9"
            style={{ animationDelay: '320ms' }}
          >
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
          <div
            className="sales-rise flex items-center justify-center gap-2 mt-8 text-xs text-[#86868b]"
            style={{ animationDelay: '400ms' }}
          >
            <Apple size={14} className="text-white/80" />
            <span>Otimizado para macOS Sonoma, Sequoia e Apple Silicon (M1/M2/M3/M4)</span>
          </div>

          {/* ===================================================================
              FRONT HERO: OS 4 DISPOSITIVOS JUNTOS NO PALCO (IMAC, MACBOOK, IPHONE, IPAD)
              =================================================================== */}
          <div id="dispositivos-show" className="sales-rise" style={{ animationDelay: '480ms' }}>
            <HeroAppleEcosystemStage />
          </div>
        </div>
      </section>

      {/* =====================================================================
          3. MENU MODULAR DE NAVEGAÇÃO ("CONHEÇA O VS STAGE PRO")
          ===================================================================== */}
      <section className="border-y border-white/[0.1] bg-[#0c0d12]/90 backdrop-blur-xl py-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center mb-8">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Conheça o VS Stage Pro.
              </h2>
              <p className="text-sm text-[#86868b] mt-1.5">
                Explore os quatro dispositivos sincronizados e as ferramentas de palco.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {[
                { id: '#macbook-detalhe', icon: LaptopIcon, title: 'Computador', subtitle: 'Modo Show no Palco' },
                { id: '#imac-detalhe', icon: Monitor, title: 'Estúdio', subtitle: 'Timeline & Arranjo' },
                { id: '#dispositivos-show', icon: Smartphone, title: 'Celular', subtitle: 'Área do Músico (Cifras)' },
                { id: '#dispositivos-show', icon: Tablet, title: 'TV do Palco', subtitle: 'Teleprompter na TV' },
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
          </RevealBlock>
        </div>
      </section>

      {/* =====================================================================
          4. SEÇÃO: MACBOOK PRO NO MODO SHOW
          ===================================================================== */}
      <section id="macbook-detalhe" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-xs font-semibold text-[#ff9f0a] uppercase tracking-tight">
                No Computador • Modo Show
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                O comando absoluto na frente dos seus olhos.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Ao ativar o Modo Show no seu computador, a interface se transforma: o relógio gigante assume o controle, os faders são travados com cadeado contra acidentes e você transita de música sem engasgos.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <MacBookFrame img="/shots/device-macbook.png" alt="Modo Show do VS Stage Pro em tela cheia no computador" />
          </RevealBlock>

          <div className="grid sm:grid-cols-3 gap-6 mt-16">
            <RevealBlock delay={160}>
              <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
                <div className="text-[#ff9f0a] font-bold text-lg mb-2 flex items-center gap-2">
                  <Lock size={18} /> Trava de Segurança
                </div>
                <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                  A barra de espaço é protegida contra toques involuntários e cada fader tem cadeado individual.
                </p>
              </div>
            </RevealBlock>
            <RevealBlock delay={220}>
              <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
                <div className="text-emerald-400 font-bold text-lg mb-2 flex items-center gap-2">
                  <Clock size={18} /> Relógio & Restante
                </div>
                <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                  Display LCD de alta visibilidade mostrando o tempo decorrido e a contagem regressiva da música.
                </p>
              </div>
            </RevealBlock>
            <RevealBlock delay={280}>
              <div className="p-6 rounded-2xl bg-[#161618] border border-white/10">
                <div className="text-[#0a84ff] font-bold text-lg mb-2 flex items-center gap-2">
                  <Zap size={18} /> Transição 0 Segundos
                </div>
                <p className="text-xs sm:text-sm text-[#86868b] leading-relaxed">
                  Pule para qualquer música do show com dois cliques, sem esperar arquivos carregarem.
                </p>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* =====================================================================
          5. SEÇÃO: IMAC COM A TIMELINE COMPLETA
          ===================================================================== */}
      <section id="imac-detalhe" className="py-24 sm:py-32 bg-[#0c0d12]/90 border-y border-white/[0.1] relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="text-center max-w-3xl mx-auto mb-16">
              <span className="text-xs font-semibold text-[#0a84ff] uppercase tracking-tight">
                No Estúdio • A Timeline Pro
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Uma timeline exclusiva por música.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                A tela ampla do seu estúdio dá visibilidade cirúrgica para cada compasso, fatiamento de medleys e ondas de áudio de alta definição.
              </p>
            </div>
          </RevealBlock>

          <RevealBlock delay={100}>
            <IMacFrame img="/shots/device-imac.png" alt="Timeline do VS Stage Pro na tela do estúdio" />
          </RevealBlock>

          <div className="grid md:grid-cols-2 gap-6 mt-16">
            <RevealBlock delay={160}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10">
                <h3 className="text-xl font-bold text-white mb-3">Arranjo de Medleys Não-Destrutivo</h3>
                <p className="text-sm text-[#86868b] leading-relaxed">
                  Fatie pot-pourris e medleys diretamente no cursor com atalhos de estúdio (S / Split). Una duas músicas com transição perfeita e controle o andamento compasso a compasso.
                </p>
              </div>
            </RevealBlock>
            <RevealBlock delay={220}>
              <div className="p-8 rounded-3xl bg-[#161618] border border-white/10">
                <h3 className="text-xl font-bold text-white mb-3">Detecção de BPM com IA & Tuner Integrado</h3>
                <p className="text-sm text-[#86868b] leading-relaxed">
                  A Inteligência Artificial analisa as multitracks e calcula o BPM instantaneamente. Altere o tom da música (+/- semitons) para o vocalista sem perder o alinhamento da velocidade.
                </p>
              </div>
            </RevealBlock>
          </div>
        </div>
      </section>

      {/* =====================================================================
          6. SEÇÃO: INTELIGÊNCIA ARTIFICIAL
          ===================================================================== */}
      <section id="inteligencia" className="py-24 sm:py-32 relative">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <RevealBlock>
            <div className="max-w-3xl mb-16">
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-tight">
                Inteligência Artificial
              </span>
              <h2 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight mt-2.5">
                Uma sonora mesa de som inteligente.
              </h2>
              <p className="text-base sm:text-lg text-[#86868b] mt-4 leading-relaxed">
                Algoritmos treinados especificamente para engenharia de áudio ao vivo reconhecem instrumentos, detectam andamentos e tratam a voz do maestro.
              </p>
            </div>
          </RevealBlock>

          {/* Destaque: Separação de Stems por IA — de uma música pronta a um VS completo */}
          <RevealBlock delay={60}>
            <div className="relative mb-10 overflow-hidden rounded-3xl border border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.08] via-[#161618] to-[#161618] p-8 sm:p-10">
              <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-emerald-500/20 blur-[100px] pointer-events-none" />
              <div className="relative grid md:grid-cols-[1.1fr_0.9fr] gap-8 items-center">
                <div>
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-400/20 mb-4">
                    <Clock size={13} className="text-emerald-400" />
                    <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wide">
                      Da música pronta ao show em ~2 minutos
                    </span>
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-tight">
                    Suba só a música. A IA separa as stems e já monta o VS pra você.
                  </h3>
                  <p className="text-sm sm:text-base text-[#86868b] mt-4 leading-relaxed">
                    Nada de caçar multitracks ou editar faixa por faixa: envie o áudio mixado de uma música e a Inteligência Artificial separa automaticamente <strong className="text-white">Bateria, Contrabaixo, Guitarras, Violões, Teclados, Voz/Guia e Outros</strong>, detecta o BPM, gera o Click e organiza tudo numa timeline própria — pronta para entrar na playlist do show.
                  </p>
                  <ul className="mt-6 space-y-2.5">
                    {[
                      'Envie um único arquivo de áudio (MP3 ou WAV) da música',
                      'A IA separa os instrumentos e detecta BPM automaticamente',
                      'Seu VS sai pronto, já roteado e com Click — em cerca de 2 minutos',
                    ].map((step, i) => (
                      <li key={step} className="flex items-start gap-3 text-sm text-[#d1d1d6]">
                        <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-bold flex items-center justify-center mt-0.5">
                          {i + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="rounded-2xl bg-black/40 border border-white/10 p-5 sm:p-6">
                  <div className="flex items-center justify-between mb-5">
                    <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wide">Separação em andamento</span>
                    <span className="text-[11px] font-semibold text-emerald-400">~2 min</span>
                  </div>
                  <div className="space-y-3.5">
                    {[
                      { label: 'Voz / Guia', color: 'bg-emerald-400' },
                      { label: 'Click', color: 'bg-[#64d2ff]' },
                      { label: 'Bateria', color: 'bg-rose-400' },
                      { label: 'Contrabaixo', color: 'bg-amber-400' },
                      { label: 'Guitarras / Violões', color: 'bg-[#0a84ff]' },
                      { label: 'Teclados', color: 'bg-[#a855f7]' },
                      { label: 'Outros', color: 'bg-[#8e8e93]' },
                    ].map((stem) => (
                      <div key={stem.label} className="flex items-center gap-3">
                        <span className="w-28 shrink-0 text-xs text-[#d1d1d6]">{stem.label}</span>
                        <span className="flex-1 h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                          <span className={`block h-full ${stem.color} rounded-full sales-glow`} style={{ width: '100%' }} />
                        </span>
                        <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 pt-5 border-t border-white/10 flex items-center gap-2 text-xs text-[#86868b]">
                    <Sparkles size={13} className="text-emerald-400" />
                    <span>VS criado automaticamente, pronto para o show</span>
                  </div>
                </div>
              </div>
            </div>
          </RevealBlock>

          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6">
            <RevealBlock delay={80}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-[#0a84ff]/10 text-[#0a84ff] flex items-center justify-center mb-6">
                  <Wand2 size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Criação de VS com IA</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  Suba só o áudio mixado de uma música e a IA devolve o VS pronto: stems separados, BPM detectado, Click gerado e tudo já roteado nos faders certos — em cerca de 2 minutos.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock delay={100}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6">
                  <Sparkles size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Roteamento por Nome & Stems</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  Basta arrastar a pasta das multitracks: o motor reconhece as palavras nos nomes dos arquivos (Bateria, Baixo, Teclados, Guitarras, Metais, Vozes, Guia e Click) e encaminha cada pista para seu fader correto automaticamente.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock delay={160}>
              <div className="p-7 rounded-3xl bg-[#161618] border border-white/10 hover:border-white/20 transition-all h-full">
                <div className="w-12 h-12 rounded-2xl bg-[#ff9f0a]/10 text-[#ff9f0a] flex items-center justify-center mb-6">
                  <Zap size={22} />
                </div>
                <h3 className="text-xl font-bold text-white">Detecção de BPM & Afinador (Tuner)</h3>
                <p className="text-sm text-[#86868b] mt-3 leading-relaxed">
                  A IA calcula o BPM exato analisando o click ou as faixas rítmicas. Com a Torre de BPM e o Afinador nativo, você ajusta o andamento e transpõe o tom (+/- semitons) para o cantor na hora do show, sem mudar a velocidade.
                </p>
              </div>
            </RevealBlock>

            <RevealBlock delay={220}>
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
              <a href="#macbook-detalhe" className="hover:text-white transition-colors">Modo Show</a>
              <a href="#imac-detalhe" className="hover:text-white transition-colors">Timeline</a>
              <a href="#dispositivos-show" className="hover:text-white transition-colors">Celular & TV</a>
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
