import { readFile } from 'fs/promises';
import { join } from 'path';
import type { TestScenario, PromptTemplate } from './types';

export interface LoadedScenario extends Omit<TestScenario, 'promptTemplate'> {
  systemPrompt: PromptTemplate['systemPrompt'];
  messages: PromptTemplate['messages'];
}

/**
 * Loads test scenarios from a config file and merges with prompt templates.
 */
export async function loadScenarios(
  configFilePath: string,
  templateDir: string
): Promise<LoadedScenario[]> {
  console.log(`📖 Reading config file: ${configFilePath}`);

  const configData = await readFile(configFilePath, 'utf-8');
  const scenarios: TestScenario[] = JSON.parse(configData);

  const loadedScenarios: LoadedScenario[] = [];

  for (const scenario of scenarios) {
    const templatePath = join(templateDir, scenario.promptTemplate);
    console.log(`  → Reading template: ${templatePath}`);

    const templateData = await readFile(templatePath, 'utf-8');
    const template: PromptTemplate = JSON.parse(templateData);

    loadedScenarios.push({
      name: scenario.name,
      provider: scenario.provider,
      model: scenario.model,
      region: scenario.region,
      optimisedLatency: scenario.optimisedLatency ?? false,
      withCache: scenario.withCache ?? false,
      temperature: scenario.temperature ?? 0.2,
      maxTokens: scenario.maxTokens ?? 1024,
      systemPrompt: template.systemPrompt,
      messages: template.messages,
    });
  }

  return loadedScenarios;
}