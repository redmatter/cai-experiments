import { join } from 'path';
import type { TurnMetrics } from './types';

const CSV_HEADERS = [
  'run_id',
  'conversation_id',
  'turn_number',
  'system_prompt_id',
  'filler_strategy',
  'user_utterance',
  'detected_intent',
  'filler_phrase',
  'bridge_filler_phrase',
  'fast_llm_latency_ms',
  'reasoning_llm_ttft_ms',
  'filler_audio_duration_ms',
  'bridge_audio_duration_ms',
  'buffer_gap_ms',
  'bridge_filler_triggered',
  'reasoning_tokens_used',
  'response_text_tokens',
  'coherence_score',
  'coherence_explanation',
  'response_text',
  'total_perceived_latency_ms',
] as const;

export class CsvReporter {
  private outputPath: string;
  private headerWritten: boolean = false;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
  }

  async initialize(): Promise<void> {
    // Check if file exists
    const file = Bun.file(this.outputPath);
    const exists = await file.exists();

    if (exists) {
      // File exists, assume header is already written
      this.headerWritten = true;
      console.log(`📄 Appending to existing CSV: ${this.outputPath}`);
    } else {
      // Write header
      await this.writeHeader();
      console.log(`📄 Created new CSV: ${this.outputPath}`);
    }
  }

  private async writeHeader(): Promise<void> {
    const header = CSV_HEADERS.join(',') + '\n';
    await Bun.write(this.outputPath, header);
    this.headerWritten = true;
  }

  async writeMetrics(metrics: TurnMetrics): Promise<void> {
    if (!this.headerWritten) {
      await this.writeHeader();
    }

    const row = CSV_HEADERS.map((header) => {
      const value = metrics[header as keyof TurnMetrics];

      // Handle different types
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'string') {
        // Strip newlines to prevent multi-line CSV fields breaking parsers
        const cleaned = value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
        const escaped = cleaned.replace(/"/g, '""');
        if (escaped.includes(',') || escaped.includes('"')) {
          return `"${escaped}"`;
        }
        return escaped;
      }
      if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
      }
      return String(value);
    }).join(',');

    // Append to file
    const file = Bun.file(this.outputPath);
    const existingContent = await file.text();
    await Bun.write(this.outputPath, existingContent + row + '\n');
  }

  getOutputPath(): string {
    return this.outputPath;
  }
}

export function calculateAudioDuration(text: string, wordsPerMinute: number): number {
  // Count words (split by whitespace)
  const words = text.trim().split(/\s+/).length;

  // Calculate duration in milliseconds
  // duration = (words / wpm) * 60000
  const durationMs = Math.round((words / wordsPerMinute) * 60000);

  return durationMs;
}

export function calculateBufferGap(
  fillerAudioDurationMs: number,
  reasoningTTFTMs: number
): number {
  // Negative gap means reasoning LLM was ready before filler ended (good)
  // Positive gap means we had to wait after filler ended (need bridge)
  return reasoningTTFTMs - fillerAudioDurationMs;
}
