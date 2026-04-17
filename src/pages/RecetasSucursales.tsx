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
import logoSurco from "../assets/logo-surco.png";

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
  const [imprimirReceta, setImprimirReceta] = useState(true);
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
    setImprimirReceta(true);
    setProductosConfirmacion(
      productos.map((p) => ({
        detalleId: p.detalleId,
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
    setImprimirReceta(true);
    setProductosConfirmacion([]);
  }

  function getEstadoProducto(productoId: number, detalleId?: number) {
    return productosConfirmacion.find(
      (p) =>
        (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
        Number(p.productoId) === Number(productoId)
    );
  }

  function toggleProductoCompleto(
    productoId: number,
    entregadoCompleto: boolean,
    cantidadRecetada: number,
    detalleId?: number
  ) {
    setProductosConfirmacion((prev) =>
      prev.map((p) => {
        const same =
          (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
          Number(p.productoId) === Number(productoId);

        if (!same) return p;

        return {
          ...p,
          entregadoCompleto,
          cantidadEntregada: entregadoCompleto
            ? Number(cantidadRecetada)
            : Number(p.cantidadEntregada ?? 0),
        };
      })
    );
  }

  function cambiarCantidadEntregada(productoId: number, cantidad: number, detalleId?: number) {
    setProductosConfirmacion((prev) =>
      prev.map((p) => {
        const same =
          (detalleId && p.detalleId ? Number(p.detalleId) === Number(detalleId) : false) ||
          Number(p.productoId) === Number(productoId);

        if (!same) return p;

        return {
          ...p,
          cantidadEntregada: cantidad < 0 ? 0 : cantidad,
        };
      })
    );
  }

  function imprimirRecetaPDF(receta: Receta, facturaNumero: string, observacionTexto: string) {
    const productos = Array.isArray(receta.productos) ? receta.productos : [];

    const productosHtml = productos
      .map(
        (p, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(p.productoNombre || "-")}</td>
            <td>${escapeHtml(p.productoCodigo || "-")}</td>
            <td>${escapeHtml(p.unidad || "-")}</td>
            <td>${escapeHtml(p.cantidad || 0)}</td>
            <td>${escapeHtml(p.dosis || "-")}</td>
          </tr>
        `
      )
      .join("");

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Receta ${escapeHtml(receta.numero)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              margin: 0;
              font-family: Arial, Helvetica, sans-serif;
              color: #0f172a;
              background: #f8fafc;
            }
            .page {
              width: 100%;
              max-width: 900px;
              margin: 28px auto;
              background: #ffffff;
              border-radius: 18px;
              overflow: hidden;
              box-shadow: 0 16px 40px rgba(15, 23, 42, 0.12);
              border: 1px solid #e2e8f0;
            }
            .topbar {
              height: 10px;
              background: linear-gradient(90deg, #0ea5e9, #22c55e, #eab308, #f97316);
            }
            .header {
              display: flex;
              align-items: center;
              justify-content: space-between;
              gap: 16px;
              padding: 24px 28px 18px;
              border-bottom: 1px solid #e2e8f0;
            }
            .brand {
              display: flex;
              align-items: center;
              gap: 16px;
            }
            .brand img {
              width: 180px;
              max-width: 100%;
              height: auto;
              display: block;
            }
            .meta {
              text-align: right;
              font-size: 12px;
              color: #64748b;
            }
            .content {
              padding: 28px;
            }
            .title {
              margin: 0 0 6px;
              font-size: 28px;
              font-weight: 800;
              color: #14532d;
            }
            .subtitle {
              margin: 0 0 22px;
              font-size: 14px;
              color: #64748b;
            }
            .grid {
              display: grid;
              grid-template-columns: repeat(2, minmax(0, 1fr));
              gap: 14px;
              margin-bottom: 24px;
            }
            .card {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 14px;
              padding: 16px;
            }
            .label {
              display: block;
              font-size: 12px;
              font-weight: 700;
              color: #64748b;
              margin-bottom: 4px;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            .value {
              font-size: 15px;
              font-weight: 700;
              color: #0f172a;
              word-break: break-word;
            }
            .obs-box {
              margin-bottom: 22px;
              background: #f0fdf4;
              border: 1px solid #bbf7d0;
              border-radius: 14px;
              padding: 16px;
            }
            .obs-title {
              margin: 0 0 8px;
              font-size: 14px;
              font-weight: 800;
              color: #166534;
            }
            .obs-text {
              margin: 0;
              font-size: 14px;
              color: #0f172a;
              line-height: 1.6;
              white-space: pre-wrap;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              overflow: hidden;
              border-radius: 14px;
              border: 1px solid #e2e8f0;
            }
            thead th {
              background: #166534;
              color: #ffffff;
              text-align: left;
              padding: 12px 14px;
              font-size: 13px;
            }
            tbody td {
              padding: 12px 14px;
              border-top: 1px solid #e2e8f0;
              font-size: 14px;
            }
            tbody tr:nth-child(even) {
              background: #f8fafc;
            }
            .footer {
              padding: 18px 28px 24px;
              color: #64748b;
              font-size: 12px;
            }
            @media print {
              body {
                background: #fff;
              }
              .page {
                box-shadow: none;
                border: none;
                margin: 0;
                max-width: 100%;
                border-radius: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="topbar"></div>
            <div class="header">
              <div class="brand">
                <img src="${logoSurco}" alt="SURCO" />
              </div>
              <div class="meta">
                <div><strong>Receta:</strong> ${escapeHtml(receta.numero)}</div>
                <div><strong>Fecha:</strong> ${escapeHtml(new Date().toLocaleString())}</div>
              </div>
            </div>

            <div class="content">
              <h1 class="title">Receta #${escapeHtml(receta.numero)}</h1>
              <p class="subtitle">Comprobante de entrega generado desde el sistema SURCO.</p>

              <div class="grid">
                <div class="card">
                  <span class="label">Cliente</span>
                  <div class="value">${escapeHtml(receta.clienteNombre || "-")}</div>
                </div>
                <div class="card">
                  <span class="label">Finca</span>
                  <div class="value">${escapeHtml(receta.fincaNombre || "-")}</div>
                </div>
                <div class="card">
                  <span class="label">Ingeniero</span>
                  <div class="value">${escapeHtml(receta.ingenieroNombre || "-")}</div>
                </div>
                <div class="card">
                  <span class="label">Sucursal</span>
                  <div class="value">${escapeHtml(receta.sucursalNombre || "-")}</div>
                </div>
                <div class="card">
                  <span class="label">Factura</span>
                  <div class="value">${escapeHtml(facturaNumero || "-")}</div>
                </div>
                <div class="card">
                  <span class="label">Estado</span>
                  <div class="value">Entrega confirmada</div>
                </div>
              </div>

              <div class="obs-box">
                <h3 class="obs-title">Observación</h3>
                <p class="obs-text">${escapeHtml(observacionTexto || "-")}</p>
              </div>

              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Producto</th>
                    <th>Código</th>
                    <th>Unidad</th>
                    <th>Cantidad</th>
                    <th>Dosis</th>
                  </tr>
                </thead>
                <tbody>
                  ${productosHtml}
                </tbody>
              </table>
            </div>

            <div class="footer">
              Documento generado automáticamente por SURCO.
            </div>
          </div>
          <script>
            window.onload = function () {
              setTimeout(function () {
                window.print();
              }, 250);
            };
          </script>
        </body>
      </html>
    `;

    const ventana = window.open("", "_blank", "width=1024,height=768");
    if (!ventana) {
      alert("No se pudo abrir la ventana de impresión. Verifique si el navegador está bloqueando ventanas emergentes.");
      return;
    }

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

      const ok = window.confirm(
        imprimirReceta
          ? "¿Desea finalizar la confirmación e imprimir/guardar la receta en PDF?"
          : "¿Desea finalizar la confirmación?"
      );

      if (!ok) return;

      setSaving(true);

      await confirmarEntregaReceta(recetaSeleccionada.id, {
        factura,
        observacion,
        detalles: productosConfirmacion.map((p) => ({
          detalleId: p.detalleId,
          productoId: Number(p.productoId || 0),
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
                            alignItems: "center",
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, color: "#0f172a" }}>
                              {p.productoNombre || "Producto"}
                              {p.productoCodigo ? ` (${p.productoCodigo})` : ""}
                              {p.unidad ? ` - ${p.unidad}` : ""}
                            </div>
                            {!!String(p.dosis || "").trim() && (
                              <div style={{ marginTop: 4, fontSize: 13, color: "#475569" }}>
                                <strong>Dosis:</strong> {p.dosis}
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
              <p style={{ margin: "0 0 20px", color: "#475569", lineHeight: 1.5 }}>
                Marque los productos que fueron efectivamente entregados. Si un producto no fue llevado
                completamente, desmarque y especifique la cantidad entregada.
              </p>

              <div style={{ display: "grid", gap: 12, marginBottom: 22 }}>
                {(recetaSeleccionada.productos || []).map((producto, index) => {
                  const estado = getEstadoProducto(producto.productoId, producto.detalleId);

                  return (
                    <div
                      key={`${producto.detalleId || producto.productoId}-${index}`}
                      style={{
                        border: "1px solid #bbf7d0",
                        background: "#f0fdf4",
                        borderRadius: 16,
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                          gap: 12,
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
                              checked={!!estado?.entregadoCompleto}
                              onChange={(e) =>
                                toggleProductoCompleto(
                                  producto.productoId,
                                  e.target.checked,
                                  Number(producto.cantidad || 0),
                                  producto.detalleId
                                )
                              }
                            />
                            <span>
                              {producto.productoNombre}
                              {producto.productoCodigo ? ` (${producto.productoCodigo})` : ""}
                            </span>
                          </label>

                          <div style={{ marginTop: 10, color: "#475569", fontSize: 14 }}>
                            <div>
                              <strong>Cantidad recetada:</strong> {producto.cantidad} {producto.unidad || ""}
                            </div>
                            {!!String(producto.dosis || "").trim() && (
                              <div style={{ marginTop: 4 }}>
                                <strong>Dosis:</strong> {producto.dosis}
                              </div>
                            )}
                          </div>
                        </div>

                        <span
                          style={{
                            background: estado?.entregadoCompleto ? "#dcfce7" : "#fee2e2",
                            color: estado?.entregadoCompleto ? "#166534" : "#991b1b",
                            borderRadius: 999,
                            padding: "6px 12px",
                            fontSize: 12,
                            fontWeight: 700,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {estado?.entregadoCompleto ? "Llevado" : "Parcial"}
                        </span>
                      </div>

                      {!estado?.entregadoCompleto && (
                        <div style={{ marginTop: 14 }}>
                          <label
                            style={{
                              display: "block",
                              marginBottom: 8,
                              fontWeight: 700,
                              color: "#0f172a",
                            }}
                          >
                            Cantidad entregada
                          </label>

                          <input
                            type="number"
                            min={0}
                            max={Number(producto.cantidad || 0)}
                            value={Number(estado?.cantidadEntregada || 0)}
                            onChange={(e) =>
                              cambiarCantidadEntregada(
                                producto.productoId,
                                Number(e.target.value || 0),
                                producto.detalleId
                              )
                            }
                            style={{
                              width: "100%",
                              borderRadius: 12,
                              border: "1px solid #d9e2ec",
                              padding: "12px 14px",
                              fontSize: 15,
                            }}
                          />
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
                  marginBottom: 16,
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
                    Una vez finalizada la confirmación, no podrá editar los productos entregados.
                    Asegúrese de verificar toda la información antes de continuar.
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
                  Si marca esta opción, al finalizar se abrirá una versión lista para imprimir o guardar como PDF.
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
