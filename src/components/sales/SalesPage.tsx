import { useEffect, useState } from 'react';
import {
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Download,
  MessageCircle,
  MonitorPlay,
  Music,
  Play,
  Timer,
  Wifi,
} from 'lucide-react';
import VsLogo from '@/components/VsLogo';

interface Shot { img: string; alt: string }

interface HeroSlide { img: string; title: string; alt: string }

const HERO_SLIDES: HeroSlide[] = [
  { img: '/shots/vs_stage.jpg', title: 'VS STAGE', alt: 'Playlist e mixer do VS Stage Pro em ação' },
  { img: '/shots/modo_show.jpg', title: 'MODO SHOW', alt: 'Modo Show com playlist em tela cheia e contador do restante da música' },
  { img: '/shots/area_do_musico.jpg', title: 'ÁREA DO MÚSICO', alt: 'Área do músico no celular com cifras e letras do show' },
  { img: '/shots/teleprompt.jpg', title: 'TELEPROMPT', alt: 'Tela do produtor: teleprompter, avisos e letras na TV ligada ao palco' },
  { img: '/shots/timeline.jpg', title: 'TIMELINE', alt: 'Timeline exclusiva de cada música no VS Stage' },
];

function HeroCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % HERO_SLIDES.length), 3000);
    return () => window.clearInterval(id);
  }, [paused, index]);

  const go = (delta: number) => setIndex((i) => (i + delta + HERO_SLIDES.length) % HERO_SLIDES.length);

  return (
    <div
      className="relative aspect-video rounded-lg border border-logic-border overflow-hidden group"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {HERO_SLIDES.map((slide, i) => (
        <div
          key={slide.img}
          className={`absolute inset-0 transition-opacity duration-700 ${i === index ? 'opacity-100' : 'opacity-0'}`}
          aria-hidden={i !== index}
        >
          <img
            src={slide.img}
            alt={slide.alt}
            className="w-full h-full object-cover"
            loading={i === 0 ? 'eager' : 'lazy'}
          />
          {i === index && (
            <div className="absolute top-0 left-0 p-3 sm:p-4">
              <span
                key={`title-${index}`}
                className="sales-rise inline-block text-base sm:text-[17px] font-bold tracking-wide text-white bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10"
              >
                {slide.title}
              </span>
            </div>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Imagem anterior"
        className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition hover:bg-black/70 hover:scale-105"
      >
        <ChevronLeft size={22} />
      </button>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Próxima imagem"
        className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/50 backdrop-blur-md text-white flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition hover:bg-black/70 hover:scale-105"
      >
        <ChevronRight size={22} />
      </button>

      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {HERO_SLIDES.map((slide, i) => (
          <button
            key={slide.img}
            type="button"
            onClick={() => setIndex(i)}
            aria-label={`Ver ${slide.title}`}
            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-logic-lcd-green' : 'w-1.5 bg-white/40 hover:bg-white/70'}`}
          />
        ))}
      </div>
    </div>
  );
}

/** Fotos reais do programa, enviadas direto do VS Stage instalado. */
const SHOT: Record<string, Shot> = {
  playlist: { img: '/shots/vs-playlist.png', alt: 'Playlist do show com datas de cada música' },
  mixer: { img: '/shots/vs-mixer.png', alt: 'Mixer do VS Stage com todos os canais' },
  timecode: { img: '/shots/vs-timecode.png', alt: 'Canal TIMECODE (LTC) do mixer' },
  master: { img: '/shots/vs-master.png', alt: 'Botão Master mágico com roteamento L/R em emergência' },
  showMode: { img: '/shots/MODO_SHOW_PLAYLIST.png', alt: 'Modo Show: playlist em tela cheia com mixer completo' },
  musician: { img: '/shots/vs-musician.png', alt: 'Área do músico no celular, integrada com a playlist' },
  prompter: { img: '/shots/vs-prompter.png', alt: 'Produtor: teleprompter, avisos, letras e playlist na TV' },
  loops: { img: '/shots/vs-loops.png', alt: 'Regions e loops direto na timeline — REFRÃO, SOLO, FINAL' },
  loopsShow: { img: '/shots/vs-loops-show.png', alt: 'Loops acionados no Modo Show com teclas 1-9/L/P' },
  groups: { img: '/shots/vs-groups.png', alt: 'Multigrupos Sanfonas e Teclados criados e roteados automaticamente' },
};

const FEATURES = [
  { icon: AudioLines, title: 'Multitracks ao vivo', desc: 'Playlist, timeline e mixer prontos para tocar backing tracks no palco com estabilidade de programa profissional.' },
  { icon: MonitorPlay, title: 'Teleprompter na TV', desc: 'Letras, cifras e avisos do produtor na TV ligada ao palco, sincronizadas em tempo real com o show.' },
  { icon: Music, title: 'Área do Músico', desc: 'Cada músico abre no celular as cifras, letras e o que está tocando agora — sem impressão, sem papelada.' },
  { icon: Download, title: 'Exportação rápida', desc: 'Renderize seus multitracks e salve o show em arquivos locais para levar onde quiser.' },
  { icon: Wifi, title: 'Rede local no palco', desc: 'Funciona com roteador local mesmo sem internet: músicos e tela do palco conectados durante o show inteiro.' },
  { icon: Timer, title: 'Desfazer infinito', desc: 'Ctrl+Z e Ctrl+Shift+Z guardam o histórico inteiro da sessão — nada se perde no meio do trabalho.' },
];

const STEPS = [
  { num: '1', title: 'Monte o show', desc: 'Importe os multitracks, ajuste cada canal no mixer e monte a playlist do set — cada música na sua própria timeline.' },
  { num: '2', title: 'Conecte o palco', desc: 'Conecte o teleprompt do artista/banda e os celulares/tablets dos músicos com o diretor musical — com internet ou rede local.' },
  { num: '3', title: 'Aperte o play', desc: 'O show começa em sincronia: os multitracks tocam, o teleprompt acompanha a letra e cada músico recebe a música certa na hora.' },
];

interface DetailShotProps {
  shot: Shot;
  title: string;
  desc: React.ReactNode;
  reverse?: boolean;
  accent?: boolean;
  /** Close estreito (canal, botão): não estica pela coluna inteira. */
  narrow?: boolean;
  /** Print vertical: 30% menor que a coluna. */
  compact?: boolean;
}

/** Mostra o print real; se o arquivo ainda não estiver no site, exibe um painel com o logo. */
function ShotImage({ shot, className }: { shot: Shot; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className={`relative flex flex-col items-center justify-center gap-3 bg-logic-bg-panel border border-logic-border rounded-xl aspect-video ${className ?? ''}`}>
        <VsLogo size={56} />
        <span className="text-xs text-logic-text-muted px-6 text-center">{shot.alt}</span>
      </div>
    );
  }
  return (
    <img
      src={shot.img}
      alt={shot.alt}
      className={className}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

function DetailShot({ shot, title, desc, reverse, accent, narrow, compact }: DetailShotProps) {
  return (
    <div className={`grid md:grid-cols-2 gap-8 items-center ${reverse ? 'md:[&>*:first-child]:order-2' : ''}`}>
      <div className={`relative group space-y-4 ${narrow ? 'md:justify-self-center w-full max-w-[150px]' : compact ? 'md:justify-self-center w-full max-w-[70%]' : ''}`}>
        <div className={`sales-glow absolute inset-0 rounded-xl blur-xl ${accent ? 'bg-logic-lcd-amber/15' : 'bg-logic-lcd-green/10'}`} aria-hidden="true" />
        <ShotImage
          shot={shot}
          className="relative rounded-xl border border-logic-border shadow-xl shadow-black/50 w-full group-hover:scale-[1.01] transition duration-300"
        />
      </div>
      <div className="md:px-4">
        <h3 className="text-2xl font-bold mb-3">{title}</h3>
        <p className="text-logic-text-dim leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}

export default function SalesPage() {

  useEffect(() => {
    document.documentElement.style.overflow = 'auto';
    document.body.style.overflow = 'auto';
    const root = document.getElementById('root');
    if (root) root.style.overflow = 'auto';
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      if (root) root.style.overflow = '';
    };
  }, []);

  // Abre o programa na web com os planos: entra/cria a conta e segue para o Stripe.
  const subscribe = () => { window.location.hash = '#programa/assinar'; };

  return (
    <div className="min-h-screen bg-logic-bg-deep text-logic-text">
      <header className="sticky top-0 z-20 bg-logic-bg-deep/90 backdrop-blur border-b border-logic-border">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <VsLogo size={36} />
            <span className="font-semibold text-lg tracking-tight">VS Stage Pro</span>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={subscribe}
              className="hidden sm:block px-4 h-9 rounded-lg bg-logic-bg-elevated text-sm font-medium hover:bg-logic-bg-panel-light transition"
            >
              Assinar agora
            </button>
            <a
              href="#baixar"
              className="px-4 min-h-9 rounded-lg bg-logic-lcd-green text-black text-sm font-bold hover:brightness-110 transition flex items-center justify-center text-center"
            >
              TESTAR GRÁTIS
            </a>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="sales-glow absolute -top-32 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-logic-lcd-green/10 blur-3xl" />
        </div>
        <div className="max-w-6xl mx-auto px-6 pt-16 pb-16 text-center relative">
          <div className="sales-float mx-auto w-24 h-24 mb-6">
            <VsLogo size={96} />
          </div>
          <p className="sales-rise text-sm font-semibold text-logic-lcd-green tracking-wide mb-4">
            O PALCO ONLINE DO SEU SHOW
          </p>
          <h1 className="sales-rise text-4xl sm:text-5xl font-bold leading-tight max-w-3xl mx-auto" style={{ animationDelay: '100ms' }}>
            Uma playlist. Uma timeline por música. Todo o show na mão.
          </h1>
          <p className="sales-rise text-logic-text-dim text-lg max-w-2xl mx-auto mt-6" style={{ animationDelay: '200ms' }}>
            O VS Stage Pro junta editor de multitracks, mixer com Timecode LTC, Modo Show protegido, área do músico no celular e teleprompter na TV — com cada música na sua própria timeline, nunca misturada em uma única bagunça visual. Baixe, crie sua conta e teste grátis.
          </p>
          <div className="sales-rise flex flex-wrap items-center justify-center gap-4 mt-10" style={{ animationDelay: '300ms' }}>
            <a
              href="#baixar"
              className="px-8 min-h-14 rounded-xl bg-logic-lcd-green text-black text-base font-bold hover:brightness-110 hover:scale-[1.02] transition shadow-logic-raised flex items-center justify-center text-center"
            >
              <Play size={18} className="mr-2" fill="currentColor" />
              TESTAR GRÁTIS
            </a>
            <button
              onClick={subscribe}
              className="px-8 min-h-14 rounded-xl bg-logic-bg-elevated text-base font-medium hover:bg-logic-bg-panel-light transition"
            >
              Assinar agora
            </button>
          </div>
          <ul className="sales-rise flex flex-wrap justify-center gap-x-8 gap-y-2 mt-10 text-sm text-logic-text-dim" style={{ animationDelay: '400ms' }}>
            {['Sem cartão para testar', 'Funciona no Mac e no Windows', 'Suporte direto com o produto'].map((t) => (
              <li key={t} className="flex items-center gap-2"><Check size={14} className="text-logic-lcd-green" /> {t}</li>
            ))}
          </ul>
        </div>
        <div className="max-w-5xl mx-auto px-6 pb-20">
          <div className="sales-rise relative rounded-2xl border border-logic-border-light bg-gradient-to-b from-[#1c1c1e] to-[#0d0d0f] p-3 shadow-2xl shadow-black/80 sm:p-5">
            <div className="flex items-center gap-2 px-1 pb-3">
              <span className="w-3 h-3 rounded-full bg-[#ff5f57]" aria-hidden="true" />
              <span className="w-3 h-3 rounded-full bg-[#febc2e]" aria-hidden="true" />
              <span className="w-3 h-3 rounded-full bg-[#28c840]" aria-hidden="true" />
              <span className="ml-3 hidden sm:flex items-center gap-2 text-[11px] tracking-[0.2em] text-logic-text-dim uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-logic-lcd-green animate-pulse" aria-hidden="true" />
                VS Stage PRO
              </span>
            </div>
            <HeroCarousel />
            <div className="absolute inset-x-0 -bottom-1 h-2 rounded-b-2xl bg-gradient-to-b from-transparent to-black/60" aria-hidden="true" />
          </div>
        </div>
      </section>

      <section className="border-y border-logic-border bg-logic-bg">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="text-3xl font-bold text-center mb-3">Como funciona em 3 passos</h2>
          <p className="text-logic-text-dim text-center max-w-2xl mx-auto mb-12">Do backstage ao palco em minutos.</p>
          <div className="grid sm:grid-cols-3 gap-5">
            {STEPS.map((step, i) => (
              <div key={step.num} className="sales-rise p-6 rounded-xl bg-logic-bg-panel border border-logic-border hover:border-logic-border-light transition" style={{ animationDelay: `${i * 120}ms` }}>
                <div className="w-11 h-11 rounded-lg bg-logic-lcd-green/15 flex items-center justify-center mb-4 text-logic-lcd-green font-bold text-lg">
                  {step.num}
                </div>
                <h3 className="font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-logic-text-dim leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-bold text-center mb-3">Tudo que o show precisa</h2>
        <p className="text-logic-text-dim text-center max-w-2xl mx-auto mb-12">
          Um único programa para diretor, produtor e banda — cada um com a tela certa, todas em sincronia.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(({ icon: Icon, title, desc }, i) => (
            <div
              key={title}
              className="sales-rise p-6 rounded-xl bg-logic-bg-panel border border-logic-border hover:border-logic-border-light hover:bg-logic-bg-elevated transition group"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="w-11 h-11 rounded-lg bg-logic-lcd-green/15 flex items-center justify-center mb-4 group-hover:scale-105 transition">
                <Icon size={20} className="text-logic-lcd-green" />
              </div>
              <h3 className="font-semibold mb-2">{title}</h3>
              <p className="text-sm text-logic-text-dim leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-logic-border bg-logic-bg">
        <div className="max-w-6xl mx-auto px-6 py-20 space-y-16">
          <DetailShot
            shot={SHOT.playlist}
            title="Cada música com a timeline só dela"
            compact
            desc={
              <>
                Ao clicar numa música da playlist, ela ganha uma <span className="text-logic-text font-semibold">timeline exclusiva</span> — nada de várias músicas empilhadas numa única timeline bagunçada como nas DAWs antigas. Está tudo limpo, separado e organizado. E o programa monta o show praticamente sozinho: ele identifica cada áudio, roteia para os multigrupos certos (Bateria, Contrabaixo, Percussões, Guitarras...), coloca cada instrumento no seu lugar e já marca o BPM detectado por inteligência artificial direto no display principal.
              </>
            }
          />
          <DetailShot
            shot={SHOT.mixer}
            title="Mixer com todos os canais do show"
            reverse
            desc={
              <>
                O mixer mostra todos os seus canais com faders que puxam o palco para o ouvido. O canal <span className="text-logic-text font-semibold">TIMECODE (LTC)</span> fica separado no início — sempre junto (lock) e mudo na saída principal, enviando o sinal de timecode direto para as luzes do show. Quando precisar, o VS Stage Pro reserva um canal dedicado para isso, com volume travado e pronto para tocar sem susto.
              </>
            }
          />
          <DetailShot
            shot={SHOT.groups}
            title="O programa organiza seus multigrupos sozinho"
            desc={
              <>
                Importou os áudios e o VS Stage Pro faz o trabalho sujo: ele identifica cada som e cria os <span className="text-logic-text font-semibold">multigrupos automaticamente</span> — Sanfonas, Teclados, Bateria, Percussões, Guitarras — com cada faixa já dentro do grupo certo, roteada e pronta no mixer. Você não monta pastas nem arrasta canais: abriu o projeto, o show já estava organizado.
              </>
            }
          />
          <DetailShot
            shot={SHOT.master}
            title="Botão Master mágico: sobreviver a situações com um toque"
            accent
            narrow
            desc={
              <>
                Um botão emblemático no Master: em emergência, ele <span className="text-logic-text font-semibold">transforma todo o roteamento em L/R</span> — Click e Maestro vão para o L, o restante da música para o R. Se o canal da direita falhar, você continua tocando: voz, banda e todo o show saem na única saída sobrevivente. Novidade exclusiva no mercado de multitracks.
              </>
            }
          />
          <DetailShot
            shot={SHOT.timecode}
            title="Canal TIMECODE (LTC) dedicado e travado"
            accent
            narrow
            desc={
              <>
                O canal <span className="text-logic-text font-semibold">TIMECODE (LTC)</span> vive no começo do mixer com identidade própria: saída isolada (<span className="text-logic-text font-semibold">Sem Saída</span> no master), volume <span className="text-logic-text font-semibold">TRAVADO em −6.0</span> e MUTE garantido — o timecode segue direto para o sistema de luz sem nunca vazar no som do show. Nada de alguém mexer sem querer no fader que sincroniza o palco.
              </>
            }
          />
          <DetailShot
            shot={SHOT.showMode}
            title="Modo Show: playlist expandida e proteção contra acidentes"
            reverse
            desc={
              <>
                No Modo Show a playlist ocupa a tela inteira: você vê cada música com BPM, tom, duração, fluxo do show (Contínuo, Por Bloco, Uma a Uma), BPM direto e Tuner. Painéis <span className="text-logic-text font-semibold">TOCANDO e PRÓXIMA</span> sempre visíveis, <span className="text-logic-text font-semibold">Restante da música</span> gigante no visor e totais da playlist embaixo (12 músicas, 37:03 de show). E proteção real: no Modo Show, a tecla <span className="text-logic-text font-semibold">ESPAÇO não toca nem pausa</span> — só botão físico; e o Play só volta a funcionar depois de um Stop. Nenhum acidente de esbarrão derruba seu show.
              </>
            }
          />
          <DetailShot
            shot={SHOT.musician}
            title="Área do Músico, sempre com o show"
            desc={
              <>
                O celular do músico mostra o que está TOCANDO, a PRÓXIMA e a playlist inteira do show — tudo atualizado em tempo real. Cada música tem sua área de partitura ou cifra que o músico escreve, e que <span className="text-logic-text font-semibold">muda no mesmo instante em que a música começa</span>. O caderno fica com o show, salvo no projeto. Cifre no celular antes do show, e a partitura certa aparece na hora.
              </>
            }
          />
          <DetailShot
            shot={SHOT.prompter}
            title="Teleprompter do produtor: avisos, letras, cronômetro e playlist"
            reverse
            desc={
              <>
                Na aba do produtor, você controla a tela do artista: Liga/Desliga <span className="text-logic-text font-semibold">Letra, Relógio, Show Time, Playlist lateral, Avisos, Logo da banda</span>. Mande avisos prontos com um toque ("Mandar um alô para a cidade", "O prefeito chegou", "Últimas 2 músicas"), acompanhe o que faltam ou passaram do show, e escreva a letra da música na aba Letras — a tela do palco mostra isso tudo ao vivo, sem o artista olhar pra trás.
              </>
            }
          />
          <DetailShot
            shot={SHOT.loops}
            title="Regions com loops: REFRÃO, SOLO e FINAL na sua mão"
            accent
            desc={
              <>
                Você marca na timeline o <span className="text-logic-text font-semibold">REFRÃO, SOLO e SOLO FINAL</span> — regions nomeadas que entram com loop. O diretor toca normalmente, e quando a banda quiser repetir o refrão ou ir direto pro solo, ele dispara. As regions ficam na régua de tempo com cor e nome claros, prontas para acionar a qualquer momento. Nada de cortar e colar na hora do show.
              </>
            }
          />
          <DetailShot
            shot={SHOT.loopsShow}
            title="Loops acionados ao vivo no Modo Show (atalhos 1-9, L, P)"
            reverse
            desc={
              <>
                No Modo Show, os pads das regions aparecem em destaque: <span className="text-logic-text font-semibold">REFRÃO, SOLO, SOLO FINAL, Intro</span> — e cada um dispara com tecla rápida (1, 2, 3...) ou com L (Loop) e P (Pausar). Assim você repete o refrão, pula pro solo ou fecha direto no final — e o contador do show continua correndo.
              </>
            }
          />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2 className="text-3xl font-bold mb-4">Como começar</h2>
        <p className="text-logic-text-dim mb-8">
          Baixe o programa para Mac, crie sua conta na primeira abertura e o teste grátis começa na hora. Depois, o programa pede para assinar — e continuar com a banda junta é só assinar.
        </p>
        <div className="flex flex-wrap justify-center gap-4">
          <a
            href="#baixar"
            className="px-8 min-h-14 rounded-xl bg-logic-lcd-green text-black text-base font-bold hover:brightness-110 hover:scale-[1.02] transition flex items-center justify-center text-center"
          >
            <Download size={16} className="mr-2" /> TESTAR GRÁTIS
          </a>
          <button
            onClick={subscribe}
            className="px-8 min-h-14 rounded-xl bg-logic-bg-elevated text-base font-medium hover:bg-logic-bg-panel-light transition"
          >
            Assinar agora
          </button>
        </div>
      </section>

      <footer className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid sm:grid-cols-2 gap-8 mb-10 max-w-3xl">
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold hover:text-logic-text transition">Termos de uso</summary>
            <div className="mt-3 space-y-2 text-xs text-logic-text-dim leading-relaxed">
              <p>Ao usar o VS Stage Pro você concorda em utilizar o programa para fins de produção musical e shows. O teste grátis não exige cartão.</p>
              <p>Projetos, letras e gravações são de responsabilidade do usuário. Não é permitido revender o acesso ou usar o serviço para fins ilícitos.</p>
            </div>
          </details>
          <details className="group">
            <summary className="cursor-pointer text-sm font-semibold hover:text-logic-text transition">Privacidade</summary>
            <div className="mt-3 space-y-2 text-xs text-logic-text-dim leading-relaxed">
              <p>Guardamos apenas o necessário para o programa funcionar: conta, projetos e arquivos que você enviar. Não vendemos seus dados nem usamos anúncios de terceiros.</p>
              <p>Você pode pedir a remoção dos seus dados a qualquer momento pelo e-mail de suporte abaixo.</p>
            </div>
          </details>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 pt-8 border-t border-logic-border">
          <div className="flex items-center gap-2 text-logic-text-dim text-sm">
            <Clapperboard size={16} className="text-logic-lcd-green" />
            <span className="font-semibold text-logic-text">VS Stage Pro</span>
            <span>© 2026</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="mailto:suporte.vssategepro@gmail.com"
              className="flex items-center gap-2 px-3 h-8 rounded-lg bg-logic-bg-elevated text-xs font-medium hover:bg-logic-bg-panel-light transition"
            >
              <MessageCircle size={13} /> Suporte
            </a>
            <a href="#baixar" className="text-xs text-logic-text-dim hover:text-logic-text transition">
              Baixar o programa
            </a>
          </div>
        </div>
      </footer>

    </div>
  );
}
