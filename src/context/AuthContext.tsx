import { createContext, useContext, useEffect, useState } from "react";

export type UserRole =
  | "Mantenimiento"
  | "Administrativo"
  | "Ingeniero"
  | "Sucursal";

export type User = {
  id: number;
  usuario: string;
  nombre: string;
  rol: UserRole;
  email?: string;
  ingenieroId?: number | null;
  sucursalId?: number | null;
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (usuario: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const savedUser = localStorage.getItem("app_user");
    const savedToken = localStorage.getItem("app_token");

    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem("app_user");
      }
    }

    if (savedToken) {
      setToken(savedToken);
    }
  }, []);

  async function login(usuario: string, password: string) {
    try {
      const res = await fetch("https://app-recetas-o6t4.onrender.com/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ usuario, password }),
      });

      if (!res.ok) return false;

      const data = await res.json();

      if (!data?.user || !data?.token) return false;

      const safeUser: User = {
        id: Number(data.user.id),
        usuario: String(data.user.usuario || ""),
        nombre: String(data.user.nombre || ""),
        rol: data.user.rol as UserRole,
        email: data.user.email ? String(data.user.email) : "",
        ingenieroId:
          data.user.ingenieroId !== undefined && data.user.ingenieroId !== null
            ? Number(data.user.ingenieroId)
            : null,
        sucursalId:
          data.user.sucursalId !== undefined && data.user.sucursalId !== null
            ? Number(data.user.sucursalId)
            : null,
      };

      setUser(safeUser);
      setToken(data.token);

      localStorage.setItem("app_user", JSON.stringify(safeUser));
      localStorage.setItem("app_token", data.token);

      return true;
    } catch (error) {
      console.error("Error en login:", error);
      return false;
    }
  }

  function logout() {
    setUser(null);
    setToken(null);
    localStorage.removeItem("app_user");
    localStorage.removeItem("app_token");
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        login,
        logout,
        isAuthenticated: !!user && !!token,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth debe usarse dentro de AuthProvider");
  }

  return context;
}