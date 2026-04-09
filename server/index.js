import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://app-recetas-d7ej.vercel.app",
    ],
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

let ACCESS_TOKEN = null;
let TOKEN_EXPIRES_AT = 0;
let SP_ACCESS_TOKEN = null;
let SP_TOKEN_EXPIRES_AT = 0;
let SITE_ID_CACHE = null;
const LIST_ID_CACHE = new Map();
const COLUMNS_CACHE = new Map();
const TITLE_SYNC_DONE = new Set();

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
  const columns = await getListColumns(listName, false);
  const expand = buildFieldsExpand(columns);

  const data = await graphFetch(
    `/sites/${siteId}/lists/${listId}/items?${expand}&$top=999`
  );

  return data.value || [];
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
  return {
    id: Number(item.id),
    nombre: getEntityDisplayName(f, ["ProductoNombre", "NombreProducto", "Nombre Producto", "Nombre", "Producto"]),
    codigo: String(
      getFieldValue(f, ["CodigoProducto", "CódigoProducto", "Codigo", "Código"])
    ).trim(),
    unidad: String(getFieldValue(f, ["Unidad", "UnidadMedida", "Unidad de Medida"]) || "Kg").trim(),
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

  if (!clienteKey) throw new Error("No encontré el campo lookup Cliente en SP_Receta Ingeniero");
  if (!fincaKey) throw new Error("No encontré el campo lookup Finca en SP_Receta Ingeniero");
  if (!sucursalKey) throw new Error("No encontré el campo lookup Sucursal en SP_Receta Ingeniero");
  if (!ingenieroKey) throw new Error("No encontré el campo lookup Ingeniero en SP_Receta Ingeniero");

  fields[clienteKey] = Number(payload.clienteId);
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
  setIfExists(fields, resolveWriteName(columns, ["Observacion", "Observación"]), "");

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

  if (!esOtroProducto) {
    if (!productoKey) {
      throw new Error("No encontré el campo lookup Producto en SP_Receta Producto");
    }
    fields[productoKey] = Number(payload.productoId);
  }

  setIfExists(fields, resolveWriteName(columns, ["ProductoNombre", "Producto Nombre"]), payload.productoNombre || "");
  setIfExists(fields, resolveWriteName(columns, ["CodigoProducto", "Codigo Producto", "CódigoProducto"]), payload.codigo || payload.codigoProducto || (esOtroProducto ? "OTRO" : ""));
  setIfExists(fields, resolveWriteName(columns, ["Unidad"]), payload.unidad || "");
  setIfExists(fields, resolveWriteName(columns, ["CantidadRecetada", "Cantidad Recetada"]), safeNumber(payload.cantidadRecetada ?? payload.cantidad, 0));
  setIfExists(fields, resolveWriteName(columns, ["CantidadEntregada", "Cantidad Entregada"]), safeNumber(payload.cantidadEntregada, 0));
  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), safeNumber(payload.porcentajeCumplimiento, 0));
  setIfExists(fields, resolveWriteName(columns, ["Dosis"]), String(payload.dosis || ""));
  setIfExists(fields, resolveWriteName(columns, ["EsOtroProducto", "Es Otro Producto"]), esOtroProducto);
  setIfExists(fields, resolveWriteName(columns, ["OtroProductoNombre", "Otro Producto Nombre"]), String(payload.otroProductoNombre || ""));

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
  setIfExists(fields, resolveWriteName(columns, ["Factura"]), String(payload.factura || ""));
  setIfExists(fields, resolveWriteName(columns, ["Observacion", "Observación"]), String(payload.observacion || ""));
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
  setIfExists(fields, resolveWriteName(columns, ["PorcentajeCumplimiento", "Porcentaje Cumplimiento"]), safeNumber(payload.porcentajeCumplimiento));
  setIfExists(fields, resolveWriteName(columns, ["Dosis"]), String(payload.dosis || ""));
  setIfExists(fields, resolveWriteName(columns, ["EsOtroProducto", "Es Otro Producto"]), !!payload.esOtroProducto);
  setIfExists(fields, resolveWriteName(columns, ["OtroProductoNombre", "Otro Producto Nombre"]), String(payload.otroProductoNombre || ""));
  return fields;
}

async function getClientesData() {
  const items = await listItems(LIST_NAMES.clientes);
  await ensureTitlesForItems(LIST_NAMES.clientes, items, ["Nombre", "Razón Social", "Razon Social", "Cliente"]);
  return items.map(mapClienteFromFields);
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

async function getProductosData() {
  const items = await listItems(LIST_NAMES.productos);
  await ensureTitlesForItems(LIST_NAMES.productos, items, ["ProductoNombre", "NombreProducto", "Nombre Producto", "Nombre", "Producto"]);
  return items.map(mapProductoFromFields);
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
  const productoId = getLookupIdValue(f, ["Producto", "ProductoId"]);
  const producto = productosMap.get(productoId);
  return {
    id: Number(item.id),
    detalleId: Number(item.id),
    recetaIngenieroId: getLookupIdValue(f, ["RecetaIngeniero", "Receta Ingeniero", "Receta", "RecetaId"]),
    productoId,
    esOtroProducto: parseBoolean(getFieldValue(f, ["EsOtroProducto", "Es Otro Producto"])),
    otroProductoNombre: String(getFieldValue(f, ["OtroProductoNombre", "Otro Producto Nombre"]) || "").trim(),
    dosis: String(getFieldValue(f, ["Dosis"]) || "").trim(),
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
  const clienteId = getLookupIdValue(f, ["Cliente", "Clientes", "ClienteId"]);
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

  return {
    id,
    numero: String(getFieldValue(f, ["NumeroReceta", "Numero Receta", "LinkTitle", "Title"]) || item.id),
    estado,
    clienteId,
    fincaId,
    ingenieroId,
    sucursalId,
    clienteNombre:
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
    observacion: String(getFieldValue(f, ["Observacion", "Observación"]) || ""),
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
      dosis: String(getFieldValue(f, ["Dosis"]) || "").trim(),
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

    return {
      id,
      numero: String(getFieldValue(f, ["NumeroReceta", "Numero Receta"]) || id),
      clienteNombre: String(getFieldValue(f, ["Cliente"]) || "").trim(),
      fincaNombre: String(getFieldValue(f, ["Finca"]) || "").trim(),
      ingenieroNombre: String(getFieldValue(f, ["Ingeniero"]) || "").trim(),
      sucursalNombre: String(getFieldValue(f, ["Sucursal"]) || "").trim(),
      factura: String(getFieldValue(f, ["Factura"]) || "").trim(),
      cumplimiento,
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
      cumplimiento: x.porcentajeCumplimiento || calcPercent(x.totalEntregado, x.totalSolicitado),
      finalizadaAt: x.fechaConfirmacion || "",
      productos: (x.productos || []).map((p) => ({
        productoNombre: p.productoNombre,
        codigoProducto: p.productoCodigo,
        unidad: p.unidad,
        cantidadRecetada: p.cantidad,
        cantidadEntregada: p.cantidadEntregada || 0,
        porcentaje: calcPercent(p.cantidadEntregada || 0, p.cantidad || 0),
      })),
    }))
    .sort((a, b) => b.id - a.id);
}

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

app.get("/api/clientes", authMiddleware, async (_req, res) => {
  try {
    res.json(await getClientesData());
  } catch (error) {
    console.error("ERROR GET CLIENTES:", error);
    res.status(500).json({ error: error.message || "No se pudieron obtener clientes" });
  }
});

app.post("/api/clientes", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.clientes, false);
    const created = await createItem(
      LIST_NAMES.clientes,
      buildClienteFields(req.body || {}, columns)
    );
    const item = await getItem(LIST_NAMES.clientes, created.id);
    res.json(mapClienteFromFields(item));
  } catch (error) {
    console.error("ERROR CREATE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo crear cliente" });
  }
});

app.put("/api/clientes/:id", authMiddleware, async (req, res) => {
  try {
    const columns = await getListColumns(LIST_NAMES.clientes, false);
    await updateItem(LIST_NAMES.clientes, req.params.id, buildClienteFields(req.body || {}, columns));
    const item = await getItem(LIST_NAMES.clientes, req.params.id);
    res.json(mapClienteFromFields(item));
  } catch (error) {
    console.error("ERROR UPDATE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo actualizar cliente" });
  }
});

app.delete("/api/clientes/:id", authMiddleware, async (req, res) => {
  try {
    await deleteItem(LIST_NAMES.clientes, req.params.id);
    res.json({ ok: true });
  } catch (error) {
    console.error("ERROR DELETE CLIENTE:", error);
    res.status(500).json({ error: error.message || "No se pudo eliminar cliente" });
  }
});

app.post("/api/clientes/importar", authMiddleware, async (_req, res) => {
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

app.get("/api/productos", authMiddleware, async (_req, res) => {
  try {
    res.json(await getProductosData());
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

app.post("/api/productos/importar-archivo", authMiddleware, async (_req, res) => {
  res.json({ ok: true, message: "Importación no implementada en esta versión" });
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
      const cantidadEntregada = safeNumber(x?.cantidadEntregada);

      if (Number.isFinite(detalleId) && detalleId > 0) {
        detallesPorDetalleId.set(detalleId, cantidadEntregada);
      }

      if (Number.isFinite(productoId) && productoId > 0) {
        detallesPorProductoId.set(productoId, cantidadEntregada);
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

    for (const item of recetaDetalleItems) {
      const mapped = mapRecetaProductoFromFields(item, context.productosMap);

      const solicitada = safeNumber(mapped.cantidad, 0);

      let entregadaCruda = safeNumber(mapped.cantidadEntregada, 0);

      const itemDetalleId = Number(item.id);
      const mappedProductoId = Number(mapped.productoId);

      if (detallesPorDetalleId.has(itemDetalleId)) {
        entregadaCruda = detallesPorDetalleId.get(itemDetalleId);
      } else if (detallesPorProductoId.has(mappedProductoId)) {
        entregadaCruda = detallesPorProductoId.get(mappedProductoId);
      }

      const entregada = Math.min(
        Math.max(safeNumber(entregadaCruda, 0), 0),
        solicitada
      );

      const porcentaje = calcPercent(entregada, solicitada);

      totalSolicitado += solicitada;
      totalEntregado += entregada;

      if (entregada >= solicitada && solicitada > 0) {
        productosCompletos += 1;
      }

      await updateItem(
        LIST_NAMES.recetaProducto,
        item.id,
        buildRecetaProductoFields(
          {
            recetaIngenieroId: recetaId,
            productoId: mapped.productoId,
            productoNombre: mapped.productoNombre,
            codigo: mapped.productoCodigo,
            unidad: mapped.unidad,
            cantidadRecetada: solicitada,
            cantidadEntregada: entregada,
            porcentajeCumplimiento: porcentaje,
            dosis: mapped.dosis || "",
            esOtroProducto: !!mapped.esOtroProducto,
            otroProductoNombre: mapped.otroProductoNombre || "",
          },
          detalleColumns
        )
      );
    }

    const porcentajeCumplimiento = calcPercent(totalEntregado, totalSolicitado);
    const recetaColumns = await getListColumns(LIST_NAMES.recetaIngeniero, false);
    const recipeUpdate = {};

    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Estado"]), "Entregada");
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["FechaConfirmacion"]), nowIso());
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Factura"]), String(factura || ""));
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["Observacion", "Observación"]), String(observacion || ""));
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["TotalSolicitado"]), totalSolicitado);
    setIfExists(recipeUpdate, resolveWriteName(recetaColumns, ["TotalEntregado"]), totalEntregado);
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
import csv from "csv-parser";
import fs from "fs";
import xlsx from "xlsx";

const upload = multer({ dest: "uploads/" });

/* ===========================
   IMPORTAR PRODUCTOS
=========================== */
app.post("/api/productos/importar", authMiddleware, upload.single("archivo"), async (req, res) => {
  try {
    const file = req.file;
    const tipo = req.body.tipo || "excel";

    if (!file) {
      return res.status(400).json({ error: "Archivo requerido" });
    }

    let rows = [];

    if (tipo === "excel") {
      const workbook = xlsx.readFile(file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      rows = xlsx.utils.sheet_to_json(sheet);
    } else {
      rows = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(file.path)
          .pipe(csv())
          .on("data", (data) => rows.push(data))
          .on("end", resolve)
          .on("error", reject);
      });
    }

    if (!rows.length) {
      throw new Error("El archivo está vacío");
    }

    let creados = 0;

    for (const row of rows) {
      const nombre = row.nombre || row.Nombre;
      const codigo = row.codigo || row.Codigo;
      const unidad = row.unidad || row.Unidad || "Kg";

      if (!nombre || !codigo) continue;

      await createItem(LIST_NAMES.productos, {
        Title: nombre,
        Nombre: nombre,
        Codigo: codigo,
        Unidad: unidad,
      });

      creados++;
    }

    fs.unlinkSync(file.path);

    res.json({
      ok: true,
      total: rows.length,
      creados,
    });
  } catch (error) {
    console.error("ERROR IMPORTAR PRODUCTOS:", error);
    res.status(500).json({ error: error.message });
  }
});

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