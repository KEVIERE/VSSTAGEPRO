/**
 * Leitor de Metadados de Áudio do Reaper e DAWs Profissionais (RIFF / WAV).
 *
 * Extrai informações gravadas diretamente no cabeçalho do arquivo WAV pelo Reaper:
 * 1. Chunk 'acid' (Sony ACID / Reaper tempo chunk com flTempo em float32).
 * 2. Chunk 'bext' (Broadcast Wave Format com descrição e histórico de andamento).
 * 3. Chunks 'cue ' e 'LIST/adtl' ('labl') com marcadores e mudanças de andamento (ex: "=130", "135 BPM").
 * 4. Metadados RIFF LIST/INFO (ICMT, INAM).
 */

export interface ReaperTempoMarker {
  time: number;
  bpm: number;
  label?: string;
}

export interface ReaperMetadataResult {
  bpm?: number;
  markers?: Array<{ time: number; name: string }>;
  tempoSegments?: Array<{ startTime: number; endTime: number; bpm: number }>;
}

export async function parseWavMetadata(blob: Blob): Promise<ReaperMetadataResult | null> {
  try {
    // Lê até os primeiros 512 KB do arquivo (onde todos os cabeçalhos e metadados RIFF ficam)
    const scanSize = Math.min(blob.size, 512 * 1024);
    const buffer = await blob.slice(0, scanSize).arrayBuffer();
    const view = new DataView(buffer);

    if (buffer.byteLength < 44) return null;
    const tag = (o: number) => String.fromCharCode(view.getUint8(o), view.getUint8(o + 1), view.getUint8(o + 2), view.getUint8(o + 3));

    if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;

    let sampleRate = 44100;
    let offset = 12;
    let acidBpm: number | null = null;
    const markers: Array<{ id: number; sampleOffset: number; name: string }> = [];
    const cueSamples = new Map<number, number>();
    const tempoMarks: ReaperTempoMarker[] = [];

    while (offset + 8 <= buffer.byteLength) {
      const chunkId = tag(offset);
      const chunkSize = view.getUint32(offset + 4, true);
      const dataOffset = offset + 8;
      const nextOffset = dataOffset + chunkSize + (chunkSize & 1);

      if (chunkId === 'fmt ' && chunkSize >= 16) {
        sampleRate = view.getUint32(dataOffset + 4, true) || 44100;
      }

      // 1. Chunk 'acid': padrão clássico da Sony/Reaper para andamento e fórmula
      if (chunkId === 'acid' && chunkSize >= 24) {
        try {
          const flTempo = view.getFloat32(dataOffset + 16, true);
          if (Number.isFinite(flTempo) && flTempo >= 30 && flTempo <= 320) {
            acidBpm = Math.round(flTempo * 100) / 100;
          }
        } catch { /* chunk corrompido ou fora do padrão: ignora e segue */ }
      }

      // 2. Chunk 'bext': Broadcast Wave Format
      if (chunkId === 'bext') {
        try {
          const bextBytes = new Uint8Array(buffer, dataOffset, Math.min(chunkSize, 256));
          const desc = new TextDecoder('latin1').decode(bextBytes);
          const m = desc.match(/(?:bpm|tempo)[:=\s]+(\d+(?:\.\d+)?)/i) || desc.match(/\b(\d{2,3}(?:\.\d+)?)\s*bpm\b/i);
          if (m && m[1]) {
            const v = parseFloat(m[1]);
            if (v >= 30 && v <= 320 && !acidBpm) acidBpm = Math.round(v * 100) / 100;
          }
        } catch { /* chunk corrompido ou fora do padrão: ignora e segue */ }
      }

      // 3. Chunk 'cue ': posições de marcadores e cortes em frames de amostra
      if (chunkId === 'cue ') {
        try {
          const numCues = view.getUint32(dataOffset, true);
          for (let i = 0; i < numCues && dataOffset + 4 + (i + 1) * 24 <= buffer.byteLength; i++) {
            const cOffset = dataOffset + 4 + i * 24;
            const cueId = view.getUint32(cOffset, true);
            const samplePos = view.getUint32(cOffset + 20, true);
            cueSamples.set(cueId, samplePos);
          }
        } catch { /* chunk corrompido ou fora do padrão: ignora e segue */ }
      }

      // 4. Chunk 'LIST' com subtipo 'adtl' (Associated Data List) -> labels de marcadores do Reaper
      if (chunkId === 'LIST' && chunkSize >= 4) {
        const listType = tag(dataOffset);
        if (listType === 'adtl') {
          let adtlOffset = dataOffset + 4;
          while (adtlOffset + 8 <= dataOffset + chunkSize && adtlOffset + 8 <= buffer.byteLength) {
            const subId = tag(adtlOffset);
            const subSize = view.getUint32(adtlOffset + 4, true);
            const subData = adtlOffset + 8;

            if (subId === 'labl' && subSize >= 4) {
              const cueId = view.getUint32(subData, true);
              const textBytes = new Uint8Array(buffer, subData + 4, Math.max(0, subSize - 4));
              let labelText = new TextDecoder('utf-8').decode(textBytes).replace(/\0.*$/, '').trim();
              if (!labelText) {
                labelText = new TextDecoder('latin1').decode(textBytes).replace(/\0.*$/, '').trim();
              }

              const samplePos = cueSamples.get(cueId) ?? 0;
              const timeSec = sampleRate > 0 ? samplePos / sampleRate : 0;
              markers.push({ id: cueId, sampleOffset: samplePos, name: labelText });

              // Identifica mudanças de andamento em labels do Reaper (ex: "=130", "135 BPM", "BPM: 120")
              const bpmMatch = labelText.match(/^(?:=|\bBPM[:=\s]*|\btempo[:=\s]*)(\d+(?:\.\d+)?)/i) || labelText.match(/\b(\d{2,3}(?:\.\d+)?)\s*bpm\b/i);
              if (bpmMatch && bpmMatch[1]) {
                const bpmVal = parseFloat(bpmMatch[1]);
                if (bpmVal >= 30 && bpmVal <= 320) {
                  tempoMarks.push({ time: timeSec, bpm: Math.round(bpmVal * 100) / 100, label: labelText });
                }
              }
            }

            adtlOffset += 8 + subSize + (subSize & 1);
          }
        }
      }

      offset = nextOffset;
    }

    tempoMarks.sort((a, b) => a.time - b.time);

    let tempoSegments: Array<{ startTime: number; endTime: number; bpm: number }> | undefined;
    if (tempoMarks.length > 1) {
      tempoSegments = [];
      for (let i = 0; i < tempoMarks.length; i++) {
        const cur = tempoMarks[i];
        const nextTime = i < tempoMarks.length - 1 ? tempoMarks[i + 1].time : 999999;
        tempoSegments.push({
          startTime: cur.time,
          endTime: nextTime,
          bpm: cur.bpm,
        });
      }
    }

    const firstBpm = tempoMarks[0]?.bpm || acidBpm || undefined;

    return {
      bpm: firstBpm,
      markers: markers.map((m) => ({ time: sampleRate > 0 ? m.sampleOffset / sampleRate : 0, name: m.name })),
      tempoSegments,
    };
  } catch (err) {
    console.warn('[reaperMetadata] falha ao ler metadados:', err);
    return null;
  }
}
