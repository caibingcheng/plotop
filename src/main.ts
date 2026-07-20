import { startServer } from './server';
import * as https from 'https';
import { ipcMain } from 'electron';

interface ReleaseInfo {
  tag: string;
  version: string;
  url: string;
}

function parseVersion(version: string): number[] {
  const base = version.split('-')[0].split('+')[0];
  return base.split('.').map((part) => parseInt(part, 10));
}

function compareVersion(a: string, b: string): number {
  const partsA = parseVersion(a);
  const partsB = parseVersion(b);
  const maxLen = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < maxLen; i++) {
    const numA = partsA[i] || 0;
    const numB = partsB[i] || 0;
    if (numA !== numB) {
      return numA - numB;
    }
  }
  return 0;
}

function fetchLatestRelease(): Promise<ReleaseInfo> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      'https://api.github.com/repos/caibingcheng/plotop/releases/latest',
      {
        headers: {
          'User-Agent': 'plotop-version-check',
          Accept: 'application/vnd.github+json',
        },
        timeout: 10000,
      },
      (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${response.statusCode}`));
          return;
        }
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          data += chunk;
        });
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            const tag = String(json.tag_name || '');
            const url = String(json.html_url || '');
            const version = tag.replace(/^v/i, '');
            if (!version) {
              reject(new Error('No release tag found in GitHub response'));
              return;
            }
            resolve({ tag, version, url });
          } catch {
            reject(new Error('Failed to parse GitHub release response'));
          }
        });
      }
    );
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Request to GitHub timed out'));
    });
  });
}

function fetchLatestReleaseWithTimeout(timeoutMs: number): Promise<ReleaseInfo> {
  return Promise.race([
    fetchLatestRelease(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    }),
  ]);
}

function registerAboutIpcHandlers(version: string) {
  ipcMain.handle('about:get-version', () => version);
  ipcMain.handle('about:check-latest', async () => {
    const latest = await fetchLatestReleaseWithTimeout(10000);
    const comparison = compareVersion(version, latest.version);
    return { version: latest.version, url: latest.url, comparison };
  });
  ipcMain.handle('about:open-external', async (_, url: string) => {
    const { shell } = await import('electron');
    await shell.openExternal(url);
  });
}

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
    width: 1400,
    height: 800,
    minWidth: 1333,
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
            const aboutWindow = new BrowserWindow({
              parent: win,
              modal: true,
              width: 400,
              height: 300,
              resizable: false,
              minimizable: false,
              maximizable: false,
              show: false,
              title: 'About Plotop',
              webPreferences: {
                preload: path.join(__dirname, 'renderer', 'about-preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
              },
            });
            aboutWindow.setMenu(null);
            aboutWindow.loadURL(`http://127.0.0.1:${serverPort}/about.html`);
            aboutWindow.once('ready-to-show', () => {
              aboutWindow.show();
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
    const pkg = require('../package.json');
    registerAboutIpcHandlers(pkg.version);

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
