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

type ClienteOption = {
  value: string;
  label: string;
};

const initialForm: FormFinca = {
  nombre: "",
  ubicacion: "",
  clienteId: "",
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function SearchableSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  noOptionsMessage,
}: {
  options: ClienteOption[];
  value: ClienteOption | null;
  onChange: (selected: ClienteOption | null) => void;
  placeholder: string;
  disabled?: boolean;
  noOptionsMessage: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filteredOptions = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return options;
    return options.filter((option) => normalizeText(option.label).includes(term));
  }, [options, search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <div style={{ position: "relative" }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((prev) => !prev)}
        style={{
          width: "100%",
          minHeight: 46,
          padding: "12px 42px 12px 14px",
          borderRadius: 12,
          border: "1px solid #d1d5db",
          background: disabled ? "#f8fafc" : "#fff",
          color: value ? "#111827" : "#6b7280",
          fontSize: 14,
          textAlign: "left",
          cursor: disabled ? "not-allowed" : "pointer",
          position: "relative",
        }}
      >
        {value?.label || placeholder}
        <span
          style={{
            position: "absolute",
            right: 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: "#94a3b8",
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ▾
        </span>
      </button>

      {open && !disabled && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            right: 0,
            background: "#fff",
            border: "1px solid #dbe2ea",
            borderRadius: 12,
            boxShadow: "0 18px 40px rgba(15,23,42,0.12)",
            zIndex: 4000,
            overflow: "hidden",
          }}
        >
          <div style={{ padding: 10, borderBottom: "1px solid #eef2f7" }}>
            <input
              autoFocus
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={placeholder}
              style={{
                width: "100%",
                minHeight: 40,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #cbd5e1",
                outline: "none",
                fontSize: 14,
              }}
            />
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto" }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: 12, color: "#64748b", fontSize: 14 }}>
                {noOptionsMessage}
              </div>
            ) : (
              filteredOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option);
                    setOpen(false);
                  }}
                  style={{
                    width: "100%",
                    border: "none",
                    background: value?.value === option.value ? "#f1f5f9" : "#fff",
                    color: "#0f172a",
                    textAlign: "left",
                    padding: "12px 14px",
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  {option.label}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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

  const clienteOptions = useMemo<ClienteOption[]>(
    () =>
      clientes.map((cliente) => ({
        value: String(cliente.id),
        label: `${cliente.nombre || ""} ${cliente.apellido || ""}${
          cliente.telefono ? ` ${cliente.telefono}` : ""
        }`.trim(),
      })),
    [clientes]
  );

  const selectedClienteOption =
    clienteOptions.find((item) => item.value === String(form.clienteId || "")) || null;

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
                <SearchableSelect
                  options={clienteOptions}
                  value={selectedClienteOption}
                  onChange={(selected) =>
                    setForm((prev) => ({
                      ...prev,
                      clienteId: String(selected?.value || ""),
                    }))
                  }
                  placeholder="Buscar cliente..."
                  noOptionsMessage="No se encontraron clientes"
                />
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
