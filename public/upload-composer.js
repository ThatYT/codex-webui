import { MAX_ATTACHMENTS, MAX_UPLOAD_BYTES, uploadFile } from './attachments.js';

export function createUploadComposer({ currentCwd, onChange, onError }) {
  const input = document.querySelector('#attachmentInput');
  const tray = document.querySelector('#attachmentTray');
  const button = document.querySelector('[data-composer-control="add"]');
  let attachments = [];
  let queue = Promise.resolve();

  function render() {
    tray.replaceChildren();
    tray.hidden = !attachments.length;
    for (const item of attachments) {
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      chip.dataset.status = item.status;
      const label = document.createElement('span');
      label.textContent = item.name;
      label.title = item.name;
      const status = document.createElement('span');
      status.className = 'attachment-status';
      status.textContent = item.status === 'uploading' ? `Uploading ${item.progress}%` : item.status === 'error' ? item.error : `${Math.ceil(item.size / 1024)} KB`;
      chip.append(label, status);
      if (item.status === 'error') {
        const retry = document.createElement('button');
        retry.type = 'button'; retry.textContent = 'Retry';
        retry.onclick = () => run(item);
        chip.append(retry);
      }
      const remove = document.createElement('button');
      remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${item.name}`);
      remove.onclick = () => { item.controller?.abort(); attachments = attachments.filter(other => other !== item); render(); };
      chip.append(remove);
      tray.append(chip);
    }
    onChange();
  }

  async function run(item) {
    item.controller = new AbortController();
    item.status = 'uploading'; item.progress = 0;
    render();
    try {
      const result = await uploadFile(item.file, item.cwd, progress => { item.progress = progress; if (attachments.includes(item)) render(); }, item.controller.signal);
      Object.assign(item, result, { status: 'ready' });
    } catch (error) { item.status = 'error'; item.error = error.message; }
    if (attachments.includes(item)) render();
  }

  button.title = 'Attach files'; button.setAttribute('aria-label', 'Attach files');
  button.onclick = () => input.click();
  input.onchange = async () => {
    const files = [...input.files];
    input.value = '';
    if (attachments.length + files.length > MAX_ATTACHMENTS) { onError('Attach up to 10 files per message.'); return; }
    if (files.some(file => file.size > MAX_UPLOAD_BYTES)) { onError('Each file must be 20 MiB or smaller.'); return; }
    const cwd = currentCwd();
    const added = files.map(file => ({ file, name: file.name, size: file.size, status: 'uploading', progress: 0, cwd }));
    attachments.push(...added);
    render();
    for (const item of added) queue = queue.then(() => attachments.includes(item) && run(item));
    await queue;
  };

  return {
    get items() { return attachments; },
    get pending() { return attachments.some(item => item.status !== 'ready'); },
    take() { const result = attachments; attachments = []; render(); return result; },
    restore(items) { attachments = [...items, ...attachments]; render(); },
    clear() { for (const item of attachments) item.controller?.abort(); attachments = []; render(); },
  };
}
