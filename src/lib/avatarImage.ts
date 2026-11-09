// Foto de perfil do músico: recorta o centro em quadrado e reduz para um JPEG pequeno,
// que vai inteiro para o servidor (limite de 16 000 caracteres por foto).
const SIDE = 160;
const MAX_CHARS = 15_000;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')); };
    img.src = url;
  });
}

export async function fileToAvatar(file: File): Promise<string> {
  const img = await loadImage(file);
  const crop = Math.min(img.naturalWidth, img.naturalHeight);
  if (!crop) throw new Error('unreadable');
  const sx = (img.naturalWidth - crop) / 2;
  const sy = (img.naturalHeight - crop) / 2;
  let side = SIDE;
  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = side; canvas.height = side;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('unreadable');
    ctx.fillStyle = '#1b1e22';
    ctx.fillRect(0, 0, side, side);
    ctx.drawImage(img, sx, sy, crop, crop, 0, 0, side, side);
    for (let q = 0.85; q >= 0.4; q -= 0.15) {
      const data = canvas.toDataURL('image/jpeg', q);
      if (data.length <= MAX_CHARS) return data;
    }
    side = Math.round(side * 0.8);
    if (side < 64) throw new Error('unreadable');
  }
}
