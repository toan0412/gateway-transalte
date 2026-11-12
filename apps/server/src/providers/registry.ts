import { cloudflare } from "./cloudflare.js";
import { gemini } from "./gemini.js";
import { libretranslate } from "./libretranslate.js";
import { mymemory } from "./mymemory.js";
import { openaiCompatible } from "./openai-compatible.js";
import type { ProviderDefinition } from "./types.js";

const defs = new Map<string, ProviderDefinition>();
for (const d of [gemini, openaiCompatible, cloudflare, mymemory, libretranslate]) {
  defs.set(d.template.type, d);
}

export const getDefinition = (type: string) => defs.get(type);
export const registerDefinition = (d: ProviderDefinition) => defs.set(d.template.type, d);
export const listTemplates = () => [...defs.values()].map((d) => d.template);
