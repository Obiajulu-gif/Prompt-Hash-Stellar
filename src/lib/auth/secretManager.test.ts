import { describe, it, expect, vi } from 'vitest';
import { getSecret } from './secretManager';

vi.mock('@aws-sdk/client-secrets-manager', () => {
  const mockSend = vi.fn();
  return {
    SecretsManagerClient: vi.fn(() => ({ send: mockSend })),
    GetSecretValueCommand: vi.fn((params) => params),
    __mockSend: mockSend,
  };
});

const { __mockSend } = require('@aws-sdk/client-secrets-manager');

describe('getSecret', () => {
  it('should return the secret string when the secret exists', async () => {
    __mockSend.mockResolvedValueOnce({ SecretString: 'test-secret' });

    const secret = await getSecret('TEST_SECRET');
    expect(secret).toBe('test-secret');
  });

  it('should return null when the secret does not exist', async () => {
    __mockSend.mockResolvedValueOnce({});

    const secret = await getSecret('MISSING_SECRET');
    expect(secret).toBeNull();
  });

  it('should return null and log an error when the secret retrieval fails', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    __mockSend.mockRejectedValueOnce(new Error('Failed to retrieve secret'));

    const secret = await getSecret('ERROR_SECRET');
    expect(secret).toBeNull();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to retrieve secret ERROR_SECRET:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
  });
});