import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand } from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { randomUUID } from "crypto";

// ---------- AWS SDK v3 clients ----------
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));const sqs = new SQSClient({});

// ---------- ENV ----------
const {
  DYNAMODB_TABLE_NAME,
  START_PAYMENT_QUEUE_URL,
  USER_SERVICE_API,
} = process.env;

// ---------- Helpers de respuesta ----------
const CORS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};
const resp = (statusCode, bodyObj) => ({
  statusCode,
  headers: CORS,
  body: JSON.stringify(bodyObj ?? {}),
});

// ---------- Helpers de API Gateway ----------
function getMethod(evt) {
  // REST v1: evt.httpMethod  |  HTTP v2: evt.requestContext.http.method
  return evt?.httpMethod || evt?.requestContext?.http?.method || "GET";
}

function getPath(evt) {
  // REST v1: evt.path  |  HTTP v2: evt.requestContext.http.path
  return evt?.path || evt?.requestContext?.http?.path || "/";
}

function getPathParam(evt, name) {
  return evt?.pathParameters?.[name];
}

function parseJsonBody(evt) {
  if (!evt?.body) return {};
  try {
    const raw = evt.isBase64Encoded
      ? Buffer.from(evt.body, "base64").toString("utf8")
      : evt.body;
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

// ---------- Ruteo principal ----------
export const handleApiGatewayRequest = async (event) => {
  try {
    const method = getMethod(event);
    const path = getPath(event);

    // CORS preflight
    if (method === "OPTIONS") return resp(200, { ok: true });

    // POST /payment
    if (method === "POST" && (path.endsWith("/payment") || event?.resource === "/payment")) {
      const body = parseJsonBody(event);
      return await createPayment(body);
    }

    // GET /payment/{traceId}  (también /payment/status/{traceId}, por si lo tienes)
    if (
      method === "GET" &&
      (path.includes("/payment/") || event?.resource === "/payment/{traceId}" || event?.resource === "/payment/status/{traceId}")
    ) {
      const traceId =
        getPathParam(event, "traceId") ||
        path.split("/").filter(Boolean).pop();
      return await getPaymentStatus(traceId);
    }

    return resp(404, { ok: false, error: "Not Found" });
  } catch (e) {
    console.error("[payments/api] fatal", e);
    return resp(500, { ok: false, error: "Internal error" });
  }
};

// ---------- Lógica de casos ----------

async function createPayment(body) {
  const { cardId, service } = body || {};
  if (!cardId || !service) {
    return resp(400, { ok: false, error: "cardId and service are required" });
  }

  // 1) Validar tarjeta contra USERS (recomendado)
  //    Si quieres arrancar sin dependencia, comenta este bloque temporalmente.
  if (!USER_SERVICE_API) {
    console.warn("USER_SERVICE_API no está configurado; skip validación");
  } else {
    try {
      const r = await fetch(`${USER_SERVICE_API}/cards/${encodeURIComponent(cardId)}`);
      if (!r.ok) {
        const msg = r.status === 404 ? "Card not found" : `Users API error (${r.status})`;
        return resp(r.status === 404 ? 404 : 400, { ok: false, error: msg });
      }
      const card = await r.json();
      if (!card?.active) return resp(400, { ok: false, error: "Card inactive" });
      // Usaremos el userId real del owners de la tarjeta
      body.userId = card.userId;
    } catch (e) {
      console.error("[payments/api] users validation error", e);
      return resp(502, { ok: false, error: "Users API unreachable" });
    }
  }

  // 2) Generar traceId y armar payload para la cadena SQS
  const traceId = randomUUID();
  const payload = {
    traceId,
    userId: card.userId,
    cardId,
    service,
    status: "INITIAL",
    timestamp: new Date().toISOString(),
  };

  // 3) Enviar a cola START_PAYMENT
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: START_PAYMENT_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      })
    );
  } catch (e) {
    console.error("[payments/api] SQS send error", e);
    return resp(500, { ok: false, error: "Failed to initiate payment process" });
  }

  // 202 Accepted para indicar proceso asíncrono
  return resp(202, { traceId });
}

async function getPaymentStatus(traceId) {
  if (!traceId) return resp(400, { ok: false, error: "traceId required" });

  try {
    const { Item } = await ddb.send(
      new GetCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Key: { traceId },
      })
    );
    if (!Item) return resp(404, { ok: false, error: "Payment not found" });

    // Devuelve tal cual está en DynamoDB (lo popularon los workers)
    return resp(200, Item);
  } catch (e) {
    console.error("[payments/api] ddb get error", e);
    return resp(500, { ok: false, error: "Failed to retrieve payment status" });
  }
}
