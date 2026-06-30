import React, { useState, useEffect } from 'react';

interface UserRow {
  id: string;
  address: string;
  status: 'ACTIVE' | 'BANNED';
  createdAt: string;
}

export default function AdminDashboard() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [analytics, setAnalytics] = useState({ totalUsers: 0, totalPrompts: 0 });
  const [loading, setLoading] = useState(true);

  // Fetch live network metrics on load
  useEffect(() => {
    async function fetchAdminMetrics() {
      try {
        const [analyticsRes, usersRes] = await Promise.all([
          fetch('http://localhost:3000/api/v1/admin/analytics'),
          fetch('http://localhost:3000/api/v1/admin/users')
        ]);

        if (analyticsRes.ok && usersRes.ok) {
          const analyticsData = await analyticsRes.json();
          const usersData = await usersRes.json();
          setAnalytics(analyticsData);
          setUsers(usersData);
          return; // Exit early if real data handles it
        }
      } catch (_error) {
        console.warn('Backend offline, parsing local development mock metrics fallback matrix.');
      }

      // Safe local development fallbacks so the dashboard is never completely empty
      setAnalytics({ totalUsers: 2, totalPrompts: 45 });
      setUsers([
        { id: '1', address: 'GD...1234', status: 'ACTIVE', createdAt: '2026-06-01' },
        { id: '2', address: 'GC...5678', status: 'ACTIVE', createdAt: '2026-06-15' },
      ]);
      setLoading(false);
    }

    fetchAdminMetrics().finally(() => setLoading(false));
  }, []);

  const handleToggleBan = async (id: string, currentStatus: 'ACTIVE' | 'BANNED') => {
    const nextStatus = currentStatus === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    
    try {
      // 2. Fire patch mutation downstream to the moderation endpoint
      const response = await fetch(`http://localhost:3000/api/v1/admin/prompts/${id}/moderate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: nextStatus })
      });

      if (response.ok) {
        setUsers(users.map(u => u.id === id ? { ...u, status: nextStatus } : u));
      }
    } catch (error) {
      console.error('Failed to commit moderation hook state upstream:', error);
    }
  };

  if (loading) return <div style={{ padding: '2rem', color: '#fff' }}>Loading Analytics Matrix...</div>;

  return (
    <div style={{ padding: '2rem', backgroundColor: '#121214', color: '#fff', minHeight: '100vh' } as React.CSSProperties}>
      <h1 style={{ marginBottom: '1.5rem', fontSize: '1.75rem' } as React.CSSProperties}>Admin Control Center</h1>
      
      {/* Metrics Row */}
      <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '2rem' } as React.CSSProperties}>
        <div style={{ background: '#202024', padding: '1.5rem', borderRadius: '8px', minWidth: '150px' } as React.CSSProperties}>
          <p style={{ color: '#8d8d99', fontSize: '0.875rem' } as React.CSSProperties}>Total Users</p>
          <h2 style={{ fontSize: '2rem', margin: '0.5rem 0 0' } as React.CSSProperties}>{analytics.totalUsers}</h2>
        </div>
        <div style={{ background: '#202024', padding: '1.5rem', borderRadius: '8px', minWidth: '150px' } as React.CSSProperties}>
          <p style={{ color: '#8d8d99', fontSize: '0.875rem' } as React.CSSProperties}>Total Prompts Indexed</p>
          <h2 style={{ fontSize: '2rem', margin: '0.5rem 0 0' } as React.CSSProperties}>{analytics.totalPrompts}</h2>
        </div>
      </div>

      {/* User Management Table */}
      <h3 style={{ marginBottom: '1rem' } as React.CSSProperties}>Registered Management Matrix</h3>
      <div style={{ overflowX: 'auto', background: '#202024', borderRadius: '8px' } as React.CSSProperties}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' } as React.CSSProperties}>
          <thead>
            <tr style={{ borderBottom: '1px solid #323238', color: '#c4c4cc' } as React.CSSProperties}>
              <th style={{ padding: '1rem' }}>Wallet Address</th>
              <th style={{ padding: '1rem' }}>Joined Date</th>
              <th style={{ padding: '1rem' }}>Status</th>
              <th style={{ padding: '1rem', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '2rem', textAlign: 'center', color: '#8d8d99' }}>No users currently registered in index pool.</td>
              </tr>
            ) : (
              users.map((user) => (
                <tr key={user.id} style={{ borderBottom: '1px solid #323238' } as React.CSSProperties}>
                  <td style={{ padding: '1rem', fontFamily: 'monospace' } as React.CSSProperties}>{user.address}</td>
                  <td style={{ padding: '1rem' } as React.CSSProperties}>{user.createdAt}</td>
                  <td style={{ padding: '1rem' } as React.CSSProperties}>
                    <span style={{ 
                      padding: '0.25rem 0.5rem', 
                      borderRadius: '4px', 
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      background: user.status === 'BANNED' ? '#aa2834' : '#015f43',
                      color: '#fff'
                    } as React.CSSProperties}>
                      {user.status || 'ACTIVE'}
                    </span>
                  </td>
                  <td style={{ padding: '1rem', textAlign: 'right' } as React.CSSProperties}>
                    <button 
                      onClick={() => handleToggleBan(user.id, user.status)}
                      style={{
                        background: user.status === 'BANNED' ? '#015f43' : '#aa2834',
                        color: '#fff',
                        border: 'none',
                        padding: '0.4rem 0.8rem',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '0.875rem'
                      } as React.CSSProperties}
                    >
                      {user.status === 'BANNED' ? 'Unban' : 'Ban User'}
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}