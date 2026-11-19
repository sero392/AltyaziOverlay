import { NativeImage, nativeImage } from 'electron';
import { drawIconBgra } from '../shared/iconBitmap';

const cache = new Map<number, NativeImage>();

/** Tepsi ve pencere simgesi; bkz. drawIconBgra. */
export function appIcon(size: number): NativeImage {
  const hit = cache.get(size);
  if (hit) {
    return hit;
  }
  const img = nativeImage.createFromBitmap(Buffer.from(drawIconBgra(size)), { width: size, height: size });
  cache.set(size, img);
  return img;
}
