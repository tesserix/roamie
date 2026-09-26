import { getDocumentAsync } from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Asset, AssetField, MediaType, Query, requestPermissionsAsync } from 'expo-media-library';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { newId, selectMemories, validatePhotos, type MemoryPhoto, type Trip } from './trips';
import { albumHtml, itineraryHtml } from './trip-exports';

export function tripDirectory(accountId: string, tripId: string): Directory {
  if (!/^[a-z0-9-]{1,80}$/.test(tripId)) throw new Error('Invalid trip.');
  return new Directory(Paths.document, 'roamie-trips', encodeURIComponent(accountId), tripId);
}
async function copyPhoto(account: string, trip: string, photo: { uri: string; creationTime?: number; width?: number; height?: number }, id = newId()): Promise<MemoryPhoto> {
  const context = ImageManipulator.manipulate(photo.uri);
  const scale = Math.min(1, 1000 / (photo.width || 1000), 1000 / (photo.height || 1000));
  context.resize({ width: Math.max(1, Math.round((photo.width || 1000) * scale)) });
  const rendered = await context.renderAsync();
  try {
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.65 });
    const directory = tripDirectory(account, trip); directory.create({ intermediates: true, idempotent: true });
    const file = new File(directory, `${id}.jpg`);
    new File(result.uri).move(file);
    if (file.size > 500000) { file.delete(); throw new Error('That photo is too detailed to export. Choose a smaller copy.'); }
    return { id, uri: file.uri, width: result.width, height: result.height, caption: '', creationTime: photo.creationTime ?? Date.now() };
  } finally { rendered.release(); context.release(); }
}
export async function choosePhotos(account: string, trip: Trip): Promise<MemoryPhoto[] | null> {
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 15, quality: 0.8, exif: false });
  if (result.canceled) return null;
  validatePhotos(result.assets.map(a => a.assetId ?? a.uri));
  const photos: MemoryPhoto[] = [];
  try { for (const asset of result.assets) photos.push(await copyPhoto(account, trip.id, asset)); return photos; }
  catch (error) { deletePhotos(account, trip.id, photos); throw error; }
}
export async function suggestPhotos(account: string, trip: Trip): Promise<MemoryPhoto[]> {
  const permission = await requestPermissionsAsync(false, ['photo']);
  if (!permission.granted) throw new Error('Allow photo access to suggest memories, or choose photos manually.');
  const from = new Date(`${trip.startDate}T00:00:00`).getTime(), to = new Date(`${trip.endDate}T23:59:59.999`).getTime();
  const metadata = await new Query().eq(AssetField.MEDIA_TYPE, MediaType.IMAGE).gte(AssetField.CREATION_TIME, from).lte(AssetField.CREATION_TIME, to).orderBy(AssetField.CREATION_TIME).limit(300).exeForMetadata();
  const candidates = metadata.filter(p => p.creationTime !== null && p.width !== null && p.height !== null).map(p => ({ id: p.id, width: p.width!, height: p.height!, creationTime: p.creationTime! }));
  const selected = selectMemories(candidates), photos: MemoryPhoto[] = [];
  if (!selected.length) throw new Error('No accessible photos found for these trip dates. Try choosing photos manually.');
  try { for (const item of selected) photos.push(await copyPhoto(account, trip.id, { uri: await new Asset(item.id).getUri(), creationTime: item.creationTime, width: item.width, height: item.height })); return photos; }
  catch (error) { deletePhotos(account, trip.id, photos); throw error; }
}
export function deletePhotos(account: string, trip: string, photos: MemoryPhoto[]) {
  const prefix = tripDirectory(account, trip).uri.replace(/\/+$/, '') + '/';
  for (const photo of photos) if (/^[a-z0-9-]{1,80}$/.test(photo.id) && photo.uri === `${prefix}${photo.id}.jpg`) { const file = new File(photo.uri); if (file.exists) file.delete(); }
}
export async function photoData(account: string, trip: Trip) {
  validatePhotos(trip.photos.map(p => p.id));
  const prefix = tripDirectory(account, trip.id).uri.replace(/\/+$/, '') + '/';
  const result: { data: string; caption: string }[] = [];
  for (const photo of trip.photos) {
    if (!/^[a-z0-9-]{1,80}$/.test(photo.id) || photo.uri !== `${prefix}${photo.id}.jpg`) throw new Error('Choose these photos again on this account.');
    const file = new File(photo.uri);
    if (!file.exists || file.size > 500000) throw new Error('A photo is unavailable. Choose it again.');
    result.push({ data: await file.base64(), caption: photo.caption });
  }
  return result;
}
export async function exportTrip(account: string, trip: Trip, kind: 'itinerary' | 'album'): Promise<string> {
  const html = kind === 'album' ? albumHtml(trip, await photoData(account, trip)) : itineraryHtml(trip);
  const result = await Print.printToFileAsync({ html, width: 595, height: 842 });
  const directory = tripDirectory(account, trip.id); directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${kind}.pdf`); if (file.exists) file.delete();
  new File(result.uri).move(file);
  return file.uri;
}
export async function shareFile(uri: string, mimeType: string) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device. Your file is saved in Roamie.');
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: 'Share your Roamie trip', UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : mimeType === 'video/mp4' ? 'public.mpeg-4' : 'public.png' });
}
export async function saveToPhotos(uri: string) {
  const permission = await requestPermissionsAsync(true);
  if (!permission.granted) throw new Error('Allow Roamie to save to Photos, or use Share instead.');
  await Asset.create(uri);
}
export function saveVideo(account: string, tripId: string, bytes: Uint8Array): string {
  const directory = tripDirectory(account, tripId); directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, 'memory.mp4'); file.write(bytes); return file.uri;
}

export function discardVideo(account: string, tripId: string) {
  const file = new File(tripDirectory(account, tripId), 'memory.mp4');
  if (file.exists) file.delete();
}
export async function chooseMusic(): Promise<{name: string; data: string} | null> {
  const result = await getDocumentAsync({ type: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-wav', 'audio/aac'], copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  const asset = result.assets[0], file = new File(asset.uri);
  try {
    if (!/\.(mp3|wav|m4a|aac)$/i.test(asset.name) || !file.exists || file.size <= 0 || file.size > 3_000_000) throw new Error('Choose an MP3, WAV, M4A or AAC file up to 3 MB.');
    return { name: asset.name, data: await file.base64() };
  } finally {
    if (file.uri.startsWith(Paths.cache.uri.replace(/\/+$/, '') + '/') && file.exists) file.delete();
  }
}
