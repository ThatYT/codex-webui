export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export function attachmentInput(text, attachments) {
  const files = attachments.filter(file => file.kind !== 'image');
  const references = files.length ? '\n\nAttached files (available on the server; read them as needed):\n' + files.map(file => `${JSON.stringify(file.name)}: ${JSON.stringify(file.path)}`).join('\n') : '';
  const prompt = text || 'Please examine the attached files.';
  return [
    { type: 'text', text: prompt + references },
    ...attachments.filter(file => file.kind === 'image').map(file => ({ type: 'localImage', path: file.path })),
  ];
}

export function uploadFile(file, cwd, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?${new URLSearchParams({ name: file.name, cwd })}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.timeout = 300000;
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, { once: true });
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => {
      let data;
      try { data = JSON.parse(xhr.responseText); } catch { reject(new Error('Upload returned an invalid response')); return; }
      if (xhr.status < 200 || xhr.status >= 300) reject(new Error(data.error || 'Upload failed'));
      else resolve(data);
    };
    xhr.onerror = () => reject(new Error('Upload connection failed. Check your SSH tunnel and retry.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Retry with a smaller file.'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    if (signal.aborted) { reject(new Error('Upload cancelled')); return; }
    xhr.send(file);
  });
}
