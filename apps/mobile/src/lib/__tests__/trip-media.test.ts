import { expect, jest, test } from '@jest/globals';
import { photoData, deletePhotos, discardVideo, chooseMusic } from '../trip-media';
import { createTrip } from '../trips';
const mockPick = jest.fn<() => Promise<unknown>>();
let mockSize = 100;
jest.mock('expo-document-picker', () => ({getDocumentAsync: () => mockPick()}));
const mockRead = jest.fn(async () => 'YWJj'), mockDelete = jest.fn();
jest.mock('expo-file-system', () => ({
 Paths: { document: 'file:///app/Documents/', cache: {uri:'file:///app/Cache/'} },
 Directory: class { uri: string; constructor(...parts: string[]) { this.uri = parts[0].replace(/\/+$/, '') + '/' + parts.slice(1).join('/') + '/'; } },
 File: class { uri: string; exists = true; size = mockSize; constructor(uri: string | {uri:string}, name?:string) { this.uri = typeof uri === 'string' ? uri : uri.uri + name; } base64 = mockRead; delete() { mockDelete(this.uri); } },
}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-media-library', () => ({}));
jest.mock('expo-print', () => ({}));
jest.mock('expo-sharing', () => ({}));
const trip = createTrip({title:'Trip',destination:'Hanoi',startDate:'2026-10-02',endDate:'2026-10-03',currency:'USD',budgetMinor:0,travellers:1,diet:'none',interests:''});
const photo = {id:'photo-1',uri:`file:///app/Documents/roamie-trips/alice/${trip.id}/photo-1.jpg`,width:10,height:10,caption:'A memory',creationTime:0};
test('exports and removes owned photos when native directory URIs end in a slash', async () => {
 expect(await photoData('alice',{...trip,photos:[photo]})).toEqual([{data:'YWJj',caption:'A memory'}]);
 deletePhotos('alice',trip.id,[photo]);
 expect(mockDelete).toHaveBeenCalledTimes(1);
});
test('rejects photos belonging to another account or trip', async () => {
 await expect(photoData('bob',{...trip,photos:[photo]})).rejects.toThrow('Choose these photos again');
 await expect(photoData('alice',{...trip,id:'other-trip',photos:[photo]})).rejects.toThrow('Choose these photos again');
});
test('rejects traversal and a photo ID that does not match the stored file', async () => {
 await expect(photoData('alice',{...trip,photos:[{...photo,uri:photo.uri.replace('photo-1.jpg','../other-trip/photo-1.jpg')}]})).rejects.toThrow('Choose these photos again');
 await expect(photoData('alice',{...trip,photos:[{...photo,id:'other-photo'}]})).rejects.toThrow('Choose these photos again');
});

test('discards only the current trip video preview', () => {
 mockDelete.mockClear();
 discardVideo('alice',trip.id);
 expect(mockDelete).toHaveBeenCalledTimes(1);
 expect(mockDelete).toHaveBeenCalledWith(`file:///app/Documents/roamie-trips/alice/${trip.id}/memory.mp4`);
});
test('music selection handles cancellation, rejects oversize files and releases its cached copy', async () => {
 mockPick.mockResolvedValueOnce({canceled:true});
 expect(await chooseMusic()).toBeNull();
 mockSize = 3_000_001;
 mockPick.mockResolvedValueOnce({canceled:false,assets:[{uri:'file:///app/Cache/music.mp3',name:'music.mp3'}]});
 await expect(chooseMusic()).rejects.toThrow('up to 3 MB');
 expect(mockDelete).toHaveBeenCalledWith('file:///app/Cache/music.mp3');
 mockSize = 100;
 mockPick.mockResolvedValueOnce({canceled:false,assets:[{uri:'file:///app/Cache/music.mp3',name:'music.mp3'}]});
 expect(await chooseMusic()).toEqual({name:'music.mp3',data:'YWJj'});
});
