// Shared types across all tools

export interface ContentBlock {
  text: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: ContentBlock[];
}

export interface TestScenario {
  name: string;
  provider: 'bedrock' | 'anthropic';
  model: string;
  region?: string; // Required for Bedrock, optional for Anthropic
  optimisedLatency?: boolean;
  withCache?: boolean;
  temperature?: number;
  maxTokens?: number;
  promptTemplate: string; // File name of the prompt template
}

export interface PromptTemplate {
  systemPrompt: ContentBlock[];
  messages: Message[];
}

export interface Metrics {
  timestamp: string;
  provider: 'bedrock' | 'anthropic';
  model: string;
  region?: string;
  testName: string;
  latency: number;
  serverSideLatency?: number; // Bedrock-provided server-side latency (excludes network)
  networkOverhead?: number; // Calculated: timeToLastToken - serverSideLatency
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  timeToFirstToken: number;
  timeToFirstSentence: number; // Time to first sentence AFTER </thinking> tag if present
  timeToLastToken: number;
  timeToGenerate: number;
  adjustedTTFT?: number; // TTFT with network overhead removed (Bedrock only)
  adjustedTTFS?: number; // TTFS with network overhead removed (Bedrock only)
  hasThinkingTag?: boolean; // Whether response contains <thinking> tags
  thinkingTagDelay?: number; // Time spent generating thinking content (from TTFT to end of </thinking>)
  optimised?: boolean;
  systemPromptLengthBytes: number;
  messagesLengthBytes: number;
  messagesCount: number;
  withCache?: boolean;
  cacheReadInputTokenCount?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokenCount?: number;
  cacheWriteInputTokens?: number;
  temperature: number;
  maxTokens: number;
}

export interface ModelResponse {
  metrics: Metrics;
  output: {
    message: Message;
  };
}