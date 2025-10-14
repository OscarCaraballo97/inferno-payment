import { handleApiGatewayRequest } from './src/apiHandler.mjs';
import { handleSqsRequest } from './src/sqsHandler.mjs';

export const handler = async (event) => {
 
  if (event.Records && event.Records[0].eventSource === 'aws:sqs') {
    return handleSqsRequest(event);
  }
  

  return handleApiGatewayRequest(event);
};