import express, { Express, Request, Response } from 'express';
import * as http from 'http';
import * as path from 'path';
import { Server as SocketIoServer } from 'socket.io';
import { clients } from './store';

export interface HttpServerInfo {
  httpServer: http.Server;
  io: SocketIoServer;
  app: Express;
  actualPort: number;
}

export async function startHttpServer(host: string, preferredPort: number, rendererPath: string): Promise<HttpServerInfo> {
  const app = express();
  const httpServer = http.createServer(app);
  const io = new SocketIoServer(httpServer, {
    cors: { origin: '*' },
    pingInterval: 1000,
    pingTimeout: 5000,
  });

  app.use(express.static(rendererPath));

  app.get('/', (req: Request, res: Response) => {
    res.sendFile(path.join(rendererPath, 'index.html'));
  });

  app.get('/plot', (req: Request, res: Response) => {
    res.sendFile(path.join(rendererPath, 'plot.html'));
  });

  const actualPort = await listenOnAvailablePort(httpServer, host, preferredPort);

  console.log(`Web server starting on http://${host}:${actualPort}`);

  io.on('connection', (socket) => {
    for (const [ip, client] of clients.entries()) {
      socket.emit('new_ip', { ip, alive: client.alive });
    }

    socket.on('config:get_tcp_port', () => {
      const tcpServerManager = (global as any).__tcpServerManager;
      const port = tcpServerManager ? tcpServerManager.getPort() : 8001;
      socket.emit('config:tcp_port', port);
    });

    socket.on('config:set_tcp_port', (message) => {
      const requested = message?.port;
      if (!requested || typeof requested !== 'number') return;
      const tcpServerManager = (global as any).__tcpServerManager;
      if (!tcpServerManager) return;
      tcpServerManager.changePort(requested);
    });

    socket.on('subscribe', (message) => {
      const ip = message?.ip;
      if (!ip) return;
      const client = clients.get(ip);
      if (!client) return;
      client.subscribed = { count: 10, lastTime: new Date() };
      if (client.hasProcessList && client.lastProcessList) {
        socket.emit(`process_list/${ip}`, client.lastProcessList);
      } else {
        requestProcessListFromClient(ip);
      }
    });

    socket.on('request_process_list', (message) => {
      const ip = message?.ip;
      if (!ip) return;
      requestProcessListFromClient(ip);
    });

    socket.on('apply_filter', (message) => {
      const ip = message?.ip;
      const pids = message?.pids || [];
      if (!ip) return;
      const client = clients.get(ip);
      if (!client) return;
      client.filterPids = pids;
      client.outbound.put(JSON.stringify({ type: 'filter', patterns: [], pids }) + '\n');
      console.log(`Sent filter to ${ip}: ${pids}`);
    });

    socket.on('clear_data', (message) => {
      const ip = message?.ip;
      if (!ip) return;
      const client = clients.get(ip);
      if (!client) return;
      client.data = [];
      client.subscribed = { count: 10, lastTime: new Date() };
      io.emit(`clear/${ip}`, {});
      console.log(`Cleared data for ${ip}`);
    });
  });

  return { httpServer, io, app, actualPort };
}

function listenOnAvailablePort(
  server: http.Server,
  host: string,
  preferredPort: number,
  maxAttempts: number = 100
): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = preferredPort;
    let attempts = 0;

    function tryListen() {
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve(port);
      });

      function onError(err: any) {
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
          attempts++;
          port++;
          tryListen();
        } else {
          reject(err);
        }
      }
    }

    tryListen();
  });
}

function requestProcessListFromClient(ip: string) {
  const client = clients.get(ip);
  if (!client) return;
  client.outbound.put(JSON.stringify({ type: 'request_process_list' }) + '\n');
  console.log(`Requested process list from ${ip}`);
}
