import { lazy, Suspense } from "react";
import { Outlet, Route, Routes, Navigate } from "react-router-dom";
import Home from "./pages/Home";

// Code Splitting / Lazy Loading Router Configurations
const BrowsePage = lazy(() => import("./pages/browse/page.tsx"));
const SellPage = lazy(() => import("./pages/sell/page.tsx"));
const ChatHome = lazy(() => import("./pages/chat/page.tsx"));
const ProfilePage = lazy(() => import("./pages/profile/page.tsx"));
// Lazy load your new administrative layout entry block
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard.tsx"));

// 1. Define your allowed Stellar admin wallet addresses
const ALLOWED_ADMINS = [
  "GBADMINWALLETADDRESSEXAMPLE124567890YOURREALADDRESS", // Replace with your test Stellar address
].map((addr) => addr.toUpperCase());

// 2. Create your wrapper guard component
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
  <main className="min-h-screen bg-background text-foreground">
    <Outlet />
  </main>
);

function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="text-foreground text-lg">Loading...</div>
        </div>
      }
    >
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<BrowsePage />} />
          <Route path="/sell" element={<SellPage />} />
          <Route path="/chat" element={<ChatHome />} />
          <Route path="/profile" element={<ProfilePage />} />
          
          {/* Admin Dashboard Route with Active Authentication Guard */}
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
    </Suspense>
  );
}

export default App;