export interface ClientState {
  subscribed: { count: number; lastTime: Date };
  alive: boolean;
  data: string[];
  dataSequence: number;
  outbound: AsyncMessageQueue;
  lastSeen: Date;
  filterPids: number[];
  socket: any;
  hasProcessList: boolean;
  lastProcessList: any;
}

export const clients = new Map<string, ClientState>();

export class AsyncMessageQueue {
  private items: (string | null)[] = [];
  private resolvers: Array<(value: string | null) => void> = [];

  put(message: string | null) {
    if (this.resolvers.length > 0) {
      const resolve = this.resolvers.shift()!;
      resolve(message);
    } else {
      this.items.push(message);
    }
  }

  async get(timeoutMs: number): Promise<string | null> {
    if (this.items.length > 0) {
      return this.items.shift()!;
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.resolvers.indexOf(resolve);
        if (idx > -1) this.resolvers.splice(idx, 1);
        resolve(undefined as any);
      }, timeoutMs);
      this.resolvers.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }
}

export function getOrCreateClient(ip: string): ClientState {
  let client = clients.get(ip);
  if (!client) {
    client = {
      subscribed: { count: 10, lastTime: new Date(0) },
      alive: false,
      data: [],
      dataSequence: 0,
      outbound: new AsyncMessageQueue(),
      lastSeen: new Date(),
      filterPids: [],
      socket: null,
      hasProcessList: false,
      lastProcessList: {},
    };
    clients.set(ip, client);
  }
  return client;
}
