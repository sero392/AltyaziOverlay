import { protectWithPlaceholders } from '../../../../src/services/translation/protectedTerms';
import {
  AbortError,
  TranslationResult,
  TranslationService,
} from '../../../../src/services/translation/TranslationService';
import type { LocalLlm } from './localLlm';

/**
 * Bağlam olarak gönderilen önceki replik sayısı. Canlı testte bağlam, modelin önceki replikten
 * sözcük taşımasına ("...biliyorsunuz") ve çevirinin başına "..." eklemesine yol açtı; kapalı.
 */
const CONTEXT_TURNS = 0;

/**
 * TranslateGemma'nın kendi sohbet şablonundaki talimat (EN -> TR) + tek cümlelik hitap kuralı.
 * Daha uzun özel talimatlar denendi: hitap düzeldi ama anlam kaçırma ve ad çevirme ("Dutch" ->
 * "Holland") arttı. Model eğitildiği talimata en yakın haliyle en doğru çeviriyi veriyor.
 */
const userTurn = (text: string) =>
  '<start_of_turn>user\n' +
  'You are a professional English (en) to Turkish (tr) translator. Your goal is to accurately convey ' +
  'the meaning and nuances of the original English text while adhering to Turkish grammar, vocabulary, ' +
  'and cultural sensitivities. The text is informal spoken dialogue: address one person with "sen", not "siz".\n' +
  'Produce only the Turkish translation, without any additional explanations or commentary. ' +
  'Please translate the following English text into Turkish:\n\n\n' +
  text +
  '<end_of_turn>\n';

/**
 * Önceki replikler önceki sohbet turları olarak eklenir: model bağlamı görür ve llama.cpp
 * ortak öneki önbellekten okur (cache_prompt), yani bağlam ek gecikme getirmez.
 */
export function buildPrompt(text: string, context: [string, string][] = []): string {
  return (
    '<bos>' +
    context.map(([src, dst]) => userTurn(src) + `<start_of_turn>model\n${dst}<end_of_turn>\n`).join('') +
    userTurn(text) +
    '<start_of_turn>model\n'
  );
}

/** llama.cpp /completion: en fazla [maxTokens] üretir, ilk tur sonunda durur. */
export async function complete(
  baseUrl: string,
  prompt: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(`${baseUrl}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      n_predict: 200,
      temperature: 0,
      cache_prompt: true,
      stop: ['<end_of_turn>', '<start_of_turn>'],
    }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const json: any = await res.json();
  if (typeof json?.content !== 'string') {
    throw new Error('beklenmeyen yanıt');
  }
  return json.content.trim();
}

/**
 * Yerel TranslateGemma ile çeviri (internetsiz). Sunucu henüz hazır değilse hemen hata verir
 * (çağıran yedek motora geçer) ve sunucuyu arka planda başlatır.
 *
 * Çevrilmeyecek kelimeler Google'daki gibi "XZ0" yer tutucularıyla korunur: model bunları
 * olduğu gibi bırakıp Türkçe eki ekliyor ("XZ0'dan" -> "Dutch'dan").
 */
export class LocalLlmTranslationService implements TranslationService {
  private context: [string, string][] = [];

  constructor(
    private readonly llm: LocalLlm,
    private readonly protectedTerms: string[] = [],
    private readonly timeoutMs = 5000,
  ) {}

  async translate(text: string, signal?: AbortSignal): Promise<TranslationResult> {
    if (signal?.aborted) {
      throw new AbortError();
    }
    if (!this.llm.ready) {
      this.llm.ensureStarted().catch(() => {});
      throw new Error('Yerel model hazır değil');
    }
    const prot = protectWithPlaceholders(text, this.protectedTerms);
    let out: string;
    try {
      out = await complete(this.llm.baseUrl, buildPrompt(prot.text, this.context), this.timeoutMs, signal);
    } catch (e) {
      if (signal?.aborted) {
        throw new AbortError();
      }
      const msg = (e as Error).name === 'TimeoutError' ? 'yanıt yok (zaman aşımı)' : (e as Error).message;
      throw new Error(`Yerel model: ${msg}`);
    }
    if (!out) {
      throw new Error('Yerel model: boş çeviri');
    }
    // slice(-0) hepsini tutar: bağlam kapalıysa açıkça boşalt.
    this.context =
      CONTEXT_TURNS > 0 ? [...this.context, [prot.text, out] as [string, string]].slice(-CONTEXT_TURNS) : [];
    return { text: prot.restore(out), fromCache: false, engine: 'Yerel' };
  }
}
