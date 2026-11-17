// Envío de plantillas de WhatsApp.
// Un "sender" es una función async ({ to, template, params }) → { id } que tira error si falla.
// err.retryable = true cuando vale la pena reintentar (caída de Meta, límite de envíos).

const RETRYABLE_META_CODES = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056]);

/**
 * WhatsApp Cloud API (Meta).
 * @param {{ token: string, phoneNumberId: string, apiVersion?: string, language?: string, fetchImpl?: typeof fetch }} cfg
 */
export function createCloudApiSender({ token, phoneNumberId, apiVersion = 'v21.0', language = 'es_AR', fetchImpl = fetch }) {
  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  return async ({ to, template, params }) => {
    let res;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: template,
            language: { code: language },
            components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (cause) {
      throw Object.assign(new Error(`Sin respuesta de WhatsApp: ${cause.message}`), { retryable: true });
    }

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data?.error ?? {};
      const detail = e.error_data?.details ? ` (${e.error_data.details})` : '';
      throw Object.assign(new Error(`${e.message ?? `HTTP ${res.status}`}${detail}`), {
        code: e.code,
        retryable: res.status >= 500 || res.status === 429 || RETRYABLE_META_CODES.has(e.code),
      });
    }
    return { id: data.messages?.[0]?.id ?? null };
  };
}

/** Para desarrollo: no manda nada, muestra el mensaje en la consola. */
export function createConsoleSender({ log = console.log } = {}) {
  let n = 0;
  return async ({ to, template, params }) => {
    n += 1;
    log(`[WhatsApp simulado] → ${to} · ${template}\n  ${params.map((p, i) => `{{${i + 1}}} ${p}`).join('\n  ')}`);
    return { id: `wamid.DEV.${Date.now()}.${n}` };
  };
}
