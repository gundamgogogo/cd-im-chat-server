import http from 'http';
import { WebSocketServer } from 'ws';

const PORT = process.env.PORT || 3000;

// pairId -> { users: Map<userId, { ws, displayName }>, history: [] }
const pairs = new Map();

function getOrCreatePair(pairId) {
  if (!pairs.has(pairId)) {
    pairs.set(pairId, {
      users: new Map(),
      history: []
    });
  }
  return pairs.get(pairId);
}

function broadcastToPair(pairId, payload) {
  const pair = pairs.get(pairId);
  if (!pair) return;
  const data = JSON.stringify(payload);
  for (const { ws } of pair.users.values()) {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('CD IM chat server is running.\n');
  } else {
    res.writeHead(404);
    res.end();
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let pairId = null;
  let userId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.error('Invalid JSON from client:', e);
      return;
    }

    if (msg.type === 'hello') {
      // {type:"hello", pairId, userId, displayName}
      pairId = String(msg.pairId || '').trim();
      userId = String(msg.userId || '').trim();
      const displayName = String(msg.displayName || '').trim() || userId;

      if (!pairId || !userId) {
        ws.send(JSON.stringify({ type: 'error', message: 'pairId and userId are required' }));
        return;
      }

      const pair = getOrCreatePair(pairId);
      pair.users.set(userId, { ws, displayName });

      const history = pair.history.slice(-100);

      ws.send(JSON.stringify({
        type: 'welcome',
        pairId,
        userId,
        history,
        users: Array.from(pair.users.entries()).map(([id, info]) => ({
          userId: id,
          displayName: info.displayName
        }))
      }));

      broadcastToPair(pairId, {
        type: 'presence',
        pairId,
        users: Array.from(pair.users.entries()).map(([id, info]) => ({
          userId: id,
          displayName: info.displayName
        }))
      });

      return;
    }

    if (!pairId || !userId) {
      ws.send(JSON.stringify({ type: 'error', message: 'not joined' }));
      return;
    }

    if (msg.type === 'chat') {
      const rawText = String(msg.text || '');
      const text = rawText.trim();
      const hasImage = typeof msg.image === 'string' && msg.image.startsWith('data:image');

      if (!text && !hasImage) {
        return;
      }

      const now = new Date();
      const message = {
        id: msg.clientMsgId || `${now.getTime()}_${Math.floor(Math.random() * 1000)}`,
        type: 'chat',
        pairId,
        from: userId,
        text: text || (hasImage ? '[image]' : ''),
        time: now.toISOString()
      };

      if (hasImage) {
        message.image = msg.image;
      }

      const pair = getOrCreatePair(pairId);
      pair.history.push(message);
      if (pair.history.length > 500) {
        pair.history.splice(0, pair.history.length - 500);
      }

      broadcastToPair(pairId, {
        type: 'chat',
        message
      });
      return;
    }
  });

  ws.on('close', () => {
    if (pairId && userId) {
      const pair = pairs.get(pairId);
      if (pair) {
        pair.users.delete(userId);
        if (pair.users.size === 0 && pair.history.length === 0) {
          pairs.delete(pairId);
        } else {
          broadcastToPair(pairId, {
            type: 'presence',
            pairId,
            users: Array.from(pair.users.entries()).map(([id, info]) => ({
              userId: id,
              displayName: info.displayName
            }))
          });
        }
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`CD IM chat server listening on port ${PORT}`);
});
