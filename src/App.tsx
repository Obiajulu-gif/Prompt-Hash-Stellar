import { Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Home from "./pages/Home";
import BrowsePage from "./pages/browse/page.jsx";
import SellPage from "./pages/sell/page.tsx";
import ChatHome from "./pages/chat/page.tsx";
import ProfilePage from "./pages/profile/page.tsx";
import StatusPage from "./pages/status/page.tsx";
import PageTransition from "./components/animations/PageTransition";

const AppLayout = () => {
  const location = useLocation();

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      {/*
        AnimatePresence must receive the changing `key` via its direct child.
        mode="wait" ensures the exiting page fully animates out before the
        entering page starts — prevents both pages rendering on screen at once.
      */}
      <AnimatePresence mode="wait" initial={false}>
        {/*
          The Outlet renders the matched child route. We wrap it in PageTransition
          and key it by pathname so AnimatePresence sees a new component each time
          the route changes.
        */}
        <PageTransition key={location.pathname} routeKey={location.pathname}>
          <Outlet />
        </PageTransition>
      </AnimatePresence>
    </main>
  );
};

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