// CAI Filler Test Rig - Type Definitions

export interface TestRunConfig {
  run_id: string;
  description: string;
  aws_region: string;
  reasoning_model: string;
  fast_model: string;
  reasoning_budget_tokens: number;
  filler_strategy: 'dynamic' | 'intent_conditioned' | 'opening_sentence' | 'both' | 'all' | 'none';
  conversations_per_prompt: number;
  turns_per_conversation: number;
  tts_words_per_minute: number;
  bridge_filler_threshold_ms: number;
  output_csv: string;
  system_prompts: SystemPrompt[];
}

export interface SystemPrompt {
  id: string;
  text: string;
}

export interface FillerPair {
  primary: string;
  bridge: string;
}

export interface ConversationTurn {
  user_utterance: string;
  assistant_response: string;
}

export interface TurnMetrics {
  run_id: string;
  conversation_id: string;
  turn_number: number;
  system_prompt_id: string;
  filler_strategy: string;
  user_utterance: string;
  detected_intent: string;
  filler_phrase: string;
  bridge_filler_phrase: string;
  fast_llm_latency_ms: number;
  reasoning_llm_ttft_ms: number;
  filler_audio_duration_ms: number;
  bridge_audio_duration_ms: number;
  buffer_gap_ms: number;
  bridge_filler_triggered: boolean;
  reasoning_tokens_used: number;
  response_text_tokens: number;
  coherence_score: number;
  coherence_explanation: string;
  response_text: string;
  total_perceived_latency_ms: number;
}

export interface ConversationHistory {
  turns: ConversationTurn[];
}

export type FillerStrategy = 'dynamic' | 'intent_conditioned' | 'opening_sentence' | 'none';

export const INTENT_CATEGORIES = [
  'QUESTION',
  'REQUEST',
  'COMPLAINT',
  'CLARIFICATION',
  'GREETING',
  'OTHER',
] as const;

export type IntentCategory = typeof INTENT_CATEGORIES[number];
