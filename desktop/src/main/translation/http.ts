// Mobil uygulamadaki SubtitleCapture.httpRequest (OkHttp) karşılığı: paylaşılan
// DeepLTranslationService bu imzayı bekler.
//
// Neden fetch değil: Node fetch bağlantıyı 4 sn boşta kalınca kapatıyor. Canlı oyunda replikler arası
// boşluk çoğu zaman bundan uzun, yani neredeyse her çeviri yeni TCP + TLS bağlantısı kuruyordu.
// Ölçüm (api-free.deepl.com): açık bağlantıyla p50 190 ms / p90 250 ms, her istekte yeni bağlantıyla
// p50 390 ms / p90 7,6 sn. Burada bağlantılar açık tutulur (sunucu 15-30 sn boşta kalanı kapatıyor;
// DeepLWarmer onları canlı tutar) ve DNS sonucu önbellekte tutulur.
import { LookupFunction } from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import type { HttpRequest, HttpResponse } from '../../../../src/native/SubtitleCapture';

const DNS_TTL_MS = 5 * 60_000;
const dnsCache = new Map<string, { address: string; family: number; at: number }>();

/**
 * DNS önbelleği: taze kayıt varsa beklemeden döner; eskiyse arka planda yeniler. Çözümleme başarısız
 * olursa (canlı ölçümde bir kez ENOTFOUND oldu) eski kayıt kullanılır.
 */
const cachedLookup: LookupFunction = (hostname, options, callback) => {
  const cb = callback as (err: NodeJS.ErrnoException | null, address: any, family?: number) => void;
  const opts = typeof options === 'object' ? options : {};
  if ((opts as { all?: boolean }).all) {
    // Node 20+ Agent'ı all:true ile çağırır.
    return cachedLookup(hostname, { ...opts, all: false }, (err, address, family) =>
      err ? cb(err, []) : cb(null, [{ address, family }]),
    );
  }
  const hit = dnsCache.get(hostname);
  const resolve = (done?: typeof cb) =>
    dnsLookup(hostname, { family: 4 }, (err, address, family) => {
      if (!err) {
        dnsCache.set(hostname, { address, family, at: Date.now() });
      }
      if (done) {
        if (err && hit) {
          done(null, hit.address, hit.family);
        } else {
          done(err, address, family);
        }
      }
    });
  if (hit) {
    if (Date.now() - hit.at > DNS_TTL_MS) {
      resolve();
    }
    return cb(null, hit.address, hit.family);
  }
  resolve(cb);
};

/** Paylaşılan bağlantı havuzu: DeepL, Google ve yerel model sunucusu dışındaki tüm istekler. */
const agentOptions = {
  keepAlive: true,
  keepAliveMsecs: 5_000,
  maxSockets: 6,
  maxFreeSockets: 4,
  // Boşta kalan soketi biz kapatmayalım; sunucu kapatırsa havuz yenisini açar.
  timeout: 120_000,
  scheduling: 'lifo' as const,
  lookup: cachedLookup,
};
const httpsAgent = new https.Agent(agentOptions);
const httpAgent = new http.Agent(agentOptions);

export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  try {
    return await send(req);
  } catch (e) {
    // Sunucu boştaki soketi tam o anda kapattıysa istek gitmeden düşer: yeni soketle bir kez daha dene.
    if ((e as { reusedSocket?: boolean }).reusedSocket && /ECONNRESET|EPIPE|socket hang up/i.test(String((e as Error).message ?? e))) {
      return send(req);
    }
    throw e;
  }
}

function send(req: HttpRequest): Promise<HttpResponse> {
  const url = new URL(req.url);
  const secure = url.protocol === 'https:';
  const timeoutMs = req.timeoutMs ?? 10000;
  return new Promise((resolve, reject) => {
    const r = (secure ? https : http).request(
      url,
      {
        method: req.method,
        headers: req.body !== undefined ? { ...req.headers, 'Content-Length': Buffer.byteLength(req.body) } : req.headers,
        agent: secure ? httpsAgent : httpAgent,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') });
        });
        res.on('error', e => {
          clearTimeout(timer);
          reject(e);
        });
      },
    );
    const timer = setTimeout(() => r.destroy(new Error('timeout')), timeoutMs);
    r.on('error', e => {
      clearTimeout(timer);
      (e as { reusedSocket?: boolean }).reusedSocket = r.reusedSocket;
      reject(e);
    });
    r.end(req.body);
  });
}

/**
 * DeepL bağlantılarını sıcak tutar: [sockets] kadar paralel, kota harcamayan /v2/usage isteği
 * [intervalMs]'de bir. İki soket: yavaş kalan çeviriye ikinci istek de sıcak bağlantıdan gitsin.
 */
export class ConnectionWarmer {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly ping: () => Promise<unknown>,
    private readonly sockets = 2,
    private readonly intervalMs = 10_000,
  ) {}

  start() {
    if (this.timer) {
      return;
    }
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.timer = null;
  }

  get running() {
    return this.timer !== null;
  }

  private tick() {
    for (let i = 0; i < this.sockets; i++) {
      this.ping().catch(() => {});
    }
  }
}
