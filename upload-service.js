import { lstat, mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const inside = (path, root) => path === root || path.startsWith(root + sep);
const uploadError = (message, status = 400) => Object.assign(new Error(message), { status });

export function uploadFilename(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\x00-\x1f\x7f]/.test(value) || Buffer.byteLength(value) > 240) {
    throw uploadError('Invalid filename');
  }
  return value;
}

// Read a bounded binary body without destroying the socket: oversized requests
// must receive a useful HTTP 413 rather than a connection reset.
export function readUploadBody(req, limit = MAX_UPLOAD_BYTES) {
  return new Promise((resolveBody, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > limit) { req.resume(); reject(uploadError('File exceeds the 20 MiB limit', 413)); return; }
    let chunks = [], size = 0, settled = false;
    const fail = error => { if (settled) return; settled = true; chunks = []; reject(error); };
    req.on('data', chunk => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) { fail(uploadError('File exceeds the 20 MiB limit', 413)); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!settled) { settled = true; resolveBody(Buffer.concat(chunks, size)); } });
    req.on('aborted', () => fail(uploadError('Upload interrupted')));
    req.on('error', fail);
  });
}

function imageKind(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return true;
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return true;
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

export async function saveUpload({ cwd, name, bytes, allowedRoots }) {
  name = uploadFilename(name);
  if (bytes.length > MAX_UPLOAD_BYTES) throw uploadError('File exceeds the 20 MiB limit', 413);
  const project = await realpath(resolve(cwd));
  const roots = await Promise.all(allowedRoots.map(root => realpath(resolve(root))));
  if (!roots.some(root => inside(project, root))) throw uploadError('Project is outside allowed roots', 403);
  if (!(await stat(project)).isDirectory()) throw uploadError('Project directory unavailable');
  const storage = join(project, '.codex-webui-uploads');
  await mkdir(storage, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  if (!(await lstat(storage)).isDirectory() || await realpath(storage) !== storage) throw uploadError('Upload directory must be a regular directory');
  const directory = await mkdtemp(join(storage, 'upload-'));
  const path = join(directory, name);
  try { await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
  return { name, path, size: bytes.length, kind: imageKind(bytes) ? 'image' : 'file', cwd: project };
}
