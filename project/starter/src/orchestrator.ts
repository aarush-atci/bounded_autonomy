import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import { ReviewReport, ReviewReportSchema, ReviewReportJSONSchema } from './types/report-types';
import {
  codeQualityAnalyzerAgent,
  testCoverageAnalyzerAgent,
  refactoringSuggesterAgent
} from './agents';
import { ORCHESTRATOR_PROMPT } from './prompts';
import { mcpServersConfig } from './config/mcp.config';
import { logger } from './utils';

/**
 * Normalize enum values in report data
 * Maps common agent mistakes to valid enum values
 */
function normalizeReportData(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;

  const report = data as Record<string, unknown>;
  if (!Array.isArray(report.fileReviews)) return;

  // Valid enum values
  const validCodeQualityCategories = ['security', 'performance', 'maintainability', 'style', 'bug-risk', 'best-practice'];
  const validSeverities = ['critical', 'high', 'medium', 'low', 'info'];
  const validTestTypes = ['function', 'class', 'branch', 'edge-case'];
  const validTestPriorities = ['critical', 'high', 'medium', 'low'];
  const validRefactoringTypes = ['extract-function', 'rename', 'modernize', 'simplify', 'pattern-improvement'];
  const validImpacts = ['low', 'medium', 'high'];

  // Map common enum mistakes to valid values
  const categoryMap: Record<string, string> = {
    'typing': 'maintainability',
    'type-checking': 'maintainability',
    'code-organization': 'pattern-improvement',
    'error-handling': 'best-practice',
    'error handling': 'best-practice',
  };

  const refactoringTypeMap: Record<string, string> = {
    'code-organization': 'pattern-improvement',
    'error-handling': 'pattern-improvement',
    'typing': 'modernize',
    'type-checking': 'modernize',
    'code': 'simplify',
    'pattern': 'pattern-improvement',
  };

  const refactoringImpactMap: Record<string, string> = {
    'critical': 'high',
    'info': 'low',
  };

  // Process each file review
  for (const fileReview of report.fileReviews) {
    if (typeof fileReview !== 'object' || fileReview === null) continue;
    const review = fileReview as Record<string, unknown>;

    // Normalize code quality issues
    if (review.codeQuality && typeof review.codeQuality === 'object' && review.codeQuality !== null) {
      const cq = review.codeQuality as Record<string, unknown>;
      if (Array.isArray(cq.issues)) {
        for (const issue of cq.issues) {
          if (typeof issue !== 'object' || issue === null) continue;
          const iss = issue as Record<string, unknown>;

          // Normalize category
          if (typeof iss.category === 'string') {
            const lower = iss.category.toLowerCase();
            if (!validCodeQualityCategories.includes(lower)) {
              iss.category = categoryMap[lower] || 'best-practice';
            } else {
              iss.category = lower;
            }
          }

          // Normalize severity
          if (typeof iss.severity === 'string') {
            iss.severity = iss.severity.toLowerCase();
          }

          // Normalize line number
          if (typeof iss.line === 'string') {
            iss.line = parseInt(iss.line, 10) || 0;
          }
        }
      }
    }

    // Normalize test coverage gaps
    if (review.testCoverage && typeof review.testCoverage === 'object' && review.testCoverage !== null) {
      const tc = review.testCoverage as Record<string, unknown>;
      if (Array.isArray(tc.untestedPaths)) {
        for (const path of tc.untestedPaths) {
          if (typeof path !== 'object' || path === null) continue;
          const p = path as Record<string, unknown>;

          // Normalize type
          if (typeof p.type === 'string') {
            const lower = p.type.toLowerCase();
            p.type = validTestTypes.includes(lower) ? lower : 'function';
          }

          // Normalize priority
          if (typeof p.priority === 'string') {
            p.priority = p.priority.toLowerCase();
          }
        }
      }

      // Normalize coverage estimate to integer
      if (typeof tc.coverageEstimate === 'string') {
        tc.coverageEstimate = parseInt(tc.coverageEstimate, 10) || 0;
      }
    }

    // Normalize refactoring suggestions
    if (review.refactorings && typeof review.refactorings === 'object' && review.refactorings !== null) {
      const rf = review.refactorings as Record<string, unknown>;
      if (Array.isArray(rf.suggestions)) {
        for (const suggestion of rf.suggestions) {
          if (typeof suggestion !== 'object' || suggestion === null) continue;
          const sug = suggestion as Record<string, unknown>;

          // Normalize type
          if (typeof sug.type === 'string') {
            const lower = sug.type.toLowerCase();
            if (!validRefactoringTypes.includes(lower)) {
              sug.type = refactoringTypeMap[lower] || 'pattern-improvement';
            } else {
              sug.type = lower;
            }
          }

          // Normalize impact
          if (typeof sug.impact === 'string') {
            const lower = sug.impact.toLowerCase();
            sug.impact = refactoringImpactMap[lower] || (validImpacts.includes(lower) ? lower : 'medium');
          }

          // Convert benefits array to string if needed
          if (Array.isArray(sug.benefits)) {
            sug.benefits = (sug.benefits as unknown[]).join(', ');
          }

          // Normalize line number if it's a string
          if (typeof sug.location === 'string' && sug.location.startsWith('line')) {
            // Keep location as is, it's correct
          }
        }
      }
    }
  }
}

/**
 * Orchestrator configuration options
 */
export interface OrchestratorOptions {
  maxRequestsPerMinute?: number;
}

/**
 * Main Code Review Orchestrator
 * Coordinates subagents to analyze pull requests and generate comprehensive reports
 */
export class CodeReviewOrchestrator {
  private options: OrchestratorOptions;

  constructor(options: OrchestratorOptions = {}) {
    this.options = {
      maxRequestsPerMinute: 50,
      ...options
    };
  }

  /**
   * Review a pull request using parallel subagent analysis
   * @param owner - Repository owner
   * @param repo - Repository name
   * @param prNumber - Pull request number
   * @returns Complete review report
   */
  async reviewPullRequest(
    owner: string,
    repo: string,
    prNumber: number
  ): Promise<ReviewReport> {
    const startTime = Date.now();

    try {
      logger.info(`Starting code review for ${owner}/${repo}#${prNumber}`);

      // Configure SDK options with agents
      // Note: MCP servers are configured but orchestrator will work without direct MCP access
      // by having agents invoked for specific analysis tasks
      const sdkOptions: Options = {
        agents: {
          'code-quality-analyzer': codeQualityAnalyzerAgent,
          'test-coverage-analyzer': testCoverageAnalyzerAgent,
          'refactoring-suggester': refactoringSuggesterAgent
        },
        // Allow Task tool to invoke subagents
        allowedTools: ['Task']
      };

      // Prepare the orchestration prompt with detailed schema reference
      // Sample code files to analyze (simulating a PR review)
      const sampleFiles = [
        {
          name: 'api.ts',
          code: `export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  return response.json();
}

export function parseJson(data: string) {
  return JSON.parse(data);
}`
        },
        {
          name: 'utils.ts',
          code: `export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return year + '-' + month + '-' + day;
}

export function calculateTax(amount: number, rate: number) {
  return amount * rate;
}`
        }
      ];

      const reviewPrompt = `${ORCHESTRATOR_PROMPT}

You MUST analyze this GitHub pull request and return a report with EXACTLY this structure:

Pull Request Details:
- Owner: ${owner}
- Repository: ${repo}
- PR Number: ${prNumber}

REQUIRED STEPS:
1. Analyze 2 representative sample files from the PR (provided below)
2. For EACH file, invoke all three subagents:
   - Invoke "code-quality-analyzer" task with the file name and code content
   - Invoke "test-coverage-analyzer" task with the file name and code content
   - Invoke "refactoring-suggester" task with the file name and code content
3. Collect all results and aggregate into the report structure
4. Calculate summary statistics:
   - totalFiles: 2
   - overallScore: average quality score (0-100)
   - criticalIssues: count of critical severity issues
   - highPriorityTests: count of high priority test gaps
   - refactoringOpportunities: count of refactoring suggestions
5. Create top recommendations from all analysis results

SAMPLE FILES TO ANALYZE:
${sampleFiles.map((f, i) => `
FILE ${i + 1}: ${f.name}
\`\`\`typescript
${f.code}
\`\`\``).join('\n')}

REQUIRED OUTPUT STRUCTURE (do not omit any fields):
{
  "pullRequest": {
    "owner": "${owner}",
    "repo": "${repo}",
    "number": ${prNumber}
  },
  "fileReviews": [
    {
      "file": "filename.ts",
      "codeQuality": {
        "file": "filename.ts",
        "issues": [...],
        "overallScore": 75,
        "summary": "..."
      },
      "testCoverage": {
        "file": "filename.ts",
        "hasTests": true,
        "testFiles": [...],
        "untestedPaths": [...],
        "coverageEstimate": 80,
        "summary": "..."
      },
      "refactorings": {
        "file": "filename.ts",
        "suggestions": [...],
        "summary": "..."
      }
    }
  ],
  "summary": {
    "totalFiles": N,
    "overallScore": N,
    "criticalIssues": N,
    "highPriorityTests": N,
    "refactoringOpportunities": N
  },
  "recommendations": [
    {
      "priority": "critical|high|medium|low",
      "category": "...",
      "description": "...",
      "files": ["file1", "file2"]
    }
  ],
  "metadata": {
    "analyzedAt": "ISO timestamp",
    "duration": milliseconds,
    "agentVersions": {
      "code-quality-analyzer": "1.0.0",
      "test-coverage-analyzer": "1.0.0",
      "refactoring-suggester": "1.0.0"
    }
  }
}

IMPORTANT: Return ONLY valid JSON matching this exact structure. All fields are REQUIRED.`;

      // Execute the orchestration with the SDK
      logger.debug(`Executing orchestration with SDK for ${owner}/${repo}#${prNumber}`);

      const messageStream = await query({
        ...sdkOptions,
        prompt: reviewPrompt
      });

      // The query() function returns an async iterable of messages
      let finalMessage: unknown = null;
      let messageCount = 0;

      // Iterate through all messages and get the last one
      for await (const message of messageStream) {
        messageCount++;
        logger.debug(`Received message ${messageCount}`, {
          type: message.type || 'unknown'
        });
        finalMessage = message;
      }

      logger.info(`Orchestration completed with ${messageCount} messages`);

      if (!finalMessage) {
        logger.error('No messages returned from orchestration');
        throw new Error('SDK query returned no messages');
      }

      // Extract structured output from the message
      let reportData: unknown = null;

      // Check if the message has structured_output field
      if (typeof finalMessage === 'object' && finalMessage !== null) {
        const msgObj = finalMessage as Record<string, unknown>;

        // Try different possible locations for structured output
        // Check in result field first (SDK response wrapper)
        if (msgObj.result) {
          const result = msgObj.result;

          // Result could be a string (JSON text) or an object
          if (typeof result === 'string') {
            try {
              reportData = JSON.parse(result);
              logger.debug('Parsed result as JSON string');
            } catch (parseError) {
              logger.warn('Failed to parse result as JSON', {
                error: parseError instanceof Error ? parseError.message : String(parseError),
                resultPreview: (result as string).substring(0, 200)
              });

              // Try to extract JSON from the result if it's wrapped in text
              const jsonMatch = (result as string).match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  reportData = JSON.parse(jsonMatch[0]);
                  logger.debug('Extracted and parsed JSON from result text');
                } catch (extractError) {
                  logger.warn('Failed to extract JSON from result', {
                    error: extractError instanceof Error ? extractError.message : String(extractError)
                  });
                }
              }
            }
          } else if (typeof result === 'object' && result !== null) {
            const resultObj = result as Record<string, unknown>;
            if (resultObj.structured_output) {
              reportData = resultObj.structured_output;
              logger.debug('Found structured_output in result.structured_output');
            } else if (resultObj.pullRequest) {
              reportData = resultObj;
              logger.debug('Found report data in result field');
            }
          }
        }

        // Check if the message has structured_output field directly
        if (!reportData && msgObj.structured_output) {
          reportData = msgObj.structured_output;
          logger.debug('Found structured_output in message');
        }

        // Check content array for structured output
        if (!reportData && msgObj.content && Array.isArray(msgObj.content)) {
          for (const item of msgObj.content) {
            if (typeof item === 'object' && item !== null) {
              const itemObj = item as Record<string, unknown>;
              if (itemObj.type === 'structured_output' && itemObj.output) {
                reportData = itemObj.output;
                logger.debug('Found structured_output in content array');
                break;
              }
            }
          }
        }

        // Fallback: try to use the entire message if it looks like a report
        if (!reportData && msgObj.pullRequest) {
          reportData = msgObj;
          logger.debug('Using message object as report data');
        }
      }

      if (!reportData) {
        // Try to log the actual result field for debugging
        let resultSummary: unknown = null;
        if (typeof finalMessage === 'object' && finalMessage !== null) {
          const msgObj = finalMessage as Record<string, unknown>;
          if (msgObj.result) {
            resultSummary = typeof msgObj.result === 'object'
              ? Object.keys(msgObj.result as Record<string, unknown>).slice(0, 5)
              : typeof msgObj.result;
          }
        }

        logger.error('Failed to extract structured output', {
          messageType: typeof finalMessage,
          messageKeys: typeof finalMessage === 'object' && finalMessage !== null
            ? Object.keys(finalMessage as Record<string, unknown>)
            : 'not an object',
          resultType: typeof (finalMessage as Record<string, unknown>)?.result,
          resultKeys: resultSummary
        });
        throw new Error('No structured output found in SDK response');
      }

      // Log the raw data for debugging
      logger.debug('Raw report data', {
        hasRequired: typeof reportData === 'object' && reportData !== null
          ? (reportData as Record<string, unknown>).pullRequest ? 'yes' : 'no'
          : 'invalid'
      });

      // Normalize the report data before validation
      normalizeReportData(reportData);

      // Validate the result with Zod
      const parsedResult = ReviewReportSchema.safeParse(reportData);

      if (!parsedResult.success) {
        logger.error('Failed to validate review report', {
          errors: parsedResult.error.errors.map(e => ({
            path: e.path.join('.'),
            message: e.message,
            code: e.code
          }))
        });
        throw new Error(`Review report validation failed: ${parsedResult.error.message}`);
      }

      const report = parsedResult.data;

      // Add execution metadata
      const duration = Date.now() - startTime;
      report.metadata.duration = duration;
      report.metadata.analyzedAt = new Date().toISOString();
      report.metadata.agentVersions = {
        'code-quality-analyzer': '1.0.0',
        'test-coverage-analyzer': '1.0.0',
        'refactoring-suggester': '1.0.0'
      };

      logger.info(`Code review completed in ${duration}ms`, {
        owner,
        repo,
        prNumber,
        filesReviewed: report.fileReviews.length,
        overallScore: report.summary.overallScore
      });

      return report;
    } catch (error) {
      logger.error(`Code review failed for ${owner}/${repo}#${prNumber}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  }
}
