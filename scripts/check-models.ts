// Verifies MODEL_FAST / MODEL_SMART exist on Vertex AI for this project and are not Gemini 2.5.
// Usage: pnpm check:models [--ping]
import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { modelId, parseEnv } from '@matta/core';

const env = parseEnv(
  z.object({
    GOOGLE_CLOUD_PROJECT: z.string().min(1),
    GOOGLE_CLOUD_LOCATION: z.string().default('global'),
    MODEL_FAST: z.string().min(1),
    MODEL_SMART: z.string().min(1),
  }),
);

const ai = new GoogleGenAI({ vertexai: true, project: env.GOOGLE_CLOUD_PROJECT, location: env.GOOGLE_CLOUD_LOCATION });
const ping = process.argv.includes('--ping');

console.log(`project=${env.GOOGLE_CLOUD_PROJECT} location=${env.GOOGLE_CLOUD_LOCATION}`);

// Informational only: Vertex list may return few or no publisher models.
try {
  const names: string[] = [];
  for await (const m of await ai.models.list({ config: { queryBase: true, pageSize: 100 } })) {
    if (m.name && /gemini/i.test(m.name)) names.push(m.name.replace(/^.*\//, ''));
  }
  console.log(`Gemini models listed (${names.length}): ${names.sort().join(', ') || '(none returned)'}`);
} catch (e) {
  console.log(`models.list failed (informational): ${String(e)}`);
}

let failed = false;
for (const [key, id] of [['MODEL_FAST', env.MODEL_FAST], ['MODEL_SMART', env.MODEL_SMART]] as const) {
  const problems: string[] = [];
  const r = modelId.safeParse(id);
  if (!r.success) problems.push(r.error.issues[0]?.message ?? 'invalid model id');
  try {
    await ai.models.get({ model: id });
  } catch (e) {
    problems.push(`not available: ${String(e).slice(0, 200)}`);
  }
  if (ping && problems.length === 0) {
    try {
      await ai.models.generateContent({ model: id, contents: 'ping', config: { maxOutputTokens: 1 } });
    } catch (e) {
      problems.push(`ping failed: ${String(e).slice(0, 200)}`);
    }
  }
  failed ||= problems.length > 0;
  console.log(`${problems.length ? 'FAIL' : 'PASS'} ${key}=${id}${problems.length ? ` — ${problems.join('; ')}` : ''}`);
}

process.exit(failed ? 1 : 0);
