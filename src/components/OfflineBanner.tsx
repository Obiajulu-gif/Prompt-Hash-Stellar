import React, { useEffect, useState } from 'react';
import { WifiOff, RefreshCw } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export const OfflineBanner: React.FC = () => {
  const { isOnline } = useNetworkStatus();
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  useEffect(() => {
    const timestamp = localStorage.getItem('lastCacheRefresh');
    if (timestamp) {
      setLastRefresh(new Date(parseInt(timestamp, 10)).toLocaleString());
    }
  }, [isOnline]);

  if (isOnline) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-3 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-col text-amber-500">
          <div className="flex items-center gap-3">
            <WifiOff className="h-5 w-5" />
            <p className="text-sm font-medium">
              You are currently offline. Viewing cached public listings. Wallet actions and purchases are disabled.
            </p>
          </div>
          {lastRefresh && (
            <p className="text-xs text-amber-500/80 mt-1 ml-8">
              Data last refreshed: {lastRefresh}
            </p>
          )}
        </div>
        <button
          onClick={() => window.location.reload()}
          className="flex items-center gap-2 rounded-md bg-amber-500/20 px-3 py-1.5 text-sm font-medium text-amber-500 hover:bg-amber-500/30 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Reconnect
        </button>
      </div>
    </div>
  );
};
