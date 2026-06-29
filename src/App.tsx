import React from "react";
import { Outlet, Route, Routes, Navigate } from "react-router-dom";
import Home from "./pages/Home";
import BrowsePage from "./pages/browse/page.jsx";
import SellPage from "./pages/sell/page.tsx";
import ChatHome from "./pages/chat/page.tsx";
import ProfilePage from "./pages/profile/page.tsx";
import AdminDashboard from "./pages/admin/Dashboard.tsx";

// 1. Define your allowed Stellar admin wallet addresses
const ALLOWED_ADMINS = [
  "GBADMINWALLETADDRESSEXAMPLE1234567890YOURREALADDRESS", // Replace with your test Stellar address
].map((addr) => addr.toUpperCase());

// 2. Create a small wrapper guard component
function AdminGuard({ children }: { children: React.ReactNode }) {
  const connectedWallet = (window as any).stellarWalletAddress?.toUpperCase();

  // DEVELOPMENT MODE BYPASS: If no wallet window mock is injected yet, 
  // we let you see the page so you can test the "Ban User" buttons.
  if (!connectedWallet) {
    return <>{children}</>;
  }

  // Once a wallet IS mock-injected, strict validation takes over:
  if (!ALLOWED_ADMINS.includes(connectedWallet)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

const AppLayout = () => (
  <main className="min-h-screen bg-slate-950 text-white">
    <Outlet />
  </main>
);

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/sell" element={<SellPage />} />
        <Route path="/chat" element={<ChatHome />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route
          path="/admin"
          element={
            <AdminGuard>
              <AdminDashboard />
            </AdminGuard>
          }
        />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}

export default App;