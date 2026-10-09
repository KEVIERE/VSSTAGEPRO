export async function playTestAllOutputs(deviceId?: string): Promise<void> {
  const ctx = new AudioContext();
  try {
    if (deviceId && 'setSinkId' in ctx) {
      try {
        await (ctx as unknown as { setSinkId: (id: string) => Promise<void> }).setSinkId(deviceId);
      } catch (err) {
        console.warn('[audioDeviceTest] setSinkId falhou', err);
      }
    }
    const maxCh = Math.max(1, ctx.destination.maxChannelCount || 2);
    try {
      ctx.destination.channelCount = maxCh;
      ctx.destination.channelCountMode = 'explicit';
      ctx.destination.channelInterpretation = 'discrete';
    } catch (err) {
      console.warn('[audioDeviceTest] canais explícitos não suportados', err);
    }
    const merger = ctx.createChannelMerger(maxCh);
    const now = ctx.currentTime;
    for (let i = 0; i < maxCh; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 440 + i * 55;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(0.18, now + 0.02);
      g.gain.setValueAtTime(0.18, now + 0.85);
      g.gain.linearRampToValueAtTime(0, now + 1);
      osc.connect(g);
      g.connect(merger, 0, i);
      osc.start(now);
      osc.stop(now + 1.05);
    }
    merger.connect(ctx.destination);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  } finally {
    try { await ctx.close(); } catch { /* already closed */ }
  }
}

export async function getOutputDevices(): Promise<MediaDeviceInfo[]> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  } catch {
    /* user may deny; labels will be empty but devices still appear */
  }
  const list = await navigator.mediaDevices.enumerateDevices();
  return list.filter((d) => d.kind === 'audiooutput');
}
