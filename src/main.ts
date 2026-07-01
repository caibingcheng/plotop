import { startServer } from './server';

const args = process.argv;
const isWeb = args.includes('--web');
const showVersion = args.includes('-v') || args.includes('--version');

if (showVersion) {
  const pkg = require('../package.json');
  console.log(`plotop ${pkg.version}`);
  process.exit(0);
}

async function createMainWindow(serverPort: number) {
  const { app, BrowserWindow, nativeImage, Menu } = await import('electron');
  const path = await import('path');
  const fs = await import('fs');

  let icon: Electron.NativeImage | undefined;
  const appPath = app.getAppPath();
  const candidates = [
    path.resolve(appPath.replace(/app\.asar$/, 'app.asar.unpacked'), 'assets', 'icon.png'),
    path.resolve(appPath, 'assets', 'icon.png'),
    path.resolve(__dirname, '..', 'assets', 'icon.png'),
    path.resolve(__dirname, '..', '..', 'assets', 'icon.png'),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) {
      continue;
    }
    try {
      const img = nativeImage.createFromPath(candidate);
      if (!img.isEmpty()) {
        icon = img;
        break;
      }
    } catch {
      // Ignore unloadable icons.
    }
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    title: 'Plotop',
    backgroundColor: '#f0f0f0',
    icon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle('Plotop');
  });

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Home',
          click: () => {
            win.webContents.executeJavaScript("window.location.href = '/'").catch(() => {
              // Ignore if navigation fails.
            });
          },
        },
        { type: 'separator' },
        {
          label: 'Export PNG',
          click: () => {
            win.webContents.executeJavaScript('exportPageAsPNG()').catch(() => {
              // Ignore if the current page does not expose exportPageAsPNG.
            });
          },
        },
        {
          label: 'Export Offline HTML',
          click: () => {
            win.webContents.executeJavaScript('exportOfflineHtml()').catch(() => {
              // Ignore if the current page does not expose exportOfflineHtml.
            });
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload', label: 'Reload' },
        { role: 'toggleDevTools', label: 'Toggle DevTools' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click: () => {
            const pkg = require('../package.json');
            win.webContents.executeJavaScript(`alert('plotop ${pkg.version}')`).catch(() => {
              // Ignore errors on pages that block alerts.
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  await win.loadURL(`http://127.0.0.1:${serverPort}`);
  return win;
}

async function main() {
  const serverInfo = await startServer({ web: isWeb });
  console.log(`Web server available at http://${serverInfo.host}:${serverInfo.port}`);
  console.log(`TCP collector available at ${serverInfo.host}:${serverInfo.tcpPort}`);

  if (!isWeb) {
    const { app, BrowserWindow } = await import('electron');

    app.setName('Plotop');

    await app.whenReady();
    await createMainWindow(serverInfo.port);

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow(serverInfo.port);
      }
    });
  }
}

main().catch((err) => {
  console.error('Failed to start plotop:', err);
  process.exit(1);
});
