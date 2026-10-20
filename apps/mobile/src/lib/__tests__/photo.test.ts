import { beforeEach, expect, jest, test } from '@jest/globals';
import { jpegData, statementData, toJpeg } from '../photo';

type Size = { width?: number; height?: number };
const mockSave = jest.fn((_options: unknown) => undefined);
const mockResize = jest.fn((_size: Size) => undefined);
const mockDeleted: string[] = [];
let mockPicked = { width: 0, height: 0 };
const mockRef = (width: number, height: number) => ({
  width,
  height,
  saveAsync: async (options: unknown) => { mockSave(options); return { uri: 'file:///cache/photo.jpg', width, height, base64: '/9j/JPEG' }; },
  release: () => undefined,
});
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (source: string | { width: number; height: number }) => {
      let size = typeof source === 'string' ? mockPicked : source;
      const context = {
        resize: (to: Size) => {
          mockResize(to);
          const from = size;
          size = to.width ? { width: to.width, height: Math.round((from.height * to.width) / from.width) } : { width: Math.round((from.width * to.height!) / from.height), height: to.height! };
          return context;
        },
        renderAsync: async () => mockRef(size.width, size.height),
        release: () => undefined,
      };
      return context;
    },
  },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(path: string) { this.uri = path; }
    get exists() { return true; }
    async base64() { return 'JVBERi0xLjQ='; }
    delete() { mockDeleted.push(this.uri); }
  },
}));

beforeEach(() => { mockSave.mockClear(); mockResize.mockClear(); mockDeleted.length = 0; });

test('a portrait iPhone HEIC photo becomes a JPEG no taller than 2048 pixels', async () => {
  mockPicked = { width: 3024, height: 4032 };
  expect(await toJpeg('file:///picked/IMG_0001.HEIC')).toEqual({ uri: 'file:///cache/photo.jpg', width: 1536, height: 2048, base64: '/9j/JPEG', mimeType: 'image/jpeg' });
  expect(mockResize).toHaveBeenCalledWith({ height: 2048 });
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7, base64: true });
});

test('a landscape photo is capped on its width', async () => {
  mockPicked = { width: 4032, height: 3024 };
  expect(await toJpeg('file:///picked/IMG_0002.HEIC')).toMatchObject({ width: 2048, height: 1536, mimeType: 'image/jpeg' });
  expect(mockResize).toHaveBeenCalledWith({ width: 2048 });
});

test('a small PNG keeps its size but is still sent as JPEG', async () => {
  mockPicked = { width: 800, height: 600 };
  expect(await toJpeg('file:///picked/menu.png')).toMatchObject({ width: 800, height: 600, mimeType: 'image/jpeg' });
  expect(mockResize).not.toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalledWith({ format: 'jpeg', compress: 0.7, base64: true });
});

test('receipt photo data leaves no copy behind', async () => {
  mockPicked = { width: 800, height: 600 };
  expect(await jpegData('file:///picked/receipt.heic')).toEqual({ data: '/9j/JPEG', mimeType: 'image/jpeg' });
  expect(mockDeleted).toEqual(['file:///cache/photo.jpg']);
});

test('statement PDFs upload as they are', async () => {
  expect(await statementData({ uri: 'file:///cache/may.pdf', name: 'may.pdf', mimeType: 'application/pdf' })).toEqual({ data: 'JVBERi0xLjQ=', mimeType: 'application/pdf' });
  expect(await statementData({ uri: 'file:///cache/june', name: 'June.PDF' })).toEqual({ data: 'JVBERi0xLjQ=', mimeType: 'application/pdf' });
  expect(mockSave).not.toHaveBeenCalled();
});

test('statement photos, HEIC included, upload as JPEG', async () => {
  mockPicked = { width: 800, height: 600 };
  expect(await statementData({ uri: 'file:///cache/statement.heic', name: 'statement.heic', mimeType: 'image/heic' })).toEqual({ data: '/9j/JPEG', mimeType: 'image/jpeg' });
  expect(mockDeleted).toEqual(['file:///cache/photo.jpg']);
});
