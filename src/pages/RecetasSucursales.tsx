import { useEffect, useMemo, useState } from "react";
import {
  ClipboardList,
  Search,
  ChevronDown,
  ChevronUp,
  Clock3,
  Package,
  X,
  AlertTriangle,
  Check,
} from "lucide-react";
import {
  confirmarEntregaReceta,
  getRecetasPendientesSucursal,
} from "../Services/sharepoint";

type RecetaProducto = {
  id?: number;
  detalleId?: number;
  productoId?: number;
  productoNombre: string;
  productoCodigo?: string;
  unidad?: string;
  cantidad: number;
  cantidadEntregada?: number;
  dosis?: string;
  esOtroProducto?: boolean;
  otroProductoNombre?: string;
};

type Receta = {
  id: number;
  numero: string;
  estado?: string;
  clienteNombre?: string;
  fincaNombre?: string;
  ingenieroNombre?: string;
  sucursalNombre?: string;
  createdAt?: string;
  fechaEnvio?: string;
  productos?: RecetaProducto[];
};

type ProductoConfirmacion = {
  detalleId: number;
  productoId?: number;
  entregadoCompleto: boolean;
  cantidadEntregada: number;
};

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function formatFecha(fecha?: string) {
  if (!fecha) return "-";
  const date = new Date(fecha);
  if (Number.isNaN(date.getTime())) return fecha;
  return date.toLocaleString();
}

function buildPrintableRecipeHtml(
  receta: Receta,
  factura: string,
  observacion: string,
  productosConfirmacion: ProductoConfirmacion[]
) {
  const productos = Array.isArray(receta.productos) ? receta.productos : [];
  const confirmacionMap = new Map(
    productosConfirmacion.map((item) => [Number(item.detalleId), item])
  );

  const rows = productos
    .map((producto, index) => {
      const detalleId = Number(producto.detalleId || producto.id || index + 1);
      const estado = confirmacionMap.get(detalleId);
      const cantidadEntregada = Number(
        estado?.cantidadEntregada ?? producto.cantidadEntregada ?? producto.cantidad ?? 0
      );
      const cantidadRecetada = Number(producto.cantidad || 0);
      const codigo = String(producto.productoCodigo || "").trim();
      const dosis = String(producto.dosis || "").trim();

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${String(producto.productoNombre || "Producto")}</td>
          <td>${codigo || "-"}</td>
          <td>${cantidadRecetada}</td>
          <td>${String(producto.unidad || "-")}</td>
          <td>${dosis || "-"}</td>
          <td>${cantidadEntregada}</td>
        </tr>
      `;
    })
    .join("");

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Receta ${String(receta.numero || "")}</title>
        <style>
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            margin: 0;
            padding: 32px;
          }
          h1, h2, h3, p { margin: 0; }
          .header { margin-bottom: 22px; }
          .brand { font-size: 28px; font-weight: 800; color: #15803d; margin-bottom: 8px; }
          .subtitle { font-size: 20px; font-weight: 700; margin-bottom: 18px; }
          .meta {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 12px 18px;
            margin-bottom: 24px;
          }
          .box {
            border: 1px solid #dbe2ea;
            border-radius: 12px;
            padding: 14px;
            background: #f8fafc;
          }
          .label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: #64748b;
            margin-bottom: 4px;
            text-transform: uppercase;
            letter-spacing: .04em;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 14px;
          }
          th, td {
            border: 1px solid #dbe2ea;
            padding: 10px;
            font-size: 13px;
            vertical-align: top;
          }
          th {
            background: #f1f5f9;
            text-align: left;
          }
          .section-title {
            font-size: 16px;
            font-weight: 800;
            margin: 18px 0 10px;
          }
          .observacion {
            min-height: 72px;
            white-space: pre-wrap;
          }
          @media print {
            body { padding: 20px; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div class="brand">AgroRecetas</div>
          <div class="subtitle">Receta #${String(receta.numero || "-")}</div>
        </div>

        <div class="meta">
          <div class="box"><span class="label">Cliente</span>${String(receta.clienteNombre || "-")}</div>
          <div class="box"><span class="label">Finca</span>${String(receta.fincaNombre || "-")}</div>
          <div class="box"><span class="label">Ingeniero</span>${String(receta.ingenieroNombre || "-")}</div>
          <div class="box"><span class="label">Sucursal</span>${String(receta.sucursalNombre || "-")}</div>
          <div class="box"><span class="label">Fecha de envío</span>${formatFecha(receta.fechaEnvio || receta.createdAt)}</div>
          <div class="box"><span class="label">Factura</span>${String(factura || "-")}</div>
        </div>

        <div class="section-title">Productos</div>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Producto</th>
              <th>Código</th>
              <th>Cantidad recetada</th>
              <th>Unidad</th>
              <th>Dosis</th>
              <th>Cantidad entregada</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="7">Sin productos</td></tr>`}
          </tbody>
        </table>

        <div class="section-title">Observación</div>
        <div class="box observacion">${String(observacion || "-")}</div>

        <script>
          window.onload = function() {
            window.focus();
            window.print();
          };
        </script>
      </body>
    </html>
  `;
}

function RecetasSucursales() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [recetas, setRecetas] = useState<Receta[]>([]);
  const [search, setSearch] = useState("");
  const [expandedIds, setExpandedIds] = useState<number[]>([]);

  const [modalOpen, setModalOpen] = useState(false);
  const [recetaSeleccionada, setRecetaSeleccionada] = useState<Receta | null>(null);
  const [factura, setFactura] = useState("");
  const [observacion, setObservacion] = useState("");
  const [imprimirReceta, setImprimirReceta] = useState(false);
  const [productosConfirmacion, setProductosConfirmacion] = useState<
    ProductoConfirmacion[]
  >([]);

  async function loadRecetas() {
    try {
      setLoading(true);
      const data = await getRecetasPendientesSucursal();
      setRecetas(Array.isArray(data) ? (data as Receta[]) : []);
    } catch (error) {
      console.error("Error cargando recetas sucursal:", error);
      setRecetas([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecetas();
  }, []);

  const recetasFiltradas = useMemo(() => {
    const term = normalizeText(search);
    if (!term) return recetas;

    return recetas.filter((r) => {
      return (
        normalizeText(r.numero).includes(term) ||
        normalizeText(r.clienteNombre).includes(term) ||
        normalizeText(r.fincaNombre).includes(term) ||
        normalizeText(r.ingenieroNombre).includes(term) ||
        normalizeText(r.sucursalNombre).includes(term)
      );
    });
  }, [recetas, search]);

  function toggleExpand(id: number) {
    setExpandedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function abrirModalConfirmacion(receta: Receta) {
    const productos = Array.isArray(receta.productos) ? receta.productos : [];

    setRecetaSeleccionada(receta);
    setFactura("");
    setObservacion("");
    setImprimirReceta(false);
    setProductosConfirmacion(
      productos.map((p, index) => {
        const detalleId = Number(p.detalleId || p.id || index + 1);
        return {
          detalleId,
          productoId: Number(p.productoId || 0) || undefined,
          entregadoCompleto: true,
          cantidadEntregada: Number(p.cantidad || 0),
        };
      })
    );
    setModalOpen(true);
  }

  function cerrarModal() {
    if (saving) return;
    setModalOpen(false);
    setRecetaSeleccionada(null);
    setFactura("");
    setObservacion("");
    setImprimirReceta(false);
    setProductosConfirmacion([]);
  }

  function getEstadoProducto(detalleId: number) {
    return productosConfirmacion.find((p) => p.detalleId === detalleId);
  }

  function toggleProductoCompleto(
    detalleId: number,
    entregadoCompleto: boolean,
    cantidadRecetada: number
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) =>
        p.detalleId === detalleId
          ? {
              ...p,
              entregadoCompleto,
              cantidadEntregada: entregadoCompleto
                ? Number(cantidadRecetada)
                : Number(p.cantidadEntregada ?? 0),
            }
          : p
      )
    );
  }

  function cambiarCantidadEntregada(detalleId: number, cantidad: number) {
    setProductosConfirmacion((prev) =>
      prev.map((p) =>
        p.detalleId === detalleId
          ? {
              ...p,
              cantidadEntregada: cantidad < 0 ? 0 : cantidad,
            }
          : p
      )
    );
  }

  function imprimirRecetaComoPdf() {
    if (!recetaSeleccionada) return;

    const html = buildPrintableRecipeHtml(
      recetaSeleccionada,
      factura,
      observacion,
      productosConfirmacion
    );

    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) {
      alert("No se pudo abrir la ventana de impresión. Revisá si el navegador la bloqueó.");
      return;
    }

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }

  async function finalizarConfirmacion() {
    try {
      if (!recetaSeleccionada) return;

      if (!factura.trim()) {
        alert("Debe ingresar el número de factura");
        return;
      }

      const confirmacion = window.confirm(
        imprimirReceta
          ? "¿Desea finalizar la confirmación y abrir la receta para imprimirla o guardarla como PDF?"
          : "¿Desea finalizar la confirmación?"
      );

      if (!confirmacion) return;

      setSaving(true);

      await confirmarEntregaReceta(recetaSeleccionada.id, {
        factura,
        observacion,
        detalles: productosConfirmacion.map((p) => ({
          detalleId: Number(p.detalleId),
          productoId: Number(p.productoId || 0) || undefined,
          cantidadEntregada: Number(p.cantidadEntregada || 0),
        })),
      });

      if (imprimirReceta) {
        imprimirRecetaComoPdf();
      }

      cerrarModal();
      await loadRecetas();
    } catch (error) {
      console.error("Error confirmando entrega:", error);
      alert("No se pudo finalizar la confirmación");
    } finally {
      setSaving(false);
    }
  }

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
              background: "#ede9fe",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#7c3aed",
            }}
          >
            <ClipboardList size={22} />
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
              Recetas Sucursales
            </h1>
            <p style={{ margin: "6px 0 0", color: "#475569" }}>
              {recetas.length} recetas pendientes de confirmar
            </p>
          </div>
        </div>
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
          No hay recetas pendientes de confirmar
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {recetasFiltradas.map((receta) => {
            const expanded = expandedIds.includes(receta.id);
            const productos = Array.isArray(receta.productos) ? receta.productos : [];

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
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 999,
                          background: "#fff7ed",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#d97706",
                        }}
                      >
                        <Clock3 size={16} />
                      </div>

                      <strong style={{ fontSize: 20, color: "#0f172a" }}>
                        Receta #{receta.numero}
                      </strong>

                      <span
                        style={{
                          background: "#fffbeb",
                          color: "#a16207",
                          borderRadius: 999,
                          padding: "5px 10px",
                          fontSize: 12,
                          fontWeight: 700,
                        }}
                      >
                        Pendiente de Confirmar
                      </span>
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
                          <strong>Ingeniero:</strong> {receta.ingenieroNombre || "-"}
                        </p>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Sucursal:</strong> {receta.sucursalNombre || "-"}
                        </p>
                        <p style={{ margin: 0, color: "#64748b", fontSize: 14 }}>
                          Recibida el {formatFecha(receta.fechaEnvio || receta.createdAt)}
                        </p>
                      </div>

                      <div>
                        <p style={{ margin: "0 0 8px" }}>
                          <strong>Cliente:</strong> {receta.clienteNombre || "-"}
                        </p>
                        <p style={{ margin: 0 }}>
                          <strong>Finca:</strong> {receta.fincaNombre || "-"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 10,
                      alignItems: "flex-start",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => abrirModalConfirmacion(receta)}
                      style={{
                        border: "none",
                        background: "#15803d",
                        color: "#fff",
                        borderRadius: 12,
                        padding: "10px 14px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Confirmar
                    </button>

                    <button
                      type="button"
                      onClick={() => toggleExpand(receta.id)}
                      style={{
                        border: "none",
                        background: "transparent",
                        cursor: "pointer",
                        alignSelf: "flex-start",
                        width: 36,
                        height: 36,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
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
                      Productos ({productos.length})
                    </div>

                    {productos.length === 0 ? (
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
                      productos.map((p, index) => (
                        <div
                          key={`${p.detalleId || p.id || p.productoId || "producto"}-${index}`}
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
                          <div style={{ display: "grid", gap: 4 }}>
                            <span>
                              {p.productoNombre || "Producto"}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                              {p.unidad ? ` - ${p.unidad}` : ""}
                            </span>
                            {String(p.dosis || "").trim() && (
                              <span style={{ color: "#475569", fontSize: 13 }}>
                                <strong>Dosis:</strong> {p.dosis}
                              </span>
                            )}
                          </div>
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

      {modalOpen && recetaSeleccionada && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
            zIndex: 5000,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "92vh",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 24,
              boxShadow: "0 25px 60px rgba(15,23,42,0.22)",
            }}
          >
            <div
              style={{
                padding: "18px 22px",
                borderBottom: "1px solid #eef2f7",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                position: "sticky",
                top: 0,
                background: "#fff",
                zIndex: 5,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>
                  Confirmar Entrega - Receta #{recetaSeleccionada.numero}
                </h2>
              </div>

              <button
                type="button"
                onClick={cerrarModal}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 12,
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

            <div style={{ padding: 22 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                  gap: 14,
                  marginBottom: 24,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 14,
                }}
              >
                <div>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>Ingeniero:</strong> {recetaSeleccionada.ingenieroNombre || "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Sucursal:</strong> {recetaSeleccionada.sucursalNombre || "-"}
                  </p>
                </div>
                <div>
                  <p style={{ margin: "0 0 10px" }}>
                    <strong>Cliente:</strong> {recetaSeleccionada.clienteNombre || "-"}
                  </p>
                  <p style={{ margin: 0 }}>
                    <strong>Finca:</strong> {recetaSeleccionada.fincaNombre || "-"}
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: 18 }}>
                <h3 style={{ margin: "0 0 8px", fontSize: 16, fontWeight: 800 }}>
                  Confirmar Productos Entregados
                </h3>
                <p style={{ margin: 0, color: "#475569", lineHeight: 1.5 }}>
                  Marque los productos que fueron efectivamente entregados. Si un producto no fue
                  llevado completamente, desmarque y especifique la cantidad entregada.
                </p>
              </div>

              <div style={{ display: "grid", gap: 12, marginBottom: 20 }}>
                {(Array.isArray(recetaSeleccionada.productos)
                  ? recetaSeleccionada.productos
                  : []
                ).map((p, index) => {
                  const detalleId = Number(p.detalleId || p.id || index + 1);
                  const estado = getEstadoProducto(detalleId);
                  const entregadoCompleto = !!estado?.entregadoCompleto;
                  const cantidadEntregada = Number(estado?.cantidadEntregada || 0);

                  return (
                    <div
                      key={`${detalleId}-${index}`}
                      style={{
                        border: `1px solid ${entregadoCompleto ? "#bbf7d0" : "#fecaca"}`,
                        background: entregadoCompleto ? "#f0fdf4" : "#fff7f7",
                        borderRadius: 16,
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          alignItems: "flex-start",
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <label
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 10,
                              fontWeight: 800,
                              color: "#0f172a",
                              cursor: "pointer",
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={entregadoCompleto}
                              onChange={(e) =>
                                toggleProductoCompleto(
                                  detalleId,
                                  e.target.checked,
                                  Number(p.cantidad || 0)
                                )
                              }
                            />
                            <span>
                              {p.productoNombre || "Producto"}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                            </span>
                          </label>

                          <div
                            style={{
                              marginTop: 10,
                              display: "grid",
                              gap: 4,
                              color: "#475569",
                              fontSize: 14,
                            }}
                          >
                            <div>
                              <strong>Cantidad recetada:</strong> {p.cantidad} {p.unidad || ""}
                            </div>

                            {String(p.dosis || "").trim() && (
                              <div>
                                <strong>Dosis:</strong> {p.dosis}
                              </div>
                            )}
                          </div>
                        </div>

                        <span
                          style={{
                            background: entregadoCompleto ? "#dcfce7" : "#fee2e2",
                            color: entregadoCompleto ? "#166534" : "#b91c1c",
                            borderRadius: 999,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entregadoCompleto ? "Llevado" : "Parcial"}
                        </span>
                      </div>

                      {!entregadoCompleto && (
                        <div
                          style={{
                            marginTop: 14,
                            border: "1px solid #fecaca",
                            borderRadius: 12,
                            padding: 12,
                            maxWidth: 360,
                            background: "#fff",
                          }}
                        >
                          <label
                            style={{
                              display: "block",
                              fontSize: 14,
                              fontWeight: 700,
                              color: "#dc2626",
                              marginBottom: 8,
                            }}
                          >
                            ¿Cuántas unidades llevó realmente?
                          </label>

                          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                            <input
                              type="number"
                              min={0}
                              max={Number(p.cantidad || 0)}
                              value={cantidadEntregada}
                              onChange={(e) =>
                                cambiarCantidadEntregada(
                                  detalleId,
                                  Number(e.target.value)
                                )
                              }
                              style={{
                                width: 100,
                                borderRadius: 10,
                                border: "1px solid #d9e2ec",
                                padding: "10px 12px",
                              }}
                            />
                            <span style={{ color: "#64748b", fontSize: 14 }}>
                              de {p.cantidad} recetadas
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>
                  Número de Factura *
                </label>

                <p style={{ margin: "0 0 8px", color: "#64748b", fontSize: 14 }}>
                  Ingrese el número de factura o documento de entrega.
                </p>

                <input
                  type="text"
                  value={factura}
                  onChange={(e) => setFactura(e.target.value)}
                  placeholder="Ej: FAC-2024-001"
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid #d9e2ec",
                    padding: "12px 14px",
                    fontSize: 15,
                  }}
                />
              </div>

              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 700 }}>
                  Observación
                </label>

                <textarea
                  value={observacion}
                  onChange={(e) => setObservacion(e.target.value)}
                  placeholder="Detalle adicional de la entrega..."
                  rows={3}
                  style={{
                    width: "100%",
                    borderRadius: 12,
                    border: "1px solid #d9e2ec",
                    padding: "12px 14px",
                    fontSize: 15,
                    resize: "vertical",
                  }}
                />
              </div>

              <div
                style={{
                  marginBottom: 14,
                  border: "1px solid #fde68a",
                  background: "#fffbeb",
                  color: "#92400e",
                  borderRadius: 14,
                  padding: 16,
                  display: "flex",
                  gap: 12,
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ display: "block", marginBottom: 6 }}>
                    Acción Irreversible
                  </strong>
                  <span>
                    Una vez finalizada la confirmación, no podrá editar los productos
                    entregados. Asegúrese de verificar toda la información antes de continuar.
                  </span>
                </div>
              </div>

              <div
                style={{
                  marginBottom: 22,
                  border: "1px solid #dbe2ea",
                  background: "#f8fafc",
                  borderRadius: 14,
                  padding: 16,
                }}
              >
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    cursor: "pointer",
                    fontWeight: 700,
                    color: "#0f172a",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={imprimirReceta}
                    onChange={(e) => setImprimirReceta(e.target.checked)}
                  />
                  Imprimir / guardar receta en PDF al finalizar
                </label>

                <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 14 }}>
                  Si marca esta opción, al finalizar se abrirá la receta para imprimirla o
                  guardarla como PDF.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: 12,
                }}
              >
                <button
                  type="button"
                  onClick={cerrarModal}
                  style={{
                    border: "1px solid #d9e2ec",
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
                  type="button"
                  onClick={finalizarConfirmacion}
                  disabled={saving}
                  style={{
                    border: "none",
                    background: "#15803d",
                    color: "#fff",
                    borderRadius: 12,
                    padding: "12px 18px",
                    fontWeight: 700,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    minWidth: 180,
                    justifyContent: "center",
                  }}
                >
                  <Check size={16} />
                  {saving ? "Finalizando..." : "Finalizar Confirmación"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RecetasSucursales;
