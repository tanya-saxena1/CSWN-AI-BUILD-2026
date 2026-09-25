const {app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu} = require('electron');
const {spawn} = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  console.error('Desktop pointer control currently supports Windows. Use npm run dev for the browser demonstration.');
  app.quit();
} else {
  let win, tray, server, bridge, bridgeReady = false, active = false, overlay = false, lastMove = 0, pausedReason = null, suppressKeyboardUntil = 0;
  const root = path.join(__dirname, '..', 'dist');
  const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.task':'application/octet-stream'};
  function localServer() {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        let name;
        try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
        catch { res.writeHead(400).end(); return; }
        const file = path.resolve(root, '.' + name);
        if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
        const actual = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(root,'index.html');
        fs.createReadStream(actual).on('error', () => res.writeHead(404).end()).pipe(res);
        res.setHeader('Content-Type', mime[path.extname(actual)] || 'application/octet-stream');
      });
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/'));
    });
  }
  function emitState() {
    if (win && !win.isDestroyed()) win.webContents.send('desktop:state', {active, overlay, ready:bridgeReady, pausedReason});
    if (tray) {
      tray.setToolTip(active?'OpenInput is controlling the pointer':overlay?'OpenInput pointer control is paused':'OpenInput');
      tray.setContextMenu(Menu.buildFromTemplate([
        {label:'Open controls',click:restore},
        {label:active?'Pause pointer control':'Resume pointer control',enabled:overlay,click:togglePause},
        {type:'separator'},
        {label:'Quit OpenInput',click:()=>app.quit()}
      ]));
    }
  }
  function send(command) { if (bridgeReady && bridge && !bridge.killed) bridge.stdin.write(JSON.stringify(command) + '\n'); }
  function restore() {
    if (!win || win.isDestroyed()) return;
    active = false;
    overlay = false;
    pausedReason = null;
    win.setIgnoreMouseEvents(false);
    win.setAlwaysOnTop(false);
    if (win.isMinimized()) win.restore();
    win.setMinimumSize(850, 630);
    win.setSize(1320, 850);
    win.center(); win.show(); win.focus();
    emitState();
  }
  function floatWindow() {
    overlay = true;
    pausedReason = null;
    const area = screen.getPrimaryDisplay().workArea;
    win.setMinimumSize(260, 165);
    win.setSize(310, 190);
    win.setPosition(area.x + area.width - 330, area.y + area.height - 210);
    win.setAlwaysOnTop(true, 'floating');
    win.setIgnoreMouseEvents(true, {forward:true});
    win.showInactive();
    emitState();
  }
  function stop() {restore();}
  function pause(reason='manual') {
    if (!overlay || !active) return;
    active=false; pausedReason=reason; emitState();
  }
  function resume() {
    if (!overlay || !bridgeReady) return;
    active=true; pausedReason=null; suppressKeyboardUntil=Date.now()+1200; emitState();
  }
  function togglePause() {if(active) pause(); else resume();}
  function startBridge() {
    bridge = spawn('powershell.exe', ['-NoLogo','-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'native-input.ps1')], {stdio:['pipe','pipe','pipe'], windowsHide:true});
    let stdout='';
    bridge.stdout.on('data', data => {
      stdout+=String(data);
      let end;
      while((end=stdout.indexOf('\n'))>=0) {
        const line=stdout.slice(0,end).trim(); stdout=stdout.slice(end+1);
        if(line==='OPENINPUT_READY') {bridgeReady=true; emitState();}
        if(line==='OPENINPUT_KEYBOARD' && active && Date.now()>suppressKeyboardUntil) pause('keyboard');
      }
    });
    bridge.stderr.on('data', data => console.error('Windows input bridge:', String(data)));
    bridge.on('exit', () => {bridgeReady=false; active=false; pausedReason='bridge'; bridge=null; emitState();});
  }
  app.whenReady().then(async () => {
    const url = await localServer();
    win = new BrowserWindow({width:1320,height:850,minWidth:850,minHeight:630,backgroundColor:'#f4f5f9',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    win.loadURL(url);
    tray = new Tray(path.join(__dirname,'tray.png'));
    tray.on('double-click',restore);
    tray.on('click',restore);
    emitState();
    startBridge();
    globalShortcut.register('Control+Shift+Space', togglePause);
    globalShortcut.register('Control+Shift+O', restore);
    globalShortcut.register('Control+Alt+O', restore);
    ipcMain.handle('desktop:start', () => { if (!bridgeReady) return {ok:false, reason:'Windows input bridge is still starting.'}; active=true; suppressKeyboardUntil=Date.now()+1200; floatWindow(); return {ok:true}; });
    ipcMain.handle('desktop:stop', () => {stop(); return {ok:true};});
    ipcMain.handle('desktop:pause', () => {pause(); return {ok:true};});
    ipcMain.handle('desktop:resume', () => {resume(); return {ok:true};});
    ipcMain.handle('desktop:restore', () => {restore(); return {ok:true};});
    ipcMain.on('desktop:move', (_e, x, y) => {
      if (!active || !bridgeReady || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const now=Date.now(); if(now-lastMove<38) return; lastMove=now;
      send({type:'move',x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))});
    });
    ipcMain.on('desktop:click', () => {if(active) send({type:'click'});});
    ipcMain.on('desktop:wheel', (_e, delta) => {if(active && Number.isFinite(delta)) send({type:'wheel',delta:Math.max(-240,Math.min(240,delta))});});
    win.on('minimize', () => {active=false; overlay=false; pausedReason=null; win.setIgnoreMouseEvents(false); emitState();});
    win.on('closed', () => {win=null; app.quit();});
  }).catch(error => {console.error(error); app.quit();});
  app.on('will-quit', () => {globalShortcut.unregisterAll(); bridge?.kill(); server?.close();});
}
