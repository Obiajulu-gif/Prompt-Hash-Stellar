import { lazy, Suspense } from "react";
import { Outlet, Route, Routes, useLocation, Navigate } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { PageTransition } from "./components/animations/PageTransition";
import Home from "./pages/Home";

// Code Splitting / Lazy Loading Router Configurations
const BrowsePage = lazy(() => import("./pages/browse/page.tsx"));
const SellPage = lazy(() => import("./pages/sell/page.tsx"));
const ChatHome = lazy(() => import("./pages/chat/page.tsx"));
const ProfilePage = lazy(() => import("./pages/profile/page.tsx"));
const MyPurchasesPage = lazy(() => import("./pages/profile/MyPurchasesPage.tsx"));
const StatusPage = lazy(() => import("./pages/status/page.tsx"));
const SellerPage = lazy(() => import("./pages/sellers/page.tsx"));
const PromptDetailPage = lazy(() => import("./pages/prompts/PromptDetailPage.tsx"));
const CollectionsPage = lazy(() => import("./pages/collections/CollectionsPage.tsx"));
const CollectionDetailPage = lazy(() => import("./pages/collections/CollectionDetailPage.tsx"));
const PayoutSettingsPage = lazy(() => import("./pages/profile/PayoutSettingsPage.tsx"));
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
  <main className="min-h-screen bg-slate-950 text-white">
    <Outlet />
  </main>
);

function AppRoutes() {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<PageTransition><Home /></PageTransition>} />
          <Route path="/browse" element={<PageTransition><BrowsePage /></PageTransition>} />
          <Route path="/sell" element={<PageTransition><SellPage /></PageTransition>} />
          <Route path="/chat" element={<PageTransition><ChatHome /></PageTransition>} />
          <Route path="/profile" element={<PageTransition><ProfilePage /></PageTransition>} />
          <Route path="/purchases" element={<PageTransition><MyPurchasesPage /></PageTransition>} />
          <Route path="/prompts/:id" element={<PageTransition><PromptDetailPage /></PageTransition>} />
          <Route path="/status" element={<PageTransition><StatusPage /></PageTransition>} />
          <Route path="/sellers/:sellerId" element={<PageTransition><SellerPage /></PageTransition>} />
          <Route path="/collections" element={<PageTransition><CollectionsPage /></PageTransition>} />
          <Route path="/collections/:id" element={<PageTransition><CollectionDetailPage /></PageTransition>} />
          <Route path="/profile/payout-settings" element={<PageTransition><PayoutSettingsPage /></PageTransition>} />
          <Route path="*" element={<PageTransition><Home /></PageTransition>} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}

function App() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-slate-950">
          <div className="text-white text-lg">Loading...</div>
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