import { CODE_QUALITY_ANALYZER_PROMPT } from '../prompts';
import { CodeQualityResultJSONSchema } from '../types';

/**
 * Code Quality Analyzer Agent
 * Identifies code issues, anti-patterns, and quality problems
 */
export const codeQualityAnalyzerAgent = {
  description: 'Analyzes code for quality issues including security, performance, and maintainability problems',
  prompt: CODE_QUALITY_ANALYZER_PROMPT,
  tools: ['Read', 'Grep', 'Glob', 'Skill'],
  outputSchema: CodeQualityResultJSONSchema as Record<string, unknown>
};
