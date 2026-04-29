import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar
} from 'recharts';
import { mockDailySales, mockRecentSales } from '../../data/mockAnalytics';

export default function Analytics() {
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalSales, setTotalSales] = useState(0);

  useEffect(() => {
    // Calculate totals from mock data on mount
    const rev = mockDailySales.reduce((sum, day) => sum + day.revenue, 0);
    const sales = mockDailySales.reduce((sum, day) => sum + day.sales, 0);
    setTotalRevenue(rev);
    setTotalSales(sales);
  }, []);

  const truncateAddress = (address: string) => {
    if (!address) return '';
    if (address.length <= 10) return address;
    return `${address.slice(0, 5)}...${address.slice(-4)}`;
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-8 text-gray-900 dark:text-white">Creator Analytics</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white dark:bg-gray-950 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Revenue</h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{totalRevenue} XLM</p>
        </div>
        <div className="bg-white dark:bg-gray-950 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
          <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400">Total Sales</h3>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-2">{totalSales}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Revenue Chart */}
        <div className="bg-white dark:bg-gray-950 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Daily Revenue (XLM)</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={mockDailySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111827', borderColor: '#1F2937', color: '#F9FAFB' }}
                  itemStyle={{ color: '#60A5FA' }}
                />
                <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} activeDot={{ r: 8 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Sales Chart */}
        <div className="bg-white dark:bg-gray-950 p-6 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
          <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-white">Daily Sales Count</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mockDailySales}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" opacity={0.3} />
                <XAxis dataKey="date" stroke="#9CA3AF" fontSize={12} />
                <YAxis stroke="#9CA3AF" fontSize={12} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111827', borderColor: '#1F2937', color: '#F9FAFB' }}
                  itemStyle={{ color: '#10B981' }}
                />
                <Bar dataKey="sales" fill="#10B981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Recent Activity Feed */}
      <div className="bg-white dark:bg-gray-950 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-800">
          <h3 className="text-lg font-bold text-gray-900 dark:text-white">Recent Sales</h3>
        </div>
        <div className="divide-y divide-gray-200 dark:divide-gray-800">
          {mockRecentSales.map((sale) => (
            <div key={sale.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{sale.promptTitle}</p>
                <div className="flex items-center mt-1 text-sm text-gray-500 dark:text-gray-400">
                  <span>Buyer: {truncateAddress(sale.buyer)}</span>
                  <span className="mx-2">•</span>
                  <span>{new Date(sale.date).toLocaleDateString()} {new Date(sale.date).toLocaleTimeString()}</span>
                </div>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  +{sale.amount} XLM
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}