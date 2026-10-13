import { FunctionCallingConfigMode } from '@google/genai';
import { env } from '../env.server';
import { genai, usage } from '../genai.server';
import { callBank } from '../bank';
import { policy } from '../policy.server';
import { writeAudit } from '../audit';
import { firestoreGuardianStore } from './state';
import { functionDeclarations, SYSTEM_PROMPT } from './tools';
import type { Deps } from './loop';

export function realDeps(): Deps {
  const p = policy();
  return {
    modelName: env().MODEL_SMART,
    async model(contents, signal) {
      const r = await genai().models.generateContent({
        model: env().MODEL_SMART,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations }],
          // Every output must be a tool call: no free text ever reaches the customer (rule 6).
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          temperature: 0.2,
          abortSignal: signal,
        },
      });
      return { content: r.candidates?.[0]?.content, functionCalls: r.functionCalls ?? [], ...usage(r) };
    },
    bank: callBank,
    store: firestoreGuardianStore(),
    policy: p.policy,
    policyHash: p.policyHash,
    audit: writeAudit,
    now: () => new Date(),
  };
}
