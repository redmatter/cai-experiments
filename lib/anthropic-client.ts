import Anthropic from '@anthropic-ai/sdk';
import type { Message as AnthropicMessage } from '@anthropic-ai/sdk/resources/messages';
import type { ContentBlock, Message, Metrics, ModelResponse } from './types';

export class AnthropicClient {
  private client: Anthropic;
  private modelId: string;

  constructor(modelId: string, apiKey?: string) {
    this.modelId = modelId;
    this.client = new Anthropic({
      apiKey: apiKey || process.env.ANTHROPIC_TEST_API_KEY,
    });
  }

  async initialize(): Promise<void> {
    // No initialization needed for Anthropic (unlike Bedrock SSO)
    if (!process.env.ANTHROPIC_TEST_API_KEY) {
      throw new Error('ANTHROPIC_TEST_API_KEY environment variable is required');
    }
    console.log('✅ Anthropic client initialized');
  }

  async sendMessage(
    systemPrompt: ContentBlock[],
    messages: Message[],
    options: {
      temperature?: number;
      maxTokens?: number;
      withCache?: boolean;
      testName?: string;
    } = {}
  ): Promise<ModelResponse> {
    const {
      temperature = 0.2,
      maxTokens = 1024,
      withCache = false,
      testName = '',
    } = options;

    // Convert our message format to Anthropic's format
    const anthropicMessages = messages.map(msg => ({
      role: msg.role,
      content: msg.content.map(c => ({ type: 'text' as const, text: c.text })),
    }));

    // Combine system prompt blocks into a single string
    const systemText = systemPrompt.map(block => block.text).join('\n\n');

    // Format system prompt for caching if enabled
    const systemParam = withCache
      ? [
          {
            type: 'text' as const,
            text: systemText,
            cache_control: { type: 'ephemeral' as const }
          }
        ]
      : systemText;

    const requestStartTime = Date.now();
    let timeToFirstToken = 0;
    let timeToFirstSentence = 0;
    let firstSentenceDetected = false;
    let thinkingTagEnded = false;
    let timeToEndOfThinking = 0;

    const stream = await this.client.messages.stream({
      model: this.modelId,
      max_tokens: maxTokens,
      temperature,
      system: systemParam,
      messages: anthropicMessages,
    });

    let completeMessage = '';
    let firstTokenReceived = false;

    // Process the stream
    stream.on('text', (text) => {
      if (!firstTokenReceived) {
        timeToFirstToken = Date.now() - requestStartTime;
        firstTokenReceived = true;
      }
      completeMessage += text;

      // Detect end of thinking tag
      if (!thinkingTagEnded && completeMessage.includes('</thinking>')) {
        timeToEndOfThinking = Date.now() - requestStartTime;
        thinkingTagEnded = true;
      }

      // Detect first sentence completion (after thinking tag if present)
      if (!firstSentenceDetected) {
        // If we have thinking tags, only detect sentences after </thinking>
        if (thinkingTagEnded || !completeMessage.includes('<thinking>')) {
          // Look for sentence ending after the thinking tag
          const contentAfterThinking = thinkingTagEnded
            ? completeMessage.substring(completeMessage.indexOf('</thinking>') + 11)
            : completeMessage;

          if (/[.!?]\s/.test(contentAfterThinking)) {
            timeToFirstSentence = Date.now() - requestStartTime;
            firstSentenceDetected = true;
          }
        }
      }
    });

    // Wait for the stream to complete and get the final message
    const finalMessage = await stream.finalMessage();

    const timeToLastToken = Date.now() - requestStartTime;

    // Extract text from the response
    if (finalMessage.content[0].type === 'text') {
      completeMessage = finalMessage.content[0].text;
    }

    // If no sentence ending detected during streaming, use timeToLastToken
    if (!firstSentenceDetected) {
      timeToFirstSentence = timeToLastToken;
    }

    const metrics: Metrics = {
      timestamp: new Date().toISOString(),
      provider: 'anthropic',
      model: this.modelId,
      region: undefined, // Anthropic Direct API has no region
      testName,
      latency: timeToLastToken, // Total request time
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      timeToFirstToken,
      timeToFirstSentence,
      timeToLastToken,
      timeToGenerate: timeToLastToken - timeToFirstToken,
      hasThinkingTag: thinkingTagEnded,
      thinkingTagDelay: thinkingTagEnded ? timeToEndOfThinking - timeToFirstToken : undefined,
      systemPromptLengthBytes: systemText.length,
      messagesLengthBytes: JSON.stringify(messages).length,
      messagesCount: messages.length,
      withCache,
      cacheReadInputTokens: (finalMessage.usage as any).cache_read_input_tokens ?? 0,
      cacheWriteInputTokens: (finalMessage.usage as any).cache_creation_input_tokens ?? 0,
      temperature,
      maxTokens,
    };

    return {
      metrics,
      output: {
        message: {
          role: 'assistant',
          content: [{ text: completeMessage }],
        },
      },
    };
  }
}