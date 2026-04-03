import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Package,
  Plus,
  Pencil,
  Trash2,
  X,
  Upload,
  FileSpreadsheet,
  FileText,
  Download,
} from "lucide-react";
import {
  createProducto,
  deleteProducto,
  descargarListaBaseProductos,
  getProductos,
  importarProductosArchivo,
  updateProducto,
  type ProductoSP,
  type UnidadProducto,
} from "../Services/sharepoint";
import "../styles/agro-pages.css";

type FormProducto = {
  nombre: string;
  codigo: string;
  unidad: UnidadProducto;
};

const initialForm: FormProducto = {
  nombre: "",
  codigo: "",
  unidad: "Kg",
};

function getUnitClass(unidad: string) {
  const normalized = unidad.toLowerCase();
  if (normalized.includes("kg")) return "kg";
  if (normalized.includes("ltr") || normalized.includes("lit")) return "ltr";
  return "und";
}

export default function Productos() {
  const [productos, setProductos] = useState<ProductoSP[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busqueda, setBusqueda] = useState("");
  const [filtroUnidad, setFiltroUnidad] = useState<"" | UnidadProducto>("");

  const [openModal, setOpenModal] = useState(false);
  const [modo, setModo] = useState<"crear" | "editar">("crear");
  const [editing, setEditing] = useState<ProductoSP | null>(null);
  const [form, setForm] = useState<FormProducto>(initialForm);
  const [saving, setSaving] = useState(false);

  const [openImportModal, setOpenImportModal] = useState(false);
  const [importTab, setImportTab] = useState<"excel" | "texto">("excel");
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    loadProductos();
  }, []);

  async function loadProductos() {
    try {
      setLoading(true);
      setError("");
      const data = await getProductos();
      setProductos(data);
    } catch (err: any) {
      setError(err.message || "Error cargando productos");
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

  function openEditar(item: ProductoSP) {
    setModo("editar");
    setEditing(item);
    setForm({
      nombre: item.nombre,
      codigo: item.codigo,
      unidad: (["Kg", "Ltr", "Und"].includes(item.unidad) ? item.unidad : "Kg") as UnidadProducto,
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

      if (!form.nombre || !form.codigo || !form.unidad) {
        throw new Error("Completá todos los campos");
      }

      if (modo === "crear") {
        await createProducto(form);
      } else if (editing) {
        await updateProducto(editing.id, form);
      }

      closeModal();
      await loadProductos();
    } catch (err: any) {
      alert(err.message || "Error guardando producto");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: number) {
    const ok = confirm("¿Eliminar producto?");
    if (!ok) return;

    try {
      await deleteProducto(id);
      await loadProductos();
    } catch (err: any) {
      alert(err.message || "Error eliminando producto");
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setImporting(true);
      const formData = new FormData();
      formData.append("archivo", file);
      formData.append("tipo", importTab);
      await importarProductosArchivo(formData);
      alert("Productos importados correctamente");
      setOpenImportModal(false);
      await loadProductos();
    } catch (err: any) {
      alert(err.message || "Error importando productos");
    } finally {
      setImporting(false);
      e.target.value = "";
    }
  }

  async function handleDownloadBase() {
    try {
      const blob = await descargarListaBaseProductos();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "lista_base_productos.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(err.message || "No se pudo descargar la lista base");
    }
  }

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();

    return productos.filter((p) => {
      const matchesText = !texto ? true : `${p.nombre} ${p.codigo}`.toLowerCase().includes(texto);
      const matchesUnit = !filtroUnidad ? true : p.unidad === filtroUnidad;
      return matchesText && matchesUnit;
    });
  }, [productos, busqueda, filtroUnidad]);

  return (
    <div>
      <div className="page-toolbar">
        <div className="page-header" style={{ marginBottom: 0 }}>
          <div className="page-header-icon" style={{ background: "#fde8ef", color: "#e11d48" }}>
            <Package size={22} />
          </div>
          <div>
            <div className="page-title">Productos</div>
            <div className="page-subtitle">
              {loading ? "Cargando productos..." : `${productos.length} productos en catálogo`}
            </div>
          </div>
        </div>

        <div className="toolbar-actions">
          <button className="btn" onClick={() => setOpenImportModal(true)}>
            <Upload size={15} />
            Importar Archivo
          </button>
          <button className="btn" onClick={handleDownloadBase}>
            <Download size={15} />
            Lista Base
          </button>
          <button className="btn btn-primary" onClick={openCrear}>
            <Plus size={15} />
            Nuevo
          </button>
        </div>
      </div>

      <div className="search-box">
        <Search size={15} />
        <input
          placeholder="Buscar productos por nombre o código..."
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
        />
      </div>

      <div className="filters-inline">
        <button className="pill kg" onClick={() => setFiltroUnidad(filtroUnidad === "Kg" ? "" : "Kg")}>Kg</button>
        <span className="muted">Kilogramos</span>
        <button className="pill ltr" onClick={() => setFiltroUnidad(filtroUnidad === "Ltr" ? "" : "Ltr")}>Ltr</button>
        <span className="muted">Litros</span>
        <button className="pill und" onClick={() => setFiltroUnidad(filtroUnidad === "Und" ? "" : "Und")}>UND</button>
        <span className="muted">Unidades</span>
      </div>

      {loading && <div className="empty-state">Cargando productos...</div>}
      {!loading && error && <div className="error-state">Error: {error}</div>}
      {!loading && !error && filtrados.length === 0 && <div className="empty-state">No hay productos para mostrar.</div>}

      {!loading && !error && filtrados.length > 0 && (
        <div className="entity-grid">
          {filtrados.map((item) => (
            <div className="product-card" key={item.id}>
              <div className="entity-left">
                <div className="entity-avatar" style={{ background: "#ffe4ec", color: "#e11d48", borderRadius: 12 }}>
                  <Package size={16} />
                </div>

                <div style={{ minWidth: 0 }}>
                  <div className="entity-title" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.nombre}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
                    <span className="code-tag">{item.codigo}</span>
                    <span className={`pill ${getUnitClass(item.unidad)}`}>{item.unidad}</span>
                  </div>
                </div>
              </div>

              <div className="entity-actions">
                <button className="icon-button" onClick={() => openEditar(item)} title="Editar">
                  <Pencil size={16} />
                </button>
                <button className="icon-button delete" onClick={() => handleDelete(item.id)} title="Eliminar">
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
              <div className="modal-title">{modo === "crear" ? "Nuevo Producto" : "Editar Producto"}</div>
              <button className="modal-close" onClick={closeModal}>
                <X size={18} />
              </button>
            </div>

            <div className="form-grid">
              <div className="form-group">
                <label>Nombre del Producto *</label>
                <input placeholder="Ingrese el nombre del producto" value={form.nombre} onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Código del Producto *</label>
                <input placeholder="Ej: FE0164" value={form.codigo} onChange={(e) => setForm((prev) => ({ ...prev, codigo: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Unidad de Medida *</label>
                <select value={form.unidad} onChange={(e) => setForm((prev) => ({ ...prev, unidad: e.target.value as UnidadProducto }))}>
                  <option value="Kg">Kg (Kilogramos)</option>
                  <option value="Ltr">Ltr (Litros)</option>
                  <option value="Und">UND (Unidades)</option>
                </select>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn" onClick={closeModal} disabled={saving}>Cancelar</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? "Guardando..." : modo === "crear" ? "Crear Producto" : "Guardar Cambios"}
              </button>
            </div>
          </div>
        </div>
      )}

      {openImportModal && (
        <div className="modal-overlay">
          <div className="modal-card narrow">
            <div className="modal-header">
              <div className="modal-title">Importar Productos desde Archivo</div>
              <button className="modal-close" onClick={() => setOpenImportModal(false)}>
                <X size={18} />
              </button>
            </div>

            <div className="filters-inline" style={{ marginTop: 0 }}>
              <button className={`btn ${importTab === "excel" ? "btn-primary" : ""}`} onClick={() => setImportTab("excel")}>
                <FileSpreadsheet size={15} />
                Excel / CSV
              </button>
              <button className={`btn ${importTab === "texto" ? "btn-primary" : ""}`} onClick={() => setImportTab("texto")}>
                <FileText size={15} />
                Texto / PDF
              </button>
            </div>

            <label style={{ border: "2px dashed #d6ddcf", borderRadius: 14, padding: 28, display: "grid", placeItems: "center", textAlign: "center", cursor: "pointer", marginTop: 18 }}>
              <input type="file" hidden onChange={handleImportFile} />
              <div style={{ width: 44, height: 44, borderRadius: 999, background: "#ffe5ec", color: "#e11d48", display: "grid", placeItems: "center", marginBottom: 14 }}>
                <Upload size={18} />
              </div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>Haz clic para seleccionar un archivo</div>
              <div className="muted" style={{ marginTop: 6 }}>Formatos: CSV, TXT, Excel (.xls, .xlsx)</div>
            </label>

            <div style={{ marginTop: 18, background: "#fafbf8", borderRadius: 14, padding: 16 }}>
              <div style={{ fontWeight: 800, marginBottom: 10 }}>Formato esperado:</div>
              <ul style={{ margin: 0, paddingLeft: 20, color: "#555", lineHeight: 1.7 }}>
                <li>Primera columna: Código del producto (ej: FE0164)</li>
                <li>Segunda columna: Nombre del producto</li>
                <li>Separador: coma, punto y coma, o tabulación</li>
              </ul>
              {importing && <div style={{ marginTop: 12 }}>Importando...</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
