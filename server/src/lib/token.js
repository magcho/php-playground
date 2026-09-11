const WEAK_RUNNER_TOKENS = new Set([
  '',
  'change-me',
  'change-me-to-a-long-random-string',
  'changeme',
  'secret',
  'password',
  'runner-token',
]);

/**
 * Reject missing / placeholder RUNNER_TOKEN values.
 * @param {string} token
 * @returns {string|null} error message if invalid
 */
export function runnerTokenError(token) {
  const value = String(token || '').trim();
  if (!value) return 'RUNNER_TOKEN is required';
  if (WEAK_RUNNER_TOKENS.has(value)) {
    return 'RUNNER_TOKEN is a placeholder — set a long random secret in .env';
  }
  if (value.length < 16) {
    return 'RUNNER_TOKEN must be at least 16 characters';
  }
  return null;
}
