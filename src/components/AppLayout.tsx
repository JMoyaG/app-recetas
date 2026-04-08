import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";

function AppLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );

  useEffect(() => {
    function handleResize() {
      setIsMobile(window.innerWidth <= 768);
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-shell">
      {!isMobile && <Sidebar />}

      {isMobile && (
        <>
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              position: "fixed",
              top: 16,
              left: 16,
              zIndex: 2200,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 16,
              width: 56,
              height: 56,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              boxShadow: "0 10px 30px rgba(15,23,42,0.12)",
            }}
            aria-label="Abrir menú"
          >
            <Menu size={24} />
          </button>

          {sidebarOpen && (
  <div
    onClick={() => setSidebarOpen(false)}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(4px)",
      zIndex: 2090,
    }}
  />
)}

          <div
            style={{
              position: "fixed",
              top: 0,
              left: sidebarOpen ? 0 : "-280px",
              width: "280px",
              height: "100vh",
              zIndex: 2100,
              transition: "left 0.28s ease",
            }}
          >
            <Sidebar mobile onNavigate={() => setSidebarOpen(false)} />
          </div>
        </>
      )}

      <main
        className="main-content"
        style={{
          width: "100%",
          paddingTop: isMobile ? 86 : undefined,
        }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={location.pathname}
            className="page-wrap"
            initial={{ opacity: 0, y: 18, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.99 }}
            transition={{
              duration: 0.32,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default AppLayout;