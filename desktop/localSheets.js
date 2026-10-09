const fs = require('fs');
const crypto = require('crypto');

const MAX_CONTENT = 1_500_000;
const MAX_TITLE = 200;
const SAVE_DELAY_MS = 400;

/** Same person on any phone: names are matched without case, accents or extra spaces. */
function musicianKey(name) {
  return String(name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Musicians' sheets (chords, scores, drawings) for the local network, kept on the director's Mac. */
class LocalSheets {
  constructor(filePath) {
    this.filePath = filePath;
    this.timer = null;
    this.data = this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (d && typeof d.musicians === 'object' && d.musicians) return d;
    } catch { /* primeira vez */ }
    return { musicians: {} };
  }

  persist() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY_MS);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
      fs.renameSync(tmp, this.filePath);
    } catch { /* sem disco: segue em memória */ }
  }

  touch(name) {
    const key = musicianKey(name);
    if (!key) return null;
    const m = this.data.musicians[key];
    if (m) { m.name = name; return key; }
    this.data.musicians[key] = { id: crypto.randomUUID(), name, sheets: {} };
    this.persist();
    return key;
  }

  list(key) {
    const m = this.data.musicians[key];
    return m ? Object.values(m.sheets) : [];
  }

  save(key, { sheetId, songId, title, content }) {
    const m = this.data.musicians[key];
    if (!m || typeof songId !== 'string' || !songId || songId.length > 100) return null;
    if (typeof content !== 'string' || content.length > MAX_CONTENT) return null;
    const existing = m.sheets[songId];
    const sheet = {
      id: existing?.id ?? (typeof sheetId === 'string' && sheetId ? sheetId.slice(0, 64) : crypto.randomUUID()),
      song_id: songId,
      title: String(title ?? '').slice(0, MAX_TITLE),
      content,
      shared_from: existing?.shared_from ?? null,
      updated_at: new Date().toISOString(),
    };
    m.sheets[songId] = sheet;
    this.persist();
    return sheet.id;
  }

  remove(key, sheetId) {
    const m = this.data.musicians[key];
    if (!m) return false;
    for (const [songId, s] of Object.entries(m.sheets)) {
      if (s.id === sheetId) { delete m.sheets[songId]; this.persist(); return true; }
    }
    return false;
  }

  colleagues(key) {
    return Object.entries(this.data.musicians)
      .filter(([k]) => k !== key)
      .map(([, m]) => ({ id: m.id, name: m.name, instrument: '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  share(key, sheetId, targetIds) {
    const from = this.data.musicians[key];
    const sheet = from && Object.values(from.sheets).find((s) => s.id === sheetId);
    if (!sheet || !Array.isArray(targetIds)) return null;
    const wanted = new Set(targetIds.filter((t) => typeof t === 'string'));
    let count = 0;
    for (const [k, m] of Object.entries(this.data.musicians)) {
      if (k === key || !wanted.has(m.id)) continue;
      m.sheets[sheet.song_id] = {
        id: m.sheets[sheet.song_id]?.id ?? crypto.randomUUID(),
        song_id: sheet.song_id,
        title: sheet.title,
        content: sheet.content,
        shared_from: from.name,
        updated_at: new Date().toISOString(),
      };
      count += 1;
    }
    if (count) this.persist();
    return count;
  }
}

module.exports = { LocalSheets, musicianKey };
