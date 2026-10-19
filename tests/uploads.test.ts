import { describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { MAX_UPLOAD_BYTES, readUploadBody, saveUpload, uploadFilename } from '../upload-service.js';
import { attachmentInput } from '../public/attachments.js';

describe('browser attachments', () => {
  test('duplicate names preserve contents, paths stay in the project, and permissions are private', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'webui-upload-'));
    try {
      const first = await saveUpload({ cwd, name: 'notes 中文.txt', bytes: Buffer.from('first'), allowedRoots: [cwd] });
      const second = await saveUpload({ cwd, name: 'notes 中文.txt', bytes: Buffer.from('second'), allowedRoots: [cwd] });
      expect(first.path).not.toBe(second.path);
      expect(await readFile(first.path, 'utf8')).toBe('first');
      expect(await readFile(second.path, 'utf8')).toBe('second');
      expect((await stat(first.path)).mode & 0o777).toBe(0o600);
      expect(first.kind).toBe('file');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
  test('rejects traversal, outside projects, symlink storage, and oversized content', async () => {
    for (const name of ['../escape', 'a/b', 'a\\b', '..', '.', '', 'a\0b']) expect(() => uploadFilename(name)).toThrow();
    const cwd = await mkdtemp(join(tmpdir(), 'webui-upload-'));
    const elsewhere = await mkdtemp(join(tmpdir(), 'webui-outside-'));
    try {
      await expect(saveUpload({ cwd: elsewhere, name: 'a', bytes: Buffer.from('x'), allowedRoots: [cwd] })).rejects.toThrow('outside');
      await symlink(elsewhere, join(cwd, '.codex-webui-uploads'));
      await expect(saveUpload({ cwd, name: 'a', bytes: Buffer.from('x'), allowedRoots: [cwd] })).rejects.toThrow('regular directory');
      await expect(saveUpload({ cwd, name: 'a', bytes: Buffer.alloc(MAX_UPLOAD_BYTES + 1), allowedRoots: [cwd] })).rejects.toThrow('20 MiB');
    } finally { await rm(cwd, { recursive: true, force: true }); await rm(elsewhere, { recursive: true, force: true }); }
  });
  test('limits chunked bodies and rejects interrupted uploads', async () => {
    const request = new PassThrough(); request.headers = {};
    const body = readUploadBody(request, 4);
    request.write(Buffer.from('123')); request.end(Buffer.from('45'));
    await expect(body).rejects.toMatchObject({ status: 413 });
    const interrupted = new PassThrough(); interrupted.headers = {};
    const partial = readUploadBody(interrupted);
    interrupted.write(Buffer.from('partial')); interrupted.emit('aborted');
    await expect(partial).rejects.toThrow('interrupted');
    const declared = new PassThrough(); declared.headers = { 'content-length': MAX_UPLOAD_BYTES + 1 };
    await expect(readUploadBody(declared)).rejects.toMatchObject({ status: 413 });
    declared.end();
  });
  test('image inputs and ordinary file references use the uploaded server paths', () => {
    const input = attachmentInput('Read these', [
      { name: 'notes.txt', kind: 'file', path: '/project/.codex-webui-uploads/upload-a/notes.txt' },
      { name: 'picture.png', kind: 'image', path: '/project/.codex-webui-uploads/upload-b/picture.png' },
    ]);
    expect(input[0].text).toContain('Read these');
    expect(input[0].text).toContain('upload-a/notes.txt');
    expect(input[1]).toEqual({ type: 'localImage', path: '/project/.codex-webui-uploads/upload-b/picture.png' });
    expect(attachmentInput('', [])[0].text).toContain('examine');
    expect(attachmentInput('hello', [])).toEqual([{ type: 'text', text: 'hello' }]);
  });
  test('image classification uses bytes instead of the untrusted browser MIME type or filename', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'webui-upload-'));
    try {
      const fake = await saveUpload({ cwd, name: 'fake.png', bytes: Buffer.from('not an image'), allowedRoots: [cwd] });
      const image = await saveUpload({ cwd, name: 'image.bin', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64'), allowedRoots: [cwd] });
      expect(fake.kind).toBe('file'); expect(image.kind).toBe('image');
    } finally { await rm(cwd, { recursive: true, force: true }); }
  });
});
