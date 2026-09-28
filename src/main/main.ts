import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { mkdirSync, appendFileSync } from 'node:fs';
import { ClinicService, AppError } from './service';

let window: BrowserWindow | undefined;
let service: ClinicService | undefined;
const allowed = new Set(['status','activate','setup','login','lock','patients.list','patients.get','patients.create','visits.create','dentists.list','invoices.list','invoices.create','payments.record','dashboard','finance.summary']);
function logError(error: unknown): void {
  const directory=join(app.getPath('userData'),'logs'); mkdirSync(directory,{recursive:true});
  // Never log user input, passwords, activation codes, or patient content.
  appendFileSync(join(directory,'errors.log'),`${new Date().toISOString()} ${error instanceof Error ? error.name : 'Unknown error'}\n`);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(() => {
    const directory=app.getPath('userData'); mkdirSync(directory,{recursive:true});
    try { service=new ClinicService(join(directory,'dentiva.db')); }
    catch(error) { logError(error); throw error; }
    ipcMain.handle('dentiva:request', (event, action: unknown, payload: unknown) => {
      if (!service || !window || event.sender !== window.webContents || typeof action !== 'string' || !allowed.has(action)) throw new AppError('Operation unavailable.');
      try { return service.request(event.sender.id,action,payload); }
      catch (error) { if (!(error instanceof AppError)) logError(error); throw error instanceof AppError ? error : new AppError('Unable to complete the operation. Check the application log or contact support.'); }
    });
    window=new BrowserWindow({ width:1440,height:900,minWidth:960,minHeight:650,title:'Dentiva Pro',icon:join(__dirname,'../assets/icon.png'),backgroundColor:'#F5F8F8',show:false,
      webPreferences:{ preload:join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, sandbox:true, webSecurity:true, devTools:!app.isPackaged } });
    window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    window.webContents.on('will-navigate',event=>event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    window.webContents.on('render-process-gone',()=>{ if(window && !window.isDestroyed()) { service?.request(window.webContents.id,'lock',{}); window.reload(); } });
    window.once('ready-to-show',()=>window?.show());
    window.on('closed',()=>{window=undefined;});
    if (app.isPackaged) window.loadFile(join(__dirname,'../web/index.html'));
    else window.loadURL('http://localhost:5173');
  }).catch(logError);
  app.on('window-all-closed',()=>app.quit());
  app.on('before-quit',()=>{service?.close(); service=undefined;});
}
