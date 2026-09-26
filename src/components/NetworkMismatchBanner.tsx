import React from 'react';

export const NetworkMismatchBanner: React.FC<{ expectedNetwork: string; currentNetwork: string }> = ({ expectedNetwork, currentNetwork }) => {
  if (expectedNetwork === currentNetwork) return null;

  return (
    <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4" role="alert">
      <p className="font-bold">Network Mismatch</p>
      <p>Please switch your wallet network to {expectedNetwork}. You are currently connected to {currentNetwork}.</p>
    </div>
  );
};
