import { lazy, Suspense } from "react";
import { Outlet, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";

const BrowsePage = lazy(() => import("./pages/browse/page.jsx"));
const SellPage = lazy(() => import("./pages/sell/page.tsx"));
const ChatHome = lazy(() => import("./pages/chat/page.tsx"));
const ProfilePage = lazy(() => import("./pages/profile/page.tsx"));
const MyPurchasesPage = lazy(
  () => import("./pages/profile/MyPurchasesPage.tsx"),
);
const StatusPage = lazy(() => import("./pages/status/page.tsx"));
const SellerPage = lazy(() => import("./pages/sellers/page.tsx"));
const CategoryPage = lazy(() => import("./pages/category/page.tsx"));
const PromptDetailPage = lazy(() => import("./pages/prompts/[id].tsx"));

const AppLayout = () => (
  <main className="min-h-screen bg-slate-950 text-white">
    <Outlet />
  </main>
);

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
          <Route path="/purchases" element={<MyPurchasesPage />} />
          <Route path="/status" element={<StatusPage />} />
          <Route path="/sellers/:sellerId" element={<SellerPage />} />
          <Route path="/category/:categoryName" element={<CategoryPage />} />
          <Route path="/prompts/:id" element={<PromptDetailPage />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </Suspense>
  );
}

export default App;
