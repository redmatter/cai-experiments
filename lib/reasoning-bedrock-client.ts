import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseStreamCommandOutput,
  type Message,
  type SystemContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import { getAwsCredentials } from './aws-auth';

export interface ReasoningMetrics {
  ttftMs: number; // Time to first token
  totalLatencyMs: number;
  reasoningTokens: number;
  responseTokens: number;
  inputTokens: number;
  outputTokens: number;
}

export interface ReasoningResponse {
  text: string; // Only text blocks, reasoning blocks excluded
  metrics: ReasoningMetrics;
}

export class ReasoningBedrockClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private region: string;

  constructor(
    modelId: string = 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    region: string = 'us-east-1'
  ) {
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
    systemPrompt: string,
    messages: Message[],
    options: {
      reasoningBudgetTokens?: number;
      maxTokens?: number;
    } = {}
  ): Promise<ReasoningResponse> {
    const { reasoningBudgetTokens = 1024, maxTokens = 1024 } = options;

    const systemBlocks: SystemContentBlock[] = [
      {
        text: systemPrompt,
      },
    ];

    const converseCommand: ConverseCommandInput = {
      modelId: this.modelId,
      messages,
      system: systemBlocks,
      inferenceConfig: {
        maxTokens,
      },
      additionalModelRequestFields: {
        reasoning_config: {
          type: 'enabled',
          budget_tokens: reasoningBudgetTokens,
        },
      },
    };

    const startTime = Date.now();
    const response = await this.client.send(new ConverseStreamCommand(converseCommand));

    return this.parseStreamResponse(response, startTime);
  }

  private async parseStreamResponse(
    response: ConverseStreamCommandOutput,
    startTime: number
  ): Promise<ReasoningResponse> {
    let textContent = '';
    let ttftMs = 0;
    let firstTokenReceived = false;
    let reasoningTokens = 0;
    let responseTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    const { stream } = response;

    if (!stream) {
      throw new Error('No stream in response');
    }

    for await (const chunk of stream) {
      const now = Date.now();

      // Track TTFT on first content
      if (!firstTokenReceived && (chunk.contentBlockDelta || chunk.messageStart)) {
        ttftMs = now - startTime;
        firstTokenReceived = true;
      }

      // Collect text blocks only (discard reasoning blocks)
      if (chunk.contentBlockDelta?.delta?.text) {
        textContent += chunk.contentBlockDelta.delta.text;
      }

      // Collect metadata
      if (chunk.metadata?.usage) {
        inputTokens = chunk.metadata.usage.inputTokens ?? 0;
        outputTokens = chunk.metadata.usage.outputTokens ?? 0;
      }

      // Track reasoning vs response tokens
      // Note: Bedrock API may not separate these cleanly - this is a best-effort heuristic
      // In practice, we'll use outputTokens as responseTokens
    }

    const totalLatencyMs = Date.now() - startTime;

    // Best effort: assume all output tokens are response tokens
    // (reasoning tokens would be internal and not visible in standard usage metrics)
    responseTokens = outputTokens;

    return {
      text: textContent.trim(),
      metrics: {
        ttftMs,
        totalLatencyMs,
        reasoningTokens,
        responseTokens,
        inputTokens,
        outputTokens,
      },
    };
  }
}
