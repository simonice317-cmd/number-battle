/**
 * p2p.js — WebRTC P2P 直连 + MQTT 自动信令
 *
 * 信令通过免费 MQTT broker 自动完成，你只需把 4 位房间号发给朋友。
 * 游戏数据通过 DataChannel 点对点直传，不经过服务器。
 *
 * 流程：
 *   房主 → 创建房间(得房间号) → 等客机加入 → DataChannel 直连
 *   客机 → 输入房间号 → 自动连上 → DataChannel 直连
 */

// MQTT broker（EMQX 免费公共服务器，wss 加密）
const MQTT_BROKER = 'wss://broker.emqx.io:8084/mqtt';

// WebRTC 配置
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.qq.com:3478' },
    { urls: 'stun:stun.miwifi.com:3478' },
  ]
};

// MQTT topic 前缀
const TOPIC_PREFIX = 'nbgame/';

let pc = null;              // RTCPeerConnection
let dc = null;              // DataChannel
let mqtt = null;            // MQTT 连接（仅信令阶段）
let msgHandler = null;
let statusHandler = null;
let roomCode = '';
let pendingCandidates = []; // ICE 候选缓存

// ============================================================
//  内部 — MQTT 信令
// ============================================================

function mqttConnect() {
  return new Promise((resolve, reject) => {
    const client = mqtt.connect(MQTT_BROKER, {
      clientId: 'nb_' + Math.random().toString(36).slice(2, 10),
      connectTimeout: 10000,
      clean: true,
    });

    const timer = setTimeout(() => {
      reject(new Error('信令服务连接超时，请检查网络'));
    }, 12000);

    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });

    client.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error('信令服务错误: ' + (err.message || '未知')));
    });
  });
}

/** 生成 4 位房间号 */
function genRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function emitStatus(s, data = {}) {
  if (statusHandler) statusHandler(s, data);
}

// ============================================================
//  连接建立后的 DataChannel 处理
// ============================================================

function setupDataChannel(channel) {
  channel.onopen = () => {
    // DataChannel 建立后，关闭 MQTT 信令
    closeMqtt();
    emitStatus('connected');
  };

  channel.onclose = () => {
    emitStatus('disconnected');
    if (msgHandler) msgHandler({ type: 'disconnected', payload: {} });
  };

  channel.onmessage = (event) => {
    if (msgHandler) {
      try {
        msgHandler(JSON.parse(event.data));
      } catch { /* ignore */ }
    }
  };

  channel.onerror = () => {
    emitStatus('error');
  };
}

function closeMqtt() {
  if (mqtt) {
    try { mqtt.end(); } catch {}
    mqtt = null;
  }
}

// ============================================================
//  公开 API
// ============================================================

/**
 * 【房主】创建房间
 * 1. 连接 MQTT
 * 2. 生成房间号
 * 3. 创建 WebRTC offer
 * 4. 通过 MQTT 交换信令
 * 5. DataChannel 建立后返回
 *
 * @returns {Promise<string>} 房间号
 */
export async function hostCreate() {
  cleanup();

  mqtt = await mqttConnect();
  roomCode = genRoomCode();

  // 订阅客机发来的消息
  const guestTopic = TOPIC_PREFIX + roomCode + '/guest';
  mqtt.subscribe(guestTopic);

  // 创建 RTCPeerConnection + DataChannel
  pc = new RTCPeerConnection(RTC_CONFIG);
  dc = pc.createDataChannel('game', { ordered: true });
  setupDataChannel(dc);

  // 收集 ICE 候选，实时发出去
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

  // 创建 offer
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  // 发布 offer
  mqtt.publish(TOPIC_PREFIX + roomCode + '/host', JSON.stringify({
    type: 'offer',
    sdp: offer.sdp,
  }));

  // 等待客机的 answer
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('等待客机加入超时'));
    }, 60000);

    mqtt.on('message', (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
        if (msg.type === 'answer') {
          clearTimeout(timeout);
          handleAnswer(msg);
          emitStatus('guest_joined');
          // 发送缓存的 ICE 候选
          flushIceCandidates();
          resolve(roomCode);
        } else if (msg.type === 'ice') {
          handleRemoteIce(msg);
        }
      } catch {}
    });
  });
}

/** 处理客机的 answer */
async function handleAnswer(msg) {
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp: msg.sdp })
  );
}

/** 处理远端 ICE 候选 */
async function handleRemoteIce(msg) {
  try {
    await pc.addIceCandidate(new RTCIceCandidate({
      candidate: msg.candidate,
      sdpMid: msg.sdpMid,
      sdpMLineIndex: msg.sdpMLineIndex,
    }));
  } catch {}
}

/** 发放缓存的 ICE（answer 收到后可能还有新候选） */
function flushIceCandidates() {
  // ICE 候选是实时发出的，不需要额外处理
}

/**
 * 【客机】加入房间
 * @param {string} code — 4 位房间号
 */
export async function guestJoin(code) {
  cleanup();

  mqtt = await mqttConnect();
  roomCode = code;

  pc = new RTCPeerConnection(RTC_CONFIG);

  // 监听房主的 DataChannel
  pc.ondatachannel = (event) => {
    dc = event.channel;
    setupDataChannel(dc);
  };

  // 收集 ICE 候选，实时发出
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

  // 订阅房主消息
  const hostTopic = TOPIC_PREFIX + roomCode + '/host';
  mqtt.subscribe(hostTopic);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('未找到该房间，请确认房间号正确'));
    }, 30000);

    mqtt.on('message', async (topic, payload) => {
      try {
        const msg = JSON.parse(payload.toString());
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

/** 处理房主的 offer */
async function handleOffer(msg) {
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'offer', sdp: msg.sdp })
  );

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // 发布 answer
  mqtt.publish(TOPIC_PREFIX + roomCode + '/guest', JSON.stringify({
    type: 'answer',
    sdp: answer.sdp,
  }));
}

/** 发送消息到对方（游戏数据） */
export function send(type, payload = {}) {
  if (dc && dc.readyState === 'open') {
    dc.send(JSON.stringify({ type, payload }));
  }
}

/** 注册消息回调 */
export function onMessage(handler) {
  msgHandler = handler;
}

/** 注册状态回调 */
export function onStatus(handler) {
  statusHandler = handler;
}

/** 是否已连接 */
export function isConnected() {
  return dc && dc.readyState === 'open';
}

/** 断开连接并清理 */
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
