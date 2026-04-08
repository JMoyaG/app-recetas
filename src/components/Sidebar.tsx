import {
  House,
  Users,
  UserRound,
  MapPin,
  Building2,
  Package,
  FileText,
  History,
  ClipboardList,
  Settings,
  LogOut,
  Leaf,
} from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import type { UserRole } from "../context/AuthContext";

type MenuItem = {
  to: string;
  label: string;
  icon: React.ReactNode;
  roles: UserRole[];
};

type SidebarProps = {
  mobile?: boolean;
  onNavigate?: () => void;
  collapsed?: boolean;
};

const Sidebar = ({
  mobile = false,
  onNavigate,
  collapsed = false,
}: SidebarProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const items: MenuItem[] = [
    {
      to: "/",
      icon: <House size={18} />,
      label: "Inicio",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero", "Sucursal"],
    },
    {
      to: "/clientes",
      icon: <Users size={18} />,
      label: "Clientes",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/ingenieros",
      icon: <UserRound size={18} />,
      label: "Ingenieros",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/fincas",
      icon: <MapPin size={18} />,
      label: "Fincas",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      to: "/sucursales",
      icon: <Building2 size={18} />,
      label: "Sucursales",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/productos",
      icon: <Package size={18} />,
      label: "Productos",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero", "Sucursal"],
    },
    {
      to: "/recetas-ingeniero",
      icon: <FileText size={18} />,
      label: "Recetas Ingeniero",
      roles: ["Mantenimiento", "Ingeniero"],
    },
    {
      to: "/historial",
      icon: <History size={18} />,
      label: "Historial",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/recetas-sucursales",
      icon: <ClipboardList size={18} />,
      label: "Recetas Sucursales",
      roles: ["Mantenimiento", "Sucursal"],
    },
    {
      to: "/gestion-usuarios",
      icon: <Settings size={18} />,
      label: "Gestión Usuarios",
      roles: ["Mantenimiento"],
    },
  ];

  const visibleItems = items.filter(
    (item) => user && item.roles.includes(user.rol)
  );

  function handleLogout() {
    logout();
    navigate("/login");
    onNavigate?.();
  }

  const width = mobile ? 280 : collapsed ? 84 : 250;

  return (
    <motion.aside
      className="sidebar"
      initial={{ x: mobile ? -20 : -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      style={{
        width,
        minWidth: width,
        maxWidth: width,
        height: "100vh",
        position: mobile ? "relative" : "fixed",
        top: 0,
        left: 0,
        background: "#ffffff",
        borderRight: "1px solid #e8ecef",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        transition: "width 0.25s ease",
        overflow: "hidden",
        zIndex: mobile ? 2100 : 1200,
      }}
    >
      <div className="sidebar-top" style={{ padding: collapsed && !mobile ? "18px 10px 16px" : "18px 12px 16px" }}>
        <motion.div
          className="brand"
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05, duration: 0.3 }}
          style={{
            justifyContent: collapsed && !mobile ? "center" : "flex-start",
            padding: collapsed && !mobile ? "2px 0 12px" : undefined,
          }}
        >
          <div className="brand-icon">
            <Leaf size={18} />
          </div>

          {(!collapsed || mobile) && (
            <div>
              <div className="brand-title">AgroRecetas</div>
              <div className="brand-subtitle">Sistema de Gestión</div>
            </div>
          )}
        </motion.div>

        <nav className="sidebar-nav">
          {visibleItems.map((item, index) => (
            <motion.div
              key={item.to}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.04 * index, duration: 0.24 }}
            >
              <NavLink
                to={item.to}
                end={item.to === "/"}
                onClick={() => onNavigate?.()}
                className={({ isActive }) =>
                  `sidebar-link${isActive ? " active" : ""}`
                }
                title={collapsed && !mobile ? item.label : undefined}
                style={{
                  justifyContent: collapsed && !mobile ? "center" : "flex-start",
                  padding: collapsed && !mobile ? "0 0" : undefined,
                }}
              >
                {item.icon}
                {(!collapsed || mobile) && <span>{item.label}</span>}
              </NavLink>
            </motion.div>
          ))}
        </nav>
      </div>

      {(!collapsed || mobile) && (
        <motion.div
          className="sidebar-bottom"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <div className="user-role">{user?.nombre}</div>
          <div className="user-email">{user?.email || "-"}</div>
          <div className="user-status">{user?.rol}</div>

          <button className="logout-btn" onClick={handleLogout}>
            <LogOut size={15} />
            <span>Cerrar Sesión</span>
          </button>
        </motion.div>
      )}
    </motion.aside>
  );
};

export default Sidebar;