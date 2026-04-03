import { useEffect, useMemo, useState } from "react";
import { Search, Building2, Plus, Pencil, Trash2, X, Mail } from "lucide-react";
import {
  createSucursal,
  deleteSucursal,
  getSucursales,
  updateSucursal,
  type SucursalSP,
} from "../Services/sharepoint";
import "../styles/agro-pages.css";

type FormSucursal = {
  nombre: string;
  correo: string;
};

const initialForm: FormSucursal = {
  nombre: "",
  correo: "",
};

export default function Sucursales() {
  const [sucursales, setSucursales] = useState<SucursalSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [editing, setEditing] = useState<SucursalSP | null>(null);
  const [form, setForm] = useState<FormSucursal>(initialForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadSucursales();
  }, []);

  async function loadSucursales() {
    try {
      setLoading(true);
      setError("");
      const data = await getSucursales();
      setSucursales(data);
    } catch (err: any) {
      setError(err.message || "Error cargando sucursales");
    } finally {
      setLoading(false);
    }
  }

  function openCrear() {
    setModo("crear");
    setEditing(null);
    setForm(initialForm);
    setOpenModal(true);
  }

  function openEditar(item: SucursalSP) {
    setModo("editar");
    setEditing(item);
    setForm({
      nombre: item.nombre,
      correo: item.correo,
    });
    setOpenModal(true);
  }

  function closeModal() {
    if (saving) return;
    setOpenModal(false);
    setEditing(null);
    setForm(initialForm);
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (!form.nombre || !form.correo) {
        throw new Error("Completá todos los campos");
      }

      if (modo === "crear") {
        await createSucursal(form);
      } else if (editing) {
        await updateSucursal(editing.id, form);
      }

      closeModal();
      await loadSucursales();
    } catch (err: any) {
      alert(err.message || "Error guardando sucursal");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = confirm("¿Eliminar sucursal?");
    if (!ok) return;

    try {
      await deleteSucursal(id);
      await loadSucursales();
    } catch (err: any) {
      alert(err.message || "Error eliminando sucursal");
    }
  }

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return sucursales;

    return sucursales.filter((item) =>
      `${item.nombre} ${item.correo}`.toLowerCase().includes(texto)
    );
  }, [sucursales, busqueda]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon" style={{ background: "#f0e8ff", color: "#7c3aed" }}>
            <Building2 size={22} />
          </div>
          <div>
            <div className="page-title">Sucursales</div>
            <div className="page-subtitle">
              {loading ? "Cargando sucursales..." : `${sucursales.length} sucursales registradas`}
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={15} />
            Nueva Sucursal
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={15} />
        <input
          placeholder="Buscar sucursales..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {loading && <div className="empty-state">Cargando sucursales...</div>}
      {!loading && error && <div className="error-state">Error: {error}</div>}
      {!loading && !error && filtradas.length === 0 && (
        <div className="empty-state">No hay sucursales para mostrar.</div>
      )}

      {!loading && !error && filtradas.length > 0 && (
        <div className="entity-grid">
          {filtradas.map((item) => (
            <div className="entity-card" key={item.id}>
              <div className="entity-left">
                <div className="entity-avatar" style={{ background: "#f0e8ff", color: "#7c3aed" }}>
                  <Building2 size={18} />
                </div>

                <div>
                  <div className="entity-title">{item.nombre}</div>
                  <div className="entity-meta" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Mail size={14} />
                    {item.correo}
                  </div>
                </div>
              </div>

              <div className="entity-actions">
                <button className="icon-button" onClick={() => openEditar(item)} title="Editar">
                  <Pencil size={16} />
                </button>
                <button
                  className="icon-button delete"
                  onClick={() => handleDelete(item.id)}
                  title="Eliminar"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openModal && (
        <div className="modal-overlay">
          <div className="modal-card narrow">
            <div className="modal-header">
              <div className="modal-title">{modo === "crear" ? "Nueva Sucursal" : "Editar Sucursal"}</div>
              <button className="modal-close" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre de Sucursal *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Correo Electrónico *</label>
                <input
                  value={form.correo}
                  onChange={(e) => setForm((prev) => ({ ...prev, correo: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : modo === "crear" ? "Crear Sucursal" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
