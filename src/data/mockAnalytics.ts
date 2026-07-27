export interface DailySalesData {
  date: string;
  sales: number;
  revenue: number;
}

export interface SaleTransaction {
  id: string;
  promptTitle: string;
  buyer: string;
  date: string;
  amount: number;
}

export const mockDailySales: DailySalesData[] = [
  { date: '2023-10-01', sales: 4, revenue: 12 },
  { date: '2023-10-02', sales: 7, revenue: 21 },
  { date: '2023-10-03', sales: 3, revenue: 9 },
  { date: '2023-10-04', sales: 8, revenue: 24 },
  { date: '2023-10-05', sales: 5, revenue: 15 },
  { date: '2023-10-06', sales: 12, revenue: 36 },
  { date: '2023-10-07', sales: 9, revenue: 27 },
];

export const mockRecentSales: SaleTransaction[] = [
  { id: 'tx_1', promptTitle: 'GPT-4 Technical Architect', buyer: 'GABCD1234WXYZ5678', date: '2023-10-07T14:32:00Z', amount: 5 },
  { id: 'tx_2', promptTitle: 'Creative Storyteller Pro', buyer: 'GBXYZ9876ABCD5432', date: '2023-10-07T12:15:00Z', amount: 12 },
  { id: 'tx_3', promptTitle: 'GPT-4 Technical Architect', buyer: 'G1234ABCD5678WXYZ', date: '2023-10-06T09:45:00Z', amount: 5 },
  { id: 'tx_4', promptTitle: 'SEO Blog Outlines', buyer: 'G9876WXYZ5432ABCD', date: '2023-10-06T08:20:00Z', amount: 2 },
];