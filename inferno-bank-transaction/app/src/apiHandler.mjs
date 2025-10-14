import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { randomUUID } from 'crypto';
import fetch from 'node-fetch';

const dbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(dbClient);
const sqsClient = new SQSClient({});

const {
    USER_SERVICE_API,
    START_PAYMENT_QUEUE_URL,
    DYNAMODB_TABLE_NAME
} = process.env;


export const handleApiGatewayRequest = async (event) => {
    const { httpMethod, path, body, pathParameters } = event;

    console.log(`Request received: ${httpMethod} ${path}`);

   if (httpMethod === 'POST' && path.includes('/payment')) {
        return await createPayment(JSON.parse(body));
    }

   if (httpMethod === 'GET' && path.includes('/payment/status')) {
        return await getPaymentStatus(pathParameters.traceId);
    }

   return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: 'Not Found' }),
    };
};


async function createPayment(body) {
    const { cardId, service } = body;

   if (!cardId || !service) {
        console.error('Validation Error: cardId and service are required.');
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: 'cardId and service are required' })
        };
    }

   let cardData;
    /*
    try {
        const userResponse = await fetch(`${USER_SERVICE_API}/cards/${cardId}`);
        if (!userResponse.ok) {
            console.error(`Card not found or user service error for cardId: ${cardId}`);
            throw new Error('Card not found');
        }
        cardData = await userResponse.json();
        console.log(`Card validated successfully for userId: ${cardData.userId}`);
    } catch (error) {
        return {
            statusCode: 404,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: 'Card validation failed. The card does not exist.' })
        };
    }
    */
    cardData = { userId: "mock-user-123" };
    console.log(`Using mock card validation for userId: ${cardData.userId}`);

    const traceId = randomUUID();
    const transactionPayload = {
        userId: cardData.userId,
        cardId,
        service,
        traceId,
        status: 'INITIAL',
        timestamp: new Date().toISOString(),
    };


    try {
        const command = new SendMessageCommand({
            QueueUrl: START_PAYMENT_QUEUE_URL,
            MessageBody: JSON.stringify(transactionPayload),
        });
        await sqsClient.send(command);
        console.log(`Transaction ${traceId} sent to SQS queue.`);
    } catch (error) {
        console.error('SQS Send Error:', error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: 'Failed to initiate payment process.' })
        };
    }

   return {
        statusCode: 202,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ traceId }),
    };
}

async function getPaymentStatus(traceId) {
    if (!traceId) {
        return {
            statusCode: 400,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: 'traceId path parameter is required' })
        };
    }

    try {
        const command = new GetCommand({
            TableName: DYNAMODB_TABLE_NAME,
            Key: { traceId },
        });

        const { Item } = await docClient.send(command);

        if (!Item) {
            console.warn(`Payment status requested for non-existent traceId: ${traceId}`);
            return {
                statusCode: 404,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: 'Payment not found' })
            };
        }

        console.log(`Status for traceId ${traceId} retrieved successfully.`);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Item),
        };
    } catch (error) {
        console.error('DynamoDB Get Error:', error);
        return {
            statusCode: 500,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: 'Failed to retrieve payment status.' })
        };
    }
}