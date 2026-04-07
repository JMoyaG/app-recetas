const API_URL = "https:////app-recetas-o6t4.onrender.com/api";

function getToken(): string | null {
  return localStorage.getItem("app_token") || localStorage.getItem("token") || null;
}

function clearSessionStorage() {
  localStorage.removeItem("app_token");
  localStorage.removeItem("token");
  localStorage.removeItem("app_user");
}

function buildHeaders(optionsHeaders?: HeadersInit, includeJson = true): HeadersInit {
  const token = getToken();

  return {
    ...(includeJson ? { "Content-Type": "application/json" } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(optionsHeaders || {}),
  };
}

async function http<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: buildHeaders(options.headers, !isFormData),
    body: options.body,
  });

  const contentType = res.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await res.json() : await res.text();

  if (res.status === 401) {
    clearSessionStorage();
    const message = typeof data === "string" ? data : data?.error || data?.message || "Token inválido";
    throw new Error(message || "Token inválido");
  }

  if (!res.ok) {
    const message = typeof data === "string" ? data : data?.error || data?.message || "Error en request";
    throw new Error(message);
  }

  return data as T;
}

async function downloadBlob(path: string): Promise<Blob> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: buildHeaders(undefined, false),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "No se pudo descargar el archivo");
  }

  return await res.blob();
}

export type UserRole = "Mantenimiento" | "Administrativo" | "Ingeniero" | "Sucursal";
export type UnidadProducto = "Kg" | "Ltr" | "UND";

export type UsuarioSP = {
  id: number;
  nombre: string;
  correo?: string;
  email?: string;
  usuario: string;
  rol: string;
  activo: boolean;
  ingenieroId?: number | null;
  ingenieroNombre?: string;
  sucursalId?: number | null;
  sucursalNombre?: string;
};

export type ClienteSP = {
  id: number;
  nombre: string;
  apellido: string;
  telefono: string;
};

export type IngenieroSP = {
  id: number;
  nombre: string;
  apellido: string;
  telefono: string;
  nombreCompleto: string;
  activo?: boolean;
};

export type FincaSP = {
  id: number;
  nombre: string;
  ubicacion: string;
  clienteId: number;
  cliente?: string;
  activo?: boolean;
};

export type SucursalSP = {
  id: number;
  nombre: string;
  correo: string;
  activa?: boolean;
  descripcion?: string;
};

export type ProductoSP = {
  id: number;
  nombre: string;
  codigo: string;
  unidad: UnidadProducto | string;
};

export type RecetaProducto = {
  id?: number;
  recetaIngenieroId?: number;
  productoId?: number;
  productoNombre?: string;
  productoCodigo?: string;
  codigoProducto?: string;
  unidad?: string;
  cantidad: number;
  cantidadEntregada?: number;
  porcentajeCumplimiento?: number;
  dosis?: string;
  esOtroProducto?: boolean;
  otroProductoNombre?: string;
};

export type RecetaIngeniero = {
  id: number;
  numero: string;
  estado?: string;
  clienteId?: number;
  fincaId?: number;
  ingenieroId?: number;
  sucursalId?: number;
  clienteNombre?: string;
  fincaNombre?: string;
  ingenieroNombre?: string;
  sucursalNombre?: string;
  createdAt?: string;
  fechaEnvio?: string;
  fechaConfirmacion?: string;
  finalizadaAt?: string;
  factura?: string;
  observacion?: string;
  totalProductos?: number;
  totalSolicitado?: number;
  totalEntregado?: number;
  porcentajeCumplimiento?: number;
  productosCompletos?: number;
  productos: RecetaProducto[];
};

export type RecetaIngenieroPayload = {
  ingenieroId: number;
  clienteId: number;
  fincaId: number;
  sucursalId: number;
  productos: Array<{
    productoId?: number;
    cantidad: number;
    dosis?: string;
    esOtroProducto?: boolean;
    otroProductoNombre?: string;
    productoNombre?: string;
    codigo?: string;
    unidad?: string;
  }>;
};

export type ConfirmarEntregaPayload = {
  factura?: string;
  observacion?: string;
  detalles: Array<{
    detalleId?: number;
    productoId?: number;
    cantidadEntregada: number;
  }>;
};

export type HistorialResumenSP = {
  recetasFinalizadas: number;
  efectividadPromedio: number;
  productosCompletos: number;
  totalProductos: number;
};

export type HistorialRecetaSP = {
  id: number;
  numero: string;
  clienteNombre?: string;
  fincaNombre?: string;
  ingenieroNombre?: string;
  sucursalNombre?: string;
  fechaConfirmacion?: string;
  finalizadaAt?: string;
  factura?: string;
  observacion?: string;
  porcentajeCumplimiento: number;
  cumplimiento: number;
  totalSolicitado: number;
  totalEntregado: number;
  productosCompletos: number;
  totalProductos: number;
  productos: Array<{
    productoNombre?: string;
    codigoProducto?: string;
    unidad?: string;
    cantidadRecetada: number;
    cantidadEntregada: number;
    porcentajeCumplimiento: number;
    porcentaje: number;
  }>;
};

export async function login(usuario: string, password: string) {
  return await http<{ token: string; user: UsuarioSP }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ usuario, password }),
  });
}

export async function getClientes(): Promise<ClienteSP[]> {
  return await http<ClienteSP[]>("/clientes");
}

export async function createCliente(payload: Omit<ClienteSP, "id">) {
  return await http<ClienteSP>("/clientes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateCliente(id: number, payload: Omit<ClienteSP, "id">) {
  return await http<ClienteSP>(`/clientes/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteCliente(id: number) {
  return await http(`/clientes/${id}`, { method: "DELETE" });
}

export async function importarClientesMasivo() {
  return await http("/clientes/importar", { method: "POST" });
}

export async function getIngenieros(): Promise<IngenieroSP[]> {
  return await http<IngenieroSP[]>("/ingenieros");
}

export async function createIngeniero(payload: Omit<IngenieroSP, "id" | "nombreCompleto">) {
  return await http<IngenieroSP>("/ingenieros", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateIngeniero(id: number, payload: Omit<IngenieroSP, "id" | "nombreCompleto">) {
  return await http<IngenieroSP>(`/ingenieros/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteIngeniero(id: number) {
  return await http(`/ingenieros/${id}`, { method: "DELETE" });
}

export async function getFincas(): Promise<FincaSP[]> {
  return await http<FincaSP[]>("/fincas");
}

export async function createFinca(payload: { nombre: string; ubicacion: string; clienteId: number }) {
  return await http<FincaSP>("/fincas", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateFinca(id: number, payload: { nombre: string; ubicacion: string; clienteId: number }) {
  return await http<FincaSP>(`/fincas/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteFinca(id: number) {
  return await http(`/fincas/${id}`, { method: "DELETE" });
}

export async function getSucursales(): Promise<SucursalSP[]> {
  return await http<SucursalSP[]>("/sucursales");
}

export async function createSucursal(payload: { nombre: string; correo: string }) {
  return await http<SucursalSP>("/sucursales", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateSucursal(id: number, payload: { nombre: string; correo: string }) {
  return await http<SucursalSP>(`/sucursales/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteSucursal(id: number) {
  return await http(`/sucursales/${id}`, { method: "DELETE" });
}

export async function getProductos(): Promise<ProductoSP[]> {
  return await http<ProductoSP[]>("/productos");
}

export async function createProducto(payload: Omit<ProductoSP, "id">) {
  return await http<ProductoSP>("/productos", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateProducto(id: number, payload: Omit<ProductoSP, "id">) {
  return await http<ProductoSP>(`/productos/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteProducto(id: number) {
  return await http(`/productos/${id}`, { method: "DELETE" });
}

export async function descargarListaBaseProductos() {
  return await downloadBlob("/productos/lista-base");
}

export async function importarProductosArchivo(fileOrFormData: File | FormData) {
  const form = fileOrFormData instanceof FormData ? fileOrFormData : new FormData();
  if (!(fileOrFormData instanceof FormData)) {
    form.append("file", fileOrFormData);
  }
  return await http("/productos/importar-archivo", {
    method: "POST",
    body: form,
  });
}

export async function getUsuarios(): Promise<UsuarioSP[]> {
  return await http<UsuarioSP[]>("/usuarios");
}

export async function createUsuario(payload: {
  nombre: string;
  correo: string;
  usuario: string;
  password: string;
  rol: string;
  activo: boolean;
  ingenieroId?: number | null;
  sucursalId?: number | null;
}) {
  return await http<UsuarioSP>("/usuarios", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateUsuario(
  id: number,
  payload: {
    nombre: string;
    correo: string;
    usuario: string;
    password?: string;
    rol: string;
    activo: boolean;
    ingenieroId?: number | null;
    sucursalId?: number | null;

  }
) {
  return await http<UsuarioSP>(`/usuarios/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteUsuario(id: number) {
  return await http(`/usuarios/${id}`, { method: "DELETE" });
}

export async function getRecetasIngeniero(): Promise<RecetaIngeniero[]> {
  return await http<RecetaIngeniero[]>("/recetas/ingeniero");
}

export async function createRecetaIngeniero(payload: RecetaIngenieroPayload) {
  return await http<RecetaIngeniero>("/recetas/ingeniero", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function sendRecetaIngeniero(id: number) {
  return await http<RecetaIngeniero>(`/recetas/ingeniero/${id}/enviar`, {
    method: "POST",
  });
}

export async function getRecetasPendientesSucursal(): Promise<RecetaIngeniero[]> {
  return await http<RecetaIngeniero[]>("/recetas/sucursal");
}

export async function confirmarEntregaReceta(id: number, payload: ConfirmarEntregaPayload) {
  return await http<RecetaIngeniero>(`/recetas/sucursal/${id}/confirmar`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getHistorialResumen(): Promise<HistorialResumenSP> {
  return await http<HistorialResumenSP>("/historial/resumen");
}

export async function getHistorialRecetas(): Promise<HistorialRecetaSP[]> {
  return await http<HistorialRecetaSP[]>("/historial/recetas");
}

export async function exportarHistorialCSV() {
  return await downloadBlob("/historial/exportar");
}

