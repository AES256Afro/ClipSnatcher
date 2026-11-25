// Turns a downloaded picture into the small JPEG thumbnail kept in history. Runs wherever
// OffscreenCanvas does (the background worker, and extension pages for tests).

export const THUMB_WIDTH = 160;
export const THUMB_MAX_HEIGHT = 200;

// Where to draw a picture of `width` x `height` so it fills a THUMB_WIDTH-wide thumbnail:
// scaled to that width, and if that makes it taller than THUMB_MAX_HEIGHT (a portrait
// video), cut equally from top and bottom so the middle of the picture shows.
export function thumbLayout(width, height) {
  const drawH = Math.max(1, Math.round((height / Math.max(1, width)) * THUMB_WIDTH));
  const canvasH = Math.min(drawH, THUMB_MAX_HEIGHT);
  return { canvasW: THUMB_WIDTH, canvasH, drawW: THUMB_WIDTH, drawH, y: Math.round((canvasH - drawH) / 2) };
}

// A picture (as a Blob) to a data: URL of the thumbnail.
export async function shrinkImage(blob) {
  const bmp = await createImageBitmap(blob);
  const l = thumbLayout(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(l.canvasW, l.canvasH);
  canvas.getContext('2d').drawImage(bmp, 0, l.y, l.drawW, l.drawH);
  bmp.close();                                   // a full-size picture can be several MB once decoded
  const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  const bytes = new Uint8Array(await out.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}
