import React from 'react';

export const EmptyState: React.FC<{ title: string; description: string; action?: React.ReactNode }> = ({ title, description, action }) => {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border rounded-lg bg-gray-50 dark:bg-gray-900">
      <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100">{title}</h3>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
};
