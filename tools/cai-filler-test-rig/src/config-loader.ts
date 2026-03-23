import { parse } from 'yaml';
import type { TestRunConfig, FillerStrategy } from './types';

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export async function loadConfig(configPath: string): Promise<TestRunConfig> {
  try {
    const file = Bun.file(configPath);
    const content = await file.text();
    const config = parse(content) as any;

    // Validate required fields
    validateRequired(config, 'run_id');
    validateRequired(config, 'description');
    validateRequired(config, 'aws_region');
    validateRequired(config, 'reasoning_model');
    validateRequired(config, 'fast_model');
    validateRequired(config, 'reasoning_budget_tokens');
    validateRequired(config, 'filler_strategy');
    validateRequired(config, 'conversations_per_prompt');
    validateRequired(config, 'turns_per_conversation');
    validateRequired(config, 'tts_words_per_minute');
    validateRequired(config, 'bridge_filler_threshold_ms');
    validateRequired(config, 'output_csv');
    validateRequired(config, 'system_prompts');

    // Validate types
    if (typeof config.run_id !== 'string') {
      throw new ConfigValidationError('run_id must be a string');
    }
    if (typeof config.description !== 'string') {
      throw new ConfigValidationError('description must be a string');
    }
    if (typeof config.aws_region !== 'string') {
      throw new ConfigValidationError('aws_region must be a string');
    }
    if (typeof config.reasoning_model !== 'string') {
      throw new ConfigValidationError('reasoning_model must be a string');
    }
    if (typeof config.fast_model !== 'string') {
      throw new ConfigValidationError('fast_model must be a string');
    }
    if (typeof config.reasoning_budget_tokens !== 'number') {
      throw new ConfigValidationError('reasoning_budget_tokens must be a number');
    }
    if (typeof config.conversations_per_prompt !== 'number') {
      throw new ConfigValidationError('conversations_per_prompt must be a number');
    }
    if (typeof config.turns_per_conversation !== 'number') {
      throw new ConfigValidationError('turns_per_conversation must be a number');
    }
    if (typeof config.tts_words_per_minute !== 'number') {
      throw new ConfigValidationError('tts_words_per_minute must be a number');
    }
    if (typeof config.bridge_filler_threshold_ms !== 'number') {
      throw new ConfigValidationError('bridge_filler_threshold_ms must be a number');
    }
    if (typeof config.output_csv !== 'string') {
      throw new ConfigValidationError('output_csv must be a string');
    }

    // Validate filler_strategy
    const validStrategies = ['dynamic', 'intent_conditioned', 'opening_sentence', 'both', 'all', 'none'];
    if (!validStrategies.includes(config.filler_strategy)) {
      throw new ConfigValidationError(
        `filler_strategy must be one of: ${validStrategies.join(', ')}`
      );
    }

    // Validate system_prompts
    if (!Array.isArray(config.system_prompts)) {
      throw new ConfigValidationError('system_prompts must be an array');
    }
    if (config.system_prompts.length === 0) {
      throw new ConfigValidationError('system_prompts must contain at least one prompt');
    }

    for (const prompt of config.system_prompts) {
      if (!prompt.id || typeof prompt.id !== 'string') {
        throw new ConfigValidationError('Each system_prompt must have an id (string)');
      }
      if (!prompt.text || typeof prompt.text !== 'string') {
        throw new ConfigValidationError('Each system_prompt must have text (string)');
      }
    }

    // Validate ranges
    if (config.reasoning_budget_tokens < 1 || config.reasoning_budget_tokens > 8192) {
      throw new ConfigValidationError('reasoning_budget_tokens must be between 1 and 8192');
    }
    if (config.conversations_per_prompt < 1) {
      throw new ConfigValidationError('conversations_per_prompt must be at least 1');
    }
    if (config.turns_per_conversation < 1) {
      throw new ConfigValidationError('turns_per_conversation must be at least 1');
    }
    if (config.tts_words_per_minute < 1) {
      throw new ConfigValidationError('tts_words_per_minute must be at least 1');
    }
    if (config.bridge_filler_threshold_ms < 0) {
      throw new ConfigValidationError('bridge_filler_threshold_ms must be non-negative');
    }

    return config as TestRunConfig;
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      throw error;
    }
    throw new ConfigValidationError(
      `Failed to load config from ${configPath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function validateRequired(config: any, field: string): void {
  if (config[field] === undefined || config[field] === null) {
    throw new ConfigValidationError(`Missing required field: ${field}`);
  }
}

export function printConfig(config: TestRunConfig): void {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║               Test Run Configuration                        ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`  Run ID: ${config.run_id}`);
  console.log(`  Description: ${config.description}`);
  console.log(`  Region: ${config.aws_region}`);
  console.log(`  Reasoning Model: ${config.reasoning_model}`);
  console.log(`  Fast Model: ${config.fast_model}`);
  console.log(`  Reasoning Budget: ${config.reasoning_budget_tokens} tokens`);
  console.log(`  Filler Strategy: ${config.filler_strategy}`);
  console.log(`  Conversations per Prompt: ${config.conversations_per_prompt}`);
  console.log(`  Turns per Conversation: ${config.turns_per_conversation}`);
  console.log(`  TTS WPM: ${config.tts_words_per_minute}`);
  console.log(`  Bridge Threshold: ${config.bridge_filler_threshold_ms}ms`);
  console.log(`  Output: ${config.output_csv}`);
  console.log(`  System Prompts: ${config.system_prompts.length}`);
  config.system_prompts.forEach((p) => {
    console.log(`    - ${p.id}`);
  });
  console.log('╚══════════════════════════════════════════════════════════════╝');
}
