import type { ClientEvent, ServerEvent } from './types';

export interface TransportHandlers {
  /** 开始一次连接尝试（首次或重连）。 */
  onConnecting(): void;
  onOpen(): void;
  onEvent(event: ServerEvent): void;
  onClose(): void;
}

/**
 * 访客侧 WebSocket 连接：负责建连、事件解析和指数退避重连。
 * 不含业务状态，收到的事件原样交给上层处理。
 */
export class VisitorTransport {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private disposed = false;

  constructor(
    private readonly wsUrl: string,
    private readonly handlers: TransportHandlers
  ) {}

  connect(): void {
    if (this.disposed) return;
    const current = this.socket;
    if (
      current &&
      (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.clearReconnect();
    this.handlers.onConnecting();

    let socket: WebSocket;
    try {
      socket = new WebSocket(this.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket !== socket) return;
      this.attempt = 0;
      this.handlers.onOpen();
    });

    socket.addEventListener('message', (event) => {
      if (this.socket !== socket) return;
      let raw: unknown;
      try {
        raw = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!raw || typeof raw !== 'object') return;

      const record = raw as Record<string, unknown>;
      this.handlers.onEvent({
        ...record,
        type: String(record.type || ''),
        errorMessage: typeof record.message === 'string' ? record.message : undefined,
      });
    });

    socket.addEventListener('close', () => {
      if (this.socket !== socket || this.disposed) return;
      this.handlers.onClose();
      this.scheduleReconnect();
    });

    socket.addEventListener('error', () => {
      try {
        socket.close();
      } catch {
        // 连接已经不可用，忽略。
      }
    });
  }

  send(payload: ClientEvent): boolean {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  destroy(): void {
    this.disposed = true;
    this.clearReconnect();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'Widget destroyed');
      } catch {
        // 已经关闭的连接直接忽略。
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed) return;
    this.clearReconnect();
    this.attempt += 1;
    const delay = Math.min(1000 * Math.pow(1.6, this.attempt - 1), 12_000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
