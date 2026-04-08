import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import Sidebar from "./Sidebar";

function AppLayout() {
  const location = useLocation();

  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth <= 768 : false
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    function handleResize() {
      const mobile = window.innerWidth <= 768;
      setIsMobile(mobile);

      if (mobile) {
        setCollapsed(false);
      } else {
        setSidebarOpen(false);
      }
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (isMobile) {
      setSidebarOpen(false);
    }
  }, [location.pathname, isMobile]);

  const desktopSidebarWidth = collapsed ? 84 : 250;

  return (
    <div className="app-shell">
      <button
        onClick={() => {
          if (isMobile) {
            setSidebarOpen(true);
          } else {
            setCollapsed((prev) => !prev);
          }
        }}
        style={{
          position: "fixed",
          top: 16,
          left: 16,
          zIndex: 2200,
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 14,
          width: 50,
          height: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          boxShadow: "0 10px 25px rgba(15,23,42,0.10)",
        }}
        aria-label="Abrir menú"
      >
        <Menu size={22} />
      </button>

      {!isMobile && <Sidebar collapsed={collapsed} />}

      {isMobile && (
        <>
          {sidebarOpen && (
            <div
              onClick={() => setSidebarOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                background: "rgba(0,0,0,0.45)",
                backdropFilter: "blur(3px)",
                zIndex: 2000,
              }}
            />
          )}

          <div
            style={{
              position: "fixed",
              top: 0,
              left: sidebarOpen ? 0 : "-280px",
              width: 280,
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
          paddingTop: 82,
          marginLeft: !isMobile ? desktopSidebarWidth : 0,
          transition: "margin-left 0.25s ease",
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