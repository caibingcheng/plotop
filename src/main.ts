import { startServer } from './server';

const args = process.argv;
const isWeb = args.includes('--web');
const showVersion = args.includes('-v') || args.includes('--version');

if (showVersion) {
  const pkg = require('../package.json');
  console.log(`plotop ${pkg.version}`);
  process.exit(0);
}

async function main() {
  const serverInfo = await startServer({ web: isWeb });
  console.log(`Web server available at http://${serverInfo.host}:${serverInfo.port}`);
  console.log(`TCP collector available at ${serverInfo.host}:${serverInfo.tcpPort}`);

  if (!isWeb) {
    const { app, BrowserWindow, nativeImage } = await import('electron');
    const path = await import('path');
    const fs = await import('fs');

    app.setName('Plotop');

    let iconPath: string | undefined;
    const candidates = [
      path.resolve(__dirname, '..', 'assets', 'icon.png'),
      path.resolve(__dirname, '..', '..', 'assets', 'icon.png'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        iconPath = candidate;
        break;
      }
    }

    await app.whenReady();

    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      title: 'Plotop',
      icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.on('page-title-updated', (event) => {
      event.preventDefault();
      win.setTitle('Plotop');
    });

    win.loadURL(`http://127.0.0.1:${serverInfo.port}`);

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        const newWin = new BrowserWindow({
          width: 1280,
          height: 800,
          title: 'Plotop',
          icon: iconPath ? nativeImage.createFromPath(iconPath) : undefined,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        });

        newWin.on('page-title-updated', (event) => {
          event.preventDefault();
          newWin.setTitle('Plotop');
        });

        await newWin.loadURL(`http://127.0.0.1:${serverInfo.port}`);
      }
    });
  }
}

main().catch((err) => {
  console.error('Failed to start plotop:', err);
  process.exit(1);
});
