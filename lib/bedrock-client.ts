import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseStreamCommandOutput,
  type Message,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { getAwsCredentials } from './aws-auth';
import type { Metrics, ModelResponse } from './types';

export class BedrockClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private region: string;

  constructor(modelId: string, region: string = 'us-west-2') {
    this.modelId = modelId;
    this.region = region;
  }

  async initialize(): Promise<void> {
    const credentials = await getAwsCredentials();
    this.client = new BedrockRuntimeClient({
      region: this.region,
      credentials,
    });
  }

  async sendMessage(
    systemPrompt: SystemContentBlock[],
    messages: Message[],
    options: {
      temperature?: number;
      maxTokens?: number;
      optimisedLatency?: boolean;
      withCache?: boolean;
      testName?: string;
    } = {}
  ): Promise<ModelResponse> {
    const {
      temperature = 0.2,
      maxTokens = 1024,
      optimisedLatency = false,
      withCache = false,
      testName = '',
    } = options;

    // Configure system prompt with cachePoint if caching is enabled
    const systemWithCache: any[] = systemPrompt.map((block) => ({
      text: (block as any).text
    }));

    // Add cache point as a separate block after the last system block
    if (withCache && systemWithCache.length > 0) {
      systemWithCache.push({
        cachePoint: { type: 'default' }
      });
    }

    const converseCommand: ConverseCommandInput = {
      modelId: this.modelId,
      messages,
      system: systemWithCache,
      inferenceConfig: {
        temperature,
        maxTokens,
      },
    };

    if (optimisedLatency) {
      converseCommand.performanceConfig = { latency: 'optimized' };
    }

    const requestStartTime = Date.now();
    const response = await this.client.send(new ConverseStreamCommand(converseCommand));

    return this.parseStreamResponse(response, requestStartTime, {
      temperature,
      maxTokens,
      optimisedLatency,
      withCache,
      testName,
      systemPrompt,
      messages,
    });
  }

  private async parseStreamResponse(
    response: ConverseStreamCommandOutput,
    invokeTime: number,
    context: {
      temperature: number;
      maxTokens: number;
      optimisedLatency: boolean;
      withCache: boolean;
      testName: string;
      systemPrompt: SystemContentBlock[];
      messages: Message[];
    }
  ): Promise<ModelResponse> {
    let completeMessage = '';
    let timeToFirstToken = 0;
    let timeToFirstSentence = 0;
    let firstSentenceDetected = false;
    let thinkingTagEnded = false;
    let timeToEndOfThinking = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let cacheReadInputTokens = 0;
    let cacheWriteInputTokens = 0;
    let latency = 0;

    const { stream } = response;

    if (!stream) {
      throw new Error('No stream in response');
    }

    for await (const chunk of stream) {
      const tokenTime = Date.now();

      if (chunk.messageStart) {
        timeToFirstToken = tokenTime - invokeTime;
      } else if (chunk.contentBlockDelta?.delta?.text) {
        completeMessage += chunk.contentBlockDelta.delta.text;

        // Detect end of thinking tag
        if (!thinkingTagEnded && completeMessage.includes('</thinking>')) {
          timeToEndOfThinking = tokenTime - invokeTime;
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
              timeToFirstSentence = tokenTime - invokeTime;
              firstSentenceDetected = true;
            }
          }
        }
      } else if (chunk.metadata?.usage) {
        inputTokens = chunk.metadata.usage.inputTokens ?? 0;
        outputTokens = chunk.metadata.usage.outputTokens ?? 0;
        totalTokens = chunk.metadata.usage.totalTokens ?? 0;
        cacheReadInputTokens = chunk.metadata.usage.cacheReadInputTokens ?? 0;
        cacheWriteInputTokens = chunk.metadata.usage.cacheWriteInputTokens ?? 0;
        latency = chunk.metadata.metrics?.latencyMs ?? 0;
      }
    }

    // If no sentence ending detected during streaming, use timeToLastToken
    if (!firstSentenceDetected) {
      timeToFirstSentence = Date.now() - invokeTime;
    }

    const timeToLastToken = Date.now() - invokeTime;
    const networkOverhead = latency > 0 ? timeToLastToken - latency : 0;

    // Estimate network-adjusted metrics
    // Assumes network overhead is split between request (one-way) and response (streaming)
    // We estimate request latency as ~50% of total network overhead for conservative adjustment
    const estimatedRequestLatency = networkOverhead > 0 ? networkOverhead * 0.5 : 0;

    const metrics: Metrics = {
      timestamp: new Date().toISOString(),
      provider: 'bedrock',
      model: this.modelId,
      region: this.region,
      testName: context.testName,
      latency,
      serverSideLatency: latency, // Bedrock provides server-side latency
      networkOverhead: networkOverhead > 0 ? networkOverhead : undefined,
      inputTokens,
      outputTokens,
      totalTokens,
      timeToFirstToken,
      timeToFirstSentence,
      timeToLastToken,
      timeToGenerate: timeToLastToken - timeToFirstToken,
      adjustedTTFT: estimatedRequestLatency > 0 ? Math.max(0, timeToFirstToken - estimatedRequestLatency) : undefined,
      adjustedTTFS: estimatedRequestLatency > 0 ? Math.max(0, timeToFirstSentence - estimatedRequestLatency) : undefined,
      hasThinkingTag: thinkingTagEnded,
      thinkingTagDelay: thinkingTagEnded ? timeToEndOfThinking - timeToFirstToken : undefined,
      optimised: context.optimisedLatency,
      systemPromptLengthBytes: JSON.stringify(context.systemPrompt).length,
      messagesLengthBytes: JSON.stringify(context.messages).length,
      messagesCount: context.messages.length,
      withCache: context.withCache,
      cacheReadInputTokens,
      cacheWriteInputTokens,
      temperature: context.temperature,
      maxTokens: context.maxTokens,
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