import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Users,
  Plus,
  Pencil,
  Trash2,
  X,
  Download,
} from "lucide-react";
import {
  createCliente,
  deleteCliente,
  getClientes,
  importarClientesMasivo,
  updateCliente,
  type ClienteSP,
} from "../Services/sharepoint";

type FormCliente = {
  nombre: string;
  apellido: string;
  telefono: string;
};

const initialForm: FormCliente = {
  nombre: "",
  apellido: "",
  telefono: "",
};

function getInitials(nombre: string, apellido: string) {
  const n = nombre?.trim()?.[0] || "";
  const a = apellido?.trim()?.[0] || "";
  return `${n}${a}`.toUpperCase() || "CL";
}

function Clientes() {
  const [clientes, setClientes] = useState<ClienteSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [clienteEditando, setClienteEditando] = useState<ClienteSP | null>(null);
  const [form, setForm] = useState<FormCliente>(initialForm);
  const [saving, setSaving] = useState(false);

  const [importando, setImportando] = useState(false);

  useEffect(() => {
    loadClientes();
  }, []);

  async function loadClientes() {
    try {
      setLoading(true);
      setError("");
      const data = await getClientes();
      setClientes(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error cargando clientes");
    } finally {
      setLoading(false);
    }
  }

  function openCrear() {
    setModo("crear");
    setClienteEditando(null);
    setForm(initialForm);
    setOpenModal(true);
  }

  function openEditar(cliente: ClienteSP) {
    setModo("editar");
    setClienteEditando(cliente);
    setForm({
      nombre: cliente.nombre,
      apellido: cliente.apellido,
      telefono: cliente.telefono,
    });
    setOpenModal(true);
  }

  function closeModal() {
    if (saving) return;
    setOpenModal(false);
    setClienteEditando(null);
    setForm(initialForm);
  }

  async function handleSave() {
    try {
      setSaving(true);

      if (!form.nombre || !form.apellido || !form.telefono) {
        throw new Error("Completá todos los campos");
      }

      if (modo === "crear") {
        await createCliente(form);
      } else if (clienteEditando) {
        await updateCliente(clienteEditando.id, form);
      }

      closeModal();
      await loadClientes();
    } catch (err: any) {
      alert(err.message || "Error guardando cliente");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = confirm("¿Eliminar cliente?");
    if (!ok) return;

    try {
      await deleteCliente(id);
      await loadClientes();
    } catch (err: any) {
      alert(err.message || "Error eliminando cliente");
    }
  }

  async function handleImportar() {
    const ok = confirm(
      "Esto importará los clientes desde Clientes_import_internal.csv en el servidor. ¿Deseás continuar?"
    );
    if (!ok) return;

    try {
      setImportando(true);

      const resp = await importarClientesMasivo();

      const r = resp?.resultado;

      alert(
        `Importación finalizada\n\n` +
          `Total: ${r?.total ?? 0}\n` +
          `Procesados: ${r?.procesados ?? 0}\n` +
          `Importados: ${r?.ok ?? 0}\n` +
          `Omitidos: ${r?.omitidos ?? 0}\n` +
          `Errores: ${r?.error ?? 0}`
      );

      await loadClientes();
    } catch (err: any) {
      alert(err.message || "Error importando clientes");
    } finally {
      setImportando(false);
    }
  }

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    if (!texto) return clientes;

    return clientes.filter((c) =>
      `${c.nombre} ${c.apellido} ${c.telefono}`.toLowerCase().includes(texto)
    );
  }, [clientes, busqueda]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon">
            <Users size={20} />
          </div>
          <div>
            <div className="page-title">Clientes</div>
            <div className="page-subtitle">
              {loading
                ? "Cargando clientes..."
                : `${clientes.length} cliente${clientes.length === 1 ? "" : "s"} registrados`}
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn" onClick={handleImportar} disabled={importando}>
            <Download size={14} style={{ marginRight: 6 }} />
            {importando ? "Importando..." : "Importar Clientes"}
          </button>

          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={14} style={{ marginRight: 6 }} />
            Nuevo Cliente
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={14} />
        <input
          placeholder="Buscar clientes..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      {loading && <div className="client-empty">Cargando clientes...</div>}

      {!loading && error && (
        <div className="client-error">Error: {error}</div>
      )}

      {!loading && !error && filtrados.length === 0 && (
        <div className="client-empty">No hay clientes para mostrar.</div>
      )}

      {!loading && !error && filtrados.length > 0 && (
        <div className="client-grid">
          {filtrados.map((cliente) => (
            <div key={cliente.id} className="client-card">
              <div className="client-left">
                <div className="client-avatar">
                  {getInitials(cliente.nombre, cliente.apellido)}
                </div>

                <div>
                  <div className="client-name">
                    {cliente.nombre} {cliente.apellido}
                  </div>
                  <div className="client-phone">{cliente.telefono || "-"}</div>
                </div>
              </div>

              <div className="client-actions">
                <button title="Editar" onClick={() => openEditar(cliente)}>
                  <Pencil size={14} />
                </button>
                <button
                  className="delete"
                  title="Eliminar"
                  onClick={() => handleDelete(cliente.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {openModal && (
        <div style={overlayStyle}>
          <div style={modalStyle}>
            <div style={modalHeaderStyle}>
              <div style={{ fontWeight: 800, fontSize: 20 }}>
                {modo === "crear" ? "Nuevo Cliente" : "Editar Cliente"}
              </div>
              <button style={closeBtnStyle} onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              <Field
                label="Nombre *"
                value={form.nombre}
                onChange={(v) => setForm({ ...form, nombre: v })}
                placeholder="Ingrese el nombre"
              />
              <Field
                label="Apellido *"
                value={form.apellido}
                onChange={(v) => setForm({ ...form, apellido: v })}
                placeholder="Ingrese el apellido"
              />
              <Field
                label="Teléfono *"
                value={form.telefono}
                onChange={(v) => setForm({ ...form, telefono: v })}
                placeholder="Ingrese el teléfono"
              />
            </div>

            <div style={modalFooterStyle}>
              <button className="btn" onClick={closeModal} disabled={saving}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving
                  ? "Guardando..."
                  : modo === "crear"
                  ? "Crear Cliente"
                  : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <label style={fieldLabelStyle}>{label}</label>
      <input
        style={inputStyle}
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
  background: "rgba(15, 23, 42, 0.45)",
  display: "grid",
  placeItems: "center",
  zIndex: 50,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
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

export default Clientes;