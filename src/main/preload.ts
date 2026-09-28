import { contextBridge, ipcRenderer } from 'electron';

const actions = new Set(['status','activate','setup','login','lock','patients.list','patients.get','patients.create','visits.create','dentists.list','invoices.list','invoices.create','payments.record','dashboard','finance.summary']);
contextBridge.exposeInMainWorld('dentiva', Object.freeze({
  request: (action: string, input: unknown = {}) => {
    if (!actions.has(action)) return Promise.reject(new Error('Operation unavailable.'));
    return ipcRenderer.invoke('dentiva:request', action, input);
  }
}));
