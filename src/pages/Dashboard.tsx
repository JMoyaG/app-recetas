import {
  Leaf,
  Shield,
  ArrowRight,
  BadgeCheck,
  Users,
  UserRound,
  MapPin,
  Building2,
  Package,
  FileText,
  History,
  ClipboardList,
  Settings,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";

function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const modules = [
    {
      title: "Gestión de Usuarios",
      description: "Administrar usuarios del sistema",
      icon: <Settings size={16} />,
      path: "/gestion-usuarios",
      roles: ["Mantenimiento"],
    },
    {
      title: "Clientes",
      description: "Gestión de clientes",
      icon: <Users size={16} />,
      path: "/clientes",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      title: "Ingenieros",
      description: "Gestión de ingenieros",
      icon: <UserRound size={16} />,
      path: "/ingenieros",
      roles: ["Mantenimiento", "Administrativo"],
    },
    {
      title: "Fincas",
      description: "Gestión de fincas",
      icon: <MapPin size={16} />,
      path: "/fincas",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      title: "Sucursales",
      description: "Gestión de sucursales",
      icon: <Building2 size={16} />,
      path: "/sucursales",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      title: "Productos",
      description: "Catálogo de productos",
      icon: <Package size={16} />,
      path: "/productos",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero", "Sucursal"],
    },
    {
      title: "Recetas Ingeniero",
      description: "Crear y enviar recetas",
      icon: <FileText size={16} />,
      path: "/recetas-ingeniero",
      roles: ["Mantenimiento", "Administrativo", "Ingeniero"],
    },
    {
      title: "Recetas Sucursal",
      description: "Recepción y confirmación",
      icon: <ClipboardList size={16} />,
      path: "/recetas-sucursales",
      roles: ["Mantenimiento", "Administrativo", "Sucursal"],
    },
    {
      title: "Historial",
      description: "Seguimiento de recetas",
      icon: <History size={16} />,
      path: "/historial",
      roles: ["Mantenimiento", "Administrativo"],
    },
  ];

  const visibleModules = modules.filter(
    (m) => user && m.roles.includes(user.rol)
  );

  return (
    <div className="dashboard-page">
      <motion.div
        className="welcome-banner"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <BadgeCheck size={18} />
        <div>
          <strong>Bienvenido al sistema de gestión agrícola</strong>
          <span>
            Seleccione una opción del menú o utilice los accesos rápidos para
            comenzar a trabajar.
          </span>
        </div>
      </motion.div>

      <motion.div
        className="page-header"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.08, duration: 0.35 }}
      >
        <div className="page-header-icon">
          <Leaf size={20} />
        </div>
        <div>
          <div className="page-title">Sistema AgroRecetas</div>
          <div className="page-subtitle">
            Gestión integral de recetas y productos agrícolas
          </div>
        </div>
      </motion.div>

      <motion.div
        className="dashboard-section-title"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.14, duration: 0.3 }}
      >
        <Shield size={15} />
        <span>Accesos rápidos</span>
      </motion.div>

      <div className="dashboard-cards">
        {visibleModules.map((mod, index) => (
          <motion.div
            key={mod.path}
            className="dashboard-card"
            onClick={() => navigate(mod.path)}
            style={{ cursor: "pointer" }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + index * 0.05, duration: 0.35 }}
            whileHover={{ y: -6, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
          >
            <div className="dashboard-card-top">
              <div className="dashboard-card-icon">{mod.icon}</div>
              <div className="dashboard-card-arrow">
                <ArrowRight size={16} />
              </div>
            </div>

            <div>
              <div className="dashboard-card-title">{mod.title}</div>
              <div className="dashboard-card-text">
                {mod.description}
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

export default Dashboard;