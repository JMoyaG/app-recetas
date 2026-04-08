import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import Sidebar from "./Sidebar";
import { Menu } from "lucide-react";

function AppLayout() {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <div
        style={{
          position: isMobile ? "fixed" : "relative",
          left: isMobile ? (sidebarOpen ? 0 : "-260px") : 0,
          top: 0,
          height: "100vh",
          zIndex: 2000,
          transition: "left 0.3s ease",
        }}
      >
        <Sidebar />
      </div>

      {/* Overlay */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.3)",
            zIndex: 1500,
          }}
        />
      )}

      <main className="main-content">
        {/* Botón hamburguesa */}
        {isMobile && (
          <button
            onClick={() => setSidebarOpen(true)}
            style={{
              position: "fixed",
              top: 16,
              left: 16,
              zIndex: 2100,
              background: "#fff",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              padding: 10,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
            }}
          >
            <Menu size={20} />
          </button>
        )}

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