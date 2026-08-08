/**
 * p2p.js — WebRTC P2P 直连 + MQTT 自动信令
 *
 * 内置极简 MQTT 客户端（~100 行），不需要任何外部库。
 * 信令通过免费 MQTT broker 自动完成，你只需把 4 位房间号发给朋友。
 *
 * 流程：
 *   房主 → 创建房间(得房间号) → 等客机加入 → DataChannel 直连
 *   客机 → 输入房间号 → 自动连上 → DataChannel 直连
 */

// ============================================================
//  极简 MQTT 3.1.1 客户端（WebSocket）
// ============================================================

class MiniMqtt {
  constructor(url, clientId) {
    this.url = url;
    this.clientId = clientId;
    this.ws = null;
    this.handlers = {};       // 'connect' | 'message' | 'error' | 'close'
    this.packetId = 1;
    this.connected = false;
  }

  on(event, fn) { this.handlers[event] = fn; }

  connect() {
    this.ws = new WebSocket(this.url, 'mqtt');
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      // 发送 MQTT CONNECT 包
      this._sendConnect();
    };

    this.ws.onmessage = (e) => {
      const data = new Uint8Array(e.data);
      this._handlePacket(data);
    };

    this.ws.onerror = () => {
      if (this.handlers.error) this.handlers.error(new Error('WebSocket 连接失败'));
    };

    this.ws.onclose = () => {
      this.connected = false;
      if (this.handlers.close) this.handlers.close();
    };
  }

  subscribe(topic) {
    // MQTT SUBSCRIBE: fixed header 0x82 + remaining length + packet ID + topic + QoS
    const pid = this.packetId++;
    const topicBytes = this._encodeStr(topic);
    const varHeader = new Uint8Array([0, pid]); // packet identifier
    const payload = new Uint8Array(topicBytes.length + 1);
    payload.set(topicBytes, 0);
    payload[topicBytes.length] = 0; // QoS 0
    const body = this._concat(varHeader, payload);
    this._send(0x82, body);
  }

  publish(topic, message, qos = 0) {
    const topicBytes = this._encodeStr(topic);
    const msgBytes = this._encodeStr(message);
    const body = this._concat(topicBytes, msgBytes);
    this._send(0x30, body);
  }

  close() {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.connected = false;
  }

  // ---- 内部 ----

  _send(typeAndFlags, body) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const bodyLen = body ? body.length : 0;
    const remLen = this._encodeRemLen(bodyLen);
    const fixed = new Uint8Array([typeAndFlags]);
    const packet = this._concat(fixed, remLen, body || new Uint8Array(0));
    this.ws.send(packet);
  }

  _sendConnect() {
    const protoName = this._encodeStr('MQTT');
    const protoLevel = new Uint8Array([4]);       // MQTT 3.1.1
    const flags = new Uint8Array([2]);             // Clean Session
    const keepAlive = new Uint8Array([0, 60]);     // 60 秒
    const clientId = this._encodeStr(this.clientId);
    const payload = this._concat(protoName, protoLevel, flags, keepAlive, clientId);
    this._send(0x10, payload);
  }

  _handlePacket(data) {
    if (data.length < 2) return;
    const type = data[0] >> 4;
    // 跳过 remaining length 字段
    let pos = 1;
    while (pos < data.length && (data[pos] & 0x80)) pos++;
    pos++; // 最后一个 remaining length 字节

    if (type === 2) {
      // CONNACK — 连接成功
      this.connected = true;
      if (this.handlers.connect) this.handlers.connect();
    } else if (type === 3) {
      // PUBLISH — 收到消息
      const topicLen = (data[pos] << 8) | data[pos + 1];
      pos += 2;
      const topic = this._decodeStr(data, pos, topicLen);
      pos += topicLen;
      const payload = this._decodeStr(data, pos, data.length - pos);
      if (this.handlers.message) this.handlers.message(topic, payload);
    } else if (type === 9) {
      // SUBACK — 忽略
    }
  }

  // ---- 编码工具 ----

  _encodeStr(s) {
    const bytes = new TextEncoder().encode(s);
    const len = bytes.length;
    const result = new Uint8Array(2 + len);
    result[0] = (len >> 8) & 0xFF;
    result[1] = len & 0xFF;
    result.set(bytes, 2);
    return result;
  }

  _decodeStr(data, offset, length) {
    return new TextDecoder().decode(data.slice(offset, offset + length));
  }

  _encodeRemLen(len) {
    const bytes = [];
    do {
      let byte = len & 0x7F;
      len >>= 7;
      if (len > 0) byte |= 0x80;
      bytes.push(byte);
    } while (len > 0);
    return new Uint8Array(bytes);
  }

  _concat(...arrays) {
    const len = arrays.reduce((s, a) => s + a.length, 0);
    const result = new Uint8Array(len);
    let off = 0;
    for (const a of arrays) {
      result.set(a, off);
      off += a.length;
    }
    return result;
  }
}

// ============================================================
//  配置
// ============================================================

// EMQX 免费公共 MQTT broker（WebSocket 加密）
const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.miwifi.com:3478' },
  ]
};

const TOPIC_PREFIX = 'nbgame/';

let pc = null;
let dc = null;
let mqtt = null;
let msgHandler = null;
let statusHandler = null;
let roomCode = '';

// ============================================================
//  MQTT 连接
// ============================================================

function mqttConnect() {
  return new Promise((resolve, reject) => {
    const clientId = 'nb_' + Math.random().toString(36).slice(2, 10);
    const client = new MiniMqtt(MQTT_BROKER, clientId);

    const timer = setTimeout(() => {
      client.close();
      reject(new Error('信令服务连接超时，请检查网络'));
    }, 12000);

    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    client.connect();
  });
}

function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function emitStatus(s, data = {}) {
  if (statusHandler) statusHandler(s, data);
}

// ============================================================
//  DataChannel 处理
// ============================================================

function setupDataChannel(channel) {
  channel.onopen = () => {
    closeMqtt();
    emitStatus('connected');
  };

  channel.onclose = () => {
    emitStatus('disconnected');
    if (msgHandler) msgHandler({ type: 'disconnected', payload: {} });
  };

  channel.onmessage = (event) => {
    if (msgHandler) {
      try { msgHandler(JSON.parse(event.data)); } catch {}
    }
  };

  channel.onerror = () => { emitStatus('error'); };
}

function closeMqtt() {
  if (mqtt) { try { mqtt.close(); } catch {} mqtt = null; }
}

// ============================================================
//  公开 API
// ============================================================

export async function hostCreate() {
  cleanup();

  mqtt = await mqttConnect();
  roomCode = genRoomCode();

  mqtt.subscribe(TOPIC_PREFIX + roomCode + '/guest');

  pc = new RTCPeerConnection(RTC_CONFIG);
  dc = pc.createDataChannel('game', { ordered: true });
  setupDataChannel(dc);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      mqtt.publish(TOPIC_PREFIX + roomCode + '/host', JSON.stringify({
        type: 'ice',
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
      }));
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  mqtt.publish(TOPIC_PREFIX + roomCode + '/host', JSON.stringify({
    type: 'offer',
    sdp: offer.sdp,
  }));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('等待客机加入超时'));
    }, 60000);

    mqtt.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload);
        if (msg.type === 'answer') {
          clearTimeout(timeout);
          handleAnswer(msg);
          emitStatus('guest_joined');
          resolve(roomCode);
        } else if (msg.type === 'ice') {
          handleRemoteIce(msg);
        }
      } catch {}
    });
  });
}

async function handleAnswer(msg) {
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp: msg.sdp })
  );
}

async function handleRemoteIce(msg) {
  try {
    await pc.addIceCandidate(new RTCIceCandidate({
      candidate: msg.candidate,
      sdpMid: msg.sdpMid,
      sdpMLineIndex: msg.sdpMLineIndex,
    }));
  } catch {}
}

export async function guestJoin(code) {
  cleanup();

  mqtt = await mqttConnect();
  roomCode = code;

  pc = new RTCPeerConnection(RTC_CONFIG);

  pc.ondatachannel = (event) => {
    dc = event.channel;
    setupDataChannel(dc);
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      mqtt.publish(TOPIC_PREFIX + roomCode + '/guest', JSON.stringify({
        type: 'ice',
        candidate: e.candidate.candidate,
        sdpMid: e.candidate.sdpMid,
        sdpMLineIndex: e.candidate.sdpMLineIndex,
      }));
    }
  };

  mqtt.subscribe(TOPIC_PREFIX + roomCode + '/host');

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('未找到该房间，请确认房间号正确'));
    }, 30000);

    mqtt.on('message', async (topic, payload) => {
      try {
        const msg = JSON.parse(payload);
        if (msg.type === 'offer') {
          clearTimeout(timeout);
          await handleOffer(msg);
          emitStatus('answer_sent');
          resolve(roomCode);
        } else if (msg.type === 'ice') {
          handleRemoteIce(msg);
        }
      } catch {}
    });
  });
}

async function handleOffer(msg) {
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: msg.sdp })
  );
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  mqtt.publish(TOPIC_PREFIX + roomCode + '/guest', JSON.stringify({
    type: 'answer',
    sdp: answer.sdp,
  }));
}

export function send(type, payload = {}) {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type, payload }));
  }
}

export function onMessage(handler) { msgHandler = handler; }
export function onStatus(handler) { statusHandler = handler; }
export function isConnected() { return dc && dc.readyState === 'open'; }

export function disconnect() {
  closeMqtt();
  if (dc) { try { dc.close(); } catch {} dc = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; }
  if (statusHandler) statusHandler('disconnected', {});
}

function cleanup() {
  closeMqtt();
  if (dc) { try { dc.close(); } catch {} dc = null; }
  if (pc) { try { pc.close(); } catch {} pc = null; }
}
