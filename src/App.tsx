import { Routes, Route, Navigate } from "react-router-dom";
import AppLayout from "./components/AppLayout";
import RoleRoute from "./components/RoleRoute";
import { useAuth } from "./context/AuthContext";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Clientes from "./pages/Clientes";
import Fincas from "./pages/Fincas";
import GestionUsuarios from "./pages/GestionUsuarios";
import Historial from "./pages/Historial";
import Ingenieros from "./pages/Ingenieros";
import Productos from "./pages/Productos";
import RecetasIngeniero from "./pages/RecetasIngeniero";
import RecetasSucursales from "./pages/RecetasSucursales";
import Sucursales from "./pages/Sucursales";

function PrivateLayout() {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route path="/" element={<PrivateLayout />}>
        <Route index element={<Dashboard />} />

        <Route
          path="clientes"
          element={
            <RoleRoute roles={["Mantenimiento", "Administrativo"]}>
              <Clientes />
            </RoleRoute>
          }
        />

        <Route
          path="ingenieros"
          element={
            <RoleRoute roles={["Mantenimiento", "Administrativo"]}>
              <Ingenieros />
            </RoleRoute>
          }
        />

        <Route
          path="fincas"
          element={
            <RoleRoute roles={["Mantenimiento", "Administrativo", "Ingeniero"]}>
              <Fincas />
            </RoleRoute>
          }
        />

        <Route
          path="sucursales"
          element={
            <RoleRoute roles={["Mantenimiento", "Administrativo"]}>
              <Sucursales />
            </RoleRoute>
          }
        />

        <Route
          path="productos"
          element={
            <RoleRoute
              roles={[
                "Mantenimiento",
                "Administrativo",
                "Ingeniero",
                "Sucursal",
              ]}
            >
              <Productos />
            </RoleRoute>
          }
        />

        <Route
          path="recetas-ingeniero"
          element={
            <RoleRoute roles={["Mantenimiento", "Ingeniero"]}>
              <RecetasIngeniero />
            </RoleRoute>
          }
        />

        <Route
          path="historial"
          element={
            <RoleRoute roles={["Mantenimiento", "Administrativo"]}>
              <Historial />
            </RoleRoute>
          }
        />

        <Route
          path="recetas-sucursales"
          element={
            <RoleRoute roles={["Mantenimiento", "Sucursal"]}>
              <RecetasSucursales />
            </RoleRoute>
          }
        />

        <Route
          path="gestion-usuarios"
          element={
            <RoleRoute roles={["Mantenimiento"]}>
              <GestionUsuarios />
            </RoleRoute>
          }
        />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;