import * as fs from 'fs';
import * as path from 'path';
import { startHttpServer } from './http-server';
import { startTcpServer } from './tcp-server';

export interface ServerConfig {
  web: boolean;
  preferredHttpPort?: number;
  preferredTcpPort?: number;
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

export async function startServer(config: ServerConfig): Promise<ServerInfo> {
  const httpHost = config.web ? '0.0.0.0' : '127.0.0.1';
  const httpPort = config.preferredHttpPort ?? 28080;
  const tcpPort = config.preferredTcpPort ?? 28081;

  const rendererPath = resolveRendererPath();

  const { io, actualPort } = await startHttpServer(httpHost, httpPort, rendererPath);
  const tcpServerManager = startTcpServer(io, tcpPort);
  (global as any).__tcpServerManager = tcpServerManager;

  return { host: httpHost, port: actualPort, tcpPort: tcpServerManager.getPort() };
}
