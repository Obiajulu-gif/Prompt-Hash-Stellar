import React from 'react';

export const PromptTrustMetadata: React.FC<{ creatorAddress: string; salesCount: number; contentHash: string; purchased: boolean }> = ({ creatorAddress, salesCount, contentHash, purchased }) => {
  return (
    <div className="flex flex-col space-y-2 text-sm text-gray-600 dark:text-gray-400 p-4 border rounded-md">
      <div className="flex justify-between">
        <span className="font-semibold">Creator:</span>
        <span className="truncate w-32" title={creatorAddress}>{creatorAddress}</span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold">Sales:</span>
        <span>{salesCount}</span>
      </div>
      <div className="flex justify-between">
        <span className="font-semibold">Hash:</span>
        <span className="truncate w-32" title={contentHash}>{contentHash}</span>
      </div>
      <div className="mt-4">
        {purchased ? (
          <button className="w-full bg-green-500 text-white py-2 rounded">Unlock Prompt</button>
        ) : (
          <button className="w-full bg-blue-500 text-white py-2 rounded">Buy Prompt</button>
        )}
      </div>
    </div>
  );
};
