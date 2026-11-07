// 本机开发用的模型代理：浏览器只连 127.0.0.1，密钥只在这个进程的环境变量里。
// 也是将来部署“自建代理”的雏形：只转发 chat/completions，限制请求大小，固定模型。
//
//   ZONGMEN_API_KEY=你的密钥 npm run proxy        # 默认监听 127.0.0.1:8787

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { env } from 'node:process';
import { defaultData } from '../assets/game/data/index';

const data = defaultData();
const oc = data.config.model.providers.openai_compatible;
const key = env[oc.api_key_env];
const port = Number(env.ZONGMEN_PROXY_PORT ?? 8787);
const upstream = (env.ZONGMEN_BASE_URL ?? oc.base_url).replace(/\/+$/, '');
const model = env.ZONGMEN_MODEL ?? oc.model;
const MAX_BODY = 64 * 1024;

if (!key) {
  console.error(`没有找到环境变量 ${oc.api_key_env}，代理无法转发。`);
  process.exit(1);
}

function cors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // 开发服务器开了 COEP，跨源响应需要这个头
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求太大'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ ok: true, model }));
    return;
  }
  if (req.method !== 'POST' || req.url !== '/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
    // 只放行需要的字段，模型固定
    const forward = {
      model,
      messages: body.messages,
      temperature: body.temperature,
      max_tokens: Math.min(Number(body.max_tokens) || 300, 500),
      response_format: body.response_format,
      stream: false,
      ...(oc.extra_body ?? {}),
    };
    const up = await fetch(`${upstream}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(forward),
    });
    const text = await up.text();
    res.writeHead(up.status, { 'Content-Type': 'application/json' }).end(text);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: String(e) }));
  }
});

server.listen(port, '127.0.0.1', () => console.log(`模型代理已启动：http://127.0.0.1:${port}（模型 ${model}）`));
