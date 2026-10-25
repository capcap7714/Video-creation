const fs = require('node:fs/promises');
const path = require('node:path');

const scenarioRequest = {
  title: 'C言語の変数入門',
  overview: 'C言語における変数の宣言、値の代入、基本的な型の違いを初心者向けに説明します。',
  audience: 'C言語を初めて学ぶ社内研修の受講者',
  chapterCount: 2,
  targetMinutes: 3,
};

async function main() {
  const { CopilotClient } = await import('@github/copilot-sdk');
  const { generateScenarioDraft } = await import('../src/scenario.ts');
  const client = new CopilotClient({
    mode: 'copilot-cli',
    logLevel: 'error',
  });

  try {
    await client.start();
    const auth = await client.getAuthStatus();
    console.log(JSON.stringify({
      authenticated: auth.isAuthenticated,
      authType: auth.authType,
      status: auth.isAuthenticated ? 'Authenticated' : auth.statusMessage,
    }, null, 2));

    if (!auth.isAuthenticated) {
      console.log('Copilot CLI sign-in is required before testing model requests.');
      return;
    }

    const draft = await generateScenarioDraft(client, scenarioRequest);
    const outputPath = path.resolve(__dirname, '../test-results/copilot-scenario-draft.json');
    await fs.writeFile(outputPath, `${JSON.stringify(draft, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(draft, null, 2));
    console.log(`Scenario draft saved: ${outputPath}`);
  } finally {
    await client.stop();
  }
}

main().catch((error) => {
  console.error(`Copilot SDK smoke test failed: ${error.message}`);
  process.exitCode = 1;
});