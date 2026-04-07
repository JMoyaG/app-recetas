import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  FileText,
  Package,
  Plus,
  Search,
  Send,
  X,
} from "lucide-react";
import {
  createRecetaIngeniero,
  getClientes,
  getFincas,
  getIngenieros,
  getProductos,
  getRecetasIngeniero,
  getSucursales,
  sendRecetaIngeniero,
  type ClienteSP,
  type FincaSP,
  type IngenieroSP,
  type ProductoSP,
  type RecetaIngeniero as RecetaIngenieroSP,
  type SucursalSP,
} from "../Services/sharepoint";
import { useAuth } from "../context/AuthContext";

type ProductoSeleccionado = {
  key: string;
  productoId?: number;
  cantidad: number;
  dosis: string;
  esOtroProducto: boolean;
  otroProductoNombre: string;
  productoNombre?: string;
  productoCodigo?: string;
  unidad?: string;
};

type FormState = {
  ingenieroId: number;
  clienteId: number;
  fincaId: number;
  sucursalId: number;
  productoSearch: string;
};

const initialForm: FormState = {
  ingenieroId: 0,
  clienteId: 0,
  fincaId: 0,
  sucursalId: 0,
  productoSearch: "",
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function clienteLabel(cliente?: ClienteSP | null) {
  if (!cliente) return "";
  return [cliente.nombre, cliente.apellido].filter(Boolean).join(" ").trim();
}

function ingenieroLabel(ingeniero?: IngenieroSP | null) {
  if (!ingeniero) return "";
  return (
    String(
      ingeniero.nombreCompleto ||
        [ingeniero.nombre, ingeniero.apellido].filter(Boolean).join(" ")
    ).trim() || "Ingeniero"
  );
}

function formatFecha(value?: string) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString();
}

function EstadoBadge({ estado }: { estado?: string }) {
  const text = String(estado || "Pendiente");
  let background = "#fff7ed";
  let color = "#b45309";

  if (text === "Pendiente de Confirmar") {
    background = "#fef3c7";
    color = "#92400e";
  }

  if (text === "Entregada") {
    background = "#dcfce7";
    color = "#166534";
  }

  return (
    <span
      style={{
        background,
        color,
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
}

export default function RecetasIngeniero() {
  const { user } = useAuth();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingId, setSendingId] = useState<number | null>(null);

  const [recetas, setRecetas] = useState<RecetaIngenieroSP[]>([]);
  const [clientes, setClientes] = useState<ClienteSP[]>([]);
  const [fincas, setFincas] = useState<FincaSP[]>([]);
  const [ingenieros, setIngenieros] = useState<IngenieroSP[]>([]);
  const [sucursales, setSucursales] = useState<SucursalSP[]>([]);
  const [productos, setProductos] = useState<ProductoSP[]>([]);

  const [search, setSearch] = useState("");
  const [openModal, setOpenModal] = useState(false);
  const [expandedIds, setExpandedIds] = useState<number[]>([]);
  const [form, setForm] = useState<FormState>(initialForm);
  const [productosSeleccionados, setProductosSeleccionados] = useState<
    ProductoSeleccionado[]
  >([]);
  const [showOtrosProductos, setShowOtrosProductos] = useState(false);
  const [errorForm, setErrorForm] = useState("");

  function detectCurrentIngeniero(list: IngenieroSP[]) {
    const nombreUsuario = normalizeText(user?.nombre);
    const usuarioLogin = normalizeText(user?.usuario);

    const match = list.find((item) => {
      const label = normalizeText(ingenieroLabel(item));
      return label === nombreUsuario || label === usuarioLogin;
    });

    return match?.id || 0;
  }

  async function loadAll() {
    try {
      setLoading(true);
      const [
        recetasData,
        clientesData,
        fincasData,
        ingenierosData,
        sucursalesData,
        productosData,
      ] = await Promise.all([
        getRecetasIngeniero(),
        getClientes(),
        getFincas(),
        getIngenieros(),
        getSucursales(),
        getProductos(),
      ]);

      setRecetas(Array.isArray(recetasData) ? recetasData : []);
      setClientes(Array.isArray(clientesData) ? clientesData : []);
      setFincas(Array.isArray(fincasData) ? fincasData : []);
      setIngenieros(Array.isArray(ingenierosData) ? ingenierosData : []);
      setSucursales(Array.isArray(sucursalesData) ? sucursalesData : []);
      setProductos(Array.isArray(productosData) ? productosData : []);

      setForm((prev) => ({
        ...prev,
        ingenieroId: prev.ingenieroId || detectCurrentIngeniero(ingenierosData),
      }));
    } catch (error) {
      console.error("Error cargando recetas:", error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  const sucursalSeleccionada = useMemo(
    () =>
      sucursales.find((s) => Number(s.id) === Number(form.sucursalId)) || null,
    [sucursales, form.sucursalId]
  );

  const fincasFiltradas = useMemo(() => {
    if (!form.clienteId) return [];
    return fincas.filter(
      (f) => Number(f.clienteId) === Number(form.clienteId)
    );
  }, [fincas, form.clienteId]);

  const productosFiltrados = useMemo(() => {
    const term = normalizeText(form.productoSearch);
    if (!term) return productos;

    return productos.filter(
      (p) =>
        normalizeText(p.nombre).includes(term) ||
        normalizeText(p.codigo).includes(term)
    );
  }, [productos, form.productoSearch]);

  const recetasFiltradas = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return recetas;

    return recetas.filter((r) =>
      [
        r.numero,
        r.clienteNombre,
        r.fincaNombre,
        r.ingenieroNombre,
        r.sucursalNombre,
        r.estado,
      ]
        .map(normalizeText)
        .some((value) => value.includes(term))
    );
  }, [recetas, search]);

  function resetForm() {
    setForm({
      ...initialForm,
      ingenieroId: detectCurrentIngeniero(ingenieros),
    });
    setProductosSeleccionados([]);
    setShowOtrosProductos(false);
    setErrorForm("");
  }

  function toggleExpand(id: number) {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function isProductoSeleccionado(productoId: number) {
    return productosSeleccionados.some(
      (p) => !p.esOtroProducto && Number(p.productoId) === Number(productoId)
    );
  }

  function getCantidadSeleccionada(productoId: number) {
    return (
      productosSeleccionados.find(
        (p) => !p.esOtroProducto && Number(p.productoId) === Number(productoId)
      )?.cantidad || 1
    );
  }

  function getDosisSeleccionada(productoId: number) {
    return (
      productosSeleccionados.find(
        (p) => !p.esOtroProducto && Number(p.productoId) === Number(productoId)
      )?.dosis || ""
    );
  }

  function toggleProducto(productoId: number) {
    setProductosSeleccionados((prev) => {
      const existing = prev.find(
        (p) => !p.esOtroProducto && Number(p.productoId) === Number(productoId)
      );
      if (existing) return prev.filter((p) => p.key !== existing.key);

      const producto = productos.find((p) => Number(p.id) === Number(productoId));
      return [
        ...prev,
        {
          key: `prod-${productoId}`,
          productoId,
          cantidad: 1,
          dosis: "",
          esOtroProducto: false,
          otroProductoNombre: "",
          productoNombre: producto?.nombre || "",
          productoCodigo: producto?.codigo || "",
          unidad: producto?.unidad || "",
        },
      ];
    });
  }

  function updateCantidadByKey(key: string, cantidad: number) {
    setProductosSeleccionados((prev) =>
      prev.map((p) => (p.key === key ? { ...p, cantidad: Math.max(1, Number(cantidad || 1)) } : p))
    );
  }

  function updateDosisByKey(key: string, dosis: string) {
    setProductosSeleccionados((prev) =>
      prev.map((p) => (p.key === key ? { ...p, dosis } : p))
    );
  }

  function updateOtroProductoByKey(
    key: string,
    field: "otroProductoNombre" | "unidad" | "productoCodigo",
    value: string
  ) {
    setProductosSeleccionados((prev) =>
      prev.map((p) => (p.key === key ? { ...p, [field]: value } : p))
    );
  }

  function addOtroProducto() {
    const key = `otro-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setProductosSeleccionados((prev) => [
      ...prev,
      {
        key,
        cantidad: 1,
        dosis: "",
        esOtroProducto: true,
        otroProductoNombre: "",
        productoNombre: "",
        productoCodigo: "OTRO",
        unidad: "UND",
      },
    ]);
  }

  function removeOtroProducto(key: string) {
    setProductosSeleccionados((prev) => prev.filter((p) => p.key !== key));
  }

  function validateForm() {

    if (!form.ingenieroId) return "Seleccione un ingeniero";
    if (!form.clienteId) return "Seleccione un cliente";
    if (!form.fincaId) return "Seleccione una finca";
    if (!form.sucursalId) return "Seleccione una sucursal";
    if (!productosSeleccionados.length)
      return "Seleccione al menos un producto";

    const cantidadesInvalidas = productosSeleccionados.some(
      (item) => Number(item.cantidad) <= 0
    );

    if (cantidadesInvalidas) return "Revise las cantidades de los productos";

    const otrosInvalidos = productosSeleccionados.some(
      (item) => item.esOtroProducto && !String(item.otroProductoNombre || "").trim()
    );

    if (otrosInvalidos) return "Debes escribir el nombre de los otros productos";

    return "";
  }

  async function handleCreateReceta() {
    try {
      const validationError = validateForm();

      if (validationError) {
        setErrorForm(validationError);
        return;
      }

      setErrorForm("");
      setSaving(true);

      const payload = {
        ingenieroId: Number(form.ingenieroId),
        clienteId: Number(form.clienteId),
        fincaId: Number(form.fincaId),
        sucursalId: Number(form.sucursalId),
        productos: productosSeleccionados.map((item) => ({
          productoId: item.productoId ? Number(item.productoId) : undefined,
          cantidad: Number(item.cantidad),
          dosis: String(item.dosis || "").trim(),
          esOtroProducto: !!item.esOtroProducto,
          otroProductoNombre: String(item.otroProductoNombre || "").trim(),
          productoNombre: item.esOtroProducto
            ? String(item.otroProductoNombre || "").trim()
            : String(item.productoNombre || "").trim(),
          codigo: String(item.productoCodigo || (item.esOtroProducto ? "OTRO" : "")).trim(),
          unidad: String(item.unidad || (item.esOtroProducto ? "UND" : "")).trim(),
        })),
      };

      console.log("PAYLOAD CREAR RECETA:", payload);

      await createRecetaIngeniero(payload);

      setOpenModal(false);
      resetForm();
      await loadAll();
    } catch (error: any) {
      console.error("ERROR AL CREAR RECETA:", error);
      alert(error?.message || "No se pudo crear la receta");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnviarReceta(id: number) {
    try {
      setSendingId(id);
      await sendRecetaIngeniero(id);
      await loadAll();
    } catch (error: any) {
      alert(error?.message || "No se pudo enviar la receta");
    } finally {
      setSendingId(null);
    }
  }

  const canSave =
    form.ingenieroId > 0 &&
    form.clienteId > 0 &&
    form.fincaId > 0 &&
    form.sucursalId > 0 &&
    productosSeleccionados.length > 0 &&
    !saving;

  return (
    <div style={{ padding: 28 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
          gap: 16,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: "#dff3ee",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#008060",
            }}
          >
            <FileText size={22} />
          </div>
          <div>
            <h1
              style={{
                margin: 0,
                fontSize: 28,
                fontWeight: 800,
                color: "#0f172a",
              }}
            >
              Recetas Ingeniero
            </h1>
            <p style={{ margin: "6px 0 0", color: "#475569" }}>
              {recetas.length} recetas registradas
            </p>
          </div>
        </div>

        <button
          onClick={() => {
            resetForm();
            setOpenModal(true);
          }}
          style={{
            border: "none",
            background: "#179b63",
            color: "#fff",
            borderRadius: 12,
            padding: "12px 18px",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
          }}
        >
          <Plus size={16} />
          Nueva Receta
        </button>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e8f0",
          borderRadius: 16,
          padding: 14,
          marginBottom: 22,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            border: "1px solid #dbe2ea",
            borderRadius: 12,
            padding: "12px 14px",
            background: "#fff",
          }}
        >
          <Search size={18} color="#64748b" />
          <input
            type="text"
            placeholder="Buscar recetas..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              border: "none",
              outline: "none",
              width: "100%",
              fontSize: 15,
            }}
          />
        </div>
      </div>

      {loading ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            border: "1px solid #e2e8f0",
            padding: 24,
          }}
        >
          Cargando...
        </div>
      ) : recetasFiltradas.length === 0 ? (
        <div
          style={{
            background: "#fff",
            borderRadius: 18,
            border: "1px solid #e2e8f0",
            padding: 24,
            color: "#334155",
          }}
        >
          No hay recetas registradas
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {recetasFiltradas.map((receta) => {
            const expanded = expandedIds.includes(receta.id);
            const productosReceta = Array.isArray(receta.productos)
              ? receta.productos
              : [];
            const estadoVisual = receta.fechaConfirmacion
              ? "Entregada"
              : receta.fechaEnvio
              ? "Pendiente de Confirmar"
              : "Pendiente";

            return (
              <div
                key={receta.id}
                style={{
                  background: "#fff",
                  border: "1px solid #e2e8f0",
                  borderRadius: 18,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    padding: 20,
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 20,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        marginBottom: 14,
                        flexWrap: "wrap",
                      }}
                    >
                      <strong style={{ fontSize: 20, color: "#0f172a" }}>
                        Receta #{receta.numero || receta.id}
                      </strong>
                      <EstadoBadge estado={estadoVisual} />
                    </div>

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                        gap: 16,
                      }}
                    >
                      <div>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Cliente:</strong> {receta.clienteNombre || "-"}
                        </p>
                        <p style={{ margin: 0 }}>
                          <strong>Finca:</strong> {receta.fincaNombre || "-"}
                        </p>
                      </div>
                      <div>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Ingeniero:</strong>{" "}
                          {receta.ingenieroNombre || "-"}
                        </p>
                        <p style={{ margin: 0 }}>
                          <strong>Sucursal:</strong>{" "}
                          {receta.sucursalNombre || "-"}
                        </p>
                      </div>
                    </div>

                    <p
                      style={{
                        margin: "14px 0 0",
                        color: "#64748b",
                        fontSize: 14,
                      }}
                    >
                      {receta.fechaConfirmacion
                        ? `Confirmada el ${formatFecha(receta.fechaConfirmacion)}`
                        : receta.fechaEnvio
                        ? `Enviada el ${formatFecha(receta.fechaEnvio)}`
                        : `Creada el ${formatFecha(receta.createdAt)}`}
                    </p>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    {!receta.fechaEnvio && (
                      <button
                        type="button"
                        onClick={() => handleEnviarReceta(receta.id)}
                        disabled={sendingId === receta.id}
                        style={{
                          border: "none",
                          background: "#17803d",
                          color: "#fff",
                          borderRadius: 12,
                          padding: "10px 14px",
                          fontWeight: 700,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          minWidth: 100,
                          justifyContent: "center",
                        }}
                      >
                        <Send size={15} />
                        {sendingId === receta.id ? "Enviando..." : "Enviar"}
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleExpand(receta.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        width: 36,
                        height: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {expanded ? (
                        <ChevronUp size={18} />
                      ) : (
                        <ChevronDown size={18} />
                      )}
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div
                    style={{
                      borderTop: "1px solid #eef2f7",
                      padding: 18,
                      display: "grid",
                      gap: 10,
                      background: "#fafcff",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        color: "#334155",
                        fontWeight: 700,
                        marginBottom: 2,
                      }}
                    >
                      <Package size={16} />
                      Productos ({productosReceta.length})
                    </div>

                    {productosReceta.length === 0 ? (
                      <div
                        style={{
                          padding: "12px 14px",
                          background: "#fff",
                          border: "1px solid #e5edf5",
                          borderRadius: 12,
                          color: "#64748b",
                        }}
                      >
                        Esta receta no tiene productos.
                      </div>
                    ) : (
                      productosReceta.map((p, index) => (
                        <div
                          key={`${p.productoId}-${index}`}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            padding: "12px 14px",
                            background: "#fff",
                            border: "1px solid #e5edf5",
                            borderRadius: 12,
                          }}
                        >
                          <span>
                            {p.esOtroProducto
                              ? p.otroProductoNombre || p.productoNombre || "Otro producto"
                              : p.productoNombre || "Producto"}
                            {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                            {p.unidad ? ` · ${p.unidad}` : ""}
                            {p.dosis ? ` · Dosis: ${p.dosis}` : ""}
                          </span>
                          <strong>{p.cantidad}</strong>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openModal && (
        <div
          style={{
              position: "fixed",
              inset: 0,
              background: "rgba(15,23,42,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: 24,
              overflowY: "auto",
          }}
        >
          <div
  style={{
    width: "100%",
    maxWidth: 1080,
    maxHeight: "90vh",
    background: "#fff",
    borderRadius: 22,
    boxShadow: "0 24px 80px rgba(15,23,42,0.18)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  }}
>
            <div
              style={{
                padding: "22px 24px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>
                  Nueva receta
                </h2>
                <p style={{ margin: "8px 0 0", color: "#64748b" }}>
                  Crea la receta y luego envíala a la sucursal seleccionada.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpenModal(false);
                  resetForm();
                }}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: "1px solid #d9e2ec",
                  background: "#fff",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <div
  style={{
    padding: 24,
    borderTop: "1px solid #e2e8f0",
    overflowY: "auto",
    flex: 1,
  }}
>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                  gap: 16,
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Número de receta
                  </label>
                  <input
                    value="Se genera automáticamente al guardar"
                    disabled
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                      background: "#f8fafc",
                      color: "#64748b",
                    }}
                  />
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Ingeniero
                  </label>
                  <select
  value={form.ingenieroId}
  onChange={(e) =>
    setForm((prev) => ({
      ...prev,
      ingenieroId: Number(e.target.value),
    }))
  }
  disabled={user?.rol === "Ingeniero"}
>
  <option value={0}>Seleccione...</option>
  {ingenieros.map((ing) => (
    <option key={ing.id} value={ing.id}>
      {ingenieroLabel(ing)}
    </option>
  ))}
</select>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Cliente
                  </label>
                  <select
                    value={form.clienteId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        clienteId: Number(e.target.value),
                        fincaId: 0,
                        sucursalId: 0,
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                    }}
                  >
                    <option value={0}>Seleccione</option>
                    {clientes.map((item) => (
                      <option key={item.id} value={item.id}>
                        {clienteLabel(item)}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Finca
                  </label>
                  <select
                    value={form.fincaId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        fincaId: Number(e.target.value),
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                    }}
                  >
                    <option value={0}>Seleccione</option>
                    {fincasFiltradas.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ gridColumn: "1 / -1" }}>
                  <label
                    style={{
                      display: "block",
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    Sucursal
                  </label>
                  <select
                    value={form.sucursalId}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        sucursalId: Number(e.target.value),
                      }))
                    }
                    style={{
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 12,
                      border: "1px solid #cbd5e1",
                    }}
                  >
                    <option value={0}>Seleccione</option>
                    {sucursales.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nombre}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  background: "#f8fafc",
                  border: "1px solid #dbe2ea",
                  borderRadius: 16,
                  padding: 16,
                }}
              >
                <div style={{ fontWeight: 700, color: "#334155" }}>
                  Sucursal seleccionada:{" "}
                  <span style={{ fontWeight: 500 }}>
                    {sucursalSeleccionada?.nombre || "-"}
                  </span>
                </div>
                <div
                  style={{
                    fontWeight: 700,
                    color: "#334155",
                    marginTop: 4,
                  }}
                >
                  Correo:{" "}
                  <span style={{ fontWeight: 500 }}>
                    {sucursalSeleccionada?.correo || "-"}
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 18,
                  border: "1px solid #dbe2ea",
                  borderRadius: 18,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontWeight: 800,
                    fontSize: 20,
                    color: "#0f172a",
                    marginBottom: 14,
                  }}
                >
                  Productos
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    border: "1px solid #dbe2ea",
                    borderRadius: 12,
                    padding: "12px 14px",
                    background: "#fff",
                    marginBottom: 14,
                  }}
                >
                  <Search size={18} color="#64748b" />
                  <input
                    type="text"
                    placeholder="Buscar producto por nombre o código..."
                    value={form.productoSearch}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        productoSearch: e.target.value,
                      }))
                    }
                    style={{
                      border: "none",
                      outline: "none",
                      width: "100%",
                      fontSize: 15,
                    }}
                  />
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 10,
                    maxHeight: 280,
                    overflowY: "auto",
                  }}
                >
                  {productosFiltrados.map((producto) => {
                    const activo = isProductoSeleccionado(producto.id);

                    return (
                      <div
                        key={producto.id}
                        style={{
                          border: `1px solid ${
                            activo ? "#86efac" : "#dbe2ea"
                          }`,
                          background: activo ? "#f0fdf4" : "#fff",
                          borderRadius: 14,
                          padding: 14,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 14,
                        }}
                      >
                        <label
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 12,
                            flex: 1,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={activo}
                            onChange={() => toggleProducto(producto.id)}
                          />
                          <div>
                            <div
                              style={{
                                fontWeight: 700,
                                color: "#0f172a",
                              }}
                            >
                              {producto.nombre}
                            </div>
                            <div
                              style={{
                                color: "#64748b",
                                fontSize: 14,
                              }}
                            >
                              Código: {producto.codigo || "-"} · Unidad:{" "}
                              {producto.unidad || "-"}
                            </div>
                          </div>
                        </label>

                        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Cantidad</div>
                            <input
                              type="number"
                              min={1}
                              value={getCantidadSeleccionada(producto.id)}
                              disabled={!activo}
                              onChange={(e) => updateCantidadByKey(`prod-${producto.id}`, Number(e.target.value))}
                              style={{
                                width: 95,
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Dosis</div>
                            <input
                              type="text"
                              placeholder="Dosis"
                              value={getDosisSeleccionada(producto.id)}
                              disabled={!activo}
                              onChange={(e) => updateDosisByKey(`prod-${producto.id}`, e.target.value)}
                              style={{
                                width: 120,
                                padding: "10px 12px",
                                borderRadius: 10,
                                border: "1px solid #cbd5e1",
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showOtrosProductos;
                      setShowOtrosProductos(next);
                      if (next && !productosSeleccionados.some((p) => p.esOtroProducto)) {
                        addOtroProducto();
                      }
                    }}
                    style={{
                      border: "1px solid #cbd5e1",
                      background: showOtrosProductos ? "#0f172a" : "#fff",
                      color: showOtrosProductos ? "#fff" : "#0f172a",
                      borderRadius: 12,
                      padding: "10px 14px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Otros productos
                  </button>
                  {showOtrosProductos && (
                    <button
                      type="button"
                      onClick={addOtroProducto}
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#0f172a",
                        borderRadius: 12,
                        padding: "10px 14px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Agregar otro producto
                    </button>
                  )}
                </div>

                {showOtrosProductos && (
                  <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
                    {productosSeleccionados
                      .filter((p) => p.esOtroProducto)
                      .map((item, index) => (
                        <div
                          key={item.key}
                          style={{
                            border: "1px solid #dbe2ea",
                            background: "#fff",
                            borderRadius: 14,
                            padding: 14,
                            display: "grid",
                            gridTemplateColumns: "minmax(0,1.8fr) 100px 120px 100px auto",
                            gap: 10,
                            alignItems: "end",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>
                              Otro producto {index + 1}
                            </div>
                            <input
                              type="text"
                              placeholder="Nombre del producto"
                              value={item.otroProductoNombre}
                              onChange={(e) => updateOtroProductoByKey(item.key, "otroProductoNombre", e.target.value)}
                              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Cantidad</div>
                            <input
                              type="number"
                              min={1}
                              value={item.cantidad}
                              onChange={(e) => updateCantidadByKey(item.key, Number(e.target.value))}
                              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Dosis</div>
                            <input
                              type="text"
                              placeholder="Dosis"
                              value={item.dosis}
                              onChange={(e) => updateDosisByKey(item.key, e.target.value)}
                              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
                            />
                          </div>
                          <div>
                            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>Unidad</div>
                            <input
                              type="text"
                              placeholder="UND"
                              value={item.unidad || "UND"}
                              onChange={(e) => updateOtroProductoByKey(item.key, "unidad", e.target.value)}
                              style={{ width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid #cbd5e1" }}
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeOtroProducto(item.key)}
                            style={{ border: "1px solid #fecaca", background: "#fff1f2", color: "#be123c", borderRadius: 10, padding: "10px 12px", cursor: "pointer", fontWeight: 700 }}
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                  </div>
                )}

                <div
                  style={{
                    marginTop: 14,
                    color: "#475569",
                    fontWeight: 700,
                  }}
                >
                  {productosSeleccionados.length} producto
                  {productosSeleccionados.length === 1 ? "" : "s"} seleccionado
                  {productosSeleccionados.length === 1 ? "" : "s"}
                </div>
              </div>

              {errorForm && (
                <div
                  style={{
                    marginTop: 16,
                    background: "#fef2f2",
                    border: "1px solid #fecaca",
                    color: "#b91c1c",
                    borderRadius: 12,
                    padding: "12px 14px",
                    fontWeight: 600,
                  }}
                >
                  {errorForm}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 12,
                  marginTop: 18,
                }}
              >
                <button
                  onClick={() => {
                    setOpenModal(false);
                    resetForm();
                  }}
                  style={{
                    border: "1px solid #cbd5e1",
                    background: "#fff",
                    color: "#0f172a",
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    cursor: "pointer",
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleCreateReceta}
                  disabled={!canSave}
                  style={{
                    border: "none",
                    background: canSave ? "#179b63" : "#94a3b8",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    cursor: canSave ? "pointer" : "not-allowed",
                  }}
                >
                  {saving ? "Guardando..." : "Crear receta"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
