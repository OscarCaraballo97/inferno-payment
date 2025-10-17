// app/index.mjs
import { handleApiGatewayRequest } from "./src/apiHandler.mjs";
import { handleSqsRequest } from "./src/sqsHandler.mjs";

export const handler = async (event, context) => {
  // Si viene de SQS, el evento trae Records
  if (event?.Records) {
    if (typeof handleSqsRequest !== "function") {
      throw new Error("src/sqsHandler.mjs debe exportar handleSqsRequest");
    }
    return handleSqsRequest(event, context);
  }
  // Si viene de API Gateway (REST)
  if (typeof handleApiGatewayRequest !== "function") {
    throw new Error("src/apiHandler.mjs debe exportar handleApiGatewayRequest");
  }
  return handleApiGatewayRequest(event, context);
};
