const assert = require('node:assert/strict');
const {
  COMPANY_API_BASE_URL,
  COMPANY_API_MODEL,
  CompanyApiError,
  requestCompanyChatCompletion,
  verifyCompanyApiModel,
} = require('../electron/company-api-service.cjs');

const apiKey = 'test-secret-never-log';
let request;
const fetchMock = async (url, options) => {
  request = { url, options };
  return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"test"}' } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

async function main() {
  const content = await requestCompanyChatCompletion(apiKey, '研修概要を使ってください。', fetchMock);
  assert.equal(content, '{"title":"test"}');
  assert.equal(request.url, `${COMPANY_API_BASE_URL}/v1/chat/completions`);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${apiKey}`);
  assert.equal(request.options.redirect, 'error');
  const body = JSON.parse(request.options.body);
  assert.equal(body.model, COMPANY_API_MODEL);
  assert.equal(body.messages[1].content, '研修概要を使ってください。');
  assert.equal(body.response_format.type, 'json_object');
  assert.equal(body.messages.some((message) => message.role === 'system'), true);

  await verifyCompanyApiModel(apiKey, async (url, options) => {
    assert.equal(url, `${COMPANY_API_BASE_URL}/v1/models`);
    assert.equal(options.headers.Authorization, `Bearer ${apiKey}`);
    return new Response(JSON.stringify({ data: [{ id: COMPANY_API_MODEL }] }), { status: 200 });
  });

  await assert.rejects(
    () => verifyCompanyApiModel(apiKey, async () => new Response(JSON.stringify({ data: [{ id: 'other-model' }] }), { status: 200 })),
    (error) => error instanceof CompanyApiError && error.kind === 'model-unavailable',
  );
  await assert.rejects(
    () => requestCompanyChatCompletion(apiKey, 'prompt', async () => new Response('secret provider body', { status: 401 })),
    (error) => error instanceof CompanyApiError
      && error.kind === 'authentication-error'
      && !error.message.includes(apiKey)
      && !error.message.includes('secret provider body'),
  );
  await assert.rejects(
    () => requestCompanyChatCompletion(apiKey, 'prompt', async () => new Response('private details', { status: 429 })),
    (error) => error instanceof CompanyApiError && error.kind === 'rate-limit' && !error.message.includes('private details'),
  );

  console.log('Company API contract, model verification, and sanitized HTTP failures passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});