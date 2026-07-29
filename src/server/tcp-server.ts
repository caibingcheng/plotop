import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { Server as SocketIoServer } from 'socket.io';
import { clients, getOrCreateClient, ClientState, AsyncMessageQueue, VersionStatus } from './store';
import { resolveSelectionPids, arraysEqual, isSelectionLive } from './process-selection';
import { SERVER_PROTOCOL_VERSION, MIN_CLIENT_PROTOCOL_VERSION, compareVersions, getCachedRelease, getLatestRelease } from './release';

function isIgnorableSocketError(err: any): boolean {
  return err && (err.code === 'EPIPE' || err.code === 'ECONNRESET');
}

const DEFAULT_TCP_PORT = 28081;
const TCP_HOST = '0.0.0.0';

export interface TcpServerManager {
  getPort(): number;
  changePort(port: number): void;
}

export function startTcpServer(io: SocketIoServer, preferredPort: number = DEFAULT_TCP_PORT): TcpServerManager {
  let server: net.Server | null = null;
  let currentPort = preferredPort;

  function createServer(): net.Server {
    const newServer = net.createServer((clientSocket) => {
      const addr = clientSocket.address() as net.AddressInfo;
      const clientIp = extractIp(clientSocket);

      clientSocket.setTimeout(90000);

      const client = getOrCreateClient(clientIp);
      cleanupOldConnection(client);

      client.socket = clientSocket;
      client.outbound = new AsyncMessageQueue();
      client.lastSeen = new Date();
      setClientAlive(clientIp, true, io);
      emitClientInfo(clientIp, io);
      client.hasProcessList = false;
      client.lastProcessList = {};
      client.dataSequence = (client.dataSequence || 0) + 1;
      client.data = [];


      if (client.filterSelections && client.filterSelections.length > 0) {
        client.filterPids = resolveSelectionPids(client.filterSelections, client.lastProcessList);
        client.outbound.put(JSON.stringify({ type: 'filter', patterns: [], pids: client.filterPids }) + '\n');
        console.log(`Re-sent filter to ${clientIp}: ${client.filterPids}`);
      }

      io.emit(`clear/${clientIp}`, {});

      const timestamp = new Date().toISOString().replace(/[:T]/g, '-').split('.')[0];
      const filename = path.join('log', `plotop_${timestamp}_${clientIp}.txt`);

      const readerPromise = clientReader(clientSocket, clientIp, filename, io, client.outbound);
      const writerPromise = clientWriter(clientSocket, clientIp, io);

      Promise.all([readerPromise, writerPromise]).then(() => {
        client.alive = false;
        safeClose(clientSocket);
      }).catch((err) => {
        console.error(`Client handler error for ${clientIp}:`, err);
        client.alive = false;
        safeClose(clientSocket);
      });
    });

    return newServer;
  }

  function listen(port: number): void {
    server = createServer();
    server.listen(port, TCP_HOST, () => {
      currentPort = port;
      console.log(`Raw socket server listening on ${TCP_HOST}:${port}`);
      io.emit('config:tcp_port', port);
    });

    server.on('error', (err: any) => {
      server?.removeAllListeners('error');
      if (err.code === 'EADDRINUSE') {
        const nextPort = port + 1;
        console.warn(`Port ${port} in use, trying ${nextPort}`);
        listen(nextPort);
      } else {
        console.error(`Raw socket server error on port ${port}:`, err);
      }
    });
  }

  function close(): Promise<void> {
    return new Promise((resolve) => {
      if (!server) {
        resolve();
        return;
      }

      for (const [, client] of clients) {
        client.alive = false;
        client.outbound.put(null);
        if (client.socket) {
          safeClose(client.socket);
        }
      }

      server.close(() => {
        server = null;
        resolve();
      });
    });
  }

  listen(preferredPort);

  return {
    getPort: () => currentPort,
    changePort: (port: number) => {
      if (port === currentPort) return;
      close().then(() => {
        console.log(`TCP port changed from ${currentPort} to ${port}`);
        listen(port);
      }).catch((err) => {
        console.error('Failed to change TCP port:', err);
      });
    },
  };
}

function extractIp(socket: net.Socket): string {
  const raw = socket.remoteAddress || 'unknown';
  if (raw.startsWith('::ffff:')) {
    return raw.slice(7);
  }
  return raw;
}

function cleanupOldConnection(client: ClientState) {
  const oldSocket = client.socket;
  if (oldSocket) {
    safeClose(oldSocket);
  }
  client.outbound.put(null);
  drainQueue(client.outbound);
}

async function drainQueue(queue: any) {
  while (true) {
    const msg = await queue.get(0);
    if (msg === undefined || msg === null) break;
  }
}

function safeClose(socket: net.Socket) {
  try {
    socket.destroy();
  } catch (e) {
    // ignore
  }
}

function computeVersionStatus(client: ClientState): void {
  if (!client.protocolVersion) {
    client.versionStatus = 'unknown';
    return;
  }

  if (client.protocolVersion < MIN_CLIENT_PROTOCOL_VERSION) {
    client.versionStatus = 'break-change';
    return;
  }

  if (client.protocolVersion > SERVER_PROTOCOL_VERSION) {
    client.versionStatus = 'newer-than-server';
    return;
  }

  client.versionStatus = 'compatible';

  const release = getCachedRelease();
  if (release && client.clientVersion) {
    const cmp = compareVersions(client.clientVersion, release.version);
    if (cmp < 0) {
      client.versionStatus = 'outdated';
    }
  }
}

function refreshVersionStatus(client: ClientState, ip: string, io: SocketIoServer): void {
  getLatestRelease().then((latest) => {
    if (latest && client.clientVersion) {
      const cmp = compareVersions(client.clientVersion, latest.version);
      if (cmp < 0) {
        client.versionStatus = 'outdated';
      } else if (cmp >= 0 && client.versionStatus === 'outdated') {
        client.versionStatus = 'compatible';
      }
      emitClientInfo(ip, io);
    }
  }).catch(() => {});
}

function emitClientInfo(ip: string, io: SocketIoServer): void {
  const client = clients.get(ip);
  if (!client) return;
  emitClientInfoForIp(client, ip, io);
}

function emitClientInfoForIp(client: ClientState, ip: string, io: SocketIoServer): void {
  const info: any = {
    ip,
    alive: client.alive,
    clientVersion: client.clientVersion || null,
    protocolVersion: client.protocolVersion || null,
    arch: client.arch || null,
    versionStatus: client.versionStatus || 'unknown',
  };
  const release = getCachedRelease();
  if (release) {
    info.latestVersion = release.version;
    info.latestReleaseUrl = release.url;
  }
  io.emit('client_info', info);
}

function setClientAlive(ip: string, alive: boolean, io: SocketIoServer) {
  const client = clients.get(ip);
  if (client) {
    client.alive = alive;
    io.emit('new_ip', { ip, alive });
  }
}

function reapplyFilterIfChanged(ip: string, client: ClientState) {
  if (!client.filterSelections || client.filterSelections.length === 0) return;
  const newPids = resolveSelectionPids(client.filterSelections, client.lastProcessList);
  const oldPids = client.filterPids || [];
  if (arraysEqual(newPids, oldPids)) return;
  client.filterPids = newPids;
  client.outbound.put(JSON.stringify({ type: 'filter', patterns: [], pids: newPids }) + '\n');
  console.log(`Re-sent filter to ${ip}: ${newPids}`);
}

async function clientReader(
  clientSocket: net.Socket,
  ip: string,
  filename: string,
  io: SocketIoServer,
  outbound: AsyncMessageQueue
) {
  let buffer = Buffer.alloc(0);
  let dataIndex = 0;

  try {
    while (true) {
      const chunk = await readChunk(clientSocket);
      if (!chunk || chunk.length === 0) {
        console.log(`Client ${ip} disconnected`);
        break;
      }
      buffer = Buffer.concat([buffer, chunk]);

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        dataIndex += 1;
        if (line.length === 0) continue;

        let data: any;
        try {
          data = JSON.parse(line.toString('utf-8'));
        } catch (e) {
          console.warn(`Invalid JSON from ${ip}: ${line.toString()}`);
          continue;
        }

        if (!data.type) {
          console.warn(`Message without type from ${ip}:`, data);
          continue;
        }

        const client = clients.get(ip);
        if (!client) continue;
        client.lastSeen = new Date();

        switch (data.type) {
          case 'stats':
            handleStatsMessage(ip, data, filename, dataIndex, io);
            break;
          case 'heartbeat':
            break;
          case 'process_list':
            client.hasProcessList = true;
            client.lastProcessList = data;
            io.emit(`process_list/${ip}`, data);
            reapplyFilterIfChanged(ip, client);
            break;
          case 'filter_ack':
            io.emit(`filter_status/${ip}`, {
              matched_count: data.matched_count || 0,
              requested_count: client.filterSelections.length,
              live_count: client.filterSelections.filter((s) => isSelectionLive(s, client.lastProcessList)).length,
            });
            break;
          case 'hello':
            client.clientVersion = String(data.version || '');
            client.protocolVersion = parseInt(data.protocol_version, 10) || 0;
            client.arch = String(data.arch || '');
            computeVersionStatus(client);
            emitClientInfo(ip, io);
            refreshVersionStatus(client, ip, io);
            break;
          default:
            console.warn(`Unknown message type from ${ip}: ${data.type}`);
        }
      }
    }
  } catch (e) {
    console.error(`Reader error for ${ip}:`, e);
  } finally {
    setClientAlive(ip, false, io);
    outbound.put(null);
    safeClose(clientSocket);
  }
}

function readChunk(socket: net.Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onData = (chunk: Buffer) => {
      cleanup();
      resolve(chunk);
    };
    const onEnd = () => {
      cleanup();
      resolve(Buffer.alloc(0));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onTimeout = () => {
      cleanup();
      resolve(Buffer.alloc(0));
    };

    const cleanup = () => {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };

    socket.once('data', onData);
    socket.once('end', onEnd);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });
}

function handleStatsMessage(
  ip: string,
  data: any,
  filename: string,
  dataIndex: number,
  io: SocketIoServer
) {
  const jsonStr = JSON.stringify(data) + '\n';
  const client = clients.get(ip);
  if (!client) return;

  client.data.push(jsonStr);
  if (client.data.length > 1000) {
    client.data = client.data.slice(-1000);
  }
  console.log(`Received stats from ${ip}: ${dataIndex}`);

  writeDataToFile(filename, jsonStr);

  try {
    io.emit('new_ip', { ip, alive: true });
    const { count, lastTime } = client.subscribed;
    if (count > 0 && lastTime && Date.now() - lastTime.getTime() < 180000) {
      client.subscribed.count = count - 1;
      io.emit(`new_data/${ip}`, {
        data: jsonStr,
        sequence: client.dataSequence,
        index: dataIndex,
      });
    }
  } catch (e) {
    console.error('WebSocket emit error:', e);
  }
}

function writeDataToFile(filename: string, data: string) {
  if (!fs.existsSync('log')) {
    fs.mkdirSync('log', { recursive: true });
  }
  fs.appendFileSync(filename, data);
}

async function clientWriter(clientSocket: net.Socket, ip: string, io: SocketIoServer) {
  const heartbeatInterval = 30000;
  let nextHeartbeat = Date.now() + heartbeatInterval;

  try {
    while (true) {
      const client = clients.get(ip);
      if (!client || !client.alive) break;

      const timeout = Math.max(100, Math.min(1000, nextHeartbeat - Date.now()));
      const message = await client.outbound.get(timeout);

      if (message === null) {
        break;
      }
      if (message !== undefined) {
        await writeToSocket(clientSocket, message);
        continue;
      }

      if (Date.now() >= nextHeartbeat) {
        const heartbeat = JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now(),
        }) + '\n';
        await writeToSocket(clientSocket, heartbeat);
        nextHeartbeat = Date.now() + heartbeatInterval;
      }
    }
  } catch (e) {
    console.error(`Writer error for ${ip}:`, e);
  } finally {
    setClientAlive(ip, false, io);
    safeClose(clientSocket);
  }
}

function writeToSocket(socket: net.Socket, data: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.destroyed || (socket as any).writableEnded) {
      return resolve();
    }
    socket.write(data, 'utf-8', (err) => {
      if (err) {
        if (isIgnorableSocketError(err)) {
          resolve();
        } else {
          reject(err);
        }
      } else {
        resolve();
      }
    });
  });
}
