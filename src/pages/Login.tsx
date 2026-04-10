import { Leaf, Lock, Eye, EyeOff, LogIn, User } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function Login() {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();

  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      navigate("/", { replace: true });
    }
  }, [isAuthenticated, navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError("");

    const ok = await login(usuario, password);

    if (!ok) {
      setError("Usuario o contraseña incorrectos");
    }

    setLoading(false);
  }

  return (
    <div className="login-screen">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 28, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="login-logo-wrap">
          <div className="login-logo">
            <Leaf size={24} strokeWidth={2.3} />
          </div>
        </div>

        <h1 className="login-title">AgroRecetas</h1>
        <p className="login-subtitle">Sistema de Gestión Agrícola</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Usuario</label>
            <div className="input-wrap">
              <div className="input-icon">
                <User size={16} />
              </div>
              <input
                className="form-input has-left-icon login-text-input"
                placeholder="Usuario"
                value={usuario}
                onChange={(e) => setUsuario(e.target.value)}
                autoComplete="username"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Contraseña</label>
            <div className="input-wrap">
              <div className="input-icon">
                <Lock size={16} />
              </div>

              <input
                className="form-input has-left-icon has-right-icon login-text-input"
                type={showPassword ? "text" : "password"}
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />

              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {error && <div className="login-error">{error}</div>}

          <button type="submit" className="login-button" disabled={loading}>
            <LogIn size={16} />
            <span>{loading ? "Ingresando..." : "Iniciar Sesión"}</span>
          </button>
        </form>

        <div className="login-footer">
          Sistema exclusivo para usuarios autorizados de Grupo SURCO CR
        </div>
      </motion.div>
    </div>
  );
}

export default Login;