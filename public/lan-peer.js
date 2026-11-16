/* Small Peer-compatible transport for the local Wi-Fi relay (no cloud signaling). */
(() => {
  class Events {
    constructor() { this.listeners = {}; }
    on(type, listener) { (this.listeners[type] ||= []).push(listener); return this; }
    emit(type, value) { for (const fn of [...(this.listeners[type] || [])]) fn(value); }
    removeAllListeners() { this.listeners = {}; }
  }
  const randomId = prefix => prefix + (globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  class Connection extends Events {
    constructor(owner, remoteId, connectionId) {
      super();
      this.owner = owner;
      this.peer = remoteId;
      this.connectionId = connectionId;
      this.open = false;
    }
    send(data) {
      if (this.open) this.owner.send({type: 'data', target: this.peer, connectionId: this.connectionId, data});
    }
    close() {
      this.owner.send({type: 'close', target: this.peer, connectionId: this.connectionId});
      this.closed();
    }
    closed() {
      this.open = false;
      delete this.owner.connections[this.connectionId];
      this.emit('close');
    }
  }
  class LanPeer extends Events {
    constructor(id, options = {}) {
      super();
      this.id = id || randomId('player-');
      this.open = false;
      this.destroyed = false;
      this.connections = {};
      const endpoint = new URL(options.server);
      endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
      endpoint.pathname = '/lan';
      endpoint.search = '';
      endpoint.hash = '';
      this.socket = new WebSocket(endpoint.href);
      this.socket.addEventListener('open', () => this.send({type: 'register', id: this.id}));
      this.socket.addEventListener('message', event => {
        let message;
        try { message = JSON.parse(event.data); } catch (_) { return; }
        if (message.type === 'registered') {
          this.open = true;
          this.emit('open', this.id);
        } else if (message.type === 'connection') {
          const connection = new Connection(this, message.peer, message.connectionId);
          connection.open = true;
          this.connections[message.connectionId] = connection;
          this.emit('connection', connection);
          connection.emit('open');
        } else if (message.type === 'connected') {
          const connection = this.connections[message.connectionId];
          if (connection) { connection.open = true; connection.emit('open'); }
        } else if (message.type === 'data') {
          this.connections[message.connectionId]?.emit('data', message.data);
        } else if (message.type === 'close') {
          this.connections[message.connectionId]?.closed();
        } else if (message.type === 'error') {
          const error = {type: message.errorType || 'network', message: message.message || 'Ошибка сети'};
          const connection = this.connections[message.connectionId];
          if (connection) connection.emit('error', error);
          this.emit('error', error);
        }
      });
      this.socket.addEventListener('error', () => this.emit('error', {type: 'network', message: 'Сервер недоступен. Интернет-сервер мог уснуть - подождите минуту и попробуйте снова.'}));
      this.socket.addEventListener('close', () => {
        const wasOpen = this.open;
        this.open = false;
        Object.values(this.connections).forEach(connection => connection.closed());
        if (!this.destroyed && wasOpen) this.emit('error', {type: 'disconnected', message: 'Соединение с сервером потеряно'});
      });
    }
    send(message) {
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
    }
    connect(remoteId) {
      const connection = new Connection(this, remoteId, randomId('connection-'));
      this.connections[connection.connectionId] = connection;
      this.send({type: 'connect', target: remoteId, connectionId: connection.connectionId});
      return connection;
    }
    destroy() {
      this.destroyed = true;
      this.open = false;
      this.socket.close();
    }
  }
  window.LanPeer = LanPeer;
})();
