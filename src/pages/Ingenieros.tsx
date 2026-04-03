import { useEffect, useMemo, useState } from "react";
import { Search, UserRound, Plus, Pencil, Trash2, X } from "lucide-react";
import {
  createIngeniero,
  deleteIngeniero,
  getIngenieros,
  updateIngeniero,
  type IngenieroSP,
} from "../Services/sharepoint";
import "../styles/agro-pages.css";

type FormIngeniero = {
  nombre: string;
  apellido: string;
  telefono: string;
};

const initialForm: FormIngeniero = {
  nombre: "",
  apellido: "",
  telefono: "",
};

function getInitials(nombre: string, apellido: string) {
  const n = nombre?.trim()?.[0] || "";
  const a = apellido?.trim()?.[0] || "";
  return `${n}${a}`.toUpperCase() || "IN";
}

function getNombreCompleto(item: IngenieroSP) {
  return item.nombreCompleto?.trim() || `${item.nombre} ${item.apellido}`.trim();
}

export default function Ingenieros() {
  const [ingenieros, setIngenieros] = useState<IngenieroSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [editing, setEditing] = useState<IngenieroSP | null>(null);
  const [form, setForm] = useState<FormIngeniero>(initialForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadIngenieros();
  }, []);

  async function loadIngenieros() {
    try {
      setLoading(true);
      setError("");
      const data = await getIngenieros();
      setIngenieros(data);
    } catch (err: any) {
      setError(err.message || "Error cargando ingenieros");
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

  function openEditar(item: IngenieroSP) {
    setModo("editar");
    setEditing(item);
    setForm({
      nombre: item.nombre,
      apellido: item.apellido,
      telefono: item.telefono,
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

      if (!form.nombre || !form.apellido || !form.telefono) {
        throw new Error("Completá todos los campos");
      }

      if (modo === "crear") {
        await createIngeniero(form);
      } else if (editing) {
        await updateIngeniero(editing.id, form);
      }

      closeModal();
      await loadIngenieros();
    } catch (err: any) {
      alert(err.message || "Error guardando ingeniero");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = confirm("¿Eliminar ingeniero?");
    if (!ok) return;

    try {
      await deleteIngeniero(id);
      await loadIngenieros();
    } catch (err: any) {
      alert(err.message || "Error eliminando ingeniero");
    }
  }

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return ingenieros;

    return ingenieros.filter((i) =>
      `${getNombreCompleto(i)} ${i.telefono}`.toLowerCase().includes(texto)
    );
  }, [ingenieros, busqueda]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon" style={{ background: "#dbeafe", color: "#2563eb" }}>
            <UserRound size={22} />
          </div>
          <div>
            <div className="page-title">Ingenieros</div>
            <div className="page-subtitle">
              {loading ? "Cargando ingenieros..." : `${ingenieros.length} ingenieros registrados`}
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={15} />
            Nuevo Ingeniero
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={15} />
        <input
          placeholder="Buscar ingenieros..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {loading && <div className="empty-state">Cargando ingenieros...</div>}
      {!loading && error && <div className="error-state">Error: {error}</div>}
      {!loading && !error && filtrados.length === 0 && (
        <div className="empty-state">No hay ingenieros para mostrar.</div>
      )}

      {!loading && !error && filtrados.length > 0 && (
        <div className="entity-grid">
          {filtrados.map((item) => (
            <div className="entity-card" key={item.id}>
              <div className="entity-left">
                <div
                  className="entity-avatar"
                  style={{ background: "#e6eefc", color: "#2563eb" }}
                >
                  {getInitials(item.nombre, item.apellido)}
                </div>

                <div>
                  <div className="entity-title">Ing. {getNombreCompleto(item)}</div>
                  <div className="entity-subtitle">{item.telefono || "-"}</div>
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
              <div className="modal-title">
                {modo === "crear" ? "Nuevo Ingeniero" : "Editar Ingeniero"}
              </div>
              <button className="modal-close" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  value={form.nombre}
                  onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Apellido *</label>
                <input
                  value={form.apellido}
                  onChange={(e) => setForm((prev) => ({ ...prev, apellido: e.target.value }))}
                />
              </div>

              <div className="form-group">
                <label>Teléfono *</label>
                <input
                  value={form.telefono}
                  onChange={(e) => setForm((prev) => ({ ...prev, telefono: e.target.value }))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : modo === "crear" ? "Crear Ingeniero" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
