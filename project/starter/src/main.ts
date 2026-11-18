import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Main entry point for the Claude Multi-Agent Code Review System
 * Usage: npm run dev <owner> <repo> <pr-number>
 */
async function main() {
  const [owner, repo, prStr] = process.argv.slice(2);

  // Validate command line arguments
  if (!owner || !repo || !prStr) {
    console.error('Usage: npm run dev <owner> <repo> <pr-number>');
    console.error('Example: npm run dev anthropics anthropic-sdk 123');
    process.exit(1);
  }

  const prNumber = parseInt(prStr, 10);
  if (isNaN(prNumber) || prNumber <= 0) {
    console.error('Error: PR number must be a valid positive integer');
    process.exit(1);
  }

  // Validate authentication (choose ONE method)
  const hasAnthropicAuth = process.env.ANTHROPIC_API_KEY;
  const hasBedrockAuth = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;

  if (!hasAnthropicAuth && !hasBedrockAuth) {
    console.error('Error: Missing authentication credentials');
    console.error('Please set ONE of the following:');
    console.error('  Option 1 (Anthropic API): ANTHROPIC_API_KEY');
    console.error('  Option 2 (AWS Bedrock): AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION');
    process.exit(1);
  }

  if (hasBedrockAuth) {
    if (!process.env.AWS_REGION) {
      console.error('Error: AWS_REGION is required when using AWS Bedrock authentication');
      process.exit(1);
    }
    console.log('🔐 Using AWS Bedrock authentication');
  } else {
    console.log('🔐 Using Anthropic API authentication');
  }

  // Validate ANTHROPIC_MODEL environment variable
  if (!process.env.ANTHROPIC_MODEL) {
    console.error('Error: ANTHROPIC_MODEL environment variable is required');
    console.error('For AWS Bedrock: us.anthropic.claude-sonnet-4-5-20250929-v1:0');
    console.error('For Anthropic API: claude-sonnet-4-5-20250929');
    process.exit(1);
  }

  try {
    // Create orchestrator instance
    const { CodeReviewOrchestrator } = await import('./orchestrator');
    const orchestrator = new CodeReviewOrchestrator();

    // Review the pull request
    console.log(`\n📝 Reviewing PR #${prNumber} in ${owner}/${repo}...`);
    const report = await orchestrator.reviewPullRequest(owner, repo, prNumber);

    // Generate formatted reports
    const { ReportGenerator } = await import('./utils');
    const generator = new ReportGenerator();

    // Create reports directory if it doesn't exist
    const { mkdir } = await import('fs/promises');
    const { existsSync } = await import('fs');
    if (!existsSync('reports')) {
      await mkdir('reports', { recursive: true });
    }

    // Generate and save reports
    const baseName = `${owner}-${repo}-pr-${prNumber}`;

    const markdownReport = generator.generateMarkdownReport(report);
    const { writeFile } = await import('fs/promises');
    await writeFile(`reports/${baseName}.md`, markdownReport);
    console.log(`✅ Saved Markdown report to reports/${baseName}.md`);

    const htmlReport = generator.generateHTMLReport(report);
    await writeFile(`reports/${baseName}.html`, htmlReport);
    console.log(`✅ Saved HTML report to reports/${baseName}.html`);

    const jsonReport = generator.generateJSONReport(report);
    await writeFile(`reports/${baseName}.json`, jsonReport);
    console.log(`✅ Saved JSON report to reports/${baseName}.json`);

    console.log('\n✨ Code review complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
