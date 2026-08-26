import React from 'react';

export const TransactionTimeline: React.FC<{ status: 'idle' | 'pending' | 'success' | 'error'; steps: string[] }> = ({ status, steps }) => {
  return (
    <div className="flex flex-col space-y-2">
      {steps.map((step, index) => (
        <div key={index} className="flex items-center space-x-2">
          <div className={`w-4 h-4 rounded-full ${status === 'pending' && index === steps.length - 1 ? 'bg-blue-500 animate-pulse' : 'bg-green-500'}`} />
          <span className="text-sm text-gray-700 dark:text-gray-300">{step}</span>
        </div>
      ))}
      {status === 'error' && (
        <div className="text-red-500 text-sm mt-2">Transaction failed. Please try again.</div>
      )}
    </div>
  );
};
