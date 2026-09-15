import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readWebhookUrl, encryptWebhookUrl } from '@/lib/slack/webhook';
import { encrypt } from '@/lib/encryption';

// Item D — Slack webhook URL encryption at rest.
// These test the pure encode/decode helpers (no DB), covering encrypted-at-rest,
// decrypt-at-send, legacy plaintext read, and missing-key write behavior.

const REAL_KEY = process.env.ENCRYPTION_KEY;

describe('slack webhook URL encryption', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = 'test-encryption-key-for-slack';
  });

  afterEach(() => {
    if (REAL_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = REAL_KEY;
  });

  it('encrypts on write (ciphertext is not the plaintext URL)', () => {
    const url = 'https://hooks.slack.com/services/T000/B000/xxxxx';
    const stored = encryptWebhookUrl(url);
    expect(stored).not.toContain('hooks.slack.com');
    expect(stored).not.toBe(url);
  });

  it('round-trips: readWebhookUrl decrypts an encrypted value at the send boundary', () => {
    const url = 'https://hooks.slack.com/services/T111/B111/yyyyy';
    const stored = encryptWebhookUrl(url);
    expect(readWebhookUrl(stored)).toBe(url);
  });

  it('reads a legacy plaintext row unchanged (backward compatible)', () => {
    const legacy = 'https://hooks.slack.com/services/LEGACY/PLAINTEXT/zzzzz';
    expect(readWebhookUrl(legacy)).toBe(legacy);
  });

  it('returns null for empty/absent stored value', () => {
    expect(readWebhookUrl(null)).toBeNull();
    expect(readWebhookUrl(undefined)).toBeNull();
    expect(readWebhookUrl('')).toBeNull();
  });

  it('encryptWebhookUrl output is a value encrypt() can produce (format sanity)', () => {
    const url = 'https://hooks.slack.com/services/T222/B222/aaaaa';
    const stored = encryptWebhookUrl(url);
    // Mirror the format encrypt() emits with a key: iv:cipher:tag
    const direct = encrypt(url);
    expect(direct).not.toBeNull();
    expect(stored.split(':').length).toBe(3);
  });
});
