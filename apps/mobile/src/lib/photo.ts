import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

export type Photo = { uri: string; width: number; height: number; base64: string; mimeType: 'image/jpeg' };

const LONG_EDGE = 2048;

/** Re-encodes any photo the phone can open, HEIC included, as an upright JPEG that photo reading accepts. */
export function toJpeg(uri: string, includeBase64: false): Promise<Omit<Photo, 'base64'>>;
export function toJpeg(uri: string, includeBase64?: true): Promise<Photo>;
export async function toJpeg(uri: string, includeBase64 = true): Promise<Omit<Photo, 'base64'> & { base64?: string }> {
  const picked = ImageManipulator.manipulate(uri);
  const original = await picked.renderAsync();
  const long = Math.max(original.width, original.height);
  const resizing = long > LONG_EDGE ? ImageManipulator.manipulate(original).resize(original.width >= original.height ? { width: LONG_EDGE } : { height: LONG_EDGE }) : null;
  const image = resizing ? await resizing.renderAsync() : original;
  try {
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: includeBase64 });
    if (includeBase64 && !saved.base64) throw new Error('photo was not encoded');
    return { uri: saved.uri, width: saved.width, height: saved.height, ...(includeBase64 ? { base64: saved.base64 } : {}), mimeType: 'image/jpeg' };
  } finally {
    if (image !== original) image.release();
    resizing?.release(); original.release(); picked.release();
  }
}

export async function jpegData(uri: string): Promise<{ data: string; mimeType: string }> {
  const photo = await toJpeg(uri);
  const file = new File(photo.uri);
  if (file.exists) file.delete();
  return { data: photo.base64, mimeType: photo.mimeType };
}

export async function statementData(asset: { uri: string; name: string; mimeType?: string | null }): Promise<{ data: string; mimeType: string }> {
  if (asset.mimeType === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')) return { data: await new File(asset.uri).base64(), mimeType: 'application/pdf' };
  return jpegData(asset.uri);
}
