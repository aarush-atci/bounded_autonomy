import { TEST_COVERAGE_ANALYZER_PROMPT } from '../prompts';
import { TestCoverageResultJSONSchema } from '../types';

/**
 * Test Coverage Analyzer Agent
 * Evaluates test completeness and identifies coverage gaps
 */
export const testCoverageAnalyzerAgent = {
  description: 'Analyzes code for test coverage gaps and suggests missing test cases',
  prompt: TEST_COVERAGE_ANALYZER_PROMPT,
  outputSchema: TestCoverageResultJSONSchema as Record<string, unknown>
};
