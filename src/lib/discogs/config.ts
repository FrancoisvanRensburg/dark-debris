import { getEnv, getEnvOptional } from "../env";
import { DEFAULT_ENDPOINTS, type Consumer, type Endpoints } from "./oauth";

export function getConsumer(): Consumer {
  return {
    key: getEnv("DISCOGS_CONSUMER_KEY"),
    secret: getEnv("DISCOGS_CONSUMER_SECRET"),
  };
}

export function getEndpoints(): Endpoints {
  return {
    requestToken: getEnvOptional("REQUEST_TOKEN_URL") ?? DEFAULT_ENDPOINTS.requestToken,
    authorize: getEnvOptional("AUTHORISE_URL") ?? DEFAULT_ENDPOINTS.authorize,
    accessToken: getEnvOptional("ACCESS_TOKEN_URL") ?? DEFAULT_ENDPOINTS.accessToken,
  };
}