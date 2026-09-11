import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { Project } from '../model';
import { parseProject } from '../model';

export const bytesFromData = (data: string) => Uint8Array.from(atob(data.slice(data.indexOf(',') + 1)), c => c.charCodeAt(0));
export function dataFromBytes(bytes: Uint8Array, mime: string) {
  let binary = ''; for (let i = 0; i < bytes.length; i += 16384) binary += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return `data:${mime};base64,${btoa(binary)}`;
}
export function packProject(project: Project): Uint8Array {
  const document = structuredClone(project), files: Record<string, Uint8Array> = {};
  for (const asset of Object.values(document.assets)) { const path = `assets/${asset.id}`; files[path] = bytesFromData(asset.data); asset.data = path; }
  files['project.json'] = strToU8(JSON.stringify(document));
  return zipSync(files, { level: 6 });
}
export function unpackProject(bytes: Uint8Array): Project {
  if (bytes.length > 100 * 1024 * 1024) throw new Error('This project exceeds the 100 MB import limit.');
  let total = 0;
  const files = unzipSync(bytes, { filter: file => {
    total += file.originalSize;
    if (file.originalSize > 100 * 1024 * 1024 || total > 250 * 1024 * 1024) throw new Error('Expanded project is too large.');
    return file.name === 'project.json' || /^assets\/[a-zA-Z0-9_-]+$/.test(file.name);
  } });
  if (!files['project.json']) throw new Error('This is not a .popupbook project: project.json is missing.');
  const project = parseProject(JSON.parse(strFromU8(files['project.json'])));
  for (const asset of Object.values(project.assets)) {
    if (asset.data.startsWith('data:')) continue;
    const bytes = files[asset.data]; asset.data = bytes ? dataFromBytes(bytes, asset.mime) : '';
  }
  return project;
}
export function download(data: BlobPart | Uint8Array, filename: string, type = 'application/octet-stream') {
  const blob = new Blob([data instanceof Uint8Array ? new Uint8Array(data).buffer : data], { type });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const safeName = (name: string) => name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'popup-book';
export function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fold-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('projects');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Local storage is locked by another open version. Close the other tab and reload.'));
  });
}
export async function saveLocal(project: Project): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction('projects', 'readwrite'); tx.objectStore('projects').put(project, 'current'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = () => { db.close(); reject(tx.error ?? new Error('Save cancelled.')); }; });
}
export async function loadLocal(): Promise<Project | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => { const tx = db.transaction('projects', 'readonly'), req = tx.objectStore('projects').get('current'); req.onsuccess = () => { db.close(); try { resolve(req.result ? parseProject(req.result) : null); } catch (error) { reject(error); } }; req.onerror = () => { db.close(); reject(req.error); }; });
}
