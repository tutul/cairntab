// Own background image (D-022). Kept as a Blob in this page's IndexedDB rather than
// chrome.storage.local, which caps at 10 MB without `unlimitedStorage`. Losing it only brings back
// the plain background. Images are downscaled on the way in so a 20 MB photo does not stay 20 MB.

import { UserError } from "./lib/i18n.js";

const DB = "cairntab";
const STORE = "files";
const KEY = "wallpaper";
const MAX_EDGE = 2560;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const getWallpaper = () => tx("readonly", (s) => s.get(KEY)).catch(() => null);
export const clearWallpaper = () => tx("readwrite", (s) => s.delete(KEY));

/** Downscale to MAX_EDGE on the long side and store as JPEG. Returns the stored Blob. */
export async function setWallpaper(file) {
  if (!file?.type?.startsWith("image/")) throw new UserError("err.notImage");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.86 });
  await tx("readwrite", (s) => s.put(blob, KEY));
  return blob;
}
