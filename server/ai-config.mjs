export const AI_MODELS = Object.freeze({ openai: 'gpt-4.1-mini', nvidia: 'meta/llama-3.3-70b-instruct' });

// Keys stay in server memory. Selection never sends one vendor's key to another.
export function aiOptionsFromEnv(env = process.env) {
  const provider = env.AI_PROVIDER?.trim().toLowerCase() || (env.OPENAI_API_KEY?.trim() ? 'openai' : env.NVIDIA_API_KEY?.trim() ? 'nvidia' : 'openai');
  if (!['openai', 'nvidia', 'local'].includes(provider)) throw new Error('AI_PROVIDER must be openai, nvidia or local');
  if (provider === 'local') return { provider, key: '' };
  const prefix = provider.toUpperCase();
  return { provider, key: env[`${prefix}_API_KEY`]?.trim() || '', model: env[`${prefix}_MODEL`]?.trim() || AI_MODELS[provider] };
}
