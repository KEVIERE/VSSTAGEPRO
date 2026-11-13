import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------------------------
// Tela sempre acesa (TV do palco, VS Stage Remote, Área do Músico).
//
// `navigator.wakeLock` só existe em contexto seguro (HTTPS ou localhost). A Rede Local serve as
// páginas em http://192.168.x.x:8080, onde ele não existe, e o aparelho apagava sozinho no meio do
// show. Lá a página toca um vídeo invisível de 2 s (quadro preto e silêncio), o mesmo truque do
// NoSleep.js:
// - COM som (faixa de áudio em silêncio): o Safari só impede o repouso com vídeo que tem áudio e
//   não está mudo, e o Chrome ignora vídeo mudo pequeno;
// - SEM loop: o Safari não segura a tela com mídia em loop; o tempo volta no timeupdate;
// - dentro do documento, com playsinline, e nunca vai para a TV pelo AirPlay no lugar da letra;
// - a fonte fica embutida (data URI): o servidor do Mac não serve vídeo com Range, que o Safari exige.
// Vídeo com som precisa de um toque (click, touchend ou tecla; touchstart não vale). Depois do
// primeiro, ele volta sozinho quando a página reaparece ou o sistema pausa (ligação, Siri).
//
// Por ter faixa de som, o vídeo pode tomar o áudio do aparelho (no iPhone ele para a música de
// outro app). Por isso quem também toca som na página (Área do Músico) usa o modo 'botao': só o
// Wake Lock nativo, e o vídeo entra depois que a pessoa aperta "Manter a tela acesa".
// ---------------------------------------------------------------------------------------------

/**
 * - `nativo`: Wake Lock do navegador ativo.
 * - `video`: o vídeo invisível está segurando a tela.
 * - `precisaToque`: falta o primeiro toque para o vídeo começar (qualquer toque na página serve).
 * - `precisaBotao`: modo 'botao' sem Wake Lock; a página mostra o botão "Manter a tela acesa".
 * - `falhou`: nada segurou a tela (o aparelho pode apagar).
 */
export type KeepAwake = 'nativo' | 'video' | 'precisaToque' | 'precisaBotao' | 'falhou';

/** 'auto': o vídeo entra sozinho quando falta o Wake Lock. 'botao': só depois de `startVideo()`. */
export type KeepAwakeVideo = 'auto' | 'botao';

export interface KeepAwakeHandle {
  state: KeepAwake;
  /**
   * Liga o vídeo invisível. Chamar DENTRO do clique do botão "Manter a tela acesa": o play() com
   * som só é aceito no mesmo toque. Vale até a página fechar.
   */
  startVideo: () => void;
}

const KEEP_AWAKE_MP4 = 'data:video/mp4;base64,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';
const GESTURES = ['click', 'touchend', 'keydown'] as const;

let keepAwakeVideo: HTMLVideoElement | null = null;

/** Um vídeo só por página, criado na primeira vez e reaproveitado. */
export function keepAwakeVideoEl(): HTMLVideoElement {
  if (keepAwakeVideo && keepAwakeVideo.isConnected) return keepAwakeVideo;
  const v = document.createElement('video');
  v.setAttribute('playsinline', '');
  v.setAttribute('webkit-playsinline', '');
  v.setAttribute('x-webkit-airplay', 'deny');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('tabindex', '-1');
  v.playsInline = true;
  try { v.disableRemotePlayback = true; } catch { /* navegador sem Remote Playback */ }
  v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;';
  v.src = KEEP_AWAKE_MP4;
  // No lugar do loop: volta para o começo antes de acabar.
  v.addEventListener('timeupdate', () => { if (v.currentTime > 0.5) v.currentTime = Math.random(); });
  document.body.appendChild(v);
  keepAwakeVideo = v;
  return v;
}

function hasNativeWakeLock(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
}

export function useKeepAwake(active: boolean, video: KeepAwakeVideo = 'auto'): KeepAwakeHandle {
  const [state, setState] = useState<KeepAwake>(() => (
    hasNativeWakeLock() ? 'nativo' : video === 'auto' ? 'video' : 'precisaBotao'
  ));
  // Botão "Manter a tela acesa" já apertado: continua valendo quando o efeito reinicia.
  const optedIn = useRef(false);
  const startRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let lock: WakeLockSentinel | null = null;
    let el: HTMLVideoElement | null = null;
    const videoAllowed = () => video === 'auto' || optedIn.current;
    let useVideo = !hasNativeWakeLock() && videoAllowed();
    let armed = false;
    let retry = 0;

    const onGesture = () => { playVideo(true); };
    const arm = () => {
      if (armed) return;
      armed = true;
      for (const ev of GESTURES) document.addEventListener(ev, onGesture, true);
    };
    const disarm = () => {
      if (!armed) return;
      armed = false;
      for (const ev of GESTURES) document.removeEventListener(ev, onGesture, true);
    };
    // Pausa que não foi pedida (ligação, Siri, outra mídia): tenta de novo, sem laço apertado.
    const onPause = () => {
      if (cancelled) return;
      window.clearTimeout(retry);
      retry = window.setTimeout(() => {
        if (!cancelled && document.visibilityState === 'visible') playVideo(false);
      }, 1000);
    };

    // Síncrono de propósito: dentro do toque, o play() precisa rodar antes de qualquer await.
    function playVideo(byGesture: boolean) {
      if (cancelled) return;
      if (!el) {
        el = keepAwakeVideoEl();
        el.addEventListener('pause', onPause);
      }
      let started: Promise<void>;
      try { started = Promise.resolve(el.play()); } catch (e) { started = Promise.reject(e); }
      started.then(() => {
        if (cancelled) return;
        disarm();
        setState('video');
      }).catch((e: unknown) => {
        if (cancelled) return;
        const blocked = (e as { name?: string } | null)?.name === 'NotAllowedError';
        // Sem toque ainda: espera o primeiro. Com toque e mesmo assim recusado: avisa e tenta de
        // novo no próximo toque.
        setState(blocked && !byGesture ? 'precisaToque' : 'falhou');
        arm();
      });
    }

    // Sem Wake Lock (ou recusado): o vídeo, se este modo deixa; senão a página mostra o botão.
    const fallback = () => {
      if (videoAllowed()) { useVideo = true; playVideo(false); }
      else setState('precisaBotao');
    };

    const requestNative = async () => {
      if (!hasNativeWakeLock()) { fallback(); return; }
      try {
        const l = await navigator.wakeLock.request('screen');
        if (cancelled) { l.release().catch(() => {}); return; }
        lock = l;
        setState('nativo');
      } catch {
        // Recusado com a tela à vista (economia de bateria, política do navegador): usa o vídeo.
        // Com a página escondida, espera ela voltar.
        if (cancelled || document.visibilityState !== 'visible') return;
        fallback();
      }
    };

    // Chamado no clique do botão: o vídeo começa dentro do mesmo toque.
    startRef.current = () => {
      useVideo = true;
      playVideo(true);
    };

    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (useVideo) playVideo(false); else requestNative();
    };

    if (useVideo) playVideo(false); else requestNative();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      startRef.current = null;
      disarm();
      window.clearTimeout(retry);
      document.removeEventListener('visibilitychange', onVis);
      lock?.release().catch(() => {});
      if (el) { el.removeEventListener('pause', onPause); el.pause(); }
    };
  }, [active, video]);

  const startVideo = useCallback(() => {
    optedIn.current = true;
    startRef.current?.();
  }, []);

  return { state, startVideo };
}
