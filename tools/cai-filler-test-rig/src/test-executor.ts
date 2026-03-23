import { NovaClient } from '../../../lib/nova-client';
import { ReasoningBedrockClient } from '../../../lib/reasoning-bedrock-client';
import { ConversationGenerator } from './conversation-generator';
import { DynamicFillerGenerator } from './filler-dynamic';
import { IntentFillerGenerator } from './filler-intent';
import { OpeningSentenceGenerator } from './filler-opening-sentence';
import { ReasoningLLM } from './reasoning-llm';
import { CoherenceScorer } from './coherence-scorer';
import { StreamCoordinator } from './stream-coordinator';
import { CsvReporter } from './csv-reporter';
import { PromptLoader, type ConversationHistoryEntry } from './prompt-loader';
import type { TestRunConfig, TurnMetrics, FillerStrategy, SystemPrompt } from './types';

export class TestExecutor {
  private config: TestRunConfig;
  private novaClient: NovaClient;
  private reasoningClient: ReasoningBedrockClient;
  private conversationGenerator: ConversationGenerator;
  private dynamicFiller: DynamicFillerGenerator;
  private intentFiller: IntentFillerGenerator;
  private openingSentenceFiller: OpeningSentenceGenerator;
  private reasoningLLM: ReasoningLLM;
  private coherenceScorer: CoherenceScorer;
  private coordinator: StreamCoordinator;
  private csvReporter: CsvReporter;
  private promptLoader: PromptLoader;

  constructor(config: TestRunConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    console.log('🔧 Initializing clients...\n');

    // Initialize prompt loader
    this.promptLoader = new PromptLoader();
    await this.promptLoader.initialize();
    console.log('✅ Filler prompts loaded');

    // Initialize Nova client (fast LLM)
    this.novaClient = new NovaClient(this.config.fast_model, this.config.aws_region);
    await this.novaClient.initialize();
    console.log(`✅ Nova client initialized: ${this.config.fast_model}`);

    // Initialize Reasoning client
    this.reasoningClient = new ReasoningBedrockClient(
      this.config.reasoning_model,
      this.config.aws_region
    );
    await this.reasoningClient.initialize();
    console.log(`✅ Reasoning client initialized: ${this.config.reasoning_model}`);

    // Initialize all components
    this.conversationGenerator = new ConversationGenerator(
      this.novaClient,
      this.config.tts_words_per_minute
    );
    this.dynamicFiller = new DynamicFillerGenerator(this.novaClient, this.promptLoader);
    this.intentFiller = new IntentFillerGenerator(this.novaClient, this.promptLoader);
    this.openingSentenceFiller = new OpeningSentenceGenerator(this.novaClient, this.promptLoader);
    this.reasoningLLM = new ReasoningLLM(this.reasoningClient);
    this.coherenceScorer = new CoherenceScorer(this.novaClient);
    this.coordinator = new StreamCoordinator();

    // Initialize CSV reporter
    this.csvReporter = new CsvReporter(this.config.output_csv);
    await this.csvReporter.initialize();

    console.log('\n✅ All components initialized\n');
  }

  async executeDryRun(): Promise<void> {
    console.log('🔍 Dry-run mode: Generating conversations only\n');
    console.log('='.repeat(80) + '\n');

    for (const systemPrompt of this.config.system_prompts) {
      console.log(`\n📝 System Prompt: ${systemPrompt.id}`);
      console.log('─'.repeat(80));

      for (let convNum = 1; convNum <= this.config.conversations_per_prompt; convNum++) {
        console.log(`\n  Conversation ${convNum}/${this.config.conversations_per_prompt}:`);

        const history = await this.conversationGenerator.generateConversation(
          systemPrompt,
          this.config.turns_per_conversation
        );

        this.conversationGenerator.printConversation(
          `${systemPrompt.id}-${convNum}`,
          history
        );
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Dry-run complete\n');
  }

  async executeFullRun(): Promise<void> {
    console.log('🚀 Starting full test execution\n');
    console.log('='.repeat(80) + '\n');

    const strategies = this.getStrategies();
    let totalTurns = 0;
    let bridgeFillerCount = 0;

    for (const systemPrompt of this.config.system_prompts) {
      console.log(`\n📝 System Prompt: ${systemPrompt.id}`);
      console.log('─'.repeat(80));

      for (let convNum = 1; convNum <= this.config.conversations_per_prompt; convNum++) {
        const conversationId = `${this.config.run_id}_${systemPrompt.id}_${convNum}`;
        console.log(`\n  🗣️  Conversation ${convNum}/${this.config.conversations_per_prompt}`);

        // Generate conversation
        const history = await this.conversationGenerator.generateConversation(
          systemPrompt,
          this.config.turns_per_conversation
        );

        // Track conversation history for filler diversity (per conversation)
        const conversationHistoryMap = new Map<FillerStrategy, ConversationHistoryEntry[]>();

        // Execute each turn with each strategy
        for (let turnNum = 0; turnNum < history.turns.length; turnNum++) {
          const turn = history.turns[turnNum];
          const turnNumber = turnNum + 1;

          console.log(`\n    Turn ${turnNumber}: "${turn.user_utterance.substring(0, 50)}${turn.user_utterance.length > 50 ? '...' : ''}"`);

          for (const strategy of strategies) {
            console.log(`      Strategy: ${strategy}`);

            // Get conversation history for this strategy
            const strategyHistory = conversationHistoryMap.get(strategy) || [];

            let metrics: TurnMetrics | null = null;
            for (let attempt = 1; attempt <= 3; attempt++) {
              try {
                metrics = await this.executeTurn(
                  conversationId,
                  turnNumber,
                  systemPrompt,
                  turn.user_utterance,
                  strategy,
                  strategyHistory
                );
                break;
              } catch (error) {
                const msg = error instanceof Error ? error.message : String(error);
                if (attempt < 3 && msg.includes('http2')) {
                  console.warn(`        ⚠️  HTTP2 error, retrying (${attempt}/3)...`);
                  await new Promise(r => setTimeout(r, 1000));
                } else {
                  console.error(`        ❌ Failed: ${msg}`);
                  break;
                }
              }
            }

            if (!metrics) continue;

            await this.csvReporter.writeMetrics(metrics);
            totalTurns++;

            if (metrics.bridge_filler_triggered) {
              bridgeFillerCount++;
            }

            // Update conversation history for this strategy (for filler diversity)
            if (metrics.filler_phrase) {
              if (!conversationHistoryMap.has(strategy)) {
                conversationHistoryMap.set(strategy, []);
              }
              conversationHistoryMap.get(strategy)!.push({
                userUtterance: turn.user_utterance,
                fillerPhrase: metrics.filler_phrase,
              });
            }

            // Print key metrics
            console.log(`        ⏱️  Perceived latency: ${metrics.total_perceived_latency_ms}ms`);
            console.log(`        🎯 TTFT: ${metrics.reasoning_llm_ttft_ms}ms`);
            console.log(`        📊 Coherence: ${metrics.coherence_score}/5`);
            if (metrics.bridge_filler_triggered) {
              console.log(`        🌉 Bridge filler: YES`);
            }
          }
        }
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Test execution complete\n');
    console.log(`📊 Results: ${totalTurns} turns executed`);
    console.log(`🌉 Bridge filler triggered: ${bridgeFillerCount}/${totalTurns} (${((bridgeFillerCount / totalTurns) * 100).toFixed(1)}%)`);
    console.log(`📄 CSV output: ${this.csvReporter.getOutputPath()}\n`);
  }

  private getStrategies(): FillerStrategy[] {
    if (this.config.filler_strategy === 'all') {
      return ['dynamic', 'intent_conditioned', 'opening_sentence', 'none'];
    }
    if (this.config.filler_strategy === 'both') {
      return ['dynamic', 'intent_conditioned', 'none'];
    }
    return [this.config.filler_strategy as FillerStrategy];
  }

  private async executeTurn(
    conversationId: string,
    turnNumber: number,
    systemPrompt: SystemPrompt,
    userUtterance: string,
    strategy: FillerStrategy,
    conversationHistory?: ConversationHistoryEntry[]
  ): Promise<TurnMetrics> {
    if (strategy === 'none') {
      return await this.executeBaselineTurn(
        conversationId,
        turnNumber,
        systemPrompt,
        userUtterance
      );
    }

    // Generate filler
    let fillerResult: { filler: any; latencyMs: number; detectedIntent: string };

    if (strategy === 'dynamic') {
      fillerResult = await this.dynamicFiller.generateFiller(userUtterance, conversationHistory);
    } else if (strategy === 'opening_sentence') {
      fillerResult = await this.openingSentenceFiller.generateFiller(userUtterance, conversationHistory);
    } else {
      fillerResult = await this.intentFiller.generateFiller(userUtterance);
    }

    // Start reasoning LLM
    // Key architectural difference: opening_sentence runs reasoning independently
    // (no filler context injection), other strategies inject filler as prior turn
    const maxTokens = Math.max(2048, this.config.reasoning_budget_tokens + 1024);

    const reasoningPromise = this.reasoningLLM.executeWithFillerContext({
      systemPrompt: systemPrompt.text,
      userUtterance,
      fillerPhrase: fillerResult.filler.primary,
      reasoningBudgetTokens: this.config.reasoning_budget_tokens,
      maxTokens,
    });

    // Coordinate execution
    const coordination = await this.coordinator.coordinateParallelExecution({
      filler: fillerResult.filler,
      fastLLMLatencyMs: fillerResult.latencyMs,
      reasoningPromise,
      bridgeThresholdMs: this.config.bridge_filler_threshold_ms,
      wordsPerMinute: this.config.tts_words_per_minute,
    });

    // Score coherence
    const firstSentence = this.reasoningLLM.extractFirstSentence(
      coordination.reasoningResponse.text
    );
    const coherenceResult = await this.coherenceScorer.scoreCoherence(
      coordination.fillerPhrase,
      firstSentence
    );

    // Build metrics
    return {
      run_id: this.config.run_id,
      conversation_id: conversationId,
      turn_number: turnNumber,
      system_prompt_id: systemPrompt.id,
      filler_strategy: strategy,
      user_utterance: userUtterance,
      detected_intent: fillerResult.detectedIntent,
      filler_phrase: coordination.fillerPhrase,
      bridge_filler_phrase: coordination.bridgeFillerPhrase,
      fast_llm_latency_ms: coordination.fastLLMLatencyMs,
      reasoning_llm_ttft_ms: coordination.reasoningLLMTTFTMs,
      filler_audio_duration_ms: coordination.fillerAudioDurationMs,
      bridge_audio_duration_ms: coordination.bridgeAudioDurationMs,
      buffer_gap_ms: coordination.bufferGapMs,
      bridge_filler_triggered: coordination.bridgeFillerTriggered,
      reasoning_tokens_used: coordination.reasoningResponse.metrics.reasoningTokens,
      response_text_tokens: coordination.reasoningResponse.metrics.responseTokens,
      coherence_score: coherenceResult.score,
      coherence_explanation: coherenceResult.explanation,
      response_text: firstSentence,
      total_perceived_latency_ms: coordination.totalPerceivedLatencyMs,
    };
  }

  private async executeBaselineTurn(
    conversationId: string,
    turnNumber: number,
    systemPrompt: SystemPrompt,
    userUtterance: string
  ): Promise<TurnMetrics> {
    // No filler, direct reasoning LLM call
    // maxTokens must be greater than reasoning_budget_tokens
    const maxTokens = Math.max(2048, this.config.reasoning_budget_tokens + 1024);
    const reasoningPromise = this.reasoningLLM.executeBaseline({
      systemPrompt: systemPrompt.text,
      userUtterance,
      reasoningBudgetTokens: this.config.reasoning_budget_tokens,
      maxTokens,
    });

    const coordination = await this.coordinator.coordinateBaseline(reasoningPromise);

    const firstSentence = this.reasoningLLM.extractFirstSentence(
      coordination.reasoningResponse.text
    );

    return {
      run_id: this.config.run_id,
      conversation_id: conversationId,
      turn_number: turnNumber,
      system_prompt_id: systemPrompt.id,
      filler_strategy: 'none',
      user_utterance: userUtterance,
      detected_intent: '',
      filler_phrase: '',
      bridge_filler_phrase: '',
      fast_llm_latency_ms: 0,
      reasoning_llm_ttft_ms: coordination.reasoningLLMTTFTMs,
      filler_audio_duration_ms: 0,
      bridge_audio_duration_ms: 0,
      buffer_gap_ms: 0,
      bridge_filler_triggered: false,
      reasoning_tokens_used: coordination.reasoningResponse.metrics.reasoningTokens,
      response_text_tokens: coordination.reasoningResponse.metrics.responseTokens,
      coherence_score: -1, // No coherence scoring for baseline
      coherence_explanation: '',
      response_text: firstSentence,
      total_perceived_latency_ms: coordination.totalPerceivedLatencyMs,
    };
  }
}
