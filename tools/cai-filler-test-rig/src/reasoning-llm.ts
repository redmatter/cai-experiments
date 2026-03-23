import { ReasoningBedrockClient, type ReasoningResponse } from '../../../lib/reasoning-bedrock-client';
import type { Message } from '@aws-sdk/client-bedrock-runtime';

const FILLER_CONTEXT_SYSTEM_PROMPT = `You are a voice assistant in a real-time conversation. You've already spoken an opening sentence to the user (shown in the prior assistant turn).

CRITICAL: Your response must continue naturally from that opening sentence. The user will hear your opening sentence followed immediately by your response — they must sound like consecutive sentences from the same person.

Rules:
- DO NOT repeat or paraphrase what the opening sentence already said
- DO NOT contradict or change direction from the opening sentence
- Start your response as the natural NEXT sentence in the conversation
- Keep your tone and register consistent with the opening

Example:
Opening: "So you're asking about call quality issues..."
Good continuation: "The most common cause is network jitter between your office and our servers."
Bad continuation: "Hi! I'd be happy to help you today." (ignores the opening, restarts)

Your response should read as though you wrote both the opening and the continuation yourself.`;

export interface ReasoningLLMOptions {
  systemPrompt: string;
  userUtterance: string;
  fillerPhrase: string;
  reasoningBudgetTokens: number;
  maxTokens: number;
}

export class ReasoningLLM {
  private client: ReasoningBedrockClient;

  constructor(client: ReasoningBedrockClient) {
    this.client = client;
  }

  /**
   * Execute reasoning LLM call with filler context injection.
   * The filler phrase is injected as a prior assistant turn.
   */
  async executeWithFillerContext(options: ReasoningLLMOptions): Promise<ReasoningResponse> {
    const {
      systemPrompt,
      userUtterance,
      fillerPhrase,
      reasoningBudgetTokens,
      maxTokens,
    } = options;

    // Combine system prompts
    const fullSystemPrompt = `${systemPrompt}\n\n${FILLER_CONTEXT_SYSTEM_PROMPT}`;

    // Build message history with filler as prior assistant turn
    const messages: Message[] = [
      {
        role: 'user',
        content: [{ text: userUtterance }],
      },
      {
        role: 'assistant',
        content: [{ text: fillerPhrase }],
      },
    ];

    return await this.client.sendMessage(fullSystemPrompt, messages, {
      reasoningBudgetTokens,
      maxTokens,
    });
  }

  /**
   * Execute reasoning LLM call without filler (baseline).
   */
  async executeBaseline(options: {
    systemPrompt: string;
    userUtterance: string;
    reasoningBudgetTokens: number;
    maxTokens: number;
  }): Promise<ReasoningResponse> {
    const { systemPrompt, userUtterance, reasoningBudgetTokens, maxTokens } = options;

    const messages: Message[] = [
      {
        role: 'user',
        content: [{ text: userUtterance }],
      },
    ];

    return await this.client.sendMessage(systemPrompt, messages, {
      reasoningBudgetTokens,
      maxTokens,
    });
  }

  /**
   * Extract first sentence from response text.
   * Strips thinking tags before extracting.
   */
  extractFirstSentence(text: string): string {
    // Remove thinking tags and their content
    let cleanText = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

    // Strip markdown formatting
    cleanText = cleanText.replace(/^#+\s+/gm, '').replace(/\*\*/g, '').trim();

    // If starts with punctuation (like ". I can help"), skip the leading punctuation
    cleanText = cleanText.replace(/^[.!?,;:\s]+/, '').trim();

    // If after stripping we have nothing, return original
    if (!cleanText) {
      return text.substring(0, 200).trim();
    }

    // Extract sentences greedily — keep going if first sentence is too short (< 5 words)
    let extracted = '';
    let remaining = cleanText;

    while (remaining.length > 0) {
      const match = remaining.match(/^.+?[.!?](?:\s|$)/);
      if (!match) {
        // No more sentence endings — append what's left if we have nothing yet
        if (!extracted) {
          return remaining.substring(0, 150).trim();
        }
        break;
      }

      extracted += (extracted ? ' ' : '') + match[0].trim();
      remaining = remaining.substring(match[0].length).trim();

      // Stop if we have enough content (at least 5 words)
      const wordCount = extracted.split(/\s+/).length;
      if (wordCount >= 5) break;
    }

    return extracted || cleanText.substring(0, 150).trim();
  }
}
