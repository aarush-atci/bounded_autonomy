import { describe, it, expect } from 'vitest';
import { CodeReviewOrchestrator } from '../src/orchestrator';
import { ReviewReportSchema, ReviewReportJSONSchema } from '../src/types/report-types';
import { ReportGenerator } from '../src/utils/report-generator';
import { withRetry, withTimeout } from '../src/utils/error-handler';
import { RateLimiter } from '../src/utils/rate-limiter';

/**
 * Tests for CodeReviewOrchestrator and related utilities
 *
 * Tests verify:
 * - Zod schema validation for ReviewReport
 * - ReportGenerator functionality
 * - Error handling with retry and timeout
 * - Rate limiter token bucket algorithm
 */

describe('CodeReviewOrchestrator', () => {
  describe('Configuration', () => {
    it('should initialize with default options', () => {
      const orchestrator = new CodeReviewOrchestrator();
      expect(orchestrator).toBeDefined();
      expect(orchestrator.reviewPullRequest).toBeDefined();
    });

    it('should accept custom rate limit configuration', () => {
      const customConfig = { maxRequestsPerMinute: 10 };
      const orchestrator = new CodeReviewOrchestrator(customConfig);
      expect(orchestrator).toBeDefined();
      expect(orchestrator).toHaveProperty('options');
    });
  });

  describe('ReviewReportSchema validation', () => {
    it('should validate a complete ReviewReport structure', () => {
      const validReport = {
        pullRequest: {
          owner: 'test-owner',
          repo: 'test-repo',
          number: 1
        },
        fileReviews: [
          {
            file: 'test.ts',
            codeQuality: {
              file: 'test.ts',
              issues: [
                {
                  line: 1,
                  severity: 'high',
                  category: 'security',
                  description: 'Test issue',
                  suggestion: 'Fix this'
                }
              ],
              overallScore: 75,
              summary: 'Issues found'
            },
            testCoverage: {
              file: 'test.ts',
              hasTests: true,
              testFiles: ['test.test.ts'],
              untestedPaths: [
                {
                  type: 'function',
                  location: 'testFunc at line 10',
                  priority: 'high',
                  reasoning: 'Not tested',
                  suggestedTest: 'Test this function'
                }
              ],
              coverageEstimate: 80,
              summary: 'Coverage analysis'
            },
            refactorings: {
              file: 'test.ts',
              suggestions: [
                {
                  type: 'simplify',
                  location: 'line 5',
                  impact: 'medium',
                  description: 'Simplify logic',
                  before: 'old code',
                  after: 'new code',
                  benefits: 'More readable'
                }
              ],
              summary: 'Refactoring opportunities'
            }
          }
        ],
        summary: {
          totalFiles: 1,
          overallScore: 75,
          criticalIssues: 0,
          highPriorityTests: 1,
          refactoringOpportunities: 1
        },
        recommendations: [
          {
            priority: 'high',
            category: 'testing',
            description: 'Add more tests',
            files: ['test.ts']
          }
        ],
        metadata: {
          analyzedAt: new Date().toISOString(),
          duration: 1000,
          agentVersions: {
            'code-quality-analyzer': '1.0.0',
            'test-coverage-analyzer': '1.0.0',
            'refactoring-suggester': '1.0.0'
          }
        }
      };

      const result = ReviewReportSchema.safeParse(validReport);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.pullRequest.owner).toBe('test-owner');
        expect(result.data.fileReviews).toHaveLength(1);
        expect(result.data.summary.totalFiles).toBe(1);
      }
    });

    it('should reject invalid ReviewReport with missing required fields', () => {
      const invalidReport = {
        pullRequest: { owner: 'test', repo: 'test', number: 1 },
        // Missing fileReviews, summary, recommendations, metadata
      };

      const result = ReviewReportSchema.safeParse(invalidReport);
      expect(result.success).toBe(false);
    });

    it('should reject ReviewReport with invalid enum values', () => {
      const invalidReport = {
        pullRequest: { owner: 'test', repo: 'test', number: 1 },
        fileReviews: [
          {
            file: 'test.ts',
            codeQuality: {
              file: 'test.ts',
              issues: [
                {
                  line: 1,
                  severity: 'invalid-severity',
                  category: 'security',
                  description: 'Test',
                  suggestion: 'Fix'
                }
              ],
              overallScore: 75,
              summary: 'Test'
            },
            testCoverage: {
              file: 'test.ts',
              hasTests: false,
              testFiles: [],
              untestedPaths: [],
              coverageEstimate: 0,
              summary: 'No tests'
            },
            refactorings: {
              file: 'test.ts',
              suggestions: [],
              summary: 'None'
            }
          }
        ],
        summary: { totalFiles: 1, overallScore: 50, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
        recommendations: [],
        metadata: { analyzedAt: new Date().toISOString(), duration: 0, agentVersions: {} }
      };

      const result = ReviewReportSchema.safeParse(invalidReport);
      expect(result.success).toBe(false);
    });
  });

  describe('RateLimiter', () => {
    it('should allow requests within rate limit', () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 10 });
      expect(limiter.canProceed()).toBe(true);
      expect(limiter.canProceed()).toBe(true);
    });

    it('should acquire and release requests', async () => {
      const limiter = new RateLimiter({ maxConcurrent: 2, maxRequestsPerMinute: 10 });
      expect(limiter.canProceed()).toBe(true);

      // Acquire two requests
      await limiter.acquire(100);
      await limiter.acquire(100);

      // After 2 acquires with maxConcurrent=2, should not be able to proceed
      expect(limiter.canProceed()).toBe(false);

      // Release both
      limiter.release();
      limiter.release();

      // Should be able to proceed again
      expect(limiter.canProceed()).toBe(true);
    });

    it('should provide status information', () => {
      const limiter = new RateLimiter({ maxRequestsPerMinute: 10, maxConcurrent: 5 });
      const status = limiter.getStatus();
      expect(status).toHaveProperty('activeRequests');
      expect(status).toHaveProperty('requestsInWindow');
      expect(status).toHaveProperty('tokensInWindow');
      expect(status.activeRequests).toBe(0);
    });
  });

  describe('Error handling utilities', () => {
    it('should retry failed operations with exponential backoff', async () => {
      let attempts = 0;
      const operation = async () => {
        attempts++;
        if (attempts < 3) throw new Error('Temporary failure');
        return 'success';
      };

      const result = await withRetry(operation, 3, 10);
      expect(result).toBe('success');
      expect(attempts).toBe(3);
    });

    it('should fail after max retry attempts', async () => {
      const operation = async () => {
        throw new Error('Permanent failure');
      };

      await expect(
        withRetry(operation, 2, 10)
      ).rejects.toThrow();
    });

    it('should enforce timeout on operations', async () => {
      const slowOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 200));
        return 'done';
      };

      await expect(
        withTimeout(slowOperation, 50)
      ).rejects.toThrow();
    });

    it('should complete operations within timeout', async () => {
      const fastOperation = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'success';
      };

      const result = await withTimeout(fastOperation, 100);
      expect(result).toBe('success');
    });
  });

  describe('ReportGenerator', () => {
    it('should generate valid markdown report', () => {
      const mockReport = {
        pullRequest: { owner: 'test', repo: 'test-repo', number: 1 },
        fileReviews: [],
        summary: { totalFiles: 0, overallScore: 50, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
        recommendations: [],
        metadata: { analyzedAt: new Date().toISOString(), duration: 1000, agentVersions: {} }
      };

      const generator = new ReportGenerator();
      const markdown = generator.generateMarkdownReport(mockReport);
      expect(markdown).toContain('Code Review Report');
      expect(markdown).toContain('Overall Score');
      expect(markdown).toContain('Duration');
    });

    it('should generate valid HTML report', () => {
      const mockReport = {
        pullRequest: { owner: 'test', repo: 'test-repo', number: 1 },
        fileReviews: [],
        summary: { totalFiles: 0, overallScore: 50, criticalIssues: 0, highPriorityTests: 0, refactoringOpportunities: 0 },
        recommendations: [],
        metadata: { analyzedAt: new Date().toISOString(), duration: 1000, agentVersions: {} }
      };

      const generator = new ReportGenerator();
      const html = generator.generateHTMLReport(mockReport);
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('Code Review Report');
      expect(html).toContain('Overall Score');
    });
  });

  describe('Integration', () => {
    // These tests require actual API keys and should be skipped in CI
    it.skip('should review a real small PR', async () => {
      // Test with a real public PR (e.g., anthropics/anthropic-sdk#1)
      // This test should only run manually with valid API keys
      // Verify complete end-to-end workflow
    });
  });
});
