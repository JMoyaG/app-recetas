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
  X,
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
};

const Sidebar = ({ mobile = false, onNavigate }: SidebarProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const items: MenuItem[] = [
    {
      to: "/",
      icon: <House size={16} />,
      label: "Inicio",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero", "Sucursal"],
    },
    {
      to: "/clientes",
      icon: <Users size={16} />,
      label: "Clientes",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/ingenieros",
      icon: <UserRound size={16} />,
      label: "Ingenieros",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/fincas",
      icon: <MapPin size={16} />,
      label: "Fincas",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      to: "/sucursales",
      icon: <Building2 size={16} />,
      label: "Sucursales",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/productos",
      icon: <Package size={16} />,
      label: "Productos",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero", "Sucursal"],
    },
    {
      to: "/recetas-ingeniero",
      icon: <FileText size={16} />,
      label: "Recetas Ingeniero",
      roles: ["Mantenimiento", "Ingeniero"],
    },
    {
      to: "/historial",
      icon: <History size={16} />,
      label: "Historial",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      to: "/recetas-sucursales",
      icon: <ClipboardList size={16} />,
      label: "Recetas Sucursales",
      roles: ["Mantenimiento", "Sucursal"],
    },
    {
      to: "/gestion-usuarios",
      icon: <Settings size={16} />,
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

  return (
    <motion.aside
      className={`sidebar ${mobile ? "sidebar-mobile" : ""}`}
      initial={{ x: mobile ? -20 : -24, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
    >
      <div className="sidebar-top">
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <motion.div
            className="brand"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.3 }}
            style={{ flex: 1, marginBottom: 0 }}
          >
            <div className="brand-icon">
              <Leaf size={18} />
            </div>
            <div>
              <div className="brand-title">AgroRecetas</div>
              <div className="brand-subtitle">Sistema de Gestión</div>
            </div>
          </motion.div>

          {mobile && (
            <button
              type="button"
              onClick={() => onNavigate?.()}
              aria-label="Cerrar menú"
              style={{
                width: 38,
                height: 38,
                borderRadius: 12,
                border: "1px solid #e2e8f0",
                background: "#fff",
                color: "#475467",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginTop: 2,
                flexShrink: 0,
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav" style={{ marginTop: 14 }}>
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
              >
                {item.icon}
                <span>{item.label}</span>
              </NavLink>
            </motion.div>
          ))}
        </nav>
      </div>

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
    </motion.aside>
  );
};

export default Sidebar;