import { getSupabaseConfig } from './content-store.mjs';
export async function chatOperation(args, { env = process.env, fetcher = fetch } = {}) {
  const { url, secretKey } = getSupabaseConfig(env);
  try {
    const response = await fetcher(`${url}/rest/v1/rpc/chat_operar`, {
      method: 'POST', headers: { apikey: secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(args), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error();
    return await response.json();
  } catch { throw new Error('CHAT_BANCO_INDISPONIVEL'); }
}
