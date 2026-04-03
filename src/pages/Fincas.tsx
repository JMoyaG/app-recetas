import { useEffect, useMemo, useState } from "react";
import {
  MapPin,
  Search,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import {
  createFinca,
  deleteFinca,
  getClientes,
  getFincas,
  updateFinca,
  type ClienteSP,
  type FincaSP,
} from "../Services/sharepoint";

type FormFinca = {
  nombre: string;
  ubicacion: string;
  clienteId: string;
};

const initialForm: FormFinca = {
  nombre: "",
  ubicacion: "",
  clienteId: "",
};

function Fincas() {
  const [fincas, setFincas] = useState<FincaSP[]>([]);
  const [clientes, setClientes] = useState<ClienteSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [fincaEditando, setFincaEditando] = useState<FincaSP | null>(null);
  const [form, setForm] = useState<FormFinca>(initialForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    try {
      setLoading(true);
      setError("");

      const [dataFincas, dataClientes] = await Promise.all([
        getFincas(),
        getClientes(),
      ]);

      setFincas(dataFincas);
      setClientes(dataClientes);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error cargando fincas");
    } finally {
      setLoading(false);
    }
  }

  function getClienteNombre(clienteRef: string | number | undefined) {
    const numericId = Number(clienteRef);
    if (Number.isFinite(numericId) && numericId > 0) {
      const cliente = clientes.find((c) => Number(c.id) === numericId);
      if (cliente) return `${cliente.nombre} ${cliente.apellido || ""}`.trim();
    }

    const textRef = String(clienteRef || "").trim();
    if (textRef) {
      const normalized = textRef.toLowerCase().replace(/^cliente id\s*/i, "").trim();
      const cliente = clientes.find((c) =>
        `${c.nombre} ${c.apellido || ""}`.trim().toLowerCase() === normalized ||
        String(c.nombre || "").trim().toLowerCase() === normalized
      );
      if (cliente) return `${cliente.nombre} ${cliente.apellido || ""}`.trim();
      return textRef;
    }

    return "Sin cliente";
  }

  function openCrear() {
    setModo("crear");
    setFincaEditando(null);
    setForm(initialForm);
    setOpenModal(true);
  }

  function openEditar(finca: FincaSP) {
  setModo("editar");
  setFincaEditando(finca);
  setForm({
    nombre: finca.nombre || "",
    ubicacion: finca.ubicacion || "",
    clienteId: String(finca.clienteId || ""),
  });
  setOpenModal(true);
}

  function closeModal() {
    if (saving) return;
    setOpenModal(false);
    setFincaEditando(null);
    setForm(initialForm);
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (!form.nombre || !form.ubicacion || !form.clienteId) {
        throw new Error("Completá todos los campos");
      }

      const payload = {
        nombre: form.nombre,
        ubicacion: form.ubicacion,
        clienteId: Number(form.clienteId),
      };

      if (modo === "crear") {
        await createFinca(payload);
      } else if (fincaEditando) {
        await updateFinca(fincaEditando.id, payload);
      }

      closeModal();
      await loadAll();
    } catch (err: any) {
      alert(err.message || "Error guardando finca");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = confirm("¿Eliminar finca?");
    if (!ok) return;

    try {
      await deleteFinca(id);
      await loadAll();
    } catch (err: any) {
      alert(err.message || "Error eliminando finca");
    }
  }

  const filtradas = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return fincas;

    return fincas.filter((f) =>
      `${f.nombre} ${f.ubicacion} ${getClienteNombre(f.clienteId || f.cliente)}`
        .toLowerCase()
        .includes(texto)
    );
  }, [fincas, busqueda, clientes]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon">
            <MapPin size={20} />
          </div>
          <div>
            <div className="page-title">Fincas</div>
            <div className="page-subtitle">
              {loading
                ? "Cargando fincas..."
                : `${fincas.length} finca${fincas.length === 1 ? "" : "s"} registrada${fincas.length === 1 ? "" : "s"}`}
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Nueva Finca
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={14} />
        <input
          placeholder="Buscar fincas..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {error ? (
        <div style={{ marginTop: 18, color: "#dc2626" }}>{error}</div>
      ) : loading ? (
        <div style={{ marginTop: 18 }}>Cargando...</div>
      ) : (
        <div
          style={{
            marginTop: 18,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: 14,
          }}
        >
          {filtradas.map((finca) => (
            <div
              key={finca.id}
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#111827",
                  marginBottom: 6,
                }}
              >
                {finca.nombre}
              </div>

              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
                Ubicación: {finca.ubicacion}
              </div>

              <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 12 }}>
                Cliente: {getClienteNombre(finca.clienteId || finca.cliente)}
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn" onClick={() => openEditar(finca)}>
                  <Pencil size={14} style={{ marginRight: 6 }} />
                  Editar
                </button>

                <button
                  className="btn"
                  style={{ color: "#dc2626" }}
                  onClick={() => handleDelete(finca.id)}
                >
                  <Trash2 size={14} style={{ marginRight: 6 }} />
                  Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openModal && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <div className="modal-title">
                {modo === "crear" ? "Nueva Finca" : "Editar Finca"}
              </div>

              <button className="icon-btn" onClick={closeModal}>
                <X size={16} />
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Nombre</label>
                <input
                  value={form.nombre}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, nombre: e.target.value }))
                  }
                />
              </div>

              <div className="form-group">
                <label>Ubicación</label>
                <input
                  value={form.ubicacion}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, ubicacion: e.target.value }))
                  }
                />
              </div>

              <div className="form-group">
                <label>Cliente</label>
                <select
                  value={form.clienteId}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, clienteId: e.target.value }))
                  }
                >
                  <option value="">Seleccione un cliente</option>
                  {clientes.map((cliente) => (
                    <option key={cliente.id} value={cliente.id}>
                      {`${cliente.nombre} ${cliente.apellido}`.trim()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default Fincas;