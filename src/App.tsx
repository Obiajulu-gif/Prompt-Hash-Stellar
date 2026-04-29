import { Outlet, Route, Routes } from "react-router-dom";
import Home from "./pages/Home";
import BrowsePage from "./pages/browse/page.jsx";
import SellPage from "./pages/sell/page.tsx";
import ChatHome from "./pages/chat/page.tsx";
import ProfilePage from "./pages/profile/page.tsx";
import StatusPage from "./pages/status/page.tsx";

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
        <Route path="/status" element={<StatusPage />} />
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}

export default App;
