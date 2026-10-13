import { GoogleGenAI } from '@google/genai';
import { env } from './env.server';

let client: GoogleGenAI | undefined;

/** Gemini on Vertex AI with Application Default Credentials (no API keys). */
export const genai = () =>
  (client ??= new GoogleGenAI({ vertexai: true, project: env().GOOGLE_CLOUD_PROJECT, location: env().GOOGLE_CLOUD_LOCATION }));

/** Token usage of one response, for audit. */
export const usage = (r: { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }) => ({
  tokensIn: r.usageMetadata?.promptTokenCount ?? 0,
  tokensOut: r.usageMetadata?.candidatesTokenCount ?? 0,
});
