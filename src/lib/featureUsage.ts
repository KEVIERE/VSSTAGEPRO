import { useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useStore } from '@/store';

// Registra as funções do programa que o diretor usa (painel de administração → "Funções mais usadas").
// Os nomes aqui precisam bater com FEATURE_LABELS do painel.
export type Feature =
  | 'app_open' | 'play' | 'show_mode' | 'mixer' | 'bpm_tower' | 'tuner' | 'lr_master'
  | 'import' | 'export_audio' | 'save_project' | 'open_project'
  | 'show_manager' | 'teleprompter' | 'local_network' | 'broadcast';

const THROTTLE_MS = 30 * 1000;
const last = new Map<Feature, number>();

export function trackFeature(feature: Feature) {
  const now = Date.now();
  if (now - (last.get(feature) ?? 0) < THROTTLE_MS) return;
  last.set(feature, now);
  supabase.rpc('track_feature', { p_feature: feature }).then(() => {}, () => {});
}

// Transições do estado do editor que contam como "usou a função".
export function useFeatureTracking() {
  useEffect(() => {
    trackFeature('app_open');
    let prev = useStore.getState();
    return useStore.subscribe((s) => {
      const p = prev;
      prev = s;
      const turnedOn = (a: unknown, b: unknown) => !a && !!b;
      if (turnedOn(p.transport.isPlaying, s.transport.isPlaying)) trackFeature('play');
      if (turnedOn(p.playlistMaximized, s.playlistMaximized)) trackFeature('show_mode');
      if (turnedOn(p.mixerVisible, s.mixerVisible)) trackFeature('mixer');
      if (turnedOn(p.showBpmTower, s.showBpmTower)) trackFeature('bpm_tower');
      if (turnedOn(p.showTunerTower, s.showTunerTower)) trackFeature('tuner');
      if (turnedOn(p.lrMasterActive, s.lrMasterActive)) trackFeature('lr_master');
      if (turnedOn(p.importProgress, s.importProgress)) trackFeature('import');
      if (turnedOn(p.bounceDialogOpen, s.bounceDialogOpen)) trackFeature('export_audio');
      if (turnedOn(p.saveDialogOpen, s.saveDialogOpen)) trackFeature('save_project');
      if (turnedOn(p.openDialogOpen, s.openDialogOpen)) trackFeature('open_project');
    });
  }, []);
}
