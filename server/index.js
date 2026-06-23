import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Primero carga server/.env para PM2/servidor. Luego permite root .env si existe.
dotenv.config({ path: path.join(__dirname, ".env") });
dotenv.config();

const app = express();
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "http://localhost:5173,https://app-recetas-d7ej.vercel.app")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || CORS_ORIGINS.includes("*") || CORS_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origen no permitido por CORS: ${origin}`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "20mb" }));

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "clave_super_secreta";

const TENANT_ID = process.env.AZURE_TENANT_ID || "";
const CLIENT_ID = process.env.AZURE_CLIENT_ID || "";
const CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || "";
const SHAREPOINT_HOSTNAME = process.env.SHAREPOINT_HOSTNAME || "";
const SHAREPOINT_SITE_PATH = process.env.SHAREPOINT_SITE_PATH || "";

const LIST_NAMES = {
  usuarios: process.env.SP_LIST_USUARIOS || "SP_Usuarios",
  clientes: process.env.SP_LIST_CLIENTES || "SP_Cliente",
  ingenieros: process.env.SP_LIST_INGENIEROS || "SP_Ingeniero",
  fincas: process.env.SP_LIST_FINCAS || "SP_Finca",
  sucursales: process.env.SP_LIST_SUCURSALES || "SP_Sucursal",
  productos: process.env.SP_LIST_PRODUCTOS || "SP_Producto",
  recetaIngeniero: process.env.SP_LIST_RECETA_INGENIERO || "SP_Receta Ingeniero",
  recetaProducto: process.env.SP_LIST_RECETA_PRODUCTO || "SP_Receta Producto",
  historial: process.env.SP_LIST_HISTORIAL || "SP_Historial",
  historialProducto:
    process.env.SP_LIST_HISTORIAL_PRODUCTO || "SP_HistorialRecetaProducto",
};

const USE_SQL_CATALOGS = parseBoolean(process.env.USE_SQL_CATALOGS || process.env.CATALOGOS_SQL || "false");
const SQL_PRODUCTOS_QUERY = String(
  process.env.SQL_PRODUCTOS_QUERY ||
    `SELECT TOP 5000
      idProducto AS id,
      codigo AS codigo,
      Producto AS nombre,
      Unidad AS unidad,
      Stock AS stock,
      Disponible AS disponible,
      Reservada AS reservada,
      PrecioVenta AS precioVenta
    FROM vw_AppRecetas_Productos
    ORDER BY Producto`
);
const SQL_CLIENTES_QUERY = String(
  process.env.SQL_CLIENTES_QUERY ||
    `SELECT TOP 5000
      idCliente AS id,
      Nombre AS nombre,
      Apellido AS apellido,
      Telefono AS telefono
    FROM vw_AppRecetas_Clientes
    ORDER BY Nombre, Apellido`
);

let SQL_POOL = null;
let SQL_MODULE = null;

let ACCESS_TOKEN = null;
let TOKEN_EXPIRES_AT = 0;
let SP_ACCESS_TOKEN = null;
let SP_TOKEN_EXPIRES_AT = 0;
let SITE_ID_CACHE = null;
const LIST_ID_CACHE = new Map();
const COLUMNS_CACHE = new Map();
const TITLE_SYNC_DONE = new Set();

// Cache simple en memoria para que Render no tenga que pedirle TODO a SharePoint
// en cada entrada a la pantalla. En Render se reinicia cuando el servicio reinicia,
// pero mientras está vivo responde casi instantáneo.
const DATA_CACHE = new Map();
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000);

function getCache(key) {
  const hit = DATA_CACHE.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    DATA_CACHE.delete(key);
    return null;
  }
  return hit.value;
}

function setCache(key, value, ttlMs = CACHE_TTL_MS) {
  DATA_CACHE.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

function clearCache(keyPrefix = "") {
  for (const key of DATA_CACHE.keys()) {
    if (!keyPrefix || key.startsWith(keyPrefix)) DATA_CACHE.delete(key);
  }
}

function decodeSharePointEscapes(value) {
  return String(value ?? "").replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return "";
    }
  });
}

function norm(value) {
  return decodeSharePointEscapes(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s\-]/g, "")
    .toLowerCase()
    .trim();
}

function isEmpty(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function firstDefined(...values) {
  for (const value of values) {
    if (!isEmpty(value)) return value;
  }
  return "";
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function pickField(row = {}, candidates = [], fallback = "") {
  const entries = Object.entries(row || {});
  for (const name of candidates) {
    const direct = row[name];
    if (!isEmpty(direct)) return direct;
    const wanted = norm(name);
    const found = entries.find(([key, value]) => norm(key) === wanted && !isEmpty(value));
    if (found) return found[1];
  }
  return fallback;
}

function normalizeSqlBool(value) {
  return parseBoolean(value);
}

function normalizeSqlConfigBool(value, fallback = false) {
  if (isEmpty(value)) return fallback;
  return normalizeSqlBool(value);
}

async function getSqlModule() {
  if (SQL_MODULE) return SQL_MODULE;
  const imported = await import("mssql");
  SQL_MODULE = imported.default || imported;
  return SQL_MODULE;
}

function requireSqlConfig() {
  if (!process.env.SQL_SERVER || !process.env.SQL_DATABASE || !process.env.SQL_USER || !process.env.SQL_PASSWORD) {
    throw new Error("Faltan variables SQL_SERVER, SQL_DATABASE, SQL_USER o SQL_PASSWORD en .env");
  }
}

async function getSqlPool() {
  requireSqlConfig();
  if (SQL_POOL?.connected) return SQL_POOL;

  const sql = await getSqlModule();
  SQL_POOL = await new sql.ConnectionPool({
    server: process.env.SQL_SERVER,
    database: process.env.SQL_DATABASE,
    user: process.env.SQL_USER,
    password: process.env.SQL_PASSWORD,
    port: Number(process.env.SQL_PORT || 1433),
    options: {
      encrypt: normalizeSqlConfigBool(process.env.SQL_ENCRYPT, false),
      trustServerCertificate: normalizeSqlConfigBool(process.env.SQL_TRUST_SERVER_CERTIFICATE, true),
    },
    pool: {
      max: Number(process.env.SQL_POOL_MAX || 10),
      min: Number(process.env.SQL_POOL_MIN || 0),
      idleTimeoutMillis: Number(process.env.SQL_POOL_IDLE_MS || 30000),
    },
    requestTimeout: Number(process.env.SQL_REQUEST_TIMEOUT_MS || 60000),
  }).connect();

  return SQL_POOL;
}

async function querySqlCatalog(sqlText) {
  const pool = await getSqlPool();
  const result = await pool.request().query(sqlText);
  return Array.isArray(result?.recordset) ? result.recordset : [];
}

function mapSqlCliente(row, index = 0) {
  const id = safeNumber(pickField(row, ["id", "idCliente", "IdCliente", "IDCLIENTE", "CodigoCliente", "codigoCliente"]), index + 1);
  const nombre = safeText(pickField(row, ["nombre", "Nombre", "Cliente", "NombreCliente", "RazonSocial", "Razon Social", "Razón Social"]));
  const apellido = safeText(pickField(row, ["apellido", "Apellido", "Apellidos"]));
  const telefono = safeText(pickField(row, ["telefono", "Telefono", "Teléfono", "Celular"]));

  return {
    id,
    nombre,
    apellido,
    telefono,
    origen: "sql",
  };
}

function mapSqlProducto(row, index = 0) {
  const id = safeNumber(pickField(row, ["id", "idProducto", "IdProducto", "IDPRODUCTO", "productoId"]), index + 1);
  const codigo = safeText(pickField(row, ["codigo", "Codigo", "Código", "CodigoProducto", "CódigoProducto", "CodProducto"]));
  const nombre = safeText(pickField(row, ["nombre", "Nombre", "Producto", "DescripLarga", "Descripcion", "Descripción"]));
  const unidad = safeText(pickField(row, ["unidad", "Unidad", "UnidadMedida", "Unidad de Medida", "Medida"]), "UND");

  return {
    id,
    nombre,
    codigo,
    unidad,
    stock: safeNumber(pickField(row, ["stock", "Stock", "Inventario", "Existencia"]), 0),
    disponible: safeNumber(pickField(row, ["disponible", "Disponible"]), 0),
    reservada: safeNumber(pickField(row, ["reservada", "Reservada", "Reserva"]), 0),
    precioVenta: safeNumber(pickField(row, ["precioVenta", "PrecioVenta", "Precio Venta", "Precio", "PrecioPublico", "Precio Público"]), 0),
    origen: "sql",
    esProductoSql: true,
  };
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const v = String(value ?? "").trim().toLowerCase();
  return ["1", "true", "si", "sí", "yes", "activo"].includes(v);
}

function nowIso() {
  return new Date().toISOString();
}

function buildNameVariants(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  const normalized = norm(raw);
  const compact = normalized.replace(/^clienteid/, "").trim();
  return Array.from(new Set([raw, normalized, compact].filter(Boolean)));
}

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function calcPercent(numerator, denominator) {
  const den = Number(denominator || 0);
  if (!den) return 0;
  return round2((Number(numerator || 0) / den) * 100);
}

function requireSharePointConfig() {
  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Faltan credenciales de Azure en .env");
  }

  if (!SHAREPOINT_HOSTNAME || !SHAREPOINT_SITE_PATH) {
    throw new Error("Faltan SHAREPOINT_HOSTNAME o SHAREPOINT_SITE_PATH en .env");
  }

  if (
    SHAREPOINT_HOSTNAME.includes("http://") ||
    SHAREPOINT_HOSTNAME.includes("https://") ||
    SHAREPOINT_HOSTNAME.includes("/sites/") ||
    SHAREPOINT_HOSTNAME.includes("/_layouts")
  ) {
    throw new Error(
      "SHAREPOINT_HOSTNAME debe ser solo el dominio, por ejemplo gruposurcocr.sharepoint.com"
    );
  }

  if (!SHAREPOINT_SITE_PATH.startsWith("/")) {
    throw new Error(
      "SHAREPOINT_SITE_PATH debe comenzar con /, por ejemplo /sites/Recetas"
    );
  }
}

function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ error: "Token requerido" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    console.error("ERROR TOKEN:", error?.message || error);
    return res.status(401).json({ error: "Token inválido" });
  }
}

async function getAccessToken() {
  requireSharePointConfig();

  const now = Date.now();
  if (ACCESS_TOKEN && now < TOKEN_EXPIRES_AT - 60_000) {
    return ACCESS_TOKEN;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      body,
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Error obteniendo token: ${response.status} -> ${JSON.stringify(data)}`
    );
  }

  ACCESS_TOKEN = data.access_token;
  TOKEN_EXPIRES_AT = now + Number(data.expires_in || 3600) * 1000;
  return ACCESS_TOKEN;
}


async function getSharePointAccessToken() {
  requireSharePointConfig();

  const now = Date.now();
  if (SP_ACCESS_TOKEN && now < SP_TOKEN_EXPIRES_AT - 60_000) {
    return SP_ACCESS_TOKEN;
  }

  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: `https://${SHAREPOINT_HOSTNAME}/.default`,
    grant_type: "client_credentials",
  });

  const response = await fetch(
    `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      body,
    }
  );

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `Error obteniendo token SharePoint: ${response.status} -> ${JSON.stringify(data)}`
    );
  }

  SP_ACCESS_TOKEN = data.access_token;
  SP_TOKEN_EXPIRES_AT = now + Number(data.expires_in || 3600) * 1000;
  return SP_ACCESS_TOKEN;
}

async function sharePointRestFetch(path, options = {}) {
  const token = await getSharePointAccessToken();
  const baseUrl = `https://${SHAREPOINT_HOSTNAME}${SHAREPOINT_SITE_PATH}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json;odata=nometadata",
      "Content-Type": "application/json;odata=nometadata",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `SharePoint REST error: ${response.status} ${response.statusText} -> ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function graphFetch(endpoint, options = {}) {
  const token = await getAccessToken();

  const response = await fetch(`https://graph.microsoft.com/v1.0${endpoint}`, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(
      `Graph error: ${response.status} ${response.statusText} -> ${JSON.stringify(data)}`
    );
  }

  return data;
}

async function getSiteId() {
  if (SITE_ID_CACHE) return SITE_ID_CACHE;

  const data = await graphFetch(
    `/sites/${SHAREPOINT_HOSTNAME}:${SHAREPOINT_SITE_PATH}?$select=id,name,webUrl`
  );

  SITE_ID_CACHE = data.id;
  return SITE_ID_CACHE;
}

async function getListIdByName(listName) {
  if (LIST_ID_CACHE.has(listName)) return LIST_ID_CACHE.get(listName);

  const siteId = await getSiteId();
  const data = await graphFetch(`/sites/${siteId}/lists?$top=200`);

  const list = (data.value || []).find((x) => {
    const name = String(x.name || "").toLowerCase();
    const display = String(x.displayName || "").toLowerCase();
    return name === listName.toLowerCase() || display === listName.toLowerCase();
  });

  if (!list) {
    throw new Error(`No se encontró la lista ${listName}`);
  }

  LIST_ID_CACHE.set(listName, list.id);
  return list.id;
}

async function getListColumns(listName, useCache = true) {
  if (useCache && COLUMNS_CACHE.has(listName)) {
    return COLUMNS_CACHE.get(listName);
  }

  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);
  const data = await graphFetch(`/sites/${siteId}/lists/${listId}/columns?$top=300`);
  const columns = data.value || [];
  COLUMNS_CACHE.set(listName, columns);
  return columns;
}

function buildFieldsExpand(columns = []) {
  const wanted = new Set(["Title"]);

  for (const col of columns || []) {
    const name = String(col?.name || "").trim();
    if (!name) continue;
    wanted.add(name);
    if (col?.lookup) {
      wanted.add(`${name}LookupId`);
      wanted.add(`${name}LookupValue`);
    }
  }

  const select = Array.from(wanted)
    .filter(Boolean)
    .join(",");

  return `$expand=fields($select=${encodeURIComponent(select)})`;
}

async function listItems(listName) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);
  const columns = await getListColumns(listName, true);
  const expand = buildFieldsExpand(columns);

  let endpoint = `/sites/${siteId}/lists/${listId}/items?${expand}&$top=999`;
  let items = [];

  while (endpoint) {
    const data = await graphFetch(endpoint);

    items = items.concat(data.value || []);

    if (data["@odata.nextLink"]) {
      endpoint = data["@odata.nextLink"].replace(
        "https://graph.microsoft.com/v1.0",
        ""
      );
    } else {
      endpoint = null;
    }
  }

  return items;
}

async function getItem(listName, itemId) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);
  const columns = await getListColumns(listName, false);
  const expand = buildFieldsExpand(columns);

  return await graphFetch(
    `/sites/${siteId}/lists/${listId}/items/${itemId}?${expand}`
  );
}

function isWritableColumn(col) {
  const blockedNames = [
    "linktitle",
    "linktitlenomenu",
    "linktitle2",
    "contenttype",
    "contenttypeid",
    "id",
    "modified",
    "created",
    "author",
    "editor",
    "attachments",
    "_moderationstatus",
    "_moderationcomments",
    "edit",
    "selecttitle",
    "instanceld",
    "instanceid",
    "order",
    "guid",
  ];

  const colName = norm(col?.name || "");
  return !col?.readOnly && !col?.hidden && !blockedNames.includes(colName);
}

function sanitizeFieldsForWrite(fields, columns = []) {
  const clean = {};
  const writableColumnNames = new Set(
    (columns || []).filter(isWritableColumn).map((col) => col.name)
  );

  for (const [key, value] of Object.entries(fields || {})) {
    if (value === undefined) continue;

    if (key.endsWith("LookupId")) {
      clean[key] = value;
      continue;
    }

    if (writableColumnNames.has(key)) {
      clean[key] = value;
    }
  }

  return clean;
}

async function createItem(listName, fields) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);
  const columns = await getListColumns(listName, false);
  const safeFields = sanitizeFieldsForWrite(fields, columns);

  return await graphFetch(`/sites/${siteId}/lists/${listId}/items`, {
    method: "POST",
    body: { fields: safeFields },
  });
}

async function updateItem(listName, itemId, fields) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);
  const columns = await getListColumns(listName, false);
  const safeFields = sanitizeFieldsForWrite(fields, columns);

  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}/fields`, {
    method: "PATCH",
    body: safeFields,
  });

  return { ok: true };
}


async function applyLookupFieldsSequentially(listName, itemId, fields = {}) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);

  for (const [key, value] of Object.entries(fields || {})) {
    if (!/LookupId$/i.test(String(key))) continue;
    if (value === null || value === undefined || value === "") continue;

    const numericValue = Number(value);
    const fieldName = String(key).replace(/LookupId$/i, "");

    const attempts = [
      {
        label: "fields-endpoint:number",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}/fields`,
        options: { method: "PATCH", body: { [key]: numericValue } },
      },
      {
        label: "fields-endpoint:string",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}/fields`,
        options: { method: "PATCH", body: { [key]: String(numericValue) } },
      },
      {
        label: "item-endpoint:number",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}`,
        options: { method: "PATCH", body: { fields: { [key]: numericValue } } },
      },
      {
        label: "item-endpoint:string",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}`,
        options: { method: "PATCH", body: { fields: { [key]: String(numericValue) } } },
      },
      {
        label: "fields-endpoint:id-suffix-number",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}/fields`,
        options: { method: "PATCH", body: { [`${fieldName}Id`]: numericValue } },
      },
      {
        label: "fields-endpoint:id-suffix-string",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}/fields`,
        options: { method: "PATCH", body: { [`${fieldName}Id`]: String(numericValue) } },
      },
      {
        label: "item-endpoint:id-suffix-number",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}`,
        options: { method: "PATCH", body: { fields: { [`${fieldName}Id`]: numericValue } } },
      },
      {
        label: "item-endpoint:id-suffix-string",
        endpoint: `/sites/${siteId}/lists/${listId}/items/${Number(itemId)}`,
        options: { method: "PATCH", body: { fields: { [`${fieldName}Id`]: String(numericValue) } } },
      },
    ];

    let success = false;
    let lastError = null;

    for (const attempt of attempts) {
      try {
        console.log("PATCH LOOKUP GRAPH ATTEMPT:", {
          listName,
          itemId,
          key,
          fieldName,
          value: numericValue,
          mode: attempt.label,
          body: attempt.options.body,
        });
        await graphFetch(attempt.endpoint, attempt.options);
        success = true;
        break;
      } catch (error) {
        lastError = error;
        console.warn("PATCH LOOKUP GRAPH FAILED:", {
          listName,
          itemId,
          key,
          fieldName,
          value: numericValue,
          mode: attempt.label,
          error: error?.message || error,
        });
      }
    }

    if (!success) {
      throw lastError || new Error(`No se pudo actualizar lookup ${key}`);
    }
  }
}

async function deleteItem(listName, itemId) {
  const siteId = await getSiteId();
  const listId = await getListIdByName(listName);

  await graphFetch(`/sites/${siteId}/lists/${listId}/items/${itemId}`, {
    method: "DELETE",
  });

  return { ok: true };
}

function keysByNormalized(fields = {}) {
  return Object.keys(fields || {}).reduce((acc, key) => {
    acc[norm(key)] = key;
    return acc;
  }, {});
}

function getFieldValue(fields = {}, candidates = []) {
  const direct = keysByNormalized(fields);

  for (const candidate of candidates) {
    const match = direct[norm(candidate)];
    if (match && !isEmpty(fields[match])) {
      return fields[match];
    }
  }

  for (const candidate of candidates) {
    const n = norm(candidate);
    const match = Object.keys(fields).find((key) => norm(key).includes(n));
    if (match && !isEmpty(fields[match])) {
      return fields[match];
    }
  }

  return "";
}

function getLookupIdValue(fields = {}, candidates = []) {
  const fullCandidates = [];
  for (const candidate of candidates) {
    fullCandidates.push(
      `${candidate}LookupId`,
      `${candidate}_LookupId`,
      `${candidate}Id`,
      `${candidate}_Id`,
      candidate
    );
  }

  const raw = getFieldValue(fields, fullCandidates);
  if (raw && typeof raw === "object") {
    return safeNumber(raw.LookupId ?? raw.Id ?? raw.id ?? raw.value, 0);
  }

  return safeNumber(raw, 0);
}

function getLookupTextValue(fields = {}, candidates = []) {
  const fullCandidates = [];
  for (const candidate of candidates) {
    fullCandidates.push(`${candidate}LookupValue`, candidate);
  }
  return String(getFieldValue(fields, fullCandidates) || "").trim();
}

function resolveColumn(columns, candidates = [], opts = {}) {
  const normalized = candidates.map(norm);
  const { lookupOnly = false, writableOnly = false, exact = false } = opts;

  return (columns || []).find((col) => {
    if (lookupOnly && !col.lookup) return false;
    if (writableOnly && !isWritableColumn(col)) return false;

    const targets = [col.name, col.displayName, col.description]
      .filter(Boolean)
      .map(norm);

    return normalized.some((candidate) =>
      targets.some((t) => (exact ? t === candidate : t === candidate || t.includes(candidate)))
    );
  });
}

function resolveLookupWriteKey(columns, candidates = []) {
  const strictLookup = resolveColumn(columns, candidates, {
    lookupOnly: true,
    writableOnly: true,
  });

  if (strictLookup) {
    const name = String(strictLookup.name || "").trim();
    if (!name) return null;
    if (/LookupId$/i.test(name)) return name;
    if (/(^|_)Id$/i.test(name)) return name;
    return `${name}LookupId`;
  }

  const loose = resolveColumn(columns, candidates, { writableOnly: true });
  if (loose) {
    const name = String(loose.name || "").trim();
    if (!name) return null;
    if (/LookupId$/i.test(name)) return name;
    if (/(^|_)Id$/i.test(name)) return name;
    return `${name}LookupId`;
  }

  const normalizedCandidates = (candidates || []).map((x) => norm(x));
  for (const col of columns || []) {
    const name = String(col?.name || "").trim();
    if (!name || !isWritableColumn(col)) continue;
    const normalizedName = norm(name);
    if (normalizedCandidates.some((candidate) => normalizedName === `${candidate}id` || normalizedName === `${candidate}lookupid`)) {
      return name;
    }
  }

  return null;
}

function resolveWriteName(columns, candidates = []) {
  const col = resolveColumn(columns, candidates, { writableOnly: true });
  return col?.name || null;
}

function setIfExists(fields, key, value) {
  if (!key || value === undefined) return;
  fields[key] = value;
}

const APP_META_MARKER = "\n\n---APP_RECETAS_META---\n";

function cleanMetaObject(meta = {}) {
  const out = {};
  for (const [key, value] of Object.entries(meta || {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    out[key] = value;
  }
  return out;
}

function encodeAppMeta(meta = {}) {
  const clean = cleanMetaObject(meta);
  if (!Object.keys(clean).length) return "";
  try {
    return `${APP_META_MARKER}${JSON.stringify(clean)}`;
  } catch {
    return "";
  }
}

function parseAppMeta(text = "") {
  const value = String(text ?? "");
  const idx = value.indexOf(APP_META_MARKER);
  if (idx < 0) return {};
  const raw = value.slice(idx + APP_META_MARKER.length).trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function stripAppMeta(text = "") {
  const value = String(text ?? "");
  const idx = value.indexOf(APP_META_MARKER);
  return (idx >= 0 ? value.slice(0, idx) : value).trim();
}

function withAppMeta(text = "", meta = {}) {
  const base = stripAppMeta(text);
  const current = parseAppMeta(text);
  const encoded = encodeAppMeta({ ...current, ...cleanMetaObject(meta) });
  return `${base}${encoded}`;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function firstNumber(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function getEntityDisplayName(fields = {}, candidates = [], fallbackCandidates = ["Title"]) {
  return String(firstDefined(getFieldValue(fields, candidates), getFieldValue(fields, fallbackCandidates)) || "").trim();
}

async function ensureTitlesForItems(listName, items, candidates = []) {
  if (TITLE_SYNC_DONE.has(listName)) return;
  TITLE_SYNC_DONE.add(listName);

  try {
    const columns = await getListColumns(listName, false);
    const titleKey = resolveWriteName(columns, ["Title"]);
    if (!titleKey) return;

    const updates = [];
    for (const item of items || []) {
      const f = item?.fields || {};
      const currentTitle = String(getFieldValue(f, ["Title"]) || "").trim();
      const nextTitle = getEntityDisplayName(f, candidates);
      if (!currentTitle && nextTitle) {
        updates.push(updateItem(listName, item.id, { Title: nextTitle }));
      }
    }

    if (updates.length) {
      await Promise.allSettled(updates);
    }
  } catch (error) {
    console.warn(`No se pudieron sincronizar títulos de ${listName}:`, error?.message || error);
  }
}

function mapClienteFromFields(item) {
  const f = item.fields || {};
  return {
    id: Number(item.id),
    nombre: getEntityDisplayName(f, ["Nombre", "Razón Social", "Razon Social", "Cliente"]),
    apellido: String(getFieldValue(f, ["Apellido"]) || "").trim(),
    telefono: String(getFieldValue(f, ["Telefono", "Teléfono"]) || "").trim(),
  };
}

function mapIngenieroFromFields(item) {
  const f = item.fields || {};
  const nombre = getEntityDisplayName(f, ["Nombre", "Ingeniero"]);
  const apellido = String(getFieldValue(f, ["Apellido"]) || "").trim();
  return {
    id: Number(item.id),
    nombre,
    apellido,
    telefono: String(getFieldValue(f, ["Telefono", "Teléfono"]) || "").trim(),
    nombreCompleto: `${nombre} ${apellido}`.trim(),
    activo: isEmpty(getFieldValue(f, ["Activo"]))
      ? true
      : parseBoolean(getFieldValue(f, ["Activo"])),
  };
}

function mapSucursalFromFields(item) {
  const f = item.fields || {};
  return {
    id: Number(item.id),
    nombre: getEntityDisplayName(f, ["NombreSucursal", "Nombre Sucursal", "Nombre", "Sucursal"]),
    correo: String(
      getFieldValue(f, [
        "CorreoElectronico",
        "Correo Electrónico",
        "CorreoElectronicoSucursal",
        "Correo de Sucursal",
        "CorreoSucursal",
        "Correo",
        "Correo_x0020_Electronico",
        "Correo_x003a_Electronico",
        "Email",
        "EMail",
        "Mail",
        "mail",
      ])
    ).trim(),
    activa: isEmpty(getFieldValue(f, ["Activa", "Activo"]))
      ? true
      : parseBoolean(getFieldValue(f, ["Activa", "Activo"])),
  };
}

function mapProductoFromFields(item) {
  const f = item.fields || {};

  const nombre = String(
    firstDefined(
      getFieldValue(f, [
        "Nombre Producto",
        "NombreProducto",
        "ProductoNombre",
        "Nombre_x0020_Producto",
        "Title",
      ]),
      ""
    ) || ""
  ).trim();

  const codigo = String(
    getFieldValue(f, [
      "Código Producto",
      "Codigo Producto",
      "CodigoProducto",
      "C_x00f3_digoProducto",
      "CódigoProducto",
      "Codigo",
      "Código",
    ]) || ""
  ).trim();

  const unidad = String(
    getFieldValue(f, [
      "Unidad de Medida",
      "UnidadDeMedida",
      "UnidadMedida",
      "Unidad_x0020_de_x0020_Medida",
      "Unidad",
    ]) || "Kg"
  ).trim();

  return {
    id: Number(item.id),
    nombre,
    codigo,
    unidad,
    stock: safeNumber(getFieldValue(f, ["Stock", "Inventario", "Existencia"]), 0),
    disponible: safeNumber(getFieldValue(f, ["Disponible"]), 0),
    reservada: safeNumber(getFieldValue(f, ["Reservada", "Reserva"]), 0),
    precioVenta: safeNumber(getFieldValue(f, ["PrecioVenta", "Precio Venta", "Precio", "PrecioPublico", "Precio Público"]), 0),
    origen: "sharepoint",
    esProductoSql: false,
  };
}

function mapFincaFromFields(item, clientesMap = new Map(), clientesByName = new Map()) {
  const f = item.fields || {};
  let clienteId = getLookupIdValue(f, ["Cliente", "Clientes", "IdCliente"]);
  const clienteLookup = getLookupTextValue(f, ["Cliente", "Clientes", "IdCliente"]);

  let cliente = clientesMap.get(clienteId);
  if (!cliente && clienteLookup) {
    for (const key of buildNameVariants(clienteLookup)) {
      if (clientesByName.has(key)) {
        cliente = clientesByName.get(key);
        clienteId = Number(cliente?.id || 0);
        break;
      }
    }
  }

  return {
    id: Number(item.id),
    nombre: getEntityDisplayName(f, ["NombredeFinca", "Nombre de Finca", "NombreFinca", "Finca", "Nombre"]),
    ubicacion: String(getFieldValue(f, ["Ubicacion", "Ubicación"]) || "").trim(),
    clienteId,
    cliente: cliente
      ? `${cliente.nombre} ${cliente.apellido || ""}`.trim()
      : String(clienteLookup || getFieldValue(f, ["Cliente", "Clientes", "IdCliente"]) || "").trim(),
    activo: isEmpty(getFieldValue(f, ["Activo"]))
      ? true
      : parseBoolean(getFieldValue(f, ["Activo"])),
  };
}

function mapUsuarioFromFields(item) {
  const f = item.fields || {};

  return {
    id: Number(item.id),
    nombre: String(getFieldValue(f, ["Title", "Nombre"]) || "").trim(),
    email: String(getFieldValue(f, ["Correo", "Email", "EMail"]) || "").trim(),
    correo: String(getFieldValue(f, ["Correo", "Email", "EMail"]) || "").trim(),
    usuario: String(getFieldValue(f, ["Usuario"]) || "").trim(),
    rol: String(getFieldValue(f, ["Rol"]) || "Ingeniero").trim(),
    activo: isEmpty(getFieldValue(f, ["Activo"]))
      ? true
      : parseBoolean(getFieldValue(f, ["Activo"])),
    passwordHash: String(
      getFieldValue(f, ["ContrasenaHash", "ContraseñaHash", "PasswordHash"])
    ).trim(),

    ingenieroId: safeNumber(
      firstDefined(
        f.IngenieroLookupId,
        f.IngenieroId,
        getLookupIdValue(f, ["Ingeniero"])
      ),
      0
    ) || null,

    ingenieroNombre: String(
      firstDefined(
        f.IngenieroLookupValue,
        f.Ingeniero,
        getFieldValue(f, ["IngenieroLookupValue"])
      ) || ""
    ).trim(),

    sucursalId: safeNumber(
      firstDefined(
        f.SucursalLookupId,
        f.SucursalId,
        getLookupIdValue(f, ["Sucursal"])
      ),
      0
    ) || null,

    sucursalNombre: String(
      firstDefined(
        f.SucursalLookupValue,
        f.Sucursal,
        getFieldValue(f, ["SucursalLookupValue"])
      ) || ""
    ).trim(),
  };
}

function buildClienteFields(payload, columns) {
  const nombre = String(payload.nombre || "").trim();
  const fields = { Title: nombre };
  setIfExists(fields, resolveWriteName(columns, ["Nombre"]), nombre);
  setIfExists(fields, resolveWriteName(columns, ["Apellido"]), String(payload.apellido || ""));
  setIfExists(fields, resolveWriteName(columns, ["Telefono", "Teléfono"]), String(payload.telefono || ""));
  return fields;
}

function buildIngenieroFields(payload, columns) {
  const nombre = String(payload.nombre || "").trim();
  const fields = { Title: nombre };
  setIfExists(fields, resolveWriteName(columns, ["Nombre"]), nombre);
  setIfExists(fields, resolveWriteName(columns, ["Apellido"]), String(payload.apellido || ""));
  setIfExists(fields, resolveWriteName(columns, ["Telefono", "Teléfono"]), String(payload.telefono || ""));
  setIfExists(fields, resolveWriteName(columns, ["Activo"]), parseBoolean(firstDefined(payload.activo, true)));
  return fields;
}

function buildSucursalFields(payload, columns) {
  const nombre = String(payload.nombre || "").trim();
  const fields = {
    Title: nombre,
  };
  setIfExists(fields, resolveWriteName(columns, ["NombreSucursal", "Nombre Sucursal", "Nombre"]), nombre);
  setIfExists(fields, resolveWriteName(columns, ["CorreoElectronico", "Correo Electrónico", "Correo Electronico", "CorreoElectronicoSucursal", "Correo de Sucursal", "CorreoSucursal", "Correo", "Correo_x0020_Electronico", "Correo_x003a_Electronico", "Email", "EMail", "Mail", "mail"]), String(payload.correo || ""));
  setIfExists(fields, resolveWriteName(columns, ["Activa", "Activo"]), parseBoolean(firstDefined(payload.activa, true)));
  return fields;
}

function buildProductoFields(payload, columns) {
  const nombre = String(payload.nombre || "").trim();
  const fields = { Title: nombre };
  setIfExists(fields, resolveWriteName(columns, ["NombreProducto", "Nombre Producto", "Nombre"]), nombre);
  setIfExists(fields, resolveWriteName(columns, ["CodigoProducto", "CódigoProducto", "Codigo", "Código", "Código Producto"]), String(payload.codigo || ""));
  setIfExists(fields, resolveWriteName(columns, ["Unidad", "UnidadMedida", "Unidad de Medida", "Unidad de Medida"]), String(payload.unidad || "Kg"));
  return fields;
}

function buildFincaFields(payload, columns) {
  const nombre = String(payload.nombre || "").trim();
  const fields = { Title: nombre };
  setIfExists(fields, resolveWriteName(columns, ["NombredeFinca", "Nombre de Finca", "Nombre"]), nombre);
  setIfExists(fields, resolveWriteName(columns, ["Ubicacion", "Ubicación"]), String(payload.ubicacion || ""));
  setIfExists(fields, resolveWriteName(columns, ["Activo"]), parseBoolean(firstDefined(payload.activo, true)));
  const clienteKey = resolveLookupWriteKey(columns, ["Cliente", "Clientes", "IdCliente"]);
  if (clienteKey) fields[clienteKey] = Number(payload.clienteId);
  return fields;
}

function buildUsuarioFields(data = {}, columns = []) {
  const payload = {};

  setIfExists(
    payload,
    resolveWriteName(columns, ["Title", "Nombre"]),
    String(data.nombre || "")
  );

  setIfExists(
    payload,
    resolveWriteName(columns, ["Correo", "Email", "EMail"]),
    String(data.correo || "")
  );

  setIfExists(
    payload,
    resolveWriteName(columns, ["Usuario"]),
    String(data.usuario || "")
  );

  setIfExists(
    payload,
    resolveWriteName(columns, ["Rol"]),
    String(data.rol || "")
  );

  setIfExists(
    payload,
    resolveWriteName(columns, ["Activo"]),
    !!data.activo
  );

  if (!isEmpty(data.password)) {
    const hash = bcrypt.hashSync(String(data.password), 10);
    setIfExists(
      payload,
      resolveWriteName(columns, ["ContrasenaHash", "ContraseñaHash", "PasswordHash"]),
      hash
    );
  }

  // 🔥 usar resolveLookupWriteKey, no resolveWriteName
  const ingenieroLookupKey = resolveLookupWriteKey(columns, ["Ingeniero"]);
  if (ingenieroLookupKey) {
    payload[ingenieroLookupKey] = data.ingenieroId
      ? Number(data.ingenieroId)
      : null;
  }

  const sucursalLookupKey = resolveLookupWriteKey(columns, ["Sucursal"]);
  if (sucursalLookupKey) {
    payload[sucursalLookupKey] = data.sucursalId
      ? Number(data.sucursalId)
      : null;
  }

  console.log("BUILD USUARIO FIELDS DEBUG:", {
    ingenieroLookupKey,
    sucursalLookupKey,
    ingenieroId: data.ingenieroId,
    sucursalId: data.sucursalId,
    payload,
    columns: (columns || []).map((c) => ({
      name: c.name,
      displayName: c.displayName,
      hidden: c.hidden,
      readOnly: c.readOnly,
      isLookup: !!c.lookup,
    })),
  });

  return payload;
}
function buildRecetaIngenieroFields(payload, columns) {
  const totalProductos = Array.isArray(payload.productos) ? payload.productos.length : 0;
  const totalSolicitado = Array.isArray(payload.productos)
    ? payload.productos.reduce((acc, item) => acc + safeNumber(item.cantidad), 0)
    : 0;

  console.log(
    "COLUMNAS RECETA INGENIERO:",
    (columns || []).map((c) => ({
      name: c.name,
      displayName: c.displayName,
      hidden: c.hidden,
      readOnly: c.readOnly,
      isLookup: !!c.lookup,
    }))
  );

  const fields = {
    Title: "Receta",
  };

  const clienteKey = resolveLookupWriteKey(columns, ["Cliente", "Clientes", "IdCliente"]);
  const fincaKey = resolveLookupWriteKey(columns, ["Finca", "FincaId"]);
  const sucursalKey = resolveLookupWriteKey(columns, ["Sucursal", "SucursalId"]);
  const ingenieroKey = resolveLookupWriteKey(columns, ["Ingeniero", "IngenieroId"]);

  console.log("LOOKUP KEYS RECETA INGENIERO:", {
    clienteKey,
    fincaKey,
    sucursalKey,
    ingenieroKey,
  });

  if (!clienteKey && !USE_SQL_CATALOGS) throw new Error("No encontré el campo lookup Cliente en SP_Receta Ingeniero");
  if (!fincaKey) throw new Error("No encontré el campo lookup Finca en SP_Receta Ingeniero");
  if (!sucursalKey) throw new Error("No encontré el campo lookup Sucursal en SP_Receta Ingeniero");
  if (!ingenieroKey) throw new Error("No encontré el campo lookup Ingeniero en SP_Receta Ingeniero");

  if (clienteKey && !USE_SQL_CATALOGS) {
    fields[clienteKey] = Number(payload.clienteId);
  } else {
    setIfExists(fields, resolveWriteName(columns, ["ClienteSqlId", "Cliente SQL Id", "IdClienteSql", "Id Cliente SQL"]), Number(payload.clienteId || 0));
    setIfExists(fields, resolveWriteName(columns, ["ClienteNombre", "Cliente Nombre", "Cliente"]), String(payload.clienteNombre || payload.nombreCliente || ""));
  }
  fields[fincaKey] = Number(payload.fincaId);
  fields[sucursalKey] = Number(payload.sucursalId);
  fields[ingenieroKey] = Number(payload.ingenieroId);

  setIfExists(fields, resolveWriteName(columns, ["NumeroReceta", "Numero Receta"]), "");
  setIfExists(fields, resolveWriteName(columns, ["Estado"]), "Pendiente");
  setIfExists(fields, resolveWriteName(columns, ["FechaCreacion", "Fecha Creación"]), nowIso());
  setIfExists(fields, resolveWriteName(columns, ["FechaEnvio", "Fecha Envío"]), null);
  setIfExists(fields, resolveWriteName(columns, ["FechaConfirmacion", "Fecha Confirmación"]), null);
  setIfExists(fields, resolveWriteName(columns, ["Factura"]), "");
  setIfExists(fields, resolveWriteName(columns, ["TotalProductos"]), totalProductos);
  setIfExists(fields, resolveWriteName(columns, ["TotalSolicitado"]), totalSolicitado);
  setIfExists(fields, resolveWriteName(columns, ["TotalEntregado"]), 0);
  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), 0);
  setIfExists(fields, resolveWriteName(columns, ["ProductosCompletos"]), 0);
  const recetaMeta = {
    paraCuantoEs: String(payload.paraCuantoEs || ""),
    lotesCultivos: String(payload.lotesCultivos || ""),
    precioTotalVenta: safeNumber(payload.precioTotalVenta, 0),
    observacionGeneral: String(payload.observacion || ""),
  };

  setIfExists(fields, resolveWriteName(columns, ["ParaCuantoEs", "Para Cuanto Es", "ParaCuanto", "Para cuánto es", "Para Cuánto Es"]), recetaMeta.paraCuantoEs);
  setIfExists(fields, resolveWriteName(columns, ["LotesCultivos", "Lotes Cultivos", "Lotes", "Cultivos", "LoteCultivo", "Lote/Cultivo"]), recetaMeta.lotesCultivos);
  setIfExists(fields, resolveWriteName(columns, ["PrecioTotalVenta", "Precio Total Venta", "TotalVenta", "Total Venta"]), recetaMeta.precioTotalVenta);
  // Fallback: si SharePoint no tiene columnas nuevas, dejamos la metadata dentro de Observación.
  setIfExists(fields, resolveWriteName(columns, ["Observacion", "Observación"]), withAppMeta(String(payload.observacion || ""), recetaMeta));

  console.log("FIELDS RECETA INGENIERO A ENVIAR:", fields);
  return fields;
}

function buildRecetaProductoFields(payload, columns) {
  console.log(
    "COLUMNAS RECETA PRODUCTO:",
    (columns || []).map((c) => ({
      name: c.name,
      displayName: c.displayName,
      hidden: c.hidden,
      readOnly: c.readOnly,
      isLookup: !!c.lookup,
    }))
  );

  const esOtroProducto = !!payload.esOtroProducto;
  const nombreBase = String(
    payload.otroProductoNombre || payload.productoNombre || payload.codigo || "Detalle"
  ).trim() || "Detalle";

  const fields = { Title: nombreBase };

  const recetaKey = resolveLookupWriteKey(columns, ["RecetaIngeniero", "Receta Ingeniero", "Receta"]);
  const productoKey = resolveLookupWriteKey(columns, ["Producto", "ProductoId"]);

  console.log("LOOKUP KEYS RECETA PRODUCTO:", {
    recetaKey,
    productoKey,
  });

  if (!recetaKey) {
    throw new Error("No encontré el campo lookup Receta Ingeniero en SP_Receta Producto");
  }

  fields[recetaKey] = Number(payload.recetaIngenieroId);

  const esProductoSql = !!payload.esProductoSql || USE_SQL_CATALOGS;

  if (!esOtroProducto && !esProductoSql) {
    if (!productoKey) {
      throw new Error("No encontré el campo lookup Producto en SP_Receta Producto");
    }
    fields[productoKey] = Number(payload.productoId);
  }

  const productoNombreFinal = payload.productoCambioNombre || payload.productoNombre || "";
  const codigoFinal = payload.codigoCambio || payload.productoCambioCodigo || payload.codigo || payload.codigoProducto || (esOtroProducto ? "OTRO" : "");
  const unidadFinal = payload.unidadCambio || payload.productoCambioUnidad || payload.unidad || "";

  setIfExists(fields, resolveWriteName(columns, ["ProductoNombre", "Producto Nombre"]), productoNombreFinal);
  setIfExists(fields, resolveWriteName(columns, ["CodigoProducto", "Codigo Producto", "CódigoProducto"]), codigoFinal);
  const productoMeta = {
    inventarioMomento: safeNumber(payload.inventarioMomento ?? payload.disponibleMomento ?? payload.disponible ?? payload.stockMomento ?? payload.stock, 0),
    disponibleMomento: safeNumber(payload.disponibleMomento ?? payload.disponible ?? payload.inventarioMomento, 0),
    stockMomento: safeNumber(payload.stockMomento ?? payload.stock, 0),
    reservadaMomento: safeNumber(payload.reservadaMomento ?? payload.reservada, 0),
    precioVenta: safeNumber(payload.precioVenta, 0),
    totalVenta: safeNumber(payload.totalVenta, 0),
    productoSqlId: safeNumber(payload.productoSqlId ?? payload.productoId, 0),
    fueCambiado: !!payload.fueCambiado || !!payload.productoCambioNombre,
    productoOriginalNombre: String(payload.productoOriginalNombre || ""),
    codigoProductoOriginal: String(payload.codigoProductoOriginal || ""),
    productoCambioNombre: String(payload.productoCambioNombre || ""),
    productoCambioCodigo: String(payload.productoCambioCodigo || payload.codigoCambio || ""),
    productoCambioUnidad: String(payload.productoCambioUnidad || payload.unidadCambio || ""),
    motivoCambio: String(payload.motivoCambio || ""),
  };

  setIfExists(fields, resolveWriteName(columns, ["Unidad"]), unidadFinal);
  setIfExists(fields, resolveWriteName(columns, ["ProductoSqlId", "Producto SQL Id", "IdProductoSql", "Id Producto SQL"]), productoMeta.productoSqlId);
  setIfExists(fields, resolveWriteName(columns, ["CantidadRecetada", "Cantidad Recetada"]), safeNumber(payload.cantidadRecetada ?? payload.cantidad, 0));
  setIfExists(fields, resolveWriteName(columns, ["CantidadEntregada", "Cantidad Entregada"]), safeNumber(payload.cantidadEntregada, 0));
  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), safeNumber(payload.porcentajeCumplimiento, 0));
  // Fallback: si SharePoint no tiene columnas nuevas de inventario/precio/cambio,
  // la guardamos dentro de Dosis sin mostrarla luego en pantalla.
  setIfExists(fields, resolveWriteName(columns, ["Dosis"]), withAppMeta(String(payload.dosis || ""), productoMeta));
  setIfExists(fields, resolveWriteName(columns, ["InventarioMomento", "Inventario Momento", "DisponibleMomento", "Disponible Momento", "Inventario"]), productoMeta.inventarioMomento);
  setIfExists(fields, resolveWriteName(columns, ["StockMomento", "Stock Momento", "Stock"]), productoMeta.stockMomento);
  setIfExists(fields, resolveWriteName(columns, ["ReservadaMomento", "Reservada Momento", "Reservada"]), productoMeta.reservadaMomento);
  setIfExists(fields, resolveWriteName(columns, ["EsOtroProducto", "Es Otro Producto"]), esOtroProducto);
  setIfExists(fields, resolveWriteName(columns, ["OtroProductoNombre", "Otro Producto Nombre"]), String(payload.otroProductoNombre || ""));
  setIfExists(fields, resolveWriteName(columns, ["PrecioVenta", "Precio Venta"]), productoMeta.precioVenta);
  setIfExists(fields, resolveWriteName(columns, ["TotalVenta", "Total Venta"]), productoMeta.totalVenta);

  const fueCambiado = !!payload.fueCambiado || !!payload.productoCambioNombre;
  const cambioTexto = fueCambiado
    ? `${String(payload.productoOriginalNombre || payload.productoNombre || "Producto original").trim()} -> ${String(payload.productoCambioNombre || productoNombreFinal || "Producto nuevo").trim()}`
    : "";

  setIfExists(fields, resolveWriteName(columns, ["FueCambiado", "Fue Cambiado", "ProductoCambiado"]), fueCambiado);
  setIfExists(fields, resolveWriteName(columns, ["ProductoOriginalNombre", "Producto Original Nombre", "ProductoOriginal"]), String(payload.productoOriginalNombre || ""));
  setIfExists(fields, resolveWriteName(columns, ["CodigoProductoOriginal", "Codigo Producto Original", "Código Producto Original"]), String(payload.codigoProductoOriginal || ""));
  setIfExists(fields, resolveWriteName(columns, ["ProductoCambioNombre", "Producto Cambio Nombre", "ProductoNuevo", "Producto Nuevo"]), String(payload.productoCambioNombre || ""));
  setIfExists(fields, resolveWriteName(columns, ["CodigoProductoCambio", "Codigo Producto Cambio", "Código Producto Cambio"]), String(payload.productoCambioCodigo || payload.codigoCambio || ""));
  setIfExists(fields, resolveWriteName(columns, ["CambioProducto", "Cambio Producto", "Cambio"]), cambioTexto);
  setIfExists(fields, resolveWriteName(columns, ["MotivoCambio", "Motivo Cambio"]), String(payload.motivoCambio || ""));

  return fields;
}

function buildHistorialFields(payload, columns) {
  const fields = {
    Title: String(payload.numeroReceta || payload.numero || "Historial").trim() || "Historial",
  };

  setIfExists(fields, resolveWriteName(columns, ["NumeroReceta", "Numero Receta"]), String(payload.numeroReceta || payload.numero || ""));

  const recetaLookupKey = resolveLookupWriteKey(columns, ["RecetaIngeniero", "Receta Ingeniero", "RecetaIngenieroId", "Receta Ingeniero Id"]);
  const recetaNumberKey = resolveWriteName(columns, ["RecetaIngenieroId", "Receta Ingeniero Id"]);
  if (recetaLookupKey) {
    fields[recetaLookupKey] = Number(payload.recetaIngenieroId || 0);
  } else {
    setIfExists(fields, recetaNumberKey, Number(payload.recetaIngenieroId || 0));
  }

  const clienteLookupKey = resolveLookupWriteKey(columns, ["Cliente"]);
  const fincaLookupKey = resolveLookupWriteKey(columns, ["Finca"]);
  const sucursalLookupKey = resolveLookupWriteKey(columns, ["Sucursal"]);
  const ingenieroLookupKey = resolveLookupWriteKey(columns, ["Ingeniero"]);

  if (clienteLookupKey && payload.clienteId) fields[clienteLookupKey] = Number(payload.clienteId);
  else setIfExists(fields, resolveWriteName(columns, ["Cliente"]), String(payload.clienteNombre || ""));

  if (fincaLookupKey && payload.fincaId) fields[fincaLookupKey] = Number(payload.fincaId);
  else setIfExists(fields, resolveWriteName(columns, ["Finca"]), String(payload.fincaNombre || ""));

  if (sucursalLookupKey && payload.sucursalId) fields[sucursalLookupKey] = Number(payload.sucursalId);
  else setIfExists(fields, resolveWriteName(columns, ["Sucursal"]), String(payload.sucursalNombre || ""));

  if (ingenieroLookupKey && payload.ingenieroId) fields[ingenieroLookupKey] = Number(payload.ingenieroId);
  else setIfExists(fields, resolveWriteName(columns, ["Ingeniero"]), String(payload.ingenieroNombre || ""));

  setIfExists(fields, resolveWriteName(columns, ["Estado", "EstadoFinal"]), String(payload.estadoFinal || payload.estado || "Entregada"));
  setIfExists(fields, resolveWriteName(columns, ["FechaCreacion", "Fecha Creación"]), payload.fechaCreacion || nowIso());
  setIfExists(fields, resolveWriteName(columns, ["FechaEnvio"]), payload.fechaEnvio || nowIso());
  setIfExists(fields, resolveWriteName(columns, ["FechaConfirmacion"]), payload.fechaConfirmacion || nowIso());
  const historialMeta = {
    paraCuantoEs: String(payload.paraCuantoEs || ""),
    lotesCultivos: String(payload.lotesCultivos || ""),
    precioTotalVenta: safeNumber(payload.precioTotalVenta, 0),
    observacionGeneral: String(payload.observacion || ""),
    observacionEntrega: String(payload.observacionEntrega || ""),
  };

  setIfExists(fields, resolveWriteName(columns, ["Factura"]), String(payload.factura || ""));
  setIfExists(fields, resolveWriteName(columns, ["Observacion", "Observación"]), withAppMeta(String(payload.observacion || ""), historialMeta));
  setIfExists(fields, resolveWriteName(columns, ["ObservacionEntrega", "Observación Entrega", "ObservacionSucursal", "Observación Sucursal"]), String(payload.observacionEntrega || ""));
  setIfExists(fields, resolveWriteName(columns, ["ParaCuantoEs", "Para Cuanto Es", "ParaCuanto", "Para cuánto es", "Para Cuánto Es"]), historialMeta.paraCuantoEs);
  setIfExists(fields, resolveWriteName(columns, ["LotesCultivos", "Lotes Cultivos", "Lotes", "Cultivos", "LoteCultivo", "Lote/Cultivo"]), historialMeta.lotesCultivos);
  setIfExists(fields, resolveWriteName(columns, ["PrecioTotalVenta", "Precio Total Venta", "TotalVenta", "Total Venta"]), historialMeta.precioTotalVenta);
  setIfExists(fields, resolveWriteName(columns, ["TotalProductos"]), safeNumber(payload.totalProductos));
  setIfExists(fields, resolveWriteName(columns, ["TotalSolicitado"]), safeNumber(payload.totalSolicitado));
  setIfExists(fields, resolveWriteName(columns, ["TotalEntregado"]), safeNumber(payload.totalEntregado));
  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), safeNumber(payload.porcentajeCumplimiento));
  setIfExists(fields, resolveWriteName(columns, ["ProductosCompletos"]), safeNumber(payload.productosCompletos));
  setIfExists(fields, resolveWriteName(columns, ["EstadoFinal"]), String(payload.estadoFinal || payload.estado || "Entregada"));
  return fields;
}

function buildHistorialProductoFields(payload, columns) {
  const fields = {
    Title: String(payload.otroProductoNombre || payload.productoNombre || "HistorialDetalle").trim() || "HistorialDetalle",
  };

  const historialKey = resolveLookupWriteKey(columns, ["HistorialReceta", "Historial", "HistorialRecetaId"]);
  if (historialKey) {
    fields[historialKey] = Number(payload.historialRecetaId);
  } else {
    setIfExists(fields, resolveWriteName(columns, ["HistorialRecetaId", "Historial Receta Id"]), Number(payload.historialRecetaId));
  }

  setIfExists(fields, resolveWriteName(columns, ["NumeroReceta", "Numero Receta"]), String(payload.numeroReceta || ""));
  setIfExists(fields, resolveWriteName(columns, ["ProductoNombre", "Producto Nombre"]), String(payload.productoNombre || payload.otroProductoNombre || ""));
  setIfExists(fields, resolveWriteName(columns, ["CodigoProducto", "CódigoProducto", "Codigo"]), String(payload.codigoProducto || ""));
  setIfExists(fields, resolveWriteName(columns, ["Unidad"]), String(payload.unidad || ""));
  setIfExists(fields, resolveWriteName(columns, ["CantidadRecetada", "Cantidad Recetada"]), safeNumber(payload.cantidadRecetada));
  setIfExists(fields, resolveWriteName(columns, ["CantidadEntregada"]), safeNumber(payload.cantidadEntregada));
  const historialProductoMeta = {
    inventarioMomento: safeNumber(payload.inventarioMomento ?? payload.disponibleMomento, 0),
    disponibleMomento: safeNumber(payload.disponibleMomento ?? payload.inventarioMomento, 0),
    stockMomento: safeNumber(payload.stockMomento, 0),
    reservadaMomento: safeNumber(payload.reservadaMomento, 0),
    precioVenta: safeNumber(payload.precioVenta, 0),
    totalVenta: safeNumber(payload.totalVenta, 0),
    fueCambiado: !!payload.fueCambiado,
    productoOriginalNombre: String(payload.productoOriginalNombre || ""),
    codigoProductoOriginal: String(payload.codigoProductoOriginal || ""),
    productoCambioNombre: String(payload.productoCambioNombre || ""),
    productoCambioCodigo: String(payload.productoCambioCodigo || ""),
    productoCambioUnidad: String(payload.productoCambioUnidad || ""),
    cambioProducto: String(payload.cambioProducto || ""),
    motivoCambio: String(payload.motivoCambio || ""),
  };

  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), safeNumber(payload.porcentajeCumplimiento));
  setIfExists(fields, resolveWriteName(columns, ["Dosis"]), withAppMeta(String(payload.dosis || ""), historialProductoMeta));
  setIfExists(fields, resolveWriteName(columns, ["InventarioMomento", "Inventario Momento", "DisponibleMomento", "Disponible Momento", "Inventario"]), historialProductoMeta.inventarioMomento);
  setIfExists(fields, resolveWriteName(columns, ["EsOtroProducto", "Es Otro Producto"]), !!payload.esOtroProducto);
  setIfExists(fields, resolveWriteName(columns, ["OtroProductoNombre", "Otro Producto Nombre"]), String(payload.otroProductoNombre || ""));
  setIfExists(fields, resolveWriteName(columns, ["PrecioVenta", "Precio Venta"]), historialProductoMeta.precioVenta);
  setIfExists(fields, resolveWriteName(columns, ["TotalVenta", "Total Venta"]), historialProductoMeta.totalVenta);
  setIfExists(fields, resolveWriteName(columns, ["FueCambiado", "Fue Cambiado", "ProductoCambiado"]), historialProductoMeta.fueCambiado);
  setIfExists(fields, resolveWriteName(columns, ["ProductoOriginalNombre", "Producto Original Nombre", "ProductoOriginal"]), historialProductoMeta.productoOriginalNombre);
  setIfExists(fields, resolveWriteName(columns, ["CodigoProductoOriginal", "Codigo Producto Original", "Código Producto Original"]), historialProductoMeta.codigoProductoOriginal);
  setIfExists(fields, resolveWriteName(columns, ["ProductoCambioNombre", "Producto Cambio Nombre", "ProductoNuevo", "Producto Nuevo"]), historialProductoMeta.productoCambioNombre);
  setIfExists(fields, resolveWriteName(columns, ["CodigoProductoCambio", "Codigo Producto Cambio", "Código Producto Cambio"]), historialProductoMeta.productoCambioCodigo);
  setIfExists(fields, resolveWriteName(columns, ["CambioProducto", "Cambio Producto", "Cambio"]), historialProductoMeta.cambioProducto);
  setIfExists(fields, resolveWriteName(columns, ["MotivoCambio", "Motivo Cambio"]), historialProductoMeta.motivoCambio);
  return fields;
}

async function getClientesData({ forceRefresh = false } = {}) {
  const cacheKey = USE_SQL_CATALOGS ? "clientes:sql" : "clientes:all";
  if (!forceRefresh) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  const started = Date.now();

  if (USE_SQL_CATALOGS) {
    const rows = await querySqlCatalog(SQL_CLIENTES_QUERY);
    const clientes = rows
      .map(mapSqlCliente)
      .filter((x) => String(x.nombre || "").trim() !== "")
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));

    console.log(`CLIENTES SQL cargados: ${clientes.length} en ${Date.now() - started}ms`);
    return setCache(cacheKey, clientes, Number(process.env.SQL_CATALOG_CACHE_TTL_MS || CACHE_TTL_MS));
  }

  const items = await listItems(LIST_NAMES.clientes);

  // OJO: antes este GET también intentaba actualizar Title en SharePoint.
  // Eso hace miles de PATCH silenciosos y vuelve lentísima la carga.
  // Para listar clientes solo leemos y mapeamos.
  const clientes = items
    .map(mapClienteFromFields)
    .filter((x) => String(x.nombre || "").trim() !== "")
    .sort((a, b) =>
      String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", {
        sensitivity: "base",
      })
    );

  console.log(`CLIENTES cargados: ${clientes.length} en ${Date.now() - started}ms`);
  return setCache(cacheKey, clientes);
}

async function getIngenierosData() {
  const items = await listItems(LIST_NAMES.ingenieros);
  await ensureTitlesForItems(LIST_NAMES.ingenieros, items, ["Nombre", "Ingeniero"]);
  return items.map(mapIngenieroFromFields);
}

async function getSucursalesData() {
  const items = await listItems(LIST_NAMES.sucursales);
  await ensureTitlesForItems(LIST_NAMES.sucursales, items, ["NombreSucursal", "Nombre Sucursal", "Nombre", "Sucursal"]);
  return items.map(mapSucursalFromFields);
}

async function getProductosData({ forceRefresh = false } = {}) {
  const cacheKey = USE_SQL_CATALOGS ? "productos:sql" : "productos:sharepoint";
  if (!forceRefresh) {
    const cached = getCache(cacheKey);
    if (cached) return cached;
  }

  if (USE_SQL_CATALOGS) {
    const rows = await querySqlCatalog(SQL_PRODUCTOS_QUERY);
    const productos = rows
      .map(mapSqlProducto)
      .filter((x) => String(x.nombre || x.codigo || "").trim() !== "")
      .sort((a, b) => String(a.nombre || "").localeCompare(String(b.nombre || ""), "es", { sensitivity: "base" }));
    return setCache(cacheKey, productos, Number(process.env.SQL_CATALOG_CACHE_TTL_MS || CACHE_TTL_MS));
  }

  const items = await listItems(LIST_NAMES.productos);
  await ensureTitlesForItems(LIST_NAMES.productos, items, ["ProductoNombre", "NombreProducto", "Nombre Producto", "Nombre_x0020_Producto", "Title"]);
  return setCache(cacheKey, items.map(mapProductoFromFields));
}

async function getFincasData() {
  const clientes = await getClientesData();
  const clientesMap = new Map(clientes.map((x) => [x.id, x]));
  const clientesByName = new Map();
  for (const cliente of clientes) {
    const label = `${cliente.nombre} ${cliente.apellido || ""}`.trim();
    for (const key of buildNameVariants(label)) clientesByName.set(key, cliente);
    for (const key of buildNameVariants(cliente.nombre)) clientesByName.set(key, cliente);
  }
  const items = await listItems(LIST_NAMES.fincas);
  await ensureTitlesForItems(LIST_NAMES.fincas, items, ["NombredeFinca", "Nombre de Finca", "NombreFinca", "Finca", "Nombre"]);
  return items.map((item) => mapFincaFromFields(item, clientesMap, clientesByName));
}

async function buildRecipeContext() {
  const [clientes, fincas, ingenieros, sucursales, productos] = await Promise.all([
    getClientesData(),
    getFincasData(),
    getIngenierosData(),
    getSucursalesData(),
    getProductosData(),
  ]);

  return {
    clientesMap: new Map(clientes.map((x) => [x.id, x])),
    fincasMap: new Map(fincas.map((x) => [x.id, x])),
    ingenierosMap: new Map(ingenieros.map((x) => [x.id, x])),
    sucursalesMap: new Map(sucursales.map((x) => [x.id, x])),
    productosMap: new Map(productos.map((x) => [x.id, x])),
  };
}

async function getRecipeDetailsItems() {
  const items = await listItems(LIST_NAMES.recetaProducto);
  return items;
}

function mapRecetaProductoFromFields(item, productosMap = new Map()) {
  const f = item.fields || {};
  const rawDosis = String(getFieldValue(f, ["Dosis"]) || "");
  const meta = parseAppMeta(rawDosis);
  const productoLookupId = getLookupIdValue(f, ["Producto", "ProductoId"]);
  const productoSqlId = firstNumber(
    getFieldValue(f, ["ProductoSqlId", "Producto SQL Id", "IdProductoSql", "Id Producto SQL"]),
    meta.productoSqlId,
    0
  );
  const producto = productosMap.get(productoLookupId || productoSqlId);
  const fueCambiado = parseBoolean(getFieldValue(f, ["FueCambiado", "Fue Cambiado", "ProductoCambiado"])) || !!meta.fueCambiado;
  const productoCambioNombre = firstText(getFieldValue(f, ["ProductoCambioNombre", "Producto Cambio Nombre", "ProductoNuevo", "Producto Nuevo"]), meta.productoCambioNombre);
  const productoOriginalNombre = firstText(getFieldValue(f, ["ProductoOriginalNombre", "Producto Original Nombre", "ProductoOriginal"]), meta.productoOriginalNombre);
  const cambioProducto = firstText(
    getFieldValue(f, ["CambioProducto", "Cambio Producto", "Cambio"]),
    meta.cambioProducto,
    fueCambiado && productoCambioNombre
      ? `${productoOriginalNombre || String(getFieldValue(f, ["ProductoNombre", "Producto Nombre"]) || "Producto original").trim()} -> ${productoCambioNombre}`
      : ""
  );

  return {
    id: Number(item.id),
    detalleId: Number(item.id),
    recetaIngenieroId: getLookupIdValue(f, ["RecetaIngeniero", "Receta Ingeniero", "Receta", "RecetaId"]),
    productoId: productoLookupId || productoSqlId,
    productoLookupId,
    productoSqlId,
    esOtroProducto: parseBoolean(getFieldValue(f, ["EsOtroProducto", "Es Otro Producto"])),
    otroProductoNombre: String(getFieldValue(f, ["OtroProductoNombre", "Otro Producto Nombre"]) || "").trim(),
    dosis: stripAppMeta(rawDosis),
    precioVenta: firstNumber(getFieldValue(f, ["PrecioVenta", "Precio Venta"]), meta.precioVenta, 0),
    totalVenta: firstNumber(getFieldValue(f, ["TotalVenta", "Total Venta"]), meta.totalVenta, 0),
    inventarioMomento: firstNumber(getFieldValue(f, ["InventarioMomento", "Inventario Momento", "DisponibleMomento", "Disponible Momento", "Inventario"]), meta.inventarioMomento, meta.disponibleMomento, 0),
    disponibleMomento: firstNumber(getFieldValue(f, ["DisponibleMomento", "Disponible Momento", "Disponible", "InventarioMomento", "Inventario Momento"]), meta.disponibleMomento, meta.inventarioMomento, 0),
    stockMomento: firstNumber(getFieldValue(f, ["StockMomento", "Stock Momento", "Stock"]), meta.stockMomento, 0),
    reservadaMomento: firstNumber(getFieldValue(f, ["ReservadaMomento", "Reservada Momento", "Reservada"]), meta.reservadaMomento, 0),
    fueCambiado,
    productoOriginalNombre,
    codigoProductoOriginal: firstText(getFieldValue(f, ["CodigoProductoOriginal", "Codigo Producto Original", "Código Producto Original"]), meta.codigoProductoOriginal),
    productoCambioNombre,
    productoCambioCodigo: firstText(getFieldValue(f, ["CodigoProductoCambio", "Codigo Producto Cambio", "Código Producto Cambio"]), meta.productoCambioCodigo),
    productoCambioUnidad: firstText(meta.productoCambioUnidad),
    cambioProducto,
    motivoCambio: firstText(getFieldValue(f, ["MotivoCambio", "Motivo Cambio"]), meta.motivoCambio),
    productoNombre:
      String(getFieldValue(f, ["ProductoNombre", "Producto Nombre"]) || "").trim() ||
      String(getFieldValue(f, ["OtroProductoNombre", "Otro Producto Nombre"]) || "").trim() ||
      producto?.nombre ||
      getLookupTextValue(f, ["Producto"]),
    productoCodigo:
      String(getFieldValue(f, ["CodigoProducto", "CódigoProducto", "Codigo"]) || "").trim() ||
      (parseBoolean(getFieldValue(f, ["EsOtroProducto", "Es Otro Producto"])) ? "OTRO" : "") ||
      producto?.codigo ||
      "",
    unidad:
      String(getFieldValue(f, ["Unidad"]) || "").trim() || producto?.unidad || "Kg",
    cantidad: safeNumber(getFieldValue(f, ["CantidadRecetada", "Cantidad Recetada"]), 0),
    cantidadEntregada: safeNumber(getFieldValue(f, ["CantidadEntregada"]), 0),
    porcentajeCumplimiento: safeNumber(
      getFieldValue(f, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]),
      0
    ),
  };
}

function mapRecetaIngenieroFromFields(item, context, detalleMap = new Map()) {
  const f = item.fields || {};
  const id = Number(item.id);
  const clienteId = getLookupIdValue(f, ["Cliente", "Clientes", "ClienteId"]) || safeNumber(getFieldValue(f, ["ClienteSqlId", "Cliente SQL Id", "IdClienteSql", "Id Cliente SQL"]), 0);
  const fincaId = getLookupIdValue(f, ["Finca", "FincaId"]);
  const sucursalId = getLookupIdValue(f, ["Sucursal", "SucursalId"]);
  const ingenieroId = getLookupIdValue(f, ["Ingeniero", "IngenieroId"]);

  const cliente = context.clientesMap.get(clienteId);
  const finca = context.fincasMap.get(fincaId);
  const sucursal = context.sucursalesMap.get(sucursalId);
  const ingeniero = context.ingenierosMap.get(ingenieroId);

  if (!clienteId || !fincaId || !sucursalId || !ingenieroId) {
    console.log("DEBUG RECETA LOOKUPS:", {
      recetaId: id,
      clienteId,
      fincaId,
      sucursalId,
      ingenieroId,
      fields: Object.fromEntries(
        Object.entries(f).filter(([k]) => /(cliente|finca|sucursal|ingeniero)/i.test(k))
      ),
    });
  }

  const fechaEnvio = String(getFieldValue(f, ["FechaEnvio", "Fecha Envío"]) || "");
  const fechaConfirmacion = String(getFieldValue(f, ["FechaConfirmacion", "Fecha Confirmación"]) || "");
  const estado = fechaConfirmacion
    ? "Entregada"
    : fechaEnvio
    ? "Pendiente de Confirmar"
    : "Pendiente";

  const rawObservacion = String(getFieldValue(f, ["Observacion", "Observación"]) || "");
  const recetaMeta = parseAppMeta(rawObservacion);
  const observacionEntrega = firstText(getFieldValue(f, ["ObservacionEntrega", "Observación Entrega", "ObservacionSucursal", "Observación Sucursal"]), recetaMeta.observacionEntrega);

  return {
    id,
    numero: String(getFieldValue(f, ["NumeroReceta", "Numero Receta", "LinkTitle", "Title"]) || item.id),
    estado,
    clienteId,
    fincaId,
    ingenieroId,
    sucursalId,
    clienteNombre:
      String(getFieldValue(f, ["ClienteNombre", "Cliente Nombre"]) || "").trim() ||
      (cliente ? `${cliente.nombre} ${cliente.apellido || ""}`.trim() : "") ||
      getLookupTextValue(f, ["Cliente", "Clientes", "ClienteId"]) ||
      String(getFieldValue(f, ["Cliente", "Clientes", "ClienteId"]) || "").trim(),
    fincaNombre:
      finca?.nombre ||
      getLookupTextValue(f, ["Finca", "FincaId"]) ||
      String(getFieldValue(f, ["Finca", "FincaId"]) || "").trim(),
    ingenieroNombre:
      (ingeniero ? ingeniero.nombreCompleto || `${ingeniero.nombre} ${ingeniero.apellido || ""}`.trim() : "") ||
      getLookupTextValue(f, ["Ingeniero", "IngenieroId"]) ||
      String(getFieldValue(f, ["Ingeniero", "IngenieroId"]) || "").trim(),
    sucursalNombre:
      sucursal?.nombre ||
      getLookupTextValue(f, ["Sucursal", "SucursalId"]) ||
      String(getFieldValue(f, ["Sucursal", "SucursalId"]) || "").trim(),
    createdAt: String(getFieldValue(f, ["FechaCreacion", "Fecha Creación", "Created"]) || ""),
    fechaEnvio,
    fechaConfirmacion,
    factura: String(getFieldValue(f, ["Factura"]) || ""),
    observacion: firstText(stripAppMeta(rawObservacion), recetaMeta.observacionGeneral),
    observacionEntrega,
    paraCuantoEs: firstText(getFieldValue(f, ["ParaCuantoEs", "Para Cuanto Es", "ParaCuanto", "Para cuánto es", "Para Cuánto Es"]), recetaMeta.paraCuantoEs),
    lotesCultivos: firstText(getFieldValue(f, ["LotesCultivos", "Lotes Cultivos", "Lotes", "Cultivos", "LoteCultivo", "Lote/Cultivo"]), recetaMeta.lotesCultivos),
    precioTotalVenta: firstNumber(getFieldValue(f, ["PrecioTotalVenta", "Precio Total Venta", "TotalVenta", "Total Venta"]), recetaMeta.precioTotalVenta, 0),
    totalProductos: safeNumber(getFieldValue(f, ["TotalProductos"]), 0),
    totalSolicitado: safeNumber(getFieldValue(f, ["TotalSolicitado"]), 0),
    totalEntregado: safeNumber(getFieldValue(f, ["TotalEntregado"]), 0),
    porcentajeCumplimiento: safeNumber(
      getFieldValue(f, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]),
      0
    ),
    productosCompletos: safeNumber(getFieldValue(f, ["ProductosCompletos"]), 0),
    productos: detalleMap.get(id) || [],
  };
}

async function getRecetasIngenieroData() {
  const [context, recetaItems, detalleItems] = await Promise.all([
    buildRecipeContext(),
    listItems(LIST_NAMES.recetaIngeniero),
    getRecipeDetailsItems(),
  ]);

  const detalleMap = new Map();
  for (const item of detalleItems) {
    const det = mapRecetaProductoFromFields(item, context.productosMap);
    const arr = detalleMap.get(det.recetaIngenieroId) || [];
    arr.push(det);
    detalleMap.set(det.recetaIngenieroId, arr);
  }

  return recetaItems
    .map((item) => mapRecetaIngenieroFromFields(item, context, detalleMap))
    .sort((a, b) => b.id - a.id);
}

async function getRecetaById(id) {
  const recetas = await getRecetasIngenieroData();
  return recetas.find((x) => x.id === Number(id)) || null;
}

async function ensureNumeroReceta(itemId) {
  const columns = await getListColumns(LIST_NAMES.recetaIngeniero, false);
  const numeroName = resolveWriteName(columns, ["NumeroReceta", "Numero Receta"]);
  const titleName = resolveWriteName(columns, ["Title"]);
  const payload = {};
  if (numeroName) payload[numeroName] = String(itemId);
  if (titleName === "Title") payload.Title = `Receta ${itemId}`;
  if (Object.keys(payload).length) {
    await updateItem(LIST_NAMES.recetaIngeniero, itemId, payload);
  }
}

async function syncHistorialFromReceta(recetaId) {
  const receta = await getRecetaById(recetaId);
  if (!receta) {
    throw new Error("Receta no encontrada para historial");
  }

  const historialColumns = await getListColumns(LIST_NAMES.historial, false);
  const historialProductoColumns = await getListColumns(LIST_NAMES.historialProducto, false);

  const historialExistente = (await listItems(LIST_NAMES.historial)).find((item) => {
    const f = item.fields || {};
    const recetaIdExistente = safeNumber(getFieldValue(f, ["RecetaIngenieroId", "Receta Ingeniero Id"]), 0);
    const numeroExistente = String(getFieldValue(f, ["NumeroReceta", "Numero Receta"]) || "").trim();
    return recetaIdExistente === Number(recetaId) || numeroExistente === String(receta.numero);
  });

  if (historialExistente?.id) {
    const historialDetalleItems = await listItems(LIST_NAMES.historialProducto);
    for (const item of historialDetalleItems) {
      const f = item.fields || {};
      const historialFk = getLookupIdValue(f, ["HistorialRecetaId", "HistorialReceta", "Historial"]);
      if (historialFk === Number(historialExistente.id)) {
        await deleteItem(LIST_NAMES.historialProducto, item.id);
      }
    }
    await deleteItem(LIST_NAMES.historial, historialExistente.id);
  }

  const historialPayload = {
    numeroReceta: receta.numero,
    recetaIngenieroId: receta.id,
    clienteId: receta.clienteId,
    fincaId: receta.fincaId,
    sucursalId: receta.sucursalId,
    ingenieroId: receta.ingenieroId,
    clienteNombre: receta.clienteNombre,
    fincaNombre: receta.fincaNombre,
    sucursalNombre: receta.sucursalNombre,
    ingenieroNombre: receta.ingenieroNombre,
    estadoFinal: receta.estado || "Entregada",
    fechaCreacion: receta.createdAt,
    fechaEnvio: receta.fechaEnvio,
    fechaConfirmacion: receta.fechaConfirmacion,
    factura: receta.factura,
    observacion: receta.observacion,
    observacionEntrega: receta.observacionEntrega,
    paraCuantoEs: receta.paraCuantoEs,
    lotesCultivos: receta.lotesCultivos,
    precioTotalVenta: receta.precioTotalVenta,
    totalProductos: receta.totalProductos || receta.productos.length,
    totalSolicitado: receta.totalSolicitado,
    totalEntregado: receta.totalEntregado,
    porcentajeCumplimiento: receta.porcentajeCumplimiento,
    productosCompletos: receta.productosCompletos,
  };

  const historialFields = buildHistorialFields(historialPayload, historialColumns);
  console.log("PAYLOAD HISTORIAL:", historialFields);

  const historialItem = await createItem(
    LIST_NAMES.historial,
    historialFields
  );

  for (const producto of receta.productos) {
    const historialProductoPayload = buildHistorialProductoFields(
      {
        historialRecetaId: Number(historialItem.id),
        numeroReceta: receta.numero,
        productoNombre: producto.productoNombre,
        codigoProducto: producto.productoCodigo,
        unidad: producto.unidad,
        cantidadRecetada: producto.cantidad,
        cantidadEntregada: producto.cantidadEntregada,
        porcentajeCumplimiento: calcPercent(
          producto.cantidadEntregada,
          producto.cantidad
        ),
        dosis: producto.dosis || "",
        precioVenta: producto.precioVenta || 0,
        totalVenta: producto.totalVenta || 0,
        inventarioMomento: producto.inventarioMomento || producto.disponibleMomento || 0,
        disponibleMomento: producto.disponibleMomento || producto.inventarioMomento || 0,
        stockMomento: producto.stockMomento || 0,
        reservadaMomento: producto.reservadaMomento || 0,
        fueCambiado: !!producto.fueCambiado,
        productoOriginalNombre: producto.productoOriginalNombre || "",
        codigoProductoOriginal: producto.codigoProductoOriginal || "",
        productoCambioNombre: producto.productoCambioNombre || "",
        productoCambioCodigo: producto.productoCambioCodigo || "",
        productoCambioUnidad: producto.productoCambioUnidad || "",
        cambioProducto: producto.cambioProducto || "",
        motivoCambio: producto.motivoCambio || "",
        esOtroProducto: !!producto.esOtroProducto,
        otroProductoNombre: producto.otroProductoNombre || "",
      },
      historialProductoColumns
    );

    console.log("PAYLOAD HISTORIAL PRODUCTO:", historialProductoPayload);

    await createItem(
      LIST_NAMES.historialProducto,
      historialProductoPayload
    );
  }

  return historialItem;
}

async function getHistorialData() {
  const historialItems = await listItems(LIST_NAMES.historial);
  const historialDetalleItems = await listItems(LIST_NAMES.historialProducto);

  const detalleMap = new Map();
  for (const item of historialDetalleItems) {
    const f = item.fields || {};
    const historialId = getLookupIdValue(f, ["HistorialRecetaId", "HistorialReceta", "Historial"]);
    const arr = detalleMap.get(historialId) || [];
    const rawDosis = String(getFieldValue(f, ["Dosis"]) || "");
    const meta = parseAppMeta(rawDosis);
    const fueCambiado = parseBoolean(getFieldValue(f, ["FueCambiado", "Fue Cambiado", "ProductoCambiado"])) || !!meta.fueCambiado;
    arr.push({
      productoNombre: String(getFieldValue(f, ["ProductoNombre", "Producto Nombre"]) || "").trim(),
      codigoProducto: String(getFieldValue(f, ["CodigoProducto", "CódigoProducto", "Codigo"]) || "").trim(),
      unidad: String(getFieldValue(f, ["Unidad"]) || "").trim(),
      cantidadRecetada: safeNumber(getFieldValue(f, ["CantidadRecetada"]), 0),
      cantidadEntregada: safeNumber(getFieldValue(f, ["CantidadEntregada"]), 0),
      porcentaje: safeNumber(
        getFieldValue(f, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]),
        0
      ),
      dosis: stripAppMeta(rawDosis),
      precioVenta: firstNumber(getFieldValue(f, ["PrecioVenta", "Precio Venta"]), meta.precioVenta, 0),
      totalVenta: firstNumber(getFieldValue(f, ["TotalVenta", "Total Venta"]), meta.totalVenta, 0),
      inventarioMomento: firstNumber(getFieldValue(f, ["InventarioMomento", "Inventario Momento", "DisponibleMomento", "Disponible Momento", "Inventario"]), meta.inventarioMomento, meta.disponibleMomento, 0),
      disponibleMomento: firstNumber(getFieldValue(f, ["DisponibleMomento", "Disponible Momento", "Disponible", "InventarioMomento", "Inventario Momento"]), meta.disponibleMomento, meta.inventarioMomento, 0),
      fueCambiado,
      productoOriginalNombre: firstText(getFieldValue(f, ["ProductoOriginalNombre", "Producto Original Nombre", "ProductoOriginal"]), meta.productoOriginalNombre),
      codigoProductoOriginal: firstText(getFieldValue(f, ["CodigoProductoOriginal", "Codigo Producto Original", "Código Producto Original"]), meta.codigoProductoOriginal),
      productoCambioNombre: firstText(getFieldValue(f, ["ProductoCambioNombre", "Producto Cambio Nombre", "ProductoNuevo", "Producto Nuevo"]), meta.productoCambioNombre),
      productoCambioCodigo: firstText(getFieldValue(f, ["CodigoProductoCambio", "Codigo Producto Cambio", "Código Producto Cambio"]), meta.productoCambioCodigo),
      productoCambioUnidad: firstText(meta.productoCambioUnidad),
      cambioProducto: firstText(getFieldValue(f, ["CambioProducto", "Cambio Producto", "Cambio"]), meta.cambioProducto),
      motivoCambio: firstText(getFieldValue(f, ["MotivoCambio", "Motivo Cambio"]), meta.motivoCambio),
      esOtroProducto: parseBoolean(getFieldValue(f, ["EsOtroProducto", "Es Otro Producto"])),
      otroProductoNombre: String(getFieldValue(f, ["OtroProductoNombre", "Otro Producto Nombre"]) || "").trim(),
    });
    detalleMap.set(historialId, arr);
  }

  const mapped = historialItems.map((item) => {
    const f = item.fields || {};
    const id = Number(item.id);
    const productos = detalleMap.get(id) || [];
    const cumplimiento = safeNumber(
      getFieldValue(f, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]),
      0
    );
    const rawObservacion = String(getFieldValue(f, ["Observacion", "Observación"]) || "");
    const meta = parseAppMeta(rawObservacion);

    return {
      id,
      numero: String(getFieldValue(f, ["NumeroReceta", "Numero Receta"]) || id),
      clienteNombre: String(getFieldValue(f, ["Cliente"]) || "").trim(),
      fincaNombre: String(getFieldValue(f, ["Finca"]) || "").trim(),
      ingenieroNombre: String(getFieldValue(f, ["Ingeniero"]) || "").trim(),
      sucursalNombre: String(getFieldValue(f, ["Sucursal"]) || "").trim(),
      factura: String(getFieldValue(f, ["Factura"]) || "").trim(),
      observacion: firstText(stripAppMeta(rawObservacion), meta.observacionGeneral),
      observacionEntrega: firstText(getFieldValue(f, ["ObservacionEntrega", "Observación Entrega", "ObservacionSucursal", "Observación Sucursal"]), meta.observacionEntrega),
      paraCuantoEs: firstText(getFieldValue(f, ["ParaCuantoEs", "Para Cuanto Es", "ParaCuanto", "Para cuánto es", "Para Cuánto Es"]), meta.paraCuantoEs),
      lotesCultivos: firstText(getFieldValue(f, ["LotesCultivos", "Lotes Cultivos", "Lotes", "Cultivos", "LoteCultivo", "Lote/Cultivo"]), meta.lotesCultivos),
      precioTotalVenta: firstNumber(getFieldValue(f, ["PrecioTotalVenta", "Precio Total Venta", "TotalVenta", "Total Venta"]), meta.precioTotalVenta, 0),
      totalSolicitado: safeNumber(getFieldValue(f, ["TotalSolicitado"]), 0),
      totalEntregado: safeNumber(getFieldValue(f, ["TotalEntregado"]), 0),
      productosCompletos: safeNumber(getFieldValue(f, ["ProductosCompletos"]), 0),
      totalProductos: safeNumber(getFieldValue(f, ["TotalProductos"]), productos.length),
      cumplimiento,
      porcentajeCumplimiento: cumplimiento,
      finalizadaAt: String(getFieldValue(f, ["FechaConfirmacion"]) || ""),
      productos,
    };
  });

  if (mapped.length > 0) {
    return mapped.sort((a, b) => b.id - a.id);
  }

  const recetas = await getRecetasIngenieroData();
  return recetas
    .filter((x) => String(x.estado || "").toLowerCase() === "entregada")
    .map((x) => ({
      id: x.id,
      numero: x.numero,
      clienteNombre: x.clienteNombre,
      fincaNombre: x.fincaNombre,
      ingenieroNombre: x.ingenieroNombre,
      sucursalNombre: x.sucursalNombre,
      factura: x.factura || "",
      observacion: x.observacion || "",
      observacionEntrega: x.observacionEntrega || "",
      paraCuantoEs: x.paraCuantoEs || "",
      lotesCultivos: x.lotesCultivos || "",
      precioTotalVenta: x.precioTotalVenta || 0,
      totalSolicitado: x.totalSolicitado || 0,
      totalEntregado: x.totalEntregado || 0,
      productosCompletos: x.productosCompletos || 0,
      totalProductos: x.totalProductos || (x.productos || []).length,
      cumplimiento: x.porcentajeCumplimiento || calcPercent(x.totalEntregado, x.totalSolicitado),
      porcentajeCumplimiento: x.porcentajeCumplimiento || calcPercent(x.totalEntregado, x.totalSolicitado),
      finalizadaAt: x.fechaConfirmacion || "",
      productos: (x.productos || []).map((p) => ({
        productoNombre: p.productoNombre,
        codigoProducto: p.productoCodigo,
        unidad: p.unidad,
        cantidadRecetada: p.cantidad,
        cantidadEntregada: p.cantidadEntregada || 0,
        porcentaje: calcPercent(p.cantidadEntregada || 0, p.cantidad || 0),
        porcentajeCumplimiento: calcPercent(p.cantidadEntregada || 0, p.cantidad || 0),
        dosis: p.dosis || "",
        precioVenta: p.precioVenta || 0,
        totalVenta: p.totalVenta || 0,
        inventarioMomento: p.inventarioMomento || p.disponibleMomento || 0,
        disponibleMomento: p.disponibleMomento || p.inventarioMomento || 0,
        fueCambiado: !!p.fueCambiado,
        productoOriginalNombre: p.productoOriginalNombre || "",
        codigoProductoOriginal: p.codigoProductoOriginal || "",
        productoCambioNombre: p.productoCambioNombre || "",
        productoCambioCodigo: p.productoCambioCodigo || "",
        cambioProducto: p.cambioProducto || "",
        motivoCambio: p.motivoCambio || "",
      })),
    }))
    .sort((a, b) => b.id - a.id);
}

app.get("/api/health", async (_req, res) => {
  res.json({ ok: true, service: "app-recetas-api", sqlCatalogos: USE_SQL_CATALOGS, time: nowIso() });
});

app.get("/api/catalogos/status", async (_req, res) => {
  const status = { sqlCatalogos: USE_SQL_CATALOGS, sql: "no_configurado" };
  if (USE_SQL_CATALOGS) {
    try {
      await getSqlPool();
      status.sql = "conectado";
    } catch (error) {
      status.sql = `error: ${error?.message || error}`;
    }
  }
  res.json(status);
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;

    if (!usuario || !password) {
      return res.status(400).json({ error: "Usuario y contraseña requeridos" });
    }

    const items = await listItems(LIST_NAMES.usuarios);
    const usuarios = items.map(mapUsuarioFromFields);

    const userFound = usuarios.find(
      (u) =>
        String(u.usuario || "").trim().toLowerCase() ===
        String(usuario || "").trim().toLowerCase()
    );

    if (!userFound) {
      return res.status(401).json({ error: "Usuario o contraseña inválidos" });
    }

    if (userFound.passwordHash) {
      const ok = await bcrypt.compare(password, userFound.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: "Usuario o contraseña inválidos" });
      }
    }

    const rol = String(userFound.rol || "").trim();
    const ingenieroId =
      userFound.ingenieroId !== undefined && userFound.ingenieroId !== null
        ? Number(userFound.ingenieroId)
        : null;
    const sucursalId =
      userFound.sucursalId !== undefined && userFound.sucursalId !== null
        ? Number(userFound.sucursalId)
        : null;

    if (rol === "Ingeniero" && !ingenieroId) {
      return res.status(400).json({
        error: "El usuario Ingeniero no tiene un ingeniero asignado en SP_Usuarios",
      });
    }

    if (rol === "Sucursal" && !sucursalId) {
      return res.status(400).json({
        error: "El usuario Sucursal no tiene una sucursal asignada en SP_Usuarios",
      });
    }

    const tokenPayload = {
      id: userFound.id,
      usuario: userFound.usuario,
      nombre: userFound.nombre,
      rol,
      email: userFound.email || userFound.correo || "",
      ingenieroId,
      sucursalId,
    };

    const token = jwt.sign(tokenPayload, JWT_SECRET, { expiresIn: "8h" });

    return res.json({
      token,
      user: {
        id: userFound.id,
        usuario: userFound.usuario,
        nombre: userFound.nombre,
        rol,
        email: userFound.email || userFound.correo || "",
        ingenieroId,
        sucursalId,
      },
    });
  } catch (error) {
    console.error("ERROR LOGIN:", error);
    return res.status(500).json({ error: "Error en login" });
  }
});

app.get("/api/clientes", async (_req, res) => {
  try {
    res.json(await getClientesData());
  } catch (error) {
    console.error("ERROR GET CLIENTES:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener clientes" });
  }
});

app.post("/api/clientes", async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.clientes, false);
    const created = await createItem(
      LIST_NAMES.clientes,
      buildClienteFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.clientes, created.id);
    clearCache("clientes:");
    res.json(mapClienteFromFields(item));
  } catch (error) {
    console.error("ERROR CREATE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo crear cliente" });
  }
});

app.put("/api/clientes/:id", async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.clientes, false);
    await updateItem(LIST_NAMES.clientes, req.params.id, buildClienteFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.clientes, req.params.id);
    clearCache("clientes:");
    res.json(mapClienteFromFields(item));
  } catch (error) {
    console.error("ERROR UPDATE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar cliente" });
  }
});

app.delete("/api/clientes/:id", async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.clientes, req.params.id);
    clearCache("clientes:");
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar cliente" });
  }
});

app.post("/api/clientes/importar", async (_req, res) => {
  clearCache("clientes:");
  res.json({ ok: true, resultado: { message: "Importación no implementada en esta versión" } });
});

app.get("/api/ingenieros", authMiddleware, async (_req, res) => {
  try {
    res.json(await getIngenierosData());
  } catch (error) {
    console.error("ERROR GET INGENIEROS:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener ingenieros" });
  }
});

app.post("/api/ingenieros", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.ingenieros, false);
    const created = await createItem(
      LIST_NAMES.ingenieros,
      buildIngenieroFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.ingenieros, created.id);
    res.json(mapIngenieroFromFields(item));
  } catch (error) {
    console.error("ERROR CREATE INGENIERO:", error);
    res.status(500).json({ error: error.message || "No se pudo crear ingeniero" });
  }
});

app.put("/api/ingenieros/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.ingenieros, false);
    await updateItem(LIST_NAMES.ingenieros, req.params.id, buildIngenieroFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.ingenieros, req.params.id);
    res.json(mapIngenieroFromFields(item));
  } catch (error) {
    console.error("ERROR UPDATE INGENIERO:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar ingeniero" });
  }
});

app.delete("/api/ingenieros/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.ingenieros, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE INGENIERO:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar ingeniero" });
  }
});

app.get("/api/fincas", authMiddleware, async (_req, res) => {
  try {
    res.json(await getFincasData());
  } catch (error) {
    console.error("ERROR GET FINCAS:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener fincas" });
  }
});

app.post("/api/fincas", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.fincas, false);
    const created = await createItem(
      LIST_NAMES.fincas,
      buildFincaFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.fincas, created.id);
    const clientes = await getClientesData();
    const clientesMap = new Map(clientes.map((x) => [x.id, x]));
    res.json(mapFincaFromFields(item, clientesMap));
  } catch (error) {
    console.error("ERROR CREATE FINCA:", error);
    res.status(500).json({ error: error.message || "No se pudo crear finca" });
  }
});

app.put("/api/fincas/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.fincas, false);
    await updateItem(LIST_NAMES.fincas, req.params.id, buildFincaFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.fincas, req.params.id);
    const clientes = await getClientesData();
    const clientesMap = new Map(clientes.map((x) => [x.id, x]));
    res.json(mapFincaFromFields(item, clientesMap));
  } catch (error) {
    console.error("ERROR UPDATE FINCA:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar finca" });
  }
});

app.delete("/api/fincas/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.fincas, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE FINCA:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar finca" });
  }
});

app.get("/api/sucursales", authMiddleware, async (_req, res) => {
  try {
    res.json(await getSucursalesData());
  } catch (error) {
    console.error("ERROR GET SUCURSALES:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener sucursales" });
  }
});

app.post("/api/sucursales", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.sucursales, false);
    const created = await createItem(
      LIST_NAMES.sucursales,
      buildSucursalFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.sucursales, created.id);
    res.json(mapSucursalFromFields(item));
  } catch (error) {
    console.error("ERROR CREATE SUCURSAL:", error);
    res.status(500).json({ error: error.message || "No se pudo crear sucursal" });
  }
});

app.put("/api/sucursales/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.sucursales, false);
    await updateItem(LIST_NAMES.sucursales, req.params.id, buildSucursalFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.sucursales, req.params.id);
    res.json(mapSucursalFromFields(item));
  } catch (error) {
    console.error("ERROR UPDATE SUCURSAL:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar sucursal" });
  }
});

app.delete("/api/sucursales/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.sucursales, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE SUCURSAL:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar sucursal" });
  }
});

app.get("/api/productos", authMiddleware, async (req, res) => {
  try {
    res.json(await getProductosData({ forceRefresh: String(req.query.refresh || "") === "1" }));
  } catch (error) {
    console.error("ERROR GET PRODUCTOS:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener productos" });
  }
});

app.post("/api/productos", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.productos, false);
    const created = await createItem(
      LIST_NAMES.productos,
      buildProductoFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.productos, created.id);
    res.json(mapProductoFromFields(item));
  } catch (error) {
    console.error("ERROR CREATE PRODUCTO:", error);
    res.status(500).json({ error: error.message || "No se pudo crear producto" });
  }
});

app.put("/api/productos/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.productos, false);
    await updateItem(LIST_NAMES.productos, req.params.id, buildProductoFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.productos, req.params.id);
    res.json(mapProductoFromFields(item));
  } catch (error) {
    console.error("ERROR UPDATE PRODUCTO:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar producto" });
  }
});

app.delete("/api/productos/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.productos, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE PRODUCTO:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar producto" });
  }
});

app.get("/api/productos/lista-base", authMiddleware, async (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="lista_base_productos.csv"');
  res.send("nombre,codigo,unidad\n");
});


app.get("/api/usuarios", authMiddleware, async (_req, res) => {
  try {
    const items = await listItems(LIST_NAMES.usuarios);
    res.json(items.map(mapUsuarioFromFields));
  } catch (error) {
    console.error("ERROR GET USUARIOS:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener usuarios" });
  }
});

app.post("/api/usuarios", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.usuarios, false);

    const usuarioFields = buildUsuarioFields(req.body || {}, columns);
    const usuarioLookupFields = Object.fromEntries(
      Object.entries(usuarioFields).filter(([key]) => /LookupId$/i.test(String(key)))
    );
    const usuarioBaseFields = Object.fromEntries(
      Object.entries(usuarioFields).filter(([key]) => !/LookupId$/i.test(String(key)))
    );

    const created = await createItem(
      LIST_NAMES.usuarios,
      usuarioBaseFields
    );

    if (Object.keys(usuarioLookupFields).length) {
      await applyLookupFieldsSequentially(
        LIST_NAMES.usuarios,
        Number(created.id),
        usuarioLookupFields
      );
    }

    const item = await getItem(LIST_NAMES.usuarios, created.id);
    const mapped = mapUsuarioFromFields(item);
    delete mapped.passwordHash;
    res.json(mapped);
  } catch (error) {
    console.error("ERROR CREATE USUARIO:", error);
    res.status(500).json({ error: error.message || "No se pudo crear usuario" });
  }
});

app.put("/api/usuarios/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.usuarios, false);

    const usuarioFields = buildUsuarioFields(req.body || {}, columns);
    const usuarioLookupFields = Object.fromEntries(
      Object.entries(usuarioFields).filter(([key]) => /LookupId$/i.test(String(key)))
    );
    const usuarioBaseFields = Object.fromEntries(
      Object.entries(usuarioFields).filter(([key]) => !/LookupId$/i.test(String(key)))
    );

    await updateItem(
      LIST_NAMES.usuarios,
      req.params.id,
      usuarioBaseFields
    );

    if (Object.keys(usuarioLookupFields).length) {
      await applyLookupFieldsSequentially(
        LIST_NAMES.usuarios,
        Number(req.params.id),
        usuarioLookupFields
      );
    }

    const item = await getItem(LIST_NAMES.usuarios, req.params.id);
    const mapped = mapUsuarioFromFields(item);
    delete mapped.passwordHash;
    res.json(mapped);
  } catch (error) {
    console.error("ERROR UPDATE USUARIO:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar usuario" });
  }
});

app.delete("/api/usuarios/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.usuarios, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE USUARIO:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar usuario" });
  }
});

app.get("/api/recetas/ingeniero", authMiddleware, async (req, res) => {
  try {
    const recetas = await getRecetasIngenieroData();
    const rol = String(req.user?.rol || "").trim();
    const ingenieroId = Number(req.user?.ingenieroId || 0);

    if (rol === "Mantenimiento") {
      return res.json(recetas);
    }

    if (rol === "Ingeniero") {
      const propias = recetas.filter(
        (r) => Number(r.ingenieroId || 0) === ingenieroId
      );

      console.log("RECETAS INGENIERO DEBUG:", {
        usuario: req.user?.usuario,
        rol,
        ingenieroId,
        total: recetas.length,
        visibles: propias.length,
      });

      return res.json(propias);
    }

    return res.status(403).json({
      error: "No tienes permiso para ver recetas de ingeniero",
    });
  } catch (error) {
    console.error("ERROR GET RECETAS INGENIERO:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener recetas" });
  }
});

app.post("/api/recetas/ingeniero", authMiddleware, async (req, res) => {
  try {
    const payload = req.body || {};
    const productos = Array.isArray(payload.productos) ? payload.productos : [];

    const rol = String(req.user?.rol || "").trim();
    const ingenieroIdLogueado = Number(req.user?.ingenieroId || 0);

    // Si quien crea es Ingeniero, SIEMPRE usamos su propio ingenieroId
    if (rol === "Ingeniero") {
      if (!ingenieroIdLogueado) {
        return res.status(400).json({
          error: "Tu usuario no tiene un ingeniero asociado",
        });
      }

      payload.ingenieroId = ingenieroIdLogueado;
    }

    if (!payload.ingenieroId || !payload.clienteId || !payload.fincaId || !payload.sucursalId) {
      return res.status(400).json({ error: "Faltan datos de cabecera de la receta" });
    }

    if (!productos.length) {
      return res.status(400).json({ error: "Debes agregar al menos un producto" });
    }

    const productosCatalogo = await getProductosData();
    const productosMap = new Map(productosCatalogo.map((x) => [x.id, x]));

    const recetaColumns = await getListColumns(LIST_NAMES.recetaIngeniero, false);
    const detalleColumns = await getListColumns(LIST_NAMES.recetaProducto, false);

    const recetaFields = buildRecetaIngenieroFields(payload, recetaColumns);
    const recetaLookupFields = Object.fromEntries(
      Object.entries(recetaFields).filter(([key]) => /LookupId$/i.test(String(key)))
    );
    const recetaBaseFields = Object.fromEntries(
      Object.entries(recetaFields).filter(([key]) => !/LookupId$/i.test(String(key)))
    );

    const recetaCreated = await createItem(
      LIST_NAMES.recetaIngeniero,
      recetaBaseFields
    );

    await applyLookupFieldsSequentially(
      LIST_NAMES.recetaIngeniero,
      Number(recetaCreated.id),
      recetaLookupFields
    );

    await ensureNumeroReceta(Number(recetaCreated.id));

    for (const item of productos) {
      const esOtroProducto = !!item.esOtroProducto;
      const producto = productosMap.get(Number(item.productoId));

      if (!esOtroProducto && !producto) continue;

      const detallePayload = {
        recetaIngenieroId: Number(recetaCreated.id),
        productoId: esOtroProducto ? undefined : Number(item.productoId),
        productoNombre: esOtroProducto
          ? String(item.productoNombre || item.otroProductoNombre || "").trim()
          : String(producto?.nombre || "").trim(),
        codigo: esOtroProducto
          ? String(item.codigo || "OTRO").trim()
          : String(producto?.codigo || "").trim(),
        unidad: esOtroProducto
          ? String(item.unidad || "UND").trim()
          : String(producto?.unidad || "").trim(),
        cantidadRecetada: safeNumber(item.cantidad),
        cantidadEntregada: 0,
        porcentajeCumplimiento: 0,
        dosis: String(item.dosis || "").trim(),
        precioVenta: safeNumber(item.precioVenta, safeNumber(producto?.precioVenta, 0)),
        totalVenta: round2(safeNumber(item.totalVenta, safeNumber(item.cantidad, 0) * safeNumber(item.precioVenta, safeNumber(producto?.precioVenta, 0)))),
        inventarioMomento: safeNumber(item.inventarioMomento ?? item.disponibleMomento ?? item.disponible ?? producto?.disponible ?? producto?.stock, 0),
        disponibleMomento: safeNumber(item.disponibleMomento ?? item.disponible ?? producto?.disponible ?? producto?.stock, 0),
        stockMomento: safeNumber(item.stockMomento ?? item.stock ?? producto?.stock, 0),
        reservadaMomento: safeNumber(item.reservadaMomento ?? item.reservada ?? producto?.reservada, 0),
        productoSqlId: safeNumber(item.productoSqlId ?? item.productoId, 0),
        esProductoSql: !!item.esProductoSql || USE_SQL_CATALOGS,
        esOtroProducto,
        otroProductoNombre: esOtroProducto
          ? String(item.otroProductoNombre || "").trim()
          : "",
      };

      const detalleFields = buildRecetaProductoFields(detallePayload, detalleColumns);
      const detalleLookupFields = Object.fromEntries(
        Object.entries(detalleFields).filter(([key]) => /LookupId$/i.test(String(key)))
      );
      const detalleBaseFields = Object.fromEntries(
        Object.entries(detalleFields).filter(([key]) => !/LookupId$/i.test(String(key)))
      );

      const detalleCreated = await createItem(
        LIST_NAMES.recetaProducto,
        detalleBaseFields
      );

      await applyLookupFieldsSequentially(
        LIST_NAMES.recetaProducto,
        Number(detalleCreated.id),
        detalleLookupFields
      );
    }

    const recetaFinal = await getRecetaById(Number(recetaCreated.id));
    return res.status(201).json(recetaFinal);
  } catch (error) {
    console.error("ERROR CREATE RECETA INGENIERO:", error);
    return res.status(500).json({
      error: error.message || "No se pudo crear la receta",
    });
  }
});

app.post("/api/recetas/ingeniero/:id/enviar", authMiddleware, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const columns = await getListColumns(LIST_NAMES.recetaIngeniero, false);
    const payload = {};
    setIfExists(payload, resolveWriteName(columns, ["Estado"]), "Pendiente de Confirmar");
    setIfExists(payload, resolveWriteName(columns, ["FechaEnvio"]), nowIso());
    await updateItem(LIST_NAMES.recetaIngeniero, id, payload);
    const receta = await getRecetaById(id);
    res.json(receta);
  } catch (error) {
    console.error("ERROR ENVIAR RECETA:", error);
    res.status(500).json({ error: error.message || "No se pudo enviar la receta" });
  }
});

app.get("/api/recetas/ingeniero", authMiddleware, async (req, res) => {
  try {
    const recetas = await getRecetasIngenieroData();
    const rol = String(req.user?.rol || "").trim();
    const ingenieroId = Number(req.user?.ingenieroId || 0);

    if (rol === "Mantenimiento") {
      return res.json(recetas);
    }

    if (rol === "Ingeniero") {
      const propias = recetas.filter(
        (r) => Number(r.ingenieroId || 0) === ingenieroId
      );

      console.log("RECETAS INGENIERO DEBUG:", {
        usuario: req.user?.usuario,
        rol,
        ingenieroId,
        total: recetas.length,
        visibles: propias.length,
      });

      return res.json(propias);
    }

    return res.status(403).json({
      error: "No tienes permiso para ver recetas de ingeniero",
    });
  } catch (error) {
    console.error("ERROR GET RECETAS INGENIERO:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener recetas" });
  }
});
app.get("/api/recetas/sucursal", authMiddleware, async (req, res) => {
  try {
    const recetas = await getRecetasIngenieroData();
    const rol = String(req.user?.rol || "").trim();
    const sucursalId = Number(req.user?.sucursalId || 0);

    const pendientes = recetas.filter(
      (x) => !!x.fechaEnvio && !x.fechaConfirmacion
    );

    if (rol === "Mantenimiento") {
      return res.json(pendientes);
    }

    if (rol === "Sucursal") {
      const propias = pendientes.filter(
        (r) => Number(r.sucursalId || 0) === sucursalId
      );

      console.log("RECETAS SUCURSAL FILTRADAS DEBUG:", {
        usuario: req.user?.usuario,
        rol,
        sucursalId,
        totalPendientes: pendientes.length,
        visibles: propias.length,
      });

      return res.json(propias);
    }

    return res.status(403).json({
      error: "No tienes permiso para ver recetas de sucursal",
    });
  } catch (error) {
    console.error("ERROR GET RECETAS SUCURSAL:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener recetas de sucursal" });
  }
});
app.post("/api/recetas/sucursal/:id/confirmar", authMiddleware, async (req, res) => {
  try {
    const recetaId = Number(req.params.id);
    const { factura, observacion, detalles } = req.body || {};

    console.log("CONFIRMAR RECETA DEBUG:", {
      recetaId,
      factura,
      observacion,
      detalles,
    });

    if (isEmpty(factura)) {
      return res.status(400).json({ error: "La factura es obligatoria" });
    }

    const receta = await getRecetaById(recetaId);
    if (!receta) {
      return res.status(404).json({ error: "Receta no encontrada" });
    }

    const detalleItems = await listItems(LIST_NAMES.recetaProducto);
    const context = await buildRecipeContext();

    const recetaDetalleItems = detalleItems.filter((item) => {
      const f = item.fields || {};
      return (
        getLookupIdValue(f, ["RecetaIngeniero", "Receta Ingeniero", "Receta"]) === recetaId
      );
    });

    // 🔥 FIX: primero detalleId, si no viene entonces fallback por productoId
    const detallesPorDetalleId = new Map();
    const detallesPorProductoId = new Map();

    for (const x of Array.isArray(detalles) ? detalles : []) {
      const detalleId = Number(x?.detalleId);
      const productoId = Number(x?.productoId);
      const confirmacion = {
        detalleId,
        productoId,
        cantidadEntregada: safeNumber(x?.cantidadEntregada),
        productoCambioId: safeNumber(x?.productoCambioId, 0),
        productoCambioNombre: safeText(x?.productoCambioNombre),
        productoCambioCodigo: safeText(x?.productoCambioCodigo),
        productoCambioUnidad: safeText(x?.productoCambioUnidad),
        productoCambioPrecioVenta: safeNumber(x?.productoCambioPrecioVenta, 0),
        fueCambiado: !!x?.fueCambiado || !!x?.productoCambioNombre || safeNumber(x?.productoCambioId, 0) > 0,
        motivoCambio: safeText(x?.motivoCambio),
        totalVenta: safeNumber(x?.totalVenta, 0),
      };

      if (Number.isFinite(detalleId) && detalleId > 0) {
        detallesPorDetalleId.set(detalleId, confirmacion);
      }

      if (Number.isFinite(productoId) && productoId > 0) {
        detallesPorProductoId.set(productoId, confirmacion);
      }
    }

    console.log(
      "CONFIRMAR RECETA MAPS:",
      {
        porDetalleId: Array.from(detallesPorDetalleId.entries()),
        porProductoId: Array.from(detallesPorProductoId.entries()),
        recetaDetalleItemIds: recetaDetalleItems.map((x) => Number(x.id)),
      }
    );

    const detalleColumns = await getListColumns(LIST_NAMES.recetaProducto, false);

    let totalSolicitado = 0;
    let totalEntregado = 0;
    let productosCompletos = 0;
    let precioTotalVentaFinal = 0;

    for (const item of recetaDetalleItems) {
      const mapped = mapRecetaProductoFromFields(item, context.productosMap);

      const solicitada = safeNumber(mapped.cantidad, 0);

      let confirmacion = null;
      let entregadaCruda = safeNumber(mapped.cantidadEntregada, 0);

      const itemDetalleId = Number(item.id);
      const mappedProductoId = Number(mapped.productoId);

      if (detallesPorDetalleId.has(itemDetalleId)) {
        confirmacion = detallesPorDetalleId.get(itemDetalleId);
        entregadaCruda = confirmacion?.cantidadEntregada;
      } else if (detallesPorProductoId.has(mappedProductoId)) {
        confirmacion = detallesPorProductoId.get(mappedProductoId);
        entregadaCruda = confirmacion?.cantidadEntregada;
      }

      const entregada = Math.min(
        Math.max(safeNumber(entregadaCruda, 0), 0),
        solicitada
      );

      const fueCambiado = !!confirmacion?.fueCambiado;
      // Si la sucursal cambia el producto por otro, el producto recetado original
      // no cuenta como cumplido para la efectividad. La venta sí se conserva aparte.
      const entregadaParaEfectividad = fueCambiado ? 0 : entregada;
      const porcentaje = calcPercent(entregadaParaEfectividad, solicitada);
      const precioVentaFinal = fueCambiado
        ? safeNumber(confirmacion?.productoCambioPrecioVenta, 0)
        : safeNumber(mapped.precioVenta, 0);
      const totalVentaConfirmado = safeNumber(confirmacion?.totalVenta, 0);
      const totalVentaDetalle = round2(
        totalVentaConfirmado > 0 ? totalVentaConfirmado : entregada * precioVentaFinal
      );

      totalSolicitado += solicitada;
      totalEntregado += entregadaParaEfectividad;
      precioTotalVentaFinal += totalVentaDetalle;

      if (!fueCambiado && entregada >= solicitada && solicitada > 0) {
        productosCompletos += 1;
      }

      await updateItem(
        LIST_NAMES.recetaProducto,
        item.id,
        buildRecetaProductoFields(
          {
            recetaIngenieroId: recetaId,
            productoId: fueCambiado ? confirmacion?.productoCambioId : mapped.productoId,
            productoSqlId: fueCambiado ? confirmacion?.productoCambioId : mapped.productoSqlId || mapped.productoId,
            productoNombre: mapped.productoNombre,
            codigo: mapped.productoCodigo,
            unidad: mapped.unidad,
            cantidadRecetada: solicitada,
            cantidadEntregada: entregada,
            porcentajeCumplimiento: porcentaje,
            dosis: mapped.dosis || "",
            precioVenta: precioVentaFinal,
            totalVenta: totalVentaDetalle,
            inventarioMomento: mapped.inventarioMomento || mapped.disponibleMomento || 0,
            disponibleMomento: mapped.disponibleMomento || mapped.inventarioMomento || 0,
            stockMomento: mapped.stockMomento || 0,
            reservadaMomento: mapped.reservadaMomento || 0,
            esProductoSql: USE_SQL_CATALOGS || !!mapped.productoSqlId,
            esOtroProducto: !!mapped.esOtroProducto,
            otroProductoNombre: mapped.otroProductoNombre || "",
            fueCambiado,
            productoOriginalNombre: fueCambiado ? mapped.productoNombre : mapped.productoOriginalNombre || "",
            codigoProductoOriginal: fueCambiado ? mapped.productoCodigo : mapped.codigoProductoOriginal || "",
            productoCambioNombre: fueCambiado ? confirmacion?.productoCambioNombre : "",
            productoCambioCodigo: fueCambiado ? confirmacion?.productoCambioCodigo : "",
            productoCambioUnidad: fueCambiado ? confirmacion?.productoCambioUnidad : "",
            motivoCambio: confirmacion?.motivoCambio || "",
          },
          detalleColumns
        )
      );
    }

    const porcentajeCumplimiento = calcPercent(totalEntregado, totalSolicitado);
    const recetaColumns = await getListColumns(LIST_NAMES.recetaIngeniero, false);
    const recipeUpdate = {};

    const recetaObservacionConMeta = withAppMeta(String(receta.observacion || ""), {
      paraCuantoEs: receta.paraCuantoEs,
      lotesCultivos: receta.lotesCultivos,
      precioTotalVenta: round2(precioTotalVentaFinal || receta.precioTotalVenta || 0),
      observacionGeneral: receta.observacion,
      observacionEntrega: String(observacion || ""),
    });

    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Estado"]), "Entregada");
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["FechaConfirmacion"]), nowIso());
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Factura"]), String(factura || ""));
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Observacion", "Observación"]), recetaObservacionConMeta);
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["ObservacionEntrega", "Observación Entrega", "ObservacionSucursal", "Observación Sucursal"]), String(observacion || ""));
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["TotalSolicitado"]), totalSolicitado);
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["TotalEntregado"]), totalEntregado);
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["PrecioTotalVenta", "Precio Total Venta", "TotalVenta", "Total Venta"]), round2(precioTotalVentaFinal || receta.precioTotalVenta || 0));
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["TotalProductos"]), recetaDetalleItems.length);
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["ProductosCompletos"]), productosCompletos);
    setIfExists(
      recipeUpdate,
      resolveWriteName(recetaColumns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]),
      porcentajeCumplimiento
    );

    await updateItem(LIST_NAMES.recetaIngeniero, recetaId, recipeUpdate);

    try {
      await syncHistorialFromReceta(recetaId);
    } catch (historialError) {
      console.error("ERROR SYNC HISTORIAL:", historialError);
    }

    res.json(await getRecetaById(recetaId));
  } catch (error) {
    console.error("ERROR CONFIRMAR RECETA:", error);
    res.status(500).json({ error: error.message || "No se pudo confirmar la receta" });
  }
});

app.get("/api/historial/resumen", authMiddleware, async (_req, res) => {
  try {
    const historial = await getHistorialData();
    const recetasFinalizadas = historial.length;
    const totalProductos = historial.reduce((acc, r) => acc + r.productos.length, 0);
    const productosCompletos = historial.reduce(
      (acc, r) =>
        acc +
        r.productos.filter((p) => safeNumber(p.cantidadEntregada) >= safeNumber(p.cantidadRecetada)).length,
      0
    );
    const efectividadPromedio = recetasFinalizadas
      ? round2(
          historial.reduce((acc, r) => acc + safeNumber(r.cumplimiento), 0) / recetasFinalizadas
        )
      : 0;

    res.json({
      recetasFinalizadas,
      efectividadPromedio,
      productosCompletos,
      totalProductos,
    });
  } catch (error) {
    console.error("ERROR RESUMEN HISTORIAL:", error);
    res.status(500).json({ error: error.message || "No se pudo obtener resumen de historial" });
  }
});

app.get("/api/historial/recetas", authMiddleware, async (_req, res) => {
  try {
    res.json(await getHistorialData());
  } catch (error) {
    console.error("ERROR HISTORIAL RECETAS:", error);
    res.status(500).json({ error: error.message || "No se pudo obtener historial" });
  }
});

app.get("/api/historial/exportar", authMiddleware, async (_req, res) => {
  try {
    const historial = await getHistorialData();
    const rows = [
      [
        "NumeroReceta",
        "Cliente",
        "Finca",
        "Ingeniero",
        "Sucursal",
        "Factura",
        "Cumplimiento",
        "FechaConfirmacion",
      ],
      ...historial.map((item) => [
        item.numero,
        item.clienteNombre,
        item.fincaNombre,
        item.ingenieroNombre,
        item.sucursalNombre,
        item.factura,
        item.cumplimiento,
        item.finalizadaAt,
      ]),
    ];

    const csv = rows
      .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="historial_recetas.csv"');
    res.send(csv);
  } catch (error) {
    console.error("ERROR EXPORT HISTORIAL:", error);
    res.status(500).json({ error: error.message || "No se pudo exportar historial" });
  }
});

app.get("/api/debug/sharepoint-columns/:listKey", authMiddleware, async (req, res) => {
  try {
    const listName = LIST_NAMES[req.params.listKey] || req.params.listKey;
    const columns = await getListColumns(listName, false);
    res.json(
      columns.map((c) => ({
        name: c.name,
        displayName: c.displayName,
        hidden: c.hidden,
        readOnly: c.readOnly,
        lookup: !!c.lookup,
        type: Object.keys(c || {}).find((x) => !["name", "displayName", "hidden", "readOnly", "description"].includes(x)),
      }))
    );
  } catch (error) {
    console.error("ERROR DEBUG COLUMNS:", error);
    res.status(500).json({ error: error.message || "No se pudieron leer columnas" });
  }
});
import multer from "multer";
import fs from "fs";
import xlsx from "xlsx";

const upload = multer({ dest: "uploads/" });

function normalizeImportCell(value) {
  return String(value ?? "").trim();
}

function normalizeImportKey(value) {
  return normalizeImportCell(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function detectHeaderMap(headerRow = []) {
  const map = {};

  for (let i = 0; i < headerRow.length; i++) {
    const key = normalizeImportKey(headerRow[i]);

    if (!map.nombre && [
      "producto",
      "nombre",
      "nombreproducto",
      "descripcion",
      "descriplarga",
      "descripcionlarga",
      "itemname"
    ].includes(key)) {
      map.nombre = i;
      continue;
    }

    if (!map.unidad && [
      "unidadfinal",
      "unidad",
      "unidadmedida",
      "unidaddemedida",
      "umedida",
      "um",
      "uom"
    ].includes(key)) {
      map.unidad = i;
      continue;
    }

    if (!map.codigo && [
      "codigo",
      "cod",
      "codigoproducto",
      "codigodeproducto",
      "sku",
      "itemcode"
    ].includes(key)) {
      map.codigo = i;
      continue;
    }
  }

  return map;
}

function rowLooksLikeHeader(row = []) {
  const map = detectHeaderMap(row);
  return Number.isInteger(map.nombre) || Number.isInteger(map.unidad) || Number.isInteger(map.codigo);
}

function isLikelyProductCode(value = "") {
  const v = String(value || "").trim();
  return /^[A-Z]{1,4}\d{3,6}$/i.test(v) || /^[A-Z]{2}\d{4}$/i.test(v);
}

function inferProductoFromRow(row = [], headerMap = null) {
  const safe = Array.isArray(row) ? row : [];

  let codigo = "";
  let nombre = "";
  let unidad = "";

  if (headerMap) {
    nombre = normalizeImportCell(safe[headerMap.nombre]);
    unidad = normalizeImportCell(safe[headerMap.unidad]);
    codigo = normalizeImportCell(safe[headerMap.codigo]);
  } else {
    // Formato esperado del archivo productos.csv del usuario:
    // Col 0 = Producto, Col 1 = UnidadFinal, Col 2 = Codigo, Col 3 = prefijo opcional
    nombre = normalizeImportCell(safe[0]);
    unidad = normalizeImportCell(safe[1]);
    codigo = normalizeImportCell(safe[2]);

    // Compatibilidad con archivos viejos: Código | Nombre | Unidad
    if ((!codigo || !isLikelyProductCode(codigo)) && isLikelyProductCode(nombre)) {
      const posibleCodigo = nombre;
      const posibleNombre = normalizeImportCell(safe[1]);
      const posibleUnidad = normalizeImportCell(safe[2]);

      codigo = posibleCodigo;
      nombre = posibleNombre;
      unidad = posibleUnidad;
    }
  }

  if (!unidad) unidad = "Kg";

  return {
    codigo: String(codigo || "").trim(),
    nombre: String(nombre || "").trim(),
    unidad: String(unidad || "Kg").trim() || "Kg",
  };
}

async function importarProductosDesdeArchivo(req, res) {
  let filePath = "";

  try {
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "Archivo requerido" });
    }

    filePath = file.path;

    const workbook = xlsx.readFile(file.path, { raw: false, cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const matrix = xlsx.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
    const rows = (Array.isArray(matrix) ? matrix : [])
      .map((row) => (Array.isArray(row) ? row : []))
      .filter((row) => row.some((cell) => normalizeImportCell(cell) !== ""));

    if (!rows.length) {
      return res.status(400).json({ error: "El archivo está vacío" });
    }

    const headerMap = rowLooksLikeHeader(rows[0]) ? detectHeaderMap(rows[0]) : null;
    const dataRows = headerMap ? rows.slice(1) : rows;
    const columns = await getListColumns(LIST_NAMES.productos, false);

    let procesados = 0;
    let creados = 0;
    let omitidos = 0;
    const errores = [];

    for (const row of dataRows) {
      procesados++;
      const producto = inferProductoFromRow(row, headerMap);

      if (!producto.codigo || !producto.nombre) {
        omitidos++;
        continue;
      }

      try {
        await createItem(LIST_NAMES.productos, buildProductoFields(producto, columns));
        creados++;
      } catch (error) {
        errores.push({
          fila: procesados + (headerMap ? 1 : 0),
          codigo: producto.codigo,
          nombre: producto.nombre,
          error: error?.message || "Error desconocido",
        });
      }
    }

    return res.json({
      ok: errores.length === 0,
      total: dataRows.length,
      procesados,
      creados,
      omitidos,
      errores,
      message: `Importación finalizada. Creados: ${creados}, omitidos: ${omitidos}, errores: ${errores.length}`,
    });
  } catch (error) {
    console.error("ERROR IMPORTAR PRODUCTOS:", error);
    return res.status(500).json({ error: error.message || "No se pudo importar el archivo" });
  } finally {
    if (filePath && fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch {}
    }
  }
}
/* ===========================
   IMPORTAR PRODUCTOS
=========================== */
app.post("/api/productos/importar-archivo", authMiddleware, upload.single("archivo"), importarProductosDesdeArchivo);
app.post("/api/productos/importar", authMiddleware, upload.single("archivo"), importarProductosDesdeArchivo);

/* ===========================
   DESCARGAR LISTA BASE
=========================== */
app.get("/api/productos/base", authMiddleware, async (req, res) => {
  try {
    const csvData = `nombre,codigo,unidad
Urea 46%,UR001,Kg
Fertilizante 20-20-20,FE002,Kg
Herbicida X,HB003,Ltr
`;

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=productos_base.csv");

    res.send(csvData);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.listen(PORT, () => {
  console.log(`Servidor backend corriendo en puerto ${PORT}`);
});