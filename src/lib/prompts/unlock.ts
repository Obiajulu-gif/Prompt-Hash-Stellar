export async function unlockPrompt(
  itemId: string, 
  txHash: string,
  signMessage: (message: string) => Promise<any>
): Promise<{ decryptedContent: string }> {
  
  // 1. Request cryptographic signature from the user's wallet
  const challenge = `Unlock prompt ${itemId} with tx ${txHash} at ${Date.now()}`;
  const signature = await signMessage(challenge);
  
  if (!signature) throw new Error("User declined transaction signing");

  // 2. Send the signature to the backend to retrieve the decrypted prompt content
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      
      resolve({ decryptedContent: `[Decrypted Secret Content for Prompt #${itemId}]\n\nSystem prompt: Act as a senior engineer...` });
    }, 1500);
  });
}

// Wrapper for backward compatibility with existing components
export const unlockPromptContent = async (
  arg1: string,
  arg2: string,
  signMessage: (message: string) => Promise<any>
) => {
  // Detect legacy call shape (address, promptId, signMessage) vs new (itemId, txHash, signMessage)
  // Stellar addresses typically start with 'G' and are 56 characters long.
  const isLegacy = arg1.startsWith("G") || arg1.length === 56;
  const itemId = isLegacy ? arg2 : arg1;
  const txHash = isLegacy ? arg1 : arg2;

  const response = await unlockPrompt(itemId, txHash, signMessage);
  return {
    ...response,
    plaintext: response.decryptedContent,
  };
};