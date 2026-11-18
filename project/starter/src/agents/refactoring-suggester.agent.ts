import { REFACTORING_SUGGESTER_PROMPT } from '../prompts';
import { RefactoringSuggestionJSONSchema } from '../types';

/**
 * Refactoring Suggester Agent
 * Recommends architectural improvements and code modernization
 */
export const refactoringSuggesterAgent = {
  description: 'Suggests architectural improvements and refactoring opportunities',
  prompt: REFACTORING_SUGGESTER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  outputSchema: RefactoringSuggestionJSONSchema as Record<string, unknown>
};
