// Dexie needs a real IndexedDB implementation under jsdom.
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { Blob as NodeBlob } from 'node:buffer';

// jsdom's Blob is not recognised by structuredClone, so fake-indexeddb stores it
// as a plain object and photos come back unreadable — an artefact of the test
// doubles, not of the app: real IndexedDB round-trips Blobs fine.
//
// Node's Blob clones correctly and implements everything the app uses (`type`,
// `arrayBuffer()`, construction from byte arrays), so the tests exercise the
// real code path rather than the app being reshaped to suit a fake.
Object.defineProperty(globalThis, 'Blob', {
  value: NodeBlob,
  writable: true,
  configurable: true,
});
