import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import fetch from 'node-fetch';

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);
const sqsClient = new SQSClient({});

const {
    DYNAMODB_TABLE_NAME,
    CHECK_BALANCE_QUEUE_URL,
    TRANSACTION_QUEUE_URL,
    CORE_BANKING_API,
    LAMBDA_TASK
} = process.env;

const delay = () => new Promise(resolve => setTimeout(resolve, 5000));


export const handleSqsRequest = async (event) => {
    const messageBody = JSON.parse(event.Records[0].body);
    console.log(`Executing task: ${LAMBDA_TASK} for traceId: ${messageBody.traceId || 'N/A'}`);
    await delay();

    switch (LAMBDA_TASK) {
        case 'START_PAYMENT':
            return await startPayment(messageBody);
        case 'CHECK_BALANCE':
            return await checkBalance(messageBody.traceId);
        case 'TRANSACTION':
            return await executeTransaction(messageBody.traceId);
        default:
            throw new Error(`Unknown task: ${LAMBDA_TASK}`);
    }
};

async function startPayment(payload) {
    await docClient.send(new PutCommand({ TableName: DYNAMODB_TABLE_NAME, Item: payload }));
    await docClient.send(new UpdateCommand({
        TableName: DYNAMODB_TABLE_NAME, Key: { traceId: payload.traceId },
        UpdateExpression: 'set #status = :s, lastUpdated = :lu',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':s': 'IN_PROGRESS', ':lu': new Date().toISOString() },
    }));
    await sqsClient.send(new SendMessageCommand({
        QueueUrl: CHECK_BALANCE_QUEUE_URL,
        MessageBody: JSON.stringify({ traceId: payload.traceId }),
    }));
}

async function checkBalance(traceId) {
    const hasSufficientBalance = Math.random() > 0.1;
    if (!hasSufficientBalance) {
        await docClient.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE_NAME, Key: { traceId },
            UpdateExpression: 'set #status = :s, #error = :e, lastUpdated = :lu',
            ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
            ExpressionAttributeValues: {
                ':s': 'FAILED', ':e': 'Insufficient account balance.', ':lu': new Date().toISOString()
            },
        }));
        return;
    }
    await sqsClient.send(new SendMessageCommand({
        QueueUrl: TRANSACTION_QUEUE_URL,
        MessageBody: JSON.stringify({ traceId }),
    }));
}

async function executeTransaction(traceId) {
    const { Item } = await docClient.send(new GetCommand({ TableName: DYNAMODB_TABLE_NAME, Key: { traceId } }));
    if (!Item) return;

    try {
        const response = await fetch(CORE_BANKING_API, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                merchant: Item.service.proveedor, cardId: Item.cardId, amount: Item.service.precio_mensual,
            }),
        });
        if (!response.ok) throw new Error('Transaction rejected by core banking system.');

        await docClient.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE_NAME, Key: { traceId },
            UpdateExpression: 'set #status = :s, lastUpdated = :lu',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':s': 'FINISH', ':lu': new Date().toISOString() },
        }));
    } catch (error) {
        await docClient.send(new UpdateCommand({
            TableName: DYNAMODB_TABLE_NAME, Key: { traceId },
            UpdateExpression: 'set #status = :s, #error = :e, lastUpdated = :lu',
            ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
            ExpressionAttributeValues: {
                ':s': 'FAILED', ':e': error.message, ':lu': new Date().toISOString()
            },
        }));
    }
}