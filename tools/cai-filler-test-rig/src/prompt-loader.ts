import { join } from 'path';
import { parse } from 'yaml';
import type { FillerPair, IntentCategory } from './types';

const PROMPTS_DIR = join(import.meta.dir, '../prompts');

export interface ConversationHistoryEntry {
  userUtterance: string;
  fillerPhrase: string;
}

export class PromptLoader {
  private dynamicPrompt: string | null = null;
  private intentPrompt: string | null = null;
  private openingSentencePrompt: string | null = null;
  private intentTemplates: Record<IntentCategory, FillerPair> | null = null;

  async initialize(): Promise<void> {
    // Load dynamic filler prompt
    const dynamicFile = Bun.file(join(PROMPTS_DIR, 'filler-dynamic.txt'));
    this.dynamicPrompt = await dynamicFile.text();

    // Load intent classification prompt
    const intentFile = Bun.file(join(PROMPTS_DIR, 'intent-classification.txt'));
    this.intentPrompt = await intentFile.text();

    // Load opening sentence prompt
    const openingFile = Bun.file(join(PROMPTS_DIR, 'filler-opening-sentence.txt'));
    this.openingSentencePrompt = await openingFile.text();

    // Load intent templates
    const templatesFile = Bun.file(join(PROMPTS_DIR, 'intent-templates.yaml'));
    const templatesYaml = await templatesFile.text();
    this.intentTemplates = parse(templatesYaml) as Record<IntentCategory, FillerPair>;
  }

  getDynamicPrompt(userUtterance: string, conversationHistory?: ConversationHistoryEntry[]): string {
    if (!this.dynamicPrompt) {
      throw new Error('Prompts not loaded. Call initialize() first.');
    }

    let historyText = '';
    if (conversationHistory && conversationHistory.length > 0) {
      historyText = 'Recent conversation (avoid repeating these fillers):\n';
      conversationHistory.forEach((entry, idx) => {
        historyText += `Turn ${idx + 1}:\n`;
        historyText += `  User: "${entry.userUtterance}"\n`;
        historyText += `  Filler used: "${entry.fillerPhrase}"\n`;
      });
      historyText += '\n';
    }

    return this.dynamicPrompt
      .replace('{{CONVERSATION_HISTORY}}', historyText)
      .replace('{{USER_UTTERANCE}}', userUtterance);
  }

  getOpeningSentencePrompt(
    userUtterance: string,
    conversationHistory?: ConversationHistoryEntry[],
    speechActTags?: string
  ): string {
    if (!this.openingSentencePrompt) {
      throw new Error('Prompts not loaded. Call initialize() first.');
    }

    let historyText = '';
    if (conversationHistory && conversationHistory.length > 0) {
      historyText = 'Recent conversation (vary your sentence structure):\n';
      conversationHistory.forEach((entry, idx) => {
        historyText += `Turn ${idx + 1}:\n`;
        historyText += `  User: "${entry.userUtterance}"\n`;
        historyText += `  Opening used: "${entry.fillerPhrase}"\n`;
      });
      historyText += '\n';
    }

    return this.openingSentencePrompt
      .replace('{{SPEECH_ACT_TAGS}}', speechActTags || '')
      .replace('{{CONVERSATION_HISTORY}}', historyText)
      .replace('{{USER_UTTERANCE}}', userUtterance);
  }

  getIntentClassificationPrompt(userUtterance: string): string {
    if (!this.intentPrompt) {
      throw new Error('Prompts not loaded. Call initialize() first.');
    }
    return this.intentPrompt.replace('{{USER_UTTERANCE}}', userUtterance);
  }

  getIntentTemplate(intent: string): FillerPair {
    if (!this.intentTemplates) {
      throw new Error('Intent templates not loaded. Call initialize() first.');
    }

    const upperIntent = intent.toUpperCase() as IntentCategory;

    if (upperIntent in this.intentTemplates) {
      return this.intentTemplates[upperIntent];
    }

    console.warn(`⚠️  Unknown intent "${intent}", falling back to OTHER`);
    return this.intentTemplates.OTHER;
  }

  getAllIntentTemplates(): Record<IntentCategory, FillerPair> {
    if (!this.intentTemplates) {
      throw new Error('Intent templates not loaded. Call initialize() first.');
    }
    return this.intentTemplates;
  }
}
