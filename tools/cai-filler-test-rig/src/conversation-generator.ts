import { NovaClient } from '../../../lib/nova-client';
import type { SystemPrompt, ConversationHistory, ConversationTurn } from './types';

export interface GeneratedUtterance {
  text: string;
  turnNumber: number;
}

export class ConversationGenerator {
  private novaClient: NovaClient;
  private wordsPerMinute: number;

  constructor(novaClient: NovaClient, wordsPerMinute: number = 130) {
    this.novaClient = novaClient;
    this.wordsPerMinute = wordsPerMinute;
  }

  /**
   * Generate a single user utterance for the next turn in the conversation.
   */
  async generateUserUtterance(
    systemPrompt: SystemPrompt,
    history: ConversationHistory,
    turnNumber: number
  ): Promise<string> {
    const historyText = this.formatHistory(history);

    const prompt = `You are simulating a realistic end-user speaking to a voice assistant.
The assistant is configured as follows: ${systemPrompt.text}

Generate turn ${turnNumber} of a realistic spoken conversation.
Output only the user's utterance — a single natural sentence or question
as someone would actually say it on a phone call. Keep it under 20 words.
Do not include stage directions or labels.

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}Generate the next user utterance:`;

    const response = await this.novaClient.sendMessage(prompt, {
      maxTokens: 50,
      temperature: 0.9, // Higher temperature for more varied utterances
    });

    return response.text;
  }

  /**
   * Generate a mock assistant response to add to conversation history.
   * This is used to maintain coherent multi-turn context.
   */
  async generateAssistantResponse(
    systemPrompt: SystemPrompt,
    userUtterance: string,
    history: ConversationHistory
  ): Promise<string> {
    const historyText = this.formatHistory(history);

    const prompt = `${systemPrompt.text}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${userUtterance}

Generate a natural, helpful response as the assistant. Keep it conversational and concise (1-2 sentences).`;

    const response = await this.novaClient.sendMessage(prompt, {
      maxTokens: 100,
      temperature: 0.7,
    });

    return response.text;
  }

  /**
   * Generate a complete multi-turn conversation.
   */
  async generateConversation(
    systemPrompt: SystemPrompt,
    numTurns: number
  ): Promise<ConversationHistory> {
    const history: ConversationHistory = { turns: [] };

    for (let turnNumber = 1; turnNumber <= numTurns; turnNumber++) {
      // Generate user utterance
      const userUtterance = await this.generateUserUtterance(
        systemPrompt,
        history,
        turnNumber
      );

      // Generate assistant response for history continuity
      const assistantResponse = await this.generateAssistantResponse(
        systemPrompt,
        userUtterance,
        history
      );

      // Add to history
      history.turns.push({
        user_utterance: userUtterance,
        assistant_response: assistantResponse,
      });
    }

    return history;
  }

  private formatHistory(history: ConversationHistory): string {
    if (history.turns.length === 0) {
      return '';
    }

    return history.turns
      .map(
        (turn, idx) =>
          `Turn ${idx + 1}:\nUser: ${turn.user_utterance}\nAssistant: ${turn.assistant_response}`
      )
      .join('\n\n');
  }

  /**
   * Print a generated conversation to console.
   */
  printConversation(systemPromptId: string, history: ConversationHistory): void {
    console.log(`\n┌─── Conversation: ${systemPromptId} ───`);
    history.turns.forEach((turn, idx) => {
      console.log(`│`);
      console.log(`│ Turn ${idx + 1}:`);
      console.log(`│   User: ${turn.user_utterance}`);
      console.log(`│   Assistant: ${turn.assistant_response}`);
    });
    console.log(`└${'─'.repeat(40)}\n`);
  }
}
