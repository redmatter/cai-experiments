import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandInput,
} from '@aws-sdk/client-bedrock-runtime';
import { getAwsCredentials } from './aws-auth';

export interface NovaResponse {
  text: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
}

export class NovaClient {
  private client: BedrockRuntimeClient;
  private modelId: string;
  private region: string;

  constructor(modelId: string = 'global.amazon.nova-2-lite-v1:0', region: string = 'us-east-1') {
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
    prompt: string,
    options: {
      maxTokens?: number;
      temperature?: number;
    } = {}
  ): Promise<NovaResponse> {
    const { maxTokens = 50, temperature = 0.7 } = options;

    const converseCommand: ConverseCommandInput = {
      modelId: this.modelId,
      messages: [
        {
          role: 'user',
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens,
        temperature,
      },
    };

    const startTime = Date.now();
    const response = await this.client.send(new ConverseCommand(converseCommand));
    const latencyMs = Date.now() - startTime;

    // Extract text from response
    const textContent = response.output?.message?.content?.[0];
    if (!textContent || textContent.text === undefined) {
      throw new Error('No text content in Nova response');
    }

    const text = textContent.text.trim();

    // Extract token usage
    const inputTokens = response.usage?.inputTokens ?? 0;
    const outputTokens = response.usage?.outputTokens ?? 0;

    return {
      text,
      latencyMs,
      inputTokens,
      outputTokens,
    };
  }

}
