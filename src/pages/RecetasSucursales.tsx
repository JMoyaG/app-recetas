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
  detalleId?: number;
  productoId: number;
  productoNombre: string;
  productoCodigo?: string;
  unidad?: string;
  cantidad: number;
  cantidadEntregada?: number;
  dosis?: string;
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
  detalleId?: number;
  productoId: number;
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

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
      productos.map((p) => ({
        detalleId: Number(p.detalleId || 0) || undefined,
        productoId: Number(p.productoId),
        entregadoCompleto: true,
        cantidadEntregada: Number(p.cantidad || 0),
      }))
    );
    setModalOpen(true);
  }

  function cerrarModal() {
    setModalOpen(false);
    setRecetaSeleccionada(null);
    setFactura("");
    setObservacion("");
    setImprimirReceta(false);
    setProductosConfirmacion([]);
  }

  function getEstadoProducto(detalleId?: number, productoId?: number) {
    return productosConfirmacion.find(
      (p) =>
        (detalleId && p.detalleId === detalleId) ||
        (!detalleId && Number(p.productoId) === Number(productoId))
    );
  }

  function toggleProductoCompleto(
    detalleId: number | undefined,
    productoId: number,
    entregadoCompleto: boolean,
    cantidadRecetada: number
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) =>
        ((detalleId && p.detalleId === detalleId) ||
          (!detalleId && p.productoId === productoId))
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

  function cambiarCantidadEntregada(
    detalleId: number | undefined,
    productoId: number,
    cantidad: number
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) =>
        ((detalleId && p.detalleId === detalleId) ||
          (!detalleId && p.productoId === productoId))
          ? {
              ...p,
              cantidadEntregada: cantidad < 0 ? 0 : cantidad,
            }
          : p
      )
    );
  }

  function imprimirRecetaPDF(receta: Receta, facturaNumero: string, observacionTexto: string) {
    const productos = Array.isArray(receta.productos) ? receta.productos : [];

    const productosHtml = productos
      .map(
        (p, index) => `
          <tr>
            <td style="border:1px solid #d1d5db;padding:8px;">${index + 1}</td>
            <td style="border:1px solid #d1d5db;padding:8px;">${escapeHtml(p.productoNombre || "")}</td>
            <td style="border:1px solid #d1d5db;padding:8px;">${escapeHtml(p.productoCodigo || "")}</td>
            <td style="border:1px solid #d1d5db;padding:8px;">${escapeHtml(p.unidad || "")}</td>
            <td style="border:1px solid #d1d5db;padding:8px;">${escapeHtml(p.cantidad || 0)}</td>
            <td style="border:1px solid #d1d5db;padding:8px;">${escapeHtml(p.dosis || "-")}</td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Receta ${escapeHtml(receta.numero)}</title>
        </head>
        <body style="font-family:Arial,Helvetica,sans-serif;padding:24px;color:#111827;">
          <h1 style="margin:0 0 6px;">SURCO</h1>
          <h2 style="margin:0 0 18px;">Receta #${escapeHtml(receta.numero)}</h2>

          <div style="margin-bottom:18px;line-height:1.7;">
            <div><strong>Ingeniero:</strong> ${escapeHtml(receta.ingenieroNombre || "-")}</div>
            <div><strong>Cliente:</strong> ${escapeHtml(receta.clienteNombre || "-")}</div>
            <div><strong>Finca:</strong> ${escapeHtml(receta.fincaNombre || "-")}</div>
            <div><strong>Sucursal:</strong> ${escapeHtml(receta.sucursalNombre || "-")}</div>
            <div><strong>Factura:</strong> ${escapeHtml(facturaNumero || "-")}</div>
            <div><strong>Observación:</strong> ${escapeHtml(observacionTexto || "-")}</div>
          </div>

          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            <thead>
              <tr>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">#</th>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">Producto</th>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">Código</th>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">Unidad</th>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">Cantidad</th>
                <th style="border:1px solid #d1d5db;padding:8px;background:#f8fafc;">Dosis</th>
              </tr>
            </thead>
            <tbody>${productosHtml}</tbody>
          </table>

          <script>window.onload = function(){ window.print(); };</script>
        </body>
      </html>
    `;

    const ventana = window.open("", "_blank", "width=900,height=700");
    if (!ventana) return;
    ventana.document.open();
    ventana.document.write(html);
    ventana.document.close();
  }

  async function finalizarConfirmacion() {
    try {
      if (!recetaSeleccionada) return;

      if (!factura.trim()) {
        alert("Debe ingresar el número de factura");
        return;
      }

      const confirmado = window.confirm(
        imprimirReceta
          ? "¿Desea finalizar la confirmación y abrir la receta para imprimirla o guardarla como PDF?"
          : "¿Desea finalizar la confirmación?"
      );

      if (!confirmado) return;

      setSaving(true);

      await confirmarEntregaReceta(recetaSeleccionada.id, {
        factura,
        observacion,
        detalles: productosConfirmacion.map((p) => ({
          detalleId: Number(p.detalleId || 0) || undefined,
          productoId: Number(p.productoId),
          cantidadEntregada: Number(p.cantidadEntregada || 0),
        })),
      });

      if (imprimirReceta) {
        imprimirRecetaPDF(recetaSeleccionada, factura, observacion);
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
                          key={`${p.detalleId || p.productoId}-${index}`}
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
                          <div>
                            <div>
                              {p.productoNombre || "Producto"}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                              {p.unidad ? ` - ${p.unidad}` : ""}
                            </div>
                            {!!String(p.dosis || "").trim() && (
                              <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                                Dosis: {p.dosis}
                              </div>
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
            zIndex: 1000,
            padding: 24,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "90vh",
              overflowY: "auto",
              background: "#fff",
              borderRadius: 22,
              boxShadow: "0 24px 80px rgba(15,23,42,0.18)",
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
              <h2 style={{ margin: 0, fontSize: 22, color: "#0f172a" }}>
                Confirmar Entrega - Receta #{recetaSeleccionada.numero}
              </h2>

              <button
                type="button"
                onClick={cerrarModal}
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

            <div style={{ padding: "0 24px 24px" }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0,1fr))",
                  gap: 16,
                  marginBottom: 24,
                  background: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  borderRadius: 16,
                  padding: 16,
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

              <h3 style={{ margin: "0 0 8px", fontSize: 18 }}>
                Confirmar Productos Entregados
              </h3>

              <p style={{ margin: "0 0 18px", color: "#475569", lineHeight: 1.5 }}>
                Marque los productos que fueron efectivamente entregados. Si un
                producto no fue llevado completamente, desmarque y especifique la
                cantidad entregada.
              </p>

              <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
                {(Array.isArray(recetaSeleccionada.productos)
                  ? recetaSeleccionada.productos
                  : []
                ).map((p, index) => {
                  const estado = getEstadoProducto(p.detalleId, p.productoId);
                  const entregadoCompleto = estado?.entregadoCompleto ?? true;
                  const cantidadEntregada = estado?.cantidadEntregada ?? Number(p.cantidad || 0);

                  return (
                    <div
                      key={`${p.detalleId || p.productoId}-${index}`}
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
                        <label
                          style={{
                            display: "flex",
                            gap: 12,
                            alignItems: "flex-start",
                            flex: 1,
                            cursor: "pointer",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={entregadoCompleto}
                            onChange={(e) =>
                              toggleProductoCompleto(
                                p.detalleId,
                                p.productoId,
                                e.target.checked,
                                Number(p.cantidad || 0)
                              )
                            }
                            style={{ marginTop: 4 }}
                          />
                          <div>
                            <strong style={{ display: "block", marginBottom: 6 }}>
                              {p.productoNombre}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                            </strong>
                            <div style={{ color: "#64748b", fontSize: 14 }}>
                              Cantidad recetada: {p.cantidad} {p.unidad || ""}
                            </div>
                            {!!String(p.dosis || "").trim() && (
                              <div style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
                                Dosis: {p.dosis}
                              </div>
                            )}
                          </div>
                        </label>

                        <span
                          style={{
                            background: entregadoCompleto ? "#dcfce7" : "#fee2e2",
                            color: entregadoCompleto ? "#166534" : "#b91c1c",
                            borderRadius: 999,
                            padding: "5px 10px",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {entregadoCompleto ? "Llevado" : "No llevado"}
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
                                  p.detalleId,
                                  p.productoId,
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
                  marginBottom: 22,
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
                  Si marca esta opción, al finalizar se abrirá la receta para imprimirla
                  o guardarla como PDF.
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
