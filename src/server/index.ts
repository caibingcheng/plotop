import * as fs from 'fs';
import * as path from 'path';
import { startHttpServer } from './http-server';
import { startTcpServer } from './tcp-server';

export interface ServerConfig {
  web: boolean;
}

export interface ServerInfo {
  host: string;
  port: number;
  tcpPort: number;
}

function resolveRendererPath(): string {
  const distRenderer = path.resolve(__dirname, '..', 'renderer');
  if (fs.existsSync(path.join(distRenderer, 'index.html'))) {
    return distRenderer;
  }
  return path.resolve(__dirname, '..', '..', 'src', 'renderer');
}

export function startServer(config: ServerConfig): Promise<ServerInfo> {
  const httpHost = config.web ? '0.0.0.0' : '127.0.0.1';
  const httpPort = 5000;
  const tcpPort = 8001;

  const rendererPath = resolveRendererPath();

  const { io } = startHttpServer(httpHost, httpPort, rendererPath);
  startTcpServer(io);

  return Promise.resolve({ host: httpHost, port: httpPort, tcpPort });
}
