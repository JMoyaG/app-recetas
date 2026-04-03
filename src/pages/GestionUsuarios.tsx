import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Shield,
  Plus,
  Pencil,
  Trash2,
  X,
  UserCog,
} from "lucide-react";
import {
  createUsuario,
  deleteUsuario,
  getUsuarios,
  updateUsuario,
  getIngenieros,
  getSucursales,
  type UsuarioSP,
  type IngenieroSP,
  type SucursalSP,
} from "../Services/sharepoint";

type FormUsuario = {
  nombre: string;
  correo: string;
  usuario: string;
  password: string;
  rol: string;
  activo: boolean;
  ingenieroId: number | "";
  sucursalId: number | "";
};

const initialForm: FormUsuario = {
  nombre: "",
  correo: "",
  usuario: "",
  password: "",
  rol: "Ingeniero",
  activo: true,
  ingenieroId: "",
  sucursalId: "",
};

function GestionUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioSP[]>([]);
  const [ingenieros, setIngenieros] = useState<IngenieroSP[]>([]);
  const [sucursales, setSucursales] = useState<SucursalSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [usuarioEditando, setUsuarioEditando] = useState<UsuarioSP | null>(null);
  const [form, setForm] = useState<FormUsuario>(initialForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      setError("");

      const [usuariosData, ingenierosData, sucursalesData] = await Promise.all([
        getUsuarios(),
        getIngenieros(),
        getSucursales(),
      ]);

      setUsuarios(Array.isArray(usuariosData) ? usuariosData : []);
      setIngenieros(Array.isArray(ingenierosData) ? ingenierosData : []);
      setSucursales(Array.isArray(sucursalesData) ? sucursalesData : []);
    } catch (err: any) {
      setError(err.message || "Error cargando usuarios");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsuarios() {
    try {
      setLoading(true);
      setError("");
      const data = await getUsuarios();
      setUsuarios(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || "Error cargando usuarios");
    } finally {
      setLoading(false);
    }
  }

  function normalizeRole(value: unknown) {
    return String(value || "").trim();
  }

  function handleRolChange(rol: string) {
    setForm((prev) => ({
      ...prev,
      rol,
      ingenieroId: rol === "Ingeniero" ? prev.ingenieroId : "",
      sucursalId: rol === "Sucursal" ? prev.sucursalId : "",
    }));
  }

  function openCrear() {
    setModo("crear");
    setUsuarioEditando(null);
    setForm(initialForm);
    setOpenModal(true);
  }

  function openEditar(user: UsuarioSP) {
    setModo("editar");
    setUsuarioEditando(user);
    setForm({
      nombre: user.nombre || "",
      correo: user.correo || user.email || "",
      usuario: user.usuario || "",
      password: "",
      rol: user.rol || "Ingeniero",
      activo: !!user.activo,
      ingenieroId:
        user.rol === "Ingeniero" && user.ingenieroId
          ? Number(user.ingenieroId)
          : "",
      sucursalId:
        user.rol === "Sucursal" && user.sucursalId
          ? Number(user.sucursalId)
          : "",
    });
    setOpenModal(true);
  }

  function closeModal() {
    if (saving) return;
    setOpenModal(false);
    setUsuarioEditando(null);
    setForm(initialForm);
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (!form.nombre || !form.correo || !form.usuario || !form.rol) {
        throw new Error("Completá todos los campos obligatorios");
      }

      if (modo === "crear" && !form.password) {
        throw new Error("La contraseña es obligatoria");
      }

      if (normalizeRole(form.rol) === "Ingeniero" && !form.ingenieroId) {
        throw new Error("Debes seleccionar un ingeniero");
      }

      if (normalizeRole(form.rol) === "Sucursal" && !form.sucursalId) {
        throw new Error("Debes seleccionar una sucursal");
      }

      if (modo === "crear") {
        await createUsuario({
          nombre: form.nombre,
          correo: form.correo,
          usuario: form.usuario,
          password: form.password,
          rol: form.rol,
          activo: form.activo,
          ingenieroId:
            normalizeRole(form.rol) === "Ingeniero" && form.ingenieroId
              ? Number(form.ingenieroId)
              : undefined,
          sucursalId:
            normalizeRole(form.rol) === "Sucursal" && form.sucursalId
              ? Number(form.sucursalId)
              : undefined,
        });
      } else if (usuarioEditando) {
        const payload: any = {
          nombre: form.nombre,
          correo: form.correo,
          usuario: form.usuario,
          rol: form.rol,
          activo: form.activo,
          ingenieroId:
            normalizeRole(form.rol) === "Ingeniero" && form.ingenieroId
              ? Number(form.ingenieroId)
              : null,
          sucursalId:
            normalizeRole(form.rol) === "Sucursal" && form.sucursalId
              ? Number(form.sucursalId)
              : null,
        };

        if (form.password.trim()) {
          payload.password = form.password;
        }

        await updateUsuario(usuarioEditando.id, payload);
      }

      closeModal();
      await loadUsuarios();
    } catch (err: any) {
      alert(err.message || "Error guardando usuario");
    } finally {
      setSaving(false);
    }
  }

  async function handleDesactivar(id: number) {
    const ok = confirm("¿Desactivar este usuario?");
    if (!ok) return;

    try {
      await deleteUsuario(id);
      await loadUsuarios();
    } catch (err: any) {
      alert(err.message || "Error desactivando usuario");
    }
  }

  const usuariosFiltrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return usuarios.filter((u) => {
      const coincideEstado = mostrarInactivos ? true : u.activo;
      const coincideTexto = !texto
        ? true
        : `${u.nombre} ${u.correo || ""} ${u.usuario} ${u.rol} ${u.ingenieroNombre || ""} ${u.sucursalNombre || ""}`
            .toLowerCase()
            .includes(texto);

      return coincideEstado && coincideTexto;
    });
  }, [usuarios, busqueda, mostrarInactivos]);

  const resumen = useMemo(() => {
    const count = (rol: string) =>
      usuarios.filter((u) => u.rol === rol && u.activo).length;

    return {
      mantenimiento: count("Mantenimiento"),
      administrativo: count("Administrativo"),
      ingeniero: count("Ingeniero"),
      sucursal: count("Sucursal"),
    };
  }, [usuarios]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon">
            <UserCog size={20} />
          </div>
          <div>
            <div className="page-title">Gestión de Usuarios</div>
            <div className="page-subtitle">
              Administra los usuarios del sistema y sus perfiles
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Nuevo Usuario
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 18,
        }}
      >
        <ResumenCard
          title="Mantenimiento"
          description="Acceso total al sistema"
          count={resumen.mantenimiento}
        />
        <ResumenCard
          title="Administrativo"
          description="Puede crear y editar"
          count={resumen.administrativo}
        />
        <ResumenCard
          title="Ingeniero"
          description="Fincas, productos, recetas"
          count={resumen.ingeniero}
        />
        <ResumenCard
          title="Sucursal"
          description="Productos y recetas sucursal"
          count={resumen.sucursal}
        />
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5edf5",
          borderRadius: 16,
          padding: 18,
          marginBottom: 18,
          display: "flex",
          justifyContent: "space-between",
          gap: 16,
          alignItems: "center",
        }}
      >
        <div className="search-box" style={{ marginBottom: 0, flex: 1 }}>
          <Search size={14} />
          <input
            placeholder="Buscar por nombre, correo o usuario..."
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
          />
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={mostrarInactivos}
            onChange={(e) => setMostrarInactivos(e.target.checked)}
          />
          <span>Mostrar inactivos</span>
        </label>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e5edf5",
          borderRadius: 16,
          padding: 18,
        }}
      >
        <div className="dashboard-section-title" style={{ marginTop: 0 }}>
          <Shield size={15} />
          <span>Usuarios del Sistema</span>
          <span
            style={{
              background: "#f2ead7",
              borderRadius: 8,
              padding: "2px 8px",
              fontSize: 12,
            }}
          >
            {usuariosFiltrados.length}
          </span>
        </div>

        {loading && <div className="client-empty">Cargando usuarios...</div>}
        {!loading && error && <div className="client-error">{error}</div>}

        {!loading && !error && (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e8edf2" }}>
                <th style={{ padding: "12px 8px" }}>Usuario</th>
                <th style={{ padding: "12px 8px" }}>Perfil</th>
                <th style={{ padding: "12px 8px" }}>Relación</th>
                <th style={{ padding: "12px 8px" }}>Estado</th>
                <th style={{ padding: "12px 8px", textAlign: "right" }}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {usuariosFiltrados.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid #eef2f6" }}>
                  <td style={{ padding: "14px 8px" }}>
                    <div style={{ fontWeight: 700 }}>{u.nombre}</div>
                    <div style={{ color: "#64748b", fontSize: 13 }}>
                      {u.correo || u.email || "-"}
                    </div>
                    <div style={{ color: "#94a3b8", fontSize: 12 }}>@{u.usuario}</div>
                  </td>

                  <td style={{ padding: "14px 8px" }}>
                    <span
                      style={{
                        background:
                          u.rol === "Mantenimiento"
                            ? "#f3e8ff"
                            : u.rol === "Ingeniero"
                            ? "#dcfce7"
                            : u.rol === "Sucursal"
                            ? "#fef3c7"
                            : "#dbeafe",
                        color: "#334155",
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {u.rol}
                    </span>
                  </td>

                  <td style={{ padding: "14px 8px", color: "#475569", fontSize: 13 }}>
                    {u.rol === "Ingeniero"
                      ? u.ingenieroNombre || "Sin ingeniero"
                      : u.rol === "Sucursal"
                      ? u.sucursalNombre || "Sin sucursal"
                      : "-"}
                  </td>

                  <td style={{ padding: "14px 8px" }}>
                    <span
                      style={{
                        background: u.activo ? "#dcfce7" : "#fee2e2",
                        color: u.activo ? "#166534" : "#991b1b",
                        padding: "4px 10px",
                        borderRadius: 999,
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {u.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>

                  <td style={{ padding: "14px 8px", textAlign: "right" }}>
                    <button className="btn" onClick={() => openEditar(u)}>
                      <Pencil size={14} />
                    </button>
                    <button
                      className="btn"
                      style={{ marginLeft: 8, color: "#dc2626" }}
                      onClick={() => handleDesactivar(u.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <div style={{ fontWeight: 800, fontSize: 20 }}>
                {modo === "crear" ? "Nuevo Usuario" : "Editar Usuario"}
              </div>
              <button style={closeBtnStyle} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <Field
                label="Nombre Completo *"
                value={form.nombre}
                onChange={(v) => setForm({ ...form, nombre: v })}
                placeholder="Juan Pérez"
              />
              <Field
                label="Correo Electrónico *"
                value={form.correo}
                onChange={(v) => setForm({ ...form, correo: v })}
                placeholder="usuario@gruposurcocr.com"
              />
              <Field
                label="Usuario *"
                value={form.usuario}
                onChange={(v) => setForm({ ...form, usuario: v })}
                placeholder="jperez"
              />
              <Field
                label={modo === "crear" ? "Contraseña *" : "Nueva Contraseña"}
                value={form.password}
                onChange={(v) => setForm({ ...form, password: v })}
                placeholder="Contraseña segura"
                type="password"
              />

              <div>
                <label style={fieldLabelStyle}>Perfil del Usuario</label>
                <select
                  style={inputStyle}
                  value={form.rol}
                  onChange={(e) => handleRolChange(e.target.value)}
                >
                  <option value="Mantenimiento">Mantenimiento</option>
                  <option value="Administrativo">Administrativo</option>
                  <option value="Ingeniero">Ingeniero</option>
                  <option value="Sucursal">Sucursal</option>
                </select>
              </div>

              {form.rol === "Ingeniero" && (
                <div>
                  <label style={fieldLabelStyle}>Ingeniero *</label>
                  <select
                    style={inputStyle}
                    value={form.ingenieroId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ingenieroId: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                  >
                    <option value="">Seleccione un ingeniero</option>
                    {ingenieros.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.nombreCompleto ||
                          [i.nombre, i.apellido].filter(Boolean).join(" ") ||
                          i.nombre ||
                          `Ingeniero ${i.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {form.rol === "Sucursal" && (
                <div>
                  <label style={fieldLabelStyle}>Sucursal *</label>
                  <select
                    style={inputStyle}
                    value={form.sucursalId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        sucursalId: e.target.value ? Number(e.target.value) : "",
                      })
                    }
                  >
                    <option value="">Seleccione una sucursal</option>
                    {sucursales.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.nombre || s.descripcion || `Sucursal ${s.id}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={form.activo}
                  onChange={(e) => setForm({ ...form, activo: e.target.checked })}
                />
                <span>Usuario activo</span>
              </label>
            </div>

            <div style={modalFooterStyle}>
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? "Guardando..."
                  : modo === "crear"
                  ? "Crear Usuario"
                  : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResumenCard({
  title,
  description,
  count,
}: {
  title: string;
  description: string;
  count: number;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e5edf5",
        borderRadius: 16,
        padding: 18,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700 }}>{title}</div>
        <div
          style={{
            background: "#f2ead7",
            borderRadius: 8,
            padding: "2px 8px",
            fontSize: 12,
          }}
        >
          {count}
        </div>
      </div>
      <div style={{ color: "#64748b", fontSize: 13, marginTop: 10 }}>
        {description}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
}) {
  return (
    <div>
      <label style={fieldLabelStyle}>{label}</label>
      <input
        style={inputStyle}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15, 23, 42, 0.4)",
  display: "grid",
  placeItems: "center",
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 560,
  background: "#fff",
  borderRadius: 18,
  padding: 24,
  boxShadow: "0 20px 50px rgba(0,0,0,0.18)",
};

const modalHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 18,
};

const closeBtnStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  cursor: "pointer",
};

const modalFooterStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 10,
  marginTop: 22,
};

const fieldLabelStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 8,
  fontWeight: 600,
  fontSize: 14,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  height: 44,
  borderRadius: 10,
  border: "1px solid #dbe3ee",
  padding: "0 12px",
  outline: "none",
};

export default GestionUsuarios;