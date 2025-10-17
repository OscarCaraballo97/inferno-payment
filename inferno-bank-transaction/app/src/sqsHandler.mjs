import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
  GetCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

// ---------- AWS SDK v3 clients ----------
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});

// ---------- ENV ----------
const {
  DYNAMODB_TABLE_NAME,
  CHECK_BALANCE_QUEUE_URL,
  TRANSACTION_QUEUE_URL,
  CORE_BANKING_BASE, // <- base del core: https://.../dev
  LAMBDA_TASK,       // START_PAYMENT | CHECK_BALANCE | TRANSACTION
} = process.env;

// ---------- Utils ----------
const delay = (ms = 5000) => new Promise((r) => setTimeout(r, ms));
const nowISO = () => new Date().toISOString();

export const handleSqsRequest = async (event) => {
  // Un solo registro por diseño (batch_size 1). Si vinieran más, iterarías aquí.
  const messageBody = JSON.parse(event.Records?.[0]?.body || "{}");
  const traceId = messageBody.traceId || "N/A";

  console.log(`[payments/sqs] Task=${LAMBDA_TASK} traceId=${traceId}`);
  await delay(5000); // simular 5s de validación

  switch (LAMBDA_TASK) {
    case "START_PAYMENT":
      return startPayment(messageBody);
    case "CHECK_BALANCE":
      return checkBalance(messageBody.traceId);
    case "TRANSACTION":
      return executeTransaction(messageBody.traceId);
    default:
      throw new Error(`Unknown task: ${LAMBDA_TASK}`);
  }
};

// -------------------------------------
// START_PAYMENT: persiste INITIAL y encola CHECK_BALANCE
// -------------------------------------
async function startPayment(payload) {
  const traceId = payload.traceId;

  // 1) Guardar el payload completo tal cual llegó (INITIAL)
  await ddb.send(
    new PutCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Item: {
        ...payload,
        step: "start-payment",
        progress: 0,
        updatedAt: nowISO(),
      },
    })
  );

  // 2) Marcar IN_PROGRESS para visibilidad del polling
  await ddb.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { traceId },
      UpdateExpression:
        "SET #status = :s, #step = :step, #progress = :p, #updatedAt = :u",
      ExpressionAttributeNames: {
        "#status": "status",
        "#step": "step",
        "#progress": "progress",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":s": "IN_PROGRESS",
        ":step": "start-payment",
        ":p": 25,
        ":u": nowISO(),
      },
    })
  );

  // 3) Encolar siguiente etapa
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: CHECK_BALANCE_QUEUE_URL,
      MessageBody: JSON.stringify({ traceId }),
    })
  );

  console.log(`[payments/sqs] START_PAYMENT enqueued CHECK_BALANCE ${traceId}`);
}

// -------------------------------------
// CHECK_BALANCE: valida fondos y encola TRANSACTION
// -------------------------------------
async function checkBalance(traceId) {
  // 1) Marca progreso en DDB
  await ddb.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { traceId },
      UpdateExpression:
        "SET #step = :step, #progress = :p, #updatedAt = :u",
      ExpressionAttributeNames: {
        "#step": "step",
        "#progress": "progress",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":step": "check-balance",
        ":p": 50,
        ":u": nowISO(),
      },
    })
  );

  // 2) Simulación de saldo (10% falla)
  const hasFunds = Math.random() > 0.1;
  if (!hasFunds) {
    await ddb.send(
      new UpdateCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Key: { traceId },
        UpdateExpression:
          "SET #status = :s, #step = :step, #error = :e, #updatedAt = :u, #progress = :p",
        ExpressionAttributeNames: {
          "#status": "status",
          "#step": "step",
          "#error": "error",
          "#updatedAt": "updatedAt",
          "#progress": "progress",
        },
        ExpressionAttributeValues: {
          ":s": "FAILED",
          ":step": "check-balance",
          ":e": "Insufficient account balance.",
          ":u": nowISO(),
          ":p": 100,
        },
      })
    );
    console.warn(`[payments/sqs] CHECK_BALANCE FAILED ${traceId}`);
    return;
  }

  // 3) Encolar TRANSACTION
  await ddb.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { traceId },
      UpdateExpression:
        "SET #progress = :p, #updatedAt = :u",
      ExpressionAttributeNames: {
        "#progress": "progress",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":p": 75,
        ":u": nowISO(),
      },
    })
  );

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: TRANSACTION_QUEUE_URL,
      MessageBody: JSON.stringify({ traceId }),
    })
  );

  console.log(`[payments/sqs] CHECK_BALANCE enqueued TRANSACTION ${traceId}`);
}

// -------------------------------------
// TRANSACTION: POST al core y FINISH/FAILED
// -------------------------------------
async function executeTransaction(traceId) {
  // 1) Cargar item de la transacción
  const { Item } = await ddb.send(
    new GetCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { traceId },
    })
  );
  if (!Item) {
    console.error(`[payments/sqs] TRANSACTION missing item ${traceId}`);
    return;
  }

  // 2) Marca paso actual
  await ddb.send(
    new UpdateCommand({
      TableName: DYNAMODB_TABLE_NAME,
      Key: { traceId },
      UpdateExpression:
        "SET #step = :step, #updatedAt = :u",
      ExpressionAttributeNames: {
        "#step": "step",
        "#updatedAt": "updatedAt",
      },
      ExpressionAttributeValues: {
        ":step": "transaction",
        ":u": nowISO(),
      },
    })
  );

  try {
    // 3) Si no hay CORE_BANKING_BASE, simula éxito para no romper la demo
    if (!CORE_BANKING_BASE) {
      console.warn("[payments/sqs] CORE_BANKING_BASE not set → simulate FINISH");
      await ddb.send(
        new UpdateCommand({
          TableName: DYNAMODB_TABLE_NAME,
          Key: { traceId },
          UpdateExpression:
            "SET #status = :s, #progress = :p, #updatedAt = :u",
          ExpressionAttributeNames: {
            "#status": "status",
            "#progress": "progress",
            "#updatedAt": "updatedAt",
          },
          ExpressionAttributeValues: {
            ":s": "FINISH",
            ":p": 100,
            ":u": nowISO(),
          },
        })
      );
      return;
    }

    // 4) Construye la URL real:
    // POST {CORE_BANKING_BASE}/users/{userId}/transactions
    const url = `${CORE_BANKING_BASE}/users/${encodeURIComponent(
      Item.userId
    )}/transactions`;

    // 5) Payload esperado por tu core (ajusta si necesita otro esquema)
    const payload = {
      merchant: Item?.service?.proveedor ?? "Comercio",
      cardId: Item.cardId,
      amount: Item?.service?.precio_mensual ?? 0,
      traceId,
      type: "PURCHASE",
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      throw new Error(`Core rejected (${r.status}): ${text}`);
    }

    // 6) FINISH
    await ddb.send(
      new UpdateCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Key: { traceId },
        UpdateExpression:
          "SET #status = :s, #progress = :p, #updatedAt = :u",
        ExpressionAttributeNames: {
          "#status": "status",
          "#progress": "progress",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":s": "FINISH",
          ":p": 100,
          ":u": nowISO(),
        },
      })
    );
    console.log(`[payments/sqs] TRANSACTION FINISH ${traceId}`);
  } catch (error) {
    console.error(`[payments/sqs] TRANSACTION FAILED ${traceId}`, error);
    await ddb.send(
      new UpdateCommand({
        TableName: DYNAMODB_TABLE_NAME,
        Key: { traceId },
        UpdateExpression:
          "SET #status = :s, #error = :e, #progress = :p, #updatedAt = :u",
        ExpressionAttributeNames: {
          "#status": "status",
          "#error": "error",
          "#progress": "progress",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":s": "FAILED",
          ":e": error.message || String(error),
          ":p": 100,
          ":u": nowISO(),
        },
      })
    );
  }
}
